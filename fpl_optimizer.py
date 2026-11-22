#!/usr/bin/env python3
"""
FPL Squad Optimizer — saison 2026/27 (v3)
==========================================
Nouveauté v3 : intégration des données de la SAISON EN COURS.
  - Les taux par 90 min mélangent historique passé et matchs déjà joués
    cette saison ; le poids de la saison courante augmente avec le nombre
    de journées (≈30% après 4 GW, plafonné à 70%).
  - La projection de minutes s'appuie surtout sur les minutes RÉELLES de
    cette saison (60% après 4 GW, jusqu'à 85%) : un titulaire qui a perdu
    sa place, ou un nouveau venu qui l'a gagnée, est enfin détecté.
  - Les joueurs SANS historique PL (nouveaux transferts, promus) deviennent
    éligibles dès 180 minutes jouées cette saison, avec un lissage vers la
    moyenne de leur poste tant que l'échantillon est petit.

Rappels v1/v2 :
  - points de clean sheet recalculés selon la défense de l'équipe ACTUELLE
  - bonus tireur de penalty (penalties_order)
  - facteur calendrier sur les N prochaines journées (relatif à la
    prochaine GW non jouée)
  - filtre doublures gardiens (GK le plus cher de chaque club)
  - overrides.csv : player_id,minute_share pour imposer ton jugement
    (0.0 élimine un joueur ; >0 protège un GK du filtre doublures)
  - optimisation PuLP : budget, 2/5/5/3, max 3 par club, XI valide

Usage :
    pip install requests pandas "pulp<4"
    python fpl_optimizer.py [--horizon 8] [--budget 100.0] [--min-minutes 900]
"""

import argparse
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
import pulp

BASE = "https://fantasy.premierleague.com/api"
HEADERS = {"User-Agent": "Mozilla/5.0 (fpl-optimizer perso)"}
OVERRIDES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "overrides.csv")

# Points par poste (règles officielles)
CS_POINTS = {1: 4, 2: 4, 3: 1, 4: 0}          # GK, DEF, MID, FWD
POS_NAME = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
SQUAD_QUOTA = {1: 2, 2: 5, 3: 5, 4: 3}
XI_MIN = {1: 1, 2: 3, 3: 2, 4: 1}
XI_MAX = {1: 1, 2: 5, 3: 5, 4: 3}

# Pondération des saisons passées pour les taux par 90 min
SEASON_WEIGHTS = [0.6, 0.3, 0.1]   # n-1, n-2, n-3
MIN_MINUTES_SEASON = 400           # en dessous, la saison passée est ignorée
MIN_CURRENT_MINUTES = 180          # éligibilité sans historique PL
SHRINK_MINUTES = 900               # constante de lissage des nouveaux venus :
                                   # confiance = min/(min+900) -> 23% à 270 min,
                                   # 50% à 900 min, 75% à 2700 min

# Bonus tireur de penalty (pts par 90 min ajoutés au taux hors CS)
PEN_BONUS = {1: 0.60, 2: 0.20}     # tireur n°1, tireur n°2

# --- Filtre de jugement appliqué avant l'optimisation -----------------
# Ces seuils encodent ce que les stats de fond nous ont appris :
#   - un joueur qui ne joue pas assez ne rapporte rien, quel que soit son EP
#   - un milieu/attaquant dont ep_x est très en dessous de ep marque au-delà
#     de ce que son jeu produit : ses points ne tiendront pas
#   - un gros gap positif chez un mauvais finisseur de carrière n'est pas de
#     la malchance, c'est son niveau réel de finition
# Valeurs issues de fpl_backtest.py (saisons 2023-24 et 2024-25, coupures
# aux journées 5, 10 et 20). Ne pas modifier à l'intuition : relancer le
# backtest.
MIN_SHARE = 0.70           # plancher de sécurité, pas un critère de tri.
                           # Le backtest confirme que la part de minutes est
                           # le meilleur prédicteur (0.40 à 0.55 selon la
                           # coupure), mais expected_points multiplie DÉJÀ
                           # l'EP par share : filtrer haut pénalise deux fois
                           # le même défaut. Testé sur les données de la
                           # journée 5 : à 0.50, 0.70 et 0.78 le solveur
                           # retient de lui-même un minimum de 0.82 et un EP
                           # de 449.4 ; à 0.85 il tombe à 448.3. Le seuil ne
                           # sert donc qu'à écarter les non-titulaires francs,
                           # le gradient étant géré par l'EP lui-même.
BAD_FINISHER = 0.85        # NON VALIDÉ : les groupes séparés par cette règle
MISLEADING_GAP = 8.0       # comptent 10 à 24 joueurs selon la coupure, trop
                           # peu pour conclure, et le sens s'inverse d'une
                           # coupure à l'autre (23.5 / 18.4 / 9.9 pts). La
                           # règle ne touche qu'un joueur en pratique ;
                           # conservée faute de preuve dans un sens ou l'autre.
CONC_SHRINK = 0.15         # décote pour production concentrée. INVALIDÉ en
                           # grande partie : une fois les non-titulaires
                           # écartés, conc ne corrèle plus qu'à -0.04 à la
                           # journée 5 (contre -0.28 sur le pool entier) —
                           # c'était surtout un doublon du filtre minutes.
                           # Conservé au minimum car le signal réapparaît en
                           # fin de saison (-0.30 à la journée 20).
REGRESSION_BLEND = 0.60    # part de ep_x dans l'EP d'optimisation. VALIDÉ :
                           # la corrélation avec les points futurs culmine
                           # vers 0.7 aux trois coupures (0.286 -> 0.323 à la
                           # journée 5) ; on reste un cran en dessous car
                           # elle s'effondre à 1.0.

# Points par but selon le poste (règles officielles) et par passe décisive
GOAL_PTS = {1: 6, 2: 6, 3: 5, 4: 4}
ASSIST_PTS = 3
APPEARANCE_PTS = 2                 # 2 pts dès 60 min jouées


# ---------------------------------------------------------------- API

def get_json(url, retries=3):
    for i in range(retries):
        r = requests.get(url, headers=HEADERS, timeout=20)
        if r.status_code == 200:
            return r.json()
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"Échec API : {url} (HTTP {r.status_code})")


def fetch_bootstrap():
    return get_json(f"{BASE}/bootstrap-static/")


def fetch_fixtures():
    return get_json(f"{BASE}/fixtures/")


def fetch_history(player_id):
    """
    history_past = totaux des saisons précédentes.
    history      = matchs de la saison EN COURS (une ligne par match de
                   l'équipe, minutes=0 si le joueur n'est pas entré).
    """
    try:
        data = get_json(f"{BASE}/element-summary/{player_id}/")
        return player_id, data.get("history_past", []), data.get("history", [])
    except Exception:
        return player_id, [], []


def career_xg(past_seasons):
    """Somme des xG des saisons passées. L'API ne les fournit qu'à partir de
    2022/23 ; renvoie 0.0 si le champ est absent (saisons anciennes)."""
    return sum(to_float(s.get("expected_goals")) for s in past_seasons)


def career_goals(past_seasons):
    """Buts des saisons passées, limités à celles où un xG est disponible
    (sinon on comparerait des buts sans leur xG correspondant)."""
    return sum(s.get("goals_scored", 0) for s in past_seasons
               if to_float(s.get("expected_goals")) > 0)


def to_float(v, default=0.0):
    """Les champs xG de l'API arrivent en chaînes ("1.23") ou None."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_overrides():
    """Lit overrides.csv (player_id, minute_share) s'il existe."""
    if not os.path.exists(OVERRIDES_FILE):
        return {}
    try:
        ov = pd.read_csv(OVERRIDES_FILE, comment="#")
        overrides = dict(zip(ov["player_id"].astype(int),
                             ov["minute_share"].astype(float)))
        print(f"Overrides chargés : {len(overrides)} joueur(s)")
        return overrides
    except Exception as e:
        print(f"⚠ overrides.csv ignoré ({e})")
        return {}


# ------------------------------------------------- Calendrier & équipes

def next_gameweek(events, fixtures):
    """
    Prochaine journée non jouée et nombre de journées déjà jouées.

    Source d'autorité : bootstrap["events"], qui porte les drapeaux officiels
    is_next / finished. Les fixtures ne sont utilisées qu'en repli : un seul
    match au drapeau finished en retard (bonus non validés, report) suffisait
    à faire croire au script qu'une journée déjà jouée était à venir.
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


def fixture_factors(fixtures, teams, horizon, next_gw):
    """
    Multiplicateur par équipe basé sur la difficulté moyenne (FDR 1-5)
    des `horizon` PROCHAINS matchs. FDR 3 = neutre (1.0), ±7.5% par point
    d'écart -> plage ~[0.85, 1.15]. Retourne aussi le nb de matchs sur
    l'horizon (blanks/doubles) et la prochaine GW non jouée.
    """
    diffs = {t["id"]: [] for t in teams}
    for f in fixtures:
        gw = f.get("event")
        if gw is None or not (next_gw <= gw < next_gw + horizon):
            continue
        diffs[f["team_h"]].append(f["team_h_difficulty"])
        diffs[f["team_a"]].append(f["team_a_difficulty"])
    factors, n_games = {}, {}
    for tid, d in diffs.items():
        n_games[tid] = len(d)
        avg = sum(d) / len(d) if d else 3.0
        # 0.075 par point de FDR -> plage [0.85, 1.15]. NON VALIDÉ, et plutôt
        # démenti : la corrélation entre facilité du calendrier et points des
        # 8 journées suivantes vaut entre -0.00 et +0.08 selon la saison et la
        # coupure, sans ordre net entre quartiles. Sur cet horizon le
        # calendrier ne porte presque rien ; l'effet est réel sur 3-4 journées
        # mais se dilue ensuite. Coefficient laissé bas exprès.
        factors[tid] = 1.0 + (3.0 - avg) * 0.075
    print(f"Horizon : GW{next_gw} à GW{next_gw + horizon - 1}")
    return factors, n_games


def team_cs_probability(teams, factors):
    """
    Probabilité de clean sheet par match, par équipe.
    Base ~27%, modulée par la force défensive FPL puis par le calendrier.
    """
    strengths = {
        t["id"]: (t["strength_defence_home"] + t["strength_defence_away"]) / 2
        for t in teams
    }
    avg_s = sum(strengths.values()) / len(strengths)
    probs = {}
    for tid, s in strengths.items():
        p = 0.27 + (s - avg_s) / 100 * 0.06
        p *= factors[tid]
        probs[tid] = min(0.50, max(0.08, p))
    return probs


# ------------------------------------------------- Taux par 90 minutes

def past_rates(past_seasons):
    """Taux par 90 min issus des saisons précédentes (pondérées)."""
    usable = [s for s in reversed(past_seasons)
              if s.get("minutes", 0) >= MIN_MINUTES_SEASON]
    if not usable:
        return None
    rates, cs_rates, weights = [], [], []
    for s, w in zip(usable[:3], SEASON_WEIGHTS):
        cs_pts = s.get("clean_sheets", 0) * 4  # approx GK/DEF ; corrigé pour MID
        non_cs = s["total_points"] - cs_pts
        rates.append(non_cs / s["minutes"] * 90)
        cs_rates.append(s.get("clean_sheets", 0) / s["minutes"] * 90)
        weights.append(w)
    tot = sum(weights)
    return {
        "non_cs_pp90": sum(r * w for r, w in zip(rates, weights)) / tot,
        "cs_per90": sum(r * w for r, w in zip(cs_rates, weights)) / tot,
        "last_minutes": usable[0]["minutes"],
    }


def current_rates(history):
    """Taux et minutes de la saison EN COURS."""
    if not history:
        return None
    team_games = len(history)
    minutes = sum(m.get("minutes", 0) for m in history)
    out = {
        "team_games": team_games,
        "minutes": minutes,
        "share": minutes / (team_games * 90) if team_games else 0.0,
    }
    if minutes >= 90:  # en dessous, taux trop bruités pour être utilisés
        points = sum(m.get("total_points", 0) for m in history)
        cs = sum(m.get("clean_sheets", 0) for m in history)
        out["non_cs_pp90"] = (points - cs * 4) / minutes * 90
        out["cs_per90"] = cs / minutes * 90

        # Part des points venant du SEUL meilleur match. Les totaux de saison
        # ne distinguent pas 5 matchs réguliers d'un triplé suivi de 4 néants :
        #   ~0.25 sur 5 matchs = production régulière
        #   > 0.55              = tout repose sur une seule sortie
        played = [m for m in history if m.get("minutes", 0) >= 20]
        pts = [m.get("total_points", 0) for m in played]
        tot = sum(p for p in pts if p > 0)
        out["conc"] = (max(pts) / tot) if tot > 0 and pts else float("nan")
        out["games_played"] = len(played)
    return out


def blend_weights(gw_played):
    """
    Poids de la saison courante selon l'avancement.
      - taux (pts/90)   : 8% par GW jouée, plafonné à 70%
      - minutes (share) : 15% par GW jouée, plafonné à 85%
    Les minutes convergent plus vite : "qui joue" se lit en quelques
    matchs, "à quel niveau" demande plus d'échantillon.
    """
    return min(0.70, 0.08 * gw_played), min(0.85, 0.15 * gw_played)


# ------------------------------------------------- Points attendus

def expected_points(row, cs_probs, factors, n_games):
    """EP d'un joueur sur l'horizon complet (share déjà calculé en amont)."""
    tid = row["team_id"]
    pos = row["pos_id"]
    games = n_games.get(tid, 0)
    factor = factors.get(tid, 1.0)
    share = row["share"]

    non_cs = row["non_cs_pp90"]
    # Pour les MID, on a retiré 4 pts/CS au lieu de 1 -> on en rend 3
    if pos == 3:
        non_cs += row["cs_per90"] * 3
    # Bonus tireur de penalty
    pen = row["pen_order"]
    if pen is not None and not pd.isna(pen) and int(pen) in PEN_BONUS:
        non_cs += PEN_BONUS[int(pen)]

    ep_match = non_cs * share * factor
    cs_value = CS_POINTS[pos]
    if cs_value:
        ep_match += cs_probs[tid] * cs_value * share
    return ep_match * games


def expected_points_underlying(row, cs_probs, factors, n_games):
    """
    EP alternatif fondé sur le xG/xA de la saison en cours plutôt que sur les
    points réellement marqués. Répond à la question : "combien ce joueur
    DEVRAIT rapporter vu le jeu qu'il produit ?"

    Un joueur qui crée beaucoup sans marquer aura ep_x >> ep : c'est un
    candidat à la régression positive. Un joueur en surchauffe aura ep_x << ep.
    NaN si l'échantillon de la saison est trop court.
    """
    if pd.isna(row["xgi90"]):
        return float("nan")
    tid = row["team_id"]
    pos = row["pos_id"]
    games = n_games.get(tid, 0)
    factor = factors.get(tid, 1.0)
    share = row["share"]

    att = row["xg90"] * GOAL_PTS[pos] + row["xa90"] * ASSIST_PTS
    pen = row["pen_order"]
    if pen is not None and not pd.isna(pen) and int(pen) in PEN_BONUS:
        att += PEN_BONUS[int(pen)]

    ep_match = (att + APPEARANCE_PTS) * share * factor
    cs_value = CS_POINTS[pos]
    if cs_value:
        ep_match += cs_probs[tid] * cs_value * share
    return ep_match * games


def judgment_pool(df, verbose=True):
    """
    Restreint le pool aux joueurs exploitables et remplace l'EP d'optimisation
    par un mélange points réels / points mérités pour les postes offensifs.

    Renvoie (pool, exclus) — le pool sert à l'optimisation, le DataFrame
    complet reste disponible pour l'affichage.
    """
    d = df.copy()
    att = d["pos_id"].isin([3, 4])
    reason = pd.Series("", index=d.index)

    reason[d["share"] < MIN_SHARE] = "minutes"
    reason[(reason == "") & (d["car_fin"] < BAD_FINISHER)
           & (d["gap"] > MISLEADING_GAP)] = "finition"
    # Pas de règle "surchauffe" : le backtest la donne systématiquement
    # contre-productive. Les MID/FWD à gros gap négatif ont marqué PLUS que
    # ceux qu'elle retenait, aux trois coupures (22.8 vs 17.9 à la journée 5).
    # La régression existe mais elle est plus lente que la persistance du
    # niveau — l'information xG passe par REGRESSION_BLEND, pas par un filtre.


    pool = d[reason == ""].copy()
    exclus = d[reason != ""].copy()
    exclus["motif"] = reason[reason != ""]

    # EP d'optimisation : on tire l'EP vers les points mérités.
    #  - MID/FWD : dans les deux sens, ep_x y est complet.
    #  - DEF : seulement vers le haut. ep_x ignore les DefCon, donc il
    #    sous-estime toujours un défenseur : un gap POSITIF est un minorant
    #    fiable de ce qu'il mérite, un gap négatif ne prouve rien.
    #  - GK : jamais, ep_x ignore les arrêts.
    pool["ep_brut"] = pool["ep"]
    has_x = pool["ep_x"].notna()
    adj = (pool["pos_id"].isin([3, 4]) & has_x) | (
        (pool["pos_id"] == 2) & has_x & (pool["gap"] > 0))
    pool.loc[adj, "ep"] = ((1 - REGRESSION_BLEND) * pool.loc[adj, "ep_brut"]
                           + REGRESSION_BLEND * pool.loc[adj, "ep_x"])

    if verbose:
        print(f"\nFiltre : {len(pool)} joueurs retenus, {len(exclus)} écartés "
              f"({', '.join(f'{m}: {n}' for m, n in exclus['motif'].value_counts().items())})")
        notables = exclus.nlargest(8, "ep")
        if not notables.empty:
            print("Écartés malgré un EP élevé :")
            print(notables[["name", "team", "pos", "price", "ep", "ep_x",
                            "gap", "share", "car_fin", "motif"]]
                  .to_string(float_format=lambda x: f"{x:.2f}"))
    return pool, exclus


# ------------------------------------------------- Optimisation PuLP

def _solver():
    """
    PuLP 3 embarque CBC ; PuLP 4 n'embarque plus aucun solveur et passe par
    HiGHS (pip install highspy). On prend le premier disponible.
    """
    if hasattr(pulp, "PULP_CBC_CMD"):
        return pulp.PULP_CBC_CMD(msg=False)
    if hasattr(pulp, "HiGHS"):
        try:
            return pulp.HiGHS(msg=False)
        except Exception:
            pass
    raise RuntimeError(
        "Aucun solveur disponible. Corrige avec l'une des deux commandes :\n"
        "  pip install \"pulp<4\"        (CBC inclus)\n"
        "  pip install highspy           (pour PuLP 4)")


def optimize_squad(df, budget=100.0, bench_weight=0.25, force=(), exclude=()):
    """
    Maximise EP(XI) + bench_weight * EP(banc), sous contraintes officielles.

    bench_weight = 0.25 : mesuré à 0.28 sur les saisons 2023-24 et 2024-25
    (points des joueurs 12 à 15 rapportés à ceux du XI, journées 6 à 13).
    La valeur précédente, 0.15, sous-évaluait le banc.
    force   : ids de joueurs imposés dans les 15 (ex. Haaland pour un plan TC)
    exclude : ids de joueurs interdits (ex. un pari que tu ne veux pas)
    """
    df = df[~df.index.isin(list(exclude))]
    ids = df.index.tolist()
    prob = pulp.LpProblem("FPL", pulp.LpMaximize)

    # PuLP 4 crée les variables via le problème ; PuLP 3 via LpVariable.dicts
    def binary(name):
        if hasattr(prob, "add_variable"):
            return prob.add_variable(name, cat="Binary")
        return pulp.LpVariable(name, cat="Binary")

    squad = {i: binary(f"squad_{i}") for i in ids}
    xi = {i: binary(f"xi_{i}") for i in ids}

    prob += pulp.lpSum(
        xi[i] * df.at[i, "ep"] + (squad[i] - xi[i]) * df.at[i, "ep"] * bench_weight
        for i in ids
    )
    prob += pulp.lpSum(squad[i] * df.at[i, "price"] for i in ids) <= budget
    prob += pulp.lpSum(xi[i] for i in ids) == 11
    for i in ids:
        prob += xi[i] <= squad[i]
    for pos, quota in SQUAD_QUOTA.items():
        pos_ids = [i for i in ids if df.at[i, "pos_id"] == pos]
        prob += pulp.lpSum(squad[i] for i in pos_ids) == quota
        prob += pulp.lpSum(xi[i] for i in pos_ids) >= XI_MIN[pos]
        prob += pulp.lpSum(xi[i] for i in pos_ids) <= XI_MAX[pos]
    for tid in df["team_id"].unique():
        club_ids = [i for i in ids if df.at[i, "team_id"] == tid]
        prob += pulp.lpSum(squad[i] for i in club_ids) <= 3
    for i in force:
        if i in squad:
            prob += squad[i] == 1
        else:
            print(f"⚠ --force {i} : joueur absent du pool (filtré ou inconnu)")

    status = prob.solve(_solver())
    # statut 1 = optimal, en PuLP 3 comme en PuLP 4
    code = getattr(status, "status", status)          # PuLP 4 : objet de stats
    code = getattr(code, "value", code)                # enum -> entier
    if int(code) != 1:
        raise RuntimeError(f"Solveur : pas de solution optimale (statut {status}) "
                           "— combinaison --force impossible ?")
    squad_ids = [i for i in ids if (squad[i].value() or 0) > 0.5]
    xi_ids = [i for i in ids if (xi[i].value() or 0) > 0.5]
    return squad_ids, xi_ids


def horizon_stability(df, ctx, horizons, budget, force=(), exclude=()):
    """
    Réoptimise l'équipe pour plusieurs horizons et compte, pour chaque joueur,
    dans combien de sélections il apparaît.

    Un joueur retenu à tous les horizons est un choix robuste. Un joueur qui
    n'apparaît qu'à l'horizon le plus long est un pari sur des matchs lointains
    que les données actuelles ne permettent pas de projeter avec confiance —
    et que tu pourras de toute façon acheter plus tard avec un transfert.
    """
    counts, per_h = {}, {}
    for h in horizons:
        factors, n_games = fixture_factors(ctx["fixtures"], ctx["teams"], h,
                                           ctx["next_gw"])
        cs_probs = team_cs_probability(ctx["teams"], factors)
        d = df.copy()
        d["ep"] = d.apply(
            lambda r: expected_points(r, cs_probs, factors, n_games), axis=1)
        d["ep_x"] = d.apply(
            lambda r: expected_points_underlying(r, cs_probs, factors, n_games),
            axis=1)
        d["gap"] = d["ep_x"] - d["ep"]
        d = d[d["ep"] > 0]
        d, _ = judgment_pool(d, verbose=False)
        try:
            squad, _ = optimize_squad(d, budget=budget, force=force,
                                      exclude=exclude)
        except RuntimeError as e:
            print(f"  horizon {h} : {e}")
            continue
        per_h[h] = set(squad)
        for i in squad:
            counts[i] = counts.get(i, 0) + 1
    return counts, per_h


# ------------------------------------------------- Main

def build_dataframe(horizon, min_minutes, workers=8, current_weight=None):
    print("Téléchargement bootstrap-static et fixtures…")
    boot = fetch_bootstrap()
    fixtures = fetch_fixtures()
    teams = boot["teams"]
    team_names = {t["id"]: t["short_name"] for t in teams}
    overrides = load_overrides()

    next_gw, gw_flag = next_gameweek(boot.get("events"), fixtures)
    factors, n_games = fixture_factors(fixtures, teams, horizon, next_gw)
    cs_probs = team_cs_probability(teams, factors)

    candidates = [e for e in boot["elements"] if e["status"] != "u"]
    print(f"{len(candidates)} joueurs, récupération des historiques…")

    histories = {}
    games_seen = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetch_history, e["id"]) for e in candidates]
        for k, fut in enumerate(as_completed(futures), 1):
            pid, past, cur = fut.result()
            histories[pid] = (past, cur)
            if cur:
                games_seen = max(games_seen, len(cur))
            if k % 100 == 0:
                print(f"  {k}/{len(candidates)}")

    # Journées jouées = matchs réellement présents dans l'historique.
    gw_played = max(games_seen, gw_flag)
    w_rate, w_share = blend_weights(gw_played)
    if current_weight is not None:
        w_rate = max(0.0, min(1.0, current_weight))
    print(f"{gw_played} GW jouée(s) -> poids saison courante : "
          f"{w_rate:.0%} (taux), {w_share:.0%} (minutes)")

    rows = []
    for e in candidates:
        past, cur = histories.get(e["id"], ([], []))
        p = past_rates(past)
        c = current_rates(cur)

        has_past = p is not None and p["last_minutes"] >= min_minutes
        has_cur = c is not None and c["minutes"] >= MIN_CURRENT_MINUTES
        if not has_past and not has_cur:
            continue

        # --- Taux par 90 : blend passé/courant selon disponibilité
        if has_past and c is not None and "non_cs_pp90" in c:
            non_cs = (1 - w_rate) * p["non_cs_pp90"] + w_rate * c["non_cs_pp90"]
            cs90 = (1 - w_rate) * p["cs_per90"] + w_rate * c["cs_per90"]
        elif has_past:
            non_cs, cs90 = p["non_cs_pp90"], p["cs_per90"]
        else:  # saison courante uniquement (nouveau venu) — lissé plus bas
            non_cs, cs90 = c["non_cs_pp90"], c["cs_per90"]

        # --- Projection de minutes : blend passé/courant
        share_past = min(1.0, p["last_minutes"] / (38 * 90) * 1.10) if has_past else None
        share_cur = c["share"] if c is not None else None
        if share_past is not None and share_cur is not None:
            share = (1 - w_share) * share_past + w_share * share_cur
        else:
            share = share_cur if share_cur is not None else share_past
        share = min(1.0, share)

        # Statut (blessé/suspendu/incertain) puis override manuel prioritaire
        chance = e.get("chance_of_playing_next_round")
        if chance is not None and not pd.isna(chance):
            share *= chance / 100.0
        if e["id"] in overrides:
            share = float(overrides[e["id"]])

        rows.append({
            "id": e["id"],
            "name": e["web_name"],
            "team": team_names[e["team"]],
            "team_id": e["team"],
            "pos_id": e["element_type"],
            "pos": POS_NAME.get(e["element_type"], "?"),
            "price": e["now_cost"] / 10,
            "pen_order": e.get("penalties_order"),
            "own": to_float(e.get("selected_by_percent")),
            "xgi": to_float(e.get("expected_goal_involvements")),
            "xg": to_float(e.get("expected_goals")),
            "xa": to_float(e.get("expected_assists")),
            "goals": e.get("goals_scored", 0),
            "assists": e.get("assists", 0),
            "ga": e.get("goals_scored", 0) + e.get("assists", 0),
            "car_xg": career_xg(past),
            "car_goals": career_goals(past),
            "net_tr": (e.get("transfers_in_event", 0)
                       - e.get("transfers_out_event", 0)),
            "non_cs_pp90": non_cs,
            "cs_per90": cs90,
            "share": share,
            "cur_minutes": c["minutes"] if c else 0,
            "conc": c.get("conc", float("nan")) if c else float("nan"),
            "games_played": c.get("games_played", 0) if c else 0,
            "new_player": not has_past,
        })

    df = pd.DataFrame(rows).set_index("id")

    # --- Lissage des nouveaux venus vers la moyenne de leur poste
    # (petit échantillon -> on ne croit pas encore totalement leurs taux)
    priors = (df[~df["new_player"]].groupby("pos_id")["non_cs_pp90"].median())
    for i in df.index[df["new_player"]]:
        m = df.at[i, "cur_minutes"]
        conf = m / (m + SHRINK_MINUTES)
        prior = priors.get(df.at[i, "pos_id"], df.at[i, "non_cs_pp90"])
        df.at[i, "non_cs_pp90"] = conf * df.at[i, "non_cs_pp90"] + (1 - conf) * prior

    # --- Gardiens : ne garder que le plus cher de chaque club,
    # sauf si un GK moins cher joue réellement cette saison (share courant
    # majoritaire) ou est protégé par un override > 0.
    gk = df[df["pos_id"] == 1]
    keep_gk = set(gk.sort_values("price", ascending=False)
                    .groupby("team_id").head(1).index)
    keep_gk |= {i for i in gk.index if gk.at[i, "share"] >= 0.5}
    keep_gk |= {i for i in gk.index
                if overrides.get(i) is not None and overrides[i] > 0}
    df = df[(df["pos_id"] != 1) | (df.index.isin(keep_gk))]

    # --- Diagnostic : production réelle vs attendue (saison en cours)
    # xgi90 : implications de but attendues par 90 min (se stabilise bien plus
    #         vite que les buts eux-mêmes)
    #
    # Le résidu "réel - attendu" est normalisé par la conversion de l'ÉQUIPE :
    # R = buts de l'équipe / xG de l'équipe. Un joueur dans une équipe qui
    # surconvertit (bons finisseurs, série chaude collective) verra ses buts ET
    # ses passes décisives gonflés sans mérite personnel. On compare donc à
    # xG x R plutôt qu'à xG brut. Les passes utilisent le même R : une passe
    # décisive ne se concrétise que si le coéquipier marque.
    #   luck_g : finition personnelle au-delà de celle de son équipe
    #   luck_a : passes converties au-delà de la normale de son équipe
    m = df["cur_minutes"].clip(lower=1)
    enough = df["cur_minutes"] >= 90

    team_xg = df.groupby("team_id")["xg"].sum()
    team_goals = df.groupby("team_id")["goals"].sum()
    ratio = (team_goals / team_xg.replace(0, float("nan"))).clip(0.5, 2.0)
    ratio = ratio.fillna(1.0)
    df["team_conv"] = df["team_id"].map(ratio)

    df["xgi90"] = (df["xgi"] / m * 90).where(enough, float("nan"))
    df["xg90"] = (df["xg"] / m * 90).where(enough, 0.0)
    df["xa90"] = (df["xa"] / m * 90).where(enough, 0.0)
    df["luck_g"] = ((df["goals"] - df["xg"] * df["team_conv"]) / m * 90).where(
        enough, float("nan"))
    df["luck_a"] = ((df["assists"] - df["xa"] * df["team_conv"]) / m * 90).where(
        enough, float("nan"))

    # Référence pluriannuelle : un joueur qui surconvertit depuis 3 saisons
    # est un bon finisseur, pas un chanceux. NaN si xG indisponible.
    df["car_fin"] = (df["car_goals"] / df["car_xg"].replace(0, float("nan")))

    # --- Décote pour production concentrée
    # Référence : une production parfaitement régulière sur n matchs donne
    # conc = 1/n. L'écart à cette référence, ramené sur [0, 1], mesure à quel
    # point le total de saison tient sur une seule sortie.
    g = df["games_played"].clip(lower=1)
    ref = 1.0 / g
    excess = ((df["conc"] - ref) / (1 - ref).clip(lower=0.01)).clip(0.0, 1.0)
    conf = (1.0 - CONC_SHRINK * excess).fillna(1.0)
    med = df.groupby("pos_id")["non_cs_pp90"].transform("median")
    df["conf"] = conf
    df["non_cs_pp90"] = conf * df["non_cs_pp90"] + (1 - conf) * med

    df["ep"] = df.apply(lambda r: expected_points(r, cs_probs, factors, n_games),
                        axis=1)
    df["ep_x"] = df.apply(
        lambda r: expected_points_underlying(r, cs_probs, factors, n_games),
        axis=1)
    # gap > 0 : le jeu produit dit qu'il devrait marquer plus que ses points
    #           actuels ne le laissent croire (sous-évalué par l'EP classique)
    df["gap"] = df["ep_x"] - df["ep"]
    df["val_x"] = df["ep_x"] / df["price"]

    df = df.dropna(subset=["ep"])
    df = df[df["ep"] > 0]
    ctx = {"fixtures": fixtures, "teams": teams, "cs_probs": cs_probs,
           "next_gw": next_gw}
    return df, ctx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=8,
                    help="Nb de prochaines journées pour l'EP (défaut : 8)")
    ap.add_argument("--budget", type=float, default=100.0)
    ap.add_argument("--current-weight", type=float, default=None,
                    help="Force le poids de la saison en cours sur les taux "
                         "(0.0-1.0). Par défaut : automatique (8%% par GW, "
                         "plafond 70%%). Ex. --current-weight 0.6")
    ap.add_argument("--no-filter", action="store_true",
                    help="Désactive le filtre automatique (minutes, "
                         "surchauffe, mauvais finisseurs) et optimise sur "
                         "l'EP brut")
    ap.add_argument("--compare-horizons", type=str, default="",
                    help="Teste la stabilité de la sélection sur plusieurs "
                         "horizons, ex. --compare-horizons 4,6,9")
    ap.add_argument("--force", type=str, default="",
                    help="ids imposés dans l'équipe, séparés par des virgules "
                         "(ex. --force 411,426 pour Haaland + Bruno)")
    ap.add_argument("--exclude", type=str, default="",
                    help="ids interdits, séparés par des virgules")
    ap.add_argument("--min-minutes", type=int, default=900,
                    help="Minutes mini la saison passée (les joueurs avec "
                         f">= {MIN_CURRENT_MINUTES} min cette saison sont "
                         "éligibles même sans historique)")
    args = ap.parse_args()

    df, ctx = build_dataframe(args.horizon, args.min_minutes,
                              current_weight=args.current_weight)
    print(f"\n{len(df)} joueurs retenus. Optimisation…")
    parse_ids = lambda s: [int(x) for x in s.split(",") if x.strip()]
    gw_hint = int(df["games_played"].max()) if "games_played" in df else 0
    pool = df if args.no_filter else judgment_pool(df)[0]
    squad_ids, xi_ids = optimize_squad(pool, budget=args.budget,
                                       force=parse_ids(args.force),
                                       exclude=parse_ids(args.exclude))

    squad = pool.loc[squad_ids].sort_values(["pos_id", "ep"],
                                            ascending=[True, False])
    squad["XI"] = ["✓" if i in xi_ids else "banc" for i in squad.index]
    cols = ["name", "team", "pos", "price", "ep", "XI"]
    print(f"\n=== ÉQUIPE OPTIMALE ({args.horizon} prochaines GW) ===")
    print(squad[cols].to_string(float_format=lambda x: f"{x:.1f}"))
    print(f"\nCoût total : {squad['price'].sum():.1f}m  |  "
          f"Banque : {args.budget - squad['price'].sum():.1f}m")

    ranked = pool.loc[xi_ids].sort_values("ep", ascending=False)
    print(f"Capitaine : {ranked.iloc[0]['name']} ({ranked.iloc[0]['ep']:.1f} EP)"
          f"  |  Vice : {ranked.iloc[1]['name']}")

    print("\n" + "=" * 62)
    print("SÉLECTION FINALE")
    print("=" * 62)
    order = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
    for pos in [1, 2, 3, 4]:
        grp = squad[squad["pos_id"] == pos]
        titulaires = [n for n, x in zip(grp["name"], grp["XI"]) if x == "✓"]
        remplacants = [n for n, x in zip(grp["name"], grp["XI"]) if x != "✓"]
        ligne = ", ".join(titulaires)
        if remplacants:
            ligne += "  [banc : " + ", ".join(remplacants) + "]"
        print(f"  {order[pos]:4s} {ligne}")
    xi_df = squad[squad["XI"] == "✓"]
    forme = (f"{(xi_df['pos_id'] == 2).sum()}-{(xi_df['pos_id'] == 3).sum()}"
             f"-{(xi_df['pos_id'] == 4).sum()}")
    bench = squad[squad["XI"] != "✓"].sort_values("ep", ascending=False)
    bench = bench[bench["pos_id"] != 1]
    print(f"\n  Formation  {forme}")
    print(f"  Capitaine  {ranked.iloc[0]['name']}   "
          f"Vice  {ranked.iloc[1]['name']}")
    print(f"  Ordre banc {', '.join(bench['name'])}")
    print(f"  Budget     {squad['price'].sum():.1f}m  "
          f"(banque {args.budget - squad['price'].sum():.1f}m)")
    print("\n  Point de départ, pas un verdict : le modèle tourne sur "
          f"{len(df)} joueurs et {gw_hint} journées,")
    print("  sa marge d'erreur dépasse les écarts de 2-3 EP qu'il affiche. "
          "Deux joueurs à moins")
    print("  de 5 EP d'écart sont équivalents — prends celui que tu comprends. "
          "L'exigence suit")
    print("  l'enjeu : capitaine et premiums = tout vérifier, XI = minutes et "
          "gap, banc = le moins")
    print("  cher qui joue.")

    print("\n=== TOP PAR POSTE (pour tes ajustements) ===")
    for pos in [1, 2, 3, 4]:
        top = df[df["pos_id"] == pos].nlargest(20, "ep")
        top = top.assign(value=top["ep"] / top["price"],
                         new=top["new_player"].map({True: "*", False: ""}))
        print(f"\n-- {POS_NAME[pos]} --")
        print("  DÉCIDER : share (≥0.85 titulaire, ≥0.75 banc) — de loin le "
              "signal le plus fiable | gap : départage seulement, jamais un "
              "motif d'achat")
        print("  COMPRENDRE : xgi90 = jeu produit/90 | conc = part d'un seul "
              "match | car_fin = buts/xG carrière | own = % sélection"
              + ("  | * = sans historique PL" if pos != 1 else ""))
        print("     ep_x = EP recalculé sur le xG/xA produit ; "
              "gap = ep_x - ep (positif = sous-évalué par ses points)")
        if pos in (1, 2):
            print("     /!\\ gap non significatif ici : ep_x ignore les arrêts "
                  "(GK) et les DefCon (DEF)")
        print(top[["name", "team", "price", "ep", "gap", "share", "conc",
                   "xgi90", "car_fin", "own", "new"]]
              .to_string(float_format=lambda x: f"{x:.2f}"))

    # Joueurs dont le jeu produit dépasse nettement les points encaissés
    # ep_x ne compte que les retours offensifs + le clean sheet : il ignore
    # les arrêts des gardiens, les DefCon et les bonus. Le gap n'a donc de
    # sens que pour les milieux et attaquants ; il est exclu pour les GK et
    # signalé comme peu fiable pour les défenseurs.
    cand = df[(df["gap"] > 0) & (df["cur_minutes"] >= 270)
              & (df["pos_id"] != 1)].nlargest(12, "gap")
    if not cand.empty:
        print("\n=== GAP LE PLUS ÉLEVÉ (jeu produit > points marqués) ===")
        print("À lire, pas à suivre : une fois la qualité du joueur neutralisée,")
        print("le gap ne corrèle qu'à +0.15 avec les points des 8 journées")
        print("suivantes à la journée 5, et à 0.00 à la journée 20. Sert à")
        print("départager deux joueurs proches, jamais à justifier un achat.")
        print("DEF : gap peu fiable (ep_x ignore les DefCon). GK : exclus "
              "(ep_x ignore les arrêts).")
        print(cand[["name", "team", "pos", "price", "ep", "gap", "share",
                    "conc", "car_fin", "own"]]
              .to_string(float_format=lambda x: f"{x:.2f}"))

    if args.compare_horizons:
        hs = [int(x) for x in args.compare_horizons.split(",") if x.strip()]
        counts, per_h = horizon_stability(df, ctx, hs, args.budget,
                                          force=parse_ids(args.force),
                                          exclude=parse_ids(args.exclude))
        if counts:
            st = df.loc[list(counts)].copy()
            st["horizons"] = [counts[i] for i in st.index]
            st["détail"] = ["/".join(str(h) for h in hs if i in per_h.get(h, ()))
                            for i in st.index]
            st = st.sort_values(["horizons", "price"], ascending=[False, False])
            print(f"\n=== STABILITÉ SELON L'HORIZON ({hs}) ===")
            print(f"{len(hs)}/{len(hs)} = choix robuste ; 1/{len(hs)} = pari "
                  "sur un calendrier précis, achetable plus tard par transfert.")
            print(st[["name", "team", "pos", "price", "horizons", "détail"]]
                  .to_string())

    # Pépites : bon rapport qualité/prix sur les stats de fond, quel que soit
    # leur rang en EP brut (un joueur en dessous du top 20 de son poste peut
    # avoir d'excellents indicateurs sous-jacents — cas type : un titulaire
    # bon marché qui crée beaucoup sans encore marquer).
    pep = df[(df["share"] >= 0.80) & (df["cur_minutes"] >= 270)
             & (df["xgi90"] >= 0.40) & (df["gap"] >= -3)
             & (df["pos_id"] != 1)].nlargest(12, "val_x")
    if not pep.empty:
        print("\n=== PÉPITES (titulaires, créent beaucoup, pas en surchauffe) ===")
        print("conc = part des points venant d'un seul match "
              "(> 0.55 = production concentrée, estimation peu fiable)")
        print(pep[["name", "team", "pos", "price", "ep", "gap", "share",
                   "conc", "car_fin", "own"]]
              .to_string(float_format=lambda x: f"{x:.2f}"))

    df.sort_values("ep", ascending=False).to_csv("fpl_expected_points.csv")
    print("\nDétail complet exporté -> fpl_expected_points.csv")


if __name__ == "__main__":
    main()
