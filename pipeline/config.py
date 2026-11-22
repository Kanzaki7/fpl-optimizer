"""
Constantes du modèle. Les valeurs commentées « backtest » viennent de
backtest/fpl_backtest.py (saisons 2023-24 et 2024-25, coupures aux journées
5, 10 et 20) : ne pas les modifier à l'intuition, relancer le backtest.
"""

BASE_URL = "https://fantasy.premierleague.com/api"
USER_AGENT = "fpl-optimizer (+https://github.com/Kanzaki7/fpl-optimizer)"

# Règles officielles
CS_POINTS = {1: 4, 2: 4, 3: 1, 4: 0}          # GK, DEF, MID, FWD
GOAL_PTS = {1: 6, 2: 6, 3: 5, 4: 4}
ASSIST_PTS = 3
APPEARANCE_PTS = 2
POS_NAME = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
SQUAD_QUOTA = {1: 2, 2: 5, 3: 5, 4: 3}
XI_MIN = {1: 1, 2: 3, 3: 2, 4: 1}
XI_MAX = {1: 1, 2: 5, 3: 5, 4: 3}
MAX_PER_CLUB = 3

# Saisons passées
SEASON_WEIGHTS = [0.6, 0.3, 0.1]   # n-1, n-2, n-3 (parmi les saisons exploitables)
MIN_MINUTES_SEASON = 400           # en dessous, une saison passée est ignorée
MIN_PAST_MINUTES = 900             # minutes de la dernière saison pour être éligible
MIN_CURRENT_MINUTES = 180          # éligibilité sans historique PL
SHRINK_MINUTES = 900               # lissage des nouveaux venus : m / (m + 900)

# Poids de la saison en cours : 8 % par journée (plafond 70 %) pour les taux,
# 15 % par journée (plafond 85 %) pour les minutes.
RATE_WEIGHT_PER_GW, RATE_WEIGHT_MAX = 0.08, 0.70
SHARE_WEIGHT_PER_GW, SHARE_WEIGHT_MAX = 0.15, 0.85

PEN_BONUS = {1: 0.60, 2: 0.20}     # pts / 90 min, tireur n°1 et n°2

# Calendrier : ±7,5 % par point de FDR. Backtest : corrélation 0 à 0,08 avec
# les points des 8 journées suivantes, d'où un coefficient volontairement bas.
FDR_COEF = 0.075
CS_BASE, CS_SLOPE, CS_MIN, CS_MAX = 0.27, 0.06, 0.08, 0.50

# Filtre de jugement
MIN_SHARE = 0.70           # backtest : la part de minutes est le meilleur prédicteur
BAD_FINISHER = 0.85        # non validé (échantillons trop petits), conservé
MISLEADING_GAP = 8.0
CONC_SHRINK = 0.15         # décote d'une production concentrée sur un match
REGRESSION_BLEND = 0.60    # backtest : optimum vers 0,7 aux trois coupures

BENCH_WEIGHT = 0.25        # backtest : banc / XI = 0,28
DEFAULT_HORIZON = 8
GW_WINDOW = 10             # journées exportées pour les calculs du site
DEFAULT_BUDGET = 100.0
STABILITY_HORIZONS = (4, 6, 8)
