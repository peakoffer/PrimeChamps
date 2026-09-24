# Source-first research — deployed diagnostic checkpoint

Date: September 24, 2026

**Status: implementation deployed; live source diagnostic blocked by Perplexity API quota. Not an all-sport production-readiness certificate.** This supersedes the next-step status in the earlier [safety checkpoint](research-release-checkpoint-2026-09-24.md), not its historical measurements. Machine-readable evidence is in the [JSON report](research-discovery-checkpoint-2026-09-24.json).

## What shipped

- Evaluation-only source-first research: fixed-price raw search followed by separately bounded Sonnet extraction. Mixed women/men/neutral discovery lanes remain global without a silent English-language restriction. Strict evidence paths do not fall back to unbounded hosted search or generated source claims. Ordinary non-evaluation provider routing remains unchanged.
- Age safety: explicit attributable DOB evidence implying conflicting birth years or current ages no longer retains an earlier verified-adult decision. A fresh strict dossier cannot inherit an older clearance when fresh evidence invalidates it. Approximate-age and recent-birthday tolerance remain unchanged. This does not re-audit old CRM rows or claim to detect every same-year/same-current-age date discrepancy.
- Paid transport: exact HTTPS endpoints and methods, no credentials embedded in URLs, and no paid-request redirects to unpriced destinations.
- Owner-only six-source diagnostic with a database-enforced $0.03 ceiling, at most three concurrent requests, immutable one-time allocation, durable receipts, no retries, and no model/Apify/CRM work. Refresh only reads existing results. Browser roles cannot read the server-owned table or execute its RPC.
- A sanitized, actionable quota explanation replaces the misleading generic interpretation of HTTP 401. Provider response prose is not echoed into the interface.

Core application commit `2c1476dccbee0d25157efcea80763bdfc506faa2` was READY on Vercel deployment `dpl_HiazVtmPhocKiPTwhJuvwsLuCreJ` and attached to `crm.prime-champs.com` before the diagnostic. The quota-hint follow-up and this report are a separate checkpoint; its deployed SHA is recorded by Git/Vercel rather than self-referenced in this file.

## Actual production result

The signed-in owner started diagnostic `1b91fc6a-f21a-4803-b74c-0908ae0a2224` at 21:19:57 UTC. Research log: `3ea7acd5-4e6e-41df-a4e9-173fab4658f8`.

| Sport | Result | Sources |
| --- | --- | ---: |
| Climbing | HTTP 401, `insufficient_quota` | 0 |
| Adaptive track and field | HTTP 401, `insufficient_quota` | 0 |
| Esports | HTTP 401, `insufficient_quota` | 0 |
| Equestrian | Not run: first wave failed | 0 |
| CrossFit | Not run: first wave failed | 0 |
| Skiing | Not run: first wave failed | 0 |

All three durable provider receipts identify exhausted API credits/quota. This is **not evidence of an invalid key, a candidate-quality failure, or source exhaustion**. No candidate was discovered, scored, rejected, or certified by this diagnostic. There were no Apify starts, model calls, or automatic retries.

Action: inspect [Perplexity API project billing](https://console.perplexity.ai/project/billing) for the project owning the production `PERPLEXITY_API_KEY`. Funding an unchanged key does not itself require rotation or redeployment. OpenAI/OpenRouter funds and consumer subscriptions do not establish this separate project's API balance. Preserve the failed diagnostic; a later check must be a separately authorized and accounted attempt, not a reset/replay of this one.

## Cost: authorization is not spend

- Published-rate cost of this diagnostic: **$0.000**, based on the three failed search receipts. This is not a reconciled provider invoice.
- Unknown operation exposure: **$0.000**. The one-time **$0.030 allocation stays reserved** and cannot be reclaimed automatically.
- Historical parent reservation: **$79.00**, unchanged. Combined historical reservation plus this allocation: **$79.03**.
- The original ceiling remains **$100**, with an **$80 ordinary stop** and **$20 confirmation reserve**. Ordinary authorization left after this allocation is **$0.97**; this is not a claim about the provider wallet balance.
- No extra $75 campaign was created and no historical estimated bill was reclassified as measured spend.

[Perplexity's published search pricing](https://docs.perplexity.ai/docs/getting-started/pricing#search-api-pricing) charges successful requests at $0.005; failed requests are not charged. The endpoint/authentication format was checked against the [official search reference](https://docs.perplexity.ai/api-reference/search-post).

## Verification

- **382 unit tests passed, zero failures or skips**, including executable PostgreSQL-compatible tests of allocation, ownership, expiry, delayed dispatch, immutable reservations, and replay protection.
- Typecheck, lint (zero errors; 54 pre-existing warnings), and production build passed. The core release had 381 passing tests; the quota regression added one.
- Both migrations applied: `20260924211229_research_discovery_probe` and `20260924211426_research_discovery_probe_parent_index`. RLS enabled; anonymous/authenticated table and RPC access denied; service access available.
- Supabase advisors have no new errors. Intentional server-only/no-browser-policy and new-unused-index informational notices remain, alongside pre-existing leaked-password-protection, RLS performance, and duplicate-index warnings. This is not a claim of a warning-free project.
- Signed-in production UI showed the failed diagnostic, saved HTTP statuses, cost/reservation distinction, and disabled full-campaign controls. Runtime error lookup reported none since 21:15 UTC; the expected provider failures were recorded as diagnostic data.
- Full-row counts **and digests matched across all 14 live CRM/message tables** before and after execution: 327 athletes; 50 notifications; two contracts; two appointments; three conversations; 663 channel messages; five outreach messages; eight conversation messages; ten outreach templates; zero email messages, Instagram messages, message drafts, outreach queue items, or outreach campaigns. Digests are preserved in the JSON report.
- Expected test-only additions: one evaluation research log, one diagnostic row, and three receipt/operation rows. The historical parent campaign remains failed with its original reservation intact.

## What must happen next

1. Resolve the Perplexity API project quota, then explicitly authorize a separately accounted tiny verification. Do not keep retrying a shared provider failure.
2. Resolve the Apify billing boundary: actor-run caps do not bound all future storage charges. The owner must approve execution/retrieval-only campaign accounting with storage separately reported, or a verified retention bound must be implemented. See the [Apify boundary review](research-apify-billing-boundary-2026-09-24.md). No Apify runs or storage deletions were performed here.
3. Reconcile existing exposure before allocating full research tests; preserve the original ceiling and confirmation reserve.
4. Validate the new source-first path end-to-end, including worst-case durable phase duration, exact-person yield, raw age/source evidence, Sonnet scoring/audit, standard-speed Opus challenge, and retained failure receipts. Offline tests do not prove live finalist quality.
5. Confirm affected archetypes and clean controls, and obtain genuinely linked held-out labels before publishing precision or all-sport readiness. Do not turn source-page counts into athlete counts or treat zero results under provider failure as source exhaustion.

Outreach, automatic promotion, and live pipeline mutation remain disabled/out of scope throughout.
