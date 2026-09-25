set lock_timeout = '5s';
set statement_timeout = '60s';

-- The owner authorized one dated post-rotation recheck, not a reusable retry
-- mechanism. Both $0.03 allocations stay charged against the ORIGINAL ordinary
-- authorization; no prior diagnostic, run, receipt or campaign is rewritten.
alter table public.research_discovery_probes
  drop constraint research_discovery_probes_manifest_version_check;
alter table public.research_discovery_probes
  add constraint research_discovery_probes_manifest_version_check check (manifest_version in (
    'weak-archetype-raw-search-v1', 'weak-archetype-raw-search-recheck-20260925'
  ));

create or replace function public.research_discovery_probe(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid := (p_request->>'organization_id')::uuid;
  v_actor uuid := (p_request->>'actor_user_id')::uuid;
  v_action text := p_request->>'action';
  v_manifest text := p_request->>'manifest_version';
  v_parent public.research_hardening_campaigns%rowtype;
  v_probe public.research_discovery_probes%rowtype;
  v_original public.research_discovery_probes%rowtype;
  v_operation public.research_paid_operations%rowtype;
  v_receipt_error_type text;
  v_receipt_count integer := 0;
  v_log_id uuid;
  v_allocated bigint;
  v_updated integer;
begin
  if not exists (select 1 from public.organization_memberships
    where organization_id = v_org and user_id = v_actor and role = 'owner' and status = 'active') then
    raise exception 'Discovery diagnostic requires an active organization owner';
  end if;
  if v_action = 'allocate' then
    if v_manifest is null or v_manifest not in (
      'weak-archetype-raw-search-v1', 'weak-archetype-raw-search-recheck-20260925'
    ) then raise exception 'Unknown discovery diagnostic manifest'; end if;
    select * into strict v_parent from public.research_hardening_campaigns
      where id = (p_request->>'parent_campaign_id')::uuid and organization_id = v_org for update;
    if v_parent.accounting_version is distinct from 'legacy'
      or v_parent.status is null or v_parent.status not in ('completed', 'failed', 'cancelled') then
      raise exception 'Discovery allocation requires a terminal legacy parent';
    end if;
    select * into v_probe from public.research_discovery_probes
      where parent_campaign_id = v_parent.id and manifest_version = v_manifest;
    if found then return jsonb_build_object('created', false, 'probe_id', v_probe.id); end if;

    if v_manifest = 'weak-archetype-raw-search-recheck-20260925' then
      select * into v_original from public.research_discovery_probes
        where parent_campaign_id = v_parent.id and organization_id = v_org
        and manifest_version = 'weak-archetype-raw-search-v1';
      if not found or v_original.status is distinct from 'failed' then
        raise exception 'The dated recheck requires the failed original quota diagnostic';
      end if;
      -- Every persisted operation must prove a zero-cost quota rejection. A
      -- missing receipt, partial success, generic 401 or ambiguous request is
      -- not permission to buy another attempt. The original allocation is
      -- still retained even when all published-rate settled charges were zero.
      for v_operation in select * from public.research_paid_operations
        where research_log_id = v_original.research_log_id
      loop
        v_receipt_count := v_receipt_count + 1;
        if v_operation.organization_id is distinct from v_org
          or v_operation.provider is distinct from 'perplexity'
          or v_operation.model_or_actor is distinct from 'search'
          or v_operation.status is distinct from 'completed'
          or v_operation.raw_response->'status' is distinct from '401'::jsonb
          or v_operation.settled_microusd is distinct from 0
          or coalesce(v_operation.estimated_microusd, 0) <> 0 then
          raise exception 'The dated recheck requires only completed zero-cost HTTP 401 insufficient_quota receipts';
        end if;
        begin
          v_receipt_error_type := (v_operation.raw_response->>'body')::jsonb #>> '{error,type}';
        exception when invalid_text_representation then
          raise exception 'The dated recheck requires a valid insufficient_quota receipt';
        end;
        if v_receipt_error_type is distinct from 'insufficient_quota' then
          raise exception 'The dated recheck requires a valid insufficient_quota receipt';
        end if;
      end loop;
      if v_receipt_count = 0 then
        raise exception 'The dated recheck requires at least one documented insufficient_quota receipt';
      end if;
    end if;

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
      jsonb_build_object('evaluationMode', true, 'diagnosticOnly', true, 'manifestVersion', v_manifest, 'parentCampaignId', v_parent.id),
      jsonb_build_object('classification', 'discovery_transport_only', 'no_candidate_or_pipeline_mutations', true),
      '[]', '[]', '[]', jsonb_build_object('discovered', 0, 'enriched', 0, 'scored', 0, 'returned', 0, 'added', 0))
    returning id into v_log_id;
    insert into public.research_discovery_probes (organization_id, parent_campaign_id, requested_by_user_id,
      research_log_id, manifest_version, allocation_microusd, authorization_snapshot, status, claim_token, deadline_at)
    values (v_org, v_parent.id, v_actor, v_log_id, v_manifest, 30000,
      jsonb_build_object('parentReservedMicrousd', v_parent.total_cost_microusd, 'parentOrdinaryLimitMicrousd', v_parent.preconfirmation_stop_microusd,
        'parentHardLimitMicrousd', v_parent.budget_limit_microusd, 'parentConfirmationReserveMicrousd', v_parent.confirmation_reserve_microusd,
        'allocationMicrousd', 30000, 'priorStickyAllocationsMicrousd', v_allocated,
        'priorDiagnosticId', v_original.id, 'manifestVersion', v_manifest,
        'basis', 'unconsumed_original_ordinary_authorization_not_new_budget'),
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

revoke all on function public.research_discovery_probe(jsonb) from public, anon, authenticated;
grant execute on function public.research_discovery_probe(jsonb) to service_role;
comment on table public.research_discovery_probes is
  'Fixed six-query raw-source diagnostics: original v1 plus one owner-authorized dated quota recheck. Each retains $0.03 from original ordinary authorization. No generic retries or candidate-quality certification.';
