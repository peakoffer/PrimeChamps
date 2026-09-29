set lock_timeout = '5s';
set statement_timeout = '60s';

-- A provider can reject a request before inference (for example OpenRouter's
-- "No endpoints found" routing refusal) without returning usage or a request
-- ID. The ledger then correctly keeps the full reservation as unknown spend,
-- and nothing can settle it. This append-only ledger records owner-verified
-- billing evidence and settles only that narrow class of operation at $0.
-- Receipts are never edited directly, and every other operation is refused.

create table public.research_paid_operation_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  operation_id uuid not null unique references public.research_paid_operations(id) on delete restrict,
  campaign_id uuid references public.research_hardening_campaigns(id) on delete restrict,
  case_id uuid references public.research_hardening_cases(id) on delete restrict,
  reconciled_by_user_id uuid not null,
  kind text not null check (kind = 'pre_inference_rejection'),
  provider text not null,
  provider_http_status integer not null check (provider_http_status between 400 and 499),
  previous_reserved_microusd bigint not null check (previous_reserved_microusd > 0),
  previous_usage jsonb not null,
  settled_microusd bigint not null check (settled_microusd = 0),
  evidence jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index research_paid_operation_reconciliations_org_idx
  on public.research_paid_operation_reconciliations (organization_id, created_at);
create index research_paid_operation_reconciliations_campaign_idx
  on public.research_paid_operation_reconciliations (campaign_id) where campaign_id is not null;
create index research_paid_operation_reconciliations_case_idx
  on public.research_paid_operation_reconciliations (case_id) where case_id is not null;
alter table public.research_paid_operation_reconciliations enable row level security;
revoke all on public.research_paid_operation_reconciliations from public, anon, authenticated;
grant select, insert on public.research_paid_operation_reconciliations to service_role;
comment on table public.research_paid_operation_reconciliations is
  'Append-only, owner-evidenced $0 settlements of provider requests rejected before inference. Never updated or deleted.';

create or replace function public.prevent_research_reconciliation_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Paid-operation reconciliations are append-only';
end;
$$;
revoke all on function public.prevent_research_reconciliation_change() from public, anon, authenticated;
create trigger research_paid_operation_reconciliations_append_only
  before update or delete on public.research_paid_operation_reconciliations
  for each row execute function public.prevent_research_reconciliation_change();

create or replace function public.reconcile_research_pre_inference_rejection(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.research_paid_operations;
  v_status integer;
  v_evidence jsonb := coalesce(p_request->'evidence', '{}'::jsonb);
  v_checked_at timestamptz;
  v_reconciliation_id uuid;
begin
  select * into v_operation from public.research_paid_operations
    where id = (p_request->>'operation_id')::uuid
      and organization_id = (p_request->>'organization_id')::uuid
    for update;
  if not found then raise exception 'Paid operation not found for this organization'; end if;
  if p_request->>'campaign_id' is not null and v_operation.campaign_id is distinct from (p_request->>'campaign_id')::uuid then
    raise exception 'Paid operation does not belong to this campaign';
  end if;
  if exists (select 1 from public.research_paid_operation_reconciliations where operation_id = v_operation.id) then
    raise exception 'Paid operation is already reconciled';
  end if;
  if v_operation.status <> 'completed' or v_operation.settled_microusd is not null
    or v_operation.estimated_microusd is not null then
    raise exception 'Only a completed operation with no settled or estimated charge can be reconciled';
  end if;
  if v_operation.remote_request_id is not null then
    raise exception 'An operation with a provider request ID must be settled from its provider receipt';
  end if;
  if v_operation.provider <> 'openrouter' then
    raise exception 'Only OpenRouter pre-inference routing rejections are eligible';
  end if;
  if coalesce(v_operation.usage->>'billingBasis', '') <> 'unsettled_reserved'
    or (v_operation.usage - 'billingBasis') <> '{}'::jsonb then
    raise exception 'The provider reported usage for this operation; it is not a pre-inference rejection';
  end if;
  v_status := case when coalesce(v_operation.raw_response->>'status', '') ~ '^[0-9]{3}$'
    then (v_operation.raw_response->>'status')::integer end;
  if v_status is null or v_status < 400 or v_status > 499 then
    raise exception 'Only a 4xx provider rejection can be reconciled';
  end if;
  if position('No endpoints found' in coalesce(v_operation.raw_response->>'body', '')) = 0 then
    raise exception 'The provider response does not show a routing rejection before inference';
  end if;
  if v_evidence->>'source' is distinct from 'openrouter_activity' then
    raise exception 'Evidence must come from the OpenRouter Activity log';
  end if;
  if coalesce(v_evidence->>'observed_charge_usd', '') not in ('0', '0.0', '0.00') then
    raise exception 'Reconciliation to $0 requires an observed charge of exactly $0';
  end if;
  begin
    v_checked_at := (v_evidence->>'checked_at')::timestamptz;
  exception when others then
    raise exception 'Evidence must record when the provider activity was checked';
  end;
  if v_checked_at is null or v_checked_at < v_operation.completed_at or v_checked_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'The billing check must happen after the operation and not in the future';
  end if;
  if length(trim(coalesce(v_evidence->>'attestation', ''))) < 40 then
    raise exception 'Describe what the provider activity showed (at least 40 characters)';
  end if;
  if coalesce(p_request->>'user_id', '') = '' or not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = v_operation.organization_id
      and m.user_id = (p_request->>'user_id')::uuid
      and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'Only an active organization owner can reconcile a paid operation';
  end if;

  insert into public.research_paid_operation_reconciliations (
    organization_id, operation_id, campaign_id, case_id, reconciled_by_user_id, kind, provider,
    provider_http_status, previous_reserved_microusd, previous_usage, settled_microusd, evidence
  ) values (
    v_operation.organization_id, v_operation.id, v_operation.campaign_id, v_operation.case_id,
    (p_request->>'user_id')::uuid, 'pre_inference_rejection', v_operation.provider,
    v_status, v_operation.reserved_microusd, v_operation.usage, 0,
    jsonb_build_object(
      'source', v_evidence->>'source',
      'checked_at', v_checked_at,
      'observed_charge_usd', 0,
      'attestation', left(trim(v_evidence->>'attestation'), 2000),
      'reference', left(coalesce(v_evidence->>'reference', ''), 500)
    )
  ) returning id into v_reconciliation_id;

  update public.research_paid_operations set
    settled_microusd = 0,
    usage = jsonb_build_object(
      'billingBasis', 'reconciled_pre_inference_rejection',
      'previousBillingBasis', 'unsettled_reserved',
      'reconciliationId', v_reconciliation_id
    ),
    updated_at = clock_timestamp()
  where id = v_operation.id;

  return jsonb_build_object(
    'reconciliation_id', v_reconciliation_id,
    'operation_id', v_operation.id,
    'released_microusd', v_operation.reserved_microusd
  );
end;
$$;
revoke all on function public.reconcile_research_pre_inference_rejection(jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_research_pre_inference_rejection(jsonb) to service_role;
