"""
Export des résultats : un JSON lu par le site (web/) et le CSV complet.
"""

import json
import math
import os
from datetime import datetime, timezone

import pandas as pd

from . import __version__
from .config import (BAD_FINISHER, BENCH_WEIGHT, CONC_SHRINK, MIN_SHARE,
                     MISLEADING_GAP, REGRESSION_BLEND, SEASON_WEIGHTS)

CSV_COLUMNS = ["name", "team", "pos", "price", "ep", "ep_opt", "ep_x", "gap", "share",
               "cur_minutes", "games_played", "conc", "xgi90", "xg", "xa", "goals",
               "assists", "car_fin", "luck_g", "luck_a", "own", "net_tr", "pen_order",
               "new_player", "status", "chance_next", "news", "in_pool", "motif",
               "robust"]


def _num(v, nd=2):
    if v is None or (isinstance(v, float) and math.isnan(v)) or pd.isna(v):
        return None
    if isinstance(v, (bool,)):
        return v
    return round(float(v), nd)


def pepites(df):
    """Titulaires qui créent beaucoup sans être en surchauffe, triés par valeur xG."""
    p = df[(df["share"] >= 0.80) & (df["cur_minutes"] >= 270) & (df["xgi90"] >= 0.40)
           & (df["gap"] >= -3) & (df["pos_id"] != 1)]
    return set(p.nlargest(12, "val_x").index)


def build_payload(df, pool, motifs, lineup, stability, ctx, per_gw, fixtures_next,
                  gw_hist, teams, meta, roster):
    nxt = {tid: [[int(r.gw), r.opp, int(r.home), int(r.fdr)] for r in part.itertuples()]
           for tid, part in fixtures_next.groupby("team_id")}
    hist = {pid: [[int(r.gw), int(r.total_points), int(r.minutes)] for r in part.itertuples()]
            for pid, part in gw_hist.groupby("player_id")}
    pep = pepites(df)

    players = []
    for pid, r in df.sort_values("ep", ascending=False).iterrows():
        players.append({
            "id": int(pid), "code": int(r["code"]), "name": r["name"],
            "full_name": r["full_name"], "team": r["team"], "team_id": int(r["team_id"]),
            "pos": r["pos"], "price": _num(r["price"], 1),
            "ep": _num(r["ep"], 1),
            "ep_opt": _num(pool.at[pid, "ep"], 1) if pid in pool.index else None,
            "ep_x": _num(r["ep_x"], 1), "gap": _num(r["gap"], 1),
            "ep_gw": _num(r["ep_gw"], 2), "value": _num(r["ep"] / r["price"], 2),
            "share": _num(r["share"], 2), "minutes": int(r["cur_minutes"]),
            "games": int(r["games_played"]), "conc": _num(r["conc"], 2),
            "xgi90": _num(r["xgi90"], 2), "xg": _num(r["xg"], 2), "xa": _num(r["xa"], 2),
            "goals": int(r["goals"]), "assists": int(r["assists"]),
            "points": int(r["total_points"] or 0),
            "car_fin": _num(r["car_fin"], 2), "luck_g": _num(r["luck_g"], 2),
            "own": _num(r["own"], 1), "net_tr": int(r["net_tr"] or 0),
            "pen": int(r["pen_order"]) if pd.notna(r["pen_order"]) else None,
            "new": bool(r["new_player"]), "status": r["status"],
            "chance": int(r["chance_next"]) if pd.notna(r["chance_next"]) else None,
            "news": r["news"] or "",
            "motif": motifs.get(pid) or None,
            "pool": pid in pool.index,
            # valeur d'optimisation par journée (meta.gws) : le site additionne
            "g": [round(float(v), 2) for v in per_gw.loc[pid]],
            "pepite": pid in pep,
            "robust": stability.get(pid, []),
            "next": nxt.get(int(r["team_id"]), []),
            "hist": hist.get(pid, []),
        })

    team_rows = []
    for tid, t in teams.iterrows():
        c = ctx.loc[tid]
        team_rows.append({"id": int(tid), "short": t["short_name"], "name": t["name"],
                          "n_games": int(c["n_games"]), "fdr": _num(c["avg_fdr"], 2),
                          "cs_prob": _num(c["cs_prob"], 3), "next": nxt.get(int(tid), [])})

    # Joueurs non évalués (blessés longue durée, partis, sans temps de jeu) :
    # le site en a besoin pour afficher une équipe importée qui en contient.
    others = [[int(i), r["name"], r["team"], int(r["team_id"]), r["pos"], _num(r["price"], 1), r["status"]]
              for i, r in roster.drop(index=df.index, errors="ignore").iterrows()]

    return {
        "others": others,
        "meta": {
            **meta,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "version": __version__,
            "n_players": len(df), "n_pool": len(pool),
            "params": {"min_share": MIN_SHARE, "regression_blend": REGRESSION_BLEND,
                       "bench_weight": BENCH_WEIGHT, "conc_shrink": CONC_SHRINK,
                       "bad_finisher": BAD_FINISHER, "misleading_gap": MISLEADING_GAP,
                       "season_weights": SEASON_WEIGHTS},
        },
        "squad": lineup,
        "teams": team_rows,
        "players": players,
    }


def write(payload, df, pool, motifs, stability, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(out_dir, "latest.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, os.path.join(out_dir, "latest.json"))

    csv = df.copy()
    csv["ep_opt"] = pool["ep"].reindex(csv.index)
    csv["in_pool"] = csv.index.isin(pool.index)
    csv["motif"] = motifs.reindex(csv.index).fillna("")
    csv["robust"] = ["/".join(map(str, stability.get(i, []))) for i in csv.index]
    csv = csv.sort_values("ep", ascending=False)[CSV_COLUMNS]
    csv.to_csv(os.path.join(out_dir, "fpl_expected_points.csv"),
               float_format="%.3f", index_label="id")
