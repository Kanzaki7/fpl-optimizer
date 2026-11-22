-- Données brutes de l'API FPL, une table par source.
-- Les types suivent SQLite ; les clés étrangères documentent les jointures.

CREATE TABLE teams (
    id                     INTEGER PRIMARY KEY,
    name                   TEXT NOT NULL,
    short_name             TEXT NOT NULL,
    strength_defence_home  INTEGER,
    strength_defence_away  INTEGER,
    strength_attack_home   INTEGER,
    strength_attack_away   INTEGER
);

CREATE TABLE players (
    id                  INTEGER PRIMARY KEY,      -- identifiant de la saison
    code                INTEGER NOT NULL UNIQUE,  -- identifiant stable entre saisons
    web_name            TEXT NOT NULL,
    first_name          TEXT,
    second_name         TEXT,
    team_id             INTEGER NOT NULL REFERENCES teams(id),
    pos_id              INTEGER NOT NULL CHECK (pos_id BETWEEN 1 AND 4),
    now_cost            INTEGER NOT NULL,         -- en dixièmes de million
    status              TEXT,                     -- a, d, i, s, u, n
    news                TEXT,
    chance_next         INTEGER,                  -- % de chances de jouer, NULL = aucune info
    penalties_order     INTEGER,
    selected_by_percent REAL,
    transfers_in_event  INTEGER,
    transfers_out_event INTEGER,
    total_points        INTEGER,
    goals_scored        INTEGER,
    assists             INTEGER,
    expected_goals      REAL,
    expected_assists    REAL,
    expected_goal_involvements REAL
);

CREATE TABLE fixtures (
    id                 INTEGER PRIMARY KEY,
    event              INTEGER,                   -- journée, NULL si non programmé
    finished           INTEGER NOT NULL,
    team_h             INTEGER NOT NULL REFERENCES teams(id),
    team_a             INTEGER NOT NULL REFERENCES teams(id),
    team_h_difficulty  INTEGER,
    team_a_difficulty  INTEGER,
    team_h_score       INTEGER,
    team_a_score       INTEGER,
    kickoff_time       TEXT
);

-- Une ligne par joueur et par journée terminée (double journée = somme).
CREATE TABLE player_gw (
    player_id        INTEGER NOT NULL,
    gw               INTEGER NOT NULL,
    minutes          INTEGER NOT NULL,
    total_points     INTEGER NOT NULL,
    clean_sheets     INTEGER NOT NULL,
    goals_scored     INTEGER NOT NULL,
    assists          INTEGER NOT NULL,
    expected_goals   REAL,
    expected_assists REAL,
    starts           INTEGER,
    PRIMARY KEY (player_id, gw)
);

-- Totaux des saisons passées en Premier League, par joueur (code stable).
CREATE TABLE player_past (
    code             INTEGER NOT NULL,
    season_name      TEXT NOT NULL,               -- « 2024/25 » : l'ordre texte est chronologique
    minutes          INTEGER NOT NULL,
    total_points     INTEGER NOT NULL,
    goals_scored     INTEGER,
    assists          INTEGER,
    clean_sheets     INTEGER,
    expected_goals   REAL,
    expected_assists REAL,
    PRIMARY KEY (code, season_name)
);

-- Pondération des saisons passées : rang 1 = la plus récente exploitable.
CREATE TABLE season_weights (
    rk     INTEGER PRIMARY KEY,
    weight REAL NOT NULL
);

-- Seuils du modèle lus par les vues (voir pipeline/config.py).
CREATE TABLE model_params (
    name  TEXT PRIMARY KEY,
    value REAL NOT NULL
);

CREATE INDEX idx_fixtures_event ON fixtures(event);
CREATE INDEX idx_player_gw_gw ON player_gw(gw);
