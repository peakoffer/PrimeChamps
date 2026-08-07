create table if not exists public.website_leads (
  id uuid primary key default gen_random_uuid(),
  lead_type text not null check (lead_type in ('athlete', 'brand')),
  full_name text not null,
  email text not null,
  phone text,
  company_name text,
  primary_sport text,
  details jsonb not null default '{}'::jsonb,
  source_url text,
  referrer text,
  request_origin text,
  user_agent text,
  ip_hash text,
  email_hash text not null,
  status text not null default 'new' check (status in ('new', 'reviewing', 'qualified', 'closed', 'spam')),
  notification_status text not null default 'not_configured' check (notification_status in ('not_configured', 'pending', 'sent', 'failed', 'suppressed')),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

comment on table public.website_leads is
  'Private website athlete and brand inquiries. Inserts are accepted only through the website-intake Edge Function.';

create index if not exists website_leads_created_at_idx
  on public.website_leads (created_at desc);

create index if not exists website_leads_email_hash_created_at_idx
  on public.website_leads (email_hash, created_at desc);

create index if not exists website_leads_ip_hash_created_at_idx
  on public.website_leads (ip_hash, created_at desc)
  where ip_hash is not null;

alter table public.website_leads enable row level security;

revoke all on table public.website_leads from anon, authenticated;
