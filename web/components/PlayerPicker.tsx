"use client";
import { useMemo, useState } from "react";
import type { Player } from "@/lib/types";
import { price } from "@/lib/format";
import { Shape } from "./Shape";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Champ de recherche qui propose des joueurs ; Entrée choisit le premier. */
export function PlayerPicker({ players, taken, onPick, placeholder, label }: {
  players: Player[]; taken: number[]; onPick: (p: Player) => void; placeholder: string; label: string;
}) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const hits = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return [];
    return players
      .filter((p) => !taken.includes(p.id) && norm(`${p.name} ${p.full_name} ${p.team}`).includes(n))
      .slice(0, 7);
  }, [q, players, taken]);
  const pick = (p: Player) => { onPick(p); setQ(""); };
  return (
    <div className="picker">
      <input className="field" type="search" value={q} placeholder={placeholder} aria-label={label}
        onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); pick(hits[0]); } }} />
      {focus && hits.length ? (
        <ul className="picker-list" role="listbox" aria-label={label}>
          {hits.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                <Shape pos={p.pos} size={14} /><b>{p.name}</b><span>{p.team} · {price(p.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
