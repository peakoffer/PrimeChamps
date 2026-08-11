# Prime Champs Research V2

## Objective and safety boundary

Return a small, evidence-backed set of athlete opportunities worth human review. A requested set is successful only when ten candidates pass every quality gate and have a corrected priority score above 80. Research never sends outreach, drafts, comments, or messages.

The score is not ground truth. V2 is optimized against leakage-safe human labels and audited evidence; “ten above 80” is only the final output gate.

## What V1 got right

Keep these components:

- Durable TypeScript/Vercel Workflow execution with checkpoints, retries, cancellation, and partial progress.
- Official-source and web discovery with Apify fallbacks.
- Instagram identity resolution and public-profile enrichment.
- Source-linked adult age verification, public/activity checks, and chronological post handling.
- Versioned recruiting-thesis input from the Zac + Dylan intelligence loop.
- Supabase as the system of record.
- Evaluation mode that creates no athletes, notifications, drafts, or outreach.

Do not treat the old four synthetic replay cases as a quality benchmark. They are deterministic safety regressions only.

## The V2 contract

Every candidate is evaluated on four distinct questions:

1. **OnlyFans fit:** Is the athlete an attractive SFW athlete/content partnership opportunity based on public information?
2. **Commercial achievability:** Is Prime Champs likely to access and close the opportunity at workable economics?
3. **Research confidence:** Is the identity, eligibility, evidence, freshness, and coverage strong enough to trust the assessment?
4. **Overall priority:** Should Prime Champs invest human outreach effort?

Priority is calculated deterministically from 45% fit, 35% achievability, and 20% confidence. A high value in one dimension cannot hide a weak one. Priority is capped below the finalist threshold when fit is below 80, achievability below 60, confidence below 80, a material claim is unsupported, or a critical gap remains.

## Golden benchmark

The initial benchmark is approximately 80 records:

- 40 positive examples, stratified across sport, audience size, career stage, representation, and outcome quality.
- 40 commercial negatives. These usually appear as early non-progressions rather than formal rejections: poor content or creator fit, unrealistic athlete economics, or under-21 partnership ineligibility. Later-stage non-signings, OnlyFans passes, stalled opportunities, and signed opportunities that underperformed also qualify.

“Negative” means the opportunity did not work commercially. It does not mean negative news about the athlete.

For every record, label:

- Original decision date and evidence cutoff.
- Fit at that time.
- Achievability at that time.
- Final outcome and primary reason.
- Whether decisive information was publicly knowable.
- Whether Dylan would pursue the opportunity today.
- A short explanation and internal reference when available.

Fit must be labeled before the outcome is reviewed whenever practical. Use `uncertain` rather than reconstructing a memory from hindsight. Records with unusable point-in-time evidence remain stored but excluded.

Completed examples are assigned automatically to a 75% development split and 25% held-out split within sport/fit/outcome strata. The operator does not choose the held-out examples during labeling.

## Research and independent audit

```text
request + pinned thesis
  -> candidate discovery
  -> identity and eligibility gates
  -> normalized sources and claims
  -> Researcher: fit / achievability / confidence
  -> blind Auditor: independent search and evidence review
  -> Auditor views proposed scores and passes, corrects, or fails
  -> deterministic final gate
  -> human Approval
```

The Researcher must attach a URL and retrieval date to every material claim. Unsourced claims do not score.

During V2 development, the Auditor reviews every proposed priority candidate and every benchmark case. The Auditor initially receives the person and evidence but not the Researcher’s score. It independently checks identity, adult eligibility, current career status, source support, contradictory evidence, representation/economics/access constraints, and criteria drift. Only then does it see the proposed scores.

At least 20% of material claims are deterministically sampled and re-fetched. Missing or non-supporting sources are hard failures.

## Final-candidate gate

A candidate counts only when all are true:

- Corrected overall priority is greater than 80.
- Fit is at least 80.
- Achievability is at least 60.
- Research confidence is at least 80.
- The athlete and personal account are identity-confirmed.
- Age 21+ is source-verified.
- Instagram is public and recently active.
- Material claims pass source verification.
- The independent audit passes or corrects the assessment.
- No critical gap remains.

The system never pads a result set to reach ten.

## Metrics and iteration

The benchmark reports:

- Precision above 80 and recall of strong fits.
- False-positive rate.
- Fit and achievability accuracy.
- Identity, eligibility, source-verification, and point-in-time compliance rates.
- Unsupported-claim rate and Auditor catch rate.
- Cost, latency, and token usage.

Each experiment changes exactly one major dimension: source, query strategy, prompt, rubric, model, audit rule, or score weighting. Keep a change only when development metrics improve without degrading the locked held-out split. Do not tune against held-out examples.

Failure classes are stored explicitly: wrong entity, stale information, point-in-time leakage, unsupported claim, missing source, source retrieval failure, extraction failure, criteria drift, score inflation, missed strong fit, achievability error, Researcher miss caught by Auditor, both roles missed, unverified eligibility, and duplicate evidence.

## Tooling decision

| Layer | V2 choice | Why | Deferred alternative |
|---|---|---|---|
| Core orchestration | Existing TypeScript + Vercel Workflow | Already durable, deployed, retryable, and integrated; a Python rewrite would add risk before an orchestration limit is measured | Plain async Python, LangGraph, Claude Agent SDK |
| Triggers/handoffs | Existing app routes; n8n only when an external trigger is useful | Keeps the iterative loop in code and tests | Core logic in n8n |
| Discovery | OpenAI Responses `gpt-5.6` with live `web_search`, citation allow-listing, official-source preference, and Apify/Perplexity resilience paths | Uses the already-configured API, returns inspectable sources, and replaces the quota-exhausted Perplexity primary path without buying an enterprise data contract | Benchmark OpenRouter or Exa only as isolated provider experiments after the baseline |
| Social enrichment | Apify Instagram actors | Already configured and sufficient for public profile data | Bright Data or Modash only after a measured coverage gap |
| Extraction/judgment | Latest configured Sonnet, strict JSON schemas | Matches the Prime Champs model policy and existing integration | Lower-cost extraction model only after cost/quality benchmark |
| Audit independence | Blind prompt, independent retrieval, separate context, then corrected review | Produces procedural independence while keeping Sonnet as requested | Different model family after baseline metrics exist |
| State/evidence | Supabase normalized sources, claims, scores, audits, versions, benchmark results, funnel events | Queryable provenance and reproducibility | JSON-only blobs are retained only for run replay, not as the benchmark contract |
| Evaluation | Internal Supabase harness and unit/CI regressions first | Smallest debuggable system with no new platform dependency | Braintrust for scaled comparisons; Langfuse for self-hosted tracing; Promptfoo for broader CI matrices |
| Paid influencer data | No Modash contract now | The annual price is not justified before proving a measured data gap | Revisit with volume and coverage evidence |

## Current implementation status — 11 August 2026

- V1 discovery, identity, eligibility, activity, scoring, and durable execution have been strengthened and retained.
- The V2 schema is live in Supabase with server-only privileges and RLS enabled.
- Dylan's 40-athlete commercial-positive deliverable was imported on 10 August 2026. Five records were merged with the original seed and 35 were added. All 40 are labeled `fit + signed`, linked to 14 existing athlete records, and remain safely excluded with `partial` point-in-time reliability because the dates and commercial reasons were reconstructed after the outcome.
- Dylan's updated 100-opportunity mailbox benchmark is handled as a separate, idempotent historical ledger. `Strong Fit` maps to `fit`; `Not a Fit` maps to `not_fit`; `Possible Fit` and `Uncertain` remain `uncertain`. `Stalled` is explicitly right-censored, and evidence containing downstream signature, payment, contract, or sign-up information is tagged and excluded from scoring.
- Reconciliation never silently overwrites contradictory labels from the earlier 40. Conflicting signed-versus-rejected/non-signing/stalled records are changed to `unresolved`, retain both internal evidence sources, and surface with `historical_label_conflict` for human review.
- All 100 mailbox records remain excluded from development and held-out splits until achievability, public knowability, sport enrichment where needed, and a leakage-safe pre-decision public evidence snapshot are complete.
- The controlled production import now contains all 100 rows, 100 dedicated mailbox evidence sources, and 300 normalized claims. No internal claim is eligible for scoring. Four contradictory outcomes are `unresolved`, all 33 stalled labels remain censored, and 38 records are explicitly queued for sport enrichment instead of receiving invented classifications.
- Every delivered positive has one internal evidence source and three normalized claims: Dylan's fit label, the signed outcome, and the inferred commercial reason. That is 40 sources and 120 claims. None is eligible as point-in-time scoring evidence.
- Thirty-five records from the original arbitrary historical seed remain `uncertain` and `excluded`; they are not training or benchmark truth.
- The labeling screen and clean-split assignment are implemented.
- Separate fit, achievability, confidence, deterministic score caps, normalized evidence, version pinning, blind audit, independent search, claim re-fetch, corrected scoring, and the final gate are implemented.
- A clean degraded-path baseline exposed `Perplexity 401 insufficient_quota` and repeated 180-second Apify Google timeouts. The primary discovery connector now uses OpenAI `gpt-5.6` web search with strict structured output; candidates whose URLs were not actually consulted or cited are discarded.
- In the first controlled volleyball comparison, the degraded path produced 48 sourced / 43 evidence-qualified discoveries, while OpenAI web discovery produced 127 sourced / 80 admitted to the enrichment cap. This establishes better breadth, not final quality.
- The degraded Instagram identity lane verified only 6 of 43 candidates and rejected 24 as identity conflicts, largely after search timeouts and guessed-handle fallback. A controlled OpenAI identity-search run resolved only one of fifteen unknown handles and consumed 84,690 input tokens across two calls. A controlled OpenRouter `google/gemini-3.6-flash` + Exa run resolved zero of nine and reported $0.18308175 for 154,257 tokens. Neither is accepted as the default identity lane.
- The Instagram-native identity experiment is complete. Apify exact-name user search plus separate profile verification produced 18 verified identities from the 40 admitted volleyball candidates. Adding a conservative exact-handle probe for verified full-name/sport profiles raised coverage to 20 of 40 without accepting the known same-name false positive. Deep surname search increased junk rather than useful coverage and was rejected.
- The clean corrected run scored 20 candidates, source-verified eight adults, and returned zero finalists above 80. The best results were Devon Newberry and Madisen Skinner at 79, Merritt Beason at 77, Asjia O'Neal at 75, and Alaina Chacon at 73. The scorer correctly refused to manufacture ten passing candidates; the remaining problem is the candidate pool and missing creator/commercial evidence, not a need to inflate scores.
- Batched OpenAI age research replaced repeated Apify Google timeouts. Across 18 candidates it used 149,591 input and 3,439 output tokens and verified six ages directly; one previously verified age brought the run to seven of 18. This is faster and more reliable than the timed-out actor path, but too expensive and incomplete to run before a cheap viability gate.
- Two social-first discovery experiments were rejected. Volleyball hashtag graph expansion returned 211 related accounts but was dominated by leagues, media, coaches, fans, and organizations. Broad Instagram keyword search returned 70 profiles and zero usable in-range public athlete profiles. Official sports-source discovery remains the primary candidate source.
- A malformed Unicode code point caused one Anthropic scoring rejection; prompt inputs are now sanitized and covered by regression tests. Researcher and Auditor scoring calls are fixed at temperature zero for repeatable benchmark comparisons.
- Discovery now stops when its evidence budget is met, reports every wave, caps paid identity enrichment at four candidates per requested finalist, and checks cancellation between enrichment batches.
- Unit, lint, type, and production build checks pass. Existing repository lint warnings remain, but there are no errors. Thirty focused research tests cover the V2 gates and regressions.
- The remaining positive-label gap is explicit achievability, pursue-today judgment, and an exact evidence cutoff or source archive for each of Dylan's 40. Approximate dates were preserved as text; the system did not manufacture exact timestamps.
- The blocking negative-data gap is 40 real early non-progressions. Dylan identified the dominant failure taxonomy as poor content first, unrealistic economics second, and under-21 eligibility third. Existing CRM feedback cannot fill the gap: it contains 31 `not_athlete`, two `not_usa`, and one `unlikely_convert` record that is also not an athlete. Those are research/identity failures, not commercial negatives.
- The OpenRouter credential is configured as a sensitive Preview and Production variable. The first production deployment created after the key was saved is ready. OpenRouter remains a separately versioned A/B lane, not invisible model routing. The measured identity experiment was rejected; scoring and blind audit remain pinned to the latest configured Anthropic Sonnet model.

## Next controlled sequence

1. Resolve the explicit outcome conflicts surfaced by the 100-case mailbox ledger, then complete achievability, pursue-today, public knowability, sport, and point-in-time source/cutoff fields. Do not assign approximate reconstructions to a benchmark split.
2. Add approximately 30–40 genuine hard negatives. The mailbox sample contains only three `Not a Fit` cases; `Possible Fit`, `Uncertain`, and right-censored `Stalled` records must not be relabeled as negatives.
3. Automatically assign only completed, point-in-time-usable labels to development and held-out splits, then freeze the temperature-zero Sonnet baseline.
4. Add a cheap pre-score viability selector over a larger official-source pool. It should prioritize adult-verifiable, identity-confirmed athletes with public creator/commercial signals before expensive age research and scoring.
5. Run the frozen baseline on the development split and fix its largest measured failure class one change at a time.
6. Use OpenRouter only for explicit, versioned challenger experiments such as lower-cost extraction or summarization. Promote a model only when it beats the frozen baseline on quality, cost, and latency.
7. Freeze the winning configuration, run the held-out split once, and then run evaluation-only sport requests until ten independently audited candidates pass. No records or outreach are created by these tests.
