import type { Metadata } from "next";
import { PlayersExplorer } from "@/components/PlayersExplorer";
import { CSV_HREF, getData } from "@/lib/data";

export const metadata: Metadata = {
  title: "Joueurs",
  description: "Points attendus, temps de jeu et indicateurs xG de chaque joueur de Fantasy Premier League.",
};

export default function Joueurs() {
  const { meta, players } = getData();
  return (
    <>
      <section className="hero">
        <div className="kicker">
          <span className="tag accent">{meta.n_players} joueurs évalués</span>
          <span className="tag">{meta.n_pool} dans le pool d&apos;optimisation</span>
        </div>
        <h1>Tous les joueurs</h1>
        <p className="lead">
          Les points attendus sur la période choisie, avec les indicateurs qui les expliquent.
          Cliquez sur un joueur pour ouvrir sa fiche, l&apos;imposer ou l&apos;exclure de l&apos;équipe.
        </p>
      </section>
      <div style={{ marginBottom: 48 }}>
        <PlayersExplorer players={players} meta={meta} csv={CSV_HREF} />
      </div>
    </>
  );
}
