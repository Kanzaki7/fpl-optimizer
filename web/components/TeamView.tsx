"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fromOther, type Meta, type Other, type Player, type Pos, type Squad } from "@/lib/types";
import type { Entry } from "@/lib/entry";
import { POS_ORDER, num, pad2, pct, price, signed } from "@/lib/format";
import { periodValue, type Solution } from "@/lib/plan";
import { HIT, PlanError, solve, solveTransfers } from "@/lib/solver";
import { Reticle, Shape } from "./Shape";
import { PlayerSheet } from "./PlayerSheet";
import { Planner } from "./Planner";
import { useSettings } from "./SettingsProvider";

interface Props {
  squad: Squad;
  players: Player[];
  others: Other[];
  meta: Meta;
}

type Role = "C" | "V" | "XI" | "BANC";

function Token({ p, v, role, forced, bought, selected, onOpen }: {
  p: Player; v: number; role: Role; forced: boolean; bought?: boolean; selected: boolean; onOpen: (p: Player) => void;
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
        {bought ? <span className="new">ACHAT</span> : null}
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

export function TeamView({ squad: base, players: evaluated, others, meta }: Props) {
  const { settings: s, isDefault } = useSettings();
  // les joueurs non évalués servent aux équipes importées (comptés à 0 point)
  const players = useMemo(() => [...evaluated, ...others.map(fromOther)], [evaluated, others]);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const mine = s.mode === "mine";

  // Équipe importée : lecture seule de l'API publique FPL, via le serveur du site
  const [entry, setEntry] = useState<Entry | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  useEffect(() => {
    if (!mine || !s.entry) { setEntry(null); setEntryError(null); return; }
    let live = true;
    setEntryLoading(true);
    fetch(`/api/equipe/${s.entry}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Import impossible.");
        return body as Entry;
      })
      .then((e) => { if (live) { setEntry(e); setEntryError(null); } })
      .catch((e: Error) => { if (live) { setEntry(null); setEntryError(e.message); } })
      .finally(() => { if (live) setEntryLoading(false); });
    return () => { live = false; };
  }, [mine, s.entry]);
  const transfers = mine && entry != null;
  const [open, setOpen] = useState<Player | null>(null);
  const close = useCallback(() => setOpen(null), []);

  // L'équipe par défaut vient du pipeline ; tout autre réglage relance le solveur ici.
  const [sol, setSol] = useState<Solution | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isDefault || (mine && !entry)) { setSol(null); setBest(null); setError(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const known = entry?.picks.filter((id) => byId.has(id)) ?? [];
        const r = transfers
          ? await solveTransfers(players, meta, s, { picks: known, bank: entry!.bank, ft: entry!.ft })
          : await solve(players, meta, s);
        const ref = !transfers && s.force.length ? (await solve(players, meta, { ...s, force: [] })).ep_xi : null;
        if (live) { setSol(r); setBest(ref); setError(null); }
      } catch (e) {
        if (live) { setSol(null); setError(e instanceof PlanError ? e.message : "Le calcul a échoué. Rechargez la page."); }
      } finally {
        if (live) setBusy(false);
      }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [s, isDefault, players, meta, mine, entry, transfers, byId]);

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
  const moves = transfers ? sol?.moves : undefined;
  const net = moves ? squad.ep_xi - HIT * moves.hits : squad.ep_xi;
  const gain = moves ? (moves.with ?? 0) - HIT * moves.hits - moves.keep : 0;
  const bought = new Set(moves?.in ?? []);
  // en mode « Mon équipe », on n'affiche une équipe que si elle vient de l'équipe importée
  const waiting = mine && (!entry || !moves);
  const unknown = entry ? entry.picks.filter((id) => !byId.has(id)).length : 0;

  return (
    <>
      <section className="hero">
        <div className="kicker">
          <span className="tag accent">Saison {meta.season}</span>
        </div>
        <h1>{mine ? "Vos transferts" : "L'équipe optimale"} pour {period(s.from, s.to)}</h1>
        <p className="lead">
          {mine
            ? entry
              ? `${entry.name} : les transferts qui rapportent le plus sur ${n > 1 ? `ces ${n} journées` : "cette journée"}, pénalités comprises. Vous les validez vous-même dans l'application FPL.`
              : "Entrez l'identifiant de votre équipe FPL : le site lit votre équipe publique, sans mot de passe, et propose les meilleurs transferts."
            : `Les 15 joueurs qui devraient rapporter le plus sur ${n > 1 ? `ces ${n} journées` : "cette journée"}, pour ${price(s.budget)}, dans le respect des règles du jeu. Changez la période, le budget ou imposez des joueurs : l'équipe se recalcule.`}
        </p>
      </section>

      <Planner meta={meta} players={players} entry={entry} entryError={entryError} entryLoading={entryLoading} />

      {waiting ? (
        <div className="panel empty-state">
          {!entry ? (
            entryLoading ? <p>Import de votre équipe…</p> : entryError ? (
              <>
                <h2>Import impossible</h2>
                <p>{entryError}</p>
              </>
            ) : (
              <>
                <h2>Importez votre équipe</h2>
                <p>
                  Entrez l&apos;identifiant de votre équipe FPL ci-dessus. Il se trouve dans l&apos;adresse de votre page
                  Points : fantasy.premierleague.com/entry/<b>1234567</b>/event/… Aucun mot de passe n&apos;est demandé :
                  le site lit seulement votre équipe publique.
                </p>
              </>
            )
          ) : error ? (
            <>
              <h2>Calcul impossible</h2>
              <p>{error}</p>
              {unknown ? <p className="hint">{unknown} joueur{unknown > 1 ? "s" : ""} de votre équipe ne figure{unknown > 1 ? "nt" : ""} pas encore dans les données du jour (transfert récent ?).</p> : null}
            </>
          ) : <p>Calcul de vos transferts…</p>}
        </div>
      ) : null}

      {!waiting && error ? <div className="notice" role="alert"><span className="label" style={{ color: "var(--bad)" }}>Impossible</span><span>{error}</span></div> : null}

      {!waiting ? (
      <div className={`stats ${busy ? "busy" : ""}`} aria-label="Résumé de l'équipe" aria-busy={busy}>
        {moves ? (
          <div className="stat"><div className="label">Points attendus</div><div className="v">{num((moves.with ?? 0) - HIT * moves.hits)} <small>C ×2 · ¼ banc</small></div></div>
        ) : (
          <div className="stat"><div className="label">Points attendus</div><div className="v">{num(net)} <small>XI · C ×2</small></div></div>
        )}
        {moves ? (
          <div className="stat"><div className="label">Gain des transferts</div>
            <div className={`v ${gain > 0.05 ? "pos" : ""}`}>{signed(gain)}</div></div>
        ) : best != null && sol ? (
          <div className="stat"><div className="label">Écart à l&apos;optimum</div>
            <div className={`v ${sol.ep_xi - best < -0.05 ? "neg" : ""}`}>{signed(sol.ep_xi - best)}</div></div>
        ) : (
          <div className="stat"><div className="label">Période</div><div className="v">J{s.from}{n > 1 ? `–${s.to}` : ""}</div></div>
        )}
        {moves ? (
          <div className="stat"><div className="label">Transferts</div>
            <div className="v">{moves.in.length}{moves.hits ? <small> · −{HIT * moves.hits} pts</small> : null}</div></div>
        ) : (
          <div className="stat"><div className="label">Coût</div><div className="v">{price(squad.cost)}</div></div>
        )}
        <div className="stat"><div className="label">Banque</div><div className="v">{price(squad.bank)}</div></div>
        <div className="stat"><div className="label">Formation</div><div className="v">{squad.formation}</div></div>
        <div className="stat"><div className="label">Capitaine</div><div className="v">{cap?.name.toUpperCase()}</div></div>
      </div>
      ) : null}

      {moves && entry ? (
        <section className={`panel reticle plan ${busy ? "busy" : ""}`}><span className="rt" />
          <div className="plan-head">
            <h2>À faire avant la journée {s.from}</h2>
            <span className="hint">{entry.name} · équipe de la journée {entry.event}{entry.freehit ? " (avant Free Hit)" : ""}</span>
          </div>
          <div className="plan-grid">
            <div>
              <div className="label">1 · Transferts</div>
              {moves.in.length === 0 ? (
                <p className="plan-none">Aucun : gardez votre équipe{(s.ft ?? entry.ft) > 0 ? " et reportez vos transferts gratuits" : ""}.</p>
              ) : (
                <ol className="moves">
                  {moves.out.map((o, i) => {
                    const po = byId.get(o)!, pi = byId.get(moves.in[i])!;
                    return (
                      <li key={o} className="move">
                        <button className="out" onClick={() => setOpen(po)}>
                          <span className="k">Vendre</span><span className="n">{po.name}</span><span className="s">{po.team} · {price(po.price)} · {num(value(o))} pts</span>
                        </button>
                        <span className="arrow" aria-label="remplacé par">→</span>
                        <button className="in" onClick={() => setOpen(pi)}>
                          <span className="k">Acheter</span><span className="n">{pi.name}</span><span className="s">{pi.team} · {price(pi.price)} · {num(value(pi.id))} pts</span>
                        </button>
                        <span className="g num">{signed(value(pi.id) - value(o))}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            <div>
              <div className="label">2 · Brassard</div>
              <p className="plan-line"><span className="badge-c" style={{ position: "static" }}>C</span> {cap.name} <span className="dim">· vice {vice.name}</span></p>
              <div className="label" style={{ marginTop: 14 }}>3 · Composition</div>
              <p className="plan-line" style={{ textTransform: "none", fontWeight: 400, fontFamily: "var(--sans)" }}>{squad.formation} : titulaires et banc comme sur le terrain ci-dessous.</p>
            </div>
            <dl className="moves-sum">
              <dt>Sans transfert</dt><dd>{num(moves.keep)} pts</dd>
              <dt>Avec ces transferts</dt><dd>{num(moves.with)} pts</dd>
              {moves.hits ? <><dt>Pénalité ({moves.hits} × {HIT})</dt><dd>−{HIT * moves.hits} pts</dd></> : null}
              <dt><b>Gain net</b></dt><dd><b>{signed(gain)} pts</b></dd>
            </dl>
          </div>
          <p className="hint" style={{ margin: "12px 0 0" }}>
            Points attendus sur {period(s.from, s.to)} : onze avec capitaine doublé, plus un quart du banc. Les transferts
            déjà faits depuis la dernière date limite ne sont pas visibles ; prix de revente estimés au prix actuel.
          </p>
        </section>
      ) : null}

      {waiting ? null : (
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
                {ps.map((p) => <Token key={p.id} p={p} v={value(p.id)} role={role(p.id)} forced={s.force.includes(p.id)} bought={bought.has(p.id)}
                  selected={open?.id === p.id} onOpen={setOpen} />)}
              </div>
            ))}
          </div>
          <div className="bench">
            <span className="label">Banc · {pad2(bench.length)}</span>
            {bench.map((p) => <Token key={p.id} p={p} v={value(p.id)} role="BANC" forced={s.force.includes(p.id)} bought={bought.has(p.id)}
              selected={open?.id === p.id} onOpen={setOpen} />)}
          </div>
        </div>

        <div className="side">
          {moves ? null : <section className="panel card">
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
          </section>}

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
      )}

      {open ? <PlayerSheet player={open} meta={meta}
        role={squad.xi.includes(open.id) || squad.bench.includes(open.id) ? role(open.id) : null} onClose={close} /> : null}
    </>
  );
}
