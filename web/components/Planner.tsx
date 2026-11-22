"use client";
import { useEffect, useState } from "react";
import type { Meta, Player } from "@/lib/types";
import type { Entry } from "@/lib/entry";
import { price } from "@/lib/format";
import { useSettings } from "./SettingsProvider";
import { PlayerPicker } from "./PlayerPicker";
import { Shape } from "./Shape";

interface Props {
  meta: Meta;
  players: Player[];
  entry: Entry | null;
  entryError: string | null;
  entryLoading: boolean;
}

/** Réglages : mode, période, budget ou équipe importée, joueurs imposés ou exclus. */
export function Planner({ meta, players, entry, entryError, entryLoading }: Props) {
  const { settings: s, update, toggle, reset, isClean } = useSettings();
  const byId = new Map(players.map((p) => [p.id, p]));
  const gws = meta.gws;
  const span = s.to - s.from + 1;
  const mine = s.mode === "mine";
  const presets = [1, 4, 8, gws.length].filter((n, i, a) => n <= gws.length && a.indexOf(n) === i);
  const [idText, setIdText] = useState(s.entry ? String(s.entry) : "");
  useEffect(() => { if (s.entry) setIdText(String(s.entry)); }, [s.entry]);

  // Sur téléphone, les réglages sont repliés derrière un résumé.
  const [open, setOpen] = useState(true);
  useEffect(() => { if (window.matchMedia("(max-width: 640px)").matches) setOpen(false); }, []);
  const summary = `J${s.from}${span > 1 ? `–${s.to}` : ""} · ` +
    (mine ? (entry ? entry.name : "mon équipe") : price(s.budget)) +
    (s.force.length ? ` · ${s.force.length} imposé${s.force.length > 1 ? "s" : ""}` : "") +
    (s.exclude.length ? ` · ${s.exclude.length} exclu${s.exclude.length > 1 ? "s" : ""}` : "");

  const importTeam = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseInt(idText.replace(/\D/g, ""), 10);
    if (id) update({ entry: id, ft: null });
  };
  const ft = s.ft ?? entry?.ft ?? 1;

  const Chip = ({ id, kind }: { id: number; kind: "force" | "exclude" }) => {
    const p = byId.get(id);
    if (!p) return null;
    return (
      <button type="button" className={`chip ${kind}`} onClick={() => toggle(kind, id)} title="Retirer">
        <Shape pos={p.pos} size={12} />{p.name}<span aria-hidden="true">×</span>
        <span className="sr">retirer</span>
      </button>
    );
  };

  return (
    <section className="panel planner" aria-label="Réglages de l'équipe">
      <div className="pl-top">
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" aria-pressed={!mine} onClick={() => update({ mode: "optimal" })}>ÉQUIPE OPTIMALE</button>
          <button type="button" aria-pressed={mine} onClick={() => update({ mode: "mine" })}>MON ÉQUIPE</button>
        </div>
        <button type="button" className="pl-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="mono">{summary}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
        {!isClean && open ? (
          <button type="button" className="btn ghost pl-reset" onClick={reset}>Réinitialiser</button>
        ) : null}
      </div>

      <div className="pl-row" hidden={!open}>
        <div className="pl-field">
          <span className="label">Période</span>
          <div className="pl-inline">
            <select className="field" value={s.from} aria-label="Première journée" onChange={(e) => update({ from: +e.target.value })}>
              {gws.map((g) => <option key={g} value={g}>J{g}</option>)}
            </select>
            <span className="dim">→</span>
            <select className="field" value={s.to} aria-label="Dernière journée" onChange={(e) => update({ to: +e.target.value })}>
              {gws.filter((g) => g >= s.from).map((g) => <option key={g} value={g}>J{g}</option>)}
            </select>
          </div>
          <div className="seg small" role="group" aria-label="Durée">
            {presets.map((n) => (
              <button key={n} type="button" aria-pressed={s.from === gws[0] && span === n}
                onClick={() => update({ from: gws[0], to: gws[0] + n - 1 })}>{n} J</button>
            ))}
          </div>
        </div>

        {mine ? (
          <div className="pl-field">
            <span className="label">Identifiant FPL</span>
            <form className="pl-inline" onSubmit={importTeam}>
              <input className="field num id" inputMode="numeric" value={idText} placeholder="1234567"
                aria-label="Identifiant de votre équipe FPL" onChange={(e) => setIdText(e.target.value)} />
              <button className="btn" type="submit" disabled={entryLoading}>{entryLoading ? "…" : "Importer"}</button>
            </form>
            {entryError ? <span className="hint" style={{ color: "var(--bad)" }}>{entryError}</span>
              : entry ? <span className="hint"><b style={{ color: "var(--ink)" }}>{entry.name}</b> · banque {price(entry.bank)}</span>
              : <span className="hint">Le nombre dans l&apos;adresse de votre page Points : …/entry/<b>1234567</b>/event/…</span>}
          </div>
        ) : (
          <div className="pl-field">
            <span className="label">Budget</span>
            <div className="pl-inline">
              <span className="dim mono">£</span>
              <input className="field num" type="number" inputMode="decimal" step={0.1} min={80} max={120}
                value={s.budget} aria-label="Budget en millions"
                onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) update({ budget: Math.round(v * 10) / 10 }); }} />
              <span className="dim mono">m</span>
            </div>
            <span className="hint">Valeur de votre équipe + banque.</span>
          </div>
        )}

        {mine ? (
          <div className="pl-field">
            <span className="label">Transferts</span>
            <div className="pl-inline">
              <select className="field" value={ft} aria-label="Transferts gratuits" onChange={(e) => update({ ft: +e.target.value })}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} gratuit{n > 1 ? "s" : ""}</option>)}
              </select>
              <select className="field" value={s.maxT} aria-label="Transferts au plus" onChange={(e) => update({ maxT: +e.target.value })}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} au plus</option>)}
              </select>
            </div>
            <span className="hint">Au-delà des gratuits, −4 pts chacun : le calcul en tient compte.</span>
          </div>
        ) : null}

        <div className="pl-field grow">
          <span className="label">{mine ? "Garder ou acheter" : "Imposer"}</span>
          <PlayerPicker players={players} taken={[...s.force, ...s.exclude]} label="Imposer un joueur"
            placeholder="Ajouter un joueur…" onPick={(p) => toggle("force", p.id)} />
          <div className="chips">
            {s.force.map((id) => <Chip key={id} id={id} kind="force" />)}
            {s.force.length === 0 && !mine ? <span className="hint">Ou importez votre équipe avec « Mon équipe ».</span> : null}
          </div>
        </div>

        <div className="pl-field grow">
          <span className="label">{mine ? "Vendre ou éviter" : "Exclure"}</span>
          <PlayerPicker players={players} taken={[...s.force, ...s.exclude]} label="Exclure un joueur"
            placeholder="Retirer un joueur…" onPick={(p) => toggle("exclude", p.id)} />
          <div className="chips">
            {s.exclude.map((id) => <Chip key={id} id={id} kind="exclude" />)}
          </div>
        </div>
      </div>
    </section>
  );
}
