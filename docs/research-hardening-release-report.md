# Cross-Sport Research Hardening Release Report

- Campaign: Cross-sport hardening 2026-08-22
- Campaign ID: `bd216e99-b7ac-4b76-b137-2c1ae70af584`
- Status: completed
- Audience: global, mixed; explicit women, men, and neutral/open discovery lanes
- Models: `claude-sonnet-5` authoritative; `anthropic/claude-opus-5-fast` shadow-only
- Spend: **$43.00 / $50.00**; $7.00 remained unused
- Concurrency: maximum 3
- Evaluation isolation: passed; zero live CRM or outreach mutations

## Release conclusion

The production campaign completed all 13 sport archetypes plus three clean release-depth controls. Eight canonical archetypes produced at least one scored candidate. The remaining five were not padded: adaptive track and field, equestrian, skiing, and esports received full-quality source-exhaustion investigations, while esports reached 10 exact people but none cleared the strict sport, source, and public-identity gates.

The campaign produced one fully gated finalist in motocross. That finalist passed the independent audit; two strongest rejects were also audited. Across the latest canonical cases and controls, zero wrong-person matches, wrong-sport candidates, known under-21 candidates, unsupported material claims, provider failures, or unresolved Opus findings reached or survived scoring.

## Latest canonical archetype scorecard

| Archetype | Sport | Final stage | Verdict | Exact people | Scored | Finalists | Rejected audits | Safety/provider findings |
|---|---|---|---|---:|---:|---:|---:|---:|
| Action | Climbing | Smoke | Passed | 12 | 2 | 0 | 2 | 0 |
| Adaptive | Adaptive track and field | Confirmation | Source exhausted | 0 | 0 | 0 | 2 | 0 |
| Combat | Boxing | Confirmation | Passed | 80 | 11 | 0 | 2 | 0 |
| Endurance | Cycling | Targeted rerun | Passed | 32 | 1 | 0 | 2 | 0 |
| General/boundary | Esports | Confirmation | Needs fix | 10 | 0 | 0 | 2 | 0 |
| Judged | Figure skating | Smoke | Passed | 14 | 4 | 0 | 2 | 0 |
| Motorsport | Motocross | Targeted rerun | Passed | 30 | 5 | 1 | 2 | 0 |
| Precision | Equestrian | Confirmation | Source exhausted | 4 | 0 | 0 | 2 | 0 |
| Racquet | Tennis | Confirmation | Passed | 48 | 10 | 0 | 2 | 0 |
| Strength | CrossFit | Smoke | Passed | 12 | 7 | 0 | 2 | 0 |
| Team | Soccer | Smoke | Passed | 11 | 4 | 0 | 2 | 0 |
| Water | Swimming | Confirmation | Passed | 69 | 9 | 0 | 2 | 0 |
| Winter | Skiing | Confirmation | Source exhausted | 4 | 0 | 0 | 2 | 0 |

## Release-depth confirmations

| Archetype | Sport | Verdict | Exact people | Scored | Finalists | Audited rejects | Cost |
|---|---|---|---:|---:|---:|---:|---:|
| Adaptive | Adaptive track and field | Source exhausted | 0 | 0 | 0 | 2 | $2.00 |
| Combat | Boxing | Passed | 80 | 11 | 0 | 2 | $2.00 |
| General/boundary | Esports | Needs fix | 10 | 0 | 0 | 2 | $2.00 |
| Precision | Equestrian | Source exhausted | 4 | 0 | 0 | 2 | $2.00 |
| Racquet | Tennis | Passed | 48 | 10 | 0 | 2 | $2.00 |
| Water | Swimming | Passed | 69 | 9 | 0 | 2 | $2.00 |
| Winter | Skiing | Source exhausted | 4 | 0 | 0 | 2 | $2.00 |

Source-exhaustion notes:

- Adaptive track and field: 66 sources checked; no exact athlete passed the strict identity funnel.
- Equestrian: 86 sources checked; four exact people found, but none passed source, sport, and public Instagram identity gates.
- Skiing: 88 sources checked; four exact people found, but no scoring dossier survived the full evidence funnel.
- Esports: 64 sources checked; ten exact people found, but none passed source, sport, and public Instagram identity gates.

Shadow-audit observations that did not change a disposition:

- Adaptive track: Opus agreed the athletes could not advance, but noted that Paralympic championship evidence was on-sport even where the deterministic sport gate said otherwise.
- Equestrian: Opus agreed the athletes could not advance, but identified FEI jumping and Global Champions evidence as on-sport; the authoritative-domain classification needs expansion.
- Esports: Opus agreed the athletes could not advance, but identified a team roster announcement as on-sport while still rejecting it as non-independent and insufficient for identity, age, audience, creator, and contact gates.

## Clean regression controls

| Sport | Verdict | Exact people | Scored | Finalists | Under-21 blocked before scoring | Findings |
|---|---|---:|---:|---:|---:|---:|
| Volleyball | Passed | 56 | 5 | 0 | 0 | 0 |
| Surfing | Passed | 73 | 6 | 0 | 1 | 0 |
| Gymnastics | Passed | 77 | 9 | 0 | 6 | 0 |

## Defects found and fixed

- Mixed/global evidence verification no longer reapplies the former women-only gate.
- Exact-person coverage is measured from athlete-named, sport-matched, source-backed evidence rather than Instagram verification alone.
- Known under-21 candidates are blocked before paid scoring and reusable safety evidence survives provider misses.
- Motocross ontology and bounded OnlyFans provider recovery were corrected and confirmed without promoting a false match.
- Historical provider failures become non-blocking only after evidence-backed recovery; the campaign retains one resolved provider failure and zero unresolved failures.
- The workflow's outer loop incorrectly stopped confirmation batches after $40 even though batch admission reserved spend through $50. Commit `1030aa0` removed the contradictory stop, gave confirmation runs the correct remaining ceiling, and added resumable untouched cases. The queued esports case then completed at a final campaign spend of $43.

## Sanitized evidence references

Representative public sources retained by the independent audits:

- Finalist confirmation: `https://en.wikipedia.org/wiki/Chance_Hymas`, `https://racerxonline.com/rider/chance-hymas`, `https://honda.racing/ama-sx/profiles/2475`, `https://www.vurbmoto.com/team-honda-signs-chance-hymas/`, `https://results.promotocross.com/results/`, `https://instagram.com/chancehymas_`.
- Adaptive investigation: `https://www.paralympic.org/news/new-delhi-2025-day-one-medallists`.
- Equestrian investigation: `https://www.fei.org/jumping`, `https://www.gcglobalchampions.com/en-us/news/from-opportunity-to-impact-the-power-of-gcl-s-u25-rule`.
- Esports investigation: `https://100thieves.com/blogs/all/2026-valorant-roster-update`.
- Skiing investigation: `https://www.fis-ski.com/alpine-skiing/news/2025-26/rassat-s-rise-continues-with-adelboden-slalom-victory`, `https://www.fis-ski.com/alpine-skiing/news/2025-26/von-allmen-stuns-on-the-downhill-to-become-first-olympic-champion-of-milano-cortina`.

No private tokens, raw provider payloads, email data, or sensitive internal URLs are included.

## Acceptance status

- Passed: all 13 archetypes have a completed final case; no stale run remains.
- Passed: all cases either met the 8-exact/1-scored bar or have a documented full-quality source-exhaustion investigation.
- Passed: the sole finalist has an independent audit; every latest case audits up to two strongest rejected candidates.
- Passed: zero latest-case safety, identity, unsupported-claim, provider, or challenger findings remain.
- Passed: three clean release-depth controls completed.
- Passed: authoritative and shadow model routes remained frozen.
- Passed: total campaign accounting is $43, below the $50 ceiling.
- Passed: no athletes, notifications, drafts, messages, queues, outreach records, or pipeline promotions were created by campaign runs.
- Qualified: one confirmation case required the owner-only resume control after the $40 outer-loop defect was discovered. The defect is fixed and regression-tested; a future fresh campaign should prove fully automatic continuation end to end.

## Safety boundary

This campaign is evaluation-only. It may write research logs, test candidates, scores, audits, campaign cases, and sanitized reports. It cannot create athletes, notifications, drafts, messages, queue entries, outreach records, or pipeline promotions.
