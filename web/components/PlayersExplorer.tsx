"use client";
import { useCallback, useMemo, useState } from "react";
import type { Meta, Player, Pos, Squad } from "@/lib/types";
import { POS_ORDER, num, pct, price, signed } from "@/lib/format";
import { PlayerSheet } from "./PlayerSheet";
import { Shape } from "./Shape";

type Key = "ep" | "ep_opt" | "price" | "value" | "gap" | "share" | "xgi90" | "own" | "points";

const COLS: { key: Key; label: string; title: string }[] = [
  { key: "price", label: "Prix", title: "Prix actuel en millions" },
  { key: "ep", label: "Pts att.", title: "Points attendus sur l'horizon, d'après les points marqués" },
  { key: "ep_opt", label: "Retenu", title: "Valeur utilisée par le solveur (tirée vers le jeu produit)" },
  { key: "value", label: "Pts/£m", title: "Points attendus par million" },
  { key: "gap", label: "Écart xG", title: "Points selon le jeu produit moins points attendus" },
  { key: "share", label: "Minutes", title: "Part de minutes projetée" },
  { key: "xgi90", label: "xGI/90", title: "Buts et passes attendus par 90 minutes" },
  { key: "points", label: "Pts saison", title: "Points marqués cette saison" },
  { key: "own", label: "Sél. %", title: "Pourcentage d'équipes qui l'ont sélectionné" },
];

const PRESETS = [
  { id: "all", label: "Tous" },
  { id: "pool", label: "Titulaires" },
  { id: "squad", label: "Dans l'équipe" },
  { id: "pepite", label: "Pépites" },
] as const;
type Preset = (typeof PRESETS)[number]["id"];

const PAGE = 60;

export function PlayersExplorer({ players, meta, squad, csv }: { players: Player[]; meta: Meta; squad: Squad; csv: string | null }) {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [team, setTeam] = useState("ALL");
  const [maxPrice, setMaxPrice] = useState(0);
  const [preset, setPreset] = useState<Preset>("all");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "ep", dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Player | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const inSquad = useMemo(() => new Set([...squad.xi, ...squad.bench]), [squad]);
  const teams = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players]);
  const prices = [4.5, 5, 5.5, 6, 7, 8, 10, 12];

  const rows = useMemo(() => {
    const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const nq = norm(q.trim());
    const list = players.filter((p) =>
      (pos === "ALL" || p.pos === pos) &&
      (team === "ALL" || p.team === team) &&
      (!maxPrice || p.price <= maxPrice) &&
      (preset !== "pool" || p.ep_opt != null) &&
      (preset !== "squad" || inSquad.has(p.id)) &&
      (preset !== "pepite" || p.pepite) &&
      (!nq || norm(`${p.name} ${p.full_name} ${p.team}`).includes(nq)));
    const v = (p: Player) => p[sort.key] ?? -Infinity;
    return list.sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir);
  }, [players, q, pos, team, maxPrice, preset, sort, inSquad]);

  const reset = () => setLimit(PAGE);
  const sortBy = (key: Key) => {
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));
    reset();
  };
  const shown = rows.slice(0, limit);
  const role = (id: number) =>
    id === squad.captain ? "C" : id === squad.vice ? "V" : squad.xi.includes(id) ? "XI" : squad.bench.includes(id) ? "BANC" : null;

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
          {csv ? <a className="btn ghost" href={csv} download>CSV</a> : null}
        </div>
      </div>
      {preset === "pepite" ? (
        <p className="muted" style={{ fontSize: 13.5, marginTop: -4 }}>
          Titulaires (80 % des minutes ou plus) qui créent beaucoup (xGI/90 ≥ 0,40) sans marquer au-dessus de leur jeu, classés par valeur.
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
              <tr key={p.id} className={inSquad.has(p.id) ? "in-squad" : undefined} onClick={() => setOpen(p)}
                tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(p)}>
                <td>
                  <span className="pname"><Shape pos={p.pos} size={16} /><b>{p.name}</b><span>{p.team} · {p.pos}</span>
                    {p.status !== "a" ? <span className="tag warn" style={{ height: 18 }}>{p.chance ?? 0} %</span> : null}</span>
                </td>
                <td>{num(p.price)}</td>
                <td>{num(p.ep)}</td>
                <td className={p.ep_opt == null ? "dim" : undefined}>{p.ep_opt == null ? "hors pool" : num(p.ep_opt)}</td>
                <td>{num(p.value, 2)}</td>
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
          <button key={p.id} className={`pcard ${inSquad.has(p.id) ? "in-squad" : ""}`} onClick={() => setOpen(p)}>
            <Shape pos={p.pos} size={20} />
            <span className="pname"><b>{p.name}</b><span>{p.team} · {price(p.price)}</span></span>
            <span className="ep">{num(sort.key === "ep" || sort.key === "price" ? p.ep : (p[sort.key] as number | null), sort.key === "value" || sort.key === "xgi90" ? 2 : 1)}
              <small>{sort.key === "ep" || sort.key === "price" ? "pts att." : COLS.find((c) => c.key === sort.key)?.label}</small></span>
            <span className="sub">
              <span>Min. {pct(p.share)}</span><span>Écart {signed(p.gap)}</span><span>{num(p.value, 2)} pts/£m</span>
              {p.ep_opt == null ? <span className="dim">hors pool</span> : null}
            </span>
          </button>
        ))}
      </div>

      {rows.length > limit ? (
        <div className="more"><button className="btn ghost" onClick={() => setLimit((l) => l + PAGE)}>Afficher {Math.min(PAGE, rows.length - limit)} de plus</button></div>
      ) : null}
      {rows.length === 0 ? <p className="muted" style={{ textAlign: "center", padding: 30 }}>Aucun joueur ne correspond à ces filtres.</p> : null}

      {open ? <PlayerSheet player={open} meta={meta} role={role(open.id)} onClose={close} /> : null}
    </>
  );
}
