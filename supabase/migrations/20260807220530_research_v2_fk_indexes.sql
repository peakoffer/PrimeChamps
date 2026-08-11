set lock_timeout = '5s';
set statement_timeout = '30s';

create index if not exists research_scores_organization_idx
  on public.research_scores(organization_id);
create index if not exists research_audits_organization_idx
  on public.research_audits(organization_id);
create index if not exists research_benchmark_results_organization_idx
  on public.research_benchmark_results(organization_id);
