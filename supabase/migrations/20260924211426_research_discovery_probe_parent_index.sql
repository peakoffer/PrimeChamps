set lock_timeout = '5s';
set statement_timeout = '60s';

-- Cover the complete organization-scoped parent foreign key without rewriting
-- the already-applied discovery diagnostic migration.
create index research_discovery_probes_parent_org_idx
  on public.research_discovery_probes(parent_campaign_id, organization_id);
