-- One owner authorization may be consumed once, regardless of campaign status.
-- A future budget decision uses a different reviewed key and migration.
create unique index research_hardening_one_50_authorization_per_org_idx
  on public.research_hardening_campaigns
    (organization_id, (budget_configuration ->> 'authorization_key'))
  where budget_configuration ->> 'authorization_key' = '2026-09-26-cross-sport-50';
