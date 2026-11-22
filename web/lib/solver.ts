"use client";
import type { Meta, Player } from "./types";
import { HIT, buildLp, forceProblem, lineup, periodValue, type Current, type Settings, type Solution } from "./plan";

type Highs = { solve: (lp: string, opts?: Record<string, unknown>) => { Status: string; Columns: Record<string, { Primal: number }> } };
let loading: Promise<Highs> | null = null;

/** HiGHS compilé en WebAssembly, chargé à la première demande seulement. */
function highs(): Promise<Highs> {
  if (!loading) {
    loading = import("highs").then((m) =>
      (m.default as unknown as (o: object) => Promise<Highs>)({ locateFile: (f: string) => `/solver/${f}` }));
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export class PlanError extends Error {}

/**
 * Équipe optimale, ou, avec `current`, les meilleurs transferts à partir de
 * l'équipe importée : le budget devient banque + valeur des joueurs actuels,
 * et chaque transfert au-delà des gratuits coûte 4 points.
 */
export async function solve(players: Player[], meta: Meta, s: Settings, current?: Current & { maxT: number }): Promise<Solution> {
  const byId = new Map(players.map((p) => [p.id, p]));
  const budget = current
    ? Math.round((current.bank + current.picks.reduce((a, id) => a + (byId.get(id)?.price ?? 0), 0)) * 10) / 10
    : s.budget;
  const eff = { ...s, budget };
  const problem = forceProblem(byId, eff);
  if (problem) throw new PlanError(problem);
  const value = new Map(players.map((p) => [p.id, periodValue(p, meta, s.from, s.to)]));
  const cands = players.filter((p) =>
    (p.pool || s.force.includes(p.id) || current?.picks.includes(p.id)) && !s.exclude.includes(p.id));
  const h = await highs();
  const res = h.solve(buildLp(cands, value, eff, meta.bench_weight, current), { output_flag: false, mip_rel_gap: 0 });
  if (res.Status !== "Optimal") {
    throw new PlanError(current
      ? "Aucune équipe ne respecte ces contraintes avec ce nombre de transferts : autorisez-en plus ou retirez un joueur imposé."
      : "Aucune équipe ne respecte toutes ces contraintes : augmentez le budget ou retirez un joueur imposé.");
  }
  const on = (k: string) => (res.Columns[k]?.Primal ?? 0) > 0.5;
  const squad = cands.filter((p) => on(`s${p.id}`)).map((p) => p.id);
  const xi = cands.filter((p) => on(`x${p.id}`)).map((p) => p.id);
  const sol = lineup(byId, squad, xi, value, budget);
  if (current) {
    // ventes et achats rangés par poste : la ligne i est un transfert réel
    const order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    const byPos = (a: number, b: number) =>
      order[byId.get(a)!.pos] - order[byId.get(b)!.pos] || byId.get(b)!.price - byId.get(a)!.price;
    const bought = squad.filter((id) => !current.picks.includes(id)).sort(byPos);
    sol.moves = {
      in: bought,
      out: current.picks.filter((id) => !squad.includes(id)).sort(byPos),
      hits: Math.max(0, bought.length - current.ft),
      keep: 0,
    };
  }
  return sol;
}

/** Les transferts conseillés, comparés à « garder l'équipe telle quelle ». */
export async function solveTransfers(players: Player[], meta: Meta, s: Settings, current: Current): Promise<Solution> {
  const ft = s.ft ?? current.ft;
  const sol = await solve(players, meta, s, { ...current, ft, maxT: s.maxT });
  // la meilleure composition sans aucun transfert (mêmes joueurs, onze et capitaine optimisés)
  const keep = await solve(players, meta, { ...s, force: [], exclude: [] }, { ...current, ft, maxT: 0 });
  // même mesure que le solveur : onze (capitaine doublé) + un quart du banc
  const bw = meta.bench_weight;
  const r = (x: number) => Math.round(x * 10) / 10;
  sol.moves!.keep = r(keep.ep_xi + bw * keep.ep_bench);
  sol.moves!.with = r(sol.ep_xi + bw * sol.ep_bench);
  return sol;
}

export { HIT };
