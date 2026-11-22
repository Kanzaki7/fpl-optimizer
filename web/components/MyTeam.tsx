"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Meta, Player } from "@/lib/types";
import type { Entry } from "@/lib/entry";
import { num, pct, price, signed } from "@/lib/format";
import { bestLineup, diff, periodValue, type Settings, type Solution } from "@/lib/plan";
import { HIT, PlanError, solveTransfers } from "@/lib/solver";
import { Pitch } from "./Pitch";
import { PlayerSheet } from "./PlayerSheet";
import { ReplaceList, type Candidate } from "./ReplaceList";
import { Shape } from "./Shape";

interface Props {
  entry: Entry;
  players: Player[];
  byId: Map<number, Player>;
  meta: Meta;
  s: Settings;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Éditeur de transferts : l'équipe importée est le point de départ, les
 * suggestions du solveur s'appliquent d'un clic, et chaque joueur peut être
 * remplacé à la main. Budget, transferts, pénalité et points suivent.
 */
export function MyTeam({ entry, players, byId, meta, s }: Props) {
  const original = useMemo(() => entry.picks.filter((id) => byId.has(id)), [entry, byId]);
  const key = `fpl-brouillon-${entry.id}-${entry.event}`;

  // Brouillon = les 15 joueurs après les transferts choisis, gardé dans le navigateur
  const [draft, setDraftState] = useState<number[]>(original);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      setDraftState(Array.isArray(saved) && saved.length === 15 && saved.every((id) => byId.has(id)) ? saved : original);
    } catch { setDraftState(original); }
  }, [key, original, byId]);
  const setDraft = useCallback((d: number[]) => {
    setDraftState(d);
    try { localStorage.setItem(key, JSON.stringify(d)); } catch {}
  }, [key]);

  const value = useMemo(() => new Map(players.map((p) => [p.id, periodValue(p, meta, s.from, s.to)])), [players, meta, s.from, s.to]);
  const v = (id: number) => value.get(id) ?? 0;
  const bw = meta.bench_weight;
  const score = (sq: { ep_xi: number; ep_bench: number }) => r1(sq.ep_xi + bw * sq.ep_bench);

  const moves = diff(byId, original, draft);
  const bank = r1(entry.bank + moves.reduce((a, [o, i]) => a + byId.get(o)!.price - byId.get(i)!.price, 0));
  const ft = s.ft ?? entry.ft;
  const hits = Math.max(0, moves.length - ft);
  const keepSquad = useMemo(() => bestLineup(byId, original, value, entry.bank), [byId, original, value, entry.bank]);
  const squad = bestLineup(byId, draft, value, bank);
  const keepScore = score(keepSquad);
  const draftScore = score(squad) - HIT * hits;

  // Suggestions du solveur à partir du brouillon (transferts gratuits restants)
  const [sugg, setSugg] = useState<Solution | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftKey = [...draft].sort().join(",");
  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await solveTransfers(players, meta, { ...s, force: [], exclude: [], ft: Math.max(0, ft - moves.length) },
          { picks: draftKey.split(",").map(Number), bank, ft: Math.max(0, ft - moves.length) });
        if (live) { setSugg(res); setError(null); }
      } catch (e) {
        if (live) { setSugg(null); setError(e instanceof PlanError ? e.message : "Le calcul a échoué."); }
      } finally {
        if (live) setBusy(false);
      }
    }, 150);
    return () => { live = false; clearTimeout(t); };
    // moves.length et bank découlent de draftKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, players, meta, s, ft]);

  const sm = sugg?.moves;
  const pairs = sm ? sm.out.map((o, k) => [o, sm.in[k]] as [number, number]) : [];
  const suggGain = sm ? (sm.with ?? 0) - HIT * sm.hits - sm.keep : 0;
  const sellIds = new Set(pairs.map(([o]) => o));
  const buyIds = new Set(moves.map(([, i]) => i));

  const replace = (out: number, inn: number) => setDraft(draft.map((id) => (id === out ? inn : id)));
  const applyAll = () => { let d = draft; for (const [o, i] of pairs) d = d.map((id) => (id === o ? i : id)); setDraft(d); };

  // Fiche joueur avec la liste des remplaçants possibles
  const [open, setOpen] = useState<Player | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const candidates = (out: Player): Candidate[] => {
    const clubs = new Map<number, number>();
    for (const id of draft) if (id !== out.id) { const t = byId.get(id)!.team_id; clubs.set(t, (clubs.get(t) ?? 0) + 1); }
    const room = bank + out.price;
    return players
      .filter((p) => p.pos === out.pos && !draft.includes(p.id) && (p.g.length > 0 || original.includes(p.id)))
      .map((p) => ({
        p, v: v(p.id),
        blocked: (clubs.get(p.team_id) ?? 0) >= 3 ? `Déjà 3 joueurs de ${p.team}`
          : p.price > room + 1e-9 ? `${price(p.price - room)} de trop` : null,
      }))
      .sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || b.v - a.v);
  };
  const suggestedFor = (id: number) => pairs.find(([o]) => o === id)?.[1];
  const origOf = (id: number) => moves.find(([, i]) => i === id)?.[0];

  const cap = byId.get(squad.captain)!, vice = byId.get(squad.vice)!;
  const n = s.to - s.from + 1;
  const watch = draft.map((id) => byId.get(id)!)
    .filter((p) => p.status !== "a" || (p.chance != null && p.chance < 100) || p.share < 0.8)
    .sort((a, b) => a.share - b.share).slice(0, 5);

  return (
    <>
      <div className="stats" aria-label="Résumé de votre équipe">
        <div className="stat"><div className="label">Points attendus</div><div className="v">{num(draftScore)} <small>C ×2 · ¼ banc</small></div></div>
        <div className="stat"><div className="label">Gain</div><div className={`v ${draftScore - keepScore > 0.05 ? "pos" : draftScore - keepScore < -0.05 ? "neg" : ""}`}>{signed(draftScore - keepScore)}</div></div>
        <div className="stat"><div className="label">Transferts</div>
          <div className="v">{moves.length}<small> / {ft} gratuit{ft > 1 ? "s" : ""}</small></div></div>
        <div className="stat"><div className="label">Pénalité</div><div className={`v ${hits ? "neg" : ""}`}>{hits ? `−${HIT * hits}` : "0"}</div></div>
        <div className="stat"><div className="label">Banque</div><div className={`v ${bank < 0 ? "neg" : ""}`}>{price(bank)}</div></div>
        <div className="stat"><div className="label">Capitaine</div><div className="v">{cap?.name.toUpperCase()}</div></div>
      </div>

      <section className="panel reticle plan"><span className="rt" />
        <div className="plan-head">
          <h2>À faire avant la journée {s.from}</h2>
          <span className="hint">{entry.name} · équipe de la journée {entry.event}{entry.freehit ? " (avant Free Hit)" : ""}</span>
        </div>
        <div className="plan-grid">
          <div className={busy ? "busy" : undefined}>
            <div className="plan-col-head">
              <span className="label">Conseillé</span>
              {pairs.length > 1 ? <button type="button" className="btn small" onClick={applyAll}>Tout appliquer</button> : null}
            </div>
            {error ? <p className="plan-none" style={{ color: "var(--bad)" }}>{error}</p>
              : !sm ? <p className="plan-none">Calcul…</p>
              : pairs.length === 0 ? (
                <p className="plan-none">{moves.length ? "Rien de plus à faire." : `Aucun transfert ne rapporte assez : gardez votre équipe${ft > 0 ? " et reportez vos transferts gratuits" : ""}.`}</p>
              ) : (
                <ol className="moves">
                  {pairs.map(([o, i]) => {
                    const po = byId.get(o)!, pi = byId.get(i)!;
                    return (
                      <li key={o} className="move sugg">
                        <button className="out" onClick={() => setOpen(po)}>
                          <span className="k">Vendre</span><span className="n">{po.name}</span><span className="s">{price(po.price)} · {num(v(o))} pts</span>
                        </button>
                        <span className="arrow" aria-hidden="true">→</span>
                        <button className="in" onClick={() => setOpen(pi)}>
                          <span className="k">Acheter</span><span className="n">{pi.name}</span><span className="s">{price(pi.price)} · {num(v(i))} pts</span>
                        </button>
                        <button type="button" className="btn small apply" onClick={() => replace(o, i)}
                          title="Appliquer ce transfert" aria-label={`Appliquer : ${po.name} remplacé par ${pi.name}, ${signed(v(i) - v(o))} points`}
                          disabled={byId.get(i)!.price > bank + byId.get(o)!.price + 1e-9}>
                          Appliquer {signed(v(i) - v(o))}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            {sm && pairs.length ? (
              <p className="hint" style={{ margin: "8px 0 0" }}>
                Tout appliquer : {signed(suggGain)} pts{sm.hits ? `, pénalité de ${HIT * sm.hits} comprise` : ""}.
              </p>
            ) : null}
          </div>

          <div>
            <div className="plan-col-head">
              <span className="label">Vos transferts</span>
              {moves.length ? <button type="button" className="btn ghost small" onClick={() => setDraft(original)}>Tout annuler</button> : null}
            </div>
            {moves.length === 0 ? (
              <p className="plan-none">Aucun pour l&apos;instant. Appliquez une suggestion, ou touchez un joueur sur le terrain pour le remplacer.</p>
            ) : (
              <ol className="moves">
                {moves.map(([o, i]) => {
                  const po = byId.get(o)!, pi = byId.get(i)!;
                  return (
                    <li key={o} className="move done">
                      <span className="out"><span className="n">{po.name}</span><span className="s">{price(po.price)}</span></span>
                      <span className="arrow" aria-hidden="true">→</span>
                      <button className="in" onClick={() => setOpen(pi)}><span className="n">{pi.name}</span><span className="s">{price(pi.price)}</span></button>
                      <button type="button" className="icon-btn undo" onClick={() => replace(i, o)} aria-label={`Annuler : garder ${po.name}`} title="Annuler">×</button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div>
            <dl className="moves-sum">
              <dt>Équipe actuelle</dt><dd>{num(keepScore)} pts</dd>
              <dt>Avec vos transferts</dt><dd>{num(score(squad))} pts</dd>
              {hits ? <><dt>Pénalité ({hits} × {HIT})</dt><dd>−{HIT * hits} pts</dd></> : null}
              <dt><b>Gain net</b></dt><dd><b>{signed(draftScore - keepScore)} pts</b></dd>
            </dl>
            <p className="plan-line"><span className="badge-c" style={{ position: "static" }}>C</span> {cap.name} <span className="dim">· vice {vice.name}</span></p>
          </div>
        </div>
        <p className="hint" style={{ margin: "12px 0 0" }}>
          Points attendus sur {n > 1 ? `les journées ${s.from} à ${s.to}` : `la journée ${s.from}`} : onze avec capitaine doublé, plus un quart du banc.
          Rien n&apos;est envoyé à FPL : validez vos transferts dans l&apos;application. Prix de revente estimés au prix actuel.
        </p>
      </section>

      <div className="team-layout">
        <Pitch squad={squad} byId={byId} value={v} busy={false}
          head={`Votre équipe · ${squad.formation} · J${s.from}${n > 1 ? `–J${s.to}` : ""}`}
          hint="touchez pour remplacer"
          mark={(id) => (buyIds.has(id) ? "buy" : sellIds.has(id) ? "sell" : undefined)}
          selected={open?.id} onOpen={setOpen} />
        <div className="side">
          <section className="panel card legend-card">
            <h2>Lecture</h2>
            <p><span className="mark sell static">VENDRE</span> vente conseillée par le modèle</p>
            <p><span className="mark buy static">ACHAT</span> joueur que vous avez fait entrer</p>
            <p className="hint">Le onze, le capitaine et l&apos;ordre du banc sont recalculés à chaque changement.</p>
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
        </div>
      </div>

      {open ? (
        <PlayerSheet player={open} meta={meta} onClose={close} actions={!draft.includes(open.id)}
          role={squad.xi.includes(open.id) || squad.bench.includes(open.id)
            ? (open.id === squad.captain ? "C" : open.id === squad.vice ? "V" : squad.xi.includes(open.id) ? "XI" : "BANC") : null}
          extra={draft.includes(open.id) ? (
            <section>
              <div className="label" style={{ marginBottom: 8 }}>Remplacer {open.name}</div>
              {origOf(open.id) != null ? (
                <button type="button" className="btn ghost" style={{ marginBottom: 10 }}
                  onClick={() => { replace(open.id, origOf(open.id)!); close(); }}>
                  Annuler ce transfert : garder {byId.get(origOf(open.id)!)!.name}
                </button>
              ) : null}
              <ReplaceList out={open} outValue={v(open.id)} candidates={candidates(open)} suggested={suggestedFor(open.id)}
                onPick={(p) => { replace(open.id, p.id); close(); }} />
            </section>
          ) : null} />
      ) : null}
    </>
  );
}
