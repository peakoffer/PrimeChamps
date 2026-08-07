set lock_timeout = '5s';
set statement_timeout = '60s';

-- Research Agent v2 keeps raw meeting evidence separate from the reviewed
-- recruiting thesis used by candidate discovery and scoring.
create table public.research_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid references public.profiles(user_id) on delete set null,
  title text not null,
  occurred_at timestamptz not null default now(),
  participants text[] not null default '{}'::text[],
  source_type text not null check (source_type in ('audio', 'transcript')),
  audio_storage_path text,
  audio_mime_type text,
  audio_size_bytes bigint check (audio_size_bytes is null or audio_size_bytes >= 0),
  transcript text,
  transcript_segments jsonb not null default '[]'::jsonb,
  intelligence_summary text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'extracting', 'review_ready', 'published', 'error')),
  processing_error text,
  transcription_model text,
  extraction_model text,
  workflow_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source_type = 'audio' and audio_storage_path is not null)
    or (source_type = 'transcript' and nullif(btrim(transcript), '') is not null)
  )
);

create index research_meetings_org_occurred_idx
  on public.research_meetings(organization_id, occurred_at desc);
create index research_meetings_created_by_idx
  on public.research_meetings(created_by_user_id)
  where created_by_user_id is not null;
create unique index research_meetings_workflow_run_id_key
  on public.research_meetings(workflow_run_id)
  where workflow_run_id is not null;

create table public.research_intelligence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.research_meetings(id) on delete cascade,
  category text not null check (category in (
    'target_profile',
    'positive_signal',
    'negative_signal',
    'sport_priority',
    'follower_band',
    'geography',
    'process',
    'other'
  )),
  statement text not null,
  normalized_value jsonb not null default '{}'::jsonb,
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  evidence_refs jsonb not null default '[]'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  reviewed_by_user_id uuid references public.profiles(user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_at)
);

create index research_intelligence_items_org_status_idx
  on public.research_intelligence_items(organization_id, status, category, created_at desc);
create index research_intelligence_items_meeting_idx
  on public.research_intelligence_items(meeting_id, created_at);
create index research_intelligence_items_reviewer_idx
  on public.research_intelligence_items(reviewed_by_user_id)
  where reviewed_by_user_id is not null;
create unique index research_intelligence_items_meeting_statement_key
  on public.research_intelligence_items(meeting_id, statement);

create table public.research_profile_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  compiled_profile jsonb not null,
  source_meeting_ids uuid[] not null default '{}'::uuid[],
  source_item_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by_user_id uuid references public.profiles(user_id) on delete set null,
  activated_by_user_id uuid references public.profiles(user_id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, version)
);

create unique index research_profile_versions_one_active_per_org
  on public.research_profile_versions(organization_id)
  where status = 'active';
create index research_profile_versions_org_created_idx
  on public.research_profile_versions(organization_id, created_at desc);
create index research_profile_versions_created_by_idx
  on public.research_profile_versions(created_by_user_id)
  where created_by_user_id is not null;
create index research_profile_versions_activated_by_idx
  on public.research_profile_versions(activated_by_user_id)
  where activated_by_user_id is not null;

create table public.candidate_signal_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  research_log_id uuid references public.research_logs(id) on delete set null,
  research_candidate_id uuid references public.research_candidates(id) on delete set null,
  athlete_id uuid references public.athletes(id) on delete set null,
  instagram_handle text not null,
  snapshot_date date not null default current_date,
  captured_at timestamptz not null default now(),
  follower_count integer check (follower_count is null or follower_count >= 0),
  following_count integer check (following_count is null or following_count >= 0),
  posts_count integer check (posts_count is null or posts_count >= 0),
  engagement_rate numeric,
  average_likes numeric,
  average_comments numeric,
  provider text not null default 'apify',
  raw_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, instagram_handle, snapshot_date)
);

create index candidate_signal_snapshots_handle_history_idx
  on public.candidate_signal_snapshots(organization_id, instagram_handle, captured_at desc);
create index candidate_signal_snapshots_athlete_history_idx
  on public.candidate_signal_snapshots(athlete_id, captured_at desc)
  where athlete_id is not null;
create index candidate_signal_snapshots_research_log_idx
  on public.candidate_signal_snapshots(research_log_id)
  where research_log_id is not null;
create index candidate_signal_snapshots_candidate_idx
  on public.candidate_signal_snapshots(research_candidate_id)
  where research_candidate_id is not null;

-- The current workflow already expects this cache. Creating it here removes a
-- silent fallback that caused each run to rediscover the same sport context.
create table if not exists public.sport_context_cache (
  sport text primary key,
  context jsonb not null,
  cached_at timestamptz not null default now()
);

alter table public.research_logs
  add column if not exists profile_version_id uuid references public.research_profile_versions(id) on delete set null,
  add column if not exists research_depth text not null default 'standard'
    check (research_depth in ('standard', 'extended'));

alter table public.research_candidates
  add column if not exists signal_snapshot_id uuid references public.candidate_signal_snapshots(id) on delete set null,
  add column if not exists momentum_metrics jsonb not null default '{}'::jsonb,
  add column if not exists gate_results jsonb not null default '{}'::jsonb;

create index research_logs_profile_version_idx
  on public.research_logs(profile_version_id)
  where profile_version_id is not null;
create index research_candidates_signal_snapshot_idx
  on public.research_candidates(signal_snapshot_id)
  where signal_snapshot_id is not null;

drop trigger if exists research_meetings_updated_at on public.research_meetings;
create trigger research_meetings_updated_at
  before update on public.research_meetings
  for each row execute function public.update_updated_at();
drop trigger if exists research_intelligence_items_updated_at on public.research_intelligence_items;
create trigger research_intelligence_items_updated_at
  before update on public.research_intelligence_items
  for each row execute function public.update_updated_at();

-- Create a safe baseline thesis for every existing workspace. Meetings can
-- propose changes, but only reviewed items are compiled into later versions.
insert into public.research_profile_versions (
  organization_id,
  version,
  name,
  compiled_profile,
  status,
  activated_at
)
select
  organization.id,
  1,
  'OnlyFans emerging athlete thesis',
  jsonb_build_object(
    'objective', 'onlyfans_creator_recruitment',
    'summary', 'Find source-verified adult athletes with current momentum, a strong personal audience, creator potential, and realistic partnership accessibility.',
    'target_profile', jsonb_build_array(
      'Source-verified adult athlete, ideally age 21 to 30',
      'Emerging, breakout, newly professional, or visibly accelerating',
      'Public personal Instagram with a meaningful, engaged audience',
      'Strong personal brand and realistic accessibility'
    ),
    'positive_signal', jsonb_build_array(
      'Recent roster promotion, ranking jump, award watchlist, viral competition moment, or breakout result',
      'Consistent personal lifestyle, fitness, or behind-the-scenes content',
      'Audience growth or engagement that is improving over time'
    ),
    'negative_signal', jsonb_build_array(
      'Minor or age cannot be verified',
      'Retired, late-career veteran, or established celebrity without current growth',
      'Private, inactive, team-only, or ambiguous social profile',
      'Already contacted, rejected, signed, or known to be on OnlyFans'
    ),
    'sport_priority', '[]'::jsonb,
    'follower_band', '[]'::jsonb,
    'geography', '[]'::jsonb,
    'process', '[]'::jsonb,
    'other', '[]'::jsonb,
    'parameters', jsonb_build_object(
      'target_age_min', 21,
      'target_age_max', 30,
      'maximum_priority_age', 35,
      'follower_min', 30000,
      'follower_max', 500000,
      'approval_score', 75,
      'priority_score', 80
    ),
    'generated_at', now()
  ),
  'active',
  now()
from public.organizations organization
where not exists (
  select 1
  from public.research_profile_versions existing
  where existing.organization_id = organization.id
);

-- Profile activation is atomic and serialized per workspace. The application
-- passes reviewed content and this function only manages the version boundary.
create or replace function public.activate_research_profile(
  profile_organization_id uuid,
  profile_name text,
  profile_payload jsonb,
  meeting_ids uuid[],
  item_ids uuid[],
  actor_user_id uuid
)
returns public.research_profile_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
  activated_profile public.research_profile_versions;
begin
  if profile_organization_id is null then
    raise exception 'organization is required';
  end if;
  if nullif(btrim(profile_name), '') is null then
    raise exception 'profile name is required';
  end if;
  if profile_payload is null or jsonb_typeof(profile_payload) <> 'object' then
    raise exception 'profile payload must be a JSON object';
  end if;
  if exists (
    select 1
    from unnest(coalesce(meeting_ids, '{}'::uuid[])) requested_meeting_id
    left join public.research_meetings meeting
      on meeting.id = requested_meeting_id
      and meeting.organization_id = profile_organization_id
    where meeting.id is null
  ) then
    raise exception 'every source meeting must belong to the organization';
  end if;
  if exists (
    select 1
    from unnest(coalesce(item_ids, '{}'::uuid[])) requested_item_id
    left join public.research_intelligence_items item
      on item.id = requested_item_id
      and item.organization_id = profile_organization_id
      and item.status = 'approved'
    where item.id is null
  ) then
    raise exception 'every source item must be approved and belong to the organization';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(profile_organization_id::text, 0));

  select coalesce(max(version), 0) + 1
  into next_version
  from public.research_profile_versions
  where organization_id = profile_organization_id;

  update public.research_profile_versions
  set status = 'archived'
  where organization_id = profile_organization_id
    and status = 'active';

  insert into public.research_profile_versions (
    organization_id,
    version,
    name,
    compiled_profile,
    source_meeting_ids,
    source_item_ids,
    status,
    created_by_user_id,
    activated_by_user_id,
    activated_at
  ) values (
    profile_organization_id,
    next_version,
    profile_name,
    profile_payload,
    coalesce(meeting_ids, '{}'::uuid[]),
    coalesce(item_ids, '{}'::uuid[]),
    'active',
    actor_user_id,
    actor_user_id,
    now()
  )
  returning * into activated_profile;

  return activated_profile;
end;
$$;

alter table public.research_meetings enable row level security;
alter table public.research_intelligence_items enable row level security;
alter table public.research_profile_versions enable row level security;
alter table public.candidate_signal_snapshots enable row level security;
alter table public.sport_context_cache enable row level security;

-- These tables are deliberately server-owned. Every application route first
-- authenticates the user and scopes service-role queries to their workspace.
revoke all on table
  public.research_meetings,
  public.research_intelligence_items,
  public.research_profile_versions,
  public.candidate_signal_snapshots,
  public.sport_context_cache
from anon, authenticated;

grant all on table
  public.research_meetings,
  public.research_intelligence_items,
  public.research_profile_versions,
  public.candidate_signal_snapshots,
  public.sport_context_cache
to service_role;

revoke all on function public.activate_research_profile(uuid, text, jsonb, uuid[], uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.activate_research_profile(uuid, text, jsonb, uuid[], uuid[], uuid)
  to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'research-meeting-audio',
  'research-meeting-audio',
  false,
  25000000,
  array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/webm', 'video/mp4']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.research_meetings is
  'Immutable weekly recruiting-intelligence evidence and processing status.';
comment on table public.research_intelligence_items is
  'AI-proposed, human-reviewed recruiting intelligence extracted from meetings.';
comment on table public.research_profile_versions is
  'Versioned recruiting thesis pinned to every research run.';
comment on table public.candidate_signal_snapshots is
  'Daily social snapshots used to calculate growth and momentum without Modash.';
