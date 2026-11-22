export type Pos = "GK" | "DEF" | "MID" | "FWD";
/** [journée, adversaire, domicile (1/0), difficulté FDR 1-5] */
export type Fixture = [number, string, number, number];
/** [journée, points, minutes] */
export type GwRow = [number, number, number];

export interface Player {
  id: number;
  code: number;
  name: string;
  full_name: string;
  team: string;
  team_id: number;
  pos: Pos;
  price: number;
  ep: number;
  ep_opt: number | null;
  ep_x: number | null;
  gap: number | null;
  ep_gw: number | null;
  value: number;
  share: number;
  minutes: number;
  games: number;
  conc: number | null;
  xgi90: number | null;
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  points: number;
  car_fin: number | null;
  luck_g: number | null;
  own: number;
  net_tr: number;
  pen: number | null;
  new: boolean;
  status: string;
  chance: number | null;
  news: string;
  motif: string | null;
  pepite: boolean;
  robust: number[];
  next: Fixture[];
  hist: GwRow[];
}

export interface Squad {
  xi: number[];
  bench: number[];
  captain: number;
  vice: number;
  formation: string;
  cost: number;
  bank: number;
  ep_xi: number;
  ep_bench: number;
}

export interface Team {
  id: number;
  short: string;
  name: string;
  n_games: number;
  fdr: number;
  cs_prob: number;
  next: Fixture[];
}

export interface Meta {
  season: string;
  next_gw: number;
  gw_played: number;
  horizon: number;
  budget: number;
  w_rate: number;
  w_share: number;
  stability_horizons: number[];
  source: "api" | "replay";
  api_calls: number;
  generated_at: string;
  version: string;
  n_players: number;
  n_pool: number;
  params: Record<string, number | number[]>;
}

export interface Payload {
  meta: Meta;
  squad: Squad;
  teams: Team[];
  players: Player[];
}

export interface PipelineBacktest {
  season: string;
  horizon: number;
  rows: { cutoff: number; gws: string; model: number; popular: number; hindsight: number; captain: string; formation: string }[];
  total: { model: number; popular: number; hindsight: number };
}

export interface IndicatorBacktest {
  seasons: string[];
  cutoffs: number[];
  horizon: number;
  indicators: { cutoff: number; label: string; corr: number; n: number }[];
  blend: { cutoff: number; w: number; corr: number }[];
  filters: { cutoff: number; label: string; n: number; future: number }[];
  share_thresholds: { cutoff: number; label: string; n: number; future: number }[];
  fixtures: { cutoff: number; season: string; corr: number }[];
  bench: { cutoff: number; ratio: number }[];
}
