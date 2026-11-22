-- Abonnés aux alertes e-mail. À exécuter une fois dans Supabase → SQL Editor.
create table public.subscribers (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  fpl_id       integer not null check (fpl_id > 0),
  token        text not null unique,               -- lien de confirmation et de désinscription
  confirmed    boolean not null default false,     -- double opt-in
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  last_sent_gw integer                             -- évite d'envoyer deux fois la même journée
);

-- Sécurité au niveau des lignes activée, sans aucune règle : la table est
-- fermée à la clé publique. Seuls le site (route serveur) et le workflow
-- GitHub y accèdent, avec la clé secrète.
alter table public.subscribers enable row level security;
