import type { Metadata } from "next";
import { BacktestBars, IndicatorCharts } from "@/components/Charts";
import { getData, getIndicatorBacktest, getPipelineBacktest } from "@/lib/data";
import { num } from "@/lib/format";

export const metadata: Metadata = {
  title: "Méthode",
  description: "Collecte, base SQL, modèle de points attendus, optimisation linéaire et backtest du FPL Optimizer.",
};

const REPO = "https://github.com/Kanzaki7/fpl-optimizer/blob/main";

const STEPS = [
  { k: "01", t: "Collecte", d: "API officielle FPL : 2 requêtes par jour, plus une par journée terminée." },
  { k: "02", t: "Cache", d: "Saisons passées et journées validées gardées en JSON, versionnées." },
  { k: "03", t: "SQLite", d: "6 tables brutes, puis les variables calculées par des vues SQL." },
  { k: "04", t: "Modèle", d: "Points attendus par joueur sur les 8 prochaines journées (pandas)." },
  { k: "05", t: "Solveur", d: "Programme linéaire en nombres entiers (PuLP, HiGHS) sous les règles du jeu." },
  { k: "06", t: "Site", d: "JSON et CSV commités par GitHub Actions, Vercel reconstruit le site." },
];

function Sql() {
  return (
    <pre className="code">
      <span className="c">-- Taux par 90 min des saisons passées, pondérés 0,6 / 0,3 / 0,1</span>{"\n"}
      <span className="k">CREATE VIEW</span> v_past_rates <span className="k">AS</span>{"\n"}
      <span className="k">WITH</span> ranked <span className="k">AS</span> ({"\n"}
      {"    "}<span className="k">SELECT</span> code, minutes, total_points, clean_sheets,{"\n"}
      {"           "}<span className="k">ROW_NUMBER() OVER</span> (<span className="k">PARTITION BY</span> code <span className="k">ORDER BY</span> season_name <span className="k">DESC</span>) <span className="k">AS</span> rk{"\n"}
      {"    "}<span className="k">FROM</span> player_past{"\n"}
      {"    "}<span className="k">WHERE</span> minutes &gt;= (<span className="k">SELECT</span> value <span className="k">FROM</span> model_params <span className="k">WHERE</span> name = &apos;min_season_minutes&apos;){"\n"}
      ){"\n"}
      <span className="k">SELECT</span> r.code,{"\n"}
      {"       "}<span className="k">SUM</span>(w.weight * (r.total_points - 4.0 * r.clean_sheets) * 90.0 / r.minutes){"\n"}
      {"           "}/ <span className="k">SUM</span>(w.weight) <span className="k">AS</span> non_cs_pp90,{"\n"}
      {"       "}<span className="k">MAX</span>(<span className="k">CASE WHEN</span> r.rk = 1 <span className="k">THEN</span> r.minutes <span className="k">END</span>) <span className="k">AS</span> last_minutes{"\n"}
      <span className="k">FROM</span> ranked r{"\n"}
      <span className="k">JOIN</span> season_weights w <span className="k">ON</span> w.rk = r.rk{"\n"}
      <span className="k">GROUP BY</span> r.code;
    </pre>
  );
}

export default function Methode() {
  const { data } = getData();
  const pb = getPipelineBacktest();
  const ib = getIndicatorBacktest();
  const m = data.meta;
  const gain = pb ? (pb.total.model / pb.total.popular - 1) * 100 : 0;
  const wins = pb ? pb.rows.filter((r) => r.model > r.popular).length : 0;

  return (
    <>
      <section className="hero">
        <div className="kicker"><span className="tag accent">Python · SQL · PuLP</span><span className="tag">v{m.version}</span></div>
        <h1>Comment l&apos;équipe est choisie</h1>
        <p className="lead">
          De l&apos;API officielle jusqu&apos;à cette page, en six étapes. Chaque constante du modèle a été confrontée
          aux saisons passées, et le pipeline complet est testé sur une saison qu&apos;il n&apos;a jamais vue.
        </p>
      </section>

      <div className="doc">
        <section>
          <div className="flow">
            {STEPS.map((s) => (
              <div key={s.k} className="step"><span className="k">{s.k}</span><h3>{s.t}</h3><p>{s.d}</p></div>
            ))}
          </div>
        </section>

        <section>
          <div className="section-head"><span className="idx">01 · 02</span><h2>Collecte et nettoyage</h2></div>
          <p>
            La première version interrogeait la fiche de chaque joueur, soit environ 750 requêtes par exécution.
            Le pipeline lit maintenant les statistiques de tous les joueurs <strong>journée par journée</strong> (une
            requête par journée), et ne télécharge l&apos;historique des saisons passées qu&apos;une fois par saison et par
            joueur, indexé par son identifiant stable. En régime courant : <strong>2 requêtes par jour</strong>.
          </p>
          <ul>
            <li>Reprises avec attente exponentielle, respect de l&apos;en-tête <code>Retry-After</code> (l&apos;API répond 503 pendant ses mises à jour) ; un refus 403 n&apos;est pas retenté.</li>
            <li>Les champs xG arrivent en texte, les pourcentages de disponibilité peuvent être vides : tout est typé au chargement.</li>
            <li>En cas d&apos;échec, l&apos;exécution s&apos;arrête sans rien écrire : le site garde les dernières données valides.</li>
          </ul>
        </section>

        <section>
          <div className="section-head"><span className="idx">03</span><h2>Les variables en SQL</h2></div>
          <p>
            Les réponses de l&apos;API sont chargées dans six tables SQLite (équipes, joueurs, matchs, stats par journée,
            saisons passées, pondérations). Les variables du modèle sont des <strong>vues</strong> : jointures, agrégats,
            sous-requêtes et fonctions de fenêtre. On peut ouvrir la base pour vérifier n&apos;importe quel chiffre
            (<code>python -m pipeline --db fpl.sqlite</code>).
          </p>
          <Sql />
          <p className="muted" style={{ marginTop: 12, fontSize: 13.5 }}>
            Les autres vues calculent les matchs disputés depuis l&apos;arrivée de chaque joueur, sa régularité (part des points
            venant de son meilleur match), sa finition sur la carrière, la conversion de son équipe et le calendrier.{" "}
            <a href={`${REPO}/pipeline/sql/features.sql`}>Lire features.sql</a>
          </p>
        </section>

        <section>
          <div className="section-head"><span className="idx">04</span><h2>Le modèle</h2></div>
          <pre className="code">
            <span className="c">{"# points attendus d'un joueur sur l'horizon"}</span>{"\n"}
            EP = matchs × [ taux/90 × part de minutes × calendrier{"\n"}
            {"             "}+ P(clean sheet) × points de clean sheet × part de minutes ]
          </pre>
          <ul style={{ marginTop: 14 }}>
            <li><strong>Taux par 90 minutes :</strong> les trois dernières saisons, pondérées 60 / 30 / 10 %, mélangées à la saison en cours, dont le poids monte de 8 % par journée (plafond 70 %, aujourd&apos;hui {num(m.w_rate * 100, 0)} %).</li>
            <li><strong>Part de minutes :</strong> le signal le plus fiable. La saison en cours pèse 15 % par journée (plafond 85 %, aujourd&apos;hui {num(m.w_share * 100, 0)} %), puis la disponibilité annoncée par le club s&apos;applique.</li>
            <li><strong>Nouveaux venus :</strong> lissés vers la médiane de leur poste tant que l&apos;échantillon est court (confiance = minutes / (minutes + 900)).</li>
            <li><strong>Jeu produit :</strong> un second calcul remplace buts et passes par les xG et xA. Pour l&apos;optimisation, les milieux et attaquants sont tirés à 60 % vers cette valeur ; les défenseurs seulement vers le haut, les gardiens jamais.</li>
            <li><strong>Pool :</strong> les joueurs projetés sous 70 % des minutes sont écartés ({m.n_pool} retenus sur {m.n_players}).</li>
          </ul>
        </section>

        <section>
          <div className="section-head"><span className="idx">05</span><h2>L&apos;optimisation</h2></div>
          <p>
            Choisir 15 joueurs parmi {m.n_pool} est un problème de sac à dos avec contraintes : un programme linéaire en
            nombres entiers, résolu exactement en moins d&apos;une seconde.
          </p>
          <pre className="code">
            <span className="k">maximiser</span>{"   "}Σ EP(XI) + 0,25 × Σ EP(banc){"\n"}
            <span className="k">sous</span>{"        "}Σ prix ≤ £{num(m.budget, 1)}m{"\n"}
            {"            "}2 gardiens, 5 défenseurs, 5 milieux, 3 attaquants{"\n"}
            {"            "}au plus 3 joueurs par club{"\n"}
            {"            "}XI : 1 gardien, 3 à 5 défenseurs, 2 à 5 milieux, 1 à 3 attaquants
          </pre>
          <p className="muted" style={{ marginTop: 12, fontSize: 13.5 }}>
            Le calcul est refait à 4, 6 et 8 journées : un joueur retenu aux trois horizons est un choix solide, un joueur
            retenu à un seul est un pari sur le calendrier.
          </p>
        </section>

        <section>
          <div className="section-head"><span className="idx">06</span><h2>Backtest</h2></div>
          {pb ? (
            <>
              <p>
                Les constantes ont été réglées sur 2023-24 et 2024-25. Le pipeline complet est ensuite rejoué sur{" "}
                <strong>2025-26</strong>, saison qu&apos;il n&apos;a jamais vue : à six moments de la saison, on reconstruit
                les données telles qu&apos;elles étaient ce jour-là, on choisit l&apos;équipe, et on compte les points
                réellement marqués sur les 8 journées suivantes.
              </p>
              <div className="callouts">
                <div className="panel reticle callout"><span className="rt" />
                  <div className="label">Modèle</div>
                  <div className="big-num">{pb.total.model}<small> pts</small></div>
                  <p>Sur 48 journées, sans transfert. Meilleur que la foule {wins} fois sur {pb.rows.length}.</p>
                </div>
                <div className="panel callout">
                  <div className="label">Les plus sélectionnés</div>
                  <div className="big-num">{pb.total.popular}<small> pts</small></div>
                  <p>L&apos;équipe la plus populaire possible sous les mêmes règles : le modèle fait {num(gain, 1)} % de mieux.</p>
                </div>
                <div className="panel callout">
                  <div className="label">Idéal a posteriori</div>
                  <div className="big-num">{pb.total.hindsight}<small> pts</small></div>
                  <p>Inatteignable : la meilleure équipe en connaissant les résultats. Le modèle en capte {num((pb.total.model / pb.total.hindsight) * 100, 0)} %.</p>
                </div>
              </div>
              <div className="panel chart-card">
                <h3>Points marqués par fenêtre de 8 journées · saison 2025/26</h3>
                <p className="sub">XI et capitaine doublé, équipe figée sur la fenêtre.</p>
                <BacktestBars data={pb} />
                <div className="table-wrap" style={{ marginTop: 14, boxShadow: "none" }}>
                  <table className="data">
                    <thead><tr><th>Journées</th><th>Modèle</th><th>Plus sélectionnés</th><th>Idéal</th><th>Capitaine</th></tr></thead>
                    <tbody>
                      {pb.rows.map((r) => (
                        <tr key={r.cutoff} style={{ cursor: "default" }}>
                          <td>J{r.gws}</td><td>{r.model}</td><td>{r.popular}</td><td>{r.hindsight}</td><td>{r.captain}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {ib ? (
            <div style={{ marginTop: 28 }}>
              <h3 style={{ marginBottom: 8 }}>Validation des indicateurs · {ib.seasons.join(" et ")}</h3>
              <p className="muted" style={{ fontSize: 14 }}>
                On se place après la journée 5, 10 ou 20, on calcule chaque indicateur avec ce qu&apos;on savait alors,
                et on mesure son lien avec les points marqués ensuite. Deux règles intuitives ont été retirées parce que les
                données les contredisaient : le filtre « joueur en surchauffe » (ces joueurs ont marqué plus que les autres)
                et un seuil de minutes trop strict.
              </p>
              <IndicatorCharts data={ib} />
            </div>
          ) : null}
        </section>

        <section>
          <div className="section-head"><span className="idx">07</span><h2>Limites</h2></div>
          <ul>
            <li>La marge d&apos;erreur dépasse les écarts de 2 ou 3 points entre joueurs proches : le modèle classe, il ne tranche pas.</li>
            <li>Le calendrier pèse peu (±7,5 % par point de difficulté) : sur 8 journées, son lien avec les points mesuré dans le backtest reste entre 0 et 0,08.</li>
            <li>Le prix prédit les points aussi bien que le temps de jeu (0,41 contre 0,40 après la journée 5) : il résume le jugement du marché. Le modèle ne s&apos;en sert pas comme entrée, pour ne pas suivre la foule.</li>
            <li>Le bonus des tireurs de penalty et la règle sur les mauvais finisseurs n&apos;ont pas pu être validés faute de données.</li>
            <li>Le backtest ignore transferts, remplacements automatiques et blessures annoncées ; il compare des stratégies, pas un classement réel.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
