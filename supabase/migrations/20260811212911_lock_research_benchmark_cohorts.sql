alter table public.research_golden_records
  add column if not exists benchmark_cohort_version text,
  add column if not exists split_assigned_at timestamptz,
  add column if not exists held_out_locked_at timestamptz,
  add column if not exists held_out_revealed_at timestamptz;

alter table public.research_golden_records
  drop constraint if exists research_golden_records_held_out_lock_check;

alter table public.research_golden_records
  add constraint research_golden_records_held_out_lock_check check (
    held_out_locked_at is null
    or benchmark_split = 'held_out'
  );

create index if not exists research_golden_records_cohort_idx
  on public.research_golden_records(organization_id, benchmark_cohort_version, benchmark_split);

create or replace function public.prevent_locked_research_holdout_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.benchmark_split = 'held_out'
    and old.held_out_locked_at is not null
    and old.held_out_revealed_at is null
    and (
      new.athlete_id is distinct from old.athlete_id
      or new.athlete_name is distinct from old.athlete_name
      or new.sport is distinct from old.sport
      or new.decision_at is distinct from old.decision_at
      or new.evidence_cutoff_at is distinct from old.evidence_cutoff_at
      or new.fit_label is distinct from old.fit_label
      or new.achievability_label is distinct from old.achievability_label
      or new.final_outcome is distinct from old.final_outcome
      or new.primary_reason is distinct from old.primary_reason
      or new.explanation is distinct from old.explanation
      or new.decisive_information_publicly_knowable is distinct from old.decisive_information_publicly_knowable
      or new.pursue_today is distinct from old.pursue_today
      or new.internal_record_reference is distinct from old.internal_record_reference
      or new.label_order_fit_before_outcome is distinct from old.label_order_fit_before_outcome
      or new.point_in_time_reliability is distinct from old.point_in_time_reliability
      or new.benchmark_split is distinct from old.benchmark_split
      or new.exclusion_reason is distinct from old.exclusion_reason
      or new.stratification_tags is distinct from old.stratification_tags
      or new.labeled_by_user_id is distinct from old.labeled_by_user_id
      or new.labeled_at is distinct from old.labeled_at
      or new.benchmark_cohort_version is distinct from old.benchmark_cohort_version
      or new.split_assigned_at is distinct from old.split_assigned_at
      or new.held_out_locked_at is distinct from old.held_out_locked_at
    )
  then
    raise exception 'Held-out benchmark records are immutable until explicitly revealed';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_locked_research_holdout_mutation() from public;
grant execute on function public.prevent_locked_research_holdout_mutation() to service_role;

drop trigger if exists prevent_locked_research_holdout_mutation
  on public.research_golden_records;
create trigger prevent_locked_research_holdout_mutation
  before update on public.research_golden_records
  for each row execute function public.prevent_locked_research_holdout_mutation();

comment on column public.research_golden_records.benchmark_cohort_version is
  'Immutable cohort identifier used to keep development and held-out evaluations reproducible.';
comment on column public.research_golden_records.held_out_locked_at is
  'When present, point-in-time labels and evidence cannot change until held_out_revealed_at is set.';
