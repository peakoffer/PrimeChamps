set lock_timeout = '5s';
set statement_timeout = '90s';

create table public.research_evidence_preparation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by_user_id uuid references public.profiles(user_id) on delete set null,
  workflow_run_id text unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  record_ids uuid[] not null,
  max_apify_charge_microusd bigint not null
    check (max_apify_charge_microusd between 500000 and 1000000),
  actual_apify_cost_microusd bigint
    check (actual_apify_cost_microusd is null or actual_apify_cost_microusd >= 0),
  records_processed integer not null default 0 check (records_processed >= 0),
  records_ready integer not null default 0 check (records_ready >= 0),
  safe_source_count integer not null default 0 check (safe_source_count >= 0),
  safe_claim_count integer not null default 0 check (safe_claim_count >= 0),
  checkpoint jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(record_ids) between 1 and 10),
  check (records_processed <= cardinality(record_ids)),
  check (records_ready <= records_processed)
);

create index research_evidence_preparation_runs_org_created_idx
  on public.research_evidence_preparation_runs(organization_id, created_at desc);
create index research_evidence_preparation_runs_active_idx
  on public.research_evidence_preparation_runs(organization_id, status, created_at desc)
  where status in ('queued', 'running');

-- A replay must update the same archived source and deterministic claim rows
-- rather than duplicating evidence when a durable step retries.
create unique index research_evidence_sources_golden_historical_url_uidx
  on public.research_evidence_sources(
    organization_id,
    golden_record_id,
    canonical_url,
    historical_as_of
  );

create unique index research_evidence_claims_golden_source_type_uidx
  on public.research_evidence_claims(
    organization_id,
    evidence_source_id,
    golden_record_id,
    claim_type
  );

drop trigger if exists research_evidence_preparation_runs_updated_at
  on public.research_evidence_preparation_runs;
create trigger research_evidence_preparation_runs_updated_at
  before update on public.research_evidence_preparation_runs
  for each row execute function public.update_updated_at();

alter table public.research_evidence_preparation_runs enable row level security;

-- Benchmark evidence and run diagnostics remain server-owned. App routes
-- authorize organization owners/admins before using the service role.
revoke all on table public.research_evidence_preparation_runs from anon, authenticated;
grant all on table public.research_evidence_preparation_runs to service_role;

comment on table public.research_evidence_preparation_runs is
  'Bounded, replayable preparation of dated public evidence for leakage-safe benchmark records.';
comment on column public.research_evidence_preparation_runs.max_apify_charge_microusd is
  'Hard provider charge ceiling for the single paid discovery step; scoring-token spend is always zero.';
comment on column public.research_evidence_preparation_runs.actual_apify_cost_microusd is
  'Provider-reported charge when available; null means only the enforced ceiling is known.';
