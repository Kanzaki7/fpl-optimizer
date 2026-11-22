import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { IndicatorBacktest, Payload, PipelineBacktest } from "./types";

const DIR = path.join(process.cwd(), "public", "data");

function read<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Données lues à la compilation : le pipeline (GitHub Actions) écrit
 * latest.json puis Vercel reconstruit le site. Sans données réelles, on
 * affiche la démonstration rejouée sur la saison 2025/26.
 */
export function getData(): { data: Payload; demo: boolean } {
  const latest = read<Payload>("latest.json");
  if (latest && latest.meta.source === "api") return { data: latest, demo: false };
  const demo = read<Payload>("demo.json");
  if (!demo) throw new Error("Aucune donnée : lancez python -m pipeline");
  return { data: demo, demo: true };
}

/** CSV complet de la même exécution que les données affichées. */
export function csvHref(demo: boolean) {
  const file = demo ? "demo.csv" : "fpl_expected_points.csv";
  return fs.existsSync(path.join(DIR, file)) ? `/data/${file}` : null;
}
export const getPipelineBacktest = () => read<PipelineBacktest>("pipeline_backtest.json");
export const getIndicatorBacktest = () => read<IndicatorBacktest>("backtest.json");
