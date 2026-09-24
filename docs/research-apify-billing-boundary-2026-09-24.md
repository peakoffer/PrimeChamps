# Apify billing boundary — 24 September 2026

## Decision in one paragraph

Apify remains suitable for our Instagram and other profile enrichment. The unresolved issue is **the scope of the strict campaign spending promise**, not an invalid API key or evidence that these actors are expensive. A provider-enforced run ceiling, separately reserved result retrieval, and future storage are different charges. The current strict evaluation adapter blocks new actor starts until the last category has an approved treatment. Existing accepted runs remain recoverable; legacy runs are unchanged. This review performed no paid runs or deletions.

## Confirmed facts

| Boundary | What the official documentation establishes |
| --- | --- |
| Actor execution | `maxTotalChargeUsd` is the run-level ceiling. PPE charging stops at the limit, although shutdown is not instantaneous. This is not an account-wide limit. Normal PPE puts running platform costs on the developer; PPE + usage can instead charge the user. Recheck the actor's current pricing before admission. [Run API](https://docs.apify.com/api/v2/actors-runs-post), [PPE billing](https://docs.apify.com/actors/publishing/monetize/pay-per-event) |
| Minimum ceiling | `minimalMaxTotalChargeUsd` is the minimum **allowed ceiling**, not necessarily the minimum bill. Events actually charged determine PPE cost. [PPE spending limits](https://docs.apify.com/actors/publishing/monetize/pay-per-event#respect-user-spending-limits) |
| Result retrieval | Post-run dataset interactions incur standard platform charges under every actor pricing model. They must not be silently included in the actor's settled run amount. [Store actor billing](https://docs.apify.com/actors/running/actors-in-store#pricing) |
| Retention | Default stores are unnamed. Paid-plan retention follows account settings; named stores remain indefinitely. The generic storage page does **not** justify assuming a universal seven-day TTL. No per-run TTL parameter appears in the Run API. [Storage retention](https://docs.apify.com/storage#data-retention), [Run API](https://docs.apify.com/api/v2/actors-runs-post) |
| Permission isolation | LIMITED permissions are not a cost sandbox: actors can create additional stores and invoke other permitted actors. A scoped token can restrict resource access, but that alone is not a dollar ceiling. [Actor permissions](https://docs.apify.com/actors/development/permissions), [API token restrictions](https://docs.apify.com/integrations/api) |
| Reconciliation | Preserve the terminal run receipt and actual charging fields. Historical usage displays may recalculate values at current service prices; they are not substitutes for invoice reconciliation. [Usage and resources](https://docs.apify.com/actors/running/usage-and-resources) |

## Current actor metadata: ceilings are not charges

Read-only public metadata snapshot, 24 September 2026. All four actors reported PAY_PER_EVENT. These are not guaranteed future prices or our account's final discounted rates.

| Actor | Minimum permitted run ceiling | Example event price in current metadata, before account discounts |
| --- | ---: | ---: |
| [Instagram Profile Scraper](https://api.apify.com/v2/acts/apify~instagram-profile-scraper) | $0.0026 | $0.0026 per profile at FREE tier |
| [Instagram Post Scraper](https://api.apify.com/v2/acts/apify~instagram-post-scraper) | $0.0050 | $0.0017 per post at FREE tier |
| [Google Search Scraper](https://api.apify.com/v2/acts/apify~google-search-scraper) | $0.5000 | $0.0045 per search page plus $0.001 actor-start event at FREE tier |
| [TikTok Profile Scraper](https://api.apify.com/v2/acts/clockworks~tiktok-profile-scraper) | No minimum reported | $0.0030 per result at FREE tier |

Optional event add-ons can cost extra. In particular, Google's $0.50 minimum ceiling does **not** mean every request costs $0.50. Conversely, a caller's result-read limit does not bound every item an actor creates: the Run API explicitly distinguishes billed-item limits from actual returned items. [Run API](https://docs.apify.com/api/v2/actors-runs-post)

## What is already bounded, and what remains open

The strict adapter reserves the whole actor ceiling before starting and saves the remote run ID. A nonterminal abort stays unresolved rather than releasing its reservation. After terminal settlement, plain JSON dataset retrieval is a separate operation, bounded by an explicit item limit, the documented maximum item size, and conservative read/transfer rates. Observed retrieval bytes produce an estimated upper charge, not a provider invoice. [Dataset limits](https://docs.apify.com/storage/dataset#limits), [Platform prices](https://apify.com/pricing)

The open liability is post-run storage across dataset, key-value store, and request queue, including additional or named stores an actor may create. Published storage pricing is time- and volume-based. The docs explicitly establish charged post-run interactions but do not establish that all idle retained storage from ordinary PPE actors is free to this account. Nor have we verified our account's retention duration and exact billing treatment. **Uncertain is not the same as large or unlimited in practice; it means we cannot yet prove an all-lifetime hard dollar bound.** [Storage pricing and retention](https://docs.apify.com/storage), [Store actor billing](https://docs.apify.com/actors/running/actors-in-store)

Deleting a finished run is not documented as deleting every related store. Therefore, `DELETE run` is not an evidence-retention or cost-control shortcut. [Delete run](https://docs.apify.com/api/v2/actor-run-delete)

## Smallest defensible unlock choices

1. **Keep the all-in ceiling.** Confirm the account's post-run billing/retention terms; then implement a reviewed allowlist for pinned actor builds, track every new campaign-owned store, reserve a provable maximum storage allowance, archive necessary evidence, and reconcile cleanup. This requires an actual bound on storage volume and retention duration, including failure/retry behavior—not merely a best-effort deletion job. If those bounds cannot be established for an opaque actor, it remains unavailable under that strict promise.
2. **Approve an explicit billing boundary.** The owner can approve a run-and-retrieval test envelope while treating retention as a separate, monitored infrastructure allowance. Record that scope in the authorization and UI; never describe it as a total-lifetime provider cap. This is a change to the spending agreement, not a code-only bypass.

Neither choice authorizes changes to account-wide retention settings, deletion of old/user-owned stores, or loss of research evidence. This document grants no new spend. Meanwhile, fixed-price search diagnostics and offline fixtures can proceed independently under their existing approved authorization; they do not certify Apify enrichment or full research quality.
