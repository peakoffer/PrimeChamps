-- PL/pgSQL does not short-circuit record field access, so one shared trigger
-- function cannot read table-specific columns. Split the relabel guards so an
-- evaluation upsert on research_candidates (is_test_data true -> true) works.

drop trigger if exists research_logs_keep_evaluation_flag on public.research_logs;
drop trigger if exists research_candidates_keep_test_flag on public.research_candidates;
drop function if exists public.keep_research_evaluation_flags();

create or replace function public.keep_research_log_evaluation_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_evaluation = true and new.is_evaluation is distinct from true then
    raise exception 'An evaluation research log cannot be relabelled as live research'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.keep_research_candidate_test_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_test_data = true and new.is_test_data is distinct from true then
    raise exception 'An evaluation research candidate cannot be relabelled as live data'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger research_logs_keep_evaluation_flag
  before update of is_evaluation on public.research_logs
  for each row execute function public.keep_research_log_evaluation_flag();

create trigger research_candidates_keep_test_flag
  before update of is_test_data on public.research_candidates
  for each row execute function public.keep_research_candidate_test_flag();

revoke all on function public.keep_research_log_evaluation_flag() from public, anon, authenticated;
revoke all on function public.keep_research_candidate_test_flag() from public, anon, authenticated;
