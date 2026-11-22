import type { Pos } from "./types";

export const POS_LABEL: Record<Pos, string> = { GK: "Gardien", DEF: "Défenseur", MID: "Milieu", FWD: "Attaquant" };
export const POS_SHAPE: Record<Pos, "hexagon" | "square" | "diamond" | "triangle"> = {
  GK: "hexagon", DEF: "square", MID: "diamond", FWD: "triangle",
};
export const POS_ORDER: Pos[] = ["GK", "DEF", "MID", "FWD"];

const nf = (d: number) => new Intl.NumberFormat("fr-BE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const num = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "—" : nf(d).format(v));
export const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${nf(d).format(v * 100)} %`);
export const price = (v: number) => `£${nf(1).format(v)}m`;
export const signed = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(d).format(Math.abs(v))}`;
export const pad2 = (n: number) => String(n).padStart(2, "0");

export function dateFr(iso: string) {
  return new Intl.DateTimeFormat("fr-BE", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels",
  }).format(new Date(iso));
}

export const STATUS: Record<string, string> = {
  a: "Disponible", d: "Incertain", i: "Blessé", s: "Suspendu", u: "Indisponible", n: "Non inscrit",
};

export const MOTIF: Record<string, string> = {
  minutes: "Hors du pool d'optimisation : part de minutes projetée sous 70 %.",
  finition: "Hors du pool : gros écart xG chez un finisseur historiquement faible.",
};
