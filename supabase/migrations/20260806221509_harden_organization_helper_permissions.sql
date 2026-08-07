set lock_timeout = '5s';
set statement_timeout = '60s';

-- Supabase grants new public-schema functions to API roles through default
-- privileges. Remove direct execution from the trigger helper and make the
-- membership predicate an invoker function backed by a self-only RLS policy.
revoke all on function public.default_prime_champs_organization() from public, anon, authenticated;
grant execute on function public.default_prime_champs_organization() to service_role;

create or replace function public.current_user_is_organization_member(check_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = check_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

revoke all on function public.current_user_is_organization_member(uuid) from public, anon;
grant execute on function public.current_user_is_organization_member(uuid) to authenticated, service_role;

drop policy if exists "Users can read own organization memberships" on public.organization_memberships;
create policy "Users can read own organization memberships"
  on public.organization_memberships for select to authenticated
  using (user_id = auth.uid());

-- Cover newly introduced foreign keys so parent-row updates/deletes do not
-- require full child-table scans as the research history grows.
create index if not exists research_logs_requested_by_user_id_idx
  on public.research_logs(requested_by_user_id)
  where requested_by_user_id is not null;
create index if not exists research_feedback_created_by_user_id_idx
  on public.research_feedback(created_by_user_id)
  where created_by_user_id is not null;
create index if not exists research_evaluation_cases_created_by_user_id_idx
  on public.research_evaluation_cases(created_by_user_id)
  where created_by_user_id is not null;
create index if not exists research_evaluation_results_organization_id_idx
  on public.research_evaluation_results(organization_id);
create index if not exists research_evaluation_results_research_log_id_idx
  on public.research_evaluation_results(research_log_id)
  where research_log_id is not null;
create index if not exists activity_notifications_user_id_idx
  on public.activity_notifications(user_id)
  where user_id is not null;
