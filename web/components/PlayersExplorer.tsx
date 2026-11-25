"use client";
import { useCallback, useMemo, useState } from "react";
import type { Meta, Player, Pos } from "@/lib/types";
import { POS_ORDER, num, pct, price, signed } from "@/lib/format";
import { periodValue } from "@/lib/plan";
import { PlayerSheet } from "./PlayerSheet";
import { Shape } from "./Shape";
import { useSettings } from "./SettingsProvider";

type Row = Player & { pv: number; val: number; pvg: number; ppm: number };
type Key = "pv" | "pvg" | "ppm" | "val" | "price" | "gap" | "share" | "xgi90" | "points" | "own";

const PRESETS = [
  { id: "all", label: "Tous" },
  { id: "pool", label: "Titulaires" },
  { id: "pepite", label: "Pépites" },
  { id: "mine", label: "Mes choix" },
] as const;
type Preset = (typeof PRESETS)[number]["id"];

const PAGE = 60;

export function PlayersExplorer({ players, meta, csv }: { players: Player[]; meta: Meta; csv: string }) {
  const { settings: s } = useSettings();
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [team, setTeam] = useState("ALL");
  const [maxPrice, setMaxPrice] = useState(0);
  const [preset, setPreset] = useState<Preset>("all");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "pv", dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Player | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const span = s.to - s.from + 1;
  const periodLabel = `J${s.from}${span > 1 ? `–${s.to}` : ""}`;
  const COLS: { key: Key; label: string; title: string }[] = [
    { key: "price", label: "Prix", title: "Prix actuel en millions" },
    { key: "pv", label: `Prévus ${periodLabel}`, title: "Points prévus sur la période choisie (valeur utilisée par le solveur)" },
    { key: "pvg", label: "Prévus/J", title: "Points prévus par journée sur la période" },
    { key: "ppm", label: "Réels/match", title: "Points réels par match joué cette saison" },
    { key: "val", label: "Pts/£m", title: "Points prévus par million sur la période" },
    { key: "gap", label: "Écart xG", title: "Sur 8 journées : points selon le jeu produit moins points attendus" },
    { key: "share", label: "Minutes", title: "Part de minutes projetée" },
    { key: "xgi90", label: "xGI/90", title: "Buts et passes attendus par 90 minutes" },
    { key: "points", label: "Réels saison", title: "Points réellement marqués cette saison" },
    { key: "own", label: "Sél. %", title: "Pourcentage d'équipes qui l'ont sélectionné" },
  ];

  const mine = useMemo(() => new Set([...s.force, ...s.exclude]), [s.force, s.exclude]);
  const teams = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players]);
  const prices = [4.5, 5, 5.5, 6, 7, 8, 10, 12];

  const rows = useMemo(() => {
    const norm = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const nq = norm(q.trim());
    const list: Row[] = players
      .filter((p) =>
        (pos === "ALL" || p.pos === pos) &&
        (team === "ALL" || p.team === team) &&
        (!maxPrice || p.price <= maxPrice) &&
        (preset !== "pool" || p.pool) &&
        (preset !== "pepite" || p.pepite) &&
        (preset !== "mine" || mine.has(p.id)) &&
        (!nq || norm(`${p.name} ${p.full_name} ${p.team}`).includes(nq)))
      .map((p) => {
        const pv = periodValue(p, meta, s.from, s.to);
        return { ...p, pv, val: pv / p.price, pvg: pv / span, ppm: p.games ? p.points / p.games : 0 };
      });
    const v = (p: Row) => p[sort.key] ?? -Infinity;
    return list.sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir);
  }, [players, meta, s.from, s.to, span, q, pos, team, maxPrice, preset, sort, mine]);

  const reset = () => setLimit(PAGE);
  const sortBy = (key: Key) => {
    setSort((o) => ({ key, dir: o.key === key ? (o.dir === 1 ? -1 : 1) : -1 }));
    reset();
  };
  const shown = rows.slice(0, limit);
  const mark = (id: number) => (s.force.includes(id) ? "forced" : s.exclude.includes(id) ? "excluded" : undefined);
  const card = COLS.find((c) => c.key === sort.key && c.key !== "price") ?? COLS[1];

  return (
    <>
      <div className="filters">
        <input className="field search" type="search" placeholder="Rechercher un joueur ou un club" value={q}
          onChange={(e) => { setQ(e.target.value); reset(); }} aria-label="Rechercher" />
        <div className="seg" role="group" aria-label="Poste">
          {(["ALL", ...POS_ORDER] as const).map((p) => (
            <button key={p} aria-pressed={pos === p} onClick={() => { setPos(p); reset(); }}>{p === "ALL" ? "TOUS" : p}</button>
          ))}
        </div>
        <select className="field" value={team} onChange={(e) => { setTeam(e.target.value); reset(); }} aria-label="Club">
          <option value="ALL">Tous les clubs</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="field" value={maxPrice} onChange={(e) => { setMaxPrice(+e.target.value); reset(); }} aria-label="Prix maximum">
          <option value={0}>Tous les prix</option>
          {prices.map((p) => <option key={p} value={p}>≤ {price(p)}</option>)}
        </select>
      </div>
      <div className="filters" style={{ justifyContent: "space-between" }}>
        <div className="seg" role="group" aria-label="Sélection">
          {PRESETS.map((p) => (
            <button key={p.id} aria-pressed={preset === p.id} onClick={() => { setPreset(p.id); reset(); }}>{p.label.toUpperCase()}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="label">{rows.length} joueur{rows.length > 1 ? "s" : ""}</span>
          <select className="field" value={`${sort.key}:${sort.dir}`} aria-label="Trier par"
            onChange={(e) => { const [k, d] = e.target.value.split(":"); setSort({ key: k as Key, dir: +d as 1 | -1 }); reset(); }}>
            {COLS.map((c) => <option key={c.key} value={`${c.key}:-1`}>Trier : {c.label}</option>)}
            <option value="price:1">Trier : prix croissant</option>
          </select>
          <a className="btn ghost" href={csv} download title="Tous les joueurs et indicateurs, sur 8 journées">CSV</a>
        </div>
      </div>
      {preset === "pepite" ? (
        <p className="muted" style={{ fontSize: 13.5, marginTop: -4 }}>
          Titulaires (80 % des minutes ou plus) qui créent beaucoup (xGI/90 ≥ 0,40) sans marquer au-dessus de leur jeu.
        </p>
      ) : null}
      {preset === "mine" && !mine.size ? (
        <p className="muted" style={{ fontSize: 13.5, marginTop: -4 }}>
          Ouvrez la fiche d&apos;un joueur pour l&apos;imposer dans l&apos;équipe ou l&apos;en exclure.
        </p>
      ) : null}

      <div className="table-wrap players-table">
        <table className="data">
          <thead>
            <tr>
              <th>Joueur</th>
              {COLS.map((c) => (
                <th key={c.key} title={c.title} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button onClick={() => sortBy(c.key)}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={mark(p.id)} onClick={() => setOpen(p)}
                tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(p)}>
                <td>
                  <span className="pname"><Shape pos={p.pos} size={16} /><b>{p.name}</b><span>{p.team} · {p.pos}</span>
                    {p.status !== "a" ? <span className="tag warn" style={{ height: 18 }}>{p.chance ?? 0} %</span> : null}
                    {s.force.includes(p.id) ? <span className="tag accent" style={{ height: 18 }}>imposé</span> : null}
                    {s.exclude.includes(p.id) ? <span className="tag" style={{ height: 18 }}>exclu</span> : null}</span>
                </td>
                <td>{num(p.price)}</td>
                <td className={p.pool ? undefined : "dim"} title={p.pool ? undefined : "Hors du pool : temps de jeu insuffisant"}>{num(p.pv)}</td>
                <td>{num(p.pvg, 1)}</td>
                <td className="dim">{p.games ? num(p.ppm, 1) : "—"}</td>
                <td>{num(p.val, 2)}</td>
                <td className={p.gap == null ? "dim" : p.gap > 3 ? "pos" : p.gap < -10 ? "neg" : undefined}>{signed(p.gap)}</td>
                <td className={p.share < (meta.params.min_share as number) ? "dim" : undefined}>{pct(p.share)}</td>
                <td>{num(p.xgi90, 2)}</td>
                <td>{p.points}</td>
                <td>{num(p.own, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cards">
        {shown.map((p) => (
          <button key={p.id} className={`pcard ${mark(p.id) ?? ""}`} onClick={() => setOpen(p)}>
            <Shape pos={p.pos} size={20} />
            <span className="pname"><b>{p.name}</b><span>{p.team} · {price(p.price)}</span></span>
            <span className="ep">{card.key === "share" ? pct(p.share) : card.key === "points" ? p.points : num(p[card.key] as number | null, card.key === "val" || card.key === "xgi90" ? 2 : 1)}
              <small>{card.label}</small></span>
            <span className="sub">
              <span>{num(p.pvg, 1)} prévus/J</span><span>{p.games ? num(p.ppm, 1) : "—"} réels/match</span><span>Min. {pct(p.share)}</span>
              {!p.pool ? <span className="dim">hors pool</span> : null}
              {s.force.includes(p.id) ? <span style={{ color: "var(--accent-ink)" }}>imposé</span> : null}
              {s.exclude.includes(p.id) ? <span className="dim">exclu</span> : null}
            </span>
          </button>
        ))}
      </div>

      {rows.length > limit ? (
        <div className="more"><button className="btn ghost" onClick={() => setLimit((l) => l + PAGE)}>Afficher {Math.min(PAGE, rows.length - limit)} de plus</button></div>
      ) : null}
      {rows.length === 0 ? <p className="muted" style={{ textAlign: "center", padding: 30 }}>Aucun joueur ne correspond à ces filtres.</p> : null}

      {open ? <PlayerSheet player={open} meta={meta} onClose={close} /> : null}
    </>
  );
}
