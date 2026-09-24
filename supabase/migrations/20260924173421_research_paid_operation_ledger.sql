set lock_timeout = '5s';
set statement_timeout = '60s';

-- Existing reservations are historical, uncertain bills. Never convert them into
-- zero-spend operation campaigns implicitly; new campaigns must opt in explicitly.
alter table public.research_hardening_campaigns
  add column if not exists accounting_version text not null default 'legacy'
    check (accounting_version in ('legacy', 'operations_v1')),
  add column if not exists budget_configuration jsonb not null default '{}'::jsonb;
alter table public.research_logs
  add column if not exists accounting_version text not null default 'legacy'
    check (accounting_version in ('legacy', 'operations_v1'));

create or replace function public.prevent_research_paid_legacy_reset()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.accounting_version = 'legacy' and new.accounting_version = 'operations_v1'
    and (old.total_cost_microusd > 0 or exists (
      select 1 from public.research_hardening_cases where campaign_id = old.id and research_log_id is not null
    )) then raise exception 'A used legacy campaign cannot reset its uncertain historical billing'; end if;
  return new;
end;
$$;
revoke all on function public.prevent_research_paid_legacy_reset() from public, anon, authenticated;
grant execute on function public.prevent_research_paid_legacy_reset() to service_role;
create trigger research_paid_legacy_reset_guard before update of accounting_version on public.research_hardening_campaigns
  for each row execute function public.prevent_research_paid_legacy_reset();

alter table public.research_hardening_campaigns drop constraint if exists research_hardening_campaigns_status_check;
alter table public.research_hardening_campaigns add constraint research_hardening_campaigns_status_check
  check (status in ('draft', 'queued', 'running', 'paused', 'paused_budget', 'completed', 'failed', 'cancelled'));
drop index if exists public.research_hardening_campaigns_one_active_org_idx;
create unique index research_hardening_campaigns_one_active_org_idx
  on public.research_hardening_campaigns (organization_id)
  where status in ('queued', 'running', 'paused', 'paused_budget');
alter table public.research_hardening_cases drop constraint if exists research_hardening_cases_verdict_check;
alter table public.research_hardening_cases add constraint research_hardening_cases_verdict_check
  check (verdict in ('passed', 'needs_fix', 'source_exhausted', 'source_inconclusive', 'safety_stop', 'technical_failure'));

create table public.research_paid_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  research_log_id uuid not null references public.research_logs(id) on delete restrict,
  campaign_id uuid references public.research_hardening_campaigns(id) on delete restrict,
  case_id uuid references public.research_hardening_cases(id) on delete restrict,
  stage text not null,
  provider text not null,
  model_or_actor text not null,
  operation_key text not null,
  input_hash text not null,
  claim_token uuid not null,
  status text not null check (status in ('reserved', 'executing', 'remote_running', 'ambiguous', 'completed')),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  settled_microusd bigint check (settled_microusd >= 0),
  estimated_microusd bigint check (estimated_microusd >= 0),
  remote_request_id text,
  raw_response jsonb,
  usage jsonb not null default '{}'::jsonb,
  error_message text,
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (research_log_id, operation_key),
  check (status <> 'completed' or raw_response is not null)
);
create index research_paid_operations_campaign_idx on public.research_paid_operations (campaign_id) where campaign_id is not null;
create index research_paid_operations_case_idx on public.research_paid_operations (case_id) where case_id is not null;
create index research_paid_operations_org_idx on public.research_paid_operations (organization_id, created_at);
-- One provider receipt must never be billed twice, even through different local keys.
create unique index research_paid_operations_provider_receipt_idx
  on public.research_paid_operations (provider, remote_request_id) where remote_request_id is not null;
alter table public.research_paid_operations enable row level security;
revoke all on public.research_paid_operations from public, anon, authenticated;
grant all on public.research_paid_operations to service_role;

create or replace function public.research_paid_operation_ledger(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_action text := p_request->>'action';
  v_log public.research_logs%rowtype;
  v_case public.research_hardening_cases%rowtype;
  v_campaign public.research_hardening_campaigns%rowtype;
  v_operation public.research_paid_operations%rowtype;
  v_run_id uuid := (p_request->>'research_log_id')::uuid;
  v_campaign_id uuid;
  v_enabled boolean;
  v_maximum bigint;
  v_run_exposure bigint;
  v_campaign_exposure bigint;
  v_case_limit bigint;
  v_campaign_limit bigint;
  v_claim uuid;
  v_over_budget boolean := false;
begin
  if v_run_id is null then raise exception 'Paid ledger requires a research run'; end if;
  -- All actions lock campaign before run, preventing aggregate budget races and
  -- keeping settlement/reservation lock order consistent across concurrent cases.
  select campaign_id into v_campaign_id from public.research_hardening_cases where research_log_id = v_run_id;
  if found then
    if (select count(*) from public.research_hardening_cases where research_log_id = v_run_id) <> 1 then
      raise exception 'Research run has ambiguous hardening case ownership';
    end if;
    select * into strict v_campaign from public.research_hardening_campaigns where id = v_campaign_id for update;
  end if;
  select * into strict v_log from public.research_logs where id = v_run_id for update;
  if v_campaign_id is not null then
    select * into strict v_case from public.research_hardening_cases where research_log_id = v_run_id for update;
    if v_case.organization_id <> v_log.organization_id or v_campaign.organization_id <> v_log.organization_id then
      raise exception 'Paid ledger organization mismatch';
    end if;
    v_enabled := v_campaign.accounting_version = 'operations_v1';
  else
    v_enabled := v_log.accounting_version = 'operations_v1';
  end if;
  if v_action = 'scope' then
    return jsonb_build_object('enabled', v_enabled, 'organization_id', v_log.organization_id, 'campaign_id', v_campaign_id);
  end if;
  if not v_enabled then raise exception 'Paid ledger was not opted in for this research run'; end if;
  if v_log.organization_id is null then raise exception 'Research run must have organization ownership'; end if;

  -- Receipt persistence is allowed after cancellation, because accepted work can
  -- still incur cost. New/resumed work must check current terminal state atomically.
  if v_action in ('reserve', 'start', 'guard') then
    if v_log.is_evaluation is distinct from true then
      raise exception 'Research paid-operation accounting permits evaluation-only runs';
    end if;
    if v_log.cancel_requested_at is not null or v_log.status in ('cancelled', 'error') then
      raise exception 'Research paid work cancelled or terminal';
    end if;
    if v_log.status not in ('queued', 'running') and not (
      v_log.status = 'completed' and p_request->>'stage' = 'shadow'
      and v_campaign_id is not null and v_case.status = 'running'
    ) then raise exception 'Research paid work is not active'; end if;
    if v_log.status = 'running' and (v_log.heartbeat_at is null or v_log.heartbeat_at < clock_timestamp() - interval '20 minutes') then
      raise exception 'Research paid work has a stale heartbeat';
    end if;
    if v_campaign_id is not null and (
      v_campaign.cancel_requested_at is not null or v_campaign.status not in ('queued', 'running') or v_case.status <> 'running'
    ) then raise exception 'Hardening campaign/case is not active'; end if;
    if coalesce(v_log.cost_limit_microusd, 0) <= 0 then
      raise exception 'Research paid work requires a positive case allowance';
    end if;
    if exists (select 1 from public.research_paid_operations
      where research_log_id = v_run_id and (settled_microusd > reserved_microusd or (
        status = 'completed' and usage->>'billingBasis' = 'priced_usage_upper_bound' and estimated_microusd > reserved_microusd
      ))) then
      raise exception 'A paid operation exceeded its exposure bound; reconcile before further paid work';
    end if;
  end if;
  if v_action = 'guard' then return jsonb_build_object('allowed', true); end if;

  if v_action = 'reserve' then
    v_maximum := (p_request->>'maximum_cost_microusd')::bigint;
    v_claim := (p_request->>'claim_token')::uuid;
    if v_maximum is null or v_maximum <= 0 or v_claim is null
      or coalesce(p_request->>'provider', '') = '' or coalesce(p_request->>'model_or_actor', '') = ''
      or coalesce(p_request->>'stage', '') = '' or coalesce(p_request->>'operation_key', '') = ''
      or coalesce(p_request->>'input_hash', '') = '' then
      raise exception 'Paid operation requires a bound, claim, provider, version, stage and input key';
    end if;
    select * into v_operation from public.research_paid_operations
      where research_log_id = v_run_id and operation_key = p_request->>'operation_key' for update;
    if found then
      if v_operation.provider <> p_request->>'provider' or v_operation.model_or_actor <> p_request->>'model_or_actor'
        or v_operation.input_hash <> p_request->>'input_hash' or v_operation.stage <> p_request->>'stage' then
        raise exception 'Paid operation key was reused for different work';
      end if;
      if v_operation.status = 'completed' then
        return jsonb_build_object('mode', 'cached', 'operation_id', v_operation.id, 'raw_response', v_operation.raw_response);
      end if;
      if v_operation.remote_request_id is not null and coalesce((p_request->>'can_resume')::boolean, false)
        and (v_operation.status = 'ambiguous' or v_operation.lease_until < clock_timestamp()) then
        update public.research_paid_operations set claim_token = v_claim, status = 'reserved',
          lease_until = clock_timestamp() + interval '10 minutes', updated_at = clock_timestamp()
          where id = v_operation.id;
        return jsonb_build_object('mode', 'resume', 'operation_id', v_operation.id, 'remote_request_id', v_operation.remote_request_id);
      end if;
      raise exception 'Paid operation is in flight or ambiguous; reconcile existing request before retrying';
    end if;
    select coalesce(sum(coalesce(settled_microusd, case
      when status = 'completed' and usage->>'billingBasis' = 'priced_usage_upper_bound'
      then coalesce(estimated_microusd, reserved_microusd) else reserved_microusd end)), 0)
      into v_run_exposure from public.research_paid_operations
      where research_log_id = v_run_id or (v_case.id is not null and case_id = v_case.id);
    v_case_limit := v_log.cost_limit_microusd;
    if v_run_exposure + v_maximum > v_case_limit then raise exception 'Research case paid-operation budget exhausted'; end if;
    if v_campaign_id is not null then
      select coalesce(sum(coalesce(settled_microusd, case
        when status = 'completed' and usage->>'billingBasis' = 'priced_usage_upper_bound'
        then coalesce(estimated_microusd, reserved_microusd) else reserved_microusd end)), 0)
        into v_campaign_exposure from public.research_paid_operations where campaign_id = v_campaign_id;
      v_campaign_limit := v_campaign.budget_limit_microusd;
      if v_campaign.budget_configuration ? 'ordinary_limit_microusd' then
        if not coalesce((v_campaign.budget_configuration->'reserve_case_ids') ? v_case.id::text, false) then
          v_campaign_limit := least(v_campaign_limit, (v_campaign.budget_configuration->>'ordinary_limit_microusd')::bigint);
        end if;
      elsif v_case.stage <> 'confirmation' then
        v_campaign_limit := least(v_campaign_limit, v_campaign.preconfirmation_stop_microusd);
      end if;
      if v_campaign_limit is null or v_campaign_limit <= 0 or v_campaign_exposure + v_maximum > v_campaign_limit then
        raise exception 'Research campaign paid-operation budget exhausted';
      end if;
    end if;
    insert into public.research_paid_operations (
      organization_id, research_log_id, campaign_id, case_id, stage, provider, model_or_actor,
      operation_key, input_hash, claim_token, status, reserved_microusd, lease_until
    ) values (
      v_log.organization_id, v_run_id, v_campaign_id, v_case.id, p_request->>'stage', p_request->>'provider', p_request->>'model_or_actor',
      p_request->>'operation_key', p_request->>'input_hash', v_claim, 'reserved', v_maximum, clock_timestamp() + interval '10 minutes'
    ) returning * into v_operation;
    return jsonb_build_object('mode', 'execute', 'operation_id', v_operation.id, 'remote_request_id', null);
  end if;

  select * into strict v_operation from public.research_paid_operations
    where id = (p_request->>'operation_id')::uuid and research_log_id = v_run_id for update;
  if p_request->>'claim_token' is null or v_operation.claim_token <> (p_request->>'claim_token')::uuid then
    raise exception 'Paid operation claim no longer owned';
  end if;
  if v_operation.stage <> p_request->>'stage' then raise exception 'Paid operation stage mismatch'; end if;
  if v_operation.organization_id <> v_log.organization_id then raise exception 'Paid operation organization mismatch'; end if;
  if v_action = 'start' then
    if v_operation.status <> 'reserved' then raise exception 'Paid operation has already started'; end if;
    update public.research_paid_operations set status = 'executing', updated_at = clock_timestamp() where id = v_operation.id;
  elsif v_action = 'checkpoint' then
    if v_operation.status not in ('executing', 'remote_running', 'ambiguous') then
      raise exception 'Paid operation cannot checkpoint a raw response in this state';
    end if;
    if not (p_request ? 'raw_response') then raise exception 'A raw provider response is required for checkpoint'; end if;
    update public.research_paid_operations set raw_response = p_request->'raw_response',
      usage = coalesce(p_request->'usage', '{}'::jsonb), updated_at = clock_timestamp()
      where id = v_operation.id;
  elsif v_action = 'remote' then
    if v_operation.status not in ('executing', 'remote_running') then raise exception 'Paid operation cannot attach a remote request'; end if;
    if coalesce(p_request->>'remote_request_id', '') = '' then raise exception 'Remote request ID must not be empty'; end if;
    if v_operation.remote_request_id is not null and v_operation.remote_request_id <> p_request->>'remote_request_id' then
      raise exception 'Paid operation cannot replace its remote request';
    end if;
    update public.research_paid_operations set remote_request_id = p_request->>'remote_request_id',
      status = 'remote_running', updated_at = clock_timestamp() where id = v_operation.id;
  elsif v_action = 'complete' then
    if v_operation.status = 'completed' then
      if v_operation.raw_response <> p_request->'raw_response'
        or v_operation.settled_microusd is distinct from (p_request->>'settled_cost_microusd')::bigint then
        raise exception 'Paid receipt is immutable after completion';
      end if;
      return jsonb_build_object('completed', true, 'over_budget', coalesce(v_operation.settled_microusd,
        case when v_operation.usage->>'billingBasis' = 'priced_usage_upper_bound' then v_operation.estimated_microusd else 0 end, 0
      ) > v_operation.reserved_microusd);
    end if;
    if v_operation.status not in ('executing', 'remote_running', 'ambiguous') then
      raise exception 'Paid operation has not started';
    end if;
    if not (p_request ? 'raw_response') then raise exception 'A raw provider response is required before completion'; end if;
    if v_operation.remote_request_id is not null and p_request->>'remote_request_id' is not null
      and v_operation.remote_request_id <> p_request->>'remote_request_id' then raise exception 'Remote receipt mismatch'; end if;
    update public.research_paid_operations set status = 'completed', raw_response = p_request->'raw_response',
      usage = coalesce(p_request->'usage', '{}'::jsonb), settled_microusd = (p_request->>'settled_cost_microusd')::bigint,
      estimated_microusd = (p_request->>'estimated_cost_microusd')::bigint,
      remote_request_id = coalesce(remote_request_id, p_request->>'remote_request_id'),
      completed_at = clock_timestamp(), updated_at = clock_timestamp(), lease_until = null
      where id = v_operation.id returning * into v_operation;
    v_over_budget := coalesce(v_operation.settled_microusd,
      case when v_operation.usage->>'billingBasis' = 'priced_usage_upper_bound' then v_operation.estimated_microusd else 0 end, 0
    ) > v_operation.reserved_microusd;
    if v_over_budget and v_campaign_id is not null then
      update public.research_hardening_campaigns set status = 'paused_budget',
        error_message = 'A provider charge exceeded its reservation; reconcile pricing before more paid work'
        where id = v_campaign_id;
    end if;
  elsif v_action = 'ambiguous' then
    -- Do not overwrite a persisted response when only the client receipt was lost.
    update public.research_paid_operations set status = 'ambiguous', lease_until = null,
      error_message = left(p_request->>'error_message', 500), updated_at = clock_timestamp()
      where id = v_operation.id and status <> 'completed';
  else raise exception 'Unknown research paid-ledger action';
  end if;
  return jsonb_build_object('operation_id', v_operation.id, 'completed', v_action = 'complete', 'over_budget', v_over_budget);
end;
$$;
revoke all on function public.research_paid_operation_ledger(jsonb) from public, anon, authenticated;
grant execute on function public.research_paid_operation_ledger(jsonb) to service_role;
comment on table public.research_paid_operations is
  'Server-only paid request reservations, durable provider responses and billing evidence. Unknown charges retain reservation; old campaign bills are never reset.';
