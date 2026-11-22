/**
 * Choix de l'équipe dans le navigateur : même programme linéaire que
 * pipeline/optimize.py, sur les valeurs par journée exportées par le pipeline.
 */
import type { Meta, Player, Squad } from "./types";

export interface Settings {
  from: number;
  to: number;
  budget: number;
  force: number[];
  exclude: number[];
  /** « optimal » : équipe idéale ; « mine » : transferts à partir de l'équipe importée */
  mode: "optimal" | "mine";
  entry: number | null;
  /** transferts gratuits (null = estimation de l'import) et maximum de transferts */
  ft: number | null;
  maxT: number;
}

/** Équipe de départ pour le calcul des transferts. */
export interface Current {
  picks: number[];
  bank: number;
  ft: number;
}

export const HIT = 4;

export const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 } as const;
const XI_MIN = { GK: 1, DEF: 3, MID: 2, FWD: 1 } as const;
const XI_MAX = { GK: 1, DEF: 5, MID: 5, FWD: 3 } as const;
const MAX_PER_CLUB = 3;

export function defaults(meta: Meta): Settings {
  const from = meta.gws[0];
  return {
    from, to: Math.min(from + meta.horizon - 1, meta.gws[meta.gws.length - 1]), budget: meta.budget,
    force: [], exclude: [], mode: "optimal", entry: null, ft: null, maxT: 2,
  };
}

export function sameSettings(a: Settings, b: Settings) {
  const ids = (x: number[]) => [...x].sort().join(",");
  return a.from === b.from && a.to === b.to && Math.abs(a.budget - b.budget) < 1e-6 &&
    ids(a.force) === ids(b.force) && ids(a.exclude) === ids(b.exclude) &&
    a.mode === b.mode && a.entry === b.entry && a.ft === b.ft && a.maxT === b.maxT;
}

/** Points attendus d'un joueur sur la période (somme des journées). */
export function periodValue(p: Player, meta: Meta, from: number, to: number) {
  const a = from - meta.gws[0], b = to - meta.gws[0];
  let s = 0;
  for (let i = Math.max(0, a); i <= b && i < p.g.length; i++) s += p.g[i];
  return s;
}

const term = (c: number, v: string) => `${c < 0 ? "-" : "+"} ${Math.abs(c).toFixed(5)} ${v}`;

/** Modèle au format LP (CPLEX), lisible par HiGHS. */
export function buildLp(cands: Player[], value: Map<number, number>, s: Settings, benchWeight: number,
  current?: { picks: number[]; ft: number; maxT: number }) {
  const L: string[] = ["Maximize", " obj:"];
  for (const p of cands) {
    const v = value.get(p.id) ?? 0;
    L.push(`  ${term(v * (1 - benchWeight), `x${p.id}`)} ${term(v * benchWeight, `s${p.id}`)}`);
  }
  if (current) L.push(`  - ${HIT} pen`);
  L.push("Subject To");
  if (current) {
    // chaque joueur acheté au-delà des transferts gratuits coûte 4 points
    const buys = cands.filter((p) => !current.picks.includes(p.id)).map((p) => `+ s${p.id}`).join(" ") || "+ 0 pen";
    L.push(` gratuits: ${buys} - pen <= ${current.ft}`);
    L.push(` plafond: ${buys} <= ${current.maxT}`);
  }
  // prix en dixièmes pour éviter les erreurs d'arrondi (5.5 + 4.5 …)
  L.push(` budget: ${cands.map((p) => `+ ${Math.round(p.price * 10)} s${p.id}`).join(" ")} <= ${Math.round(s.budget * 10)}`);
  L.push(` onze: ${cands.map((p) => `+ x${p.id}`).join(" ")} = 11`);
  for (const p of cands) L.push(` lien${p.id}: x${p.id} - s${p.id} <= 0`);
  for (const pos of Object.keys(QUOTA) as (keyof typeof QUOTA)[]) {
    const ps = cands.filter((p) => p.pos === pos);
    const sum = (v: string) => ps.map((p) => `+ ${v}${p.id}`).join(" ") || "+ 0 x0";
    L.push(` q${pos}: ${sum("s")} = ${QUOTA[pos]}`);
    L.push(` min${pos}: ${sum("x")} >= ${XI_MIN[pos]}`);
    L.push(` max${pos}: ${sum("x")} <= ${XI_MAX[pos]}`);
  }
  const clubs = new Map<number, Player[]>();
  for (const p of cands) clubs.set(p.team_id, [...(clubs.get(p.team_id) ?? []), p]);
  for (const [t, ps] of clubs) L.push(` club${t}: ${ps.map((p) => `+ s${p.id}`).join(" ")} <= ${MAX_PER_CLUB}`);
  for (const id of s.force) if (cands.some((p) => p.id === id)) L.push(` impose${id}: s${id} = 1`);
  if (current) L.push("Bounds", " 0 <= pen <= 15", "General", " pen");
  L.push("Binary");
  L.push(" " + cands.flatMap((p) => [`s${p.id}`, `x${p.id}`]).join(" "));
  L.push("End");
  return L.join("\n");
}

export type Solution = Squad & {
  value: Map<number, number>;
  /** mode « mon équipe » : transferts conseillés */
  moves?: { out: number[]; in: number[]; hits: number; keep: number; with?: number };
};

/** Capitaine, vice, formation et banc, comme optimize.lineup côté Python. */
export function lineup(byId: Map<number, Player>, squadIds: number[], xiIds: number[], value: Map<number, number>, budget: number): Solution {
  const v = (id: number) => value.get(id) ?? 0;
  const xi = [...xiIds].sort((a, b) => v(b) - v(a));
  const bench = squadIds.filter((id) => !xiIds.includes(id))
    .sort((a, b) => (byId.get(a)!.pos === "GK" ? 0 : 1) - (byId.get(b)!.pos === "GK" ? 0 : 1) || v(b) - v(a));
  const order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const count = (pos: string) => xi.filter((id) => byId.get(id)!.pos === pos).length;
  const cost = squadIds.reduce((a, id) => a + byId.get(id)!.price, 0);
  return {
    xi: [...xi].sort((a, b) => order[byId.get(a)!.pos] - order[byId.get(b)!.pos] || v(b) - v(a)),
    bench,
    captain: xi[0],
    vice: xi[1],
    formation: `${count("DEF")}-${count("MID")}-${count("FWD")}`,
    cost: Math.round(cost * 10) / 10,
    bank: Math.abs(budget - cost) < 0.05 ? 0 : Math.round((budget - cost) * 10) / 10,
    ep_xi: Math.round((xi.reduce((a, id) => a + v(id), 0) + v(xi[0])) * 10) / 10,
    ep_bench: Math.round(bench.reduce((a, id) => a + v(id), 0) * 10) / 10,
    value,
  };
}

/** Pourquoi les joueurs imposés ne peuvent pas tenir ensemble, en clair. */
export function forceProblem(byId: Map<number, Player>, s: Settings): string | null {
  const ps = s.force.map((id) => byId.get(id)).filter(Boolean) as Player[];
  if (ps.length > 15) return "Plus de 15 joueurs imposés.";
  for (const pos of Object.keys(QUOTA) as (keyof typeof QUOTA)[]) {
    const n = ps.filter((p) => p.pos === pos).length;
    if (n > QUOTA[pos]) return `Trop de joueurs imposés au poste ${pos} : ${n} pour ${QUOTA[pos]} places.`;
  }
  const clubs = new Map<string, number>();
  for (const p of ps) clubs.set(p.team, (clubs.get(p.team) ?? 0) + 1);
  for (const [t, n] of clubs) if (n > MAX_PER_CLUB) return `${n} joueurs imposés de ${t} : le règlement en autorise 3.`;
  const cost = ps.reduce((a, p) => a + p.price, 0);
  if (cost > s.budget + 1e-9) return `Les joueurs imposés coûtent déjà £${cost.toFixed(1)}m, plus que le budget.`;
  return null;
}

const ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 } as const;

/** Meilleur onze possible parmi 15 joueurs donnés (toutes les formations valides). */
export function bestLineup(byId: Map<number, Player>, squadIds: number[], value: Map<number, number>, budget: number): Solution {
  const v = (id: number) => value.get(id) ?? 0;
  const by = (pos: keyof typeof QUOTA) => squadIds.filter((id) => byId.get(id)?.pos === pos).sort((a, b) => v(b) - v(a));
  const g = by("GK"), d = by("DEF"), m = by("MID"), f = by("FWD");
  let best: number[] = [], bestV = -Infinity;
  for (let nd = XI_MIN.DEF; nd <= Math.min(XI_MAX.DEF, d.length); nd++)
    for (let nf = XI_MIN.FWD; nf <= Math.min(XI_MAX.FWD, f.length); nf++) {
      const nm = 10 - nd - nf;
      if (nm < XI_MIN.MID || nm > Math.min(XI_MAX.MID, m.length)) continue;
      const xi = [...g.slice(0, 1), ...d.slice(0, nd), ...m.slice(0, nm), ...f.slice(0, nf)];
      const t = xi.reduce((a, id) => a + v(id), 0);
      if (t > bestV) { bestV = t; best = xi; }
    }
  return lineup(byId, squadIds, best, value, budget);
}

/** Différence entre l'équipe d'origine et le brouillon, en transferts appariés par poste. */
export function diff(byId: Map<number, Player>, original: number[], draft: number[]) {
  const sort = (a: number, b: number) =>
    ORDER[byId.get(a)!.pos] - ORDER[byId.get(b)!.pos] || byId.get(b)!.price - byId.get(a)!.price;
  const out = original.filter((id) => !draft.includes(id)).sort(sort);
  const inn = draft.filter((id) => !original.includes(id)).sort(sort);
  return out.map((o, i) => [o, inn[i]] as [number, number]);
}
