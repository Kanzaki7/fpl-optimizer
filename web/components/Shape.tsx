import type { Pos } from "@/lib/types";
import { POS_SHAPE } from "@/lib/format";

const TINT: Record<Pos, string> = { GK: "var(--t-gk)", DEF: "var(--t-def)", MID: "var(--t-mid)", FWD: "var(--t-fwd)" };

function path(shape: string, r: number) {
  const c = r;
  switch (shape) {
    case "square":
      return `M${c - r * 0.78} ${c - r * 0.78}h${r * 1.56}v${r * 1.56}h${-r * 1.56}z`;
    case "triangle":
      return `M${c} ${c - r * 0.95}L${c + r * 0.95} ${c + r * 0.72}H${c - r * 0.95}z`;
    case "diamond":
      return `M${c} ${c - r}L${c + r} ${c}L${c} ${c + r}L${c - r} ${c}z`;
    default: {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${(c + Math.cos(a) * r * 0.95).toFixed(2)} ${(c + Math.sin(a) * r * 0.95).toFixed(2)}`;
      });
      return `M${pts.join("L")}z`;
    }
  }
}

/** Forme de poste, à la manière des groupes du style Dossier de Leyline. */
export function Shape({ pos, size = 20, solid = false }: { pos: Pos; size?: number; solid?: boolean }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <path d={path(POS_SHAPE[pos], r - 1)} transform="translate(1 1)" fill={TINT[pos]} fillOpacity={solid ? 0.9 : 0.55}
        stroke="var(--ink)" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/** Coins de visée orange autour d'un élément sélectionné. */
export function Reticle({ className = "ret" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" preserveAspectRatio="none" aria-hidden="true">
      <path d="M1 9V1h8M39 1h8v8M47 39v8h-8M9 47H1v-8" fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path d="M2 7V2h5M19 2h5v5M24 19v5h-5M7 24H2v-5" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      <line x1="8.5" y1="15.5" x2="13" y2="9" stroke="var(--ink)" strokeWidth="1" />
      <line x1="13" y1="9" x2="17.5" y2="16" stroke="var(--ink)" strokeWidth="1" />
      <rect x="6" y="13" width="5" height="5" fill="var(--t-def)" fillOpacity=".55" stroke="var(--ink)" strokeWidth="1.1" />
      <path d="M13 5.5l3 5h-6z" fill="var(--ink)" />
      <path d="M17.5 13l3 3-3 3-3-3z" fill="var(--t-mid)" fillOpacity=".55" stroke="var(--ink)" strokeWidth="1.1" />
    </svg>
  );
}
