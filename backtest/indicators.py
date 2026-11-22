#!/usr/bin/env python3
"""
Backtest des indicateurs — valide les constantes du modèle sur des saisons passées
==================================================================================
Le problème que ça règle : toutes les constantes du modèle (pipeline/config.py)
(poids saison courante, lissage, seuils du filtre) ont été choisies à
l'intuition. Ce script les confronte aux faits.

Méthode : on se place à la fin de la journée N d'une saison passée, on
calcule les indicateurs avec les données disponibles À CE MOMENT-LÀ, puis on
mesure la corrélation avec les points réellement marqués sur les H journées
suivantes. Aucune information du futur n'entre dans le calcul.

Données : archives par journée du dépôt vaastav/Fantasy-Premier-League
(points, minutes, xG, xA, prix — ce que l'API FPL n'expose pas pour les
saisons passées).

Usage :
    python backtest/indicators.py                      # rapport console, journée 5
    python backtest/indicators.py --cutoff 10 --horizon 8
    python backtest/indicators.py --json web/public/data/backtest.json
                                                       # journées 5, 10 et 20 -> site
    python backtest/indicators.py --data-dir DOSSIER   # CSV déjà téléchargés
"""

import argparse
import json
import os
from datetime import date

import pandas as pd
import requests

BASE = ("https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League"
        "/master/data/{season}/gws/merged_gw.csv")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache", "backtest")
DATA_DIR = None   # --data-dir : <dossier>/<saison>.csv, sans téléchargement
POS_MAP = {"GK": 1, "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4}


def load_season(season):
    """Télécharge (et met en cache) les données par journée d'une saison."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{season}.csv")
    if DATA_DIR and os.path.exists(os.path.join(DATA_DIR, f"{season}.csv")):
        path = os.path.join(DATA_DIR, f"{season}.csv")
    if not os.path.exists(path):
        print(f"  téléchargement {season}…")
        r = requests.get(BASE.format(season=season), timeout=180)
        r.raise_for_status()
        with open(path, "wb") as f:
            f.write(r.content)
    df = pd.read_csv(path)
    df["pos_id"] = df["position"].map(POS_MAP)
    return df.dropna(subset=["pos_id"])


def features_at_cutoff(df, cutoff):
    """
    Indicateurs calculés avec les seules journées 1..cutoff.
    Reproduit ceux de fpl_optimizer : taux par 90, part de minutes,
    xGI par 90, écart réel/attendu, concentration.
    """
    past = df[df["GW"] <= cutoff]
    g = past.groupby("element")

    out = pd.DataFrame({
        "name": g["name"].last(),
        "pos_id": g["pos_id"].last(),
        "price": g["value"].last() / 10,
        "minutes": g["minutes"].sum(),
        "points": g["total_points"].sum(),
        "xg": g["expected_goals"].sum(),
        "xa": g["expected_assists"].sum(),
        "xgi": g["expected_goal_involvements"].sum(),
        "games": g["GW"].count(),
        "goals": g["goals_scored"].sum(),
        "pens_missed": g["penalties_missed"].sum(),
        "bonus": g["bonus"].sum(),
    })
    out = out[out["minutes"] >= 90]

    out["pp90"] = out["points"] / out["minutes"] * 90
    out["share"] = out["minutes"] / (out["games"] * 90)
    out["xgi90"] = out["xgi"] / out["minutes"] * 90

    # ep_x simplifié : points attendus par 90 d'après le jeu produit
    goal_pts = out["pos_id"].map({1: 6, 2: 6, 3: 5, 4: 4})
    out["xpp90"] = (out["xg"] / out["minutes"] * 90 * goal_pts
                    + out["xa"] / out["minutes"] * 90 * 3 + 2)
    out["gap90"] = out["xpp90"] - out["pp90"]

    # concentration : part des points venant du meilleur match
    played = past[past["minutes"] >= 20]
    pm = played.groupby("element")["total_points"]
    tot = pm.apply(lambda s: s[s > 0].sum()).astype(float)
    out["conc"] = pm.max().astype(float) / tot.where(tot > 0)

    # Finition : buts marqués rapportés au xG accumulé. Proxy de car_fin
    # (que l'optimiseur calcule sur les saisons passées ; ici on le mesure
    # sur la fenêtre observée, même logique).
    out["fin"] = out["goals"] / out["xg"].where(out["xg"] > 0.5)

    # Tireur de penalty : approximé par la présence d'un penalty tiré
    # (marqué ou manqué) sur la fenêtre.
    pen_takers = past.groupby("element")["penalties_missed"].sum()
    out["pen_miss"] = pen_takers
    return out


def actuals_after(df, cutoff, horizon):
    """Points réellement marqués sur les `horizon` journées suivantes."""
    fut = df[(df["GW"] > cutoff) & (df["GW"] <= cutoff + horizon)]
    return fut.groupby("element")["total_points"].sum().rename("future")


def evaluate(season, cutoff, horizon, min_share=0.0):
    df = load_season(season)
    feats = features_at_cutoff(df, cutoff)
    fut = actuals_after(df, cutoff, horizon)
    d = feats.join(fut, how="inner").dropna(subset=["future"])
    if min_share:
        d = d[d["share"] >= min_share]
    if len(d) < 30:
        return None
    return d


def corr_table(d):
    """Corrélation de Spearman de chaque indicateur avec les points futurs."""
    rows = []
    for col, label in [("pp90", "points/90"),
                       ("share", "part de minutes"),
                       ("xgi90", "xGI/90"),
                       ("xpp90", "points attendus/90"),
                       ("gap90", "gap (attendu - réel)"),
                       ("conc", "concentration"),
                       ("price", "prix")]:
        s = d[col].astype(float)
        rows.append({"indicateur": label,
                     "corrélation": s.corr(d["future"], method="spearman"),
                     "n": int(s.notna().sum())})
    return pd.DataFrame(rows).sort_values("corrélation", ascending=False)


def test_blend(d, weights):
    """
    Compare des pondérations points/90 vs points attendus/90.
    w = 0   -> uniquement les points réellement marqués
    w = 1   -> uniquement le jeu produit (xG/xA)
    """
    rows = []
    for w in weights:
        blend = (1 - w) * d["pp90"] + w * d["xpp90"]
        rows.append({"poids xG": w,
                     "corrélation": blend.corr(d["future"], method="spearman")})
    return pd.DataFrame(rows)


def test_constants(d):
    """
    Teste les constantes encore non validées de l'optimiseur.
    Chacune sépare deux groupes : on compare leurs points futurs moyens.
    Si les groupes ne diffèrent pas, la constante ne sert à rien.
    """
    rows = []

    def add(label, mask, n_min=10):
        sub = d[mask.fillna(False)]
        if len(sub) >= n_min:
            rows.append({"test": label, "n": len(sub),
                         "points futurs (moy.)": sub["future"].mean()})

    # BAD_FINISHER = 0.85 : un mauvais finisseur à gros gap est-il un piège ?
    gros_gap = d["gap90"] > 1.0
    add("gap>+1 ET finition < 0.85 (écartés par BAD_FINISHER)",
        gros_gap & (d["fin"] < 0.85))
    add("gap>+1 ET finition >= 0.85 (retenus)",
        gros_gap & (d["fin"] >= 0.85))

    # Le seuil MIN_SHARE : 0.78 est-il le bon point de coupure ?
    for s in [0.60, 0.70, 0.78, 0.85, 0.92]:
        add(f"share >= {s:.2f}", d["share"] >= s)

    # PEN_BONUS n'est pas testable ici : les archives par journée ne portent
    # que penalties_missed (les ratés), pas les penalties tirés ni l'ordre des
    # tireurs. Le champ penalties_order de l'API n'existe que pour la saison
    # en cours. La constante reste donc non validée, faute de données.

    return pd.DataFrame(rows)


def test_fixtures(df, cutoff, horizon):
    """
    Facteur calendrier (7.5 % par point de FDR dans l'optimiseur).
    Difficulté approximée par les buts encaissés par l'adversaire sur les
    journées déjà jouées : plus l'adversaire encaisse, plus le match est
    favorable. On compare ensuite les points futurs par quartile de facilité.
    """
    past = df[df["GW"] <= cutoff]
    # buts encaissés par équipe et par match sur la fenêtre observée
    conceded = (past.groupby(["team", "GW"])["goals_conceded"].max()
                .groupby("team").mean())

    fut = df[(df["GW"] > cutoff) & (df["GW"] <= cutoff + horizon)].copy()
    # opponent_team est un identifiant numérique : on le relie au nom d'équipe
    ids = (past[["team", "opponent_team"]].drop_duplicates())
    name_by_id = {}
    for t in past["team"].unique():
        rows_t = past[past["team"] == t]
        for oid in rows_t["opponent_team"].unique():
            name_by_id.setdefault(oid, None)
    # reconstruction : l'équipe d'id N est celle que les autres affrontent
    # le même jour ; on passe par la table des rencontres
    pairs = past[["fixture", "team"]].drop_duplicates()
    fix_teams = pairs.groupby("fixture")["team"].apply(list)
    id_map = {}
    for fx, teams in fix_teams.items():
        if len(teams) != 2:
            continue
        sub = past[past["fixture"] == fx][["team", "opponent_team"]].drop_duplicates()
        for _, r in sub.iterrows():
            other = [t for t in teams if t != r["team"]]
            if other:
                id_map[r["opponent_team"]] = other[0]

    fut["opp_name"] = fut["opponent_team"].map(id_map)
    fut["ease"] = fut["opp_name"].map(conceded)
    ease = fut.groupby("element")["ease"].mean()
    pts = fut.groupby("element")["total_points"].sum()
    d = pd.DataFrame({"ease": ease, "future": pts}).dropna()
    if len(d) < 50:
        return None, float("nan")
    d["quartile"] = pd.qcut(d["ease"], 4, labels=["difficile", "plutôt dur",
                                                  "plutôt facile", "facile"])
    tab = (d.groupby("quartile", observed=True)["future"]
           .agg(["mean", "count"]).rename(columns={"mean": "points futurs",
                                                   "count": "n"}))
    return tab.reset_index(), d["ease"].corr(d["future"], method="spearman")


def test_bench_weight(d, horizon):
    """
    bench_weight (0,25 dans le modèle) : quelle part des points d'une équipe vient du banc ?
    Approximation : sur les joueurs retenus, quel écart entre le 11e et les
    quatre suivants, classés par points futurs.
    """
    s = d.sort_values("future", ascending=False)
    xi = s.head(11)["future"].sum()
    banc = s.iloc[11:15]["future"].sum()
    return pd.DataFrame([{"points XI (top 11)": xi, "points banc (12-15)": banc,
                          "ratio banc/XI": banc / xi if xi else float("nan")}])


def test_filters(d):
    """Mesure ce que rapportent réellement les joueurs que le filtre écarte."""
    rows = []
    for label, mask in [
        ("share < 0.78 (écartés : minutes)", d["share"] < 0.78),
        ("share >= 0.78 (retenus)", d["share"] >= 0.78),
        ("gap90 < -1.0, MID/FWD (écartés : surchauffe)",
         (d["gap90"] < -1.0) & d["pos_id"].isin([3, 4])),
        ("gap90 >= -1.0, MID/FWD (retenus)",
         (d["gap90"] >= -1.0) & d["pos_id"].isin([3, 4])),
        ("conc > 0.60 (production concentrée)", d["conc"] > 0.60),
        ("conc <= 0.60 (régulière)", d["conc"] <= 0.60),
    ]:
        sub = d[mask.fillna(False)]
        if len(sub) >= 10:
            rows.append({"groupe": label, "n": len(sub),
                         "points futurs (moy.)": sub["future"].mean()})
    return pd.DataFrame(rows)


def summary_json(seasons, cutoffs, horizon):
    """Résultats structurés pour la page Méthode du site."""
    out = {"seasons": seasons, "cutoffs": cutoffs, "horizon": horizon,
           "generated": date.today().isoformat(), "indicators": [], "blend": [],
           "filters": [], "share_thresholds": [], "fixtures": [], "bench": []}
    for c in cutoffs:
        parts = [evaluate(s, c, horizon) for s in seasons]
        parts = [p for p in parts if p is not None]
        if not parts:
            continue
        d = pd.concat(parts)
        for r in corr_table(d).to_dict("records"):
            out["indicators"].append({"cutoff": c, "label": r["indicateur"],
                                      "corr": round(r["corrélation"], 3), "n": r["n"]})
        for r in test_blend(d, [0.0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]).to_dict("records"):
            out["blend"].append({"cutoff": c, "w": r["poids xG"],
                                 "corr": round(r["corrélation"], 3)})
        for r in test_filters(d).to_dict("records"):
            out["filters"].append({"cutoff": c, "label": r["groupe"], "n": r["n"],
                                   "future": round(r["points futurs (moy.)"], 1)})
        for r in test_constants(d).to_dict("records"):
            if r["test"].startswith("share"):
                out["share_thresholds"].append({"cutoff": c, "label": r["test"], "n": r["n"],
                                                "future": round(r["points futurs (moy.)"], 1)})
        b = test_bench_weight(d, horizon).iloc[0]
        out["bench"].append({"cutoff": c, "ratio": round(b["ratio banc/XI"], 3)})
        for s in seasons:
            _, corr = test_fixtures(load_season(s), c, horizon)
            if corr == corr:
                out["fixtures"].append({"cutoff": c, "season": s, "corr": round(corr, 3)})
    return out


def main():
    global DATA_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", default="2023-24,2024-25")
    ap.add_argument("--cutoff", type=int, default=5,
                    help="journée à laquelle on se place (défaut : 5)")
    ap.add_argument("--horizon", type=int, default=8,
                    help="journées suivantes à prédire (défaut : 8)")
    ap.add_argument("--data-dir", help="dossier contenant <saison>.csv (merged_gw)")
    ap.add_argument("--json", help="écrit les résultats des journées 5, 10 et 20 en JSON")
    args = ap.parse_args()
    DATA_DIR = args.data_dir

    seasons = [s.strip() for s in args.seasons.split(",") if s.strip()]
    if args.json:
        res = summary_json(seasons, [5, 10, 20], args.horizon)
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
        print(f"Résultats écrits dans {args.json}")
        return

    print(f"Backtest : prédiction des GW{args.cutoff + 1}-"
          f"{args.cutoff + args.horizon} à partir des GW1-{args.cutoff}\n")

    parts = []
    for s in seasons:
        d = evaluate(s, args.cutoff, args.horizon)
        if d is None:
            print(f"  {s} : données insuffisantes")
            continue
        d = d.assign(season=s)
        parts.append(d)
        print(f"  {s} : {len(d)} joueurs")
    if not parts:
        return
    allp = pd.concat(parts)

    print("\n=== POUVOIR PRÉDICTIF DE CHAQUE INDICATEUR ===")
    print("(Spearman avec les points futurs ; 0 = aucun lien, 1 = parfait)")
    print(corr_table(allp).to_string(index=False,
                                     float_format=lambda x: f"{x:.3f}"))

    print("\n=== MÉLANGE POINTS RÉELS / JEU PRODUIT ===")
    print("Quel poids donner au xG plutôt qu'aux points déjà marqués ?")
    print(test_blend(allp, [0.0, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0])
          .to_string(index=False, float_format=lambda x: f"{x:.3f}"))

    print("\n=== CE QUE RAPPORTENT LES GROUPES FILTRÉS ===")
    print(test_filters(allp).to_string(index=False,
                                       float_format=lambda x: f"{x:.1f}"))

    print("\n=== CONSTANTES ENCORE NON VALIDÉES ===")
    print(test_constants(allp).to_string(index=False,
                                         float_format=lambda x: f"{x:.1f}"))

    print("\n=== FACTEUR CALENDRIER ===")
    print("Difficulté = buts encaissés par les adversaires à venir")
    for s in seasons:
        tab, c = test_fixtures(load_season(s), args.cutoff, args.horizon)
        if tab is not None:
            print(f"  {s} (corrélation facilité/points : {c:+.3f})")
            print(tab.to_string(index=False, float_format=lambda x: f"{x:.1f}"))

    print("\n=== POIDS DU BANC ===")
    print(test_bench_weight(allp, args.horizon)
          .to_string(index=False, float_format=lambda x: f"{x:.2f}"))

    print("\n=== STABILITÉ SELON L'HORIZON ===")
    for h in [4, 6, 8, 12]:
        sub = [evaluate(s, args.cutoff, h) for s in seasons]
        sub = pd.concat([x for x in sub if x is not None])
        c_pp = sub["pp90"].corr(sub["future"], method="spearman")
        c_xp = sub["xpp90"].corr(sub["future"], method="spearman")
        c_sh = sub["share"].corr(sub["future"], method="spearman")
        print(f"  horizon {h:2d} GW : points/90 {c_pp:.3f} | "
              f"attendu/90 {c_xp:.3f} | minutes {c_sh:.3f}")


if __name__ == "__main__":
    main()
