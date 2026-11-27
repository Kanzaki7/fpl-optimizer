import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from pipeline import api, notify
from pipeline.__main__ import main as run_pipeline
from pipeline.email_template import render


def test_due_window():
    now = datetime(2026, 11, 27, 5, 17, tzinfo=timezone.utc)
    iso = lambda d: d.isoformat().replace("+00:00", "Z")  # noqa: E731
    assert notify.due(iso(now + timedelta(hours=29)), now)          # veille d'un samedi midi
    assert notify.due(iso(now + timedelta(hours=8)), now)           # exécution retardée : encore à temps
    assert not notify.due(iso(now + timedelta(hours=5)), now)       # trop tard pour être utile
    assert not notify.due(iso(now + timedelta(hours=53)), now)      # trop tôt : ce sera demain
    assert not notify.due(None, now)


def test_free_transfers_rules():
    hist = [{"event": e, "event_transfers": t} for e, t in [(1, 0), (2, 0), (3, 1), (4, 3), (5, 0)]]
    # après J1 : 1 ; J2 : 2 ; J3 : 2-1+1=2 ; J4 : max(0,2-3)+1=1 ; J5 : 2
    assert api.free_transfers(hist, []) == 2
    # un joker en J4 ne consomme rien : 2 -> 3 -> 4
    assert api.free_transfers(hist, [{"name": "wildcard", "event": 4}]) == 4
    many = [{"event": e, "event_transfers": 0} for e in range(1, 12)]
    assert api.free_transfers(many, []) == 5                       # plafond


@pytest.fixture
def setup(api_dir, tmp_path):
    out = str(tmp_path / "out")
    assert run_pipeline(["--replay", api_dir, "--out", out, "--cache", str(tmp_path / "c"),
                         "--overrides", "", "--no-stability", "-q"]) == 0
    latest = os.path.join(out, "latest.json")
    with open(latest, encoding="utf-8") as f:
        data = json.load(f)
    # équipe d'abonné : l'équipe optimale où l'attaquant le plus cher est remplacé par un remplaçant
    squad = data["squad"]["xi"] + data["squad"]["bench"]
    players = {p["id"]: p for p in data["players"]}
    others = {o[0]: o for o in data["others"]}
    fwd = max((i for i in squad if players[i]["pos"] == "FWD"), key=lambda i: players[i]["price"])
    club = players[fwd]["team"]
    weak = next(o[0] for o in data["others"] if o[4] == "FWD" and o[2] != club
                and sum(1 for i in squad if players[i]["team"] == o[2]) < 3)
    picks = [weak if i == fwd else i for i in squad]

    def dump(rel, obj):
        path = os.path.join(api_dir, rel + ".json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f)

    dump("entry/42", {"id": 42, "name": "Équipe test", "current_event": 3})
    dump("entry/42/history", {"current": [{"event": e, "event_transfers": 0} for e in (1, 2, 3)], "chips": []})
    dump("entry/42/event/3/picks", {"active_chip": None, "picks": [{"element": i} for i in picks],
                                    "entry_history": {"bank": 50}})
    return latest, fwd, weak, players, others


def test_advise_sells_the_weak_player(setup, api_dir):
    latest, fwd, weak, players, _ = setup
    _, df = notify.load_players(latest)
    team = api.entry_team(api.FplClient(replay_dir=api_dir), 42)
    assert team["ft"] == 3 and team["bank"] == 5.0 and len(team["picks"]) == 15
    adv = notify.advise(df, team)
    outs = [o["id"] for o, *_ in adv["transfers"]]
    assert weak in outs                          # le joueur à 0 point part
    assert adv["gain"] > 0 and adv["hits"] == 0  # 3 transferts gratuits, pas de pénalité
    assert len(adv["transfers"]) <= notify.MAX_TRANSFERS


def test_email_renders(setup, api_dir, tmp_path, monkeypatch):
    latest, *_ = setup
    sent = []

    class FakeStore:
        def __init__(self, *a): pass
        def confirmed(self): return [{"id": "u1", "email": "a@b.c", "fpl_id": 42, "token": "tok", "last_sent_gw": None}]
        def mark_sent(self, *a): sent.append(a)
        def purge_unconfirmed(self): pass

    monkeypatch.setattr(notify, "Store", FakeStore)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    out = tmp_path / "mails"
    assert notify.main(["--data", latest, "--force", "--dry-run", str(out), "--replay", api_dir]) == 0
    html = (out / "42.html").read_text(encoding="utf-8")
    assert "À faire avant la journée 4" in html and "Vendre" in html and "tok" in html
    assert "?equipe=42" in html
    assert sent == []                         # un test (--force) ne marque pas la journée comme envoyée


def test_render_without_transfers():
    subject, html, text = render({
        "gw": 12, "deadline": "2026-11-28T18:30:00Z", "team_name": "X", "transfers": [], "keep": 300.0,
        "with_": 300.0, "hits": 0, "gain": 0.0, "captain": "Haaland", "vice": "Saka", "watch": [], "ft": 2,
        "horizon": "les journées 12 à 19", "app_url": "https://s/?equipe=1", "unsubscribe_url": "https://s/u"})
    assert subject == "J12 : gardez votre équipe"
    assert "samedi 28 novembre à 19 h 30" in html        # heure de Bruxelles
    assert "reportez vos transferts gratuits (2)" in html and "Haaland" in text
