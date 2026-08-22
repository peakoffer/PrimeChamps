set lock_timeout = '5s';
set statement_timeout = '60s';

-- Stable, verified identifiers keep lifecycle memory intact when a public
-- handle changes. This table is server-owned: browser roles never query it.
create table public.athlete_identity_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  alias_type text not null check (alias_type in (
    'instagram_handle', 'tiktok_handle', 'external_profile_id', 'email'
  )),
  normalized_value text not null check (nullif(btrim(normalized_value), '') is not null),
  display_value text,
  provider text,
  source text not null default 'crm_backfill',
  verified_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, athlete_id, alias_type, normalized_value)
);

create index athlete_identity_aliases_lookup_idx
  on public.athlete_identity_aliases(organization_id, alias_type, normalized_value)
  where active;
create index athlete_identity_aliases_athlete_idx
  on public.athlete_identity_aliases(athlete_id, verified_at desc);

-- An override is deliberately narrow: one athlete, one research run, one
-- owner-authored reason, and one consumption. It never becomes a permanent
-- bypass of CRM lifecycle memory.
create table public.research_memory_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  research_log_id uuid references public.research_logs(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 8 and 500),
  created_by_user_id uuid not null references public.profiles(user_id) on delete restrict,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_candidate_key text,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index research_memory_overrides_run_idx
  on public.research_memory_overrides(organization_id, research_log_id, athlete_id)
  where consumed_at is null;
create index research_memory_overrides_expiry_idx
  on public.research_memory_overrides(organization_id, expires_at)
  where consumed_at is null;

-- Outcome learning remains a versioned, reviewable snapshot. Recommendations
-- cannot modify a profile or scoring weights by themselves.
create table public.research_learning_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label_policy_version text not null,
  source_cutoff timestamptz not null,
  sample_counts jsonb not null default '{}'::jsonb,
  posterior_metrics jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  leakage_checks jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'rejected', 'archived')),
  created_by_user_id uuid not null references public.profiles(user_id) on delete restrict,
  reviewed_by_user_id uuid references public.profiles(user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index research_learning_snapshots_org_created_idx
  on public.research_learning_snapshots(organization_id, created_at desc);

alter table public.research_intelligence_items
  add column if not exists signal_key text,
  add column if not exists direction text not null default 'positive'
    check (direction in ('positive', 'negative', 'neutral')),
  add column if not exists scope jsonb not null default '{"type":"global"}'::jsonb,
  add column if not exists validity text not null default 'temporary'
    check (validity in ('temporary', 'durable')),
  add column if not exists influence_mode text not null default 'soft'
    check (influence_mode = 'soft');

update public.research_intelligence_items
set signal_key = lower(regexp_replace(category || ':' || statement, '[^a-zA-Z0-9]+', '-', 'g'))
where signal_key is null;

alter table public.research_intelligence_items
  alter column signal_key set not null;

create index research_intelligence_items_signal_idx
  on public.research_intelligence_items(organization_id, signal_key, effective_at desc)
  where status = 'approved';

alter table public.research_profile_versions
  add column if not exists validation_status text not null default 'not_run'
    check (validation_status in ('not_run', 'running', 'passed', 'failed')),
  add column if not exists validation_metrics jsonb not null default '{}'::jsonb,
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by_user_id uuid references public.profiles(user_id) on delete set null;

alter table public.research_candidates
  add column if not exists contextual_adjustment numeric(5,2) not null default 0
    check (contextual_adjustment between -5 and 5),
  add column if not exists contextual_priority_score numeric(5,2)
    check (contextual_priority_score is null or contextual_priority_score between 0 and 100),
  add column if not exists guidance_lane text
    check (guidance_lane is null or guidance_lane in ('aligned', 'exploration'));

alter table public.research_hardening_campaigns
  alter column budget_limit_microusd set default 100000000,
  drop constraint if exists research_hardening_campaigns_budget_limit_microusd_check,
  add constraint research_hardening_campaigns_budget_limit_microusd_check
    check (budget_limit_microusd > 0 and budget_limit_microusd <= 100000000),
  alter column confirmation_reserve_microusd set default 20000000,
  add column if not exists campaign_type text not null default 'cross_sport'
    check (campaign_type in ('cross_sport', 'profile_validation', 'targeted')),
  add column if not exists profile_version_id uuid references public.research_profile_versions(id) on delete set null,
  add column if not exists baseline_profile_version_id uuid references public.research_profile_versions(id) on delete set null,
  add column if not exists preconfirmation_stop_microusd bigint not null default 80000000
    check (preconfirmation_stop_microusd > 0);

-- Preserve the exact historic $50/$40/$10 ledger on completed campaigns while
-- new campaigns receive the $100/$80/$20 defaults.
update public.research_hardening_campaigns
set preconfirmation_stop_microusd = budget_limit_microusd - confirmation_reserve_microusd
where preconfirmation_stop_microusd > budget_limit_microusd - confirmation_reserve_microusd;

alter table public.research_hardening_campaigns
  add constraint research_hardening_campaigns_stop_within_budget_check
    check (
      preconfirmation_stop_microusd <= budget_limit_microusd
      and confirmation_reserve_microusd <= budget_limit_microusd
      and preconfirmation_stop_microusd + confirmation_reserve_microusd <= budget_limit_microusd
    );

alter table public.research_hardening_cases
  add column if not exists profile_variant text not null default 'baseline'
    check (profile_variant in ('baseline', 'guided')),
  add column if not exists replicate_number integer not null default 1
    check (replicate_number between 1 and 10);

alter table public.research_hardening_cases
  drop constraint if exists research_hardening_cases_campaign_id_archetype_stage_attempt_key,
  add constraint research_hardening_cases_campaign_archetype_stage_attempt_variant_key
    unique (campaign_id, archetype, stage, attempt, profile_variant);

create index research_hardening_campaigns_profile_idx
  on public.research_hardening_campaigns(profile_version_id)
  where profile_version_id is not null;

create or replace function public.create_research_profile_draft(
  profile_organization_id uuid,
  profile_name text,
  profile_payload jsonb,
  meeting_ids uuid[],
  item_ids uuid[],
  actor_user_id uuid
)
returns public.research_profile_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
  drafted_profile public.research_profile_versions;
begin
  if profile_organization_id is null or actor_user_id is null then
    raise exception 'organization and actor are required';
  end if;
  if nullif(btrim(profile_name), '') is null then
    raise exception 'profile name is required';
  end if;
  if profile_payload is null or jsonb_typeof(profile_payload) <> 'object' then
    raise exception 'profile payload must be a JSON object';
  end if;
  if exists (
    select 1
    from unnest(coalesce(item_ids, '{}'::uuid[])) requested_item_id
    left join public.research_intelligence_items item
      on item.id = requested_item_id
      and item.organization_id = profile_organization_id
      and item.status = 'approved'
    where item.id is null
  ) then
    raise exception 'every source item must be approved and belong to the organization';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(profile_organization_id::text, 0));
  select coalesce(max(version), 0) + 1 into next_version
  from public.research_profile_versions
  where organization_id = profile_organization_id;

  insert into public.research_profile_versions (
    organization_id, version, name, compiled_profile, source_meeting_ids,
    source_item_ids, status, validation_status, created_by_user_id
  ) values (
    profile_organization_id, next_version, profile_name, profile_payload,
    coalesce(meeting_ids, '{}'::uuid[]), coalesce(item_ids, '{}'::uuid[]),
    'draft', 'not_run', actor_user_id
  ) returning * into drafted_profile;
  return drafted_profile;
end;
$$;

create or replace function public.activate_validated_research_profile(
  requested_profile_id uuid,
  profile_organization_id uuid,
  actor_user_id uuid
)
returns public.research_profile_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  activated_profile public.research_profile_versions;
begin
  perform pg_advisory_xact_lock(hashtextextended(profile_organization_id::text, 0));
  if not exists (
    select 1 from public.research_profile_versions
    where id = requested_profile_id
      and organization_id = profile_organization_id
      and status = 'draft'
      and validation_status = 'passed'
  ) then
    raise exception 'profile must be a validated draft';
  end if;
  update public.research_profile_versions
  set status = 'archived'
  where organization_id = profile_organization_id and status = 'active';
  update public.research_profile_versions
  set status = 'active', activated_by_user_id = actor_user_id, activated_at = now()
  where id = requested_profile_id and organization_id = profile_organization_id
  returning * into activated_profile;
  return activated_profile;
end;
$$;

-- Seed verified aliases from current CRM identities. Conflict-safe because an
-- athlete may legitimately have historical handles while remaining one person.
insert into public.athlete_identity_aliases (
  organization_id, athlete_id, alias_type, normalized_value, display_value, source
)
select
  athlete.organization_id,
  athlete.id,
  'instagram_handle',
  lower(regexp_replace(btrim(athlete.instagram_handle), '^@', '')),
  athlete.instagram_handle,
  'crm_backfill'
from public.athletes athlete
where nullif(btrim(athlete.instagram_handle), '') is not null
on conflict do nothing;

insert into public.athlete_identity_aliases (
  organization_id, athlete_id, alias_type, normalized_value, display_value, source
)
select
  athlete.organization_id,
  athlete.id,
  'tiktok_handle',
  lower(regexp_replace(btrim(athlete.tiktok_handle), '^@', '')),
  athlete.tiktok_handle,
  'crm_backfill'
from public.athletes athlete
where nullif(btrim(athlete.tiktok_handle), '') is not null
on conflict do nothing;

-- The old rejection-pattern system was empty when this migration was authored.
-- Abort rather than silently destroy unexpected production learning.
do $$
declare
  unexpected_rows bigint;
begin
  if to_regclass('public.research_patterns') is not null then
    execute 'select count(*) from public.research_patterns' into unexpected_rows;
    if unexpected_rows <> 0 then
      raise exception 'research_patterns contains % rows; review before removal', unexpected_rows;
    end if;
    execute 'drop table public.research_patterns';
  end if;
end;
$$;

drop trigger if exists athlete_identity_aliases_updated_at on public.athlete_identity_aliases;
create trigger athlete_identity_aliases_updated_at
  before update on public.athlete_identity_aliases
  for each row execute function public.update_updated_at();

alter table public.athlete_identity_aliases enable row level security;
alter table public.research_memory_overrides enable row level security;
alter table public.research_learning_snapshots enable row level security;

revoke all on table
  public.athlete_identity_aliases,
  public.research_memory_overrides,
  public.research_learning_snapshots
from anon, authenticated;

grant all on table
  public.athlete_identity_aliases,
  public.research_memory_overrides,
  public.research_learning_snapshots
to service_role;

revoke all on function public.create_research_profile_draft(uuid, text, jsonb, uuid[], uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.create_research_profile_draft(uuid, text, jsonb, uuid[], uuid[], uuid)
  to service_role;
revoke all on function public.activate_validated_research_profile(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_validated_research_profile(uuid, uuid, uuid)
  to service_role;

comment on table public.athlete_identity_aliases is
  'Verified stable and historical athlete identifiers used for pre-enrichment CRM suppression.';
comment on table public.research_memory_overrides is
  'Owner-audited, expiring, single-run exceptions to lifecycle suppression.';
comment on table public.research_learning_snapshots is
  'Leakage-safe empirical-Bayes outcome analysis and owner-reviewable recommendations.';
