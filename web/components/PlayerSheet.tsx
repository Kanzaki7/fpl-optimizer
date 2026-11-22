"use client";
import { useEffect, useRef, useState } from "react";
import type { Meta, Player } from "@/lib/types";
import { MOTIF, POS_LABEL, STATUS, num, pct, price, signed } from "@/lib/format";
import { Shape } from "./Shape";
import { useSettings } from "./SettingsProvider";
import { periodValue } from "@/lib/plan";

interface Props {
  player: Player;
  meta: Meta;
  role?: "C" | "V" | "XI" | "BANC" | null;
  onClose: () => void;
  /** bloc affiché en tête de fiche (ex. : remplacer le joueur dans son équipe) */
  extra?: React.ReactNode;
  /** boutons Imposer / Exclure */
  actions?: boolean;
}

function Metric({ k, v, h }: { k: string; v: React.ReactNode; h: string }) {
  return (
    <div className="metric">
      <div className="label">{k}</div>
      <div className="v">{v}</div>
      <div className="h">{h}</div>
    </div>
  );
}

function GwBars({ hist }: { hist: Player["hist"] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!hist.length) return <p className="muted">Pas encore de match cette saison.</p>;
  const W = 400, H = 110, pad = 18;
  const max = Math.max(10, ...hist.map((h) => h[1]));
  const min = Math.min(0, ...hist.map((h) => h[1]));
  const bw = (W - 8) / hist.length;
  const y = (v: number) => pad + ((max - v) / (max - min)) * (H - pad * 2);
  const h = hover != null ? hist[hover] : null;
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points par journée">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        {hist.map(([gw, pts, min], i) => {
          const x = 4 + i * bw + bw * 0.18, w = Math.max(2, bw * 0.64);
          const top = Math.min(y(pts), y(0)), hh = Math.max(1.5, Math.abs(y(pts) - y(0)));
          return (
            <g key={gw}>
              <rect x={4 + i * bw} y={0} width={bw} height={H} fill="transparent"
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              <rect x={x} y={top} width={w} height={hh} rx={Math.min(2, w / 2)} pointerEvents="none"
                fill={min === 0 ? "var(--line)" : hover === i ? "var(--accent)" : "var(--ink2)"} />
              {hist.length <= 19 || i % 2 === 0 ? (
                <text x={x + w / 2} y={H - 2} textAnchor="middle">{gw}</text>
              ) : null}
            </g>
          );
        })}
        <text x={0} y={10}>{max} pts</text>
      </svg>
      {h && hover != null ? (
        <div className="tip" style={{ left: `${((4 + hover * bw + bw / 2) / W) * 100}%`, top: `${(Math.min(y(h[1]), y(0)) / H) * 100}%` }}>
          J{h[0]} · {h[1]} pts · {h[2]} min
        </div>
      ) : null}
    </div>
  );
}

export function PlayerSheet({ player: p, meta, role, onClose, extra, actions = true }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  const { settings, toggle } = useSettings();
  const forced = settings.force.includes(p.id), excluded = settings.exclude.includes(p.id);
  const pv = periodValue(p, meta, settings.from, settings.to);
  const span = settings.to - settings.from + 1;
  const nextIdx = settings.from - meta.gws[0];
  const nextV = p.g[nextIdx] ?? 0;
  const h = meta.horizon;
  const unavailable = p.status !== "a" || (p.chance != null && p.chance < 100);
  const robust = p.robust.length;
  const nH = meta.stability_horizons.length;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <div className="row1">
            <Shape pos={p.pos} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id="sheet-title">{p.name}</h2>
              <div className="muted" style={{ fontSize: 13 }}>
                {p.full_name} · {POS_LABEL[p.pos]} · {p.team}
              </div>
            </div>
            <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Fermer la fiche">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            <span className="tag">{price(p.price)}</span>
            {role === "C" ? <span className="tag accent">Capitaine</span> : null}
            {role === "V" ? <span className="tag accent">Vice-capitaine</span> : null}
            {role === "XI" ? <span className="tag accent">Titulaire</span> : null}
            {role === "BANC" ? <span className="tag">Banc</span> : null}
            {unavailable ? (
              <span className={`tag ${p.status === "i" || p.status === "s" ? "bad" : "warn"}`}>
                {STATUS[p.status] ?? p.status}{p.chance != null ? ` · ${p.chance} %` : ""}
              </span>
            ) : null}
            {p.pen ? <span className="tag">Tireur de penalty n°{p.pen}</span> : null}
            {p.new ? <span className="tag">Sans historique PL</span> : null}
            {p.pepite ? <span className="tag good">Pépite</span> : null}
          </div>
          {p.news ? <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>« {p.news} »</p> : null}
          {actions ? <div className="sheet-actions">
            <button type="button" className={`btn ${forced ? "" : "ghost"}`} aria-pressed={forced} onClick={() => toggle("force", p.id)}>
              {forced ? "Imposé ✓" : "Imposer"}
            </button>
            <button type="button" className={`btn ${excluded ? "" : "ghost"}`} aria-pressed={excluded} onClick={() => toggle("exclude", p.id)}>
              {excluded ? "Exclu ✓" : "Exclure"}
            </button>
          </div> : null}
        </div>

        <div className="sheet-body">
          {extra}
          <section>
            <div className="metrics">
              <Metric k={`Points attendus · J${settings.from}${span > 1 ? `–${settings.to}` : ""}`} v={num(pv)}
                h={p.pool ? `Valeur utilisée par le solveur, environ ${num(pv / span)} par journée.`
                  : `${(p.motif && MOTIF[p.motif]) || "Hors du pool."} Imposez-le pour le prendre quand même.`} />
              <Metric k={`Journée ${settings.from}`} v={nextV ? num(nextV) : "—"}
                h={nextV ? "Points attendus sur cette seule journée : utile pour le capitaine." : "Pas de match cette journée."} />
              <Metric k={`Selon le jeu produit · ${h} J`} v={num(p.ep_x)}
                h={p.pos === "GK" ? "Peu parlant pour un gardien : les arrêts n'y sont pas." : "Avec ses xG et xA au lieu de ses buts et passes."} />
              <Metric k={`Écart · ${h} J`} v={<span className={p.gap == null ? "" : p.gap > 3 ? "pos" : p.gap < -10 ? "neg" : ""}>{signed(p.gap)}</span>}
                h={p.gap == null ? "Pas assez de minutes cette saison."
                  : p.gap > 3 ? "Son jeu vaut plus que ses points : il pourrait progresser."
                  : p.gap < -10 ? "Ses points dépassent nettement son jeu : prudence."
                  : "Écart habituel : ce calcul ignore bonus et actions défensives."} />
            </div>
          </section>

          <section>
            <div className="label">Temps de jeu projeté</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
              <span className="num" style={{ fontSize: 20 }}>{pct(p.share)}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>{p.minutes} min sur {p.games} match{p.games > 1 ? "s" : ""} joué{p.games > 1 ? "s" : ""}</span>
            </div>
            <div className="share-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, p.share * 100)}%` }} />
              <b style={{ left: `${(meta.params.min_share as number) * 100}%` }} />
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
              Le meilleur indicateur du modèle. Le trait orange marque le seuil de 70 % sous lequel un joueur n&apos;est pas retenu.
            </p>
          </section>

          <section>
            <div className="label" style={{ marginBottom: 8 }}>Prochains matchs</div>
            <div className="fixtures">
              {p.next.map(([gw, opp, home, fdr]) => (
                <div key={`${gw}-${opp}`} className="fx" data-fdr={fdr} title={`Difficulté ${fdr} sur 5`}>
                  {opp}<small>{home ? "dom." : "ext."} · J{gw}</small>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Plus la case est orange, plus l&apos;adversaire est difficile.</p>
          </section>

          <section>
            <div className="label" style={{ marginBottom: 8 }}>Points par journée</div>
            <GwBars hist={p.hist} />
          </section>

          <section>
            <div className="label" style={{ marginBottom: 8 }}>Détails</div>
            <dl className="kv">
              <dt>Points cette saison</dt><dd>{p.points}</dd>
              <dt>Buts · passes décisives</dt><dd>{p.goals} · {p.assists}</dd>
              <dt>xG · xA</dt><dd>{num(p.xg, 2)} · {num(p.xa, 2)}</dd>
              <dt>Implications attendues / 90 min</dt><dd>{num(p.xgi90, 2)}</dd>
              <dt title="Part des points venant du meilleur match">Points concentrés sur un match</dt><dd>{pct(p.conc)}</dd>
              <dt title="Buts marqués / xG, saisons précédentes">Finition sur la carrière</dt><dd>{p.car_fin != null ? `${num(p.car_fin, 2)} but / xG` : "—"}</dd>
              <dt>Sélectionné par</dt><dd>{num(p.own, 1)} %</dd>
              <dt>Points attendus par million</dt><dd>{num(p.value, 2)}</dd>
              <dt>Choisi aux horizons</dt>
              <dd>{robust ? `${robust}/${nH} (${p.robust.join(", ")} J)` : `0/${nH}`}</dd>
            </dl>
          </section>
        </div>
      </aside>
    </>
  );
}
