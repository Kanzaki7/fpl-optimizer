import json
import os

import pandas as pd
import pytest

from pipeline import api, db, model
from pipeline.__main__ import main
from pipeline.config import MAX_PER_CLUB, SQUAD_QUOTA, XI_MAX, XI_MIN


# ------------------------------------------------------------------ SQL
@pytest.fixture
def con():
    c = db.connect()
    boot = {"teams": [{"id": 1, "name": "A", "short_name": "A"},
                      {"id": 2, "name": "B", "short_name": "B"}],
            "elements": [
                {"id": 1, "code": 11, "web_name": "Régulier", "team": 1, "element_type": 3,
                 "now_cost": 80, "status": "a", "goals_scored": 2, "expected_goals": "1.0"},
                {"id": 2, "code": 22, "web_name": "Renfort", "team": 1, "element_type": 4,
                 "now_cost": 70, "status": "a", "goals_scored": 2, "expected_goals": "1.0"}]}
    fixtures = [{"id": g, "event": g, "finished": g <= 4, "team_h": 1, "team_a": 2}
                for g in range(1, 7)]
    # Régulier : 4 matchs à 5 pts. Renfort : arrive à la journée 3, un match à 12 pts.
    gw = {g: [[1, 90, 5, 0, 0, 0, 0.1, 0.1, 1]] + ([[2, 90, 12 if g == 3 else 1, 0, 0, 0, 0, 0, 1]]
                                                  if g >= 3 else [])
          for g in range(1, 5)}
    past = {"11": [{"season_name": "2023/24", "minutes": 3000, "total_points": 100, "clean_sheets": 0},
                   {"season_name": "2024/25", "minutes": 300, "total_points": 50, "clean_sheets": 0},
                   {"season_name": "2025/26", "minutes": 1800, "total_points": 80, "clean_sheets": 5}]}
    db.load(c, boot, fixtures, gw, past)
    return c


def test_team_games_count_from_arrival(con):
    f = db.player_features(con)
    assert f.at[1, "team_games"] == 4
    assert f.at[2, "team_games"] == 2          # arrivé à la journée 3


def test_concentration(con):
    f = db.player_features(con)
    assert f.at[1, "conc"] == pytest.approx(5 / 20)
    assert f.at[2, "conc"] == pytest.approx(12 / 13)


def test_past_rates_skip_short_seasons_and_weight(con):
    f = db.player_features(con)
    # 2024/25 (300 min) est ignorée : 2025/26 pèse 0,6, 2023/24 pèse 0,3
    r_recent = (80 - 4 * 5) / 1800 * 90
    r_old = 100 / 3000 * 90
    assert f.at[1, "past_non_cs_pp90"] == pytest.approx((0.6 * r_recent + 0.3 * r_old) / 0.9)
    assert f.at[1, "last_minutes"] == 1800
    assert pd.isna(f.at[2, "past_non_cs_pp90"])


def test_team_conversion_bounded(con):
    f = db.player_features(con)
    assert f.at[1, "team_conv"] == pytest.approx(2.0)   # 4 buts / 2 xG


def test_fixture_run(con):
    run = db.fixture_run(con, next_gw=5, horizon=8)
    assert run.at[1, "n_games"] == 2


# ------------------------------------------------------------------ modèle
def test_blend_weights_capped():
    assert model.blend_weights(0) == (0, 0)
    assert model.blend_weights(5) == pytest.approx((0.40, 0.75))
    assert model.blend_weights(30) == (0.70, 0.85)


def test_next_gameweek_uses_official_flags():
    events = [{"id": 1, "finished": True}, {"id": 2, "finished": False, "is_next": True}]
    assert model.next_gameweek(events, []) == (2, 1)


# ------------------------------------------------------------------ API
def test_retry_after_then_success(monkeypatch):
    class R:
        def __init__(self, code, body=None, headers=None):
            self.status_code, self._b, self.headers = code, body, headers or {}

        def json(self):
            return self._b

    answers = [R(503, headers={"Retry-After": "0"}), R(200, {"ok": True})]
    c = api.FplClient(backoff=0)
    monkeypatch.setattr(c.session, "get", lambda *a, **k: answers.pop(0))
    assert c.get("bootstrap-static") == {"ok": True}


def test_forbidden_is_not_retried(monkeypatch):
    calls = []

    class R:
        status_code, headers = 403, {}

    c = api.FplClient(backoff=0)
    monkeypatch.setattr(c.session, "get", lambda *a, **k: calls.append(1) or R())
    with pytest.raises(api.FplApiError):
        c.get("bootstrap-static")
    assert len(calls) == 1


# ------------------------------------------------------------------ bout en bout
def test_end_to_end(api_dir, tmp_path):
    out, cache = str(tmp_path / "out"), str(tmp_path / "cache")
    assert main(["--replay", api_dir, "--out", out, "--cache", cache,
                 "--overrides", "", "-q"]) == 0
    with open(os.path.join(out, "latest.json"), encoding="utf-8") as f:
        res = json.load(f)
    players = {p["id"]: p for p in res["players"]}
    sq = res["squad"]
    ids = sq["xi"] + sq["bench"]
    assert len(ids) == 15 and len(sq["xi"]) == 11
    pos = pd.Series([players[i]["pos"] for i in ids])
    assert pos.value_counts().to_dict() == {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
    assert sum(players[i]["price"] for i in ids) <= res["meta"]["budget"] + 1e-6
    assert pd.Series([players[i]["team"] for i in ids]).value_counts().max() <= MAX_PER_CLUB
    xi_pos = pd.Series([players[i]["pos"] for i in sq["xi"]]).value_counts()
    for p, name in zip([1, 2, 3, 4], ["GK", "DEF", "MID", "FWD"]):
        assert XI_MIN[p] <= xi_pos.get(name, 0) <= XI_MAX[p]
    assert sq["captain"] in sq["xi"] and sq["vice"] in sq["xi"]
    assert players[sq["bench"][0]]["pos"] == "GK"
    assert os.path.exists(os.path.join(out, "fpl_expected_points.csv"))
    assert res["meta"]["next_gw"] == 4 and res["meta"]["gw_played"] == 3

    # valeurs par journée : leur somme sur l'horizon est la valeur du solveur
    gws, h = res["meta"]["gws"], res["meta"]["horizon"]
    assert gws[0] == 4 and len(gws) == 7          # journées 4 à 10 du calendrier test
    for p in res["players"]:
        assert len(p["g"]) == len(gws)
        if p["pool"]:
            assert sum(p["g"][:h]) == pytest.approx(p["ep_opt"], abs=0.1)
    assert sum(SQUAD_QUOTA.values()) == 15
    # tous les joueurs du jeu sont présents, évalués ou non (équipes importées)
    assert len(res["players"]) + len(res["others"]) == 90

    # deuxième passage : tout vient du cache, seules 2 requêtes partent
    assert main(["--replay", api_dir, "--out", out, "--cache", cache,
                 "--overrides", "", "-q"]) == 0
    with open(os.path.join(out, "latest.json"), encoding="utf-8") as f:
        assert json.load(f)["meta"]["api_calls"] == 2


# ------------------------------------------------------------------ disponibilité
def test_availability_by_gameweek():
    from datetime import datetime, timezone
    today = datetime(2026, 11, 25, tzinfo=timezone.utc)
    gws = [13, 14, 15, 16, 17]
    # journées le samedi : 28 nov, 5 déc, 12 déc, 19 déc, 26 déc
    deadlines = {13: datetime(2026, 11, 28, 11, tzinfo=timezone.utc), 14: datetime(2026, 12, 5, 11, tzinfo=timezone.utc),
                 15: datetime(2026, 12, 12, 11, tzinfo=timezone.utc), 16: datetime(2026, 12, 19, 11, tzinfo=timezone.utc),
                 17: datetime(2026, 12, 26, 11, tzinfo=timezone.utc)}
    f = pd.DataFrame([
        {"status": "a", "chance_next": None, "news": ""},                                    # disponible
        {"status": "i", "chance_next": 0, "news": "Hamstring injury - Expected back 10 Dec"},  # retour J15
        {"status": "s", "chance_next": 0, "news": "Suspended until 29 Nov"},                 # 1 match
        {"status": "i", "chance_next": 0, "news": "Knee injury - Unknown return date"},      # rampe
        {"status": "d", "chance_next": 50, "news": "Knock - 50% chance of playing"},         # incertain
    ], index=[1, 2, 3, 4, 5])
    A = model.availability(f, deadlines, gws, today)
    assert A.loc[1].tolist() == [1, 1, 1, 1, 1]
    assert A.loc[2].tolist() == [0, 0, 1, 1, 1]
    assert A.loc[3].tolist() == [0, 1, 1, 1, 1]
    assert A.loc[4].tolist() == [0, 0.25, 0.5, 0.75, 1]
    assert A.loc[5].tolist() == [0.5, 0.75, 1, 1, 1]
    # « Expected back 05 Jan » lu en décembre : janvier de l'année suivante
    assert model.return_date("Expected back 05 Jan", datetime(2026, 12, 20, tzinfo=timezone.utc)).year == 2027
