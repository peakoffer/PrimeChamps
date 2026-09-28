-- Evaluation research is an experiment record. Application routes already
-- refuse to promote it; these triggers are the database backstop so that no
-- route, script, or future launcher can turn evaluation output into a live
-- athlete, or quietly relabel evaluation data as live data first.

create or replace function public.reject_evaluation_athlete_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_research_log_id is not null and exists (
    select 1 from public.research_logs l
    where l.id = new.source_research_log_id and l.is_evaluation = true
  ) then
    raise exception 'Evaluation research log % cannot create or promote a live athlete', new.source_research_log_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger athletes_reject_evaluation_source
  before insert or update of source_research_log_id on public.athletes
  for each row execute function public.reject_evaluation_athlete_source();

create or replace function public.keep_research_evaluation_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'research_logs' and old.is_evaluation = true and new.is_evaluation is distinct from true then
    raise exception 'An evaluation research log cannot be relabelled as live research'
      using errcode = 'check_violation';
  end if;
  if tg_table_name = 'research_candidates' and old.is_test_data = true and new.is_test_data is distinct from true then
    raise exception 'An evaluation research candidate cannot be relabelled as live data'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger research_logs_keep_evaluation_flag
  before update of is_evaluation on public.research_logs
  for each row execute function public.keep_research_evaluation_flags();

create trigger research_candidates_keep_test_flag
  before update of is_test_data on public.research_candidates
  for each row execute function public.keep_research_evaluation_flags();

revoke all on function public.reject_evaluation_athlete_source() from public, anon, authenticated;
revoke all on function public.keep_research_evaluation_flags() from public, anon, authenticated;
