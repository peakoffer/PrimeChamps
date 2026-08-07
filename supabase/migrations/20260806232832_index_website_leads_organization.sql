create index if not exists website_leads_organization_created_at_idx
  on public.website_leads (organization_id, created_at desc)
  where organization_id is not null;
