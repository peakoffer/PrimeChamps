# Production Research Memory and Statistical Hardening — Release Checkpoint

## 2026-09-26 transport and cost checkpoint

- Production main commit `a20e598` deployed to `crm.prime-champs.com`. The owner-only, one-use Perplexity Search check returned HTTP 200 with six source links and six excerpts from one climbing query. This verifies Search API transport, not exact-person yield or research quality.
- The operation ledger recorded exactly one request at a $0.005 published-rate charge, with $0.03 conservatively reserved. The prior quota and invalid-key attempts remain closed. Together, the three diagnostics hold $0.09 of the original ordinary allowance; the historical $79 campaign ledger is unchanged. This is not a reconciled provider invoice.
- The new run was evaluation-only: no athletes were created, and the research log has zero discovered, enriched, scored, returned, or added candidates. No research campaign or outreach was started.
- Apify account settings inspected read-only: 31-day unnamed-storage retention and a $100 account-wide monthly usage limit. These are not a project-specific total campaign bound. No account settings were changed, and new Apify Actor starts remain blocked in strict-budget research.
- Next: investigate exact-person discovery for the six weak archetypes using source-linked, independent queries; separate Search transport success from identity/age/social evidence. Before paid full-quality confirmations, establish a project-specific Apify storage/spend boundary and an explicit campaign allowance. Preserve the original $100 ceiling and $20 confirmation reserve unless the owner approves a new total.

- Generated: 2026-08-23
- Campaign: Cross-sport hardening 2026-08-22
- Campaign ID: `f89a73ff-a93d-4166-9d87-a1dacd78b3f7`
- Campaign record: **failed** because historical provider failures remain in the immutable campaign history
- Latest regression wave: **passed**
- Release acceptance: **not complete**
- Authoritative model: `claude-sonnet-5`
- Shadow challenger: `anthropic/claude-opus-5`, standard speed, non-authoritative
- Isolation: evaluation only; zero CRM, pipeline, notification, conversation, contract, or outreach mutations

## Executive outcome

The research agent is materially safer, more selective, and more observable than the starting system. The latest production validations passed for surfing, figure skating, gymnastics, and volleyball. The corrected 80+ boundary logic was exercised against three new volleyball candidates proposed above 80; all three were independently audited and correctly held below finalist status when the evidence did not support promotion. Opus found no missed strong fit or unsafe finalist in the new regression cases.

The campaign reached its normal-testing stop at **$79.00 of the $100 safety ledger**. The final $20 remains reserved for confirmation, so no additional paid cases were started. This ledger is conservative reservation, not the provider bill.

Measured Sonnet and Opus spend across the campaign is **$14.33**. The production scorecard's current estimated all-in range, including bounded discovery and enrichment providers, is **$38.39–$63.26**.

## Campaign totals

| Metric | Result |
|---|---:|
| Cases completed | 42 |
| Cases passed | 20 |
| Candidates scored | 270 |
| Finalists across campaign history | 4 |
| Duplicate identities stopped | 138 |
| Estimated paid calls avoided | 552 |
| Critical defects | 0 |
| Safety stops | 0 |
| Live mutations | 0 |
| Reserved safety ledger | $79.00 / $100.00 |
| Measured model spend | $14.33 |

## Latest validation cases

| Sport | Stage / attempt | Verdict | Exact people | Scored | Finalists | Provider failures | Challenger findings | Measured model cost |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Surfing | Control 6 | Passed | 73 | 24 | 1 | 0 | 0 | $1.28 |
| Figure skating | Targeted rerun 2 | Passed | 23 | 7 | 0 | 0 | 0 | $0.55 |
| Gymnastics | Control 7 | Passed | 72 | 12 | 0 | 0 | 0 | $0.49 |
| Volleyball | Control 7 | Passed | 71 | 19 | 0 | 0 | 0 | $0.87 |

Zero finalists is a valid result. The system is required to return an evidence hold rather than pad the requested count.

## Boundary and adversarial evidence

The volleyball control produced three candidates with researcher proposals of 82–83 and pre-audit scores of 79. The corrected logic audited all three because the proposal was 80+, even though the pre-audit score was below 80:

- One candidate was corrected to 74 because sponsor tags did not constitute an actionable public contact route.
- One candidate was corrected to 70 because both a contact route and public restriction/sponsorship research were incomplete, and sponsor claims were not supported by the frozen dossier.
- One candidate was corrected to 71 because commercial constraints were incomplete despite passing identity, age, momentum, audience, and creator gates.

This confirms both sides of the threshold fix: a final audited score of exactly 80 is eligible, while an unsupported proposed 80+ record cannot bypass the independent audit.

The gymnastics regression also confirmed that one-source adult-age evidence remains insufficient. Opus agreed with the hold and found no missed strong fit.

## Isolation proof

Database checks across every research log linked to this campaign returned:

- Athletes created: 0
- Non-test research candidates: 0
- Notifications: 0
- Message drafts: 0
- Outreach messages: 0
- Outreach queue entries: 0
- Appointments: 0
- Contracts: 0
- Conversations: 0

## Production verification

- Production deployment `dpl_J66s5EmBz7Kmp6eU7KuRf9C2xHrZ` is READY and serves `crm.prime-champs.com` from main commit `f2d35c6`.
- Signed-in owner scorecard verification passed and displayed the newest gymnastics and volleyball controls as passed.
- Supabase security advisors reported no ERROR-level findings. The hardening and memory tables intentionally have RLS with no browser policies, making them server-only. One unrelated project warning remains for leaked-password protection being disabled.
- Supabase performance advisors reported no ERROR-level findings. Existing informational unused-index notices and three pre-existing warnings remain.
- Two Vercel workflow steps reached the 800-second function limit during the latest gymnastics/volleyball scoring phases. Both runs automatically replayed from durable checkpoints, skipped already-saved scores, and completed without manual recovery. This proves durability but remains a production runtime optimization target.

## Latest canonical archetype state

| Archetype | Latest sport | Verdict | Exact people | Scored | Finalists |
|---|---|---|---:|---:|---:|
| Action | Climbing | Source exhausted | 6 | 0 | 0 |
| Adaptive | Adaptive track and field | Source exhausted | 2 | 0 | 0 |
| Combat | Boxing | Passed | 40 | 1 | 0 |
| Endurance | Cycling | Passed | 26 | 1 | 0 |
| General/boundary | Esports | Source exhausted | 0 | 0 | 0 |
| Judged | Gymnastics | Passed | 72 | 12 | 0 |
| Motorsport | Motorcycle racing | Prior passed control; two later untouched rows remain queued | — | — | — |
| Precision | Equestrian | Source exhausted | 4 | 0 | 0 |
| Racquet | Tennis | Passed | 35 | 9 | 0 |
| Strength | CrossFit | Source exhausted | 5 | 0 | 0 |
| Team | Volleyball | Passed | 71 | 19 | 0 |
| Water | Surfing | Passed | 73 | 24 | 1 |
| Winter | Skiing | Source exhausted | 4 | 0 | 0 |

## What is complete

- Fresh per-run CRM lifecycle memory and pre-premium duplicate suppression
- Verified identity aliases and audited one-run overrides
- Soft-only, bounded meeting guidance with exploration protection
- Statistical learning snapshots and owner-reviewable recommendations
- Mixed/global discovery without generic women-only bias
- Latest Sonnet authoritative scoring and standard-speed Opus shadow review
- Durable checkpoints, stale-run cancellation, replay-safe scoring, and case-level failure isolation
- Owner-only hardening scorecard, campaign budget, control reruns, reports, and mutation audits
- Finalist threshold aligned to the documented 80+ contract

## Remaining before full release acceptance

1. Split or further bound long scoring/audit work so one Vercel workflow step stays below 800 seconds without relying on replay.
2. Run independent full-quality confirmations for all 13 archetypes. The current campaign cannot fit that wave under its remaining ledger, so it needs an explicit new confirmation budget or a fresh campaign.
3. Run required third replicates for adaptive, equestrian, skiing, esports, and any archetype with unstable yield.
4. Complete paired baseline-versus-soft-guidance controls with a synthetic draft profile. Do not activate a real meeting profile until the paired test passes and the owner approves it.
5. Investigate source exhaustion for climbing, adaptive track, esports, equestrian, CrossFit, and skiing with targeted provider/query evidence.
6. Enable Supabase leaked-password protection as a separate authentication-hardening task.

The system is ready for controlled owner-only evaluation and produces defensible holds and finalists. It is not yet honestly claimable as fully release-accepted across all 13 archetypes.

## September 26 budget checkpoint

The owner authorized **one additional $50 cross-sport evaluation ceiling**. The new campaign is separate from the historical $100 campaign: $40 is available for ordinary testing and $10 is reserved for confirmation. The authorization is recorded as a draft and is one-use at the database level, even after a campaign completes or is cancelled. Creating this draft starts no cases, paid providers, workflow, CRM mutations, or outreach.

All 407 local tests, typecheck, lint, and the production build passed at this checkpoint. The one-shot Perplexity Search diagnostic returned HTTP 200 and source links in the previous release, but it established transport only. Full paid campaigns remain intentionally blocked until source-first candidate quality and Apify storage-cost containment are verified. Do not treat the $50 draft as evidence that those prerequisites have passed.

### Same-account Apify check and discovery vocabulary

The signed-in Apify account showed $0 usage in the new September 26–October 25 billing period, no active Actor runs, 31-day ordinary retention, and a $100 account-wide monthly usage limit. The attempted $10 limit was rejected by Apify because this plan has $39 prepaid monthly usage; **no account setting was changed**. The owner must choose whether a $39 shared-account cap is acceptable before strict-budget Apify starts can be admitted. The most recent ten runs receive separate extended retention, so lowering ordinary retention alone is not a complete storage-cost solution.

An offline review of the six mixed/global discovery queries for each of the 13 archetypes found avoidable vocabulary errors: motocross used “drivers,” equestrian used “players,” adaptive track repeated “adaptive,” and esports could emit “athlete athletes.” The sport-specific queries and neutralization were corrected without provider calls. All 408 tests, typecheck, lint, and production build passed after this change. This is a retrieval-quality fix, not yet a measured yield improvement.
