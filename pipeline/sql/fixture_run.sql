-- Calendrier de chaque équipe sur l'horizon [:next_gw, :next_gw + :horizon[ :
-- nombre de matchs (blanks et doubles compris) et difficulté moyenne (FDR 1-5).
WITH runs AS (
    SELECT team_h AS team_id, team_h_difficulty AS fdr
    FROM fixtures
    WHERE event >= :next_gw AND event < :next_gw + :horizon
    UNION ALL
    SELECT team_a, team_a_difficulty
    FROM fixtures
    WHERE event >= :next_gw AND event < :next_gw + :horizon
)
SELECT t.id AS team_id,
       COUNT(r.team_id)          AS n_games,
       COALESCE(AVG(r.fdr), 3.0) AS avg_fdr
FROM teams t
LEFT JOIN runs r ON r.team_id = t.id
GROUP BY t.id;
