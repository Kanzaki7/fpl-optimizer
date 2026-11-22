"use client";
import { useEffect, useState } from "react";
import type { Meta, Player } from "@/lib/types";
import { price } from "@/lib/format";
import { useSettings } from "./SettingsProvider";
import { PlayerPicker } from "./PlayerPicker";
import { Shape } from "./Shape";

/** Réglages : période, budget, joueurs imposés ou exclus. */
export function Planner({ meta, players }: { meta: Meta; players: Player[] }) {
  const { settings: s, update, toggle, reset, isDefault } = useSettings();
  const byId = new Map(players.map((p) => [p.id, p]));
  const gws = meta.gws;
  const span = s.to - s.from + 1;
  const presets = [1, 4, 8, gws.length].filter((n, i, a) => n <= gws.length && a.indexOf(n) === i);
  // Sur téléphone, les réglages sont repliés derrière un résumé.
  const [open, setOpen] = useState(true);
  useEffect(() => { if (window.matchMedia("(max-width: 640px)").matches) setOpen(false); }, []);
  const summary = `J${s.from}${span > 1 ? `–${s.to}` : ""} · ${price(s.budget)}` +
    (s.force.length ? ` · ${s.force.length} imposé${s.force.length > 1 ? "s" : ""}` : "") +
    (s.exclude.length ? ` · ${s.exclude.length} exclu${s.exclude.length > 1 ? "s" : ""}` : "");

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
      <button type="button" className="pl-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="label">Réglages</span><span className="mono">{summary}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
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

        <div className="pl-field grow">
          <span className="label">Imposer</span>
          <PlayerPicker players={players} taken={[...s.force, ...s.exclude]} label="Imposer un joueur"
            placeholder="Ajouter un joueur…" onPick={(p) => toggle("force", p.id)} />
          <div className="chips">
            {s.force.map((id) => <Chip key={id} id={id} kind="force" />)}
            {s.force.length === 0 ? <span className="hint">Imposez vos 15 joueurs pour évaluer votre équipe.</span>
              : <span className="hint">{s.force.length}/15 · {price(s.force.reduce((a, id) => a + (byId.get(id)?.price ?? 0), 0))}</span>}
          </div>
        </div>

        <div className="pl-field grow">
          <span className="label">Exclure</span>
          <PlayerPicker players={players} taken={[...s.force, ...s.exclude]} label="Exclure un joueur"
            placeholder="Retirer un joueur…" onPick={(p) => toggle("exclude", p.id)} />
          <div className="chips">
            {s.exclude.map((id) => <Chip key={id} id={id} kind="exclude" />)}
          </div>
        </div>
      </div>
      {!isDefault && open ? (
        <button type="button" className="btn ghost pl-reset" onClick={reset}>Réinitialiser</button>
      ) : null}
    </section>
  );
}
