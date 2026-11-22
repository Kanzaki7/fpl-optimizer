"""
Point d'entrée : python -m pipeline [options]

Exemples
    python -m pipeline                               # API officielle, export dans web/public/data
    python -m pipeline --replay .replay --out /tmp/x  # données locales (tests)
    python -m pipeline --db fpl.sqlite               # garde la base pour l'explorer
"""

import argparse
import logging
import os
import sys
import time

import pandas as pd

from . import api, db, export, model, optimize
from .config import (DEFAULT_BUDGET, DEFAULT_HORIZON, MIN_PAST_MINUTES,
                     STABILITY_HORIZONS)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log = logging.getLogger("pipeline")


def parse_ids(s):
    return [int(x) for x in (s or "").split(",") if x.strip()]


def load_overrides(path):
    """overrides.csv : player_id,minute_share (0 écarte un joueur)."""
    if not path or not os.path.exists(path):
        return {}
    ov = pd.read_csv(path, comment="#")
    return dict(zip(ov["player_id"].astype(int), ov["minute_share"].astype(float)))


def run(args):
    t0 = time.time()
    client = api.FplClient(replay_dir=args.replay, workers=args.workers)

    # 1. Collecte
    boot = client.bootstrap()
    fixtures = client.fixtures()
    events = boot.get("events", [])
    season = api.season_of(events)
    next_gw, gw_flag = model.next_gameweek(events, fixtures)
    cache_dir = args.cache if not args.replay else os.path.join(args.cache, "replay")
    elements = [e for e in boot["elements"] if e.get("status") != "u"]
    past = api.history_past(client, elements, season, cache_dir)
    gw_stats = api.gameweek_stats(client, events, season, cache_dir)
    log.info("Collecte : %d requête(s) en %.1f s", client.calls, time.time() - t0)

    # 2. Stockage et variables SQL
    con = db.connect()
    db.load(con, boot, fixtures, gw_stats, past)
    if args.db:
        db.save_copy(con, args.db)
        log.info("Base SQLite écrite : %s", args.db)

    # 3. Modèle
    feats, info = model.build_features(con, gw_flag, args.min_minutes,
                                       args.current_weight, load_overrides(args.overrides))
    teams = db.query(con, "SELECT * FROM teams").set_index("id")
    ctx = model.fixture_context(con, teams, next_gw, args.horizon)
    df = model.expected_points(feats, ctx)
    pool, motifs = model.judgment_pool(df)
    log.info("%d GW jouée(s), poids saison en cours %.0f %% (taux) / %.0f %% (minutes)",
             info["gw_played"], info["w_rate"] * 100, info["w_share"] * 100)
    log.info("%d joueurs évalués, %d dans le pool d'optimisation", len(df), len(pool))

    # 4. Optimisation, puis stabilité selon l'horizon
    force, exclude = parse_ids(args.force), parse_ids(args.exclude)
    squad_ids, xi_ids = optimize.optimize_squad(pool, args.budget, force=force, exclude=exclude)
    lineup = optimize.lineup(pool, squad_ids, xi_ids, args.budget)

    stability = {}
    if not args.no_stability:
        for h in STABILITY_HORIZONS:
            c = model.fixture_context(con, teams, next_gw, h)
            p, _ = model.judgment_pool(model.expected_points(feats, c))
            try:
                ids, _ = optimize.optimize_squad(p, args.budget, force=force, exclude=exclude)
            except optimize.InfeasibleSquad as e:
                log.warning("horizon %d : %s", h, e)
                continue
            for i in ids:
                stability.setdefault(int(i), []).append(h)

    # 5. Export
    meta = {"season": season, "next_gw": next_gw, "gw_played": info["gw_played"],
            "horizon": args.horizon, "budget": args.budget,
            "w_rate": round(info["w_rate"], 2), "w_share": round(info["w_share"], 2),
            "stability_horizons": list(STABILITY_HORIZONS),
            "source": "replay" if args.replay else "api", "api_calls": client.calls}
    payload = export.build_payload(df, pool, motifs, lineup, stability, ctx,
                                   db.next_fixtures(con, 5), db.gw_history(con), teams, meta)
    export.write(payload, df, pool, motifs, stability, args.out)

    report(pool, lineup, args)
    log.info("Export : %s (%.1f s au total)", args.out, time.time() - t0)
    return payload


def report(pool, lineup, args):
    names = pool["name"].to_dict()
    sq = pool.loc[lineup["xi"] + lineup["bench"]]
    print(f"\n=== ÉQUIPE ({args.horizon} prochaines journées) — {lineup['formation']} ===")
    for pos in ["GK", "DEF", "MID", "FWD"]:
        grp = sq[sq["pos"] == pos]
        xi = [f"{n} ({e:.1f})" for i, n, e in zip(grp.index, grp["name"], grp["ep"])
              if i in lineup["xi"]]
        bench = [n for i, n in zip(grp.index, grp["name"]) if i not in lineup["xi"]]
        print(f"  {pos:4s} {', '.join(xi)}" + (f"  [banc : {', '.join(bench)}]" if bench else ""))
    print(f"  Capitaine {names[lineup['captain']]}, vice {names[lineup['vice']]}")
    print(f"  Coût {lineup['cost']:.1f} m, banque {lineup['bank']:.1f} m, "
          f"EP du XI (capitaine doublé) {lineup['ep_xi']:.1f}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "data"))
    ap.add_argument("--cache", default=os.path.join(ROOT, "data", "cache"))
    ap.add_argument("--replay", help="dossier imitant l'API (scripts/build_replay.py)")
    ap.add_argument("--db", help="écrit aussi la base SQLite dans ce fichier")
    ap.add_argument("--horizon", type=int, default=DEFAULT_HORIZON)
    ap.add_argument("--budget", type=float, default=DEFAULT_BUDGET)
    ap.add_argument("--min-minutes", type=int, default=MIN_PAST_MINUTES)
    ap.add_argument("--current-weight", type=float, default=None)
    ap.add_argument("--overrides", default=os.path.join(ROOT, "overrides.csv"))
    ap.add_argument("--force", default="", help="ids imposés, ex. 430,449")
    ap.add_argument("--exclude", default="", help="ids interdits")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--no-stability", action="store_true")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING if args.quiet else logging.INFO,
                        format="%(message)s")
    try:
        run(args)
    except (api.FplApiError, optimize.InfeasibleSquad) as e:
        log.error("Échec : %s", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
