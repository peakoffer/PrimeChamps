alter table public.research_golden_records
  drop constraint if exists research_golden_records_check1;

alter table public.research_golden_records
  add constraint research_golden_records_check1
  check (
    benchmark_split = 'excluded'
    or (
      decision_at is not null
      and evidence_cutoff_at is not null
      and fit_label in ('fit', 'not_fit')
      and achievability_label in ('high', 'medium', 'low')
      and point_in_time_reliability in ('strong', 'partial')
      and labeled_at is not null
      and (
        decisive_information_publicly_knowable is not null
        or stratification_tags @> array['dylan_outcome_ground_truth']::text[]
      )
    )
  );

comment on constraint research_golden_records_check1 on public.research_golden_records is
  'Frozen cases require complete labels and dates. Dylan outcome-ledger cases may preserve unknown public knowability because leakage-safe evidence readiness is enforced by the freeze route.';
