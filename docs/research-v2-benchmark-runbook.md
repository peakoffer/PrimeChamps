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

The held-out run is accepted only when every selected record is locked and unrevealed. One completed held-out run exhausts that cohort; another release test requires a new frozen cohort. Never tune against held-out records.

## Production acceptance

A release is not production-ready until the locked held-out run proves all of the following:

- 100% finalist identity accuracy;
- 100% finalist corroborated 21+ verification;
- 100% of finalists have zero unsupported material claims;
- at least 90% precision among scores above 80;
- at least 90% Auditor catch rate for Researcher failures;
- complete point-in-time compliance;
- recorded model, prompt, rubric, evidence hash, tokens, cost, latency, and findings for every case.

No metric is considered passed when its denominator is zero. Fewer than ten recommendations is correct when the evidence does not support ten.

## Current data status (2026-08-13)

Dylan's enriched source supplies the complete 100-case outcome benchmark: 44 positive and 56 negative. It was compared cell-for-cell with the original locked 100-row benchmark and Evidence Index, then imported as 420 individually dated detail sources and claims. All 100 cases are point-in-time compliant. The corrected bounded-batch audit, which no longer truncates at Supabase's 1,000-row default, finds 26 evidence-ready cases.

The original cohort has already been revealed and is never held out again. The next cohort route uses only excluded, never-evaluated, evidence-ready cases and requires 16 per label so eight per label can remain locked held-out. Current fresh-pool readiness is zero positive and 13 negative. Recover 16 positive and three additional negative cases before attempting a new split. Do not run a paid scoring benchmark merely because the workbook import succeeded.

Audience-at-decision is the dominant positive gap. A capped Google/Wayback recovery batch spent $0.061, added 27 safe non-audience claims across seven records, and found zero historical audience evidence. A zero-new-spend replay of the remaining three records was still Archive-rate-limited, so the route now enforces a six-hour retry cooldown. A zero-spend scan of prior Apify Instagram profile runs also found no exact pre-cutoff snapshot for the 14 known positive handles. Do not repeat either lane blindly.

The next bounded lane is Social Blade's official Instagram history API. Every known positive cutoff is within one year as of 2026-08-13, so each lookup needs at most the two-credit `extended` tier. The owner-only route previews a deterministic five-record pilot and requires the caller to confirm its exact credit ceiling (maximum ten). It accepts only an exact returned handle and the newest daily metric row no later than—and no more than 31 days before—the historical cutoff. It writes audience, engagement, and creator-behavior claims only; Social Blade alone never creates an athlete identity claim. Run the readiness audit immediately after the pilot and stop if its evidence-ready gain does not justify continuing.

The live evaluation workflow now uses the same identity and adult-evidence contracts as the benchmark. Instagram identity must be corroborated by the live profile plus an independent exact-person signal; a numeric similarity score alone is not proof. A single authoritative age source is useful for safety screening but cannot qualify an adult finalist. A score can cross 80 only when two independent domains publish agreeing evidence that establishes age 21+. The rules are pinned in prompt `research-v10-corroborated-identity-and-21-plus-gates` and immutable rubric/prompt artifact version 3; older checkpoints do not satisfy them.
