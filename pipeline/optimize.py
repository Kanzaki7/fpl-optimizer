"""
Choix des 15 joueurs par programmation linéaire en nombres entiers (PuLP).

  max  EP(XI) + 0,25 × EP(banc)
  sous budget, 2 GK / 5 DEF / 5 MID / 3 FWD, au plus 3 joueurs par club,
  un XI valide (1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD).
"""

import pulp

from .config import (BENCH_WEIGHT, MAX_PER_CLUB, SQUAD_QUOTA, XI_MAX, XI_MIN)


class InfeasibleSquad(RuntimeError):
    pass


def _solver():
    """
    HiGHS (pip install highspy) en priorité : c'est le solveur de PuLP 4 et il
    tourne en mémoire. Sinon CBC, livré avec PuLP 3.
    """
    if hasattr(pulp, "HiGHS"):
        s = pulp.HiGHS(msg=False)
        if s.available():
            return s
    if hasattr(pulp, "PULP_CBC_CMD"):
        return pulp.PULP_CBC_CMD(msg=False)
    raise RuntimeError("Aucun solveur : pip install highspy (ou \"pulp<4\" pour CBC)")


def optimize_squad(df, budget=100.0, bench_weight=BENCH_WEIGHT, force=(), exclude=()):
    """Renvoie (ids des 15, ids du XI)."""
    df = df[~df.index.isin(list(exclude))]
    ids = df.index.tolist()
    prob = pulp.LpProblem("FPL", pulp.LpMaximize)

    def binary(name):
        if hasattr(prob, "add_variable"):          # PuLP 4
            return prob.add_variable(name, cat="Binary")
        return pulp.LpVariable(name, cat="Binary")

    squad = {i: binary(f"squad_{i}") for i in ids}
    xi = {i: binary(f"xi_{i}") for i in ids}
    ep, price = df["ep"].to_dict(), df["price"].to_dict()
    pos, club = df["pos_id"].to_dict(), df["team_id"].to_dict()

    prob += pulp.lpSum(xi[i] * ep[i] + (squad[i] - xi[i]) * ep[i] * bench_weight for i in ids)
    prob += pulp.lpSum(squad[i] * price[i] for i in ids) <= budget
    prob += pulp.lpSum(xi.values()) == 11
    for i in ids:
        prob += xi[i] <= squad[i]
    for p, quota in SQUAD_QUOTA.items():
        p_ids = [i for i in ids if pos[i] == p]
        prob += pulp.lpSum(squad[i] for i in p_ids) == quota
        prob += pulp.lpSum(xi[i] for i in p_ids) >= XI_MIN[p]
        prob += pulp.lpSum(xi[i] for i in p_ids) <= XI_MAX[p]
    for c in set(club.values()):
        prob += pulp.lpSum(squad[i] for i in ids if club[i] == c) <= MAX_PER_CLUB
    for i in force:
        if i not in squad:
            raise InfeasibleSquad(f"joueur {i} absent du pool (filtré ou inconnu)")
        prob += squad[i] == 1

    status = prob.solve(_solver())
    code = getattr(status, "status", status)       # PuLP 4 : objet de stats
    code = getattr(code, "value", code)
    if int(code) != 1:
        raise InfeasibleSquad(f"pas de solution optimale (statut {status})")
    squad_ids = [i for i in ids if (squad[i].value() or 0) > 0.5]
    xi_ids = [i for i in ids if (xi[i].value() or 0) > 0.5]
    return squad_ids, xi_ids


def lineup(pool, squad_ids, xi_ids, budget):
    """Capitaine, vice, formation et ordre du banc (GK remplaçant en premier)."""
    sq = pool.loc[squad_ids]
    xi = sq.loc[xi_ids].sort_values("ep", ascending=False)
    bench = sq.drop(index=xi_ids)
    bench = (bench.assign(_gk=bench["pos_id"] != 1)
             .sort_values(["_gk", "ep"], ascending=[True, False]))
    n = xi["pos_id"].value_counts()
    return {
        "xi": xi.sort_values(["pos_id", "ep"], ascending=[True, False]).index.tolist(),
        "bench": bench.index.tolist(),
        "captain": int(xi.index[0]),
        "vice": int(xi.index[1]),
        "formation": f"{n.get(2, 0)}-{n.get(3, 0)}-{n.get(4, 0)}",
        "cost": round(float(sq["price"].sum()), 1),
        "bank": round(budget - float(sq["price"].sum()), 1),
        # le capitaine compte double
        "ep_xi": round(float(xi["ep"].sum() + xi["ep"].iloc[0]), 1),
        "ep_bench": round(float(bench["ep"].sum()), 1),
    }
