# Prime Champs: economical research release plan

Prepared September 24, 2026. Execution approved; Phase A safety/accounting checkpoint is being implemented. The original proposal below remains the acceptance plan, not a claim that every item is complete. See [the implementation checkpoint](research-release-checkpoint-2026-09-24.md) for verified changes, remaining blockers, and actual spend.

## Decision

Finish the common reliability and accounting repairs first, use saved provider responses to work through bugs, then purchase a finite set of independent live confirmations. Start supervised production use in validated sports as soon as their release checks pass. Broader availability follows the remaining archetype results.

Proposed remaining-work allowance: **$75 maximum in paid research APIs**, with a **provisional $40–65 planning target**. This is an allocation, not a price guarantee. Current accounting omits some calls, so the first metered canaries must confirm or revise the forecast. Developer time, existing hosting/database subscriptions, and ordinary future customer research are outside this API-test allowance.

The existing campaign's $79 reservation and $100 authorization remain recorded. This plan does not silently reset that ceiling or authorize another $75 of spending. Reconcile the old campaign first; use any demonstrably available authorization for applicable remaining tests, and present the net additional allowance when execution is authorized. Unknown charges remain reserved. No fresh campaign may conceal cumulative spending.

Keep the latest Sonnet authoritative and the latest standard-speed Opus as an independent challenger. Retain every evidence and safety requirement. Savings come from avoiding duplicate retrieval, whole-run retries, and unnecessary experiments.

## 1. Starting point and findings

The September 24 status check confirmed production and GitHub main at `c611b89`, a responding production login page, and no recorded runtime errors over the prior seven days. No research run was created after August 23. A quiet runtime log does not establish fresh research-provider health.

The August campaign completed 42 cases, scored 270 candidates, stopped 138 CRM duplicates, and estimated 552 paid calls avoided. Twenty cases passed; the campaign also retains historical failures, source gaps, two unstarted motorcycle controls, and three unresolved defects in its summary. A legacy volleyball evaluation still says running despite its last heartbeat being August 7.

The existing report records $14.33 of model usage and estimates $38.39–$63.26 all-in. **That all-in estimate is not a verified upper bound.** Code review found omitted OpenAI identity calls, fallback calls, post-repair/profile requests, OnlyFans lookups, and some failed model attempts. Some model costs are calculated from usage and prices rather than settled provider billing.

| Finding | Consequence | Required response |
|---|---|---|
| Completed case cost is the greater of model cost or a flat $1/$2 reservation | Campaign accounting can differ from real provider exposure | Record and settle individual operations, including failures |
| Parallel runs receive the same remaining campaign allowance; the primary workflow does not enforce that dollar field at each call | Existing admission checks do not establish a strict aggregate spending ceiling | Atomically reserve before each paid request |
| Scoring and independent audits run in one long durable step | Two recent controls reached the 800-second limit | Break work into bounded, independently checkpointed operations |
| Apify run IDs are returned only after completion; local polling timeout does not stop the actor | A retry can launch another paid actor while the first still exists | Persist the actor ID immediately and resume it |
| The audience precheck discards profile data that enrichment retrieves again | Repeated purchase of the same profile | Reuse the captured profile when identity and freshness agree |
| `heldOutPrecision80Plus` is calculated as finalists / high-score proposals | Audit retention is being confused with independent accuracy | Rename it and source true precision from labeled benchmark evidence |
| A result with fewer than eight exact people is called source exhausted | A small or failed query can look like proof that the sport lacks prospects | Use inconclusive until two independent investigations justify exhaustion |
| Opus evidence is sliced to its first 12 entries; audit validation checks count only | Relevant contradictions can be omitted; duplicate IDs can mask missing audits | Preserve gate evidence and verify exact audit-ID coverage |
| Profile validation accepts owner-posted aggregate metrics | The activation decision can lack linked experiment evidence | Require server-derived validation; keep the feature inactive meanwhile |

These are code-review findings and proposed fixes. They do not mean every risk caused an observed charge or unsafe result.

## 2. Fixed operating rules

- Evaluation runs cannot create or mutate athletes, notifications, drafts, messages, queues, appointments, contracts, conversations, or pipeline positions. This includes updates, upserts, and deletes of existing live rows. Assert this through executable tests and production isolation queries; do not infer it from a report field hardcoded to zero.
- Fresh CRM lifecycle memory is required at the beginning of every run and before candidate-specific paid work. Verified aliases and owner overrides retain their audit trail. Previous evaluation candidates do not become CRM exclusions merely because a test saw them.
- Exact identity, correct sport, two independent sources establishing 21+, current athletic momentum, measured audience, creator evidence, public contact route, and supported material claims remain required for finalists.
- Every finalist receives the independent Sonnet audit and Opus challenge. Opus also reviews up to two strongest rejected or blocked candidates per case. An unresolved unsafe-finalist or missed-strong-fit finding blocks release of the affected case.
- No scoring-model downgrade, Fast route, shortened evidence requirement, inferred gender, or padded finalist count. Zero finalists is valid when the evidence supports it.
- At most three concurrent research runs. Paid concurrency starts at one until the accounting and first canary are verified. Provider limits apply across concurrent runs, not independently per run.
- Resolve current model IDs and prices before the campaign, record the route, and pin it per experiment. Recheck before each wave. A changed route creates a new versioned comparison; it never silently changes the model halfway through a result.

## 3. Phase A: repairs and executable replay before paid testing

### A1. Account for and bound every paid operation

Add an organization-scoped operation ledger linked to campaign, case, research run, and candidate or batch. Record stage, provider, exact model/actor version, normalized input hash, evidence hash, prompt/rubric version, operation key, request/run ID, status, reserved maximum, observed usage, settled charge, and timestamps.

Admission must atomically enforce:

`settled charges + unsettled reserved exposure + new worst-case exposure <= campaign allowance`

Apply the same check to the case allowance. A unique operation claim prevents two workers from buying the same work. Retried calls consume their own exposure; duplicate settlement of the same provider request cannot double-count it. Do not treat a missing price or missing bill as zero.

Use provider-reported charges where available; otherwise retain a conservative reservation plus a clearly labeled usage-based estimate. Record usage before parsing model output so malformed responses still count. For Apify, persist the actor run ID immediately, poll/read that run on recovery, and settle failed or cancelled runs too. A dataset download limit is not a spending limit: validate each actor's actual billing controls and minimum charge. Do not admit an operation whose maximum exposure cannot be bounded under the campaign policy.

If a provider accepted a request but its response was lost, do not promise exactly-once billing. Use provider idempotency where supported; otherwise hold the reservation and reconcile the ambiguous request before retrying it. Explicit cancellation aborts resumable actor work where supported and records any charges already incurred.

### A2. Bound workflow steps and recover stale work

Keep the existing discovery, enrichment, scoring, audit, and persistence design. Extract fixed candidate/batch steps rather than rewriting the engine:

1. Freeze the eligible candidate IDs and evidence versions.
2. Perform bounded evidence gathering and save its response.
3. Score a candidate or a small fixed batch; save usage and result.
4. Independently audit a candidate or a small fixed batch; save usage and result.
5. Run bounded Opus audit batches, then finalize the case.

Start with a target below 300–400 seconds per step; enforce a deadline comfortably below the 800-second platform limit. If a batch does not fit, split it without reducing evidence depth. Check cancellation, terminal run status, and budget immediately before every new paid request.

Extend stale recovery to all organization-scoped evaluation runs, including legacy runs without hardening cases. Retain the 20-minute no-heartbeat cutoff. The cancellation update itself must recheck that cutoff so a newly heartbeating run cannot be cancelled by a stale read. Reconcile related cases afterward. Preserve old records and resolution notes rather than deleting history.

Separate execution status (queued/running/paused for budget/finished) from release verdict (unvalidated/passed/needs fix/source limitation). Pending rows must not hide the latest completed proof. Campaign creation must accept explicit selected sports and stages; a confirmation-only or targeted campaign must not automatically insert 13 new smoke runs.

### A3. Reuse evidence without invalidating tests

- Retain the full Instagram profile from the audience precheck and use it during enrichment when stable identity, provider version, requested fields, and capture freshness match. Fetch only genuinely missing activity.
- Reuse saved discovery responses, source captures, and completed compatible scores/audits while debugging. A changed model, prompt, rubric, evidence packet, or relevant policy invalidates the affected model result.
- Refresh lifecycle exclusions on every run. Do not reuse a historical CRM snapshot as current business state.
- Define freshness by claim type. Stable identity/birth-date evidence can remain reusable subject to source integrity; audience, profile privacy, active contact routes, platform status, and momentum need explicit freshness rules. A missing or expired value becomes a hold or a targeted refresh.
- Apply existing known-under-21 and deterministic rejection gates before optional platform checks. Move OnlyFans lookup later only if before/after dossier replay shows that authoritative scoring and required gates remain equivalent; otherwise meter and retain it.
- Add campaign-owned component replay for enrichment, scoring, and audit. Existing generic replay APIs intentionally reject hardening-linked runs and must not be bypassed.
- Cached replay is development evidence. A release confirmation must perform fresh discovery and current provider retrieval for its bounded candidate pool; preserve that distinction in the scorecard and reports.

### A4. Correct audit and metric semantics

Replace first-12 evidence truncation with a packet retaining every required gate citation and material contradiction, with canonical source IDs. Compact duplicate text only. Require exactly one audit per expected candidate ID, no duplicates, no missing IDs, and references limited to evidence in that candidate's packet.

Display audit retention separately from true labeled precision. A missing denominator is unavailable, never a pass. Report cost per sourced, novel, scored, and finalized candidate; if there are no finalists, cost per finalist is unavailable and the spent amount is still shown.

Disable the ability to mark a profile validated through supplied aggregates alone. Activation requires a linked completed server-evaluated comparison and explicit owner activation. Real meeting-derived guidance stays inactive for this baseline release.

### A5. Build a useful free regression suite

For each of the 13 archetypes, create three sanitized fixtures: a valid dossier, an ordinary evidence hold, and a sport-specific identity/eligibility trap. Use recorded provider payloads where available. Clearly mark synthetic fixtures; they test behavior and never count as discovered athletes or accuracy evidence.

Run the production parser, eligibility gates, candidate ledger, scoring-response parser, audit parser, and persistence logic against these fixtures with network access denied and attempted live CRM writes rejected.

Add shared executable cases for:

- Every CRM stage, signed/contacted/rejected athletes, changed handles, provider IDs, name collisions, missing handles, and audited overrides.
- Under-21, single-source age, copied articles pretending to be independent sources, conflicting ages, wrong person/sport, retired athletes, team/brand/private accounts, international names and non-English sources.
- Provider 400/401/403/429/5xx, timeouts, malformed output, omitted or repeated audit IDs, unsupported 80+ claims, and long valid responses.
- Crash after provider acceptance, after provider response, after score save, and after audit save; cancellation at each boundary; two workers claiming the same operation; concurrent budget reservations; heartbeat race; exhausted budget.
- Forty meetings with stale, conflicting, repeated, and sport-scoped signals; at most 12 active signals, three/category, 1,200 prompt tokens, 20% exploration, and contextual adjustment no greater than ±5. A base score below 80 cannot become finalist-eligible through context.

Every fixed defect must first fail a regression fixture and then pass after its repair. Tests must count provider invocations and state changes; source-text regex assertions alone are insufficient.

**Exit:** required local checks pass; fault-injection demonstrates bounded retries, correct accounting, preserved evidence, no unintended CRM writes, and completed-work reuse. Deploy this release before starting paid tests.

## 4. Phase B: small discovery investigations for the six weak categories

Inspect saved queries and provider responses first. For each failure, identify query miss, provider/access failure, parser loss, identity ambiguity, genuine evidence gap, or budget exhaustion. Each paid probe must name the uncertainty it will resolve and its stop condition.

| Archetype | Targeted investigation | Evidence needed before premium work |
|---|---|---|
| Climbing | Competition/discipline results and federation/event profiles; separate athletes from gyms and personalities | Exact athlete and current sport participation |
| Adaptive track and field | Para-athletics terminology, event/classification and national federation sources; remove duplicated query terms | Exact sporting identity; do not collect unnecessary medical details |
| Esports | Named games, professional rosters/results, stable player IDs, gamer-tag-to-person corroboration | Competitor rather than streamer/team, exact person, age evidence path |
| Equestrian | Discipline-specific athlete/results records | Rider identity distinct from horse, owner, trainer, and club |
| CrossFit | Official competitor profiles/leaderboards and current season | Competitor distinct from gym, coach, and generic fitness account |
| Skiing | Discipline-specific current-season results and national-language searches | Exact athlete and correct skiing discipline |

Use the existing OpenAI discovery and Apify search/profile tools. Verify official source pages read-only before adding query templates. No new annual data contract or speculative scraper subscription belongs in this release path.

Budget at most $1 per category for the initial discovery-only probe. After one failed probe, fix the identified query/parser problem offline or use one explicitly different source hypothesis within the same allowance. Do not repeatedly buy the same empty query.

Do not buy Sonnet/Opus scoring until a candidate clears the unchanged pre-scoring requirements. A probe can establish whether evidence is available without purchasing every downstream stage. Record unique exact people per paid query and how many existing CRM identities were suppressed.

Source exhaustion requires at least two independently designed bounded attempts plus documented provider/query investigation. A capped or broken search remains inconclusive. Exhaustion may justify a limited-support outcome; it does not establish productive all-sport coverage.

## 5. Phase C: freeze the release and perform fresh confirmations

Pin release commit, models/routes/prices, prompts/rubric, provider schema versions, baseline profile, test depths, and planned query families. Run IDs, evidence hashes, budget and exclusion snapshots must be recorded. Resolve old benchmark/current-model compatibility before treating historical scorer proof as current evidence.

The first three fresh cases are **soccer, figure skating, and skiing**: a known working discovery route, an age-sensitive category, and a weak category repaired in Phase B. They count toward the 13 confirmations and are not extra smoke purchases. Start one at a time; after all three are clean and measured, allow up to three concurrent runs.

Then complete the remaining canonical matrix once at full release quality:

| Archetype | Required canonical sport | Special check |
|---|---|---|
| Team | Soccer | Active player versus alumni/coach; shared names across leagues |
| Combat | Boxing | Boxing versus MMA, precise record and adult evidence |
| Judged | Figure skating | Senior competition does not prove 21+; current versus retired |
| Endurance | Cycling | Road/track/MTB/BMX identity and correct taxonomy |
| Racquet | Tennis | Stable player identity; junior versus adult; doubles athletes |
| Motorsport | Motocross | Rider versus driver; repeated race numbers and junior classes |
| Water | Swimming | Individual versus club/team; event/class and adult evidence |
| Winter | Skiing | Discipline, current season, non-English identity sources |
| Strength | CrossFit | Actual competitor and current competition evidence |
| Action | Climbing | Correct discipline and current athletic evidence |
| Precision | Equestrian | Rider versus horse/owner; stable athlete identity |
| Adaptive | Adaptive track and field | Exact athlete/event/classification and source coverage |
| General/boundary | Esports | Gamer tag mapped to exact person, game and professional activity |

Run the four distinct regression controls once on the final common code: **volleyball, surfing, gymnastics, motorcycle racing**. Surfing cannot substitute for swimming, nor gymnastics for figure skating.

Retain the required additional independent replicate for **adaptive track, equestrian, skiing, and esports**. Run an extra replicate for any verdict mismatch or more than 50% scored-yield variation. Compare runs with the same requested depth and relevant frozen versions; define variation as `abs(a-b)/max(a,b,1)`. Two zero-yield results are not proof of useful discovery and still need the source-gap investigation.

An older smoke counts toward a smoke-plus-confirmation or third-run requirement only when the relevant code/model/prompt/evidence rules are compatible and documented. Otherwise it is development history, and the missing fresh replicate remains open. Do not relabel an extra run as a third independent validation when two valid predecessors do not exist.

### Rules for bug-fix reruns

| Change | Free verification | Paid verification |
|---|---|---|
| UI labels/status presentation | UI/API fixture and existing persisted rows | None unless the user flow changes |
| Sport-specific parser/query | Affected source fixtures plus all shared gates | Affected archetype and one relevant clean control |
| Candidate evidence extraction | Before/after saved source packets | Only changed retrieval/evidence stages, then fresh affected confirmation |
| Scoring/audit parser | Recorded model outputs including adversarial packets | Model replay only if model interaction changed |
| Scoring prompt/rubric/model | All compatible dossier regression cases | Changed model stages and affected fresh confirmations; new independent held-out proof if prior proof is no longer compatible |
| Shared identity/age gates or workflow/accounting | Full frozen suite and crash/concurrency tests | Representative canaries, then every affected final confirmation |

Always persist the hypothesis, reproduction, patch, tests, affected scope, old/new evidence, incremental cost, and closure rule. A later unrelated athlete passing does not resolve an earlier candidate-specific defect. Reproduce the original defect with the corrected code and close it with evidence.

Do not rerun the entire matrix after a narrow fix. Equally, do not preserve old passes when a shared gate or model change invalidates them. If that consumes the allocation, report the remaining unverified scope explicitly.

## 6. Proposed budget and admission schedule

| Work | Quantity / planning limit | Maximum allocation |
|---|---|---:|
| Accounting, runtime, metric fixes; frozen fixtures | Local tests and read-only reconciliation | $0 research API spend |
| Weak-category discovery diagnostics | Six categories, up to $1 each | $6 |
| Changed-model-stage regression | Selected saved dossiers; no rediscovery | $3 |
| Fresh canonical confirmations, including the three canaries | Thirteen, provisionally $3 each | $39 |
| Distinct final clean controls | Four, provisionally $3 each | $12 |
| Mandatory extra weak-category confirmations | Four, provisionally $3 each | $12 |
| Additional instability/fix confirmation | Contingency | $3 |
| **Total** | **Paid research APIs only** | **$75** |

Reserve the canonical confirmation allocation in the execution plan before admitting diagnostic work. Protect the final **$15** for the four mandatory extra confirmations and contingency; ordinary work may use up to **$60**. Represent this explicitly in the scheduler so a simplistic stage check cannot strand planned confirmation work. Correct the current `>=` refusal at the ordinary stop so exactly $60 is allowed while the protected $15 remains unavailable to ordinary work. Cases enter only if their worst-case in-flight exposure fits both their allocation and the campaign cap.

The $3 per-run figure is an initial allocation. It must not silently truncate evidence or token output and then call a run full-quality. After the first fully metered run, calculate `remaining cases × conservative observed run cost + unresolved exposure + reserve`. Reallocate genuine unused allowance where appropriate. If this cannot fit $75, pause before the next purchase and produce the specific additional scope/cost requirement or a narrower validated release. Completing the entire matrix for $75 is a target, not guaranteed.

Do not release reservations based solely on the old $38–63 estimate. Reconcile actual request IDs and charges, distinguish settled cost from usage estimates, and keep uncertainty visible. The previous $20 reserve could not even admit 13 confirmations at the old flat $2 reservation; the new plan allocates the full wave explicitly.

No wholesale batch-API integration, model shopping, or new provider belongs on the critical path. Compatible native caching may save later, but no assumed cache/batch discount is used to justify this budget. Standard-speed routes are mandatory.

## 7. Statistical and release acceptance

### What we can claim now

The separate historical benchmark has a completed 16-case held-out release with eight correct finalists and no false positives. Preserve that dated result. The cohort is revealed and cannot be used again as fresh held-out proof. The live hardening campaign's four historical finalists are a different sample.

Eight out of eight gives a 100% observed precision estimate on that small benchmark; it does not establish at least 90% precision across all sports. Repeated tests of the same athlete do not add independent evidence. Collect independent owner-reviewed finalist labels during supervised use, with decisions recorded against the evidence available at the time. Do not tune against a revealed release set.

Retain the existing at-least-90% held-out point-estimate criterion, report its numerator/denominator and uncertainty, and verify its compatibility with the release model/rubric. If a material scoring change requires a new holdout and enough untouched evidence-ready labels are unavailable, keep broad accuracy certification open rather than reusing the revealed set. Do not introduce an unrequested statistical-confidence threshold as a new blocker.

### Release gates

| Gate | Required result |
|---|---|
| Cost | Every paid request admitted through the ledger; no unknown charges treated as zero; total exposure within approved allowance |
| Durability | No manual recovery or stranded current runs in confirmations; completed paid work reused; no 800-second step exhaustion |
| Safety | Zero wrong-person/wrong-sport/known-under-21 candidates reaching prohibited stages; zero unsupported material finalist claims |
| Audit | Full finalist Sonnet/Opus coverage; strongest reject checks; no unresolved safety or missed-strong-candidate findings |
| Coverage | All 13 canonical sports have explicit final outcomes; ≥8 exact candidates and ≥1 through scoring, or a documented source investigation/limited-support classification |
| Repeatability | Required independent runs completed on compatible versions; instability investigated rather than averaged away |
| Isolation | Signed-in evaluation flow and database audit prove zero prohibited CRM/outreach writes |
| Verification | Typecheck, lint, unit/integration tests, build, migrations/RLS checks, Supabase advisors and Vercel health reviewed; authenticated research UI verified |
| Evidence | Each finalist has complete supported gates and source references; fewer than ten or zero finalists is allowed |

Provider failures must stay below the original 5% target, with zero unresolved repeated failures. Report numerator, denominator, transient retry count, and terminal failures separately so retry successes cannot conceal an unreliable provider. Pause affected paid work after repeated failure. A known CRM athlete reaching candidate-specific paid work without an audited override, wrong-person/wrong-sport scoring, an age breach, unsupported finalist claim, unintended live mutation, or model-route change freezes all new paid admissions immediately. Request cancellation of unsafe in-flight work and retain its cost exposure. Establish the scope of the problem before resuming proven-unaffected work.

### Staged availability

1. **Supervised baseline pilot:** common repairs, free safety suite, signed-in isolation verification, and fresh final confirmation in the allowed sports pass. Every returned athlete is reviewed by the owner. Guidance and automated promotion/outreach remain inactive. This is the earliest useful production milestone.
2. **Cross-sport baseline release:** all canonical cases and required repeats pass or clearly disclose validated source limitations. Do not describe a category with unresolved discovery/scoring coverage as fully verified.
3. **Meeting-guided release:** separate validation below; it does not delay the baseline research launch while inactive.

The first owner pilot should reuse an already-paid final production evaluation for UI review where possible. A subsequent genuinely new research request is normal operating work with its own explicit run allowance, not a hidden extra test charged beyond this plan.

## 8. Meeting guidance: prepare now, activate separately

Complete the forty-meeting compiler tests, evidence-versus-instruction separation, neutral conflict handling, expiration/reinforcement rules, 80/20 allocation, and ±5 contextual ordering checks offline during Phase A.

Before activating an actual meeting-derived profile:

1. Require approved observations and a bounded draft with prompt-size preview.
2. Compare baseline/guided selection on the same frozen candidate pool and provider snapshots, with identical exclusion memory. This measures ranking/selection effects with little or no retrieval spend.
3. Measure discovery effects separately with live paired inputs/query budgets when guidance changes discovery. Shared cached inputs alone cannot prove improved live yield or costs.
4. Use server-derived experiment metrics and independently labeled precision; missing samples yield insufficient evidence.
5. Preserve the prior activation gates: no safety regression, no more than 20% scored-yield decline, no more than 25% cost-per-scored increase, exploration at least 15% with a configured 20% allocation, and no lower held-out 80+ precision.
6. Owner explicitly activates the validated version. Otherwise the baseline stays active.

This paid activation experiment is deferred from the $75 baseline allowance until a real approved draft is ready. It is a separate acceptance milestone, not removed from scope or represented as complete.

## 9. Implementation sequence, evidence, and handoff

| Release | Deliverables | Exit proof |
|---|---|---|
| 1: accounting and recovery | Operation ledger, actor resume, atomic budget/cancellation, malformed-attempt usage, truthful campaign status | Concurrency/crash/budget tests; no paid tests until passing |
| 2: bounded research and trustworthy audits | Small durable steps, profile reuse, gate-evidence preservation, exact audit coverage, corrected metrics, guarded profile activation | All 13 frozen fixtures plus shared adversarial suite; full local check |
| 3: targeted source repair and validation controls | Six category query/parser improvements, explicit case manifest, campaign-owned stage replay, paused-budget handling | Saved-response regression, capped source probes, three fresh canaries |
| 4: frozen release candidate | Complete canonical confirmations, four controls, mandatory weak repeats, targeted defect closure | Signed-in scorecard, isolation queries, reconciled cost, canonical coverage report |

Do not start broad paid testing between unrelated code edits. Deploy each tested shared fix once, freeze the relevant version, and reuse canaries/control runs toward the final matrix when their versions remain valid.

Engineering estimate: **2–4 focused working days** for repairs and the first useful supervised milestone, depending on replay coverage and provider behavior. A complete fresh test wave then takes several hours of elapsed provider time; weak-source investigation, missing held-out evidence, or budget constraints can extend broader certification. This is a planning estimate, not a completion promise.

Produce a machine-readable execution manifest and Markdown release report with: commit/model/profile/prompt/rubric versions; canonical versus control sport; test mode (fixture/component replay/fresh live); predecessor validity; stage counts and rejection reasons; cost settled/estimated/reserved; paid calls avoided; defects and exact confirming evidence; provider failures; isolation query results; and final release scope.

Every test must have a named question and a decision attached. An inconclusive test does not automatically trigger another paid run. The next run is admitted only after identifying what will change and what result would close the issue.

## 10. Implementation references

- `dashboard/src/app/api/research/run/workflow.ts`: scoring/evidence/audit boundaries, duplicate profile retrieval, optional checks, usage capture, cancellation guards.
- `dashboard/src/lib/apify.ts`: actor start/poll/resume, billing metadata, actor-compatible charge controls.
- `dashboard/src/lib/research/hardening-service.ts`: admission, case selection, snapshot pinning, summary/metric semantics, stale recovery and defect reconciliation.
- `dashboard/src/workflows/research-hardening.ts`: case orchestration and continuation after budget/single-case failure.
- `dashboard/src/lib/research/hardening.ts`: verdicts, canonical matrix, controls and budget policy.
- `dashboard/src/lib/research/hardening-cost.ts` and `hardening-report.ts`: truthful settled/estimated/reserved cost and measured isolation reporting.
- `dashboard/src/lib/research/hardening-shadow.ts`: complete evidence packets, exact audit set and citation validation, replay-safe Opus calls.
- `dashboard/src/lib/research/evaluation-runs.ts`: safe integration of existing component replay with campaign accounting.
- `dashboard/src/lib/research/sport-strategy.ts`: targeted weak-category sources, terminology and parser fixtures.
- `dashboard/src/app/api/research/intelligence/profile/route.ts` and `statistical-learning.ts`: server-derived validation and insufficient-evidence handling.
- `dashboard/tests/research-hardening.test.ts`: supplement policy/string tests with executable provider/persistence failure fixtures.
- `docs/research-hardening-release-report.md`: August campaign checkpoint and unresolved acceptance items.
- `docs/research-v2-benchmark-runbook.md`: authoritative labels, point-in-time rules, held-out history and anti-leakage contract.
- Installed `workflow/docs/foundations/idempotency.mdx` and `errors-and-retries.mdx`: replay and retry behavior used in this plan.

The old `docs/research-agent-process-map.md` includes dated prices, a $50 ledger reference and an OnlyFans lookup-order description that no longer match current code. Update that document with measured behavior and current configured campaign amounts during implementation; do not use it as a current invoice or guarantee.
