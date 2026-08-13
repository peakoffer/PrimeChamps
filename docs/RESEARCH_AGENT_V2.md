# Prime Champs Research V2

## Objective and safety boundary

Return up to ten evidence-backed athlete opportunities worth human review. A run is successful when every returned candidate passes every quality gate and has a corrected priority score above 80; returning fewer than ten is correct when the evidence does not support ten. Research never sends outreach, drafts, comments, or messages.

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

Priority is calculated deterministically from 45% fit, 35% achievability, and 20% confidence. A high value in one dimension cannot hide a weak one. Priority is capped below the finalist threshold when fit is below 80, achievability below 70, confidence below 80, a material claim is unsupported, or a critical gap remains. A Researcher proposal above 80 is held at 79 until the independent audit finishes.

## Golden benchmark

The initial benchmark is Dylan's 100-case source ledger:

- 44 positive examples: 41 signed and three approved but did not sign.
- 56 negative examples: 23 rejected and 33 stalled.

“Negative” means the opportunity did not work commercially. It does not mean negative news about the athlete.

For every record, preserve:

- Original decision date and evidence cutoff.
- The outcome-derived positive/negative ground truth.
- The original fit-at-the-time description as context only.
- Final outcome and primary reason.
- The pre-decision public evidence available to the research model.
- A short explanation and internal reference when available.

For future records outside Dylan's ledger, fit must be labeled before the outcome is reviewed whenever practical. Use `uncertain` rather than reconstructing a memory from hindsight. Records with unusable point-in-time evidence remain stored but excluded.

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
- Achievability is at least 70.
- Research confidence is at least 80.
- The athlete and personal account are identity-confirmed.
- Age 21+ is corroborated by two independent agreeing public sources. One authoritative source may block a minor or hold an adult, but can never qualify a finalist.
- Instagram is public and recently active.
- A meaningful audience meets the active minimum or the bounded exceptional-engagement rule.
- Current athletic momentum and creator potential each have an exact dossier URL and matching source excerpt.
- The blind Auditor independently confirms momentum, audience, creator potential, and complete commercial constraints.
- Material claims pass source verification.
- The independent audit passes or corrects the assessment.
- No critical gap remains.

The system never pads a result set to reach ten.

`qualityPassed` measures whether the returned subset cleared every gate; it does not fail merely because fewer than the requested number qualify. `targetMet` and `shortfall` report coverage separately.

## Metrics and iteration

The benchmark reports:

- Precision above 80 and recall of strong fits.
- False-positive rate.
- Fit and achievability accuracy.
- Identity, eligibility, source-verification, and point-in-time compliance rates.
- Unsupported-claim rate and Auditor catch rate.
- Cost, latency, and token usage.

Each experiment changes exactly one major dimension: source, query strategy, prompt, rubric, model, audit rule, or score weighting. Keep a change only when development metrics improve without degrading the locked held-out split. Do not tune against held-out examples.

The one-time held-out endpoint is server-locked until a complete development run from the same cohort passes every release gate. Citation IDs alone are insufficient: benchmark material claims require exact dossier quotes, semantic overlap, and a second-stage Auditor check. Review scores are hard ceilings across all three dimensions and can never inflate either the Researcher or blind Auditor.

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

## Current production checkpoint — 13 August 2026

- The source-backed finalist gate began at `1763655`; the Social Blade adapter landed at `37bff04`, and archive retry throttling at `3efd01b`. Always confirm the current `main` deployment is READY before resuming paid work rather than treating an older hash in this document as authoritative.
- Research prompt `research-v10-corroborated-identity-and-21-plus-gates` is active. Production scoring resolves the latest Anthropic Sonnet dynamically; the 12 August smoke run resolved `claude-sonnet-5`.
- A proposed priority above 80 remains 79 until audit. The final score is the minimum of the Researcher dimensions, blind-Auditor dimensions, and review correction, followed by objective guardrails.
- Finalists now require deterministic source matches for current momentum and creator behavior, a meaningful measured audience, commercial achievability of at least 70, complete commercial constraints, zero unsupported material claims, and an independent audit.
- Evaluation mode is regression-checked to exit before athlete inserts and to suppress notifications. The research workflow contains no message, draft, or outreach-table writes.
- Type checking, focused lint, 86 unit tests, and the Vercel production build pass. The live root redirects to login and the login page returns 200.
- Dylan's enriched 100-row workbook was locked against the original source and imported with exact `41/3/23/33` outcomes. It added 420 pre-decision detail sources/claims across 76 athletes with zero future claims or eligible outcome-like leakage.
- The corrected readiness audit reads all evidence in bounded batches and, after archive-signal attribution hardening, finds 28/100 freeze-ready cases. The fresh excluded pool is `0 fit / 16 not-fit` ready. The negative side of the new cohort is complete; the remaining dependency is 16 cutoff-safe positive cases.
- Historical archive recovery now has two free, bounded fallbacks. Wikipedia candidates use MediaWiki's revision API to retrieve exactly the latest article revision at or before the evidence cutoff; other URLs can use at most two pre-cutoff Common Crawl collections and one indexed WARC byte range. Both paths run the same exact-person/sport/date extractor, store provider-specific provenance, reuse saved Apify discovery checkpoints, and never substitute for Social Blade's historical Instagram metrics. A Wikipedia revision is one source, not two independent corroborations.
- The first versioned Wikimedia recovery exposed two real compatibility gaps: Dylan's `Football / soccer` label and ESPN's attributable `Name [pronouns], age, verb` editorial syntax. Both now have narrow regression coverage. The final zero-new-spend replay gave Lola Gallardo eight independent sources, 30 run-safe claims, two-source identity, two-source 21+ corroboration, momentum, and creator behavior. The later attribution audit correctly left her blocked only on historical audience. No model tokens or live pipeline writes were used.
- Bounded run `7f507de9-7d8e-47ff-870b-9a37629bb64e` closed the three-case negative gap for $0.0185 by making Murat Kazgan, Christen Press, and Sadio Doumbia evidence-ready. No more negative recovery is warranted.
- The archive attribution audit quarantined 95 material signal claims that were not explicitly tied to the named athlete. The idempotent follow-up audit finds zero remaining claims in that class. After three additional exact-handle archive packets, current global state is 1,203 safe claims and 910 sources with 100/100 point-in-time compliance; sources remain preserved for provenance.
- A five-handle Common Crawl/Wayback check and the community `gordian/instagram-profile-history` Actor produced no usable cutoff-safe audience snapshots. Diagnostic Actor run `pSDkS9ZAuBh9nNglv` returned zero rows at $0.0000. That experimental product surface was removed; Social Blade remains the only bounded historical-audience lane with an explicit upstream contract.
- Bounded evaluation-only volleyball smoke run `6c898a22-c961-4612-8c5b-7dd14517c2a3` completed safely: 44 sourced, six admitted discoveries, four scored, and zero finalists. Its best score was 79, no blind audit was eligible, and it created zero live athletes or notifications. See `docs/RESEARCH_V2_CLAUDE_HANDOFF.md` for the full checkpoint and next actions.

## Implementation history through 11 August 2026

- V1 discovery, identity, eligibility, activity, scoring, and durable execution have been strengthened and retained.
- The V2 schema is live in Supabase with server-only privileges and RLS enabled.
- Dylan's 40-athlete commercial-positive deliverable was imported on 10 August 2026. Five records were merged with the original seed and 35 were added. All 40 are labeled `fit + signed`, linked to 14 existing athlete records, and remain safely excluded with `partial` point-in-time reliability because the dates and commercial reasons were reconstructed after the outcome.
- Dylan's updated 100-opportunity mailbox benchmark is the authoritative outcome ledger. `Signed` and `Approved but Did Not Sign` map to positive; `Rejected` and `Stalled` map to negative. The resulting benchmark contains 44 positives and 56 negatives. The earlier `OnlyFans fit at the time` field is retained as source context but does not override the outcome label.
- Reconciliation is source-authoritative and idempotent. Dylan's workbook replaces older contradictory seed labels while retaining the older internal reference for audit history; stale conflict and commercial-class tags are removed.
- The importer preserves the previously revealed cohort assignments: 16 development, 16 revealed held-out, and 68 excluded. The revealed 32 must never be reused as release proof; the next fresh cohort is built only from evidence-ready excluded records. No further subjective fit-labeling exercise is required.
- The controlled production import contains all 100 rows, 100 dedicated mailbox evidence sources, and 300 normalized claims. No internal outcome claim is eligible for model scoring. The 33 stalled records are negative ground truth, not censored records, and 20 records remain queued for sport enrichment instead of receiving invented classifications.
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
- Unit, lint, type, and production build checks pass. Existing repository lint warnings remain, but there are no errors. Fifty-nine focused tests cover the research gates and regressions.
- The 44/56 outcome split closes the positive/negative label-count gap. The remaining benchmark work is input-side: sport completion and dated public evidence available by the historical decision cutoff.
- The OpenRouter credential is configured as a sensitive Preview and Production variable. The first production deployment created after the key was saved is ready. OpenRouter remains a separately versioned A/B lane, not invisible model routing. The measured identity experiment was rejected; scoring and blind audit remain pinned to the latest configured Anthropic Sonnet model.

## Next controlled sequence

API-backed evaluation now has three explicit budgets. `smoke` is the safe default and requests three finalists from one eight-candidate discovery wave with no more than six Instagram enrichments. `development` runs the full ten-candidate target with two waves and up to forty enrichments. `release` is the only three-wave profile and is reserved for a frozen configuration. These limits are stored with every run; evaluation mode still creates no athletes, notifications, drafts, or outreach.

Paid enrichment uses a two-thirds fresh / one-third remembered mix when both lanes are available, preventing old candidate memory from monopolizing a new sport run. Each evaluation profile also caps researcher input/output tokens and the number of candidates eligible for the independent audit.

Age verification now starts with one batched Apify Google run per five-candidate scoring batch. Only unresolved names reach OpenAI age search. The broad Apify dossier lane remains off by default, so age verification gains a cheap fallback without automatically buying four research queries per candidate.

If a scoring provider fails for every enriched candidate, the run retains its paid enrichment checkpoint. A corrected deployment can fork from that checkpoint rather than repeating discovery and Instagram work.

Completed-run re-score forks rebuild full dossiers from `research_candidates.raw_candidate`; the compact history summary is never treated as a scoring input.

1. Re-import Dylan's 100-case source with its deterministic 44-positive / 56-negative outcome mapping, then finish sport enrichment and leakage-safe public evidence packets.
2. Automatically assign only evidence-ready outcome labels to development and held-out splits, then freeze the latest-Sonnet baseline. Determinism comes from pinned model/version metadata, strict schemas, deterministic score caps, and repeated benchmark measurement; newer Sonnet APIs may reject legacy sampling parameters.
3. Add a cheap pre-score viability selector over a larger official-source pool. It should prioritize adult-verifiable, identity-confirmed athletes with public creator/commercial signals before expensive age research and scoring.
4. Run the frozen baseline on the development split and fix its largest measured failure class one change at a time.
5. Use OpenRouter only for explicit, versioned challenger experiments such as lower-cost extraction or summarization. Promote a model only when it beats the frozen baseline on quality, cost, and latency.
6. Freeze the winning configuration, run the held-out split once, and then run evaluation-only requests across sport archetypes. Return up to ten independently audited candidates per request; never manufacture ten when fewer qualify. No records or outreach are created by these tests.
