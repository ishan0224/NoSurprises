-- 0001_init.sql
-- Initial schema for NoSurprises cache + analysis history.

create extension if not exists pgcrypto;

create table if not exists websites (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  tc_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete restrict,
  content_hash text not null,
  risk_score numeric(3,1) not null,
  risk_label text not null,
  summary text not null,
  red_flags jsonb not null default '[]'::jsonb,
  analyzed_at timestamptz not null default now(),
  is_latest boolean not null default false,
  constraint analyses_risk_score_chk
    check (risk_score >= 0 and risk_score <= 10),
  constraint analyses_risk_label_chk
    check (risk_label in ('Low Risk', 'Medium Risk', 'High Risk')),
  constraint analyses_website_hash_uniq
    unique (website_id, content_hash)
);

create index if not exists idx_websites_domain
  on websites(domain);

create index if not exists idx_analyses_website_analyzed_at
  on analyses(website_id, analyzed_at desc);

-- Enforce one and only one latest analysis row per website.
create unique index if not exists idx_analyses_one_latest
  on analyses(website_id)
  where is_latest = true;
