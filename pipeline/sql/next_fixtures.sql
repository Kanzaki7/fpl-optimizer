-- Les :n prochains matchs de chaque équipe à partir de la journée :first,
-- vus de son côté (pour le site).
WITH sides AS (
    SELECT team_h AS team_id, team_a AS opp_id, 1 AS home, team_h_difficulty AS fdr, event, kickoff_time
    FROM fixtures WHERE finished = 0 AND event >= :first
    UNION ALL
    SELECT team_a, team_h, 0, team_a_difficulty, event, kickoff_time
    FROM fixtures WHERE finished = 0 AND event >= :first
), ranked AS (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY event, kickoff_time) AS n
    FROM sides s
)
SELECT r.team_id, r.event AS gw, t.short_name AS opp, r.home, r.fdr
FROM ranked r JOIN teams t ON t.id = r.opp_id
WHERE r.n <= :n
ORDER BY r.team_id, r.n;
