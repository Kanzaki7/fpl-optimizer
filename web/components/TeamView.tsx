"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Meta, Player, Pos, Squad } from "@/lib/types";
import { POS_ORDER, num, pad2, pct, price, signed } from "@/lib/format";
import { periodValue, type Solution } from "@/lib/plan";
import { PlanError, solve } from "@/lib/solver";
import { Reticle, Shape } from "./Shape";
import { PlayerSheet } from "./PlayerSheet";
import { Planner } from "./Planner";
import { useSettings } from "./SettingsProvider";

interface Props {
  squad: Squad;
  players: Player[];
  meta: Meta;
}

type Role = "C" | "V" | "XI" | "BANC";

function Token({ p, v, role, forced, selected, onOpen }: {
  p: Player; v: number; role: Role; forced: boolean; selected: boolean; onOpen: (p: Player) => void;
}) {
  const flagged = p.status !== "a" || (p.chance != null && p.chance < 100);
  return (
    <button className="token" aria-pressed={selected} onClick={() => onOpen(p)}
      aria-label={`${p.name}, ${p.team}, ${price(p.price)}, ${num(v)} points attendus${role === "C" ? ", capitaine" : role === "V" ? ", vice-capitaine" : ""}`}>
      <span className="shape">
        <Reticle />
        <Shape pos={p.pos} size={30} />
        {role === "C" || role === "V" ? <span className={`badge-c ${role === "V" ? "v" : ""}`}>{role}</span> : null}
        {flagged ? <span className="flag-dot" title="Disponibilité incertaine" /> : null}
        {forced ? <span className="pin" title="Imposé">●</span> : null}
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

const period = (from: number, to: number) =>
  from === to ? `la journée ${from}` : `les journées ${from} à ${to}`;

export function TeamView({ squad: base, players, meta }: Props) {
  const { settings: s, isDefault } = useSettings();
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const [open, setOpen] = useState<Player | null>(null);
  const close = useCallback(() => setOpen(null), []);

  // L'équipe par défaut vient du pipeline ; tout autre réglage relance le solveur ici.
  const [sol, setSol] = useState<Solution | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isDefault) { setSol(null); setBest(null); setError(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await solve(players, meta, s);
        const ref = s.force.length ? (await solve(players, meta, { ...s, force: [] })).ep_xi : null;
        if (live) { setSol(r); setBest(ref); setError(null); }
      } catch (e) {
        if (live) setError(e instanceof PlanError ? e.message : "Le calcul a échoué. Rechargez la page.");
      } finally {
        if (live) setBusy(false);
      }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [s, isDefault, players, meta]);

  const squad: Squad = sol ?? base;
  const value = (id: number) => sol ? sol.value.get(id) ?? 0 : periodValue(byId.get(id)!, meta, s.from, s.to);
  const role = (id: number): Role =>
    id === squad.captain ? "C" : id === squad.vice ? "V" : squad.xi.includes(id) ? "XI" : "BANC";
  const xi = squad.xi.map((id) => byId.get(id)!).filter(Boolean);
  const bench = squad.bench.map((id) => byId.get(id)!).filter(Boolean);
  const cap = byId.get(squad.captain)!;
  const vice = byId.get(squad.vice)!;
  const rows = POS_ORDER.map((pos) => ({ pos, ps: xi.filter((p) => p.pos === pos) }));
  const all = [...xi, ...bench];
  const watch = all.filter((p) => p.status !== "a" || (p.chance != null && p.chance < 100) || p.share < 0.8);
  const values = [...xi].sort((a, b) => value(b.id) / b.price - value(a.id) / a.price).slice(0, 3);
  const n = s.to - s.from + 1;
  const own = s.force.length === 15;

  return (
    <>
      <section className="hero">
        <div className="kicker">
          <span className="tag accent">Saison {meta.season}</span>
        </div>
        <h1>{own ? "Votre équipe" : "L'équipe optimale"} pour {period(s.from, s.to)}</h1>
        <p className="lead">
          {own
            ? "Vos 15 joueurs, avec le meilleur onze, le capitaine et l'écart avec l'équipe optimale."
            : `Les 15 joueurs qui devraient rapporter le plus sur ${n > 1 ? `ces ${n} journées` : "cette journée"}, pour ${price(s.budget)}, dans le respect des règles du jeu. Changez la période, le budget ou imposez des joueurs : l'équipe se recalcule.`}
        </p>
      </section>

      <Planner meta={meta} players={players} />

      {error ? <div className="notice" role="alert"><span className="label" style={{ color: "var(--bad)" }}>Impossible</span><span>{error}</span></div> : null}

      <div className={`stats ${busy ? "busy" : ""}`} aria-label="Résumé de l'équipe" aria-busy={busy}>
        <div className="stat"><div className="label">Points attendus</div><div className="v">{num(squad.ep_xi)} <small>XI · C ×2</small></div></div>
        {best != null && sol ? (
          <div className="stat"><div className="label">Écart à l&apos;optimum</div>
            <div className={`v ${sol.ep_xi - best < -0.05 ? "neg" : ""}`}>{signed(sol.ep_xi - best)}</div></div>
        ) : (
          <div className="stat"><div className="label">Période</div><div className="v">J{s.from}{n > 1 ? `–${s.to}` : ""}</div></div>
        )}
        <div className="stat"><div className="label">Coût</div><div className="v">{price(squad.cost)}</div></div>
        <div className="stat"><div className="label">Banque</div><div className="v">{price(squad.bank)}</div></div>
        <div className="stat"><div className="label">Formation</div><div className="v">{squad.formation}</div></div>
        <div className="stat"><div className="label">Capitaine</div><div className="v">{cap?.name.toUpperCase()}</div></div>
      </div>

      <div className={`team-layout ${busy ? "busy" : ""}`}>
        <div className="panel reticle pitch-frame">
          <span className="rt" />
          <div className="pitch-head">
            <span className="label">XI · {squad.formation} · J{s.from}{n > 1 ? `–J${s.to}` : ""}</span>
            <span className="label">{busy ? "Calcul…" : `pts attendus sur ${n} J`}</span>
          </div>
          <div className="pitch">
            <PitchLines />
            {rows.map(({ pos, ps }) => (
              <div key={pos} className="row" style={{ top: `${ROW_Y[pos]}%` }}>
                {ps.map((p) => <Token key={p.id} p={p} v={value(p.id)} role={role(p.id)} forced={s.force.includes(p.id)}
                  selected={open?.id === p.id} onOpen={setOpen} />)}
              </div>
            ))}
          </div>
          <div className="bench">
            <span className="label">Banc · {pad2(bench.length)}</span>
            {bench.map((p) => <Token key={p.id} p={p} v={value(p.id)} role="BANC" forced={s.force.includes(p.id)}
              selected={open?.id === p.id} onOpen={setOpen} />)}
          </div>
        </div>

        <div className="side">
          <section className="panel card">
            <h2>Brassard</h2>
            <button className="list-btn" onClick={() => setOpen(cap)}>
              <span className="badge-c" style={{ position: "static" }}>C</span>
              <span><span className="n">{cap.name}</span><br /><span className="s">{cap.team} · {num(value(cap.id))} pts attendus</span></span>
              <span className="num">×2</span>
            </button>
            <button className="list-btn" onClick={() => setOpen(vice)}>
              <span className="badge-c v" style={{ position: "static" }}>V</span>
              <span><span className="n">{vice.name}</span><br /><span className="s">{vice.team} · {num(value(vice.id))} pts attendus</span></span>
              <span className="label">si C absent</span>
            </button>
          </section>

          <section className="panel card">
            <h2>Meilleure valeur du XI</h2>
            {values.map((p) => (
              <button key={p.id} className="list-btn" onClick={() => setOpen(p)}>
                <Shape pos={p.pos} size={16} />
                <span><span className="n">{p.name}</span> <span className="s">{price(p.price)}</span></span>
                <span className="num">{num(value(p.id) / p.price, 2)}<span className="dim"> /m</span></span>
              </button>
            ))}
          </section>

          {watch.length ? (
            <section className="panel card">
              <h2>À surveiller</h2>
              {watch.map((p) => (
                <button key={p.id} className="list-btn" onClick={() => setOpen(p)}>
                  <Shape pos={p.pos} size={16} />
                  <span><span className="n">{p.name}</span><br />
                    <span className="s">{p.status !== "a" || (p.chance != null && p.chance < 100)
                      ? `Disponibilité : ${p.chance ?? "?"} %${p.news ? ` · ${p.news}` : ""}` : `Temps de jeu projeté ${pct(p.share)}`}</span></span>
                  <span className="tag warn">!</span>
                </button>
              ))}
            </section>
          ) : null}

          <div className="notice" style={{ margin: 0 }}>
            <span className="label" style={{ color: "var(--accent-ink)" }}>Note</span>
            <span>
              <strong>Un point de départ, pas un verdict.</strong> Un écart de 2 ou 3 points entre deux joueurs est
              sous la marge d&apos;erreur du modèle : à ce niveau, choisissez celui que vous comprenez.
            </span>
          </div>
        </div>
      </div>

      {open ? <PlayerSheet player={open} meta={meta}
        role={squad.xi.includes(open.id) || squad.bench.includes(open.id) ? role(open.id) : null} onClose={close} /> : null}
    </>
  );
}
