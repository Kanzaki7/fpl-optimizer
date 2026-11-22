import type { Metadata } from "next";
import { PlayersExplorer } from "@/components/PlayersExplorer";
import { csvHref, getData } from "@/lib/data";

export const metadata: Metadata = {
  title: "Joueurs",
  description: "Points attendus, temps de jeu et indicateurs xG de chaque joueur de Fantasy Premier League.",
};

export default function Joueurs() {
  const { data, demo } = getData();
  const { meta, players, squad } = data;
  return (
    <>
      <section className="hero">
        <div className="kicker">
          <span className="tag accent">{meta.n_players} joueurs évalués</span>
          <span className="tag">{meta.n_pool} dans le pool d&apos;optimisation</span>
          {demo ? <span className="tag">Démonstration</span> : null}
        </div>
        <h1>Tous les joueurs</h1>
        <p className="lead">
          Les points attendus sur les {meta.horizon} prochaines journées, avec les indicateurs qui les expliquent.
          Cliquez sur un joueur pour ouvrir sa fiche. Le filet orange signale les joueurs de l&apos;équipe.
        </p>
      </section>
      <div style={{ marginBottom: 48 }}>
        <PlayersExplorer players={players} meta={meta} squad={squad} csv={csvHref(demo)} />
      </div>
    </>
  );
}
