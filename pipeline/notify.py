"""
Alertes e-mail : la veille de chaque date limite, chaque abonné confirmé
reçoit les transferts conseillés pour son équipe.

    python -m pipeline.notify                 # tourne dans le workflow quotidien
    python -m pipeline.notify --force         # envoie maintenant, sans attendre la fenêtre
    python -m pipeline.notify --dry-run out/  # écrit les e-mails en HTML, n'envoie rien

Variables d'environnement : SUPABASE_URL, SUPABASE_SECRET_KEY (abonnés),
GMAIL_USER, GMAIL_APP_PASSWORD (envoi), SITE_URL (liens).
"""

import argparse
import json
import logging
import os
import smtplib
import ssl
import sys
from datetime import datetime, timedelta, timezone
from email import policy
from email.message import EmailMessage
from email.utils import formataddr

import pandas as pd
import requests

from . import api, optimize
from .config import BENCH_WEIGHT
from .email_template import render

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log = logging.getLogger("notify")
HIT = 4
MAX_TRANSFERS = 2


# ---------------------------------------------------------------- quand envoyer
def due(deadline_iso, now, lo_h=6, hi_h=48):
    """
    Vrai si la date limite tombe entre 6 h et 48 h après maintenant.

    Le workflow tourne une fois par jour, mais GitHub peut retarder une
    exécution planifiée de plusieurs heures : la fenêtre fait donc 42 h pour
    qu'au moins une exécution y tombe toujours. L'envoi part à la première ;
    last_sent_gw empêche d'envoyer deux fois la même journée.
    """
    if not deadline_iso:
        return False
    d = datetime.fromisoformat(deadline_iso.replace("Z", "+00:00"))
    return timedelta(hours=lo_h) < d - now <= timedelta(hours=hi_h)


# ---------------------------------------------------------------- abonnés (Supabase)
class Store:
    """Table subscribers via l'API REST de Supabase (clé secrète, côté serveur)."""

    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1/subscribers"
        self.h = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_"):          # ancienne clé service_role (JWT)
            self.h["Authorization"] = f"Bearer {key}"

    def confirmed(self):
        r = requests.get(self.base, headers=self.h, timeout=20,
                         params={"confirmed": "eq.true", "select": "id,email,fpl_id,token,last_sent_gw"})
        r.raise_for_status()
        return r.json()

    def mark_sent(self, sub_id, gw):
        r = requests.patch(self.base, headers=self.h, timeout=20, params={"id": f"eq.{sub_id}"},
                           json={"last_sent_gw": gw})
        r.raise_for_status()

    def purge_unconfirmed(self, days=7):
        """Minimisation des données : une inscription jamais confirmée est effacée."""
        limit = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        r = requests.delete(self.base, headers=self.h, timeout=20,
                            params={"confirmed": "eq.false", "updated_at": f"lt.{limit}"})
        r.raise_for_status()


# ---------------------------------------------------------------- conseils
def load_players(path):
    """Joueurs de latest.json avec leur valeur sur l'horizon par défaut."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    meta = data["meta"]
    h = meta["horizon"]
    pos_id = {"GK": 1, "DEF": 2, "MID": 3, "FWD": 4}
    rows = [{"id": p["id"], "name": p["name"], "team": p["team"], "team_id": p["team_id"],
             "pos": p["pos"], "pos_id": pos_id[p["pos"]], "price": p["price"], "pool": p["pool"],
             "ep": sum(p["g"][:h]), "status": p["status"], "chance": p["chance"], "news": p["news"],
             "share": p["share"]}
            for p in data["players"]]
    rows += [{"id": o[0], "name": o[1], "team": o[2], "team_id": o[3], "pos": o[4], "pos_id": pos_id[o[4]],
              "price": o[5], "pool": False, "ep": 0.0, "status": o[6], "chance": None, "news": "",
              "share": 0.0} for o in data.get("others", [])]
    return meta, pd.DataFrame(rows).set_index("id")


def advise(players, team, max_transfers=MAX_TRANSFERS):
    """Transferts conseillés pour une équipe importée (même modèle que le site)."""
    picks = team["picks"]
    missing = [i for i in picks if i not in players.index]
    if missing:
        raise ValueError(f"joueurs inconnus des données du jour : {missing}")
    cands = players[players["pool"] | players.index.isin(picks)]
    budget = round(team["bank"] + players.loc[picks, "price"].sum(), 1)

    def run(n):
        sq, xi = optimize.optimize_squad(
            cands, budget, current={"picks": picks, "ft": team["ft"], "max_transfers": n, "hit": HIT})
        lu = optimize.lineup(cands, sq, xi, budget)
        return sq, lu, round(lu["ep_xi"] + BENCH_WEIGHT * lu["ep_bench"], 1)

    _, _, keep = run(0)
    squad, lu, with_ = run(max_transfers)
    order = lambda i: (players.at[i, "pos_id"], -players.at[i, "price"])  # noqa: E731
    outs = sorted([i for i in picks if i not in squad], key=order)
    ins = sorted([i for i in squad if i not in picks], key=order)
    hits = max(0, len(ins) - team["ft"])
    row = lambda i: players.loc[i].to_dict() | {"id": i}  # noqa: E731
    watch = []
    for i in squad:
        p = players.loc[i]
        chance = None if p["chance"] is None or pd.isna(p["chance"]) else int(p["chance"])
        if p["status"] != "a" or (chance is not None and chance < 100):
            watch.append((row(i), p["news"] or f"disponibilité {chance or 0} %"))
        elif p["share"] < 0.7:
            watch.append((row(i), "temps de jeu incertain"))
    return {
        "transfers": [(row(o), row(n), players.at[o, "ep"], players.at[n, "ep"]) for o, n in zip(outs, ins)],
        "keep": keep, "with_": with_, "hits": hits, "gain": round(with_ - HIT * hits - keep, 1),
        "captain": players.at[lu["captain"], "name"], "vice": players.at[lu["vice"], "name"],
        "watch": watch[:4],
    }


# ---------------------------------------------------------------- envoi
def build_message(sender, to, subject, html, text, unsubscribe_url):
    # lignes d'en-tête jusqu'à 998 caractères : l'adresse de désinscription reste lisible telle quelle
    msg = EmailMessage(policy=policy.SMTP.clone(max_line_length=998))
    msg["From"] = formataddr(("FPL Optimizer", sender))
    msg["To"] = to
    msg["Subject"] = subject
    # désinscription en un clic depuis la messagerie (RFC 8058)
    msg["List-Unsubscribe"] = f"<{unsubscribe_url.replace('/alertes/', '/api/alertes/')}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    return msg


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.notify")
    ap.add_argument("--data", default=os.path.join(ROOT, "web", "public", "data", "latest.json"))
    ap.add_argument("--force", action="store_true",
                    help="test : envoie maintenant, sans marquer la journée comme envoyée")
    ap.add_argument("--dry-run", metavar="DIR", help="écrit les e-mails dans DIR au lieu de les envoyer")
    ap.add_argument("--replay", help="API FPL rejouée (tests)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    meta, players = load_players(args.data)
    gw = meta["next_gw"]
    if not args.force and not due(meta.get("deadline"), datetime.now(timezone.utc)):
        log.info("J%s : date limite %s, hors de la fenêtre d'envoi.", gw, meta.get("deadline"))
        return 0

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    sender, password = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    site = os.environ.get("SITE_URL", "https://fpl-optimizer-beta.vercel.app").rstrip("/")
    if not url or not key:
        log.info("Alertes désactivées : SUPABASE_URL ou SUPABASE_SECRET_KEY manquant.")
        return 0
    store = Store(url, key)
    subs = [s for s in store.confirmed() if args.force or s.get("last_sent_gw") != gw]
    log.info("J%s : %d abonné(s) à prévenir.", gw, len(subs))
    if not subs:
        store.purge_unconfirmed()
        return 0
    if not args.dry_run and (not sender or not password):
        log.error("GMAIL_USER ou GMAIL_APP_PASSWORD manquant.")
        return 1

    client = api.FplClient(replay_dir=args.replay)
    smtp = None
    sent = failed = 0
    try:
        for sub in subs:
            try:
                team = api.entry_team(client, sub["fpl_id"])
                adv = advise(players, team)
            except Exception as e:  # une équipe en erreur ne bloque pas les autres
                log.warning("équipe %s : %s", sub["fpl_id"], e)
                failed += 1
                continue
            n = len(meta["gws"][:meta["horizon"]])
            ctx = adv | {"gw": gw, "deadline": meta.get("deadline"), "team_name": team["name"],
                         "ft": team["ft"],
                         "horizon": f"les journées {gw} à {gw + n - 1}" if n > 1 else f"la journée {gw}",
                         "app_url": f"{site}/?equipe={sub['fpl_id']}",
                         "unsubscribe_url": f"{site}/alertes/desinscrire?t={sub['token']}"}
            subject, html, text = render(ctx)
            if args.dry_run:
                os.makedirs(args.dry_run, exist_ok=True)
                with open(os.path.join(args.dry_run, f"{sub['fpl_id']}.html"), "w", encoding="utf-8") as f:
                    f.write(html)
                log.info("  %s : %s (écrit)", sub["fpl_id"], subject)
                continue
            if smtp is None:
                host, port = os.environ.get("SMTP_HOST", "smtp.gmail.com"), int(os.environ.get("SMTP_PORT", 465))
                if port == 465:
                    smtp = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30)
                else:                                  # serveur de test local, sans chiffrement
                    smtp = smtplib.SMTP(host, port, timeout=30)
                smtp.login(sender, password)
            smtp.send_message(build_message(sender, sub["email"], subject, html, text, ctx["unsubscribe_url"]))
            if not args.force:              # un test ne remplace pas l'envoi automatique
                store.mark_sent(sub["id"], gw)
            sent += 1
            log.info("  %s : %s", sub["fpl_id"], subject)
    finally:
        if smtp is not None:
            smtp.quit()
    store.purge_unconfirmed()
    log.info("Envoyés : %d, en erreur : %d", sent, failed)
    return 1 if failed and not sent else 0


if __name__ == "__main__":
    sys.exit(main())
