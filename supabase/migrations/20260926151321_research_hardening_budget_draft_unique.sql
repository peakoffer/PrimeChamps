-- Keep the owner-authorized next campaign budget idempotent. Drafts cannot
-- dispatch provider work or consume the archived campaign's allowance.
create unique index research_hardening_one_cross_sport_draft_per_org_idx
  on public.research_hardening_campaigns (organization_id)
  where status = 'draft' and campaign_type = 'cross_sport';
