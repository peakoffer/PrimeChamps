# Economical research release — safety checkpoint

Date: September 24, 2026

Status: safety/accounting code deployed and verified at `crm.prime-champs.com`; paid dispatch remains intentionally blocked. **Not an all-sport production-readiness certificate.**

## Result and spending

This checkpoint repairs the common accounting, replay, audit, and evidence defects before purchasing another round of archetype tests. Research API spend during this implementation is **$0**. No new paid campaign was started.

The old campaign's $79 reservation remains intact; its incomplete historical cost estimate is not relabeled as an actual bill or erased to make a new budget available. The remaining-work proposal is capped at $75, with $60 ordinary testing and a $15 reserve, subject to reconciliation of prior authorization. Campaign creation does not authorize a silent cumulative-budget reset.

## Implemented

- Server-only, organization-scoped operation ledger with atomic case/campaign admission, unique request claims, retained exposure for unknown charges, and raw receipts saved before output parsing.
- Explicit separation between provider-reported charges, conservative estimates, and retained reservations. No usage estimate is presented as a settled provider bill.
- Standard-speed, text-only request controls; unsupported media, hosted tools, hidden continuations, multiple outputs, and model fallback lists fail closed. Strict OpenRouter chat requests enforce a fixed Anthropic provider and prompt/completion price ceilings.
- Apify accepted-run IDs and raw start/poll receipts survive recovery. Actor receipts and dataset retrieval are separate operations. A timeout/abort request is not treated as proof that an actor stopped.
- Candidate-bounded scoring and audit checkpoints for evaluations. Ordinary non-evaluation research retains its existing orchestration until paid canaries validate the new path.
- Full precheck profile reuse, early known-under-21 stops, terminal-state guards, and clearing of prepared scoring/audit artifacts when enrichment is forked.
- Atomic stale recovery for evaluation runs with no heartbeat for 20 minutes, including legacy runs outside a hardening campaign.
- Explicit selected-case manifests, concurrency starting at one, and separate budget-pause versus quality verdicts.
- Full challenger evidence packets, exact candidate-ID coverage, candidate-local citation validation, and no automatic promotion from challenger feedback.
- Genuine held-out precision is unavailable until linked ground truth exists. Finalist retention is not precision. Meeting-profile activation cannot be approved by posting invented summary metrics.
- Coverage keyed by actual sport so a clean control does not replace another sport's result. Low yield remains inconclusive without the required independent source investigation.
- Discovery evidence must concern the named person; another athlete's competition results and model-authored claims are not qualification evidence.
- Legacy OpenAI discovery excerpts synthesized from model context are invalidated in memory reads without rewriting historical records. Pronoun-only or unverified snippets need named raw source text; stricter provenance can reduce initial discovery recall.

## Paid testing is deliberately blocked

This is an execution-policy gap, **not a request to replace API keys**.

1. The existing hosted-search route has no verified ceiling on additional input supplied by web tools. An output-token limit alone is insufficient to establish a strict request budget.
2. Apify's run-level limit does not establish a bound on later storage retention and data retrieval charges. New strict-budget actor starts remain blocked until a reviewed lifecycle/retention policy is implemented. Existing evidence can be read through the separately accounted retrieval path.

No environment variable bypass was added. A paid campaign cannot start merely because credentials are present or an owner clicks Resume. Legacy campaign history remains readable.

## Verification record

Local typecheck and production build passed (32 workflow steps, four workflows, 125 pages). All **336 tests passed with zero skipped**, including execution of the migration and budget controls in a local PostgreSQL-compatible engine and the secondary-button regression. Lint reports zero errors and 54 existing warnings. Synthetic tests verify behavior; they do not establish real-world candidate yield or held-out precision.

Production migration applied successfully. Verified RLS enabled, no anonymous/authenticated table access or RPC execution, service-role access available, zero ledger rows, and both legacy campaign reservations unchanged. Supabase advisors show intentional server-only RLS/no-browser-policy and new-unused-index informational notices; unrelated existing warnings remain for leaked-password protection, one RLS performance policy, and duplicate system-log indexes. These warnings were not silently treated as a clean advisor report.

Application commit `4d2e307cd459063c195bb38bba9382b0d32c4971` deployed successfully as `dpl_5GVLZoSp2J3wiNDyVZJhLTwjeQmm`, with the production domain attached. Signed-in owner verification confirmed the readiness explanation, disabled new-campaign action, preserved legacy accounting, and all 13 canonical sports plus four distinct controls. An attempted legacy resume showed the blocking explanation without creating any run. Secondary paid buttons were still visually enabled; the follow-up UI correction disables them and marks old verdicts as historical rather than current certification. Runtime error lookup found no errors in the checked hour.

The stale evaluation `b047a517-26ac-4fc5-bba3-a6891ed58d50` was atomically marked cancelled/interrupted. No running evaluations remain. Full row digests—not just counts—matched across **14 live CRM/message tables** before and after verification. There are still 200 research logs, two campaigns, and zero paid-operation rows. This proves no live-row mutation during this release verification, not the safety of future unexecuted paid tests.

Before-release isolation baseline:

| Live record type | Count |
| --- | ---: |
| Athletes | 327 |
| Notifications | 50 |
| Appointments | 2 |
| Contracts | 2 |
| Conversations | 3 |
| Outreach messages | 5 |
| Outreach campaigns / queue | 0 / 0 |
| Outreach templates | 10 |
| Research logs / hardening campaigns | 200 / 2 |

The expected operational change is cancellation of an already-stale evaluation log, not creation of a live athlete or an outreach event.

## Next bounded release

1. Implement a source-first discovery path using fixed-price search, bounded source retrieval, and separately bounded text reasoning. Preserve query breadth and evidence depth; do not substitute a cheaper scoring model or lower safety gates.
2. Establish an Apify retention/deletion policy for campaign-owned temporary storage and test interruption cleanup before enabling new actors. Never delete historical/user-owned datasets merely to satisfy a cap.
3. Expand recorded provider replay fixtures. Current cross-sport synthetics cover parser/eligibility behavior, not the entire live provider-to-finalist chain.
   Audit downstream age-source provenance separately: existing age helpers can still consume model-extracted claims. The discovery fix is not proof that all downstream age claims are independently source-verified.
4. Reconcile old campaign exposure and publish the net available/new allowance. Resolve and pin current models/prices for the new experiment; do not alter historical route snapshots.
5. Run one serial metered canary, then the targeted source probes and independent archetype confirmations in the approved plan. A failed shared component returns to offline replay before another purchase.
6. Add linked source-investigation evidence and independently labeled precision before treating exhaustion or guidance validation as passed. Keep real meeting-derived guidance inactive meanwhile.
7. Release supervised use only for individually confirmed sports. Do not advertise all 13 as validated because the UI deploys successfully or the unit suite passes.

## Provider references reviewed

- [OpenRouter provider controls](https://openrouter.ai/docs/guides/routing/provider-selection): price limits are enforced separately from inexpensive-provider preference; strict requests apply those limits and disallow provider fallback.
- [Apify actor run API](https://docs.apify.com/api/v2/actors-runs-post): run charge cap and run receipts inform admission; separate retrieval/retention still require accounting.
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), and [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing) underpin the reviewed provider policy. Revalidate prices/routes before enabling paid dispatch.
