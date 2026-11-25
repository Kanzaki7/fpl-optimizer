"""
Les saisons passées prédisent-elles la saison en cours ?

Compare, pour les joueurs déjà en Premier League la saison dernière, leurs
points des saisons passées et leurs points de la saison en cours (journées
terminées, lues dans le cache du pipeline). Mesure aussi, à l'intérieur de la
saison, ce qui prédit le mieux la deuxième moitié des journées jouées : les
saisons passées, la première moitié, ou un mélange des deux.

Usage :
    python backtest/history_vs_current.py
"""

import glob
import json
import os

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEIGHTS = [0.6, 0.3, 0.1]


def load():
    hist = json.load(open(os.path.join(ROOT, "data", "cache", "history_past.json"), encoding="utf-8"))
    data = json.load(open(os.path.join(ROOT, "web", "public", "data", "latest.json"), encoding="utf-8"))
    season = hist["season"].replace("/", "-")
    rows = []
    for f in glob.glob(os.path.join(ROOT, "data", "cache", "live", season, "*.json")):
        gw = int(os.path.basename(f)[:-5])
        rows += [{"id": r[0], "gw": gw, "min": r[1], "pts": r[2]} for r in json.load(open(f))]
    gws = pd.DataFrame(rows)
    players = pd.DataFrame([{"id": p["id"], "code": p["code"], "name": p["name"], "pos": p["pos"]}
                            for p in data["players"]]).set_index("id")
    return hist["players"], gws, players


def past_features(seasons):
    """Saison dernière (points, minutes, points/90) et taux pondéré sur 3 saisons."""
    seasons = sorted(seasons, key=lambda s: s["season_name"], reverse=True)
    last = seasons[0] if seasons else None
    usable = [s for s in seasons if (s.get("minutes") or 0) >= 400][:3]
    w = sum(WEIGHTS[: len(usable)])
    rate3 = (sum(WW * s["total_points"] / s["minutes"] * 90 for WW, s in zip(WEIGHTS, usable)) / w) if usable else None
    return {
        "last_pts": last["total_points"] if last else 0,
        "last_min": last["minutes"] if last else 0,
        "last_p90": last["total_points"] / last["minutes"] * 90 if last and last["minutes"] >= 400 else None,
        "rate3": rate3,
    }


def spearman(a, b):
    return a.corr(b, method="spearman")


def main():
    hist, gws, players = load()
    played = sorted(gws["gw"].unique())
    half = played[len(played) // 2 - 1]                 # 1-5 / 6-11 pour 11 journées
    cur = gws.groupby("id").agg(pts=("pts", "sum"), mins=("min", "sum"))
    first = gws[gws.gw <= half].groupby("id").agg(p1=("pts", "sum"), m1=("min", "sum"))
    second = gws[gws.gw > half].groupby("id").agg(p2=("pts", "sum"), m2=("min", "sum"))
    df = players.join(cur).join(first).join(second)
    past = pd.DataFrame([past_features(hist.get(str(c), [])) for c in df["code"]], index=df.index)
    df = df.join(past)
    df = df[df["last_min"] > 0]                          # déjà en PL la saison dernière

    print(f"Saison en cours : journées {played[0]} à {played[-1]} · {len(df)} joueurs présents la saison dernière\n")

    # 1. Totaux : qui a marqué le plus de points
    print("1. POINTS TOTAUX (ceux qui marquent le plus)")
    print(f"   points saison dernière -> points cette saison : {spearman(df['last_pts'], df['pts']):.2f}")
    top = df.nlargest(20, "pts")
    was_top = df.nlargest(20, "last_pts").index
    print(f"   sur les 20 meilleurs actuels, {top.index.isin(was_top).sum()} étaient dans les 20 meilleurs de la saison dernière")
    print(f"   et {top.index.isin(df.nlargest(50, 'last_pts').index).sum()} dans les 50 meilleurs")

    # 2. Rendement par 90 minutes, chez les joueurs qui ont joué
    reg = df[(df["last_min"] >= 900) & (df["mins"] >= 450)].copy()
    reg["p90"] = reg["pts"] / reg["mins"] * 90
    print(f"\n2. POINTS PAR 90 MINUTES (titulaires réguliers, n = {len(reg)})")
    print(f"   saison dernière -> cette saison   : {spearman(reg['last_p90'], reg['p90']):.2f}")
    print(f"   3 saisons pondérées -> cette saison : {spearman(reg['rate3'], reg['p90']):.2f}")
    for pos in ["GK", "DEF", "MID", "FWD"]:
        s = reg[reg["pos"] == pos]
        if len(s) >= 15:
            print(f"     {pos:3s} (n = {len(s):3d}) : {spearman(s['rate3'], s['p90']):.2f}")

    # 3. Dans la saison : prédire la deuxième moitié
    both = df[(df["m1"] >= 270) & (df["m2"] >= 270) & df["rate3"].notna()].copy()
    both["r1"] = both["p1"] / both["m1"] * 90
    both["r2"] = both["p2"] / both["m2"] * 90
    print(f"\n3. PRÉDIRE LES JOURNÉES {half + 1}-{played[-1]} (points par 90 min, n = {len(both)})")
    print(f"   saisons passées seules          : {spearman(both['rate3'], both['r2']):.2f}")
    print(f"   journées 1-{half} seules            : {spearman(both['r1'], both['r2']):.2f}")
    best = (0, -1)
    for w in [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]:
        c = spearman((1 - w) * both["rate3"] + w * both["r1"], both["r2"])
        best = max(best, (c, w))
        print(f"   mélange, {int(w * 100):3d} % saison en cours : {c:.2f}")
    print(f"   -> meilleur mélange : {int(best[1] * 100)} % de saison en cours "
          f"(le modèle en met {int(min(0.70, 0.08 * half) * 100)} % après {half} journées)")


if __name__ == "__main__":
    main()
