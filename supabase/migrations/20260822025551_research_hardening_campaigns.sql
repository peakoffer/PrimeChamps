set lock_timeout = '5s';
set statement_timeout = '60s';

create table if not exists public.research_hardening_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  audience_scope text not null default 'mixed_global'
    check (audience_scope in ('mixed_global')),
  official_scoring_family text not null default 'sonnet',
  challenger_family text not null default 'opus',
  official_model_id text,
  challenger_model_id text,
  model_route_snapshot jsonb not null default '{}'::jsonb,
  matrix jsonb not null default '[]'::jsonb,
  budget_limit_microusd bigint not null default 50000000
    check (budget_limit_microusd > 0 and budget_limit_microusd <= 50000000),
  confirmation_reserve_microusd bigint not null default 10000000
    check (confirmation_reserve_microusd >= 0),
  total_cost_microusd bigint not null default 0 check (total_cost_microusd >= 0),
  max_concurrency integer not null default 3 check (max_concurrency between 1 and 3),
  workflow_run_id text,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (confirmation_reserve_microusd <= budget_limit_microusd),
  check (official_scoring_family = 'sonnet'),
  check (challenger_family = 'opus'),
  unique (id, organization_id)
);

create table if not exists public.research_hardening_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  archetype text not null check (archetype in (
    'team', 'combat', 'judged', 'endurance', 'racquet', 'motorsport', 'water',
    'winter', 'strength', 'action', 'precision', 'adaptive', 'general'
  )),
  sport text not null,
  stage text not null default 'smoke'
    check (stage in ('smoke', 'targeted_rerun', 'confirmation', 'control')),
  attempt integer not null default 1 check (attempt > 0),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled', 'blocked')),
  verdict text check (verdict in ('passed', 'needs_fix', 'source_exhausted', 'safety_stop', 'technical_failure')),
  research_log_id uuid references public.research_logs(id) on delete set null,
  workflow_run_id text,
  official_model_id text,
  challenger_model_id text,
  metrics jsonb not null default '{}'::jsonb,
  shadow_audit jsonb not null default '{}'::jsonb,
  defects jsonb not null default '[]'::jsonb,
  resolution_notes text,
  cost_microusd bigint not null default 0 check (cost_microusd >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, archetype, stage, attempt),
  foreign key (campaign_id, organization_id)
    references public.research_hardening_campaigns(id, organization_id) on delete cascade
);

create index if not exists research_hardening_campaigns_org_created_idx
  on public.research_hardening_campaigns (organization_id, created_at desc);
create unique index if not exists research_hardening_campaigns_one_active_org_idx
  on public.research_hardening_campaigns (organization_id)
  where status in ('queued', 'running', 'paused');
create index if not exists research_hardening_cases_campaign_status_idx
  on public.research_hardening_cases (campaign_id, status, created_at);
create index if not exists research_hardening_cases_research_log_idx
  on public.research_hardening_cases (research_log_id)
  where research_log_id is not null;

drop trigger if exists research_hardening_campaigns_updated_at on public.research_hardening_campaigns;
create trigger research_hardening_campaigns_updated_at
  before update on public.research_hardening_campaigns
  for each row execute function public.update_updated_at();

drop trigger if exists research_hardening_cases_updated_at on public.research_hardening_cases;
create trigger research_hardening_cases_updated_at
  before update on public.research_hardening_cases
  for each row execute function public.update_updated_at();

alter table public.research_hardening_campaigns enable row level security;
alter table public.research_hardening_cases enable row level security;

revoke all on table
  public.research_hardening_campaigns,
  public.research_hardening_cases
from anon, authenticated;

grant all on table
  public.research_hardening_campaigns,
  public.research_hardening_cases
to service_role;

comment on table public.research_hardening_campaigns is
  'Owner-operated, evaluation-only cross-sport hardening campaigns with immutable model and cost ceilings.';
comment on table public.research_hardening_cases is
  'One sport-archetype evaluation attempt, linked to its research log and non-authoritative challenger audit.';
