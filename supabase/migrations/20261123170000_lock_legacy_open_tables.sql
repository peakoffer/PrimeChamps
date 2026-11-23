-- Nine legacy tables still carried allow-all row policies, so anyone holding
-- the public Supabase key could read and write them without signing in. The
-- app reaches these tables only through the server's service key, so access
-- for the public and signed-in roles is removed entirely.
do $$
declare
  target text;
  policy record;
begin
  foreach target in array array[
    'analytics_events', 'approval_decisions', 'athlete_enrichment', 'athlete_posts',
    'outreach_campaigns', 'outreach_messages', 'outreach_templates', 'pipeline_history',
    'research_queue'
  ] loop
    if to_regclass('public.' || target) is null then continue; end if;
    for policy in select policyname from pg_policies where schemaname = 'public' and tablename = target loop
      execute format('drop policy %I on public.%I', policy.policyname, target);
    end loop;
    execute format('alter table public.%I enable row level security', target);
    execute format('revoke all on table public.%I from anon, authenticated', target);
    execute format('grant all on table public.%I to service_role', target);
  end loop;
end $$;
