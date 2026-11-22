"""
Modèle de points attendus (EP) sur les N prochaines journées.

  EP = taux de points par 90 min × part de minutes × facteur calendrier × matchs
       + probabilité de clean sheet × points de clean sheet × part de minutes

Les taux mélangent saisons passées (pondérées 0,6 / 0,3 / 0,1) et saison en
cours, dont le poids grandit avec les journées jouées. Les variables de base
sont calculées en SQL (db.py) ; ce module applique les mélanges, les lissages
et le calcul d'EP.
"""

import numpy as np
import pandas as pd

from . import db
from .config import (APPEARANCE_PTS, ASSIST_PTS, BAD_FINISHER, CONC_SHRINK,
                     CS_BASE, CS_MAX, CS_MIN, CS_POINTS, CS_SLOPE, FDR_COEF,
                     GOAL_PTS, MIN_CURRENT_MINUTES, MIN_PAST_MINUTES, MIN_SHARE,
                     MISLEADING_GAP, PEN_BONUS, POS_NAME, RATE_WEIGHT_MAX,
                     RATE_WEIGHT_PER_GW, REGRESSION_BLEND, SHARE_WEIGHT_MAX,
                     SHARE_WEIGHT_PER_GW, SHRINK_MINUTES)


def next_gameweek(events, fixtures):
    """
    Prochaine journée non jouée et nombre de journées terminées. Les drapeaux
    officiels de bootstrap (is_next, finished) font foi ; les fixtures ne
    servent qu'en repli.
    """
    if events:
        played = sum(1 for e in events if e.get("finished"))
        nxt = next((e["id"] for e in events if e.get("is_next")), None)
        if nxt is None:
            nxt = next((e["id"] for e in events if not e.get("finished")), None)
        if nxt is not None:
            return nxt, played
    upcoming = [f.get("event") for f in fixtures
                if not f.get("finished") and f.get("event") is not None]
    nxt = min(upcoming) if upcoming else 1
    return nxt, max(0, nxt - 1)


def blend_weights(gw_played):
    """Poids de la saison en cours : (taux, minutes)."""
    return (min(RATE_WEIGHT_MAX, RATE_WEIGHT_PER_GW * gw_played),
            min(SHARE_WEIGHT_MAX, SHARE_WEIGHT_PER_GW * gw_played))


def build_features(con, gw_flag, min_minutes=MIN_PAST_MINUTES,
                   current_weight=None, overrides=None):
    """
    Variables par joueur, indépendantes de l'horizon : taux par 90 min, part
    de minutes, indicateurs xG. Renvoie (df, info).
    """
    overrides = overrides or {}
    f = db.player_features(con)

    gw_played = int(max(f["team_games"].max(skipna=True) or 0, gw_flag))
    w_rate, w_share = blend_weights(gw_played)
    if current_weight is not None:
        w_rate = max(0.0, min(1.0, current_weight))

    has_cur_rows = f["team_games"].notna() & (f["team_games"] > 0)
    has_past = f["last_minutes"].fillna(0) >= min_minutes
    has_cur = has_cur_rows & (f["cur_minutes"] >= MIN_CURRENT_MINUTES)
    f = f[has_past | has_cur].copy()
    has_past, has_cur_rows = has_past[f.index], has_cur_rows[f.index]

    # --- Taux par 90 min de la saison en cours (fiables dès 90 minutes)
    m = f["cur_minutes"].astype(float)
    cur_ok = m >= 90
    cur_non_cs = ((f["cur_points"] - 4 * f["cur_cs"]) / m * 90).where(cur_ok)
    cur_cs90 = (f["cur_cs"] / m * 90).where(cur_ok)
    f["conc"] = f["conc"].where(cur_ok)
    f["games_played"] = f["games_played"].where(cur_ok, 0)

    # --- Mélange passé / présent
    blend = has_past & cur_ok
    f["non_cs_pp90"] = np.select(
        [blend, has_past],
        [(1 - w_rate) * f["past_non_cs_pp90"] + w_rate * cur_non_cs, f["past_non_cs_pp90"]],
        default=cur_non_cs)
    f["cs_per90"] = np.select(
        [blend, has_past],
        [(1 - w_rate) * f["past_cs_per90"] + w_rate * cur_cs90, f["past_cs_per90"]],
        default=cur_cs90)

    # --- Part de minutes projetée
    share_past = (f["last_minutes"] / (38 * 90) * 1.10).clip(upper=1.0).where(has_past)
    share_cur = (m / (f["team_games"] * 90)).where(has_cur_rows)
    both = share_past.notna() & share_cur.notna()
    share = share_cur.fillna(share_past)
    share[both] = (1 - w_share) * share_past[both] + w_share * share_cur[both]
    share = share.clip(upper=1.0)
    chance = f["chance_next"]
    share = share.where(chance.isna(), share * chance / 100.0)
    for pid, val in overrides.items():
        if pid in share.index:
            share[pid] = float(val)
    f["share"] = share
    f["new_player"] = ~has_past
    f["pos"] = f["pos_id"].map(POS_NAME)

    # --- Nouveaux venus : lissage vers la médiane de leur poste
    priors = f.loc[~f["new_player"]].groupby("pos_id")["non_cs_pp90"].median()
    new = f["new_player"]
    conf = m[new] / (m[new] + SHRINK_MINUTES)
    prior = f.loc[new, "pos_id"].map(priors).fillna(f.loc[new, "non_cs_pp90"])
    f.loc[new, "non_cs_pp90"] = conf * f.loc[new, "non_cs_pp90"] + (1 - conf) * prior

    # --- Gardiens : le plus cher de chaque club, sauf titulaire réel ou override
    gk = f[f["pos_id"] == 1]
    keep = set(gk.sort_values("price", ascending=False).groupby("team_id").head(1).index)
    keep |= set(gk.index[gk["share"] >= 0.5])
    keep |= {i for i, v in overrides.items() if v and v > 0}
    f = f[(f["pos_id"] != 1) | f.index.isin(keep)].copy()

    # --- Production réelle vs attendue (saison en cours)
    m = f["cur_minutes"].clip(lower=1)
    enough = f["cur_minutes"] >= 90
    f["xgi90"] = (f["xgi"] / m * 90).where(enough)
    f["xg90"] = (f["xg"] / m * 90).where(enough, 0.0)
    f["xa90"] = (f["xa"] / m * 90).where(enough, 0.0)
    f["luck_g"] = ((f["goals"] - f["xg"] * f["team_conv"]) / m * 90).where(enough)
    f["luck_a"] = ((f["assists"] - f["xa"] * f["team_conv"]) / m * 90).where(enough)
    f["car_fin"] = f["car_goals"] / f["car_xg"].replace(0, np.nan)

    # --- Décote d'une production concentrée sur un seul match
    g = f["games_played"].clip(lower=1)
    ref = 1.0 / g
    excess = ((f["conc"] - ref) / (1 - ref).clip(lower=0.01)).clip(0.0, 1.0)
    f["conf"] = (1.0 - CONC_SHRINK * excess).fillna(1.0)
    med = f.groupby("pos_id")["non_cs_pp90"].transform("median")
    f["non_cs_pp90"] = f["conf"] * f["non_cs_pp90"] + (1 - f["conf"]) * med

    info = {"gw_played": gw_played, "w_rate": w_rate, "w_share": w_share}
    return f, info


def fixture_context(con, teams_df, next_gw, horizon):
    """Facteur calendrier, nombre de matchs et probabilité de clean sheet par équipe."""
    run = db.fixture_run(con, next_gw, horizon)
    factor = 1.0 + (3.0 - run["avg_fdr"]) * FDR_COEF
    strength = (teams_df["strength_defence_home"] + teams_df["strength_defence_away"]) / 2
    cs = (CS_BASE + (strength - strength.mean()) / 100 * CS_SLOPE) * factor
    return pd.DataFrame({"factor": factor, "n_games": run["n_games"],
                         "avg_fdr": run["avg_fdr"], "cs_prob": cs.clip(CS_MIN, CS_MAX)})


def pen_bonus(pen_order):
    return pen_order.map(lambda p: PEN_BONUS.get(int(p), 0.0) if pd.notna(p) else 0.0)


def expected_points(f, ctx):
    """
    Ajoute ep (fondé sur les points marqués), ep_x (fondé sur le xG/xA
    produit), gap = ep_x - ep, et la valeur par million.
    """
    f = f.copy()
    t = ctx.loc[f["team_id"]].set_index(f.index)
    cs_pts = f["pos_id"].map(CS_POINTS)
    pen = pen_bonus(f["pen_order"])
    cs_part = t["cs_prob"] * cs_pts * f["share"]

    non_cs = f["non_cs_pp90"] + np.where(f["pos_id"] == 3, f["cs_per90"] * 3, 0.0) + pen
    f["ep"] = (non_cs * f["share"] * t["factor"] + cs_part) * t["n_games"]

    att = f["xg90"] * f["pos_id"].map(GOAL_PTS) + f["xa90"] * ASSIST_PTS + pen
    ep_x = ((att + APPEARANCE_PTS) * f["share"] * t["factor"] + cs_part) * t["n_games"]
    f["ep_x"] = ep_x.where(f["xgi90"].notna())
    f["gap"] = f["ep_x"] - f["ep"]
    f["val_x"] = f["ep_x"] / f["price"]
    f["ep_gw"] = f["ep"] / t["n_games"].replace(0, np.nan)
    f = f.dropna(subset=["ep"])
    return f[f["ep"] > 0]


def _blend(pos_id, ep, ep_x, gap):
    """Valeur d'optimisation : EP tiré vers le jeu produit (voir judgment_pool)."""
    has_x = ep_x.notna()
    adj = (pos_id.isin([3, 4]) & has_x) | ((pos_id == 2) & has_x & (gap > 0))
    out = ep.copy()
    out[adj] = (1 - REGRESSION_BLEND) * ep[adj] + REGRESSION_BLEND * ep_x[adj]
    return out


def gameweek_points(con, f, teams_df, first, n):
    """
    Valeur d'optimisation de chaque joueur, journée par journée, de `first` à
    `first + n - 1`. Le site additionne ces colonnes pour la période choisie
    par l'utilisateur et relance le solveur dans le navigateur.

    Même modèle que expected_points, mais match par match : chaque rencontre
    a son propre facteur de difficulté et sa probabilité de clean sheet. Une
    journée sans match vaut 0, une double journée compte deux matchs.
    """
    gws = list(range(first, first + n))
    fx = db.gw_fixtures(con, first, first + n - 1)
    strength = (teams_df["strength_defence_home"] + teams_df["strength_defence_away"]) / 2
    base_cs = CS_BASE + (strength - strength.mean()) / 100 * CS_SLOPE
    fx["factor"] = 1.0 + (3.0 - fx["fdr"]) * FDR_COEF
    fx["cs"] = (fx["team_id"].map(base_cs) * fx["factor"]).clip(CS_MIN, CS_MAX)
    grid = pd.MultiIndex.from_product([teams_df.index, gws], names=["team_id", "gw"])
    agg = fx.groupby(["team_id", "gw"])[["factor", "cs"]].sum().reindex(grid, fill_value=0.0)
    F = agg["factor"].unstack().loc[f["team_id"]].set_axis(f.index)
    C = agg["cs"].unstack().loc[f["team_id"]].set_axis(f.index)

    share, pos = f["share"], f["pos_id"]
    pen = pen_bonus(f["pen_order"])
    cs_pts = pos.map(CS_POINTS) * share
    non_cs = (f["non_cs_pp90"] + np.where(pos == 3, f["cs_per90"] * 3, 0.0) + pen) * share
    att = (f["xg90"] * pos.map(GOAL_PTS) + f["xa90"] * ASSIST_PTS + pen + APPEARANCE_PTS) * share
    ep = F.mul(non_cs, axis=0) + C.mul(cs_pts, axis=0)
    ep_x = (F.mul(att, axis=0) + C.mul(cs_pts, axis=0)).where(f["xgi90"].notna(), axis=0)
    # le signe de l'écart ne dépend pas du match : on le lit sur la somme
    gap = ep_x.sum(axis=1, min_count=1) - ep.sum(axis=1)
    return pd.DataFrame({g: _blend(pos, ep[g], ep_x[g], gap) for g in gws})


def judgment_pool(df):
    """
    Pool d'optimisation : écarte les non-titulaires francs (et la règle
    « finition », non validée), puis tire l'EP vers les points mérités :
      MID/FWD dans les deux sens ; DEF seulement vers le haut (ep_x ignore
      les contributions défensives) ; GK jamais (ep_x ignore les arrêts).
    Renvoie (pool, motifs) où motifs donne la raison de chaque exclusion.
    """
    reason = pd.Series("", index=df.index)
    reason[df["share"] < MIN_SHARE] = "minutes"
    reason[(reason == "") & (df["car_fin"] < BAD_FINISHER)
           & (df["gap"] > MISLEADING_GAP)] = "finition"

    pool = df[reason == ""].copy()
    pool["ep_brut"] = pool["ep"]
    pool["ep"] = _blend(pool["pos_id"], pool["ep"], pool["ep_x"], pool["gap"])
    return pool, reason[reason != ""]
