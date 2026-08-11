# Research V2 benchmark runbook

## Purpose

This benchmark evaluates the OnlyFans athlete Researcher and blind Auditor without creating athletes, promoting pipeline records, sending notifications, drafting messages, or contacting anyone. A benchmark result is an experiment record only.

The benchmark is intentionally fail-closed. Returning no run is correct when labels, point-in-time evidence, identity, pricing, or budgets are not ready.

## Ground-truth cohort gate

A cohort can be frozen only after it contains at least:

- 40 independently labeled `fit` records;
- 40 independently labeled `not_fit` records;
- an achievability label (`high`, `medium`, or `low`) for every record;
- the original decision date and evidence cutoff;
- a fit assessment locked before the historical outcome was reviewed;
- a public-knowability decision and `strong` or `partial` point-in-time reliability;
- at least eight non-development-only examples of each fit label for the held-out split.

Historical signing or rejection outcomes are not fit labels. Challenge cases mined from earlier model results remain development-only until independently labeled by a human.

## Evidence gate

Only claims meeting every condition below enter a model prompt:

1. The source was retrieved successfully and has an HTTP(S) URL.
2. The source and claim are explicitly eligible before the record's evidence cutoff.
3. The claim is supported and eligible for scoring.
4. The claim or source has a dated public effective time no later than the cutoff.
5. The source is not an internal record, mailbox benchmark, OnlyFans outcome source, or historical outcome importer.
6. The claim is not a historical fit label, outcome, primary reason, commercial outcome, or golden label.

Post-cutoff and private evidence may remain stored for auditability, but it is rejected before prompt construction.

## Execution sequence

1. An owner or admin starts a development run with a case count and cost ceiling.
2. The server resolves the newest available Anthropic Sonnet model and stores its exact ID and a dated price snapshot.
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
- Actual provider usage is persisted after every call, including a schema retry.
- Unknown future Sonnet models cannot run until explicit per-million-token prices are configured.
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

## Current data status (2026-08-11)

The production database currently has 192 excluded draft records, 108 provisional fit labels, three provisional not-fit labels, no completed achievability labels, no frozen cohort, and no benchmark-eligible point-in-time evidence. Model evaluation must remain at $0 until the independent labels and dated public evidence are completed.
