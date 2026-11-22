import { TeamView } from "@/components/TeamView";
import { getData } from "@/lib/data";
import { dateFr, num, price } from "@/lib/format";

export default function Home() {
  const { data, demo } = getData();
  const { meta, squad, players } = data;
  const ids = new Set([...squad.xi, ...squad.bench]);
  const squadPlayers = players.filter((p) => ids.has(p.id));
  const cap = squadPlayers.find((p) => p.id === squad.captain);

  return (
    <>
      <section className="hero">
        <div className="kicker">
          <span className="tag accent">Saison {meta.season}</span>
          <span className="tag">Journée {meta.next_gw}</span>
          <span className="tag">{demo ? "Démonstration" : `Mis à jour le ${dateFr(meta.generated_at)}`}</span>
        </div>
        <h1>L&apos;équipe optimale pour les {meta.horizon} prochaines journées</h1>
        <p className="lead">
          Chaque jour, un pipeline Python et SQL récupère les données officielles de Fantasy Premier League,
          estime les points de {meta.n_players} joueurs, puis un solveur choisit les 15 qui en rapportent
          le plus pour {price(meta.budget)}, dans le respect des règles du jeu.
        </p>
        {demo ? (
          <div className="notice" role="note">
            <span className="label" style={{ color: "var(--accent-ink)" }}>Démo</span>
            <span>
              <strong>Données de démonstration.</strong> En attendant la première exécution quotidienne, le site montre
              le pipeline rejoué sur la saison 2025/26 après la journée {meta.gw_played}.
            </span>
          </div>
        ) : null}
      </section>

      <div className="stats" aria-label="Résumé de l'équipe">
        <div className="stat"><div className="label">Points attendus</div><div className="v">{num(squad.ep_xi)} <small>XI · C ×2</small></div></div>
        <div className="stat"><div className="label">Coût</div><div className="v">{price(squad.cost)}</div></div>
        <div className="stat"><div className="label">Banque</div><div className="v">{price(squad.bank)}</div></div>
        <div className="stat"><div className="label">Formation</div><div className="v">{squad.formation}</div></div>
        <div className="stat"><div className="label">Capitaine</div><div className="v">{cap?.name.toUpperCase()}</div></div>
        <div className="stat"><div className="label">Horizon</div><div className="v">J{meta.next_gw}–{meta.next_gw + meta.horizon - 1}</div></div>
      </div>

      <TeamView squad={squad} players={squadPlayers} meta={meta} />
    </>
  );
}
