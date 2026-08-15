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
3. The server freezes the selected case IDs plus the active approved weekly recruiting thesis in the run checkpoint. The thesis is sanitized, candidate-blind, content-hashed, and supplied unchanged to the Researcher and both Auditor stages. It defines current business priorities only: it is never candidate evidence and cannot satisfy identity, age, momentum, audience, creator, or commercial gates. Labels are not stored in that checkpoint or sent to a model.
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

The server refuses to create a held-out run unless its baseline is a completed full-development-cohort run from the same frozen cohort and every release threshold already passes. A four-case smoke test may authorize a full development calibration, but it can never unlock held-out by itself. The held-out run must reuse the development run's exact recruiting-thesis snapshot and hash. It also re-resolves the latest Sonnet before starting; if the exact model or provider route changed after development, held-out fails closed and development must be rerun against the new current model. The held-out run must cover the entire locked split and is accepted only when every selected record is locked and unrevealed. One completed held-out run reveals and exhausts that cohort; it then becomes archive-only. Development scoring resolves exactly one current locked, unrevealed Dylan-ground-truth cohort, and fails closed if no active cohort or conflicting active cohorts exist. Another release test requires a new frozen cohort. Never tune against held-out records.

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

## Current data status (2026-08-15)

### Verified v29 development baseline

Production commit `678b90d` deploys benchmark runner v29 with the application-owned maximum-priority-age ceiling and a mandatory qualified-fit calibration band whenever every deterministic evidence gate passes. The completed 16-case development replay `3cd5a04c-85ce-4f08-9a2c-dda0f61d440b` used `anthropic/claude-sonnet-5` through OpenRouter and cost $1.043. It produced five finalists, all true positives: 100% precision above 80, 93.75% fit/achievability audit-decision accuracy, 100% auditor catch rate, 100% finalist identity, 100% finalist 21+, 100% source verification, 100% point-in-time compliance, 100% finalist audit pass, and zero unsupported claims. Strong-fit recall was 62.5%.

This is a passing development baseline, not a held-out production proof. It replays records from an already revealed historical cohort. Do not run the visible one-time held-out control against that archive. A legitimate release still requires a fresh, locked, unrevealed 8-positive/8-negative cohort; the current fresh evidence blocker is the positive side.

### Authoritative live recovery checkpoint

The production benchmark UI currently exposes 28 fresh, labeled, never-scored records: nine positive and 19 negative. Eight negatives are evidence-ready and zero positives are evidence-ready, so the fresh 8+8 challenge cannot be frozen yet. These live counts supersede the older recovery counts retained below as chronology.

The rotated Social Blade credentials were authenticated in production on 2026-08-15. The health check reused a cached exact-handle profile, charged zero credits, and reported 71 credits remaining. The current positive blocker is evidence coverage, not Social Blade authentication. Nineteen distinct official profiles have been attempted, 13 returned a matched historical source, and exhausted/failed handles must not be retried merely to spend credits.

The closest positive records are Tayla Relph and Catarina Guimaraes (historical audience), Sara Fruncillo (historical audience plus creator behavior), and Daryn Harris (a second independent 21+ source). The remaining five positives have wider age, momentum, audience, or creator gaps. A bounded age-recovery replay for Daryn and Sara reused the paid Apify discovery checkpoint for zero new Apify spend but initially closed neither packet because the prior workflow had no grounded deep age-discovery lane and archive providers rate-limited some candidates.

Age-recovery query plan v7 added exactly one latest-Sonnet grounded search per athlete for direct, citation-bearing adult-eligibility sources. Its first Daryn/Sara production replay completed for 9,449 tokens / $0.0529, zero Apify cost, zero scoring tokens, and zero outreach writes, but closed 0/2 packets. The provider cited ten sources while the discovery metadata filter retained only one Daryn bout page and no Sara pages. Query plan v8 therefore recognizes multilingual age terms, rejects age-less event pages in the search instruction, and lets exact-name citations with thin titles reach the downstream archive extractor. Its measured replay retained nine candidate pages for $0.0547 and zero Apify/scoring/outreach cost, but still closed 0/2. Audit isolated a missing Italian stated-age pattern: Sky's strict dated article metadata is cutoff-safe and the article says “Sara Fruncillo ha 25 anni,” but extraction v19 did not parse that construction. Extraction v20 added only the present-tense, same-clause `ha N anni` form and reused the saved v8 citations for zero additional provider cost; production still rejected the Sky page. Extraction v21 added one bounded browser-header retry and exact secret-free diagnostics, proving that publication metadata and page retrieval passed but the sport gate did not recognize the page's `Formula Women`/`F2000` wording. Extraction v22 adds those unambiguous motorsport aliases. The safety contract is unchanged: the extractor must still prove matching sport, immutable pre-cutoff dating, explicit age text, and independent corroboration before readiness can change. Signal recovery retains its stricter metadata-level sport check and separate two-lane ceiling.

Query plan v9 spent 12,079 latest-Sonnet tokens / $0.061231 on one final Daryn/Sara grounded search, with zero new Apify, scoring, or outreach activity, and retained 11 candidate pages including Orticalab. The final recovery pass then fixed replay preservation, richest-checkpoint selection, bounded historical Common Crawl sampling, `www` lookup normalization, and per-source archive throttling without buying more discovery. Extraction v25 accepts only an attributable Italian appositive age such as `Sara Fruncillo, 26 anni`; regression coverage rejects the same phrase when it names another person. Production run `01b2b797-f963-4bab-a398-6c0d401f2262` reused the 11 saved candidates and spent $0 on new Apify, model, or scoring calls. It stored two independent cutoff-safe adult claims for Sara from `sky.it` and an archived `orticalab.it` capture, so her two-source 21+ gate now passes. The run processed 2/2 and retained 78 safe claims. It is recorded as failed only because two unrelated archive candidates hit bounded provider deferrals. Sara still needs historical audience plus creator-behavior evidence, while Daryn still needs a second independent 21+ source. Do not rerun this checkpoint unchanged.

Dylan's 100-case ledger remains the sole commercial ground truth: 44 positive and 56 negative. The current bounded audit loads 1,072 evidence sources and 2,155 claims, retains 1,657 cutoff-safe model claims, and finds 44 evidence-ready packets (17 positive / 27 negative) with 100/100 point-in-time compliance.

Two disjoint benchmark releases are complete and revealed, leaving 32 development, 32 held-out, and 36 excluded records. The newest held-out release `c990033d-38b0-4139-9d27-cd2dbd23bf38` passed identity, 21+, source, unsupported-claim, point-in-time, and audit-accuracy gates, but above-80 precision was 7/8 = 87.5%. The one miss was Murat Kazgan; his later negative outcome depended on inactive OnlyFans use that was absent from the pre-decision evidence packet. All revealed records are archive-only. Never tune against Murat or rerun either revealed held-out set.

OnlyFans platform activity is not observed in any of the 100 cutoff-safe packets (0 active / 0 inactive / 100 not observed). Missing platform evidence therefore stays neutral. A future weekly internal-intelligence record can supply a dated active/inactive contradiction when it was genuinely known before scoring, but the benchmark must not infer it from the outcome.

The older 12-positive / 24-negative excluded-pool count below predates later assignments and evidence audits. Use the authoritative 28-record live recovery checkpoint above for current execution. A new challenge release still requires at least eight evidence-ready cases per label. The positive side is the binding constraint; do not start another scoring benchmark until it closes.

Benchmark runner v27 now matches production's business-context contract: a development run snapshots the active approved weekly recruiting thesis, rejects candidate-specific guidance, and persists its exact SHA-256 content identity. Researcher and independent Auditor stages receive that same immutable context with an explicit warning that it is not evidence. Held-out can run only with the exact development snapshot and the same still-current latest-Sonnet route. Historical benchmark results above are unchanged; no revealed cohort was rerun or tuned.

The latest nine-positive recovery run examined 43 grounded candidates, inserted 74 archived sources / 232 safe claims, spent $0.0885 on Apify plus about $0.2562 on latest-Sonnet search, and yielded 0/9 complete packets. Social Blade is configured and has 71 credits remaining, but its official service can return historical rows only from the date a profile first entered Social Blade tracking. Nineteen distinct official lookups are checkpointed; 13 matched, six failed. Never retry a failed handle. New failures persist exact returned-handle and date-range diagnostics without credentials or account secrets.

The next valid sequence is:

1. Recover at least eight excluded positives using genuinely pre-decision evidence not already exhausted—prefer dated internal weekly-intelligence artifacts or source documents that explicitly state historical audience/activity.
2. Recover eight excluded negatives only after the positive quota is plausible; do not spend merely because negatives are easier.
3. Freeze a new 8+8 challenge cohort once, precommit any sport/achievability calibration before scoring, run full development, and unlock held-out only if development passes every release gate.
4. Run held-out once. If precision above 80 is below 90%, archive the cohort and do not tune against it.

## Recovery chronology (2026-08-13; retained for provenance)

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
