"use client";
import { useState } from "react";
import type { IndicatorBacktest, PipelineBacktest } from "@/lib/types";
import { num } from "@/lib/format";

type Tip = { x: number; y: number; lines: string[] } | null;

function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="tip" style={{ left: `${tip.x}%`, top: `${tip.y}%` }}>
      {tip.lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

/** Équipe du modèle vs choix de la foule vs idéal a posteriori, par fenêtre de 8 journées. */
export function BacktestBars({ data }: { data: PipelineBacktest }) {
  const [tip, setTip] = useState<Tip>(null);
  const W = 900, H = 300, L = 34, B = 26, T = 10;
  const max = Math.ceil(Math.max(...data.rows.map((r) => r.hindsight)) / 100) * 100;
  const gw = (W - L) / data.rows.length;
  const bw = Math.min(30, (gw - 24) / 3);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = Array.from({ length: max / 200 + 1 }, (_, i) => i * 200);
  const series = [
    { k: "model" as const, label: "Modèle", fill: "var(--accent)", stroke: "none" },
    { k: "popular" as const, label: "Les plus sélectionnés", fill: "var(--ink2)", stroke: "none" },
    { k: "hindsight" as const, label: "Idéal a posteriori", fill: "transparent", stroke: "var(--ink3)" },
  ];
  return (
    <>
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.k}><i style={{ background: s.fill, border: s.stroke !== "none" ? `1px dashed ${s.stroke}` : undefined }} />{s.label}</span>
        ))}
      </div>
      <div className="chart wide" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Points marqués sur 8 journées : modèle ${data.total.model}, plus sélectionnés ${data.total.popular}, idéal ${data.total.hindsight}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" />
              <text x={L - 6} y={y(t) + 3.5} textAnchor="end">{t}</text>
            </g>
          ))}
          {data.rows.map((r, i) => {
            const x0 = L + i * gw + (gw - 3 * bw - 4) / 2;
            return (
              <g key={r.cutoff}>
                {series.map((s, j) => {
                  const v = r[s.k], x = x0 + j * (bw + 2), top = y(v);
                  return (
                    <path key={s.k}
                      d={`M${x} ${y(0)}V${top + 3}q0 -3 3 -3h${bw - 6}q3 0 3 3V${y(0)}`}
                      fill={s.fill} stroke={s.stroke} strokeDasharray={s.stroke !== "none" ? "3 2" : undefined} />
                  );
                })}
                <rect x={L + i * gw} y={T} width={gw} height={H - T - B} fill="transparent"
                  onMouseEnter={() => setTip({ x: ((L + i * gw + gw / 2) / W) * 100, y: (y(r.hindsight) / H) * 100,
                    lines: [`J${r.gws}`, `Modèle ${r.model} · foule ${r.popular}`, `Idéal ${r.hindsight} · capitaine ${r.captain}`] })} />
                <text x={L + i * gw + gw / 2} y={H - 8} textAnchor="middle">J{r.gws}</text>
              </g>
            );
          })}
          <line x1={L} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        </svg>
        <TipBox tip={tip} />
      </div>
    </>
  );
}

/** Corrélation de chaque indicateur avec les points des 8 journées suivantes. */
export function IndicatorCharts({ data }: { data: IndicatorBacktest }) {
  const [cut, setCut] = useState(data.cutoffs[0]);
  const [tip, setTip] = useState<Tip>(null);
  const [tip2, setTip2] = useState<Tip>(null);
  const ind = data.indicators.filter((r) => r.cutoff === cut).sort((a, b) => b.corr - a.corr);
  const blend = data.blend.filter((r) => r.cutoff === cut);
  const bench = data.bench.find((b) => b.cutoff === cut);

  // barres horizontales centrées sur 0
  const W = 420, rowH = 26, L = 150, H = ind.length * rowH + 20;
  const lo = -0.4, hi = 0.6;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - 34);

  // courbe du mélange
  const W2 = 420, H2 = 200, L2 = 40, B2 = 26, T2 = 12;
  const cs = blend.map((b) => b.corr);
  const ymin = Math.floor(Math.min(...cs) * 50) / 50 - 0.01, ymax = Math.ceil(Math.max(...cs) * 50) / 50 + 0.01;
  const px = (w: number) => L2 + w * (W2 - L2 - 12);
  const py = (c: number) => T2 + (1 - (c - ymin) / (ymax - ymin)) * (H2 - T2 - B2);
  const best = blend.reduce((a, b) => (b.corr > a.corr ? b : a), blend[0]);

  return (
    <>
      <div className="tabs seg" role="group" aria-label="Journée de référence">
        {data.cutoffs.map((c) => (
          <button key={c} aria-pressed={c === cut} onClick={() => setCut(c)}>APRÈS J{c}</button>
        ))}
      </div>
      <div className="two">
        <div className="panel chart-card">
          <h3>Ce qui prédit les points</h3>
          <p className="sub">Corrélation de rang (Spearman) avec les points des {data.horizon} journées suivantes. 0 = aucun lien.</p>
          <div className="chart" onMouseLeave={() => setTip(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Corrélation de chaque indicateur avec les points futurs">
              <line x1={x(0)} x2={x(0)} y1={0} y2={H - 14} stroke="var(--line)" />
              {[-0.2, 0.2, 0.4].map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={0} y2={H - 14} stroke="var(--line-soft)" />
                  <text x={x(t)} y={H - 2} textAnchor="middle">{num(t, 1)}</text>
                </g>
              ))}
              {ind.map((r, i) => {
                const yy = i * rowH + 4, a = x(Math.min(0, r.corr)), b = x(Math.max(0, r.corr));
                const key = r.label === "part de minutes";
                return (
                  <g key={r.label} onMouseEnter={() => setTip({ x: (b / W) * 100, y: ((yy + 4) / H) * 100, lines: [r.label, `corrélation ${num(r.corr, 3)}`, `${r.n} joueurs`] })}>
                    <rect x={0} y={yy - 3} width={W} height={rowH} fill="transparent" />
                    <text x={L - 10} y={yy + 12} textAnchor="end" style={{ fill: "var(--ink2)" }}>{r.label}</text>
                    <rect x={a} y={yy + 3} width={Math.max(2, b - a)} height={12} rx={2}
                      fill={key ? "var(--accent)" : "var(--ink2)"} />
                    <text x={r.corr >= 0 ? b + 5 : a - 5} y={yy + 13} textAnchor={r.corr >= 0 ? "start" : "end"} style={{ fill: "var(--ink)" }}>{num(r.corr, 2)}</text>
                  </g>
                );
              })}
            </svg>
            <TipBox tip={tip} />
          </div>
        </div>

        <div className="panel chart-card">
          <h3>Quelle place pour le xG ?</h3>
          <p className="sub">Corrélation selon la part du jeu produit (xG, xA) dans le mélange avec les points réels.</p>
          <div className="chart" onMouseLeave={() => setTip2(null)}>
            <svg viewBox={`0 0 ${W2} ${H2}`} role="img" aria-label={`Meilleur mélange : ${best.w * 100} % de xG`}>
              {[ymin + 0.01, (ymin + ymax) / 2, ymax - 0.01].map((t) => (
                <g key={t}>
                  <line x1={L2} x2={W2} y1={py(t)} y2={py(t)} stroke="var(--line-soft)" />
                  <text x={L2 - 6} y={py(t) + 3.5} textAnchor="end">{num(t, 2)}</text>
                </g>
              ))}
              <line x1={px(0.6)} x2={px(0.6)} y1={T2} y2={H2 - B2} stroke="var(--accent)" strokeDasharray="3 3" />
              <text x={px(0.6) + 4} y={T2 + 8} style={{ fill: "var(--accent-ink)" }}>modèle : 60 %</text>
              <polyline fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round"
                points={blend.map((b) => `${px(b.w)},${py(b.corr)}`).join(" ")} />
              {blend.map((b) => (
                <g key={b.w} onMouseEnter={() => setTip2({ x: (px(b.w) / W2) * 100, y: (py(b.corr) / H2) * 100, lines: [`${b.w * 100} % de xG`, `corrélation ${num(b.corr, 3)}`] })}>
                  <rect x={px(b.w) - 18} y={0} width={36} height={H2} fill="transparent" />
                  <circle cx={px(b.w)} cy={py(b.corr)} r={b === best ? 5 : 4} fill={b === best ? "var(--accent)" : "var(--surface)"} stroke="var(--ink)" strokeWidth={1.5} />
                  <text x={px(b.w)} y={H2 - 8} textAnchor="middle">{b.w * 100} %</text>
                </g>
              ))}
            </svg>
            <TipBox tip={tip2} />
          </div>
          {bench ? (
            <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
              Même échantillon : les 4 remplaçants rapportent {num(bench.ratio * 100, 0)} % des points du XI, d&apos;où un poids de 0,25 pour le banc.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
