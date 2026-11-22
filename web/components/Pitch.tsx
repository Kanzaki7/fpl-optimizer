"use client";
import type { Player, Pos, Squad } from "@/lib/types";
import { POS_ORDER, num, pad2, price } from "@/lib/format";
import { Reticle, Shape } from "./Shape";

export type Role = "C" | "V" | "XI" | "BANC";
export type Mark = "buy" | "sell" | undefined;

function Token({ p, v, role, forced, mark, selected, onOpen }: {
  p: Player; v: number; role: Role; forced: boolean; mark: Mark; selected: boolean; onOpen: (p: Player) => void;
}) {
  const flagged = p.status !== "a" || (p.chance != null && p.chance < 100);
  return (
    <button className={`token ${mark ?? ""}`} aria-pressed={selected} onClick={() => onOpen(p)}
      aria-label={`${p.name}, ${p.team}, ${price(p.price)}, ${num(v)} points attendus${role === "C" ? ", capitaine" : role === "V" ? ", vice-capitaine" : ""}${mark === "sell" ? ", vente conseillée" : mark === "buy" ? ", acheté" : ""}`}>
      <span className="shape">
        <Reticle />
        <Shape pos={p.pos} size={30} />
        {role === "C" || role === "V" ? <span className={`badge-c ${role === "V" ? "v" : ""}`}>{role}</span> : null}
        {flagged ? <span className="flag-dot" title="Disponibilité incertaine" /> : null}
        {forced ? <span className="pin" title="Imposé">●</span> : null}
        {mark === "buy" ? <span className="mark buy">ACHAT</span> : null}
        {mark === "sell" ? <span className="mark sell">VENDRE</span> : null}
      </span>
      <span className="nm">{p.name}</span>
      <span className="meta"><span className="club">{p.team}</span>{price(p.price)}</span>
      <span className="ep">{num(v)} <small>pts</small></span>
    </button>
  );
}

function PitchLines() {
  return (
    <>
      <span className="ln arc" />
      <span className="ln box18" />
      <span className="ln box6" />
      <span className="ln centre" />
      <span className="ln half" />
    </>
  );
}

const ROW_Y: Record<Pos, number> = { GK: 11, DEF: 34, MID: 58, FWD: 82 };

interface Props {
  squad: Squad;
  byId: Map<number, Player>;
  value: (id: number) => number;
  head: string;
  busy?: boolean;
  forced?: number[];
  mark?: (id: number) => Mark;
  selected?: number;
  onOpen: (p: Player) => void;
  hint?: string;
}

/** Terrain (onze) et banc, à la manière du style Dossier. */
export function Pitch({ squad, byId, value, head, busy, forced = [], mark = () => undefined, selected, onOpen, hint }: Props) {
  const role = (id: number): Role =>
    id === squad.captain ? "C" : id === squad.vice ? "V" : squad.xi.includes(id) ? "XI" : "BANC";
  const xi = squad.xi.map((id) => byId.get(id)!).filter(Boolean);
  const bench = squad.bench.map((id) => byId.get(id)!).filter(Boolean);
  const token = (p: Player, r: Role) => (
    <Token key={p.id} p={p} v={value(p.id)} role={r} forced={forced.includes(p.id)} mark={mark(p.id)}
      selected={selected === p.id} onOpen={onOpen} />
  );
  return (
    <div className="panel reticle pitch-frame">
      <span className="rt" />
      <div className="pitch-head">
        <span className="label">{head}</span>
        <span className="label">{busy ? "Calcul…" : hint}</span>
      </div>
      <div className="pitch">
        <PitchLines />
        {POS_ORDER.map((pos) => (
          <div key={pos} className="row" style={{ top: `${ROW_Y[pos]}%` }}>
            {xi.filter((p) => p.pos === pos).map((p) => token(p, role(p.id)))}
          </div>
        ))}
      </div>
      <div className="bench">
        <span className="label">Banc · {pad2(bench.length)}</span>
        {bench.map((p) => token(p, "BANC"))}
      </div>
    </div>
  );
}
