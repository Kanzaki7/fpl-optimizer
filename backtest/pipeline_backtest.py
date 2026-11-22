"""
Backtest du pipeline complet sur une saison que le modèle n'a jamais vue.

Les constantes du modèle ont été réglées sur 2023-24 et 2024-25
(backtest/indicators.py). Ici on rejoue 2025-26 : à la fin de plusieurs
journées, on reconstruit l'API telle qu'elle était ce jour-là
(scripts/build_replay.py), on lance le pipeline, et on compte les points que
l'équipe choisie a réellement marqués sur les 8 journées suivantes.

Deux repères, calculés sous les mêmes règles (budget, quotas, 3 par club) :
  - « les plus sélectionnés » : l'équipe qui maximise la popularité, soit le
    choix de la foule à cette date ;
  - « l'idéal a posteriori » : la meilleure équipe possible connaissant les
    résultats, plafond inatteignable qui sert d'échelle.

Simplifications, identiques pour les trois équipes : pas de transferts sur les
8 journées, pas de remplacements automatiques (seul le XI compte), capitaine
doublé. L'archive ne donne pas les blessures annoncées ; l'ordre des tireurs de
penalty est celui de fin de saison.

Usage :
    python backtest/pipeline_backtest.py --season-dir ARCHIVE/2025-26 \
        --past ARCHIVE/2024-25.csv ARCHIVE/2023-24.csv \
        --json web/public/data/pipeline_backtest.json
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import date

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from pipeline.__main__ import main as run_pipeline  # noqa: E402
from pipeline.optimize import optimize_squad  # noqa: E402


def future_points(gw, cutoff, horizon):
    fut = gw[(gw["GW"] > cutoff) & (gw["GW"] <= cutoff + horizon)]
    return fut.groupby("element")["total_points"].sum()


def score(ids, xi, captain, pts):
    return int(sum(pts.get(i, 0) for i in xi) + pts.get(captain, 0))


def benchmark(boot, values, budget):
    """Meilleure équipe selon `values` (popularité ou points réels)."""
    el = pd.DataFrame(boot["elements"]).set_index("id")
    df = pd.DataFrame({"price": el["now_cost"] / 10, "pos_id": el["element_type"],
                       "team_id": el["team"], "ep": values.reindex(el.index).fillna(0)})
    squad, xi = optimize_squad(df, budget=budget)
    captain = df.loc[xi, "ep"].idxmax()
    return squad, xi, int(captain)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season-dir", required=True)
    ap.add_argument("--past", nargs="*", default=[])
    ap.add_argument("--past-names", nargs="*", default=["2024/25", "2023/24"])
    ap.add_argument("--cutoffs", default="5,10,15,20,25,30")
    ap.add_argument("--horizon", type=int, default=8)
    ap.add_argument("--budget", type=float, default=100.0)
    ap.add_argument("--json")
    a = ap.parse_args()

    gw = pd.read_csv(os.path.join(a.season_dir, "merged_gw.csv"))
    gw = gw.drop_duplicates(["element", "fixture"])
    rows = []
    for cutoff in [int(c) for c in a.cutoffs.split(",")]:
        with tempfile.TemporaryDirectory() as tmp:
            replay, out = os.path.join(tmp, "replay"), os.path.join(tmp, "out")
            subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "build_replay.py"),
                            "--season-dir", a.season_dir, "--cutoff", str(cutoff),
                            "--out", replay, "--past", *a.past, "--past-names", *a.past_names],
                           check=True, stdout=subprocess.DEVNULL)
            code = run_pipeline(["--replay", replay, "--out", out, "--cache", tmp,
                                 "--horizon", str(a.horizon), "--budget", str(a.budget),
                                 "--overrides", "", "--no-stability", "-q"])
            if code:
                continue
            with open(os.path.join(out, "latest.json"), encoding="utf-8") as f:
                res = json.load(f)
            with open(os.path.join(replay, "bootstrap-static.json"), encoding="utf-8") as f:
                boot = json.load(f)

        pts = future_points(gw, cutoff, a.horizon)
        sq = res["squad"]
        model = score(sq["xi"] + sq["bench"], sq["xi"], sq["captain"], pts)
        own = pd.Series({e["id"]: float(e["selected_by_percent"]) for e in boot["elements"]})
        _, pxi, pcap = benchmark(boot, own, a.budget)
        _, hxi, hcap = benchmark(boot, pts.astype(float), a.budget)
        names = {p["id"]: p["name"] for p in res["players"]}
        row = {"cutoff": cutoff, "gws": f"{cutoff + 1}-{cutoff + a.horizon}",
               "model": model, "popular": score(None, pxi, pcap, pts),
               "hindsight": score(None, hxi, hcap, pts),
               "captain": names.get(sq["captain"]), "formation": sq["formation"]}
        rows.append(row)
        print(f"GW{cutoff:>2} -> GW{row['gws']:>5} : modèle {row['model']:>4}  "
              f"plus sélectionnés {row['popular']:>4}  idéal {row['hindsight']:>4}  "
              f"(capitaine {row['captain']})")

    if rows and a.json:
        tot = {k: sum(r[k] for r in rows) for k in ["model", "popular", "hindsight"]}
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"season": "2025/26", "horizon": a.horizon, "budget": a.budget,
                       "generated": date.today().isoformat(), "rows": rows, "total": tot},
                      f, ensure_ascii=False, indent=1)
        print(f"Total : modèle {tot['model']}, plus sélectionnés {tot['popular']}, "
              f"idéal {tot['hindsight']} -> {a.json}")


if __name__ == "__main__":
    main()
