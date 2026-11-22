"""Données synthétiques au format de l'API FPL, petites et vérifiables à la main."""

import json
import os
import random

import pytest

N_TEAMS = 6
PER_TEAM = {1: 2, 2: 5, 3: 5, 4: 3}
PLAYED = 3


def _fixtures():
    """Aller simple tournant : chaque équipe joue une fois par journée."""
    teams = list(range(1, N_TEAMS + 1))
    out, fid = [], 1
    for gw in range(1, 11):
        rot = teams[:1] + teams[1:][gw % (N_TEAMS - 1):] + teams[1:][:gw % (N_TEAMS - 1)]
        for k in range(N_TEAMS // 2):
            h, a = rot[k], rot[-k - 1]
            done = gw <= PLAYED
            out.append({"id": fid, "event": gw, "finished": done, "team_h": h, "team_a": a,
                        "team_h_difficulty": 2 + (a % 3), "team_a_difficulty": 2 + (h % 3),
                        "team_h_score": 1 if done else None, "team_a_score": 0 if done else None,
                        "kickoff_time": f"2026-08-{10 + gw:02d}T14:00:00Z"})
            fid += 1
    return out


def build_api(root, seed=1):
    rnd = random.Random(seed)
    teams = [{"id": t, "name": f"Club {t}", "short_name": f"C{t}",
              "strength_defence_home": 1100 + 40 * t, "strength_defence_away": 1100 + 40 * t,
              "strength_attack_home": 1100, "strength_attack_away": 1100}
             for t in range(1, N_TEAMS + 1)]
    elements, live, summaries = [], {gw: [] for gw in range(1, PLAYED + 1)}, {}
    pid = 1
    for t in range(1, N_TEAMS + 1):
        for pos, n in PER_TEAM.items():
            for k in range(n):
                starter = k < {1: 1, 2: 4, 3: 4, 4: 2}[pos]
                price = {1: 45, 2: 45, 3: 55, 4: 60}[pos] + rnd.randint(0, 30)
                pts = tot_min = 0
                for gw in range(1, PLAYED + 1):
                    m = 90 if starter else rnd.choice([0, 0, 15])
                    p = (2 + rnd.randint(0, 6)) if m >= 60 else (1 if m else 0)
                    pts, tot_min = pts + p, tot_min + m
                    live[gw].append({"id": pid, "stats": {
                        "minutes": m, "total_points": p, "clean_sheets": int(m >= 60 and gw == 1),
                        "goals_scored": 0, "assists": 0, "expected_goals": "0.20",
                        "expected_assists": "0.10", "starts": int(m >= 60)}})
                elements.append({
                    "id": pid, "code": 1000 + pid, "web_name": f"P{pid}", "first_name": "Joueur",
                    "second_name": str(pid), "team": t, "element_type": pos, "now_cost": price,
                    "status": "a", "news": "", "chance_of_playing_next_round": None,
                    "penalties_order": 1 if (pos == 4 and k == 0) else None,
                    "selected_by_percent": f"{rnd.uniform(0, 30):.1f}",
                    "transfers_in_event": 0, "transfers_out_event": 0,
                    "total_points": pts, "goals_scored": 0, "assists": 0,
                    "expected_goals": f"{0.2 * PLAYED:.2f}", "expected_assists": f"{0.1 * PLAYED:.2f}",
                    "expected_goal_involvements": f"{0.3 * PLAYED:.2f}"})
                summaries[pid] = {"history_past": [
                    {"season_name": "2025/26", "minutes": 2700 if starter else 500,
                     "total_points": 120 if starter else 15, "goals_scored": 3, "assists": 2,
                     "clean_sheets": 8, "expected_goals": "3.00", "expected_assists": "2.00"}]}
                pid += 1
    events = [{"id": i, "finished": i <= PLAYED, "data_checked": i <= PLAYED,
               "is_next": i == PLAYED + 1, "deadline_time": f"2026-08-{10 + i:02d}T10:00:00Z"}
              for i in range(1, 11)]

    def dump(rel, obj):
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f)

    dump("bootstrap-static.json", {"events": events, "teams": teams, "elements": elements})
    dump("fixtures.json", _fixtures())
    for gw, els in live.items():
        dump(f"event/{gw}/live.json", {"elements": els})
    for i, s in summaries.items():
        dump(f"element-summary/{i}.json", s)
    return root


@pytest.fixture
def api_dir(tmp_path):
    return build_api(str(tmp_path / "api"))
