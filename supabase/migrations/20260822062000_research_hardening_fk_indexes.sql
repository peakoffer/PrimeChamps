set lock_timeout = '5s';
set statement_timeout = '60s';

create index if not exists research_hardening_campaigns_requested_by_idx
  on public.research_hardening_campaigns (requested_by_user_id);

create index if not exists research_hardening_cases_org_idx
  on public.research_hardening_cases (organization_id);

create index if not exists research_hardening_cases_campaign_org_idx
  on public.research_hardening_cases (campaign_id, organization_id);
