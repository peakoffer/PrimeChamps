# Perplexity post-rotation verification

September 25, 2026. **Blocked: deployed credential rejected as `invalid_api_key`.** This is a changed provider error, not successful research or a source-exhaustion result.

## Deployment and result

The user's redeployment (`dpl_B1YBp8iLwxRr67Z8TFRTFScqNEXo`, `a8d3bec`) was READY. A narrowly scoped follow-up (`17b88956fc2cc5876da103dd73e446e509835cf0`, `dpl_CWMtRBhiZs4QdCa2ZTTtmeFhvyhV`) added one fixed dated recheck, preserving the previous quota-failed diagnostic and its reservation. The follow-up was READY on `crm.prime-champs.com` before execution.

Signed-in owner verification launched probe `bfa35303-efe2-4498-ac90-f2d44fc8c017`, research log `87972522-016b-439d-823b-5bcdb7646207`, at 16:20:46 UTC. It stopped at 16:20:48 UTC after the first three fixed searches (climbing, adaptive track, esports) all returned HTTP 401, `invalid_api_key`. The remaining equestrian, CrossFit and skiing requests were not run. No sources, candidates, model calls, Apify runs, or automatic retries occurred.

The previous September 24 error was `insufficient_quota`. Today's saved receipts instead report an invalid key. Neither response establishes the remaining provider balance.

## Cost and isolation

- Published-rate request cost: **$0.000**; no unsettled operation exposure. Not a reconciled provider invoice.
- Each attempt retains its $0.03 authorization. Both together retain $0.06; the historical $79 reservation is unchanged. Combined authorization exposure is **$79.06**, leaving **$0.94** before the original $80 ordinary stop. The $20 confirmation reserve and $100 ceiling remain unchanged.
- All 14 checked live CRM/message tables have identical full-row counts and digests before/after. No outreach, notification, athlete, contract, or pipeline mutations.
- The original failed probe, its research log, and all three original receipts have identical before/after digests. No reset, deletion, or relabeling occurred.
- A third attempt is not available. Failure does not release reservations or authorize another request.

## Verification and safeguards

388 tests passed with zero failures or skips, including execution of the full migration chain in PGlite. Typecheck, production build and lint passed (zero errors, 54 existing warnings). New tests cover exclusive zero-cost quota eligibility, ambiguous/mixed receipts, invalid prior accounting, owner/org scope, concurrent duplicate submissions, preservation of old records, counting both allocations, and rejection of a third manifest.

Migration `20260925161813_research_discovery_quota_recheck` is applied. RLS remains enabled; anonymous/authenticated table reads and RPC execution remain denied. Security advisor findings were unchanged: intentional server-only/no-browser-policy informational findings and the existing leaked-password-protection warning. No security bypass was introduced. The warning's [remediation guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains applicable.

Production UI displays the failed recheck, saved HTTP statuses, zero recorded cost, retained allocation, and disabled retry/full-campaign controls. Runtime error lookup found no application errors in the post-deployment window; expected provider failures are preserved as diagnostic data.

## Required user action

Vercel's project settings confirm `PERPLEXITY_API_KEY` exists as **Secret**, scoped to **Production and Preview**. Its value was not revealed, retrieved locally, copied into reports, or committed. The exact setting is left open for the owner.

Replace the existing value with the complete currently active Perplexity API key (no quotes, whitespace, or `Bearer` prefix), save, and redeploy. Do not paste the replacement into chat. This may be a revoked, wrong, or incorrectly copied value; the response alone does not distinguish which.

No further provider call should occur until the owner corrects the setting and a separately bounded verification is authorized. Full research also retains its prior Apify billing-boundary, cumulative-budget reconciliation, and end-to-end quality gates. This report is not all-sport production certification.
