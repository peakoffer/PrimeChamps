# Research V2 Enriched Benchmark Import — 2026-08-12

## Outcome

Dylan's enriched 100-athlete workbook was validated, converted deterministically, imported with backup, and audited in Supabase. It improved the benchmark evidence base without changing any authoritative outcome, creating athletes, promoting pipeline records, or sending outreach.

## Source validation

- Enriched workbook: `/Users/zacharyvanheyningen/Library/Messages/Attachments/be/14/E5D20F7E-E020-4955-9E02-C247E30452A2/OnlyFans_Athlete_Historical_Benchmark_Enriched.xlsx`
- Locked comparison workbook: `/Users/zacharyvanheyningen/Library/Messages/Attachments/0c/12/CFBA99F0-A4B3-4AD6-A4B4-EA3D65C540A7/OnlyFans_Athlete_Historical_Benchmark.xlsx`
- Exactly 100 benchmark rows and 100 Evidence Index rows.
- Zero changes in the original eight benchmark columns or six Evidence Index columns.
- Exact outcome counts: 41 signed, three approved but did not sign, 23 rejected, and 33 stalled.
- Zero duplicate names or evidence references.
- 748 evidence-detail ledger rows cover all 100 athletes.
- Zero detail rows marked after the decision cutoff and zero source dates after the cutoff.
- 420 usable evidence claims across 76 athletes; 24 athletes correctly retain only a `Not available` audit note.

## Import result

- Existing golden records updated: 100.
- Golden records created: zero.
- Conflicts: zero.
- Detailed evidence sources written: 420.
- Detailed evidence claims written: 420.
- Scoring-eligible detail claims: 406.
- Excluded detail claims: 12 medium-confidence identity matches, one internal age hint, and one outcome-like commercial excerpt.
- Future claims: zero.
- Eligible outcome-like claims: zero.
- Existing cohort assignments preserved: 16 development, 16 revealed held-out, and 68 excluded.

The first apply attempt wrote its backup and stopped on the third record because a revealed held-out lock rejected an attempted split reset. No detailed evidence had been written at that point. The importer was fixed to preserve current cohort assignments, re-tested, dry-run again, and applied idempotently. Two local backups remain under `dashboard/data/backups/`; that directory is ignored because it contains internal data.

## Readiness after import

| Gate | Total | Positive | Negative |
|---|---:|---:|---:|
| Records | 100 | 44 | 56 |
| Freeze-ready | 12 | 2 | 10 |
| Two-source identity | 34 | 23 | 11 |
| Two-source 21+ | 11 | 8 | 3 |
| Current momentum | 39 | 26 | 13 |
| Audience evidence | 12 | 2 | 10 |
| Creator behavior | 45 | 28 | 17 |
| Audience + creator | 6 | 2 | 4 |

The fresh excluded pool contains zero ready positives and four ready negatives. The cohort-freeze route requires 16 evidence-ready excluded cases per label. The minimum next recovery gap is therefore 16 positive and 12 negative cases. Audience-at-decision is the biggest positive-class gap, followed by independent 21+ and identity corroboration.

## Reproduction

From `dashboard/`:

```bash
npm run typecheck
npm run test:unit
npm run audit:historical-benchmark
```

Do not rerun the import unless a newer workbook is supplied. Do not commit the raw extraction JSON, converted record JSON, or backups under `dashboard/data/`.
