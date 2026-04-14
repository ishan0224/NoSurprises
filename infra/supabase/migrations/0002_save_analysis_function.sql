-- 0002_save_analysis_function.sql
-- Atomic write helper to keep exactly one latest analysis row per website.

create or replace function public.save_analysis_version(
  p_domain text,
  p_tc_url text,
  p_content_hash text,
  p_risk_score numeric,
  p_risk_label text,
  p_summary text,
  p_red_flags jsonb,
  p_analyzed_at timestamptz default now()
)
returns table (
  id uuid,
  website_id uuid,
  content_hash text,
  risk_score numeric,
  risk_label text,
  summary text,
  red_flags jsonb,
  analyzed_at timestamptz,
  is_latest boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_website_id uuid;
begin
  insert into websites (domain, tc_url)
  values (p_domain, p_tc_url)
  on conflict (domain)
  do update set tc_url = excluded.tc_url
  returning websites.id into v_website_id;

  update analyses
  set is_latest = false
  where analyses.website_id = v_website_id
    and analyses.is_latest = true;

  insert into analyses (
    website_id,
    content_hash,
    risk_score,
    risk_label,
    summary,
    red_flags,
    analyzed_at,
    is_latest
  )
  values (
    v_website_id,
    p_content_hash,
    p_risk_score,
    p_risk_label,
    p_summary,
    p_red_flags,
    p_analyzed_at,
    true
  )
  on conflict on constraint analyses_website_hash_uniq
  do update set
    risk_score = excluded.risk_score,
    risk_label = excluded.risk_label,
    summary = excluded.summary,
    red_flags = excluded.red_flags,
    analyzed_at = excluded.analyzed_at,
    is_latest = true
  returning
    analyses.id,
    analyses.website_id,
    analyses.content_hash,
    analyses.risk_score,
    analyses.risk_label,
    analyses.summary,
    analyses.red_flags,
    analyses.analyzed_at,
    analyses.is_latest
  into
    id,
    website_id,
    content_hash,
    risk_score,
    risk_label,
    summary,
    red_flags,
    analyzed_at,
    is_latest;

  return next;
end;
$$;
