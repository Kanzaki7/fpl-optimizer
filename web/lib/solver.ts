"use client";
import type { Meta, Player } from "./types";
import { buildLp, forceProblem, lineup, periodValue, type Settings, type Solution } from "./plan";

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

export async function solve(players: Player[], meta: Meta, s: Settings): Promise<Solution> {
  const byId = new Map(players.map((p) => [p.id, p]));
  const problem = forceProblem(byId, s);
  if (problem) throw new PlanError(problem);
  const value = new Map(players.map((p) => [p.id, periodValue(p, meta, s.from, s.to)]));
  const cands = players.filter((p) => (p.pool || s.force.includes(p.id)) && !s.exclude.includes(p.id));
  const h = await highs();
  const res = h.solve(buildLp(cands, value, s, meta.bench_weight), { output_flag: false, mip_rel_gap: 0 });
  if (res.Status !== "Optimal") {
    throw new PlanError("Aucune équipe ne respecte toutes ces contraintes : augmentez le budget ou retirez un joueur imposé.");
  }
  const on = (k: string) => (res.Columns[k]?.Primal ?? 0) > 0.5;
  const squad = cands.filter((p) => on(`s${p.id}`)).map((p) => p.id);
  const xi = cands.filter((p) => on(`x${p.id}`)).map((p) => p.id);
  return lineup(byId, squad, xi, value, s.budget);
}
