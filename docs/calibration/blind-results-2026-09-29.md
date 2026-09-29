# Blind hold-out results (graded 2026-09-29 under the pre-registration)

Predictions were written by six isolated scorers (3 rubrics x 2 batches), then
hashed before any label was read:
```
c5f9a5e67618bdcf0f339f035567c0d5852daee0830bda8e5c646e01bd904f01  blind_scores_A_0.json
111d522026e98cdcfa0a95845ee794dfe8118763e137bc1a002a59280bee3945  blind_scores_A_1.json
4fcd6ff87589da88f716ef22bf7026c123e5f1ef78f06dd445988ffe0eaf2c9a  blind_scores_B_0.json
88a9e339d7820407479485a04e40c74bc1f85bd84dd1c6fb61ab402870d3b019  blind_scores_B_1.json
510755de7125db9b3507526e7eda3b93e25b1a15bba70e6794159569981d1f53  blind_scores_C_0.json
cf5393376291f35982b908a4fba936bf672686483cdb688c1b7fcb69e3e7a26d  blind_scores_C_1.json
```

Blind set: 30 decided records, 23 approved, 7 rejected. Base rate 77%.

| Arm | AUC | >=50 precision | >=50 approved found | >=60 precision | >=60 approved found | rejections scored <60 |
|---|---|---|---|---|---|---|
| A neutral | 0.42 | 8/13 | 8/23 | 5/8 | 5/23 | 4/7 |
| **B success profile** | **0.88** | **18/19** | **18/23** | **10/10** | **10/23** | **7/7** |
| C calibrated | 0.64 | 22/27 | 22/23 | 12/14 | 12/23 | 5/7 |

**Decision (pre-registered rule): Arm B wins and passes both ship conditions**
(precision at >=60 beats the 77% base rate; AUC >= 0.65).

## Honest reading
- Pooled over calibration + blind (98 decided), Arm B at >=60 is 31/36 (86%)
  approved and at >=50 is 63/71 (89%), against a 76-77% base rate. The blind
  AUC (0.88) is above the calibration AUC (0.72); with 7 blind rejections the
  true value is most likely between them. Treat ~0.75-0.8 as the working estimate.
- A neutral rubric is no better than chance (0.42 blind). The sponsor-specific
  profile is what carries the signal.
- Arm C's changes backfired. Softening price/star tier and kit exclusivity to
  "mild" and forcing thin-evidence records into 45-58 cost it the rejections B
  caught (a world-record star, a rejected high-fee pitch). The profile rules
  that looked noisy on calibration were real signal. They stay strong.
- Recall is modest by design: >=60 finds 10 of 23 approvals. That is the
  "clear winner" tier. 50-59 is a second tier (blind: 8 approved, 1 rejected).
- Each athlete was scored once; scorer-to-scorer variance is not measured.
- Three more dossiers carried sponsor-reaction items (fee too high, internal
  "too expensive" review, a discussed fee structure). Scorers ignored them under
  the blind leak rule; the production evidence filter must exclude this class.
- Fee information in these dossiers comes from the pitch itself. The live
  research agent will not have it, so star-tier/price must be judged from public
  career tier.
