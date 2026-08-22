# Production Research Memory and Statistical Hardening — Checkpoint Report

- Campaign: Cross-sport hardening 2026-08-22
- Campaign ID: `f89a73ff-a93d-4166-9d87-a1dacd78b3f7`
- Status: **safely stopped — provider funding required before confirmation**
- Models: `claude-sonnet-5` authoritative; `anthropic/claude-opus-5` standard-speed shadow only
- Isolation: evaluation only; zero CRM, pipeline, notification, conversation, contract, or outreach mutations
- Accounted safety reserve: **$43.00 / $100.00**
- Measured Sonnet, audit, and Opus spend: **$3.20**
- Estimated all-in provider spend at the stop: **$5.54–$9.18**
- Concurrency: maximum three

## Outcome

The production memory, bounded guidance, statistical learning, owner scorecard, stale-run recovery, campaign budget, standard-speed Opus challenge, and evaluation isolation are deployed. Twenty-eight cases completed before the provider stop: the 13-archetype smoke wave, 11 targeted reruns, and four clean controls.

The campaign scored 50 evidence-backed candidates, stopped 135 duplicate identities before premium work, and avoided an estimated 540 paid candidate calls. No finalist survived the deliberately strict 80+ evidence gates; the system did not pad results.

During post-fix controls, production logs proved that the required OpenAI discovery account returns `credit_balance_exhausted`. Perplexity is also quota-degraded. Three concurrent cases recorded the OpenAI failure and the campaign was cancelled before the 13 confirmation runs. Commit `753f708` now makes required-provider quota/auth failures durable and fail-fast in evaluation mode, preventing paid fallback work from concealing a broken primary route.

## Latest canonical archetype cases

| Archetype | Sport | Stage | Verdict | Exact people | Scored | Finalists | Duplicate stops | Calls avoided |
|---|---|---|---|---:|---:|---:|---:|---:|
| Action | Climbing | Targeted rerun | Source exhausted | 6 | 0 | 0 | 0 | 0 |
| Adaptive | Adaptive track and field | Targeted rerun | Source exhausted | 2 | 0 | 0 | 0 | 0 |
| Combat | Boxing | Smoke | Passed | 40 | 1 | 0 | 11 | 44 |
| Endurance | Cycling | Smoke | Passed | 26 | 1 | 0 | 11 | 44 |
| General/boundary | Esports | Targeted rerun | Source exhausted | 0 | 0 | 0 | 0 | 0 |
| Judged | Figure skating | Targeted rerun | Passed | 14 | 2 | 0 | 8 | 32 |
| Motorsport | Motocross | Targeted rerun | Needs fix | 21 | 0 | 0 | 0 | 0 |
| Precision | Equestrian | Targeted rerun | Source exhausted | 4 | 0 | 0 | 0 | 0 |
| Racquet | Tennis | Targeted rerun | Passed | 35 | 9 | 0 | 33 | 132 |
| Strength | CrossFit | Targeted rerun | Source exhausted | 5 | 0 | 0 | 0 | 0 |
| Team | Soccer | Targeted rerun | Needs fix | 9 | 0 | 0 | 0 | 0 |
| Water | Swimming | Targeted rerun | Passed | 41 | 17 | 0 | 0 | 0 |
| Winter | Skiing | Targeted rerun | Source exhausted | 4 | 0 | 0 | 0 | 0 |

## Completed clean controls

| Sport | Verdict | Exact people | Scored | Finalists | Findings |
|---|---|---:|---:|---:|---:|
| Volleyball | Passed | 52 | 4 | 0 | 0 |
| Surfing | Passed | 24 | 3 | 0 | 0 |
| Gymnastics | Passed | 50 | 10 | 0 | 0 |
| Motorcycle racing | Passed | 18 | 2 | 0 | 0 |

The gymnastics control exposed a durable replay defect: an earlier phase could be mistaken for prior research from the same run, leaving a successful scored run with a false “No athletes found” message. Commits `f2ed986` and `b3f9c47` exclude the current run and all test-only candidates from production memory, and successful completion now clears stale phase errors.

## Isolation proof

Database checks across every research log linked to this campaign returned:

- Athletes created: 0
- Non-test research candidates: 0
- Notifications: 0
- Outreach messages: 0
- Outreach queue entries: 0
- Appointments: 0
- Contracts: 0
- Conversations: 0

## What remains before release acceptance

1. Add OpenAI API credits to the organization behind `OPENAI_API_KEY` and redeploy Vercel. A ChatGPT subscription does not fund API usage.
2. Rerun the four controls. The fail-fast provider marker must remain at zero and the self-memory regression must remain fixed.
3. Run all 13 independent full-quality confirmations.
4. Run third replicates for adaptive, equestrian, skiing, esports, and any archetype with a verdict mismatch or more than 50% yield variation.
5. Run paired baseline-versus-guided controls with a synthetic draft profile. Do not activate it.
6. Re-run isolation, Supabase advisor, deployment health, signed-in UI, and release-report checks.

The system is materially safer and more observable, but it is **not yet release-accepted across all 13 archetypes** because the required confirmation and paired-guidance waves correctly stopped on the provider outage.
