# Research V2 benchmark runbook

## Purpose

This benchmark evaluates the OnlyFans athlete Researcher and blind Auditor without creating athletes, promoting pipeline records, sending notifications, drafting messages, or contacting anyone. A benchmark result is an experiment record only.

The benchmark is intentionally fail-closed. Returning no run is correct when labels, point-in-time evidence, identity, pricing, or budgets are not ready.

## Ground-truth cohort gate

A cohort can be frozen only after it contains at least:

- 40 authoritative positive records;
- 40 authoritative negative records;
- an achievability label (`high`, `medium`, or `low`) for every record;
- the original decision date and evidence cutoff;
- either Dylan's outcome-derived source label or a fit assessment locked before the historical outcome was reviewed;
- `strong` or `partial` source reliability; future non-Dylan labels also require a public-knowability decision;
- at least eight non-development-only examples of each fit label for the held-out split.

Dylan's 100-opportunity workbook is the source of truth for the core benchmark. `Signed` and `Approved but Did Not Sign` are positive; `Rejected` and `Stalled` are negative. This produces 44 positives and 56 negatives. The raw outcome is never included in a Researcher or Auditor prompt. The model sees only independently retrieved public evidence from on or before the decision cutoff, and its prediction is compared with Dylan's label afterward.

The blind-label worksheet remains available only for future records that do not come from Dylan's authoritative source. It is not required to relabel the 100-case benchmark.

## Evidence gate

Only claims meeting every condition below enter a model prompt:

1. The source was retrieved successfully and has an HTTP(S) URL.
2. The source and claim are explicitly eligible before the record's evidence cutoff.
3. The claim is supported and eligible for scoring.
4. The claim or source has a dated public effective time no later than the cutoff.
5. The source is not an internal record, mailbox benchmark, OnlyFans outcome source, or historical outcome importer.
6. The claim is not a historical fit label, outcome, primary reason, commercial outcome, or golden label.

Post-cutoff and private evidence may remain stored for auditability, but it is rejected before prompt construction.

A cohort cannot be frozen on labels alone. Every record must also contain at least four supported pre-cutoff public claims from two independent sources and two-source exact-identity corroboration. Positive fit records additionally require two independent sources proving the athlete was at least 21 by the cutoff. This prevents an empty evidence packet from becoming immutable in the held-out set.

## Execution sequence

1. An owner or admin starts a development run with a case count and cost ceiling.
2. The server resolves the newest priced, structured-output Anthropic Sonnet model in OpenRouter's live catalog and stores its exact ID, provider route, release timestamp, and price snapshot. If OpenRouter is unavailable, a configured direct Anthropic key is the failover route.
3. The server freezes the selected case IDs in the run checkpoint. Labels are not stored in that checkpoint or sent to a model.
4. Each resume request processes one case under a five-minute execution lease:
   - Researcher assessment;
   - independent blind Auditor assessment with the proposed score hidden;
   - Auditor comparison and correction stage;
   - deterministic identity, 21+, citation, unsupported-claim, and score gates;
   - result and cost checkpoint.
5. Interrupted runs resume from the latest persisted Researcher, blind-audit, or review checkpoint.
6. Golden labels are compared only after the model stages have completed.
7. Held-out metrics remain concealed while the release run is incomplete.

Material claims use stricter evidence support than a bare citation ID. The Researcher must copy an exact quote for every cited `E` source. The server verifies that the quote exists in the frozen dossier and materially overlaps the claim, while the comparison-stage Auditor receives the same frozen dossier and must separately list any claim the quote does not actually establish. Either failure caps priority below the finalist threshold.

The review stage is a ceiling, never a score-raising step. Final fit, achievability, and confidence dimensions are the minimum of the Researcher, blind Auditor, and review correction. The complete deterministic final gate is applied again before a score can remain above 80.

Start a bounded development run:

```http
POST /api/research/benchmarks
Content-Type: application/json

{
  "action": "start",
  "split": "development",
  "caseLimit": 5,
  "costLimitMicrousd": 1000000
}
```

Process the next checkpointed case:

```http
POST /api/research/benchmarks
Content-Type: application/json

{
  "action": "resume",
  "runId": "<benchmark run id>"
}
```

Repeat `resume` until `completed` is `true`. A failed run retains its checkpoint and can be resumed after correcting the reported configuration or provider failure.

## Budget behavior

- The default run ceiling is $1 (`1,000,000` microusd).
- A paid call is rejected before execution when its conservative full-output projection would exceed the run's dollar, input-token, or output-token limit.
- Actual provider usage is persisted after every call, including a schema retry. OpenRouter's provider-reported charge is authoritative; the catalog snapshot remains the pre-admission estimate and audit record.
- OpenRouter catalog discovery fails closed when the latest Sonnet lacks structured output or usable pricing. Direct Anthropic models with unknown pricing cannot run until explicit per-million-token prices are configured.
- `RESEARCH_BENCHMARK_MODEL_PROVIDER=openrouter` or `anthropic` can deliberately pin a route. Without a pin, OpenRouter is preferred when configured and direct Anthropic is the fallback.
- Optional price overrides are `RESEARCH_SONNET_INPUT_USD_PER_MTOK` and `RESEARCH_SONNET_OUTPUT_USD_PER_MTOK`.

## Held-out release rule

Do not set `RESEARCH_HELD_OUT_EVALUATION_ENABLED=true` until development results are stable and the intended prompt, rubric, evidence policy, model family, and score weighting are frozen.

The server refuses to create a held-out run unless its baseline is a completed full-development-cohort run from the same frozen cohort and every release threshold already passes. A four-case smoke test may authorize a full development calibration, but it can never unlock held-out by itself. The held-out run must cover the entire locked split and is accepted only when every selected record is locked and unrevealed. One completed held-out run reveals and exhausts that cohort; it then becomes archive-only. Development scoring resolves exactly one current locked, unrevealed Dylan-ground-truth cohort, and fails closed if no active cohort or conflicting active cohorts exist. Another release test requires a new frozen cohort. Never tune against held-out records.

## Production acceptance

A release is not production-ready until the locked held-out run proves all of the following:

- 100% finalist identity accuracy;
- 100% finalist corroborated 21+ verification;
- 100% of finalists have zero unsupported material claims;
- at least 90% precision among scores above 80;
- at least 90% audit decision accuracy and finalist audit-pass rate;
- at least 90% Auditor catch rate for Researcher failures;
- complete point-in-time compliance;
- recorded model, prompt, rubric, evidence hash, tokens, cost, latency, and findings for every case.

No metric is considered passed when its denominator is zero. Fewer than ten recommendations is correct when the evidence does not support ten.

The runtime enforces that last rule separately from target coverage. A short or empty qualified list is a valid no-padding result; `targetMet` and `shortfall` report coverage without marking an unsafe candidate as a quality pass.

## Current data status (2026-08-13)

Dylan's enriched source supplies the complete 100-case outcome benchmark: 44 positive and 56 negative. It was compared cell-for-cell with the original locked 100-row benchmark and Evidence Index, then imported as 420 individually dated detail sources and claims. All 100 cases are point-in-time compliant. The corrected bounded-batch and athlete-attribution audit now finds 28 evidence-ready cases.

The original cohort has already been revealed and is never held out again. The next cohort route uses only excluded, never-evaluated, evidence-ready cases and requires 16 per label so eight per label can remain locked held-out. Current fresh-pool readiness is zero positive and 16 negative. The negative side is complete; recover 16 positive cases before attempting a new split. Do not run a paid scoring benchmark merely because the workbook import succeeded.

Audience-at-decision is the dominant positive gap. A capped Google/Wayback recovery batch spent $0.061, added 27 safe non-audience claims across seven records, and found zero historical audience evidence. A zero-new-spend replay of the remaining three records was still Wayback-rate-limited. The recovery workflow now reuses that paid discovery checkpoint and has two free historical paths: MediaWiki's revisions API for the latest Wikipedia article revision at or before the cutoff, plus Common Crawl's URL index and bounded WARC range retrieval for other pages. Common Crawl checks at most the two closest pre-cutoff collections per URL. Both paths apply the same exact-name/sport/date extractor and store provider-specific provenance. They may recover editorial identity, age, momentum, creator evidence, or an explicitly attributed Instagram handle, but one Wikipedia revision remains only one independent source and neither path replaces Social Blade for historical Instagram metrics. A zero-spend scan of prior Apify Instagram profile runs found no exact pre-cutoff audience snapshot for the original 14 known positive handles. Exact Instagram/Social Blade URL checks across five priority handles likewise found no usable Common Crawl or Wayback audience snapshot. Finally, community Actor `gordian/instagram-profile-history` returned no account and zero rows for Carlos Gimeno in diagnostic run `pSDkS9ZAuBh9nNglv` at $0.0000. Do not repeat these failed audience-history lanes. Archived editorial/profile pages did safely recover exact handles for Tessa Thyssen, Crystal Pittman, and Catarina Guimaraes, bringing the Social Blade candidate pool to 17 without treating those pages as follower-history evidence.

The next bounded lane is Social Blade's official Instagram history API. All 17 known positive cutoffs are within one year as of 2026-08-13, so each lookup needs at most the two-credit `extended` tier. The owner-only route now executes exactly one deterministic profile per checkpoint and requires the caller to confirm that profile's exact credit ceiling. Every successful or failed paid attempt is persisted, the same record is never offered twice, and the pilot closes after five total attempts. It accepts only an exact returned handle and the newest daily metric row no later than—and no more than 31 days before—the historical cutoff. It writes audience, engagement, and creator-behavior claims only; Social Blade alone never creates an athlete identity claim. Reload and audit readiness after every profile; do not authorize the next checkpoint unless the measured gain justifies it.

Evidence recovery always prioritizes near-ready positive records whose existing leakage-safe packets already pass momentum and creator-potential gates but still lack identity or two-source 21+ corroboration. A parser/extraction version bump may make broad baseline replay available, but it cannot push that lower-value replay ahead of a targeted age/identity recovery batch. Wayback cooldown remains visible for audit purposes but no longer blocks a saved-checkpoint replay while the Common Crawl fallback is available.

The cutoff-safe MediaWiki/Wayback replay for Lola Gallardo completed as a measured input-recovery success. It reused the saved Google discovery checkpoint with zero new Apify spend and zero scoring tokens. The packet has eight independent domains and 30 run-safe claims; Wikipedia supplied one exact birth-date source and ESPN's archived 2021 profile independently supplied an attributable stated age. The parser accepts only the tightly anchored `Name [optional pronouns], age, verb` form and includes a teammate-contamination regression. After the later material-attribution audit, Lola correctly remains blocked only on historical audience and is not counted as fresh evidence-ready.

The final negative recovery batch `7f507de9-7d8e-47ff-870b-9a37629bb64e` then processed Murat Kazgan, Christen Press, and Sadio Doumbia for $0.0185 with zero scoring tokens and zero live writes. All three became evidence-ready and the required 16-case negative cohort is now closed.

The next audit exposed an older extraction flaw: a page could name the athlete in one area while momentum, audience, or sponsorship language referred to someone else. Ninety-five such archived claims were marked unsupported and ineligible, not deleted. The same athlete-attribution rule now applies to generic candidate evidence inside the readiness gates. The idempotent post-check finds zero remaining unquarantined claims in that class. After the three exact-handle packets, corrected state is 28 ready records, 1,203 safe claims, 910 preserved sources, and fresh readiness of `0 fit / 16 not-fit`. Lola Gallardo retains exact identity, two-source 21+, momentum, and creator evidence but correctly lacks a cutoff-safe audience signal.

Baseline preparation now excludes records that are already evidence-ready, ranks not-fit identity-only gaps ahead of positive cases that still need unavailable historical audience data, and uses a three-record/$0.50 batch rather than the former ten-record/$0.75 default. This closed the negative gap without spending on already-ready Lola, Jaqueline Cristian, or Marion Haerty. Do not run another baseline batch now that the negative target is met.

The live evaluation workflow now uses the same identity and adult-evidence contracts as the benchmark. Instagram identity must be corroborated by the live profile plus an independent exact-person signal; a numeric similarity score alone is not proof. A single authoritative age source is useful for safety screening but cannot qualify an adult finalist. A score can cross 80 only when two independent domains publish agreeing evidence that establishes age 21+. The rules are pinned in prompt `research-v10-corroborated-identity-and-21-plus-gates` and immutable rubric/prompt artifact version 3; older checkpoints do not satisfy them.

The exact-handle archive pilot on 2026-08-13 cost $0.0285 for three fresh positive cases and returned zero newly freeze-ready packets. It also surfaced and quarantined one publisher-footer handle falsely attributed to Carlos Gimeno. The parser regression now requires a personal-name handle match or an explicit archived “post shared by [athlete]” attribution. Do not scale the exact-handle Google/archive plan; it failed its readiness-gain audit. The no-login Apify Social Blade actor is also unsuitable because its Instagram history field is premium-gated and null. Use only a provider that returns an exact-handle, pre-cutoff audience snapshot.

The alternate 31-day public Social Blade Actor was also tested under a one-profile/$0.50 ceiling. Lola Gallardo returned no dated row at $0.00000; Crystal Pittman returned only one current profile row and no daily history at $0.00005. Both diagnostics are persisted with `retrieval_status=error`, `eligible_before_cutoff=false`, zero claims, zero scoring tokens, and zero outreach writes. The application closes this lane after the two measured failures. The official historical API remains the required audience source.

The direct Business API parser follows the current official Instagram response contract: daily rows live at `data.statistics.daily`. It also accepts the prior flat location only as a compatibility fallback. Never treat `data.statistics.total` as a historical cutoff snapshot.
