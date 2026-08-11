-- Denormalized benchmark facts keep a completed experiment reproducible even
-- when linked audit findings are later resolved or annotated.

alter table public.research_benchmark_results
  add column if not exists eligibility_verified boolean,
  add column if not exists researcher_failure boolean not null default false,
  add column if not exists auditor_caught_researcher_failure boolean not null default false;

comment on column public.research_benchmark_results.researcher_failure is
  'True when the original Researcher assessment contains at least one benchmark-relevant error.';
comment on column public.research_benchmark_results.auditor_caught_researcher_failure is
  'True only when the blind Auditor identified a Researcher error before seeing the proposed score.';
