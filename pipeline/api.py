"""
Client de l'API officielle Fantasy Premier League.

Ce qui change par rapport à la première version du script :
  - une seule session HTTP réutilisée (connexions keep-alive) ;
  - reprises avec attente exponentielle, et respect de l'en-tête Retry-After
    sur les réponses 429 / 5xx (l'API répond 503 pendant la mise à jour d'une
    journée) ; un 403 ou un 404 n'est pas retenté ;
  - les stats de la saison en cours viennent de event/<gw>/live : une requête
    par journée pour tous les joueurs, au lieu d'une par joueur (≈ 700) ;
  - l'historique des saisons passées (element-summary) ne change pas pendant
    la saison : il est mis en cache par joueur, seuls les nouveaux venus sont
    téléchargés.
Mode « replay » : lit les mêmes chemins dans un dossier local, pour les tests.
"""

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter

from .config import BASE_URL, USER_AGENT

log = logging.getLogger(__name__)

RETRY_STATUS = {429, 500, 502, 503, 504}


class FplApiError(RuntimeError):
    pass


class FplClient:
    def __init__(self, base=BASE_URL, replay_dir=None, workers=4, timeout=20,
                 retries=5, backoff=1.5):
        self.base = base.rstrip("/")
        self.replay_dir = replay_dir
        self.workers = workers
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self.calls = 0
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT,
                                     "Accept": "application/json"})
        adapter = HTTPAdapter(pool_connections=workers, pool_maxsize=workers)
        self.session.mount("https://", adapter)

    # ------------------------------------------------------------ bas niveau
    def get(self, path):
        path = path.strip("/")
        self.calls += 1
        if self.replay_dir:
            file = os.path.join(self.replay_dir, f"{path}.json")
            if not os.path.exists(file):
                raise FplApiError(f"replay : {file} introuvable")
            with open(file, encoding="utf-8") as f:
                return json.load(f)

        url = f"{self.base}/{path}/"
        last = None
        for attempt in range(self.retries):
            try:
                r = self.session.get(url, timeout=self.timeout)
            except requests.RequestException as e:
                last = str(e)
                time.sleep(self.backoff * 2 ** attempt)
                continue
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    # pendant une mise à jour, l'API renvoie parfois du HTML
                    last = "réponse non JSON (mise à jour en cours ?)"
            elif r.status_code in RETRY_STATUS:
                last = f"HTTP {r.status_code}"
                wait = r.headers.get("Retry-After")
                if wait and wait.isdigit():
                    time.sleep(min(int(wait), 120))
                    continue
            else:
                raise FplApiError(f"{url} : HTTP {r.status_code}")
            time.sleep(self.backoff * 2 ** attempt)
        raise FplApiError(f"{url} : échec après {self.retries} essais ({last})")

    def many(self, paths):
        """Télécharge plusieurs chemins en parallèle (débit modéré)."""
        out = {}
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            futures = {pool.submit(self.get, p): p for p in paths}
            for k, fut in enumerate(as_completed(futures), 1):
                out[futures[fut]] = fut.result()
                if k % 100 == 0:
                    log.info("  %d/%d", k, len(paths))
        return out

    # ------------------------------------------------------------ endpoints
    def bootstrap(self):
        return self.get("bootstrap-static")

    def fixtures(self):
        return self.get("fixtures")

    def live(self, gw):
        return self.get(f"event/{gw}/live")

    def summary(self, player_id):
        return self.get(f"element-summary/{player_id}")


# ---------------------------------------------------------------- cache
PAST_FIELDS = ["season_name", "minutes", "total_points", "goals_scored",
               "assists", "clean_sheets", "expected_goals", "expected_assists"]
LIVE_FIELDS = ["minutes", "total_points", "clean_sheets", "goals_scored",
               "assists", "expected_goals", "expected_assists", "starts"]


def season_of(events):
    """« 2026/27 » d'après la date limite de la première journée."""
    first = next((e.get("deadline_time") for e in events or [] if e.get("deadline_time")), None)
    if not first:
        return "inconnue"
    y = int(first[:4])
    return f"{y}/{(y + 1) % 100:02d}"


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def history_past(client, elements, season, cache_dir):
    """
    Saisons passées de chaque joueur, indexées par `code` (identifiant stable
    d'une saison à l'autre, contrairement à `id`). Le cache est vidé quand la
    saison change.
    """
    path = os.path.join(cache_dir, "history_past.json")
    cache = _read(path, {})
    if cache.get("season") != season:
        cache = {"season": season, "players": {}}
    players = cache["players"]
    missing = [e for e in elements if str(e["code"]) not in players]
    if missing:
        log.info("Historique : %d joueur(s) à télécharger (%d en cache)",
                 len(missing), len(players))
        by_id = {e["id"]: e["code"] for e in missing}
        res = client.many([f"element-summary/{pid}" for pid in by_id])
        for p, data in res.items():
            pid = int(p.rsplit("/", 1)[1])
            players[str(by_id[pid])] = [
                {k: s.get(k) for k in PAST_FIELDS}
                for s in data.get("history_past", [])]
        _write(path, cache)
    else:
        log.info("Historique : %d joueurs, tout est en cache", len(players))
    return players


def gameweek_stats(client, events, season, cache_dir):
    """
    Stats par joueur et par journée, depuis event/<gw>/live. Les journées
    terminées et validées (data_checked) sont figées : on les garde en cache.
    """
    folder = os.path.join(cache_dir, "live", season.replace("/", "-"))
    done = [e for e in events if e.get("finished")]
    rows = {}
    fetched = 0
    for e in done:
        gw = e["id"]
        path = os.path.join(folder, f"{gw}.json")
        data = _read(path, None) if e.get("data_checked") else None
        if data is None:
            live = client.live(gw)
            fetched += 1
            data = [[el["id"]] + [el["stats"].get(k, 0) for k in LIVE_FIELDS]
                    for el in live.get("elements", [])]
            if e.get("data_checked"):
                _write(path, data)
        rows[gw] = data
    log.info("Journées : %d terminée(s), %d téléchargée(s), %d en cache",
             len(done), fetched, len(done) - fetched)
    return rows
