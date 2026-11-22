"""
Construit une « API FPL rejouée » à partir des archives publiques
vaastav/Fantasy-Premier-League, pour développer et tester le pipeline sans
accès réseau à fantasy.premierleague.com.

Le dossier produit imite l'arborescence de l'API :
    <out>/bootstrap-static.json
    <out>/fixtures.json
    <out>/event/<gw>/live.json
    <out>/element-summary/<id>.json

On se place à la fin d'une journée donnée (--cutoff) : les totaux, les prix et
les matchs « terminés » sont recalculés à cette date, comme si l'API était
interrogée ce jour-là.

Usage :
    python scripts/build_replay.py --season-dir ARCHIVE/2025-26 \
        --past ARCHIVE/2024-25/merged_gw.csv ARCHIVE/2023-24/merged_gw.csv \
        --cutoff 5 --out .replay
"""

import argparse
import json
import os
import unicodedata

import pandas as pd

LIVE_FIELDS = ["minutes", "goals_scored", "assists", "clean_sheets", "goals_conceded",
               "own_goals", "penalties_saved", "penalties_missed", "yellow_cards",
               "red_cards", "saves", "bonus", "bps", "starts", "total_points",
               "defensive_contribution"]
XFIELDS = ["expected_goals", "expected_assists", "expected_goal_involvements",
           "expected_goals_conceded"]


def norm(name):
    """Nom sans accents ni casse : « Raya Martín » et « Raya Martin » se rejoignent."""
    s = unicodedata.normalize("NFKD", str(name))
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season-dir", required=True)
    ap.add_argument("--past", nargs="*", default=[],
                    help="merged_gw.csv des saisons passées, de la plus récente à la plus ancienne")
    ap.add_argument("--past-names", nargs="*", default=["2024/25", "2023/24"],
                    help="noms des saisons passées, dans le même ordre que --past")
    ap.add_argument("--cutoff", type=int, default=5)
    ap.add_argument("--out", default=".replay")
    a = ap.parse_args()

    raw = pd.read_csv(os.path.join(a.season_dir, "players_raw.csv"))
    teams = pd.read_csv(os.path.join(a.season_dir, "teams.csv"))
    fx = pd.read_csv(os.path.join(a.season_dir, "fixtures.csv"))
    gw = pd.read_csv(os.path.join(a.season_dir, "merged_gw.csv"))
    gw = gw[gw["GW"] <= a.cutoff].drop_duplicates(["element", "fixture"])
    # L'archive donne le club de FIN de saison : on reprend celui du cutoff
    # (Semenyo à Bournemouth, pas à City) et on retire les joueurs arrivés après.
    team_id = dict(zip(teams["name"], teams["id"]))
    club_at_cutoff = (gw.sort_values("GW").groupby("element")["team"].last()
                        .map(team_id))
    raw = raw[raw["id"].isin(club_at_cutoff.index)].copy()
    raw["team"] = raw["id"].map(club_at_cutoff).astype(int)

    # --- event/<gw>/live : une ligne par joueur et par journée (double = somme)
    for g, part in gw.groupby("GW"):
        agg = part.groupby("element").agg({**{c: "sum" for c in LIVE_FIELDS if c in part},
                                           **{c: "sum" for c in XFIELDS}})
        elements = []
        for pid, r in agg.iterrows():
            st = {c: int(r[c]) for c in LIVE_FIELDS if c in agg}
            st.update({c: f"{r[c]:.2f}" for c in XFIELDS})
            elements.append({"id": int(pid), "stats": st, "explain": []})
        dump(os.path.join(a.out, "event", str(int(g)), "live.json"), {"elements": elements})

    # --- bootstrap-static : totaux, prix et propriétaires à la date du cutoff
    tot = gw.groupby("element").agg(
        minutes=("minutes", "sum"), total_points=("total_points", "sum"),
        goals_scored=("goals_scored", "sum"), assists=("assists", "sum"),
        clean_sheets=("clean_sheets", "sum"), starts=("starts", "sum"),
        expected_goals=("expected_goals", "sum"), expected_assists=("expected_assists", "sum"),
        expected_goal_involvements=("expected_goal_involvements", "sum"))
    last = gw.sort_values("GW").groupby("element").last()
    total_managers = 10_000_000
    elements = []
    for _, p in raw.iterrows():
        pid = int(p["id"])
        t = tot.loc[pid] if pid in tot.index else None
        l = last.loc[pid] if pid in last.index else None
        e = {k: (None if pd.isna(p[k]) else p[k].item() if hasattr(p[k], "item") else p[k])
             for k in ["id", "code", "web_name", "first_name", "second_name", "team",
                       "element_type", "penalties_order", "news"]}
        e["news"] = ""  # l'archive donne les nouvelles de fin de saison : inutilisables ici
        e["status"] = "a"
        e["chance_of_playing_next_round"] = None
        e["now_cost"] = int(l["value"]) if l is not None else int(p["now_cost"])
        e["selected_by_percent"] = f"{(l['selected'] / total_managers * 100) if l is not None else 0:.1f}"
        e["transfers_in_event"] = int(l["transfers_in"]) if l is not None else 0
        e["transfers_out_event"] = int(l["transfers_out"]) if l is not None else 0
        for c in ["minutes", "total_points", "goals_scored", "assists", "clean_sheets", "starts"]:
            e[c] = int(t[c]) if t is not None else 0
        for c in XFIELDS[:3]:
            e[c] = f"{t[c]:.2f}" if t is not None else "0.00"
        elements.append(e)
    tlist = [{k: (v.item() if hasattr(v, "item") else v) for k, v in r.items()
              if k in ["id", "name", "short_name", "strength_defence_home",
                       "strength_defence_away", "strength_attack_home", "strength_attack_away"]}
             for r in teams.to_dict("records")]
    kick = fx.dropna(subset=["event"]).groupby("event")["kickoff_time"].min()
    events = [{"id": i, "finished": i <= a.cutoff, "data_checked": i <= a.cutoff,
               "is_next": i == a.cutoff + 1, "is_current": i == a.cutoff,
               "deadline_time": kick.get(i)} for i in range(1, 39)]
    dump(os.path.join(a.out, "bootstrap-static.json"),
         {"events": events, "teams": tlist, "elements": elements,
          "element_types": [{"id": 1, "singular_name_short": "GKP"},
                            {"id": 2, "singular_name_short": "DEF"},
                            {"id": 3, "singular_name_short": "MID"},
                            {"id": 4, "singular_name_short": "FWD"}],
          "total_players": total_managers})

    # --- fixtures
    fixtures = []
    for r in fx.to_dict("records"):
        ev = None if pd.isna(r["event"]) else int(r["event"])
        done = ev is not None and ev <= a.cutoff
        fixtures.append({"id": int(r["id"]), "event": ev, "finished": done,
                         "team_h": int(r["team_h"]), "team_a": int(r["team_a"]),
                         "team_h_difficulty": int(r["team_h_difficulty"]),
                         "team_a_difficulty": int(r["team_a_difficulty"]),
                         "team_h_score": int(r["team_h_score"]) if done else None,
                         "team_a_score": int(r["team_a_score"]) if done else None,
                         "kickoff_time": r["kickoff_time"]})
    dump(os.path.join(a.out, "fixtures.json"), fixtures)

    # --- element-summary : history_past reconstruit par nom depuis les archives
    past_by_name = {}
    for path, season in zip(a.past, a.past_names):
        m = pd.read_csv(path)
        agg = m.groupby("name").agg(
            minutes=("minutes", "sum"), total_points=("total_points", "sum"),
            goals_scored=("goals_scored", "sum"), assists=("assists", "sum"),
            clean_sheets=("clean_sheets", "sum"), expected_goals=("expected_goals", "sum"),
            expected_assists=("expected_assists", "sum"), end_cost=("value", "last"))
        for name, r in agg.iterrows():
            past_by_name.setdefault(norm(name), []).append({
                "season_name": season, "minutes": int(r["minutes"]),
                "total_points": int(r["total_points"]), "goals_scored": int(r["goals_scored"]),
                "assists": int(r["assists"]), "clean_sheets": int(r["clean_sheets"]),
                "expected_goals": f"{r['expected_goals']:.2f}",
                "expected_assists": f"{r['expected_assists']:.2f}",
                "end_cost": int(r["end_cost"])})
    # history = matchs de la saison en cours (format element-summary), pour
    # comparer le pipeline au script d'origine qui en dépendait
    cur = {pid: [{"fixture": int(r["fixture"]), "round": int(r["GW"]),
                  "minutes": int(r["minutes"]), "total_points": int(r["total_points"]),
                  "clean_sheets": int(r["clean_sheets"]),
                  "goals_scored": int(r["goals_scored"]), "assists": int(r["assists"])}
                 for r in part.sort_values("kickoff_time").to_dict("records")]
           for pid, part in gw.groupby("element")}
    for _, p in raw.iterrows():
        name = f"{p['first_name']} {p['second_name']}"
        hist = sorted(past_by_name.get(norm(name), []), key=lambda s: s["season_name"])
        for s in hist:
            s["element_code"] = int(p["code"])
        dump(os.path.join(a.out, "element-summary", f"{int(p['id'])}.json"),
             {"history_past": hist, "history": cur.get(int(p["id"]), []), "fixtures": []})

    print(f"Replay écrit dans {a.out} : {len(elements)} joueurs, GW1-{a.cutoff}")


if __name__ == "__main__":
    main()
