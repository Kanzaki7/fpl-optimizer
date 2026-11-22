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
  { k: "01", t: "Collecte", d: "API officielle FPL, chaque matin via GitHub Actions." },
  { k: "02", t: "Cache", d: "Saisons passées et journées validées gardées : 2 requêtes par jour suffisent." },
  { k: "03", t: "SQLite", d: "6 tables brutes, puis les variables calculées par des vues SQL." },
  { k: "04", t: "Modèle", d: "Points attendus par joueur, journée par journée (pandas)." },
  { k: "05", t: "Solveur", d: "Programme linéaire en nombres entiers (PuLP, HiGHS) sous les règles du jeu." },
  { k: "06", t: "Site", d: "Le même solveur tourne dans le navigateur (WebAssembly) pour vos réglages." },
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
  const data = getData();
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
          De l&apos;API officielle jusqu&apos;à cette page, en six étapes. Le modèle a été réglé sur deux saisons
          passées, puis testé sur une troisième qu&apos;il n&apos;avait jamais vue.
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
          <div className="section-head"><span className="idx">01</span><h2>Le modèle en bref</h2></div>
          <ul>
            <li><strong>Qui joue :</strong> la part de minutes projetée est le meilleur indicateur. Elle mélange la saison passée et la saison en cours ({num(m.w_share * 100, 0)} % aujourd&apos;hui), puis la disponibilité annoncée par le club s&apos;applique. Sous 70 %, un joueur n&apos;est pas retenu.</li>
            <li><strong>À quel niveau :</strong> les points par 90 minutes des trois dernières saisons (60 / 30 / 10 %), mélangés à la saison en cours ({num(m.w_rate * 100, 0)} % aujourd&apos;hui).</li>
            <li><strong>Jeu produit :</strong> les points sont tirés à 60 % vers ce que valent ses xG et xA, plus stables que les buts marqués.</li>
            <li><strong>Calendrier :</strong> chaque match est pondéré par sa difficulté, avec un effet volontairement faible (±7,5 % par niveau).</li>
            <li><strong>Choix des 15 :</strong> un programme linéaire en nombres entiers maximise les points du onze (et un quart de ceux du banc) sous le budget, les quotas par poste et la limite de 3 joueurs par club.</li>
            <li><strong>Transferts :</strong> à partir d&apos;une équipe importée, le même calcul cherche les achats qui rapportent le plus, en comptant 4 points de pénalité par transfert au-delà des gratuits.</li>
          </ul>
        </section>

        {pb ? (
          <section>
            <div className="section-head"><span className="idx">02</span><h2>Testé sur une saison inédite</h2></div>
            <p>
              Le pipeline complet a été rejoué sur <strong>2025-26</strong> : à six moments de la saison, il choisit
              l&apos;équipe avec les seules données de ce jour-là, puis on compte ses points réels sur les 8 journées suivantes.
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
                <p>La meilleure équipe en connaissant les résultats, inatteignable. Le modèle en capte {num((pb.total.model / pb.total.hindsight) * 100, 0)} %.</p>
              </div>
            </div>
            <div className="panel chart-card">
              <h3>Points marqués par fenêtre de 8 journées</h3>
              <p className="sub">Onze et capitaine doublé, équipe figée sur la fenêtre.</p>
              <BacktestBars data={pb} />
              <details className="more-details">
                <summary>Voir les chiffres</summary>
                <div className="table-wrap" style={{ marginTop: 10, boxShadow: "none" }}>
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
              </details>
            </div>
          </section>
        ) : null}

        <section>
          <div className="section-head"><span className="idx">03</span><h2>Limites</h2></div>
          <ul>
            <li>Deux joueurs à 2 ou 3 points d&apos;écart sont équivalents : c&apos;est sous la marge d&apos;erreur du modèle.</li>
            <li>Les blessures ne sont connues que lorsque le club les annonce, et le modèle ne devine pas les rotations.</li>
            <li>Le test ignore transferts et remplacements automatiques : il compare des stratégies, pas un classement réel.</li>
          </ul>
        </section>

        <section>
          <details className="tech">
            <summary><span className="idx">04</span> Détails techniques</summary>
            <div className="tech-body">
              <h3>Collecte</h3>
              <p>
                Les statistiques de tous les joueurs sont lues journée par journée (une requête par journée), et
                l&apos;historique des saisons passées une seule fois par joueur et par saison : 2 requêtes par jour au lieu
                d&apos;environ 750. Reprises avec attente sur les erreurs passagères ; en cas d&apos;échec, rien n&apos;est
                écrit et le site garde les dernières données valides.
              </p>

              <h3>Variables en SQL</h3>
              <p>
                Les réponses de l&apos;API sont chargées dans six tables SQLite ; les variables du modèle sont des vues
                (jointures, agrégats, sous-requêtes, fonctions de fenêtre).{" "}
                <a href={`${REPO}/pipeline/sql/features.sql`}>Voir features.sql</a>
              </p>
              <Sql />

              <h3>Optimisation</h3>
              <pre className="code">
                <span className="k">maximiser</span>{"   "}Σ points(XI) + 0,25 × Σ points(banc){"\n"}
                <span className="k">sous</span>{"        "}Σ prix ≤ budget{"\n"}
                {"            "}2 gardiens, 5 défenseurs, 5 milieux, 3 attaquants{"\n"}
                {"            "}au plus 3 joueurs par club{"\n"}
                {"            "}XI : 1 gardien, 3 à 5 défenseurs, 2 à 5 milieux, 1 à 3 attaquants
              </pre>
              <p className="muted" style={{ marginTop: 10, fontSize: 13.5 }}>
                Résolu par PuLP et HiGHS chaque matin, et par HiGHS compilé en WebAssembly quand vous changez un réglage :
                les deux partent des mêmes points par journée.
              </p>

              {ib ? (
                <>
                  <h3>Validation des indicateurs · {ib.seasons.join(" et ")}</h3>
                  <p className="muted" style={{ fontSize: 14 }}>
                    Après la journée 5, 10 ou 20, chaque indicateur est calculé avec ce qu&apos;on savait alors, puis comparé
                    aux points marqués ensuite. Deux règles intuitives ont été retirées parce que les données les
                    contredisaient : le filtre « joueur en surchauffe » et un seuil de minutes trop strict.
                  </p>
                  <IndicatorCharts data={ib} />
                </>
              ) : null}
            </div>
          </details>
        </section>
      </div>
    </>
  );
}
