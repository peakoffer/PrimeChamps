-- The owner's September 29 $150 release-campaign authorization may be consumed
-- once per organization, regardless of campaign status, like the $50 one.
create unique index research_hardening_one_150_authorization_per_org_idx
  on public.research_hardening_campaigns
    (organization_id, (budget_configuration ->> 'authorization_key'))
  where budget_configuration ->> 'authorization_key' = '2026-09-29-cross-sport-150';
