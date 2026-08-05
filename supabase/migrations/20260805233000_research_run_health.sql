alter table public.research_logs
  add column if not exists heartbeat_at timestamptz;

update public.research_logs
set heartbeat_at = coalesce(heartbeat_at, completed_at, created_at)
where heartbeat_at is null;

-- Earlier enrichment accepted broad list/surname search results as if they were
-- athlete biographies. Preserve the source data, but stop presenting it as a
-- verified individual match.
update public.athlete_enrichment_sources
set status = 'not_found',
    data = data || jsonb_build_object(
      'message',
      'No individual Wikipedia biography matched this athlete. Broad list, surname, and disambiguation pages were ignored.'
    ),
    updated_at = now()
where source = 'wikipedia'
  and status = 'complete'
  and (
    coalesce(data->>'title', '') ~* '^(list of|index of)'
    or coalesce(data->>'title', '') ~* '\((surname|disambiguation)\)'
  );

create index if not exists idx_research_logs_running_heartbeat
  on public.research_logs (heartbeat_at)
  where status = 'running';
