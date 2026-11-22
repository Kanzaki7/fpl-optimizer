"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fromOther, type Meta, type Other, type Player, type Squad } from "@/lib/types";
import type { Entry } from "@/lib/entry";
import { num, pct, price, signed } from "@/lib/format";
import { periodValue, type Solution } from "@/lib/plan";
import { PlanError, solve } from "@/lib/solver";
import { Shape } from "./Shape";
import { PlayerSheet } from "./PlayerSheet";
import { Planner } from "./Planner";
import { Pitch } from "./Pitch";
import { MyTeam } from "./MyTeam";
import { useSettings } from "./SettingsProvider";

interface Props {
  squad: Squad;
  players: Player[];
  others: Other[];
  meta: Meta;
}

const period = (from: number, to: number) =>
  from === to ? `la journée ${from}` : `les journées ${from} à ${to}`;

export function TeamView({ squad: base, players: evaluated, others, meta }: Props) {
  const { settings: s, isDefault } = useSettings();
  // les joueurs non évalués servent aux équipes importées (comptés à 0 point)
  const players = useMemo(() => [...evaluated, ...others.map(fromOther)], [evaluated, others]);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const mine = s.mode === "mine";
  const n = s.to - s.from + 1;

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
              ? `${entry.name} : appliquez les transferts conseillés ou remplacez vous-même un joueur, le site recalcule les points, le budget et les pénalités. Vous validez ensuite dans l'application FPL.`
              : "Entrez l'identifiant de votre équipe FPL : le site lit votre équipe publique, sans mot de passe, et propose les meilleurs transferts."
            : `Les 15 joueurs qui devraient rapporter le plus sur ${n > 1 ? `ces ${n} journées` : "cette journée"}, pour ${price(s.budget)}, dans le respect des règles du jeu. Changez la période, le budget ou imposez des joueurs : l'équipe se recalcule.`}
        </p>
      </section>

      <Planner meta={meta} players={players} entry={entry} entryError={entryError} entryLoading={entryLoading} />

      {mine ? (
        entry ? (
          entry.picks.some((id) => !byId.has(id)) ? (
            <div className="panel empty-state">
              <h2>Équipe incomplète</h2>
              <p>Un joueur de votre équipe ne figure pas encore dans les données du jour (transfert récent ?). Réessayez après la prochaine mise à jour, demain matin.</p>
            </div>
          ) : <MyTeam entry={entry} players={players} byId={byId} meta={meta} s={s} />
        ) : (
          <div className="panel empty-state">
            {entryLoading ? <p>Import de votre équipe…</p> : entryError ? (
              <><h2>Import impossible</h2><p>{entryError}</p></>
            ) : (
              <>
                <h2>Importez votre équipe</h2>
                <p>
                  Entrez l&apos;identifiant de votre équipe FPL ci-dessus. Il se trouve dans l&apos;adresse de votre page
                  Points : fantasy.premierleague.com/entry/<b>1234567</b>/event/… Aucun mot de passe n&apos;est demandé :
                  le site lit seulement votre équipe publique.
                </p>
              </>
            )}
          </div>
        )
      ) : (
        <Optimal base={base} players={players} byId={byId} meta={meta} isDefault={isDefault} />
      )}
    </>
  );
}

/** Mode « équipe optimale » : l'équipe du pipeline, ou recalculée selon les réglages. */
function Optimal({ base, players, byId, meta, isDefault }: {
  base: Squad; players: Player[]; byId: Map<number, Player>; meta: Meta; isDefault: boolean;
}) {
  const { settings: s } = useSettings();
  const [open, setOpen] = useState<Player | null>(null);
  const close = useCallback(() => setOpen(null), []);
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
        if (live) { setSol(null); setError(e instanceof PlanError ? e.message : "Le calcul a échoué. Rechargez la page."); }
      } finally {
        if (live) setBusy(false);
      }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [s, isDefault, players, meta]);

  const squad: Squad = sol ?? base;
  const value = (id: number) => sol ? sol.value.get(id) ?? 0 : periodValue(byId.get(id)!, meta, s.from, s.to);
  const xi = squad.xi.map((id) => byId.get(id)!).filter(Boolean);
  const all = [...xi, ...squad.bench.map((id) => byId.get(id)!).filter(Boolean)];
  const cap = byId.get(squad.captain)!;
  const vice = byId.get(squad.vice)!;
  const watch = all.filter((p) => p.status !== "a" || (p.chance != null && p.chance < 100) || p.share < 0.8);
  const values = [...xi].sort((a, b) => value(b.id) / b.price - value(a.id) / a.price).slice(0, 3);
  const n = s.to - s.from + 1;
  const role = (id: number) =>
    id === squad.captain ? "C" as const : id === squad.vice ? "V" as const : squad.xi.includes(id) ? "XI" as const : "BANC" as const;

  return (
    <>
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
        <Pitch squad={squad} byId={byId} value={value} busy={busy} forced={s.force}
          head={`XI · ${squad.formation} · J${s.from}${n > 1 ? `–J${s.to}` : ""}`} hint={`pts attendus sur ${n} J`}
          selected={open?.id} onOpen={setOpen} />

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
