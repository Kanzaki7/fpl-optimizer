-- Variables du modèle calculées en SQL, à partir des tables brutes.
-- Les seuils viennent de la table model_params (une vue ne prend pas de paramètres).

-- 1. Matchs disputés par l'équipe de chaque joueur depuis son arrivée dans le
--    jeu (première journée où il apparaît). Sert de dénominateur à la part de
--    minutes : un renfort arrivé à la journée 4 n'est pas jugé sur 10 matchs.
CREATE VIEW v_team_games AS
WITH first_seen AS (
    SELECT player_id, MIN(gw) AS first_gw
    FROM player_gw
    GROUP BY player_id
)
SELECT p.id AS player_id,
       COUNT(f.id) AS team_games
FROM players p
JOIN first_seen s ON s.player_id = p.id
LEFT JOIN fixtures f
       ON f.finished = 1
      AND f.event >= s.first_gw
      AND p.team_id IN (f.team_h, f.team_a)
GROUP BY p.id;

-- 2. Saison en cours : minutes, points, régularité.
--    conc = part des points venant du meilleur match parmi les matchs joués
--    (>= 20 min) : 0,20 sur 5 matchs = régulier, 0,60 = un seul gros match.
CREATE VIEW v_current AS
SELECT g.player_id,
       tg.team_games,
       SUM(g.minutes)                                        AS minutes,
       SUM(g.total_points)                                   AS points,
       SUM(g.clean_sheets)                                   AS clean_sheets,
       SUM(g.minutes >= 20)                                  AS games_played,
       MAX(CASE WHEN g.minutes >= 20 THEN g.total_points END) AS best_game,
       SUM(CASE WHEN g.minutes >= 20 AND g.total_points > 0
                THEN g.total_points ELSE 0 END)              AS positive_points
FROM player_gw g
JOIN v_team_games tg ON tg.player_id = g.player_id
GROUP BY g.player_id;

-- 3. Saisons passées : taux par 90 minutes pondérés 0,6 / 0,3 / 0,1.
--    ROW_NUMBER classe les saisons exploitables de la plus récente à la plus
--    ancienne ; la jointure avec season_weights applique les poids.
CREATE VIEW v_past_rates AS
WITH ranked AS (
    SELECT code, minutes, total_points, clean_sheets,
           ROW_NUMBER() OVER (PARTITION BY code ORDER BY season_name DESC) AS rk
    FROM player_past
    WHERE minutes >= (SELECT value FROM model_params WHERE name = 'min_season_minutes')
)
SELECT r.code,
       SUM(w.weight * (r.total_points - 4.0 * r.clean_sheets) * 90.0 / r.minutes)
           / SUM(w.weight)                                   AS non_cs_pp90,
       SUM(w.weight * r.clean_sheets * 90.0 / r.minutes) / SUM(w.weight) AS cs_per90,
       MAX(CASE WHEN r.rk = 1 THEN r.minutes END)            AS last_minutes,
       COUNT(*)                                              AS seasons_used
FROM ranked r
JOIN season_weights w ON w.rk = r.rk
GROUP BY r.code;

-- 4. Finition sur la carrière : buts / xG, sur les saisons où le xG existe.
CREATE VIEW v_career AS
SELECT code,
       SUM(expected_goals)                                         AS car_xg,
       SUM(CASE WHEN expected_goals > 0 THEN goals_scored ELSE 0 END) AS car_goals
FROM player_past
GROUP BY code;

-- 5. Conversion collective : buts de l'équipe / xG de l'équipe, bornée
--    à [0,5 ; 2]. Une équipe en réussite gonfle buts ET passes de tous ses
--    joueurs ; la « chance » individuelle se mesure au-delà de ce ratio.
CREATE VIEW v_team_conversion AS
SELECT team_id,
       COALESCE(MIN(2.0, MAX(0.5, SUM(goals_scored) / NULLIF(SUM(expected_goals), 0))), 1.0)
           AS team_conv
FROM players
GROUP BY team_id;

-- Table finale : une ligne par joueur disponible, toutes sources jointes.
CREATE VIEW v_player_features AS
SELECT p.id, p.code, p.web_name AS name,
       TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.second_name, '')) AS full_name,
       t.short_name AS team, t.name AS team_name, p.team_id, p.pos_id,
       p.now_cost / 10.0 AS price, p.penalties_order AS pen_order,
       p.status, p.news, p.chance_next,
       p.selected_by_percent AS own,
       p.transfers_in_event - p.transfers_out_event AS net_tr,
       p.total_points,
       p.goals_scored AS goals, p.assists, p.goals_scored + p.assists AS ga,
       p.expected_goals AS xg, p.expected_assists AS xa,
       p.expected_goal_involvements AS xgi,
       c.team_games, COALESCE(c.minutes, 0) AS cur_minutes,
       c.points AS cur_points, c.clean_sheets AS cur_cs,
       COALESCE(c.games_played, 0) AS games_played,
       CASE WHEN c.positive_points > 0 THEN 1.0 * c.best_game / c.positive_points END AS conc,
       pr.non_cs_pp90 AS past_non_cs_pp90, pr.cs_per90 AS past_cs_per90,
       pr.last_minutes, pr.seasons_used,
       COALESCE(ca.car_xg, 0) AS car_xg, COALESCE(ca.car_goals, 0) AS car_goals,
       tc.team_conv
FROM players p
JOIN teams t              ON t.id = p.team_id
LEFT JOIN v_current c     ON c.player_id = p.id
LEFT JOIN v_past_rates pr ON pr.code = p.code
LEFT JOIN v_career ca     ON ca.code = p.code
LEFT JOIN v_team_conversion tc ON tc.team_id = p.team_id
WHERE p.status <> 'u';
