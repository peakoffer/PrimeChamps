set lock_timeout = '5s';
set statement_timeout = '60s';

-- Research was originally a global JSON log. Make every run attributable,
-- durable, observable, and safe to evaluate without polluting the live funnel.
alter table public.research_logs
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists requested_by_user_id uuid references public.profiles(user_id) on delete set null,
  add column if not exists workflow_run_id text,
  add column if not exists phase text not null default 'queued',
  add column if not exists prompt_version text not null default 'research-v3',
  add column if not exists scoring_model text,
  add column if not exists is_evaluation boolean not null default false,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists provider_costs jsonb not null default '{}'::jsonb,
  add column if not exists phase_history jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.research_logs
set organization_id = (select id from public.organizations order by created_at limit 1)
where organization_id is null;

alter table public.research_logs
  alter column organization_id set not null;

alter table public.research_logs
  drop constraint if exists research_logs_status_check;
alter table public.research_logs
  add constraint research_logs_status_check
  check (status in ('queued', 'running', 'completed', 'error', 'cancelled')) not valid;
alter table public.research_logs validate constraint research_logs_status_check;

create unique index if not exists research_logs_workflow_run_id_key
  on public.research_logs(workflow_run_id)
  where workflow_run_id is not null;
create index if not exists research_logs_org_created_idx
  on public.research_logs(organization_id, created_at desc);
create index if not exists research_logs_org_status_idx
  on public.research_logs(organization_id, status, created_at desc);

create table public.research_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_log_id uuid not null references public.research_logs(id) on delete cascade,
  athlete_id uuid references public.athletes(id) on delete set null,
  candidate_key text not null,
  name text not null,
  sport text not null,
  discovered_rank integer check (discovered_rank is null or discovered_rank > 0),
  raw_candidate jsonb not null default '{}'::jsonb,
  source_evidence jsonb not null default '[]'::jsonb,
  identity_status text not null default 'unresolved'
    check (identity_status in ('unresolved', 'probable', 'verified', 'conflict')),
  identity_confidence numeric(5,2) not null default 0
    check (identity_confidence between 0 and 100),
  instagram_handle text,
  follower_count integer check (follower_count is null or follower_count >= 0),
  engagement_rate numeric,
  age integer check (age is null or age between 0 and 120),
  age_verified boolean not null default false,
  age_source text,
  score numeric(5,2) check (score is null or score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  scoring_reasoning text,
  scoring_model text,
  prompt_version text not null default 'research-v3',
  disposition text not null default 'discovered'
    check (disposition in ('discovered', 'held', 'approval', 'blocked', 'existing', 'skipped', 'rejected')),
  disposition_reason text,
  is_minor boolean,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (research_log_id, candidate_key)
);

create index research_candidates_org_created_idx
  on public.research_candidates(organization_id, created_at desc);
create index research_candidates_run_rank_idx
  on public.research_candidates(research_log_id, discovered_rank);
create index research_candidates_org_disposition_idx
  on public.research_candidates(organization_id, disposition, score desc);
create index research_candidates_athlete_id_idx
  on public.research_candidates(athlete_id)
  where athlete_id is not null;

create table public.research_evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sport text not null,
  candidate_snapshot jsonb not null,
  expected_disposition text not null
    check (expected_disposition in ('approval', 'held', 'blocked', 'rejected')),
  expected_score_min numeric(5,2) check (expected_score_min is null or expected_score_min between 0 and 100),
  expected_score_max numeric(5,2) check (expected_score_max is null or expected_score_max between 0 and 100),
  notes text,
  active boolean not null default true,
  created_by_user_id uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    expected_score_min is null
    or expected_score_max is null
    or expected_score_min <= expected_score_max
  )
);

create table public.research_evaluation_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evaluation_case_id uuid not null references public.research_evaluation_cases(id) on delete cascade,
  research_log_id uuid references public.research_logs(id) on delete set null,
  scoring_model text not null,
  prompt_version text not null,
  actual_score numeric(5,2) check (actual_score is null or actual_score between 0 and 100),
  actual_disposition text,
  passed boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index research_evaluation_cases_org_active_idx
  on public.research_evaluation_cases(organization_id, active, sport);
create index research_evaluation_results_case_created_idx
  on public.research_evaluation_results(evaluation_case_id, created_at desc);

alter table public.research_feedback
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists research_candidate_id uuid references public.research_candidates(id) on delete set null,
  add column if not exists created_by_user_id uuid references public.profiles(user_id) on delete set null;

update public.research_feedback feedback
set organization_id = coalesce(
  (select logs.organization_id from public.research_logs logs where logs.id = feedback.research_log_id),
  (select id from public.organizations order by created_at limit 1)
)
where organization_id is null;

alter table public.research_feedback
  alter column organization_id set not null;

create index if not exists research_feedback_org_created_idx
  on public.research_feedback(organization_id, created_at desc);
create index if not exists research_feedback_candidate_id_idx
  on public.research_feedback(research_candidate_id)
  where research_candidate_id is not null;

alter table public.research_patterns
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.research_patterns
set organization_id = (select id from public.organizations order by created_at limit 1)
where organization_id is null;

alter table public.research_patterns
  alter column organization_id set not null;

alter table public.research_patterns
  drop constraint if exists research_patterns_pattern_type_category_pattern_value_key;

create unique index if not exists research_patterns_org_pattern_key
  on public.research_patterns(organization_id, pattern_type, category, pattern_value);

create index if not exists research_patterns_org_type_idx
  on public.research_patterns(organization_id, pattern_type, category);

-- Add cohort/test-data controls and normalized economics without rewriting the
-- historical values already stored in `contracts.value` and `terms`.
alter table public.athletes
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists is_test_data boolean not null default false,
  add column if not exists source_research_log_id uuid references public.research_logs(id) on delete set null;

update public.athletes
set organization_id = (select id from public.organizations order by created_at limit 1)
where organization_id is null;

alter table public.athletes
  alter column organization_id set not null;

create index if not exists athletes_org_stage_idx
  on public.athletes(organization_id, pipeline_stage, created_at desc);
create index if not exists athletes_org_sport_idx
  on public.athletes(organization_id, sport);
create index if not exists athletes_source_research_log_id_idx
  on public.athletes(source_research_log_id)
  where source_research_log_id is not null;

alter table public.contracts
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists currency text not null default 'USD',
  add column if not exists guaranteed_value numeric,
  add column if not exists projected_revenue_share_value numeric,
  add column if not exists total_contract_value numeric,
  add column if not exists actual_revenue numeric,
  add column if not exists renewal_date date,
  add column if not exists acquisition_source text,
  add column if not exists is_test_data boolean not null default false;

update public.contracts contracts
set organization_id = coalesce(
  (select athletes.organization_id from public.athletes where athletes.id = contracts.athlete_id),
  (select id from public.organizations order by created_at limit 1)
)
where organization_id is null;

update public.contracts
set guaranteed_value = coalesce(
      guaranteed_value,
      monthly_guarantee * contract_duration_months,
      value,
      0
    ),
    projected_revenue_share_value = coalesce(projected_revenue_share_value, 0),
    total_contract_value = coalesce(
      total_contract_value,
      monthly_guarantee * contract_duration_months,
      value,
      0
    )
where guaranteed_value is null
   or projected_revenue_share_value is null
   or total_contract_value is null;

alter table public.contracts
  alter column organization_id set not null,
  add constraint contracts_currency_check check (currency ~ '^[A-Z]{3}$') not valid,
  add constraint contracts_economics_nonnegative_check check (
    coalesce(guaranteed_value, 0) >= 0
    and coalesce(projected_revenue_share_value, 0) >= 0
    and coalesce(total_contract_value, 0) >= 0
    and coalesce(actual_revenue, 0) >= 0
  ) not valid;

alter table public.contracts validate constraint contracts_currency_check;
alter table public.contracts validate constraint contracts_economics_nonnegative_check;

create index if not exists contracts_org_status_idx
  on public.contracts(organization_id, status, created_at desc);
create index if not exists contracts_org_renewal_idx
  on public.contracts(organization_id, renewal_date)
  where renewal_date is not null;

-- Notifications were previously global. Scope each notification to a
-- workspace, with an optional user recipient (null means visible to the team).
alter table public.activity_notifications
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists user_id uuid references public.profiles(user_id) on delete cascade;

update public.activity_notifications
set organization_id = (select id from public.organizations order by created_at limit 1)
where organization_id is null;

alter table public.activity_notifications
  alter column organization_id set not null;

create index if not exists activity_notifications_org_user_created_idx
  on public.activity_notifications(organization_id, user_id, created_at desc);
create index if not exists activity_notifications_org_unread_idx
  on public.activity_notifications(organization_id, read, created_at desc)
  where read = false;

-- This migration is intentionally safe to deploy before the matching app
-- release. During the short rollout window, legacy code may still omit the
-- new organization_id columns. Backfill those writes to the existing default
-- workspace instead of failing a NOT NULL constraint. The hardened app always
-- supplies organization_id explicitly, so these triggers are only a bridge for
-- the schema-first deployment order.
create or replace function public.default_prime_champs_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then
    select id
    into new.organization_id
    from public.organizations
    order by created_at
    limit 1;
  end if;

  if new.organization_id is null then
    raise exception 'An organization is required before inserting into %', tg_table_name;
  end if;

  return new;
end;
$$;

revoke all on function public.default_prime_champs_organization() from public, anon, authenticated;
grant execute on function public.default_prime_champs_organization() to service_role;

drop trigger if exists research_logs_default_organization on public.research_logs;
create trigger research_logs_default_organization
  before insert on public.research_logs
  for each row execute function public.default_prime_champs_organization();

drop trigger if exists research_feedback_default_organization on public.research_feedback;
create trigger research_feedback_default_organization
  before insert on public.research_feedback
  for each row execute function public.default_prime_champs_organization();

drop trigger if exists research_patterns_default_organization on public.research_patterns;
create trigger research_patterns_default_organization
  before insert on public.research_patterns
  for each row execute function public.default_prime_champs_organization();

drop trigger if exists athletes_default_organization on public.athletes;
create trigger athletes_default_organization
  before insert on public.athletes
  for each row execute function public.default_prime_champs_organization();

drop trigger if exists contracts_default_organization on public.contracts;
create trigger contracts_default_organization
  before insert on public.contracts
  for each row execute function public.default_prime_champs_organization();

drop trigger if exists activity_notifications_default_organization on public.activity_notifications;
create trigger activity_notifications_default_organization
  before insert on public.activity_notifications
  for each row execute function public.default_prime_champs_organization();

create or replace function public.current_user_is_organization_member(check_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = check_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

revoke all on function public.current_user_is_organization_member(uuid) from public, anon;
grant execute on function public.current_user_is_organization_member(uuid) to authenticated;

drop trigger if exists research_logs_updated_at on public.research_logs;
create trigger research_logs_updated_at
  before update on public.research_logs
  for each row execute function public.update_updated_at();
drop trigger if exists research_candidates_updated_at on public.research_candidates;
create trigger research_candidates_updated_at
  before update on public.research_candidates
  for each row execute function public.update_updated_at();
drop trigger if exists research_evaluation_cases_updated_at on public.research_evaluation_cases;
create trigger research_evaluation_cases_updated_at
  before update on public.research_evaluation_cases
  for each row execute function public.update_updated_at();

-- The application server owns authorization for these operational tables.
drop policy if exists "Allow all on research_logs" on public.research_logs;
drop policy if exists "Allow all on research_feedback" on public.research_feedback;
drop policy if exists "Allow all on research_patterns" on public.research_patterns;
drop policy if exists "allow_all_notifications" on public.activity_notifications;
drop policy if exists "Allow all for authenticated users" on public.athletes;
drop policy if exists "Organization members can select athletes" on public.athletes;
drop policy if exists "Organization members can insert athletes" on public.athletes;
drop policy if exists "Organization members can update athletes" on public.athletes;
drop policy if exists "Organization members can delete athletes" on public.athletes;
drop policy if exists "Users can read own organization memberships" on public.organization_memberships;

alter table public.research_logs enable row level security;
alter table public.research_candidates enable row level security;
alter table public.research_feedback enable row level security;
alter table public.research_patterns enable row level security;
alter table public.research_evaluation_cases enable row level security;
alter table public.research_evaluation_results enable row level security;
alter table public.activity_notifications enable row level security;
alter table public.athletes enable row level security;

create policy "Users can read own organization memberships"
  on public.organization_memberships for select to authenticated
  using (user_id = auth.uid());

create policy "Organization members can select athletes"
  on public.athletes for select to authenticated
  using (public.current_user_is_organization_member(organization_id));
create policy "Organization members can insert athletes"
  on public.athletes for insert to authenticated
  with check (public.current_user_is_organization_member(organization_id));
create policy "Organization members can update athletes"
  on public.athletes for update to authenticated
  using (public.current_user_is_organization_member(organization_id))
  with check (public.current_user_is_organization_member(organization_id));
create policy "Organization members can delete athletes"
  on public.athletes for delete to authenticated
  using (public.current_user_is_organization_member(organization_id));

revoke all on table
  public.research_logs,
  public.research_candidates,
  public.research_feedback,
  public.research_patterns,
  public.research_evaluation_cases,
  public.research_evaluation_results,
  public.activity_notifications
from anon, authenticated;

grant all on table
  public.research_logs,
  public.research_candidates,
  public.research_feedback,
  public.research_patterns,
  public.research_evaluation_cases,
  public.research_evaluation_results,
  public.activity_notifications
to service_role;

comment on table public.research_candidates is
  'Normalized, evidence-linked candidate ledger for every research run.';
comment on column public.research_logs.is_evaluation is
  'Evaluation runs never create athletes or advance the live pipeline.';
comment on column public.athletes.is_test_data is
  'Exclude synthetic/manual QA records from production analytics by default.';
