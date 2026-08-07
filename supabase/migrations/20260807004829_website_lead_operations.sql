alter table public.athletes
  add column if not exists phone text;

create table if not exists public.brand_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  website_lead_id uuid unique references public.website_leads(id) on delete set null,
  company_name text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  contact_role text,
  company_website text,
  industry text,
  target_sports text,
  campaign_goals text,
  target_audience text,
  partnership_budget text,
  partnership_timeline text,
  source_url text,
  stage text not null default 'new',
  owner_user_id uuid references auth.users(id) on delete set null,
  next_action text,
  next_action_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.brand_opportunities'::regclass
      and conname = 'brand_opportunities_stage_check'
  ) then
    alter table public.brand_opportunities
      add constraint brand_opportunities_stage_check
      check (stage in ('new', 'reviewing', 'qualified', 'proposal', 'won', 'closed'));
  end if;
end
$$;

drop trigger if exists brand_opportunities_updated_at on public.brand_opportunities;
create trigger brand_opportunities_updated_at
  before update on public.brand_opportunities
  for each row execute function public.update_updated_at();

create index if not exists brand_opportunities_org_stage_created_idx
  on public.brand_opportunities (organization_id, stage, created_at desc);

create index if not exists brand_opportunities_owner_next_action_idx
  on public.brand_opportunities (owner_user_id, next_action_at)
  where owner_user_id is not null;

alter table public.brand_opportunities enable row level security;
revoke all on table public.brand_opportunities from anon, authenticated;

alter table public.website_leads
  add column if not exists brand_opportunity_id uuid
    references public.brand_opportunities(id) on delete set null,
  add column if not exists routing_attempts integer not null default 0,
  add column if not exists last_routing_attempt_at timestamptz,
  add column if not exists next_routing_attempt_at timestamptz,
  add column if not exists confirmation_status text not null default 'not_configured',
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_error text,
  add column if not exists notification_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.website_leads'::regclass
      and conname = 'website_leads_routing_attempts_check'
  ) then
    alter table public.website_leads
      add constraint website_leads_routing_attempts_check
      check (routing_attempts >= 0 and routing_attempts <= 20);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.website_leads'::regclass
      and conname = 'website_leads_confirmation_status_check'
  ) then
    alter table public.website_leads
      add constraint website_leads_confirmation_status_check
      check (confirmation_status in ('not_configured', 'pending', 'sent', 'failed', 'suppressed'));
  end if;
end
$$;

create index if not exists website_leads_brand_opportunity_id_idx
  on public.website_leads (brand_opportunity_id)
  where brand_opportunity_id is not null;

create index if not exists website_leads_retry_queue_idx
  on public.website_leads (next_routing_attempt_at, created_at)
  where routing_status in ('pending', 'failed') and is_test = false;

comment on table public.brand_opportunities is
  'Organization-scoped brand briefs routed from the Prime Champs website and managed through qualification.';

comment on column public.website_leads.next_routing_attempt_at is
  'Next time the CRM reconciliation job should retry this intake record.';
