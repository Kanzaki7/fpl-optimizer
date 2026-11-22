"""
Chargement des données de l'API dans SQLite, puis calcul des variables du
modèle par des vues SQL (pipeline/sql/features.sql).

Pourquoi SQLite : le nettoyage et les agrégats (minutes par équipe, taux
pondérés des saisons passées, conversion collective, calendrier) s'expriment
plus clairement en SQL qu'en boucles Python, la base peut être ouverte telle
quelle pour vérifier un chiffre (--db fpl.sqlite), et elle ne demande aucun
serveur.
"""

import os
import sqlite3

import pandas as pd

from .api import LIVE_FIELDS
from .config import MIN_MINUTES_SEASON, SEASON_WEIGHTS

SQL_DIR = os.path.join(os.path.dirname(__file__), "sql")


def read_sql(name):
    with open(os.path.join(SQL_DIR, name), encoding="utf-8") as f:
        return f.read()


def to_float(v, default=0.0):
    """Les champs xG de l'API arrivent en chaînes (« 1.23 ») ou None."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def to_int(v):
    try:
        return None if v is None or v == "" else int(v)
    except (TypeError, ValueError):
        return None


def connect():
    con = sqlite3.connect(":memory:")
    con.executescript(read_sql("schema.sql"))
    return con


def load(con, boot, fixtures, gw_stats, past):
    """
    boot      : réponse de bootstrap-static
    fixtures  : réponse de fixtures
    gw_stats  : {gw: [[id, minutes, total_points, ...], ...]} (api.gameweek_stats)
    past      : {code: [saison, ...]} (api.history_past)
    """
    con.executemany(
        "INSERT INTO teams VALUES (?,?,?,?,?,?,?)",
        [(t["id"], t["name"], t["short_name"], t.get("strength_defence_home"),
          t.get("strength_defence_away"), t.get("strength_attack_home"),
          t.get("strength_attack_away")) for t in boot["teams"]])

    con.executemany(
        "INSERT INTO players VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(e["id"], e["code"], e["web_name"], e.get("first_name"), e.get("second_name"),
          e["team"], e["element_type"], e["now_cost"], e.get("status"),
          (e.get("news") or "").strip(), to_int(e.get("chance_of_playing_next_round")),
          to_int(e.get("penalties_order")), to_float(e.get("selected_by_percent")),
          e.get("transfers_in_event", 0), e.get("transfers_out_event", 0),
          e.get("total_points", 0), e.get("goals_scored", 0), e.get("assists", 0),
          to_float(e.get("expected_goals")), to_float(e.get("expected_assists")),
          to_float(e.get("expected_goal_involvements")))
         for e in boot["elements"]])

    con.executemany(
        "INSERT INTO fixtures VALUES (?,?,?,?,?,?,?,?,?,?)",
        [(f["id"], f.get("event"), int(bool(f.get("finished"))), f["team_h"], f["team_a"],
          f.get("team_h_difficulty"), f.get("team_a_difficulty"),
          f.get("team_h_score"), f.get("team_a_score"), f.get("kickoff_time"))
         for f in fixtures])

    known = {e["id"] for e in boot["elements"]}
    rows = []
    for gw, data in gw_stats.items():
        for r in data:
            if r[0] not in known:
                continue
            rec = dict(zip(LIVE_FIELDS, r[1:]))
            rows.append((r[0], int(gw), rec["minutes"], rec["total_points"],
                         rec["clean_sheets"], rec["goals_scored"], rec["assists"],
                         to_float(rec["expected_goals"]), to_float(rec["expected_assists"]),
                         rec.get("starts")))
    con.executemany("INSERT INTO player_gw VALUES (?,?,?,?,?,?,?,?,?,?)", rows)

    con.executemany(
        "INSERT OR REPLACE INTO player_past VALUES (?,?,?,?,?,?,?,?,?)",
        [(int(code), s["season_name"], s.get("minutes") or 0, s.get("total_points") or 0,
          s.get("goals_scored"), s.get("assists"), s.get("clean_sheets"),
          to_float(s.get("expected_goals")), to_float(s.get("expected_assists")))
         for code, seasons in past.items() for s in seasons if s.get("season_name")])

    con.executemany("INSERT INTO season_weights VALUES (?,?)",
                    list(enumerate(SEASON_WEIGHTS, start=1)))
    con.executemany("INSERT INTO model_params VALUES (?,?)",
                    [("min_season_minutes", MIN_MINUTES_SEASON)])
    con.commit()
    con.executescript(read_sql("features.sql"))


def query(con, name_or_sql, **params):
    sql = read_sql(name_or_sql) if name_or_sql.endswith(".sql") else name_or_sql
    return pd.read_sql_query(sql, con, params=params)


def player_features(con):
    return query(con, "SELECT * FROM v_player_features").set_index("id")


def fixture_run(con, next_gw, horizon):
    return query(con, "fixture_run.sql", next_gw=next_gw, horizon=horizon).set_index("team_id")


def next_fixtures(con, n=5):
    return query(con, "next_fixtures.sql", n=n)


def gw_history(con):
    return query(con, "SELECT player_id, gw, minutes, total_points FROM player_gw "
                      "ORDER BY player_id, gw")


def save_copy(con, path):
    """Copie la base (tables et vues) dans un fichier, pour l'explorer."""
    if os.path.exists(path):
        os.remove(path)
    disk = sqlite3.connect(path)
    con.backup(disk)
    disk.close()
