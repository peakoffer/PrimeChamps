# OnlyFans Athlete Research V2 — Claude Handoff

**Checkpoint date:** 2026-08-20
**Repository:** `/Users/zacharyvanheyningen/Projects/primechamps`  
**GitHub:** `peakoffer/PrimeChamps`  
**Local branch:** `main`
**Production branch:** `main`  
**Production:** <https://crm.prime-champs.com>  
**Supabase project:** `rmxuwyxpoazsuqvdadlo`  
**Vercel project/team:** `prj_pdN1qDaRwbTXn9pS3AwAm1vg1faV` / `team_YLzJibaLdsmxiYeAz5yHM2J9`

## Start here

Continue the existing objective; do not replace it with a smaller proxy:

> Build and validate a production-ready, evaluation-only OnlyFans athlete research agent that returns up to 10 genuinely strong candidates per requested sport without padding results or inflating scores. A candidate may score above 80 only after verified identity, corroborated 21+ eligibility, source-backed athletic momentum and creator potential, realistic commercial achievability, and an independent quality audit. Use the latest Sonnet model for scoring, bounded API and token budgets, replayable checkpoints, development and locked held-out benchmarks, and iterative audit-driven improvements. Production readiness requires 100% identity and age-gate accuracy for finalists, zero unsupported material claims, at least 90% held-out precision for candidates scoring 80+, at least 90% audit pass accuracy, and absolutely no outreach or live pipeline promotion during testing. Returning fewer than 10 candidates is correct whenever the available evidence does not support 10 qualified results.

The goal is **not complete**. The production gates are substantially stronger and Dylan's enriched benchmark is safely imported, but a fresh evidence-ready cohort, development calibration, and locked held-out proof are still missing.

## Current checkpoint — read this before older chronology

This block supersedes older counts later in this document. The older sections remain as an audit trail of how the current state was reached.

- **2026-08-20 new positive ground truth:** Dylan returned `OnlyFans_New_Ground_Truth_Intake_Completed.xlsx` with eight genuinely new signed athletes and 39 dated pre-decision evidence rows. The workbook passed structural, formula, cutoff, duplicate, and outcome-leakage validation. None of the eight names appears in the authoritative original 100. Five older provisional CRM records were reconciled in place and three benchmark-only records were created under dataset tag `onlyfans_new_ground_truth_2026_08_20`; no live athlete, pipeline, draft, message, or outreach record was created. The import wrote eight private outcome sources plus 16 excluded outcome claims and 39 separate pre-decision evidence sources/claims. The private outcome reference never enters model evidence.
- **Fresh-packet audit after free archive recovery:** all eight new cases have usable point-in-time evidence, all eight pass momentum, and all eight pass creator behavior. Falyn Fonoimoana is now fully freeze-ready after two independent cutoff-safe DOB/identity sources and an archived audience source; Chloé Paquet has two-source identity and adult corroboration but still needs a dated audience source. Across the eight cases, three now pass identity, two pass adult corroboration, and three pass the audience/creator pair. Current readiness is `1/8`. The recovery used only free public/archive sources, spent zero scoring/Auditor tokens, and created no outreach or live pipeline records.
- **Current fresh challenge pool:** the production benchmark UI has 28 never-scored authoritative cases: nine positive and 19 negative, with eight ready negatives and one ready positive. The eight new positives plus the existing Daryn Harris case are the bounded recovery pool. Once at least eight fresh positives become evidence-ready, challenge mode may lock a fresh `8 fit + 8 not-fit` held-out set while using a prior revealed `8 + 8` run only for development replay. Do not require or manufacture 16 fresh positives.
- **Next bounded recovery:** free operator recovery successfully proved Falyn, Chloé, Dennis, Eric, and Mike source paths and exposed a strict sport-label mismatch. Extraction v26 and the final identity gate now share the same canonical sport aliases, including descriptive intake labels such as `Mixed martial arts (UFC)`, `Mountain biking (freeride/downhill)`, and `Boxing (cruiserweight)`. The current in-app CRM session may still require Microsoft sign-in before starting `Recover fresh positives`; if so, authenticate and run it once with the existing $0.50 Google/Apify ceiling. Scoring tokens and outreach mutations remain zero during evidence preparation.
- **Reproducibility:** the deterministic parser/importer is `dashboard/src/lib/research/new-ground-truth-intake.ts` plus `dashboard/scripts/import-onlyfans-new-ground-truth.ts`. The raw spreadsheet-tool extraction and pre-import database backup are stored under ignored `dashboard/data/new-ground-truth/` and `dashboard/data/backups/`; they contain private evidence and must never be committed. `npm run audit:historical-benchmark -- --dataset=new --recovery-plan` audits only the new eight-case dataset.
- **2026-08-16 cross-sport cutoff:** three production smoke evaluations were run in evaluation-only mode with a three-finalist cap. Gymnastics `dca4b525-1246-4e53-b52c-45c68d95cce7` sourced 11, enriched/scored Georgia-Mae Fenton, and correctly returned zero (74: established profile and weak current acceleration). Surfing `5b36a1e4-d7c9-4212-bf2b-3bc79fa38711` sourced seven, scored Sawyer Lindblad 74 and Zoe McDougall 63, and correctly returned zero because neither had corroborated 21+ evidence; Sawyer otherwise showed strong momentum, engagement, and accessibility. Motorcycle racing `abe4bdbb-8b55-4d2e-ba99-9ef62bb2cb62` sourced eight legitimate WorldWCR riders but rejected all before enrichment because the generic motorsport strategy did not recognize `WorldWCR`/`worldsbk.com` as motorcycle-racing proof. The focused fix adds motorcycle-specific canonical terms, authoritative domains, creator/competition queries, and a car-racing exclusion. Do not rerun until this commit is deployed and a new bounded smoke is explicitly warranted.
- **Offline replay after the cross-sport fix:** seven of the eight saved WorldWCR packets now clear deterministic discovery. Paola Ramos remains correctly rejected because the cited source establishes that she is under 21. Lucie Boudesseul now clears after `podium` was added as an explicit competitive-athlete signal; the prior rejection ignored a source-attributed third career WorldWCR podium. No provider was called for this replay.
- **Surfing age-evidence correction:** the saved Sawyer Lindblad packet contains a dated report phrased as “the 20-year-old, Lindblad,” but the parser previously accepted ages only after the athlete's full name. A narrow reverse-order parser now requires the numeric age immediately before the exact requested surname and the full athlete name elsewhere in the same excerpt, with regression coverage against a nearby younger competitor. Batched Apify age resolution now combines already-fetched attributable evidence with new Google results before invoking a second provider, and the grounded corroboration prompt recognizes `N-year-old` evidence URLs. This improves 21+ safety and avoids paying to rediscover a first source; it does not relax the two-independent-domain finalist gate.
- **Isolation proof for all three cross-sport runs:** 26/26 candidate rows have `is_test_data=true`, zero candidates link to an athlete row, and no live athlete/pipeline/outreach record was created. Returning zero finalists was correct; the evaluation engine did not pad.
- **Fresh benchmark limitation, updated:** Dylan's original authoritative set remains 44 positive / 56 negative, and both prior held-out cohorts have been revealed. The eight new signed cases remove the prior positive-count shortage, but evidence coverage—not label volume—still blocks release: the fresh quota is eight ready positives plus eight ready negatives, and the current readiness is `1 + 8`. Do not relabel, recycle revealed cases, or weaken gates to manufacture the missing positive packets.
- **Archive recovery discipline:** the durable cooldown fix recognizes bounded provider-rate-limit deferrals and blocks overlapping POST retries with `429`/`Retry-After` before any provider call. The most recent age-recovery checkpoint must not be retried before its cooldown expires. Repeated Social Blade attempts are also exhausted for already-failed handles; credentials are valid, and the remaining issue is historical coverage rather than authentication.
- **Validation at this cutoff:** TypeScript passes, all 169 unit tests pass, lint has zero errors (53 existing warnings), and the Next.js production build passes. No further paid evaluations were started after the cross-sport audit.

- **2026-08-16 fresh-yield diagnosis:** development volleyball run `d02083e1-f360-46bd-b304-d2c0b3c89b54` sourced 38, measured 30 audiences, rejected 20 measured audience misses, enriched/scored nine, and returned only Emma Halter and Devon Newberry at 82. Brooke Nuneviller was correctly audit-demoted to 73 for incomplete commercial access. A subsequent two-wave run `fa873520-5874-4e33-b034-01edd6e902ed` proved the larger source pool works: 60 sourced, 44 audience measurements, 35 measured audience rejections, and 15 admitted candidates, including six genuinely fresh in-range or unmeasured names. None of those six survived the strict identity gate; they had same-name handles but no independent page linking the exact athlete to that handle. The run was cancelled before completing redundant scoring and created no live athletes.
- The next input-side correction keeps the 70-point/two-signal identity gate unchanged. For the at-most-ten unknown identities in each enrichment batch, native Instagram search remains the cheap locator, and only candidates without an independent handle source receive one bounded OpenAI grounded web pass. The already-measured precheck handle is immutable during that pass; a same-name web result may strengthen it only when it publishes the same handle, never silently replace it. A separate consistency fix accepts a verified exact-name handle with live sport evidence plus external athlete/sport proof even when the Instagram display name contains harmless decoration such as a flag emoji. Full-profile audience misses are rejected before age/dossier/scoring spend. This must be proven on fresh candidates before another full development scoring run.
- The 60-person volleyball pool was still dominated by roster and league sources: 35 measured profiles were below 30K, nine were in range, and eight of those nine came from prior quality memory. Wave two is therefore now an explicit creator-first lane for every sport. It searches current creator/NIL/personal-brand/audience sources first, requires separate official competition proof, refuses roster-only filler, and requests an exact consulted Instagram/business/creator URL before admitting a name. This changes candidate sourcing, not scoring.
- **2026-08-16 creator-first proof:** evaluation run `b82c0dfe-ed52-4655-a321-98b29b2c74a4` sourced 46, measured 44 audiences, found nine in-range profiles, admitted 11, and enriched seven verified in-range identities. Six of the seven were fresh. Rebekah Allick and Anna DeBeer are genuinely new exact-handle recoveries; Merritt Beason, Asjia O'Neal, Brooke Nuneviller, and Madisen Skinner were freshly rediscovered through creator/commercial sources. Six scored and zero qualified, so the workflow correctly did not pad. The measured downstream blockers were two missing second age sources, one invalid Sonnet response, one public contact-route failure, and one sampled source re-fetch failure. Madisen and Brooke reached blind audit but were demoted to 74 and 73. The run was cancelled before live persistence and isolation remained perfect: all 46 candidates were test data, zero athlete rows, and zero notifications.
- The creator-first wave materially improved fresh in-range input yield from one to five before identity enrichment and produced six fresh enriched dossiers. The next input work should therefore target second-source age retrieval, actionable public contact-route evidence, and source re-fetch resilience. Do not weaken the identity, age, creator, commercial, or audit gates.
- Cancellation is now checked between every five-candidate scoring and audit batch. A stop request may finish the current bounded batch but no longer continues through the remaining shortlist.
- **2026-08-16 saved-dossier replay:** run `5a00ce6f-6eec-4497-b9e4-aaf808a3bfe1` skipped discovery and Instagram, re-scored six saved dossiers, audited two priority candidates, and returned one genuine finalist: Brooke Nuneviller at 82 (`corrected`). Brooke passed identity, corroborated 21+, momentum, audience, creator, public commercial-route, source, and claim gates with zero critical gaps. Madisen Skinner was correctly rejected at 73 after the sampled Volleybox source could not be re-fetched. Anna DeBeer and Rebekah Allick remained below 80 because no honest second public age source was found. All five candidates in the first scoring batch returned valid structured output after the Sonnet allowance increased from 1,800/3,600 to 3,600/7,200; this fixes the measured `stop=max_tokens` extraction failure without adding attempts or weakening the schema.
- The replay created zero live athletes and zero notifications; all 46 run candidates retained `is_test_data=true`. It used 37,484 Researcher input / 12,503 output tokens and 14,594 audit input / 5,142 output tokens. Social Blade returned the same 65-credit balance for both cached exact-handle audits.
- Two replay-integrity defects are now closed: an isolated scoring failure persists the full paid enrichment dossier for a later checkpoint fork, and blind/review score corrections are never upward-calibrated. The application may admit a fully evidenced Researcher proposal to the qualified band before audit, but the Auditor remains a true ceiling; a textual correction from fit 86 to 82 must store 82, not 86.
- Audit-only replay `eed42c0b-cc05-4ff8-b3ef-3ad026d6f219` exposed two additional durability/calibration defects. The scoring stage's completed audit was being repeated by the persistence stage, and a blind model's diagnostic note about a likely stale third-party follower count was being converted into a critical unsupported-claim veto even though `source_verification_passed` and the sampled re-fetch both passed. Persistence now reuses the first audited checkpoint. Free-form blind limitations are stored as high-severity diagnostics, while deterministic material-claim failure remains tied to the source-verification gate and application-controlled sampled re-fetch.
- **Final audit-only proof:** run `36ed8148-d0c0-4479-97cf-83e27ef4103d` completed with exactly two `research_audits` rows—one per priority candidate, not two passes per candidate. Brooke Nuneviller finished as a corrected 81-point finalist (fit 82, achievability 76, confidence 85); Madisen Skinner remained failed at 74. The run returned one rather than padding to ten, repeated no discovery/Instagram/Researcher calls, used 14,550 Auditor input and 7,505 output tokens, and recorded approximately $0.104 of Auditor cost. All 46 candidates were test data and zero live athletes were created.

- **2026-08-15 input-yield checkpoint:** production at that checkpoint was `4d7ea24`, deployed `READY` as `dpl_4eQQoEvnWbK3nwHTwx9DRY1rAmHH` on `crm.prime-champs.com`. Bounded volleyball smoke `1fa86349-36f9-4e48-b504-80522dc94e5d` sourced 31 candidates, measured 12 candidate audiences before selection, selected six without admitting any measured 30K–500K audience miss, enriched four valid Instagram identities, scored four, and returned two independently audited finalists. Devon Newberry and Emma Halter each finished at 82; Devon was evidence-corrected and Emma passed. Camilla Lamina remained 63 and Flormarie Heredia Colon 62. Returning two rather than padding to three is correct.
- Apify's Instagram user-search Actor did not actually populate `followersCount` in the live result payload despite its published output schema. The workflow now performs a bounded Instagram profile-metadata precheck before choosing the paid enrichment pool. A measured out-of-range audience is a hard pre-enrichment rejection; an unmeasured audience remains eligible so partial provider coverage cannot silently erase a valid athlete. The complete 31-person source pool remains stored in `raw_results` instead of being overwritten by the six-person enrichment shortlist.
- Durable phase updates are now monotonic and retain the later phase/stats when an earlier workflow step replays. The verified smoke history is exactly `discovering_candidates -> enriching_instagram -> scoring -> saving_candidates -> completed`; it contains no backward or duplicate transitions. Instagram precheck was also executed only once.
- The rotated Social Blade pair is authenticated in production. The newest audit lane checked exact handles for Madisen Skinner and Brooke Nuneviller, reported 66 then 65 credits remaining, and safely treated the absence of a qualifying 30-day trend as neutral. Social Blade exposes the current balance but not an attributable per-request charge in this response; the CRM must not compare that balance with an older evidence row and label all intervening audit usage as a connection-check charge.
- Full validation at this checkpoint: typecheck, 159 unit tests, lint with zero errors (53 existing warnings), and the Next.js production build pass. Post-run database isolation counts are zero live athletes, zero candidates missing the test-data flag, and zero notifications. Static regression also prohibits draft, message, queue, and outreach writes from the evaluation workflow.
- **2026-08-15 live-research proof:** production `main` is at `b5ff137` and Vercel deployment `dpl_DohtgLhKJ6koE7ihWCH3c1GpEAQo` is `READY` on `crm.prime-champs.com`. Development volleyball run `1bd17f30-3fc7-4cc2-8ea0-83b122ce442e` sourced 64 names, capped 40 for paid enrichment, enriched/scored 17, and sent only two proposals to independent audit. It initially returned zero because the auditor treated expected private terms and a four-day audience snapshot too harshly.
- Research V2.4 now requires identity, two-source 21+, current athletic momentum, meaningful audience, substantive creator activity, an actionable public business/representation route, completed public restriction research, and zero unsupported material claims before qualified-band calibration. Owned media and unknown private rates/terms are not false prerequisites. A follower window under 30 days is neutral. Exact-handle Social Blade history is queried only for audit-shortlisted candidates; lack of a valid 30-day history is neutral.
- Audit-only replay is now a first-class durable checkpoint. It preserves the 17 completed Researcher scores and repeats neither discovery, Instagram enrichment, age research, nor Researcher scoring. It also fixed an idempotency bug that could leave rubric v4 active while attempting to insert v5.
- Initial audit-only proof `80bed462-19f3-454f-9178-0759dc53bfa4` completed in 47.4 seconds. Asjia O'Neal passed at 82 and Brooke Nuneviller was correctly rejected because no actionable public business/representation route was established. The two audits used 14,047 input and 5,688 output tokens and recorded $0.084974 estimated Sonnet cost; no Researcher calls were repeated.
- Full V2.4 enrichment-checkpoint replay `25211896-3856-4958-9bea-cacf09c98194` then re-scored all 17 existing Instagram dossiers without repeating discovery or Instagram scraping. Researcher scoring used 106,541 input / 31,879 output tokens for an estimated $0.531876. Three candidates entered audit: Asjia O'Neal, Lexy Denaburg, and Brooke Nuneviller. This exposed and fixed one legacy V1 conflict: an independently audited V2 finalist could be rejected solely by a stale subjective `objective_fit` string.
- Final audit-only proof `9b42af1e-db2f-46bf-a028-fc214cdad147` returned two genuine finalists from the 40-person admitted pool: Asjia O'Neal 82 and Lexy Denaburg 82. Both had verified identity, corroborated 21+, momentum, audience, creator, commercial, and source gates; zero critical gaps; and zero unsupported sampled claims. Brooke remained correctly rejected at 74 because commercial access was incomplete. The three audits used 21,810 input / 7,797 output tokens and recorded $0.121590 estimated cost; no Researcher calls were repeated.
- Current `main` also removes neutral short/baseline audience-history absence and exact-match OnlyFans `not_found` facts from the displayed `concerns` list while retaining real audience-scale or creator-evidence risks. Evaluation isolation was re-proven: zero candidates linked to live athletes, zero run notifications, zero message drafts, zero outreach messages, and zero outreach queue rows. Perplexity remains quota-exhausted (`401`) and optional; OpenAI web discovery continues successfully without it.
- **Interpretation:** scoring/audit calibration and safety now behave correctly on this bounded volleyball pool, but the goal is not production-ready. Two of 40 admitted candidates became genuine finalists. The next measured work is input-side yield—canonical deduplication and a larger, cheaper pre-ranked official-source pool—followed by fresh locked development/held-out proof and cross-sport evaluation. Do not lower gates to manufacture ten.
- **2026-08-15 verified baseline:** production commit `678b90d` runs benchmark runner v29. Development replay `3cd5a04c-85ce-4f08-9a2c-dda0f61d440b` completed all 16 revealed archive cases with latest Sonnet (`anthropic/claude-sonnet-5`) for $1.043. It returned five finalists with 100% precision, 93.75% audit-decision accuracy, 100% auditor catch, 100% finalist identity/21+/audit pass, 100% source and point-in-time compliance, and zero unsupported claims. Strong-fit recall was 62.5%.
- v29 fixes two measured failures without using labels or outcomes in prompts: a corroborated birth-date-derived age now triggers the maximum-priority-age ceiling, and `allCoreEvidenceGatesPassed` now selects a mandatory qualified-fit/high band instead of allowing subjective “reasonable reserve” drift. Murat Kazgan is still descriptively overfit, but his corroborated age deterministically caps priority at 69 and the audit pipeline records the false-finalist miss as caught.
- This is development proof on revealed archive data only. The goal remains incomplete until a fresh 8+8 cohort is locked and run once. Do not reuse or reveal an old held-out archive. The immediate data blocker remains fresh positive cutoff-safe evidence.
- **Authoritative live recovery state:** the production UI exposes 28 fresh labeled records that have never been scored: nine positive and 19 negative. Evidence readiness is `1 positive / 8 negative`. These counts supersede older pool/readiness counts later in this handoff, which are retained only as chronology.
- The rotated Social Blade credentials were validated in production using a cached exact-handle profile. The provider reported 71 credits at that earlier checkpoint; the current balance is 65 after later finalist audits. The response does not expose an attributable request charge, so do not claim that a connection check cost zero—or assign intervening audit usage to it—without provider-level billing evidence. Nineteen distinct official historical profiles have been attempted and 13 returned matched sources. The historical blocker is evidence coverage, not credential validity; do not retry exhausted handles.
- The nearest positive gaps are: Tayla Relph and Catarina Guimaraes need historical audience; Sara Fruncillo now needs only historical audience plus creator-behavior evidence; Daryn Harris still needs a second independent 21+ source. Maisey Rose Courtney, Mattia Vita, Callum Stedman, and Harry McCahill have wider age/momentum/audience/creator gaps.
- A bounded Daryn/Sara age replay reused the existing paid Apify checkpoint at zero new Apify cost, but the old workflow lacked grounded deep age discovery and archive providers rate-limited some candidates. Query plan v7 then ran one latest-Sonnet grounded adult-eligibility search per athlete for 9,449 tokens / $0.0529, zero Apify cost, and zero scoring/outreach writes. It closed 0/2: ten citations were returned, but thin citation metadata left only one Daryn bout page and no Sara pages after the early sport filter. Query plan v8 added multilingual search vocabulary and deferred sport proof for exact-name thin citations to the strict archive extractor. Its $0.0547 replay retained nine pages but closed 0/2. The next audit proved Sky's structured publication/modified timestamps are cutoff-safe and its article explicitly says “Sara Fruncillo ha 25 anni”; extraction v19 simply lacked the Italian present-tense form. Extraction v20 added only same-clause `ha N anni` and reused the saved v8 citations at zero new search cost. Extraction v21 then added a bounded browser-header retry plus secret-free diagnostics; production proved page retrieval/dating passed and isolated the remaining miss to `Formula Women`/`F2000` sport vocabulary. Extraction v22 adds those unambiguous Motorsports aliases. Nothing becomes evidence until matching sport, immutable pre-cutoff dating, explicit age text, and independent corroboration pass deterministic validation.
- Query plan v9 bought one final grounded discovery pass for Daryn and Sara: 12,079 latest-Sonnet tokens for $0.061231, zero new Apify/scoring/outreach activity, and 11 retained candidate pages including Orticalab. The archive audit then fixed four replay defects without buying more discovery: preserve grounded candidates across recovery replays; select the richest compatible checkpoint instead of the newest truncated one; sample bounded Common Crawl windows and normalize lookup hosts; and isolate Wayback/Common Crawl rate limits per source. Extraction v25 added only an attributable Italian appositive-age form such as `Sara Fruncillo, 26 anni`, with a negative regression for a different named person. Production run `01b2b797-f963-4bab-a398-6c0d401f2262` reused those 11 citations, spent zero new Apify/model/scoring tokens, and stored two supported cutoff-safe adult claims for Sara from independent `sky.it` and archived `orticalab.it` pages. Sara's age gate is closed; her remaining blocker is historical audience plus creator behavior. Daryn remains blocked on a second independent 21+ source. The run processed 2/2 with 78 safe claims and is marked `failed` only because two unrelated archive candidates were deferred after bounded provider limits; do not replay it again unchanged.
- Commit `00c482f` adds the missing owner/admin-only dated-evidence intake. The Golden benchmark now downloads a prefilled worksheet for the closest fresh-positive gaps and imports only completed rows into untouched, authoritative, never-scored records. Every row requires an exact pre-cutoff date, email subject, attachment/document reference, verbatim excerpt, explicit before-cutoff confirmation, and identity confidence. The server rejects duplicates, post-cutoff dates, wrong-workspace/locked/scored records, unattributable excerpts, and outcome/fit/deal-decision language. Low/medium identity confidence cannot score; internal age evidence remains a discovery hint and cannot clear the two-public-source 21+ gate. Importing evidence starts no model, scoring, pipeline, notification, or outreach work.

- The authoritative 100-case audit currently finds 44 evidence-ready records: 17 positive and 27 negative. It loads 1,072 sources and 2,155 claims, of which 1,657 are cutoff-safe model evidence. Point-in-time compliance is 100/100.
- Two disjoint 8+8 development / 8+8 held-out cohorts have been completed and revealed. Current assignments are 32 development, 32 held-out, and 36 excluded. Every held-out record is now archive-only and must never be tuned or reused as held-out.
- The newest full development run `ee02fd30-4b14-4851-95e0-650c35514352` passed the measured gates on 16 cases for about $0.962.
- The newest one-time held-out run `c990033d-38b0-4139-9d27-cd2dbd23bf38` completed 16 cases using `anthropic/claude-sonnet-5` through OpenRouter for about $0.942. It achieved 100% finalist identity, 100% finalist 21+, 100% source verification, zero unsupported claims, 100% point-in-time compliance, and 93.75% audit-decision accuracy. Its above-80 precision was 7/8 = 87.5%, below the required 90%; production readiness is therefore **not proven**.
- Benchmark runner v27 closes a production/benchmark parity gap. Every new development run now snapshots the active approved weekly recruiting thesis, rejects candidate-specific thesis text, stores its exact SHA-256 identity, and gives the same immutable business context to the Researcher and both Auditor stages. The thesis cannot satisfy a candidate evidence gate. Held-out must reuse the exact development snapshot and the same still-current latest-Sonnet provider route; a model release change forces a fresh development run. This is implemented and tested but has not been scored because no fresh evidence-ready cohort exists.
- The single above-80 false positive was Murat Kazgan. His packet safely proved identity, age, momentum, audience/creator behavior, and accessibility. The later outcome said the opportunity was rejected because his OnlyFans profile had not been active, but no pre-decision evidence in the packet disclosed that fact. This is an observability miss, not a fabricated claim.
- The audit now measures OnlyFans-platform observability explicitly: 0 active, 0 inactive, and 100 not observed across all 100 historical cases. Absence therefore remains neutral. Turning missing platform data into an automatic failure would eliminate every positive example and manufacture precision from unavailable information.
- The remaining fresh pool contains 12 positive and 24 negative records; none is currently evidence-ready. A third proof needs at least eight evidence-ready records per label. The positive side is the binding constraint.
- The latest excluded-positive recovery run processed nine priority records, consulted 43 grounded sources, inserted 74 archived sources / 232 safe claims, spent $0.0885 on Apify and about $0.2562 on latest-Sonnet grounded discovery, and made zero scoring or outreach writes. It produced 0/9 evidence-complete packets. Do not replay it unchanged.
- Production now recognizes `SOCIAL_BLADE_CLIENT_ID` and `SOCIAL_BLADE_TOKEN`. Nineteen distinct profiles have checkpointed official attempts; 13 produced cutoff-safe matches and six did not. The last provider response reported 71 credits remaining. Social Blade's own terms state that history begins only when Social Blade first starts tracking a profile, so extended/archive/vault cannot reconstruct earlier dates that were never collected. Do not repeat failed handles.
- Official-response failures now persist secret-free handle/date diagnostics, and the benchmark UI distinguishes “no eligible paid-history lookups” from successful evidence completion.

## Non-negotiable product intent

- Research is the highest-priority CRM capability.
- Optimize for emerging/upcoming athletes with current momentum, a meaningful direct audience, concrete creator behavior, and realistic accessibility—not famous veterans or old Olympic résumés.
- The current recruiting channel is OnlyFans. Never infer willingness to create adult content from appearance, clothing, identity, sexuality, or stereotypes.
- Never pad a run to ten. Zero or fewer than ten is correct when the evidence is insufficient.
- Latest Sonnet is the scoring/audit model policy. Do not pin an older release after a newer compatible Sonnet is available.
- No outreach, DMs, comments, drafts, email, notifications, or live pipeline promotion during testing.
- Be conservative with paid API calls. Diagnose a failed checkpoint before rerunning it.

## Authoritative historical labels

Dylan's 100-row workbook is the sole commercial ground truth for the core benchmark:

| Historical outcome | Count | Ground-truth class |
|---|---:|---|
| Signed | 41 | Positive |
| Approved but Did Not Sign | 3 | Positive |
| Rejected | 23 | Negative |
| Stalled | 33 | Negative |
| **Total** | **100** | **44 positive / 56 negative** |

Do not perform another subjective blind-label exercise on these records. Do not let an older seed label override Dylan's outcome. The historical outcome is revealed only after model predictions are locked.

Current enriched source workbook:

`/Users/zacharyvanheyningen/Library/Messages/Attachments/be/14/E5D20F7E-E020-4955-9E02-C247E30452A2/OnlyFans_Athlete_Historical_Benchmark_Enriched.xlsx`

This workbook was validated and imported on 2026-08-12. The original workbook remains at `/Users/zacharyvanheyningen/Library/Messages/Attachments/0c/12/CFBA99F0-A4B3-4AD6-A4B4-EA3D65C540A7/OnlyFans_Athlete_Historical_Benchmark.xlsx` and is the locked comparison source. All 100 original benchmark rows and all 100 Evidence Index rows match it exactly. Do not replace `Not available` values with guesses or current/post-decision data.

Import code checkpoint: `3e6b90d` — `Import enriched historical benchmark evidence`.

## Current production checkpoint

- Previously verified production-gate checkpoint: `176365551120fbfab3357ae5618da201b8e62086` — `Require source-backed research finalists`.
- Current code checkpoint is `00c482f` (`Add guarded historical evidence intake`) on top of the bounded recovery fixes from `c09ce37` through `9118a32`. Confirm its Git-triggered Vercel deployment is `READY` before using the worksheet in production.
- Production alias is attached to `crm.prime-champs.com`; `/` returns a 307 to login and `/login` returns 200.
- Active prompt version: `research-v10-corroborated-identity-and-21-plus-gates`.
- The 2026-08-12 smoke run resolved `claude-sonnet-5` dynamically through Anthropic's model catalog.
- Typecheck and the full production build pass; all 139 unit tests pass. Full repository lint has zero errors and 53 pre-existing warnings unrelated to this checkpoint.
- Local Turbopack production builds can hang after compilation on this machine. Vercel's exact Git production build is the authoritative build proof and is green.

## Completed bounded smoke run

- Research log ID: `6c898a22-c961-4612-8c5b-7dd14517c2a3`
- Workflow run ID: `wrun_01KZW158HR29B55RAKXDFJWEGQ`
- Sport/profile: volleyball / `smoke`
- Hard budget: one discovery wave, eight requested discovery candidates, no more than six Instagram enrichments, three requested finalists, no more than three audits.
- Mode: `is_evaluation = true`; no live-pipeline writes are allowed.
- Final status: `completed` at `2026-08-12 22:28:22.648+00`, with no workflow error.
- Final funnel: 44 sourced, six admitted discoveries, four Instagram-enriched and scored candidates, zero qualified finalists, and zero returned finalists. The historical row stored `quality_passed=false` under the former quota-based meaning; current code correctly treats a short or empty safe list as a no-padding quality pass and reports coverage separately through `targetMet`/`shortfall`.
- Scored candidates: Devon Newberry 79, Madisen Skinner 77, Mimi Colyer 77, and Anna DeBeer 68. No Researcher proposal exceeded 80, so triggering zero paid blind audits was expected and correct.
- Anthropic usage was 21,887 Researcher input tokens and 3,620 output tokens across four scored candidates. Audit token usage was zero. Apify recorded four Instagram profiles, one Instagram search run, and one batched age run. The run stored provider operations but not a reliable all-in dollar total; do not invent one.
- Isolation was proven after completion: zero live athletes created, zero candidates missing the test-data flag, and zero completion notifications.
- Interpretation: the engine failed closed instead of manufacturing finalists. Safety is working. Candidate sourcing and evidence coverage still need improvement before the system can reliably produce genuine 80+ opportunities.

Read-only status query:

```sql
select
  status, phase, heartbeat_at, completed_at, error_message, stats,
  jsonb_array_length(coalesce(raw_results, '[]'::jsonb)) as raw_count,
  jsonb_array_length(coalesce(scoring_details, '[]'::jsonb)) as checkpoint_count,
  jsonb_array_length(coalesce(final_results, '[]'::jsonb)) as finalist_count,
  provider_costs
from public.research_logs
where id = '6c898a22-c961-4612-8c5b-7dd14517c2a3';
```

Isolation proof queries (already run successfully; retain for reproducibility):

```sql
select count(*) as live_athletes_created
from public.athletes
where source_research_log_id = '6c898a22-c961-4612-8c5b-7dd14517c2a3';

select count(*) as candidates_not_marked_test
from public.research_candidates
where research_log_id = '6c898a22-c961-4612-8c5b-7dd14517c2a3'
  and is_test_data is not true;

select count(*) as completion_notifications
from public.activity_notifications
where metadata->>'runId' = '6c898a22-c961-4612-8c5b-7dd14517c2a3';
```

All three counts were zero. For later runs, if a workflow errors, use its durable phase/raw/scoring checkpoint and the existing resume/fork functions; do not buy discovery and enrichment again blindly.

## How the live evaluation agent works

```mermaid
flowchart TD
  A["Sport request + active recruiting thesis"] --> B["OpenAI live web discovery"]
  B --> C["Official-source sport and recency gates"]
  C --> D["Apify Instagram identity + profile enrichment"]
  D --> E["Source-linked adult age research"]
  E --> F["Latest Sonnet Researcher"]
  F --> G["Exact dossier citations for momentum + creator behavior"]
  G --> H["Pre-audit priority held at 79"]
  H --> I["Blind Sonnet Auditor + independent search + 20% claim refetch"]
  I --> J["Researcher / blind audit / review minimum score"]
  J --> K{"Every deterministic final gate passes?"}
  K -- "No" --> L["Hold/reject; return fewer candidates"]
  K -- "Yes" --> M["Corrected score >80; evaluation result only"]
```

Key behavior:

1. Discovery uses live, cited sources and sport-specific strategies.
2. Identity requires an attributable personal Instagram profile and at least 70 confidence.
3. Audience data comes from the verified Apify profile, not an LLM estimate.
4. The Researcher must return exact URLs and matching excerpts for current athletic momentum and creator behavior.
5. The code validates those citations against the frozen dossier text.
6. A meaningful audience requires the active follower minimum or a bounded exception: at least half that minimum (never below 10,000) plus at least 4% engagement.
7. A Researcher proposal above 80 is stored/displayed as 79 until independent audit.
8. The blind Auditor independently checks identity, 21+, momentum, audience, creator behavior, source support, contradictions, and complete access/representation/economics constraints.
9. At least 20% of non-social material sources are re-fetched. Any unsupported sample fails closed.
10. Final dimensions are the minimum of the Researcher, blind Auditor, and review correction. Audit can only hold or lower a score.
11. Objective guardrails apply after correction, so veteran/weak-objective profiles cannot be raised by audit.
12. Evaluation mode writes research evidence/scores/audits only. It exits before athlete insertion and suppresses completion notifications.

## Final >80 gate in code

Every condition is mandatory:

- Corrected priority `> 80`.
- OnlyFans fit `>= 80`.
- Commercial achievability `>= 70`.
- Research confidence `>= 80`.
- Identity confirmed.
- Source-verified age `>= 21` and independent Auditor eligibility pass.
- Source-backed current athletic momentum and independent Auditor pass.
- Meaningful measured audience and independent Auditor pass.
- Source-backed creator behavior and independent Auditor pass.
- Commercial constraints complete.
- Material claims verified with zero unsupported claims.
- Audit verdict is `pass` or evidence-corrected, with zero critical gaps.
- Public, active Instagram; strong objective fit; no veteran profile.

Primary implementation files:

- `dashboard/src/app/api/research/run/workflow.ts` — discovery through evaluation-only persistence.
- `dashboard/src/lib/research/v2-scoring.ts` — score math, pre-audit hold, audit ceilings, citation matching, audience gate, final gate.
- `dashboard/src/lib/research/scoring.ts` — objective guardrails and prompt version.
- `dashboard/src/lib/research/evaluation-runs.ts` — bounded evaluation launch/resume/forks.
- `dashboard/src/lib/research/evaluation-budget.ts` — smoke/development/release hard budgets.
- `dashboard/src/lib/research/benchmark-runner.ts` — historical development/held-out model stages and checkpoints.
- `dashboard/src/lib/research/benchmark-runner-support.ts` — benchmark evidence/finalist gates, leakage controls, metrics, cost accounting.
- `dashboard/src/lib/research/historical-social-snapshot.ts` — strict pre-decision mailbox snapshot validation.
- `dashboard/src/lib/research/historical-instagram-history.ts` — exact-handle, pre-cutoff reuse of already-paid Apify profile snapshots.
- `dashboard/src/lib/research/social-blade-history.ts` — exact-handle Social Blade tier selection and cutoff-safe daily metric normalization.
- `dashboard/src/app/api/research/golden-records/social-blade-history/route.ts` — owner-only, one-profile-at-a-time historical audience pilot with an explicit per-checkpoint credit ceiling and five-attempt stop.
- `dashboard/src/lib/research/historical-workbook-converter.ts` — deterministic extracted-workbook conversion and locked-source comparison.
- `dashboard/scripts/convert-onlyfans-historical-workbook-extraction.ts` — converts spreadsheet-tool extraction JSON into the importer's 100-record contract.
- `dashboard/scripts/import-onlyfans-historical-benchmark.ts` — dry-run/apply importer with required backup.
- `dashboard/scripts/audit-onlyfans-historical-benchmark-readiness.ts` — read-only evidence/readiness audit over the stored 100-record dataset.
- `dashboard/tests/research-v2.test.ts` — benchmark, leakage, scoring, audit, and isolation regression suite.
- `docs/research-v2-benchmark-runbook.md` — execution and release rules.

## Model and connector policy

- Production discovery: `OPENAI_RESEARCH_MODEL`, currently defaulting to `gpt-5.6`, using Responses web search.
- Production scoring and blind audit: latest Sonnet resolved from Anthropic's live model catalog; do not allow an old user selection to pin a stale release.
- Historical benchmark: OpenRouter latest structured-output Sonnet is preferred when configured; direct Anthropic is fallback. Exact provider/model/release/price is stored per run.
- Benchmark business context: the same active approved weekly recruiting thesis used by production is frozen into development. Held-out reuses that exact snapshot; changing the thesis or latest-Sonnet route requires a fresh development baseline.
- Identity and Instagram metrics: Apify exact-name search plus separate profile verification.
- Perplexity is an optional degraded fallback, not the primary discovery path.
- Modash is intentionally deferred; the $10k-$16.2k annual API cost is unjustified. Social Blade is the bounded historical-audience recovery lane: its official Business API exposes Instagram daily follower/post/engagement history, with one-year `extended` requests costing at most two credits per profile. Seventeen excluded-positive records now have cutoff-safe exact handles, all with cutoffs within one year as of 2026-08-13.

Required environment-variable names are documented in the app/Vercel configuration. Never print, paste into chat, log, or commit their values. Important names include `OPENAI_API_KEY`, `APIFY_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `SOCIAL_BLADE_CLIENT_ID`, `SOCIAL_BLADE_TOKEN`, Supabase server credentials, and `RESEARCH_EVALUATION_SECRET` or `CRON_SECRET`.

## Historical benchmark status (older chronology; current counts are above)

- Dylan source truth: 100/100 outcomes, 44 positive and 56 negative.
- Enriched workbook validation: zero locked-source differences, zero duplicate names/refs, 748 detail ledger rows covering all 100 athletes, zero post-cutoff rows, and 420 usable claim rows across 76 athletes. The other 24 correctly contain only `Not available` audit notes.
- Controlled import: 100 updates, zero creates, zero conflicts, 420 deterministic detail sources and 420 detail claims. All 420 sources are cutoff-safe, 406 claims are scoring-eligible, 12 medium-confidence claims remain excluded, one mailbox age hint remains excluded, and one outcome-like commercial excerpt remains excluded. Zero eligible outcome-like claims and zero future claims were found after import.
- The corrected audit reads evidence claims in bounded batches instead of silently stopping at Supabase's default 1,000-row response cap. After archive-signal attribution hardening, it finds 28 total evidence-ready records.
- Existing assignments are 16 development records, 16 already-revealed held-out records, and 68 fresh excluded records. Of the fresh excluded pool, zero positives and all 16 required negatives are evidence-ready.
- The fresh cohort route requires 16 evidence-ready records per label before it can freeze eight fresh held-out examples per label. The immediate gap is therefore 16 excluded positives and zero excluded negatives.
- Six records still have unresolved sport. Audience-at-decision and independent age/identity corroboration are the largest gaps.
- One capped excluded-positive recovery run (`81896c04-9f22-4c30-ac68-4845abafa6ab`) spent $0.061 on a single saved Google discovery batch, processed seven records before the Internet Archive rate-limited, and added 27 safe claims. It recovered identity/momentum/creator details but zero audience claims. A zero-new-spend replay of the remaining three records on 2026-08-13 also hit the Wayback rate limit before processing any record. The workflow now reuses this paid checkpoint with two bounded free fallbacks: the latest Wikipedia article revision at or before the cutoff through MediaWiki's revisions API, and at most two pre-cutoff Common Crawl collections with one indexed WARC byte range per candidate. Both use the same deterministic extractor and provider-specific provenance. A Wikipedia revision counts as one independent source. Wayback cooldown is retained as telemetry but does not block these fallbacks.
- Lola Gallardo recovery run `2ec96854-ebc2-40a5-af76-b6cdcabbdd57` reused saved discovery with zero new Apify spend and zero scoring tokens. It cleared every blocker with eight independent sources and 30 run-safe claims after narrowly supporting the actual `Football / soccer` label and ESPN's archived `Lola Gallardo [she/her], 28, has...` syntax.
- The final three-record negative recovery run `7f507de9-7d8e-47ff-870b-9a37629bb64e` processed Murat Kazgan, Christen Press, and Sadio Doumbia for $0.0185, zero scoring tokens, and zero live writes. All three became evidence-ready, closing the required fresh negative cohort at 16.
- A subsequent material-claim audit found 95 archived momentum, audience, or commercial claims whose pages mentioned the athlete but did not explicitly attribute the claimed signal to them. Those claims were retained for provenance but atomically marked unsupported and ineligible via an idempotent audit; zero sources were deleted and zero live/outreach tables were touched. The benchmark gates now also refuse generic candidate evidence unless its signal is tied to the named athlete in the same sentence or an immediately following pronoun sentence. After three additional exact-handle archive packets, the corrected global audit is 28 ready cases, 1,203 safe claims, 910 sources, 100/100 point-in-time compliance, and fresh excluded readiness of `0 fit / 16 not-fit`. Lola now correctly fails only the historical-audience gate.
- Existing Apify Instagram history was then scanned without starting new Actor runs. Fourteen positive records initially had exact, pre-cutoff handle evidence, but zero matching stored profile snapshots existed before their cutoffs. Strict archived-page extraction subsequently added source-backed handles for Tessa Thyssen, Crystal Pittman, and Catarina Guimaraes, bringing the recoverable excluded-positive pool to 17. Do not reinterpret current or post-cutoff scrapes as historical evidence.
- Free audience-history alternatives were exhausted without a usable snapshot. Exact Social Blade and Instagram profile URLs for five priority handles had no near-cutoff Common Crawl capture; Wayback had none except one 2016 Instagram page that was far too stale. The community Actor `gordian/instagram-profile-history` was then tested behind an owner-only one-profile/$0.02 ceiling. Its diagnostic Carlos Gimeno run `pSDkS9ZAuBh9nNglv` returned no account and zero history rows at $0.0000. The experimental route and UI control were removed rather than leaving dead product surface.
- Social Blade is the next measured pilot. All 17 known positive cutoffs fall between 2025-08-21 and 2026-08-05, so the official API needs at most 34 credits for all records. The paid route must process exactly one profile per checkpoint, persist failures so they cannot be retried, and stop after five total profiles. Audit match/readiness gain after every profile before continuing.
- The original revealed cohort `onlyfans-athlete-v1-2026-08-12-149b1a6e` must never be reused as held-out.
- Original held-out run `8ddf4794-9107-4d97-ade1-e1b027b9b6f9` completed 16/16 for about $0.813. It safely returned no >80 finalists but achieved only 50% audit decisions, so it did not prove production readiness.
- A fresh held-out cohort must be locked only after development calibration is frozen.
- On 2026-08-13, exact-handle archive recovery pilot `b224d92c-2881-49ac-9416-3b432aabe023` tested Carlos Gimeno, Gaston Reyno, and Daryn Harris. Google discovery cost $0.0285, found 24 URLs, spent zero scoring tokens, and made zero outreach writes, but produced `0/3` new freeze-ready packets. The audit found one false publisher-footer Instagram handle (`@world_aquatics`); that claim was quarantined as unsupported and the extractor now rejects non-name-matching handles unless the archived text explicitly says the post was shared by the athlete. Post-cleanup readiness remains `0 fit / 16 not-fit` in the fresh excluded pool, so do not repeat this query strategy broadly.
- The low-cost no-login Apify Social Blade actor was rejected for this use case after documentation review: Instagram history is premium-gated and returns null. Current Instagram profile scraping is not point-in-time evidence. The viable historical-audience path remains the direct Social Blade Business API (bounded five-profile pilot) or another provider that can prove a pre-cutoff snapshot—not a present-day count.
- A second public-history Actor (`solidcode/socialblade-scraper`) was then tested only against the 31-day window under a one-profile/$0.50 hard ceiling. Lola Gallardo returned no usable dated row at $0.00000. Crystal Pittman returned one current profile row but no daily history row at $0.00005 (run `CM0aPeHQc5THgvygj`). Both failures are stored as ineligible diagnostics, never scoring evidence. The lane now closes automatically after two no-match attempts; do not run the remaining recent profiles through it.
- The direct Business API adapter was rechecked against Social Blade's current official documentation. Instagram history is returned at `data.statistics.daily` (not the older flat `data.daily` assumption); the adapter and regression fixture now use that official shape while retaining a safe fallback. Authentication remains server-header-only. Paid execution is checkpointed one exact handle at a time, every failure is stored as ineligible diagnostic evidence, attempted records are excluded from retries, and the lane closes after five total attempts.

## Exact next sequence

### 1. Preserve the completed smoke baseline

- This is complete. Do not rerun it merely to obtain a non-zero result.
- Use log `6c898a22-c961-4612-8c5b-7dd14517c2a3` as the fail-closed smoke baseline.
- No candidate exceeded 80, no blind audit was eligible, and the three isolation counts were zero.
- The next paid work should follow the enriched-workbook import and a deliberate development-benchmark plan.

### 2. Preserve the completed enriched-workbook import

- This is complete. Do not re-import unless a genuinely newer source workbook arrives.
- The two local pre-import backups are under `dashboard/data/backups/` and intentionally ignored by Git because they contain internal data.
- The first apply attempt stopped on the third golden record because the old revealed held-out lock rejected a split reset. It wrote the backup first and no detailed evidence before stopping. The importer was corrected to preserve all existing cohort assignments, passed a second dry-run, and then completed idempotently.
- Database post-proof: 100 golden records, exact `41/3/23/33` outcomes, 420 detail sources, 420 detail claims, zero future claims, zero eligible outcome-like claims, and old `16 development / 16 revealed held-out / 68 excluded` assignments preserved.
- Raw workbook extraction JSON, converted records, and backups live under `dashboard/data/` and are intentionally ignored. Never commit them.

### 3. Recover only the missing fresh-cohort evidence

- Run `npm run audit:historical-benchmark` before and after each recovery batch.
- Work only on excluded, never-evaluated records intended for the next cohort. Do not change or reuse the revealed held-out cohort.
- Reach at least eight evidence-ready, never-scored positives. Eight never-scored negatives are already ready. Current state is `1 positive / 8 negative` for the challenge quota; the eight new cases plus Daryn Harris are the bounded positive recovery pool.
- Run the combined fresh-positive recovery first because every new case already has momentum and creator behavior, but all need public identity and age corroboration and six need audience evidence. Do not score any case until the readiness audit passes.
- Use bounded evidence-preparation batches; inspect each batch before the next. Do not run Researcher/Auditor scoring during evidence recovery.
- Do not buy another Google/archive discovery run or another community Apify Actor for the same audience gap: every measured free/cheap path produced zero usable historical audience rows. Replay the saved checkpoint through cutoff-safe MediaWiki/Common Crawl only for non-audience identity, age, momentum, or creator evidence; stop if the readiness audit shows no gain.
- Configure the server-only `SOCIAL_BLADE_CLIENT_ID` and `SOCIAL_BLADE_TOKEN`, then run only the single profile shown in the Golden benchmark UI. The request must explicitly confirm that profile's exact credit ceiling. Accept only exact handles and Social Blade daily rows no more than 31 days before the decision cutoff. Reload and audit readiness before authorizing another profile; the route will not retry an attempted record and closes automatically after five attempts.
- A mailbox statement can seed a query but cannot satisfy two-source age. Medium/low identity claims and outcome-like commercial excerpts remain non-scoring.

### 4. Build the development benchmark

- Recompute readiness from actual evidence, not provider-run counts.
- Keep source-of-truth labels hidden from prompts.
- Keep the prior revealed `8 fit + 8 not-fit` benchmark run as development-only calibration. Never relabel it as held-out.
- After eight fresh positives are ready, let challenge mode deterministically lock eight fresh positives plus eight fresh negatives as the new unrevealed held-out cohort.
- Replay development only when code/model/prompt calibration changes justify it; do not reveal the fresh cohort during recovery.
- Audit false positives, false negatives, unsupported claims, identity errors, age errors, criteria drift, and Auditor misses.
- Change one major variable at a time and retain only measured improvements.

### 5. Freeze and prove release

- Freeze prompt, rubric, evidence policy, model route, weighting, and development decision before revealing the held-out split.
- Run the fresh locked held-out cohort once.
- Production readiness requires non-zero denominators and all of:
  - 100% finalist identity accuracy;
  - 100% finalist 21+ accuracy;
  - zero unsupported material finalist claims;
  - at least 90% precision among predictions above 80;
  - at least 90% audit pass/catch accuracy;
  - complete point-in-time compliance.
- Then run evaluation-only sport requests across different sport archetypes. Returning fewer than ten remains correct.

## Verification commands

Run from `dashboard/`:

```bash
npm run typecheck
npm run test:unit
npm run audit:historical-benchmark
npx eslint src/app/api/research/run/workflow.ts src/lib/research/scoring.ts src/lib/research/v2-scoring.ts tests/research-v2.test.ts
```

Before changing files:

```bash
cd /Users/zacharyvanheyningen/Projects/primechamps
git status --short --branch
git log --oneline -12
```

The last fully deployed checkpoint before the Social Blade adapter is `27b3ee7`. Use `git log --oneline -12` for the newest documentation/push commit above it.

## Known traps

- Do not call an internally stored outcome, fit explanation, or post-decision email public research evidence.
- Do not count the 24 `Evidence Availability Notes` rows as evidence; they are audit records explaining that no eligible enrichment was found.
- Do not treat mailbox age evidence as a finalist age source or medium-confidence identity matches as scoring evidence.
- Do not reset a record's old benchmark split during an evidence import. The importer preserves it; a fresh split is created only by the explicit cohort-freeze route.
- Do not reuse the revealed held-out cohort.
- Do not use a provider run or profile scrape as proof that audience/creator evidence exists; inspect the actual normalized claims.
- Social Blade proves metrics for an exact public handle; it does not independently prove that the handle belongs to the named athlete. Never generate an identity claim from Social Blade alone.
- Do not accept model-generated creator strings without exact URL/excerpt matching.
- Do not let the review stage raise either the Researcher or blind-Auditor score.
- Do not treat a 79 pre-audit hold as a weak score; inspect `researcher_proposed_score` and audit eligibility.
- Do not run development/release profiles in parallel until the smoke path is understood.
- Do not retry discovery/enrichment when a durable fork/resume checkpoint can be reused.
- Do not mark the project production-ready because tests and deployment are green; the locked held-out acceptance thresholds remain unproven.
- Benchmark runner v27 requires exact frozen-dossier quotes for every material claim, gives the comparison-stage Auditor the dossier, constrains every corrected dimension by the Researcher and blind Auditor, reapplies the complete final gate, and freezes the same candidate-blind weekly recruiting thesis across development and held-out. It also refuses held-out if the latest-Sonnet model/provider route changed after development. The server refuses held-out creation until a complete same-cohort development run passes the full release threshold set. Revealed cohorts are archive-only; all scoring routes resolve exactly one current locked, unrevealed Dylan-ground-truth cohort and fail closed if none or more than one exists. These controls are implemented and tested but remain unproven on a fresh held-out cohort.

## Definition of the next clean stopping point

The next agent should aim to finish with:

1. At least eight evidence-ready fresh excluded positives and eight evidence-ready fresh excluded negatives.
2. A new deterministic cohort with eight per label locked held-out and unrevealed.
3. Development metrics and failure classes recorded after at least one controlled iteration.
4. No held-out reveal until the configuration is frozen.

The current Codex stopping point is intentionally clean: Dylan's workbook is validated/imported, database state is verified, the fail-closed smoke baseline is preserved, no live athletes or outreach were created, and no next paid benchmark run has started. Resume with targeted evidence recovery, not scoring.
