set lock_timeout = '5s';
set statement_timeout = '60s';

-- A third, narrower transport check after the owner updated billing. The
-- original and post-rotation checks remain immutable, including both $0.03
-- allocations. This check can purchase only one $0.005 Search request, but
-- conservatively holds $0.03 of the same original ordinary authorization.
alter table public.research_discovery_probes
  drop constraint research_discovery_probes_manifest_version_check;
alter table public.research_discovery_probes
  add constraint research_discovery_probes_manifest_version_check check (manifest_version in (
    'weak-archetype-raw-search-v1',
    'weak-archetype-raw-search-recheck-20260925',
    'single-search-access-check-20260926'
  ));

create function public.guard_single_search_paid_operation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_probe public.research_discovery_probes%rowtype;
begin
  if tg_op = 'UPDATE' and new.status <> 'executing' then return new; end if;
  select * into v_probe from public.research_discovery_probes where research_log_id = new.research_log_id;
  if found and v_probe.manifest_version = 'single-search-access-check-20260926' and (
    v_probe.status <> 'running' or v_probe.deadline_at <= clock_timestamp()
    or v_probe.organization_id <> new.organization_id
    or new.provider <> 'perplexity' or new.model_or_actor <> 'search'
    or new.reserved_microusd <> 5000
    or new.campaign_id is not null or new.case_id is not null
    or new.stage <> 'discovery_probe:climbing'
  ) then raise exception 'Single Search check permits exactly one fixed request'; end if;
  return new;
end;
$$;
create trigger guard_single_search_paid_operation before insert or update of status on public.research_paid_operations
  for each row execute function public.guard_single_search_paid_operation();

create function public.research_single_search_check(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid := (p_request->>'organization_id')::uuid;
  v_actor uuid := (p_request->>'actor_user_id')::uuid;
  v_action text := p_request->>'action';
  v_manifest constant text := 'single-search-access-check-20260926';
  v_parent public.research_hardening_campaigns%rowtype;
  v_probe public.research_discovery_probes%rowtype;
  v_previous public.research_discovery_probes%rowtype;
  v_operation public.research_paid_operations%rowtype;
  v_prior_count integer := 0;
  v_allocated bigint;
  v_log_id uuid;
  v_updated integer;
  v_error_type text;
begin
  if not exists (select 1 from public.organization_memberships where organization_id = v_org
    and user_id = v_actor and role = 'owner' and status = 'active') then
    raise exception 'Search access check requires an active organization owner';
  end if;
  if v_action = 'allocate' then
    if p_request->>'manifest_version' is distinct from v_manifest then
      raise exception 'Unknown Search access manifest';
    end if;
    select * into strict v_parent from public.research_hardening_campaigns
      where id = (p_request->>'parent_campaign_id')::uuid and organization_id = v_org for update;
    if v_parent.accounting_version is distinct from 'legacy'
      or v_parent.status not in ('completed','failed','cancelled') then
      raise exception 'Search access check requires a terminal legacy parent';
    end if;
    select * into v_probe from public.research_discovery_probes
      where parent_campaign_id = v_parent.id and organization_id = v_org and manifest_version = v_manifest;
    if found then return jsonb_build_object('created',false,'probe_id',v_probe.id); end if;
    select * into v_previous from public.research_discovery_probes
      where parent_campaign_id = v_parent.id and organization_id = v_org
        and manifest_version = 'weak-archetype-raw-search-recheck-20260925';
    if not found or v_previous.status is distinct from 'failed' then
      raise exception 'Single Search check requires the failed post-rotation diagnostic';
    end if;
    -- The previous authorization stays reserved. Require each of its saved
    -- calls to be a documented zero-cost invalid-key failure, not a success,
    -- unknown charge, or ambiguous in-flight request.
    for v_operation in select * from public.research_paid_operations
      where research_log_id = v_previous.research_log_id loop
      v_prior_count := v_prior_count + 1;
      if v_operation.organization_id is distinct from v_org
        or v_operation.status is distinct from 'completed'
        or v_operation.provider is distinct from 'perplexity'
        or v_operation.model_or_actor is distinct from 'search'
        or v_operation.raw_response->'status' is distinct from '401'::jsonb
        or v_operation.settled_microusd is distinct from 0
        or coalesce(v_operation.estimated_microusd,0) <> 0 then
        raise exception 'Previous Search receipts are not exclusively settled zero-cost invalid-key failures';
      end if;
      begin
        v_error_type := (v_operation.raw_response->>'body')::jsonb #>> '{error,type}';
      exception when invalid_text_representation then
        raise exception 'Previous Search receipt is not valid JSON';
      end;
      if v_error_type is distinct from 'invalid_api_key' then
        raise exception 'Previous Search receipts do not prove invalid_api_key';
      end if;
    end loop;
    if v_prior_count = 0 then raise exception 'Previous Search receipts are missing'; end if;
    select coalesce(sum(allocation_microusd),0) into v_allocated
      from public.research_discovery_probes where parent_campaign_id = v_parent.id;
    if v_parent.budget_limit_microusd is null or v_parent.preconfirmation_stop_microusd is null
      or v_parent.total_cost_microusd is null
      or least(v_parent.budget_limit_microusd,v_parent.preconfirmation_stop_microusd)
        - v_parent.total_cost_microusd - v_allocated < 30000 then
      raise exception 'Original ordinary allowance cannot fund the single Search check';
    end if;
    insert into public.research_logs (organization_id,requested_by_user_id,status,phase,heartbeat_at,
      prompt_version,is_evaluation,accounting_version,cost_limit_microusd,config_used,context_summary,
      raw_results,scoring_details,final_results,stats)
    values (v_org,v_actor,'running','discovery_diagnostic',clock_timestamp(),'raw-discovery-probe-v1',
      true,'operations_v1',30000,
      jsonb_build_object('evaluationMode',true,'diagnosticOnly',true,'manifestVersion',v_manifest,'parentCampaignId',v_parent.id),
      jsonb_build_object('classification','search_transport_only','no_candidate_or_pipeline_mutations',true),
      '[]','[]','[]',jsonb_build_object('discovered',0,'enriched',0,'scored',0,'returned',0,'added',0))
    returning id into v_log_id;
    insert into public.research_discovery_probes (organization_id,parent_campaign_id,requested_by_user_id,
      research_log_id,manifest_version,allocation_microusd,authorization_snapshot,status,claim_token,deadline_at)
    values (v_org,v_parent.id,v_actor,v_log_id,v_manifest,30000,
      jsonb_build_object('parentReservedMicrousd',v_parent.total_cost_microusd,
        'parentOrdinaryLimitMicrousd',v_parent.preconfirmation_stop_microusd,
        'parentHardLimitMicrousd',v_parent.budget_limit_microusd,
        'allocationMicrousd',30000,'priorStickyAllocationsMicrousd',v_allocated,
        'priorDiagnosticId',v_previous.id,'maximumPaidRequests',1,
        'publishedRateMaximumMicrousd',5000,'manifestVersion',v_manifest,
        'basis','unconsumed_original_ordinary_authorization_not_new_budget'),
      'running',gen_random_uuid(),clock_timestamp()+interval '60 seconds') returning * into v_probe;
    return jsonb_build_object('created',true,'probe_id',v_probe.id,'research_log_id',v_log_id,'claim_token',v_probe.claim_token);
  end if;
  select * into strict v_probe from public.research_discovery_probes
    where id = (p_request->>'probe_id')::uuid and organization_id = v_org
      and manifest_version = v_manifest for update;
  if v_probe.claim_token is distinct from (p_request->>'claim_token')::uuid
    or v_probe.status <> 'running' then raise exception 'Search access claim is not active'; end if;
  if v_action = 'heartbeat' then
    if v_probe.deadline_at <= clock_timestamp() then raise exception 'Search access deadline expired; no retry'; end if;
    update public.research_logs set heartbeat_at=clock_timestamp()
      where id=v_probe.research_log_id and organization_id=v_org and status='running' and cancel_requested_at is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then raise exception 'Search access run is no longer active'; end if;
  elsif v_action = 'finish' then
    if p_request->>'status' not in ('completed','failed') then raise exception 'Invalid Search access completion'; end if;
    if p_request->>'status' = 'completed' and (select count(*) from public.research_paid_operations
      where research_log_id=v_probe.research_log_id and status='completed'
        and (raw_response->>'status')::integer between 200 and 299) <> 1 then
      raise exception 'Search access completion requires one successful saved response';
    end if;
    update public.research_discovery_probes set status=p_request->>'status',completed_at=clock_timestamp(),
      error_message=case when p_request->>'status'='failed'
        then 'Single Search access check failed or was interrupted. Allocation retained; no automatic retry.' else null end
      where id=v_probe.id;
    update public.research_logs set status=case when p_request->>'status'='completed' then 'completed' else 'error' end,
      phase=case when p_request->>'status'='completed' then 'discovery_diagnostic_complete' else 'discovery_diagnostic_failed' end,
      heartbeat_at=clock_timestamp(),completed_at=clock_timestamp()
      where id=v_probe.research_log_id and organization_id=v_org and status='running';
  else raise exception 'Unknown Search access action'; end if;
  return jsonb_build_object('ok',true,'probe_id',v_probe.id);
end;
$$;

revoke all on function public.guard_single_search_paid_operation(), public.research_single_search_check(jsonb)
  from public, anon, authenticated;
grant execute on function public.guard_single_search_paid_operation(), public.research_single_search_check(jsonb)
  to service_role;
