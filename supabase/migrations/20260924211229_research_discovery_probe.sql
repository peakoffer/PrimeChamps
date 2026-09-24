set lock_timeout = '5s';
set statement_timeout = '60s';

-- One finite diagnostic, allocated from an existing legacy authorization. This
-- is NOT a new campaign allowance and never rewrites historical cost fields.
create table public.research_discovery_probes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  parent_campaign_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  research_log_id uuid not null unique references public.research_logs(id) on delete restrict,
  manifest_version text not null check (manifest_version = 'weak-archetype-raw-search-v1'),
  allocation_microusd bigint not null check (allocation_microusd = 30000),
  authorization_snapshot jsonb not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  claim_token uuid not null,
  deadline_at timestamptz not null,
  error_message text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (parent_campaign_id, manifest_version),
  foreign key (parent_campaign_id, organization_id)
    references public.research_hardening_campaigns(id, organization_id) on delete restrict
);
create index research_discovery_probes_org_idx on public.research_discovery_probes(organization_id, created_at);
create index research_discovery_probes_requested_by_idx on public.research_discovery_probes(requested_by_user_id);
alter table public.research_discovery_probes enable row level security;
revoke all on public.research_discovery_probes from public, anon, authenticated;
grant select, insert, update on public.research_discovery_probes to service_role;

create function public.protect_research_discovery_allocation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Discovery allocations are sticky and cannot be deleted'; end if;
  if (new.organization_id, new.parent_campaign_id, new.requested_by_user_id, new.research_log_id,
      new.manifest_version, new.allocation_microusd, new.authorization_snapshot, new.claim_token, new.deadline_at)
    is distinct from
     (old.organization_id, old.parent_campaign_id, old.requested_by_user_id, old.research_log_id,
      old.manifest_version, old.allocation_microusd, old.authorization_snapshot, old.claim_token, old.deadline_at)
    or (old.status <> 'running' and new.status <> old.status) then
    raise exception 'Discovery allocation and claim are immutable';
  end if;
  return new;
end;
$$;
create trigger protect_research_discovery_allocation before update or delete on public.research_discovery_probes
  for each row execute function public.protect_research_discovery_allocation();

create function public.protect_discovery_parent_authorization()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.research_discovery_probes where parent_campaign_id = old.id) and (
    new.status not in ('completed', 'failed', 'cancelled')
    or new.accounting_version <> 'legacy'
    or new.total_cost_microusd < old.total_cost_microusd
    or new.budget_limit_microusd is distinct from old.budget_limit_microusd
    or new.preconfirmation_stop_microusd is distinct from old.preconfirmation_stop_microusd
    or new.confirmation_reserve_microusd is distinct from old.confirmation_reserve_microusd
  ) then raise exception 'A discovery-funded legacy parent cannot reopen or reset its authorization'; end if;
  return new;
end;
$$;
create trigger protect_discovery_parent_authorization before update on public.research_hardening_campaigns
  for each row execute function public.protect_discovery_parent_authorization();

create function public.protect_discovery_run_scope()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.research_discovery_probes where research_log_id = old.id) and (
    new.organization_id is distinct from old.organization_id
    or new.accounting_version <> 'operations_v1' or new.is_evaluation is distinct from true
    or new.cost_limit_microusd is distinct from 30000
    or (old.status in ('completed', 'error', 'cancelled') and new.status <> old.status)
  ) then raise exception 'Discovery run is evaluation-only, fixed-budget and cannot reopen'; end if;
  return new;
end;
$$;
create trigger protect_discovery_run_scope before update on public.research_logs
  for each row execute function public.protect_discovery_run_scope();

-- Narrow the general paid ledger for these logs. Each sport has exactly one
-- permitted request; even an accidentally reused service cannot buy enrichment.
create function public.guard_discovery_paid_operation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_probe public.research_discovery_probes%rowtype;
begin
  if tg_op = 'UPDATE' and new.status <> 'executing' then return new; end if;
  select * into v_probe from public.research_discovery_probes where research_log_id = new.research_log_id;
  if found then
    if v_probe.status <> 'running' or v_probe.deadline_at <= clock_timestamp()
      or v_probe.organization_id <> new.organization_id
      or new.provider <> 'perplexity' or new.model_or_actor <> 'search' or new.reserved_microusd <> 5000
      or new.campaign_id is not null or new.case_id is not null
      or new.stage not in ('discovery_probe:climbing', 'discovery_probe:adaptive', 'discovery_probe:esports',
        'discovery_probe:equestrian', 'discovery_probe:crossfit', 'discovery_probe:skiing') then
      raise exception 'Discovery probe permits only its six fixed raw searches';
    end if;
    if tg_op = 'INSERT' and exists (select 1 from public.research_paid_operations where research_log_id = new.research_log_id and stage = new.stage) then
      raise exception 'A discovery sport request cannot be purchased twice';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_discovery_paid_operation before insert or update of status on public.research_paid_operations
  for each row execute function public.guard_discovery_paid_operation();

create function public.research_discovery_probe(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid := (p_request->>'organization_id')::uuid;
  v_actor uuid := (p_request->>'actor_user_id')::uuid;
  v_action text := p_request->>'action';
  v_parent public.research_hardening_campaigns%rowtype;
  v_probe public.research_discovery_probes%rowtype;
  v_log_id uuid;
  v_allocated bigint;
  v_updated integer;
begin
  if not exists (select 1 from public.organization_memberships
    where organization_id = v_org and user_id = v_actor and role = 'owner' and status = 'active') then
    raise exception 'Discovery diagnostic requires an active organization owner';
  end if;
  if v_action = 'allocate' then
    if p_request->>'manifest_version' is distinct from 'weak-archetype-raw-search-v1' then
      raise exception 'Unknown discovery diagnostic manifest';
    end if;
    select * into strict v_parent from public.research_hardening_campaigns
      where id = (p_request->>'parent_campaign_id')::uuid and organization_id = v_org for update;
    if v_parent.accounting_version <> 'legacy' or v_parent.status not in ('completed', 'failed', 'cancelled') then
      raise exception 'Discovery allocation requires a terminal legacy parent';
    end if;
    select * into v_probe from public.research_discovery_probes
      where parent_campaign_id = v_parent.id and manifest_version = p_request->>'manifest_version';
    if found then return jsonb_build_object('created', false, 'probe_id', v_probe.id); end if;
    select coalesce(sum(allocation_microusd), 0) into v_allocated
      from public.research_discovery_probes where parent_campaign_id = v_parent.id;
    if v_parent.budget_limit_microusd is null or v_parent.preconfirmation_stop_microusd is null or v_parent.total_cost_microusd is null
      or least(v_parent.budget_limit_microusd, v_parent.preconfirmation_stop_microusd)
      - v_parent.total_cost_microusd - v_allocated < 30000 then
      raise exception 'Unconsumed original ordinary allowance cannot fund this fixed diagnostic';
    end if;
    insert into public.research_logs (organization_id, requested_by_user_id, status, phase, heartbeat_at,
      prompt_version, is_evaluation, accounting_version, cost_limit_microusd, config_used, context_summary,
      raw_results, scoring_details, final_results, stats)
    values (v_org, v_actor, 'running', 'discovery_diagnostic', clock_timestamp(), 'raw-discovery-probe-v1',
      true, 'operations_v1', 30000,
      jsonb_build_object('evaluationMode', true, 'diagnosticOnly', true, 'manifestVersion', p_request->>'manifest_version', 'parentCampaignId', v_parent.id),
      jsonb_build_object('classification', 'discovery_transport_only', 'no_candidate_or_pipeline_mutations', true),
      '[]', '[]', '[]', jsonb_build_object('discovered', 0, 'enriched', 0, 'scored', 0, 'returned', 0, 'added', 0))
    returning id into v_log_id;
    insert into public.research_discovery_probes (organization_id, parent_campaign_id, requested_by_user_id,
      research_log_id, manifest_version, allocation_microusd, authorization_snapshot, status, claim_token, deadline_at)
    values (v_org, v_parent.id, v_actor, v_log_id, p_request->>'manifest_version', 30000,
      jsonb_build_object('parentReservedMicrousd', v_parent.total_cost_microusd, 'parentOrdinaryLimitMicrousd', v_parent.preconfirmation_stop_microusd,
        'parentHardLimitMicrousd', v_parent.budget_limit_microusd, 'parentConfirmationReserveMicrousd', v_parent.confirmation_reserve_microusd,
        'allocationMicrousd', 30000, 'basis', 'unconsumed_original_ordinary_authorization_not_new_budget'),
      'running', gen_random_uuid(), clock_timestamp() + interval '90 seconds') returning * into v_probe;
    return jsonb_build_object('created', true, 'probe_id', v_probe.id, 'research_log_id', v_log_id, 'claim_token', v_probe.claim_token);
  end if;
  select * into strict v_probe from public.research_discovery_probes
    where id = (p_request->>'probe_id')::uuid and organization_id = v_org for update;
  if v_probe.claim_token is distinct from (p_request->>'claim_token')::uuid or v_probe.status <> 'running' then
    raise exception 'Discovery diagnostic claim is not active';
  end if;
  if v_action = 'heartbeat' then
    if v_probe.deadline_at <= clock_timestamp() then raise exception 'Discovery diagnostic deadline expired; no retry'; end if;
    update public.research_logs set heartbeat_at = clock_timestamp()
      where id = v_probe.research_log_id and organization_id = v_org and status = 'running' and cancel_requested_at is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then raise exception 'Discovery diagnostic run is no longer active'; end if;
  elsif v_action = 'finish' then
    if p_request->>'status' is null or p_request->>'status' not in ('completed', 'failed') then raise exception 'Invalid diagnostic completion status'; end if;
    if p_request->>'status' = 'completed' and (select count(*) from public.research_paid_operations
      where research_log_id = v_probe.research_log_id and status = 'completed'
      and (raw_response->>'status')::integer between 200 and 299) <> 6 then
      raise exception 'Transport completion requires all six persisted successful responses';
    end if;
    update public.research_discovery_probes set status = p_request->>'status', completed_at = clock_timestamp(),
      error_message = case when p_request->>'status' = 'failed' then 'Raw-search diagnostic was interrupted or failed. Allocation retained; no automatic retry.' else null end
      where id = v_probe.id;
    update public.research_logs set status = case when p_request->>'status' = 'completed' then 'completed' else 'error' end,
      phase = case when p_request->>'status' = 'completed' then 'discovery_diagnostic_complete' else 'discovery_diagnostic_failed' end,
      heartbeat_at = clock_timestamp(), completed_at = clock_timestamp()
      where id = v_probe.research_log_id and organization_id = v_org and status = 'running';
  else raise exception 'Unknown discovery diagnostic action'; end if;
  return jsonb_build_object('ok', true, 'probe_id', v_probe.id);
end;
$$;

revoke all on function public.protect_research_discovery_allocation() from public, anon, authenticated;
revoke all on function public.protect_discovery_parent_authorization() from public, anon, authenticated;
revoke all on function public.protect_discovery_run_scope() from public, anon, authenticated;
revoke all on function public.guard_discovery_paid_operation() from public, anon, authenticated;
revoke all on function public.research_discovery_probe(jsonb) from public, anon, authenticated;
grant execute on function public.protect_research_discovery_allocation(), public.protect_discovery_parent_authorization(),
  public.protect_discovery_run_scope(), public.guard_discovery_paid_operation(), public.research_discovery_probe(jsonb) to service_role;
comment on table public.research_discovery_probes is
  'Single-use six-query raw-source diagnostics. Sticky $0.03 allocation comes from the linked original ordinary allowance, not a new campaign. Not candidate-quality certification.';
