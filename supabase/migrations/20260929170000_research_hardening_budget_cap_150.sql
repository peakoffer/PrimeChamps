-- The owner's September 29 release authorization is $150. Raise the table's
-- absolute per-campaign ceiling from $100 to exactly that amount; it remains a
-- hard database limit that no application path can exceed.
alter table public.research_hardening_campaigns
  drop constraint research_hardening_campaigns_budget_limit_microusd_check;
alter table public.research_hardening_campaigns
  add constraint research_hardening_campaigns_budget_limit_microusd_check
    check (budget_limit_microusd > 0 and budget_limit_microusd <= 150000000);
