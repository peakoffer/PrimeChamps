-- Owner-started, evaluation-only Sonnet check of the blind-validated sponsor
-- approval profile against Dylan's historical pitches. Each check stores its
-- frozen model, price snapshot, prompt hash and a hard cost ceiling; results
-- hold only the model's estimate, never an outcome label.
create table if not exists public.research_sponsor_approval_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  provider text not null check (provider in ('anthropic', 'openrouter')),
  model text not null,
  pricing jsonb not null,
  profile_version text not null,
  prompt_hash text not null,
  case_ids uuid[] not null check (cardinality(case_ids) between 1 and 150),
  cost_limit_microusd bigint not null
    check (cost_limit_microusd > 0 and cost_limit_microusd <= 10000000),
  total_cost_microusd bigint not null default 0 check (total_cost_microusd >= 0),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  error text,
  -- A resume request claims the check until this time so concurrent requests cannot double-spend.
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.research_sponsor_approval_check_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  check_id uuid not null,
  golden_record_id uuid not null references public.research_golden_records(id) on delete cascade,
  probability numeric not null check (probability >= 0 and probability <= 100),
  evidence_strength text not null check (evidence_strength in ('strong', 'moderate', 'thin')),
  rationale text not null,
  evidence_claim_count integer not null default 0,
  excluded_reaction_count integer not null default 0,
  cost_microusd bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (check_id, golden_record_id),
  foreign key (check_id, organization_id)
    references public.research_sponsor_approval_checks(id, organization_id) on delete cascade
);

create index if not exists research_sponsor_approval_checks_org_created_idx
  on public.research_sponsor_approval_checks (organization_id, created_at desc);
-- One running check per organization, so two browser tabs cannot double-spend.
create unique index if not exists research_sponsor_approval_checks_one_running_idx
  on public.research_sponsor_approval_checks (organization_id)
  where status = 'running';

drop trigger if exists research_sponsor_approval_checks_updated_at on public.research_sponsor_approval_checks;
create trigger research_sponsor_approval_checks_updated_at
  before update on public.research_sponsor_approval_checks
  for each row execute function public.update_updated_at();

drop trigger if exists research_sponsor_approval_check_results_updated_at on public.research_sponsor_approval_check_results;
create trigger research_sponsor_approval_check_results_updated_at
  before update on public.research_sponsor_approval_check_results
  for each row execute function public.update_updated_at();

alter table public.research_sponsor_approval_checks enable row level security;
alter table public.research_sponsor_approval_check_results enable row level security;

revoke all on table
  public.research_sponsor_approval_checks,
  public.research_sponsor_approval_check_results
from anon, authenticated;

grant all on table
  public.research_sponsor_approval_checks,
  public.research_sponsor_approval_check_results
to service_role;

comment on table public.research_sponsor_approval_checks is
  'Owner-started, evaluation-only Sonnet checks of the sponsor approval profile with an immutable model and hard cost ceiling.';
comment on table public.research_sponsor_approval_check_results is
  'Per-record sponsor approval estimates from a check; outcome labels are joined only when grading.';
