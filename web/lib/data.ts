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
 * Données lues à la compilation : chaque matin, le pipeline (GitHub Actions)
 * écrit latest.json, puis Vercel reconstruit le site.
 */
export function getData(): Payload {
  const data = read<Payload>("latest.json");
  if (!data) throw new Error("web/public/data/latest.json manquant : lancez python -m pipeline");
  return upgrade(data);
}

/**
 * Données produites avant la v4.1 (sans valeurs par journée) : on répartit la
 * valeur sur l'horizon pour que le site reste utilisable jusqu'au prochain
 * passage du pipeline.
 */
function upgrade(d: Payload): Payload {
  if (d.meta.gws?.length) return d;
  const h = d.meta.horizon;
  d.meta.gws = Array.from({ length: h }, (_, i) => d.meta.next_gw + i);
  d.meta.bench_weight = 0.25;
  for (const p of d.players) {
    p.pool = p.ep_opt != null;
    p.g = Array(h).fill(Math.round(((p.ep_opt ?? p.ep) / h) * 100) / 100);
  }
  return d;
}

export const CSV_HREF = "/data/fpl_expected_points.csv";
export const getPipelineBacktest = () => read<PipelineBacktest>("pipeline_backtest.json");
export const getIndicatorBacktest = () => read<IndicatorBacktest>("backtest.json");
