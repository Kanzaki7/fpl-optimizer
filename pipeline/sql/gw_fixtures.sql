-- Matchs de chaque équipe, journée par journée, entre :first et :last (inclus),
-- vus de son côté : sa difficulté FDR. Une double journée donne deux lignes.
SELECT team_h AS team_id, event AS gw, team_h_difficulty AS fdr
FROM fixtures
WHERE event BETWEEN :first AND :last
UNION ALL
SELECT team_a, event, team_a_difficulty
FROM fixtures
WHERE event BETWEEN :first AND :last;
