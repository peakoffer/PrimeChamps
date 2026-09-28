# Opus 5.5 handoff - Prime Champs research hardening

**Checkpoint:** September 28, 2026. **Repository:**
`https://github.com/peakoffer/PrimeChamps`. **Production:**
`https://crm.prime-champs.com`. **Last code checkpoint:** `0db5ed6`;
this handoff document has its own later commit on `main`.
Vercel production deployment `dpl_2DrLhBEfw83KPE2JqvZLk8JX7uSa` is READY and
aliases `crm.prime-champs.com`. Start from a fresh `main` checkout; do not rely
on an older Claude session's repository map.

## Update - September 28, 2026 (Claude review and hardening pass)

Read this first; the sections below it describe the state before this pass.
No paid research, audit retry, outreach, or cost-record change was made.
The campaign is unchanged: `failed`, $3.979062 exposure, zero passed cases,
and the $1.575512 Opus reservation is still unsettled.

**Shipped to `main` (code) and production (database):**

1. *Evaluation isolation (was a HIGH-severity gap).* `POST
   /api/research/sessions/[id]/athletes` promoted evaluation candidates into
   the live Approval stage (36 stored evaluation finalists passed its gates),
   and the Pipeline board listed evaluation runs so they could be dragged
   there. `/api/research/approve` trusted client-sent age, minor, and score
   values. Both routes now refuse evaluation data and use only stored gate
   values; the board requests live runs only. Database backstop migrations
   `research_evaluation_crm_isolation` and
   `research_evaluation_flag_guards_split` were applied and proven with
   rolled-back probes: an athlete sourced from an evaluation log, relabelling
   an evaluation log as live, and relabelling a test candidate as live all
   fail; ordinary evaluation upserts still work.
2. *OpenRouter endpoint preflight.* Before any reservation, strict OpenRouter
   requests read the pinned Anthropic endpoint's advertised parameters (free)
   and refuse locally unless every field, strict structured output, and the
   output cap fit. This replaces reliance on the one-field temperature guard.
3. *Opus output budget.* Opus 5.5 cannot disable thinking, and thinking counts
   against `max_tokens`. The audit budget rose from 5,000 to 16,000 tokens
   (about +$0.22 reservation) and a truncated answer is reported explicitly.
4. *Sonnet 5.5 price.* Added the reviewed $2/$10 rate so the dynamic
   latest-Sonnet resolver does not halt paid research when it returns
   `claude-sonnet-5-5`. Note: this campaign is frozen on `claude-sonnet-5`;
   once the catalog returns Sonnet 5.5, its resume/retry route checks will
   refuse (by design) and a new campaign is required.

**Held for an explicit owner decision (not applied, not on `main`):**

The soccer audit remains blocked. Unblocking it relaxes spending controls on
production, so the automated safety review stopped the agent and it is the
owner's decision, not an agent's:

- *Settling the stuck reservation.* Nothing in the code can settle a
  pre-inference rejection that has no request ID. The agent drafted an
  append-only, evidence-required reconciliation migration but did not apply
  or commit it.
- *Re-admitting one more audit-only attempt.* The retry gate allows exactly
  one attempt, only for a case-budget hold, and refuses if the frozen Sonnet
  route has changed. Allowing a second attempt is a policy change.

Do not implement either without the owner's explicit, written approval of
that specific change. If approved, the smallest next paid test is unchanged:
one audit-only Opus call on research log
`390725ab-a61e-4b1f-9293-2242c5f600ee`, reserving roughly $1.8, which fits the
$3 case cap only after the $1.575512 rejection is settled at $0.

**Verification:** typecheck clean; 407 unit tests pass, 2 skipped, 0 fail;
lint 0 errors (53 pre-existing warnings). A local production build compiled
and type-checked but cannot collect page data without the Supabase secret;
Vercel's build is authoritative. With npm 10.9.7 locally, `npm ci` reported
`package-lock.json` out of sync (missing `chokidar@5.0.0`); GitHub CI's
`npm ci` passes, so this is local-toolchain specific.

## What the owner wants

Harden a cost-controlled, source-backed athlete research agent across 13
distinct archetypes, without lowering quality or sending outreach. The system
should find emerging, viable partnership candidates across sports, reject
wrong-person/wrong-sport/minor/unsupported cases, use CRM lifecycle memory to
avoid rediscovering known athletes, and keep meeting intelligence soft rather
than narrowing discovery to zero. Latest Sonnet remains the authoritative
scorer; latest standard-speed Opus is an independent, non-authoritative audit.
The owner's implementation plans and acceptance criteria are summarized in
`docs/research-hardening-release-report.md` and encoded in
`dashboard/src/lib/research/hardening.ts`.

## Current production state - do not mistake this for release acceptance

The **new** bounded campaign is
`d6d13bc5-9ef9-4334-b44d-5ed8d67d1bb2`: $50 absolute ceiling, $40
ordinary-testing stop, $10 confirmation reserve. Its status is `failed` with
**$3.979062 conservative ledger exposure**. The owner scorecard separates
approximately $1.74 provider-reported charges from approximately $2.24
unsettled exposure; the latter is not a provider invoice. There are zero
passed cases in this campaign. The first one-at-a-time release canaries are
soccer (team), figure skating (judged), and skiing (winter). Only soccer has
actually run; the other two are blocked with no research log or spend.

The latest soccer research log is `390725ab-a61e-4b1f-9293-2242c5f600ee`.
Its evaluation workflow completed: 20 sourced, 18 exact-person discoveries,
two Instagram-enriched/scored candidates, zero finalists, zero athletes added.
The case is `completed / needs_fix`, **not passed**. The two scored candidates
were held below finalist threshold. The independent Opus challenge produced
zero audits, so the case cannot certify the quality of even a zero-finalist
result. A direct database isolation check found zero live athletes created and
zero non-test research candidates from this log. No outreach was sent.

Why the challenge stopped:

1. The original completed soccer run could not reserve its oversized Opus
   packet under the $3 case cap. Commit `e6faac3` removed duplicate replay
   caches from the packet, preserving cited evidence and gates, and introduced
   one audit-only retry on the frozen dossier.
2. That retry reached OpenRouter but returned HTTP 404 before inference. The
   saved routing funnel selected one Anthropic first-party endpoint, then
   failed at **Filter by Parameters**. The request included `temperature: 0`,
   which the current first-party Opus 5.5 endpoint does not advertise.
3. Commit `0db5ed6` removed that field and added a local compatibility guard.
   The fix passed `npm run check` (397 passing unit tests, two skipped,
   typecheck, lint, production build) and deployed READY. **It has not been
   proven by another paid Opus request.** The same frozen model/provider/price
   route is intact.

The failed Opus operation occurred September 27, 2026 at 00:08:47 UTC
(September 26 at 7:08 PM Central). It has no provider usage or remote request
ID, but its **$1.575512 reservation remains conservative exposure** until
OpenRouter activity/billing is independently checked. Do not mark it as a
charge or manually zero it based only on an inference. The one-use audit retry
count is now 1 and there is one prior shadow operation. The UI's generic
"Targeted rerun" would repeat discovery and scoring; **do not click it**.
Canary admission currently rejects a fourth full soccer correction and will
not resume figure skating or skiing until soccer has a passed, audited result.

## Safe review order for Opus

1. **Audit, do not run:** read this file, the release report, `CLAUDE.md`,
   `dashboard/AGENTS.md`, and the exact campaign/paid-ledger code paths below.
   Verify `main`, production deployment, campaign rows, and the failed raw
   OpenRouter response. Never print keys or raw private candidate dossiers.
2. **Reconcile billing:** inspect the owner's OpenRouter Activity for the
   timestamp above. The browser may require Zac to sign in; do not ask him to
   paste a key. Keep the conservative reservation until evidence establishes
   the actual cost and an auditable reconciliation mechanism is designed.
3. **Review the route offline:** compare the bounded Opus request against the
   current endpoint parameter/pricing metadata. Confirm strict JSON schema,
   max tokens, standard speed, Anthropic provider, and price cap still fit.
   Do not silently relax `require_parameters`, provider pinning, or the cap.
4. **Propose the smallest next paid action:** only after owner approval and
   billing reconciliation, consider one more **audit-only** attempt on the
   same completed soccer research log, under the original case and campaign
   limits. It must not buy search, Instagram enrichment, or Sonnet scoring
   again. A new full research case is not a substitute for fixing audit
   admission. Do not reset retry counters or alter historical receipts to
   make an attempt fit.
5. **Only after a passing audited soccer case:** inspect source quality and
   cost, then resume the untouched figure-skating and skiing canaries one at
   a time. Broaden to all 13 only after the canary gate passes. Stop for any
   identity/age safety issue, unsupported finalist claim, model-route change,
   repeated provider failure, or spend stop. Keep evaluation rows isolated
   from live CRM and outreach.

## Code map

| Concern | Primary location |
| --- | --- |
| Research phases, discovery, enrichment, scoring | `dashboard/src/app/api/research/run/workflow.ts` |
| Durable campaign and audit-only workflows | `dashboard/src/workflows/research-hardening.ts` |
| Campaign preparation, case audit, reconciliation | `dashboard/src/lib/research/hardening-service.ts` |
| Canary and retry admission | `dashboard/src/lib/research/hardening-readiness.ts` |
| 13-archetype matrix and budget policy | `dashboard/src/lib/research/hardening.ts` |
| Opus request and dossier | `dashboard/src/lib/research/hardening-shadow.ts`, `hardening-audit-policy.ts` |
| Paid operations, exact route/pricing/receipts | `dashboard/src/lib/research/paid-operations.ts`, `paid-provider-fetch.ts`, `paid-provider-pricing.ts` |
| CRM duplicate/lifecycle memory | `dashboard/src/lib/research/crm-memory.ts` |
| Owner-only API and scorecard | `dashboard/src/app/api/research/hardening/`, `dashboard/src/app/pipeline/research/hardening/` |
| Release evidence | `docs/research-hardening-release-report.md` |

## Verification and handoff hygiene

Run `cd dashboard && npm run check` after code changes. Review `git diff
--check`, commit only intended files, and push to `main` without force. Verify
the Vercel deployment is READY and aliases production. For any paid test,
check campaign/case status, every operation's conservative exposure, exact
provider receipts, and zero CRM/outreach mutations before proceeding.

The only untracked local file at handoff is
`output/pdf/Prime-Champs-Research-Agent-Cost-and-Process-Map.pdf`. It is an
August 22 planning PDF with an **obsolete OpenAI-search route and older cost
figures**. It is deliberately not committed; use the live scorecard and the
release report instead. Do not commit `.env.local` or share API keys.

The historical $100 hardening campaign had multiple passing cases, but it is
not proof that the current 13-archetype production acceptance criteria are
met. Returning zero finalists is valid when independently audited evidence
supports it; padding a requested count is not.
