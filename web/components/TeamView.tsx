"use client";
import { useCallback, useMemo, useState } from "react";
import type { Meta, Player, Pos, Squad } from "@/lib/types";
import { POS_ORDER, num, pad2, pct, price } from "@/lib/format";
import { Reticle, Shape } from "./Shape";
import { PlayerSheet } from "./PlayerSheet";

interface Props {
  squad: Squad;
  players: Player[];
  meta: Meta;
}

type Role = "C" | "V" | "XI" | "BANC";

function Token({ p, role, selected, onOpen }: { p: Player; role: Role; selected: boolean; onOpen: (p: Player) => void }) {
  const flagged = p.status !== "a" || (p.chance != null && p.chance < 100);
  return (
    <button className="token" aria-pressed={selected} onClick={() => onOpen(p)}
      aria-label={`${p.name}, ${p.team}, ${price(p.price)}, ${num(p.ep)} points attendus${role === "C" ? ", capitaine" : role === "V" ? ", vice-capitaine" : ""}`}>
      <span className="shape">
        <Reticle />
        <Shape pos={p.pos} size={30} />
        {role === "C" || role === "V" ? <span className={`badge-c ${role === "V" ? "v" : ""}`}>{role}</span> : null}
        {flagged ? <span className="flag-dot" title="Disponibilité incertaine" /> : null}
      </span>
      <span className="nm">{p.name}</span>
      <span className="meta"><span className="club">{p.team}</span>{price(p.price)}</span>
      <span className="ep">{num(p.ep_opt ?? p.ep)} <small>pts</small></span>
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

export function TeamView({ squad, players, meta }: Props) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const [open, setOpen] = useState<Player | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const role = (id: number): Role =>
    id === squad.captain ? "C" : id === squad.vice ? "V" : squad.xi.includes(id) ? "XI" : "BANC";
  const xi = squad.xi.map((id) => byId.get(id)!).filter(Boolean);
  const bench = squad.bench.map((id) => byId.get(id)!).filter(Boolean);
  const cap = byId.get(squad.captain)!;
  const vice = byId.get(squad.vice)!;
  const rows = POS_ORDER.map((pos) => ({ pos, ps: xi.filter((p) => p.pos === pos) }));

  const all = [...xi, ...bench];
  const watch = all.filter((p) => p.status !== "a" || (p.chance != null && p.chance < 100) || p.share < 0.8);
  const fragile = all.filter((p) => p.robust.length < meta.stability_horizons.length);
  const values = [...xi].sort((a, b) => b.value - a.value).slice(0, 3);

  return (
    <div className="team-layout">
      <div className="panel reticle pitch-frame">
        <span className="rt" />
        <div className="pitch-head">
          <span className="label">XI · {squad.formation} · J{meta.next_gw}–J{meta.next_gw + meta.horizon - 1}</span>
          <span className="label">pts attendus sur {meta.horizon} J</span>
        </div>
        <div className="pitch">
          <PitchLines />
          {rows.map(({ pos, ps }) => (
            <div key={pos} className="row" style={{ top: `${ROW_Y[pos]}%` }}>
              {ps.map((p) => <Token key={p.id} p={p} role={role(p.id)} selected={open?.id === p.id} onOpen={setOpen} />)}
            </div>
          ))}
        </div>
        <div className="bench">
          <span className="label">Banc · {pad2(bench.length)}</span>
          {bench.map((p) => <Token key={p.id} p={p} role="BANC" selected={open?.id === p.id} onOpen={setOpen} />)}
        </div>
      </div>

      <div className="side">
        <section className="panel card">
          <h2>Brassard</h2>
          <button className="list-btn" onClick={() => setOpen(cap)}>
            <span className="badge-c" style={{ position: "static" }}>C</span>
            <span><span className="n">{cap.name}</span><br /><span className="s">{cap.team} · {num(cap.ep_opt ?? cap.ep)} pts attendus</span></span>
            <span className="num">×2</span>
          </button>
          <button className="list-btn" onClick={() => setOpen(vice)}>
            <span className="badge-c v" style={{ position: "static" }}>V</span>
            <span><span className="n">{vice.name}</span><br /><span className="s">{vice.team} · {num(vice.ep_opt ?? vice.ep)} pts attendus</span></span>
            <span className="label">si C absent</span>
          </button>
        </section>

        <section className="panel card">
          <h2>Meilleure valeur du XI</h2>
          {values.map((p) => (
            <button key={p.id} className="list-btn" onClick={() => setOpen(p)}>
              <Shape pos={p.pos} size={16} />
              <span><span className="n">{p.name}</span> <span className="s">{price(p.price)}</span></span>
              <span className="num">{num(p.value, 2)}<span className="dim"> /m</span></span>
            </button>
          ))}
        </section>

        <section className="panel card">
          <h2>À surveiller</h2>
          {watch.length === 0 && fragile.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Tous titulaires, aucun doute de disponibilité.</p>
          ) : null}
          {watch.map((p) => (
            <button key={p.id} className="list-btn" onClick={() => setOpen(p)}>
              <Shape pos={p.pos} size={16} />
              <span><span className="n">{p.name}</span><br />
                <span className="s">{p.status !== "a" || (p.chance != null && p.chance < 100) ? `Disponibilité : ${p.chance ?? "?"} %` : `Temps de jeu ${pct(p.share)}`}</span></span>
              <span className="tag warn">!</span>
            </button>
          ))}
          {fragile.filter((p) => !watch.includes(p)).map((p) => (
            <button key={p.id} className="list-btn" onClick={() => setOpen(p)}>
              <Shape pos={p.pos} size={16} />
              <span><span className="n">{p.name}</span><br />
                <span className="s">Choisi à {p.robust.length}/{meta.stability_horizons.length} horizons : un pari sur le calendrier</span></span>
              <span className="tag">{p.robust.length ? `${p.robust.join("·")} J` : "—"}</span>
            </button>
          ))}
        </section>

        <div className="notice" style={{ margin: 0 }}>
          <span className="label" style={{ color: "var(--accent-ink)" }}>Note</span>
          <span>
            <strong>Un point de départ, pas un verdict.</strong> L&apos;écart de 2 ou 3 points entre deux joueurs est
            inférieur à la marge d&apos;erreur du modèle : à ce niveau, choisissez celui que vous comprenez.
          </span>
        </div>
      </div>

      {open ? <PlayerSheet player={open} meta={meta} role={squad.xi.includes(open.id) || squad.bench.includes(open.id) ? role(open.id) : null} onClose={close} /> : null}
    </div>
  );
}
