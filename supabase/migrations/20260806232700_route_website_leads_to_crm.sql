alter table public.website_leads
  add column if not exists organization_id uuid
    references public.organizations(id) on delete set null,
  add column if not exists crm_athlete_id uuid
    references public.athletes(id) on delete set null,
  add column if not exists routing_status text not null default 'pending',
  add column if not exists routing_error text,
  add column if not exists routed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.website_leads'::regclass
      and conname = 'website_leads_routing_status_check'
  ) then
    alter table public.website_leads
      add constraint website_leads_routing_status_check
      check (routing_status in ('pending', 'routed', 'failed', 'not_applicable'));
  end if;
end
$$;

create index if not exists website_leads_crm_athlete_id_idx
  on public.website_leads (crm_athlete_id)
  where crm_athlete_id is not null;

create index if not exists website_leads_routing_status_created_at_idx
  on public.website_leads (routing_status, created_at desc);

comment on column public.website_leads.crm_athlete_id is
  'Athlete CRM record created or matched from an inbound website application.';

comment on column public.website_leads.routing_status is
  'Delivery state for routing the inquiry into the Prime Champs CRM.';
