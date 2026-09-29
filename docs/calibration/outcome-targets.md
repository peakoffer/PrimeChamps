# How Dylan's outcomes are scored (decided 2026-09-29, before any calibration)

Dylan's `final_outcome` values are authoritative and are **never edited**. They
answer two different questions, so calibration scores each separately.

## Why

Most `stalled` records say OnlyFans approved the athlete and the deal then did
not reach a signature or payment record by the cutoff ("OnlyFans approved …,
but no signed agreement was located"). Treating those as failures would teach
the research agent that candidates OnlyFans wanted were bad candidates. The
research agent can influence who gets pitched; it cannot see whether a
negotiation finishes or whether paperwork reached the mailbox.

## Target 1 - platform decision (what the research agent optimizes)

Derived mechanically from Dylan's own fields; no judgment is applied:

| `final_outcome` | condition on Dylan's `explanation` | platform decision |
|---|---|---|
| `signed`, `non_signing` | none | approved |
| `onlyfans_rejected` | none | rejected |
| `stalled` | contains "no OnlyFans decision" | undecided |
| `stalled` | contains the word "approved" | approved |
| `stalled` | anything else | undecided |

`undecided` records are excluded from platform-decision metrics, never guessed.
The blind hold-out receives this exact rule, applied by query, after
predictions are frozen.

## Target 2 - deal closed (reported, not optimized)

Among approved records: `signed` = closed; everything else = not closed.
Closing depends mostly on negotiation, pricing and execution, which public
pre-decision evidence rarely shows. It is reported so price, exclusivity and
timing signals can be checked, not used to tune the scorer.

## Honest limits

- Calibration set (70): 52 approved, 16 rejected, 2 undecided; 29 of 52
  approved deals closed. Blind set (30) is not inspected until evaluation.
- **Base rate:** OnlyFans approved 76% of calibration pitches. "Approve
  everyone" already scores 76% precision, so a scorer earns credit only by
  clearly beating that, and by catching the rejection patterns.
- These are athletes Prime Champs already chose to pitch. The data shows what
  separates approved from rejected pitches; it cannot show how athletes who
  were never pitched would have fared.
- 100 records is small. Thresholds from it are directional; every metric is
  reported with its count, never as a bare percentage.
