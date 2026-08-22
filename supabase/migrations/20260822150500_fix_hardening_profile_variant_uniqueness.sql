set lock_timeout = '5s';
set statement_timeout = '30s';

-- PostgreSQL truncated the original generated constraint name to 63 bytes.
-- Remove that exact legacy key so baseline and guided cases can coexist, then
-- retain the profile-aware key created by the preceding migration.
alter table public.research_hardening_cases
  drop constraint if exists research_hardening_cases_campaign_id_archetype_stage_attemp_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.research_hardening_cases'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (campaign_id, archetype, stage, attempt, profile_variant)'
  ) then
    raise exception 'profile-aware hardening case uniqueness constraint is missing';
  end if;
end;
$$;
