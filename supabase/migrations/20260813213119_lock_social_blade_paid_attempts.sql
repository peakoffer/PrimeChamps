-- Reserve each paid Social Blade lookup exactly once. This partial key avoids
-- changing provenance behavior for older archive providers that historically
-- reused provider request IDs.
create unique index if not exists research_evidence_sources_social_blade_attempt_uidx
  on public.research_evidence_sources(
    organization_id,
    golden_record_id,
    provider,
    provider_request_id
  )
  where provider = 'social_blade_instagram_history'
    and provider_request_id is not null;

comment on index public.research_evidence_sources_social_blade_attempt_uidx is
  'Prevents concurrent or replayed paid Social Blade history requests for the same benchmark record and cutoff.';
