set lock_timeout = '5s';
set statement_timeout = '90s';

-- Research V2 separates evidence, judgment, audit, and historical outcomes so
-- the benchmark cannot silently grade a model against its own conclusions.

create table public.research_rubric_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rubric_key text not null,
  version integer not null check (version > 0),
  name text not null,
  definition jsonb not null,
  definition_hash text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by_user_id uuid references public.profiles(user_id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, rubric_key, version),
  unique (organization_id, definition_hash)
);

create unique index research_rubric_versions_one_active_idx
  on public.research_rubric_versions(organization_id, rubric_key)
  where status = 'active';
create index research_rubric_versions_created_by_idx
  on public.research_rubric_versions(created_by_user_id)
  where created_by_user_id is not null;

create table public.research_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prompt_key text not null,
  role text not null check (role in ('discovery', 'extractor', 'researcher', 'auditor')),
  version integer not null check (version > 0),
  content text not null,
  content_hash text not null,
  output_schema jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by_user_id uuid references public.profiles(user_id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, prompt_key, version),
  unique (organization_id, content_hash)
);

create unique index research_prompt_versions_one_active_idx
  on public.research_prompt_versions(organization_id, prompt_key, role)
  where status = 'active';
create index research_prompt_versions_created_by_idx
  on public.research_prompt_versions(created_by_user_id)
  where created_by_user_id is not null;

create table public.research_model_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  model_id text not null,
  capability text not null check (capability in ('discovery', 'extraction', 'judgment', 'audit', 'embedding')),
  release_label text,
  configuration jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'retired', 'unavailable')),
  first_used_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, model_id, capability)
);

create table public.research_golden_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_id uuid references public.athletes(id) on delete set null,
  athlete_name text not null,
  sport text not null,
  decision_at timestamptz,
  evidence_cutoff_at timestamptz,
  fit_label text not null default 'uncertain' check (fit_label in ('fit', 'not_fit', 'uncertain')),
  achievability_label text not null default 'uncertain'
    check (achievability_label in ('high', 'medium', 'low', 'uncertain')),
  final_outcome text not null default 'unresolved' check (final_outcome in (
    'signed', 'signed_underperformed', 'non_signing', 'onlyfans_rejected', 'stalled', 'unresolved'
  )),
  primary_reason text not null default 'unknown' check (primary_reason in (
    'fit', 'price_economics', 'terms', 'timing', 'interest', 'representation',
    'eligibility', 'brand_risk', 'performance', 'reach', 'other', 'unknown'
  )),
  explanation text,
  decisive_information_publicly_knowable boolean,
  pursue_today text not null default 'uncertain' check (pursue_today in ('yes', 'no', 'uncertain')),
  internal_record_reference text,
  label_order_fit_before_outcome boolean not null default false,
  point_in_time_reliability text not null default 'unusable'
    check (point_in_time_reliability in ('strong', 'partial', 'unusable')),
  benchmark_split text not null default 'excluded'
    check (benchmark_split in ('development', 'held_out', 'excluded')),
  exclusion_reason text,
  stratification_tags text[] not null default '{}'::text[],
  labeled_by_user_id uuid references public.profiles(user_id) on delete set null,
  labeled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (evidence_cutoff_at is null or decision_at is null or evidence_cutoff_at <= decision_at),
  check (
    benchmark_split = 'excluded'
    or (
      decision_at is not null
      and evidence_cutoff_at is not null
      and fit_label in ('fit', 'not_fit')
      and achievability_label in ('high', 'medium', 'low')
      and point_in_time_reliability in ('strong', 'partial')
      and decisive_information_publicly_knowable is not null
      and labeled_at is not null
    )
  )
);

create index research_golden_records_split_idx
  on public.research_golden_records(organization_id, benchmark_split, fit_label, sport);
create index research_golden_records_outcome_idx
  on public.research_golden_records(organization_id, final_outcome, primary_reason);
create index research_golden_records_athlete_idx
  on public.research_golden_records(athlete_id)
  where athlete_id is not null;
create index research_golden_records_labeler_idx
  on public.research_golden_records(labeled_by_user_id)
  where labeled_by_user_id is not null;

create table public.research_candidate_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_candidate_id uuid references public.research_candidates(id) on delete cascade,
  golden_record_id uuid references public.research_golden_records(id) on delete cascade,
  platform text not null,
  platform_identifier text not null,
  profile_url text,
  normalized_name text not null,
  identity_status text not null check (identity_status in ('verified', 'probable', 'conflict', 'unresolved')),
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  verification_method text not null,
  verified_at timestamptz,
  evidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(research_candidate_id, golden_record_id) >= 1),
  unique (organization_id, platform, platform_identifier, research_candidate_id, golden_record_id)
);

create index research_candidate_identities_candidate_idx
  on public.research_candidate_identities(research_candidate_id)
  where research_candidate_id is not null;
create index research_candidate_identities_golden_idx
  on public.research_candidate_identities(golden_record_id)
  where golden_record_id is not null;
create index research_candidate_identities_lookup_idx
  on public.research_candidate_identities(organization_id, platform, platform_identifier);

create table public.research_evidence_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_log_id uuid references public.research_logs(id) on delete cascade,
  research_candidate_id uuid references public.research_candidates(id) on delete cascade,
  golden_record_id uuid references public.research_golden_records(id) on delete cascade,
  canonical_url text not null,
  archived_url text,
  domain text not null,
  title text,
  publisher text,
  source_type text not null check (source_type in (
    'official_roster', 'league', 'university', 'competition', 'social', 'news',
    'interview', 'archive', 'internal_record', 'other'
  )),
  provider text not null,
  provider_request_id text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  historical_as_of timestamptz,
  content_hash text,
  retrieval_status text not null default 'retrieved'
    check (retrieval_status in ('retrieved', 'not_found', 'blocked', 'error')),
  eligible_before_cutoff boolean not null default true,
  exclusion_reason text,
  cost_microusd bigint not null default 0 check (cost_microusd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(research_log_id, research_candidate_id, golden_record_id) >= 1)
);

create index research_evidence_sources_candidate_idx
  on public.research_evidence_sources(research_candidate_id, retrieved_at desc)
  where research_candidate_id is not null;
create index research_evidence_sources_golden_idx
  on public.research_evidence_sources(golden_record_id, retrieved_at desc)
  where golden_record_id is not null;
create index research_evidence_sources_run_idx
  on public.research_evidence_sources(research_log_id, retrieved_at desc)
  where research_log_id is not null;
create index research_evidence_sources_url_idx
  on public.research_evidence_sources(organization_id, canonical_url);

create table public.research_evidence_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evidence_source_id uuid not null references public.research_evidence_sources(id) on delete cascade,
  research_candidate_id uuid references public.research_candidates(id) on delete cascade,
  golden_record_id uuid references public.research_golden_records(id) on delete cascade,
  claim_type text not null,
  claim_text text not null,
  structured_value jsonb not null default '{}'::jsonb,
  source_excerpt text,
  effective_at timestamptz,
  observed_at timestamptz not null default now(),
  support_status text not null default 'unverified'
    check (support_status in ('supported', 'partial', 'unsupported', 'unverified')),
  extraction_confidence numeric(5,2) check (extraction_confidence between 0 and 100),
  extraction_model_version_id uuid references public.research_model_versions(id) on delete set null,
  extraction_prompt_version_id uuid references public.research_prompt_versions(id) on delete set null,
  independence_group text,
  material boolean not null default true,
  eligible_for_scoring boolean not null default false,
  exclusion_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(research_candidate_id, golden_record_id) >= 1),
  check (eligible_for_scoring = false or support_status = 'supported')
);

create index research_evidence_claims_source_idx
  on public.research_evidence_claims(evidence_source_id);
create index research_evidence_claims_candidate_idx
  on public.research_evidence_claims(research_candidate_id, claim_type)
  where research_candidate_id is not null;
create index research_evidence_claims_golden_idx
  on public.research_evidence_claims(golden_record_id, claim_type)
  where golden_record_id is not null;
create index research_evidence_claims_scoring_idx
  on public.research_evidence_claims(organization_id, research_candidate_id, claim_type)
  where eligible_for_scoring = true;
create index research_evidence_claims_model_idx
  on public.research_evidence_claims(extraction_model_version_id)
  where extraction_model_version_id is not null;
create index research_evidence_claims_prompt_idx
  on public.research_evidence_claims(extraction_prompt_version_id)
  where extraction_prompt_version_id is not null;

create table public.research_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_log_id uuid references public.research_logs(id) on delete cascade,
  research_candidate_id uuid references public.research_candidates(id) on delete cascade,
  golden_record_id uuid references public.research_golden_records(id) on delete cascade,
  score_stage text not null check (score_stage in ('researcher', 'auditor_corrected', 'benchmark')),
  fit_score numeric(5,2) not null check (fit_score between 0 and 100),
  achievability_score numeric(5,2) not null check (achievability_score between 0 and 100),
  research_confidence_score numeric(5,2) not null check (research_confidence_score between 0 and 100),
  priority_score numeric(5,2) not null check (priority_score between 0 and 100),
  fit_label text not null check (fit_label in ('fit', 'not_fit', 'uncertain')),
  achievability_label text not null check (achievability_label in ('high', 'medium', 'low', 'uncertain')),
  rubric_version_id uuid not null references public.research_rubric_versions(id) on delete restrict,
  prompt_version_id uuid not null references public.research_prompt_versions(id) on delete restrict,
  model_version_id uuid not null references public.research_model_versions(id) on delete restrict,
  evidence_set_hash text not null,
  assessment jsonb not null,
  unsourced_claim_count integer not null default 0 check (unsourced_claim_count >= 0),
  critical_gap_count integer not null default 0 check (critical_gap_count >= 0),
  is_final boolean not null default false,
  supersedes_score_id uuid references public.research_scores(id) on delete set null,
  cost_microusd bigint not null default 0 check (cost_microusd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(research_candidate_id, golden_record_id) >= 1)
);

create index research_scores_candidate_idx
  on public.research_scores(research_candidate_id, scored_at desc)
  where research_candidate_id is not null;
create index research_scores_organization_idx on public.research_scores(organization_id);
create index research_scores_golden_idx
  on public.research_scores(golden_record_id, scored_at desc)
  where golden_record_id is not null;
create index research_scores_run_idx
  on public.research_scores(research_log_id, scored_at desc)
  where research_log_id is not null;
create index research_scores_rubric_idx on public.research_scores(rubric_version_id);
create index research_scores_prompt_idx on public.research_scores(prompt_version_id);
create index research_scores_model_idx on public.research_scores(model_version_id);
create index research_scores_supersedes_idx
  on public.research_scores(supersedes_score_id)
  where supersedes_score_id is not null;
create unique index research_scores_one_final_candidate_idx
  on public.research_scores(research_log_id, research_candidate_id)
  where is_final = true and research_candidate_id is not null;

create table public.research_audits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_log_id uuid references public.research_logs(id) on delete cascade,
  research_candidate_id uuid references public.research_candidates(id) on delete cascade,
  golden_record_id uuid references public.research_golden_records(id) on delete cascade,
  proposed_score_id uuid not null references public.research_scores(id) on delete cascade,
  corrected_score_id uuid references public.research_scores(id) on delete set null,
  auditor_prompt_version_id uuid not null references public.research_prompt_versions(id) on delete restrict,
  auditor_model_version_id uuid not null references public.research_model_versions(id) on delete restrict,
  blind_sequence boolean not null default true,
  score_hidden_initially boolean not null default true,
  independent_search_completed boolean not null default false,
  claim_sample_rate numeric(5,4) not null default 0.2 check (claim_sample_rate between 0 and 1),
  sampled_claim_count integer not null default 0 check (sampled_claim_count >= 0),
  unsupported_sampled_claim_count integer not null default 0 check (unsupported_sampled_claim_count >= 0),
  verdict text not null check (verdict in ('pass', 'corrected', 'fail')),
  identity_passed boolean not null,
  eligibility_passed boolean not null,
  source_verification_passed boolean not null,
  point_in_time_passed boolean,
  commercial_constraints_complete boolean not null,
  critical_gap_count integer not null default 0 check (critical_gap_count >= 0),
  summary text not null,
  cost_microusd bigint not null default 0 check (cost_microusd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(research_candidate_id, golden_record_id) >= 1),
  check (unsupported_sampled_claim_count <= sampled_claim_count),
  check (verdict <> 'corrected' or corrected_score_id is not null)
);

create index research_audits_candidate_idx
  on public.research_audits(research_candidate_id, created_at desc)
  where research_candidate_id is not null;
create index research_audits_organization_idx on public.research_audits(organization_id);
create index research_audits_golden_idx
  on public.research_audits(golden_record_id, created_at desc)
  where golden_record_id is not null;
create index research_audits_run_idx
  on public.research_audits(research_log_id, created_at desc)
  where research_log_id is not null;
create index research_audits_proposed_score_idx on public.research_audits(proposed_score_id);
create index research_audits_corrected_score_idx
  on public.research_audits(corrected_score_id)
  where corrected_score_id is not null;
create index research_audits_prompt_idx on public.research_audits(auditor_prompt_version_id);
create index research_audits_model_idx on public.research_audits(auditor_model_version_id);

create table public.research_audit_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  audit_id uuid not null references public.research_audits(id) on delete cascade,
  evidence_claim_id uuid references public.research_evidence_claims(id) on delete set null,
  evidence_source_id uuid references public.research_evidence_sources(id) on delete set null,
  failure_type text not null check (failure_type in (
    'wrong_entity', 'stale_information', 'point_in_time_leakage', 'unsupported_claim',
    'missing_source', 'source_retrieval_failure', 'extraction_failure', 'criteria_drift',
    'score_inflation', 'missed_strong_fit', 'achievability_error',
    'researcher_miss_caught_by_auditor', 'researcher_and_auditor_missed',
    'unverified_eligibility', 'duplicate_evidence'
  )),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  details text not null,
  proposed_fix text,
  researcher_missed boolean not null default true,
  auditor_caught boolean not null default true,
  resolution_status text not null default 'open' check (resolution_status in ('open', 'fixed', 'accepted', 'not_reproducible')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index research_audit_findings_audit_idx on public.research_audit_findings(audit_id);
create index research_audit_findings_claim_idx
  on public.research_audit_findings(evidence_claim_id)
  where evidence_claim_id is not null;
create index research_audit_findings_source_idx
  on public.research_audit_findings(evidence_source_id)
  where evidence_source_id is not null;
create index research_audit_findings_failure_idx
  on public.research_audit_findings(organization_id, failure_type, severity, created_at desc);

create table public.research_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  benchmark_split text not null check (benchmark_split in ('development', 'held_out')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  baseline_run_id uuid references public.research_benchmark_runs(id) on delete set null,
  changed_dimension text check (changed_dimension in ('source', 'query_strategy', 'prompt', 'rubric', 'model', 'audit_rule', 'score_weighting')),
  change_description text,
  rubric_version_id uuid not null references public.research_rubric_versions(id) on delete restrict,
  researcher_prompt_version_id uuid not null references public.research_prompt_versions(id) on delete restrict,
  auditor_prompt_version_id uuid not null references public.research_prompt_versions(id) on delete restrict,
  researcher_model_version_id uuid not null references public.research_model_versions(id) on delete restrict,
  auditor_model_version_id uuid not null references public.research_model_versions(id) on delete restrict,
  metrics jsonb not null default '{}'::jsonb,
  cost_limit_microusd bigint not null default 0 check (cost_limit_microusd >= 0),
  total_cost_microusd bigint not null default 0 check (total_cost_microusd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (baseline_run_id is null or changed_dimension is not null)
);

create index research_benchmark_runs_org_idx
  on public.research_benchmark_runs(organization_id, benchmark_split, status, created_at desc);
create index research_benchmark_runs_baseline_idx
  on public.research_benchmark_runs(baseline_run_id)
  where baseline_run_id is not null;
create index research_benchmark_runs_rubric_idx on public.research_benchmark_runs(rubric_version_id);
create index research_benchmark_runs_researcher_prompt_idx on public.research_benchmark_runs(researcher_prompt_version_id);
create index research_benchmark_runs_auditor_prompt_idx on public.research_benchmark_runs(auditor_prompt_version_id);
create index research_benchmark_runs_researcher_model_idx on public.research_benchmark_runs(researcher_model_version_id);
create index research_benchmark_runs_auditor_model_idx on public.research_benchmark_runs(auditor_model_version_id);
create index research_benchmark_runs_created_by_idx
  on public.research_benchmark_runs(created_by_user_id)
  where created_by_user_id is not null;

create table public.research_benchmark_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  benchmark_run_id uuid not null references public.research_benchmark_runs(id) on delete cascade,
  golden_record_id uuid not null references public.research_golden_records(id) on delete restrict,
  researcher_score_id uuid references public.research_scores(id) on delete set null,
  audit_id uuid references public.research_audits(id) on delete set null,
  predicted_fit_label text check (predicted_fit_label in ('fit', 'not_fit', 'uncertain')),
  predicted_achievability_label text check (predicted_achievability_label in ('high', 'medium', 'low', 'uncertain')),
  predicted_priority_score numeric(5,2) check (predicted_priority_score between 0 and 100),
  fit_correct boolean,
  achievability_correct boolean,
  priority_gate_correct boolean,
  source_verification_rate numeric(5,4) check (source_verification_rate between 0 and 1),
  unsupported_claim_rate numeric(5,4) check (unsupported_claim_rate between 0 and 1),
  identity_correct boolean,
  point_in_time_compliant boolean,
  failure_types text[] not null default '{}'::text[],
  cost_microusd bigint not null default 0 check (cost_microusd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  unique (benchmark_run_id, golden_record_id)
);

create index research_benchmark_results_golden_idx on public.research_benchmark_results(golden_record_id);
create index research_benchmark_results_organization_idx on public.research_benchmark_results(organization_id);
create index research_benchmark_results_score_idx
  on public.research_benchmark_results(researcher_score_id)
  where researcher_score_id is not null;
create index research_benchmark_results_audit_idx
  on public.research_benchmark_results(audit_id)
  where audit_id is not null;

create table public.research_funnel_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  athlete_id uuid references public.athletes(id) on delete cascade,
  research_candidate_id uuid references public.research_candidates(id) on delete cascade,
  golden_record_id uuid references public.research_golden_records(id) on delete set null,
  event_type text not null check (event_type in (
    'discovered', 'researched', 'qualified', 'selected', 'contacted', 'responded',
    'introduced', 'approved', 'offered', 'signed'
  )),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'crm',
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  check (num_nonnulls(athlete_id, research_candidate_id, golden_record_id) >= 1)
);

create index research_funnel_events_athlete_idx
  on public.research_funnel_events(athlete_id, occurred_at)
  where athlete_id is not null;
create index research_funnel_events_candidate_idx
  on public.research_funnel_events(research_candidate_id, occurred_at)
  where research_candidate_id is not null;
create index research_funnel_events_golden_idx
  on public.research_funnel_events(golden_record_id, occurred_at)
  where golden_record_id is not null;
create index research_funnel_events_org_type_idx
  on public.research_funnel_events(organization_id, event_type, occurred_at desc);
create index research_funnel_events_actor_idx
  on public.research_funnel_events(actor_user_id)
  where actor_user_id is not null;

alter table public.research_logs
  add column if not exists rubric_version_id uuid references public.research_rubric_versions(id) on delete set null,
  add column if not exists researcher_prompt_version_id uuid references public.research_prompt_versions(id) on delete set null,
  add column if not exists auditor_prompt_version_id uuid references public.research_prompt_versions(id) on delete set null,
  add column if not exists researcher_model_version_id uuid references public.research_model_versions(id) on delete set null,
  add column if not exists auditor_model_version_id uuid references public.research_model_versions(id) on delete set null,
  add column if not exists benchmark_run_id uuid references public.research_benchmark_runs(id) on delete set null,
  add column if not exists evidence_cutoff_at timestamptz,
  add column if not exists cost_limit_microusd bigint not null default 0 check (cost_limit_microusd >= 0),
  add column if not exists total_cost_microusd bigint not null default 0 check (total_cost_microusd >= 0),
  add column if not exists latency_ms integer check (latency_ms is null or latency_ms >= 0);

create index research_logs_rubric_version_idx on public.research_logs(rubric_version_id) where rubric_version_id is not null;
create index research_logs_researcher_prompt_idx on public.research_logs(researcher_prompt_version_id) where researcher_prompt_version_id is not null;
create index research_logs_auditor_prompt_idx on public.research_logs(auditor_prompt_version_id) where auditor_prompt_version_id is not null;
create index research_logs_researcher_model_idx on public.research_logs(researcher_model_version_id) where researcher_model_version_id is not null;
create index research_logs_auditor_model_idx on public.research_logs(auditor_model_version_id) where auditor_model_version_id is not null;
create index research_logs_benchmark_run_idx on public.research_logs(benchmark_run_id) where benchmark_run_id is not null;

drop trigger if exists research_rubric_versions_updated_at on public.research_rubric_versions;
create trigger research_rubric_versions_updated_at before update on public.research_rubric_versions
  for each row execute function public.update_updated_at();
drop trigger if exists research_prompt_versions_updated_at on public.research_prompt_versions;
create trigger research_prompt_versions_updated_at before update on public.research_prompt_versions
  for each row execute function public.update_updated_at();
drop trigger if exists research_golden_records_updated_at on public.research_golden_records;
create trigger research_golden_records_updated_at before update on public.research_golden_records
  for each row execute function public.update_updated_at();

alter table public.research_rubric_versions enable row level security;
alter table public.research_prompt_versions enable row level security;
alter table public.research_model_versions enable row level security;
alter table public.research_golden_records enable row level security;
alter table public.research_candidate_identities enable row level security;
alter table public.research_evidence_sources enable row level security;
alter table public.research_evidence_claims enable row level security;
alter table public.research_scores enable row level security;
alter table public.research_audits enable row level security;
alter table public.research_audit_findings enable row level security;
alter table public.research_benchmark_runs enable row level security;
alter table public.research_benchmark_results enable row level security;
alter table public.research_funnel_events enable row level security;

-- V2 evidence contains confidential business outcomes and is server-owned.
-- Authenticated app routes must authorize membership before using service_role.
revoke all on table
  public.research_rubric_versions,
  public.research_prompt_versions,
  public.research_model_versions,
  public.research_golden_records,
  public.research_candidate_identities,
  public.research_evidence_sources,
  public.research_evidence_claims,
  public.research_scores,
  public.research_audits,
  public.research_audit_findings,
  public.research_benchmark_runs,
  public.research_benchmark_results,
  public.research_funnel_events
from anon, authenticated;

grant all on table
  public.research_rubric_versions,
  public.research_prompt_versions,
  public.research_model_versions,
  public.research_golden_records,
  public.research_candidate_identities,
  public.research_evidence_sources,
  public.research_evidence_claims,
  public.research_scores,
  public.research_audits,
  public.research_audit_findings,
  public.research_benchmark_runs,
  public.research_benchmark_results,
  public.research_funnel_events
to service_role;

comment on table public.research_golden_records is
  'Leakage-controlled human labels separating historical fit, achievability, and commercial outcome.';
comment on table public.research_evidence_sources is
  'Point-in-time source provenance for every material Research V2 claim.';
comment on table public.research_evidence_claims is
  'Structured source-backed claims; only supported claims are eligible for scoring.';
comment on table public.research_scores is
  'Versioned fit, achievability, confidence, and priority judgments pinned to an evidence set.';
comment on table public.research_audits is
  'Independent blind-audit verdicts and corrected assessments for Research V2.';
comment on table public.research_audit_findings is
  'Actionable failure taxonomy emitted by independent research audits.';
comment on table public.research_benchmark_runs is
  'One-variable-at-a-time benchmark experiments over development or held-out golden records.';
