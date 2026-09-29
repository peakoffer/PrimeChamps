# Blind-run pre-registration (written 2026-09-29, before any blind scoring)

## Calibration results (68 records: 52 approved, 16 rejected; base rate 76%)

| Arm | AUC | >=50 precision | >=50 approved found | >=60 precision | >=60 approved found | >=70 |
|---|---|---|---|---|---|---|
| Production Sonnet benchmark (47 of the 68) | - | - | - | 15/16 (94%) | 15/37 | - |
| A neutral | 0.66 | 35/42 (83%) | 35/52 | 15/18 (83%) | 15/52 | 4/4 approved |
| B success profile | 0.72 | 45/52 (87%) | 45/52 | 21/26 (81%) | 21/52 | 7/7 approved |

Arm B's rules were drawn from the same cases, so its calibration numbers are
optimistic. The 16 rejections were caused by: organic OnlyFans use preferred first (5),
price (3), under 21 (2), injury/no longer competing (2), reach (1), none recorded (5).
Price and "none recorded" (8) are not visible at research time.

Leak found during calibration: one workbook-detail claim (Tiara Brown) restated
the sponsor's decision reason. The blind run adds `rubrics/blind-leak-rule.md` for
every arm.

## Frozen inputs (sha256)
- rubric-A-neutral.md f3e34c2fa7104a3d5c354c81dc31fa504fda4be1b622d3f5f0b2f2bb28b203db
- rubric-B-profile.md 6d714c4596dc37afcbff5d8f1f6ba854b37643d64d103854d642ccf75d4c0099
- rubric-C-calibrated.md 6f8920def43e564dfa2e1e69f8ca9b18625865a1e0d3537b435a2e374c99bbd8
- scorer-common.md 9e4ac9d9fb2be5a67b967d62267d2d8ae96a71fc72cacd6949152e37c7090281
- blind-leak-rule.md 1e93a390b4d481f72b9107b2dbae99d744d2bd5d7682325265303a1503b2c5ae

## Procedure
Three arms x two batches of 15 blind records, each scored by an isolated agent
using only the leakage-safe dossier query. Predictions are written to files and
hashed before any blind label is read. Labels use `outcome-targets.md` exactly.

## Decision rule (fixed now)
- Primary metric: AUC against the platform decision (undecided excluded).
- Winner: highest AUC. If C is within 0.03 of the best, C wins (it carries the
  age gate separately and is the production candidate).
- The winner ships only if it beats the blind base rate on precision at >=60
  and has AUC >= 0.65. Otherwise production keeps the current scorer and the
  result is reported as a failure, not re-tuned on the blind set.
- With ~30 records, one record moves precision by ~3-8 points; results are
  directional and reported with counts.
