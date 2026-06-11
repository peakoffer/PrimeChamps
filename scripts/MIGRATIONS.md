# Database migrations — canonical order

The live Supabase project (`rmxuwyxpoazsuqvdadlo`) is currently the **source of
truth**; these files accreted ad-hoc and include duplicates. This document
records the intended apply order for rebuilding from scratch and flags the
redundant files.

## Recommended way to reproduce the DB

The most reliable reproduction is a dump of the live schema rather than
replaying this pile:

```bash
supabase db dump --schema public --project-ref rmxuwyxpoazsuqvdadlo > scripts/schema_full.sql
```

Commit that file and treat it as the canonical schema. Replay the numbered
migrations below only if you can't dump.

## Apply order (from empty database)

| # | File | Notes |
|---|------|-------|
| 1 | `schema.sql` | Base tables (athletes, athlete_enrichment, outreach_*) |
| 2 | `migration_v2_agents.sql` | agent_runs, athlete_scores |
| 3 | `migration_v3_pipeline.sql` | pipeline_stage, pipeline_history, approval_decisions |
| 4 | `migration-v3-outreach-templates.sql` | ⚠️ second "v3" — outreach_templates (apply after v3_pipeline) |
| 5 | `migration_v4_add_rejected_stage.sql` | adds `rejected` pipeline stage |
| 6 | `migration_v5_athlete_posts.sql` | athlete_posts |
| 7 | `migration_v6_instagram_dm.sql` | instagram_sessions/config/conversations/messages, dm_sync_log |
| 8 | `migration_v7_appointments_contracts.sql` | appointments, contracts |
| 9 | `migration_v8_email.sql` | email_templates, email_messages |
| 10 | `migration_v9_notifications.sql` | activity_notifications |
| 11 | `migration_v10_outreach_hub.sql` | touchpoints, content_engagements, outreach_settings, outreach_queue + views/functions |
| 12 | `migration_v11_enrichment_unique_constraint.sql` | **NEW — not yet applied.** UNIQUE(athlete_id, data_source) |
| 13 | `migration_v12_rls_lockdown.sql` | **NEW — not yet applied.** RLS + advisor remediation (review first) |

## Redundant / superseded files (do NOT apply in a clean build)

These were one-off patches against a drifting DB. Their effects are already
folded into the numbered files above or into the live DB:

- `add_missing_columns.sql` — ad-hoc column adds
- `create_missing_tables.sql` — re-declares tables from v2/v3
- `create_research_tables.sql` and `create_research_tables_simple.sql` — two
  versions of the same research tables; superseded by `supabase/migrations/`
- `migration_combined_missing.sql` — re-declares several earlier tables

## Outstanding

- v11 and v12 still need to be applied to the live DB (DDL requires manual
  apply / explicit approval). See each file's header for the apply command.
