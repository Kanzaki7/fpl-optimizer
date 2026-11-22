"use client";
import { useMemo, useState } from "react";
import type { Player } from "@/lib/types";
import { num, price, signed } from "@/lib/format";

export interface Candidate {
  p: Player;
  v: number;
  /** raison pour laquelle on ne peut pas l'acheter, sinon null */
  blocked: string | null;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Liste des remplaçants possibles d'un joueur, du plus rentable au moins rentable. */
export function ReplaceList({ out, outValue, candidates, suggested, onPick }: {
  out: Player; outValue: number; candidates: Candidate[]; suggested?: number; onPick: (p: Player) => void;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const n = norm(q.trim());
    const l = candidates.filter((c) => !n || norm(`${c.p.name} ${c.p.full_name} ${c.p.team}`).includes(n));
    return all || n ? l : l.slice(0, 8);
  }, [candidates, q, all]);
  const sug = candidates.find((c) => c.p.id === suggested);

  return (
    <div className="replace">
      {sug ? (
        <button type="button" className="cand suggested" disabled={!!sug.blocked} onClick={() => onPick(sug.p)}>
          <span className="k">Conseillé</span>
          <span className="n">{sug.p.name}</span>
          <span className="s">{sug.p.team} · {price(sug.p.price)} · {num(sug.v)} pts</span>
          <span className="d num">{signed(sug.v - outValue)}</span>
        </button>
      ) : null}
      <input className="field" type="search" placeholder={`Chercher un ${out.pos === "GK" ? "gardien" : out.pos === "DEF" ? "défenseur" : out.pos === "MID" ? "milieu" : "attaquant"}…`}
        value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un remplaçant" />
      <ul className="cands">
        {list.map((c) => (
          <li key={c.p.id}>
            <button type="button" className="cand" disabled={!!c.blocked} onClick={() => onPick(c.p)} title={c.blocked ?? undefined}>
              <span className="n">{c.p.name}</span>
              <span className="s">{c.blocked ?? `${c.p.team} · ${price(c.p.price)} · ${num(c.v)} pts`}</span>
              <span className={`d num ${c.v - outValue >= 0 ? "pos" : "neg"}`}>{signed(c.v - outValue)}</span>
            </button>
          </li>
        ))}
      </ul>
      {!all && !q && candidates.length > 8 ? (
        <button type="button" className="btn ghost more-btn" onClick={() => setAll(true)}>Voir les {candidates.length} joueurs</button>
      ) : null}
    </div>
  );
}
