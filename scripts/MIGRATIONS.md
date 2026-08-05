# Database migrations

Managed Supabase migration history was established on 2026-08-05. Canonical
migrations now live in `supabase/migrations/`; SQL under `scripts/` and
`supabase/legacy_migrations/` is historical reference only.

## Production history

| Version | Migration | Status |
|---|---|---|
| `20260805160535` | `baseline_existing_production_schema` | Applied |
| `20260805160540` | `enrichment_unique_constraint` | Applied |
| `20260805160553` | `rls_lockdown_and_function_hardening` | Applied |
| `20260805160839` | `remove_backend_anon_policies_and_privileges` | Applied |

The baseline is intentionally a marker: the production schema existed before
managed history and the available legacy SQL is not a complete, trustworthy
replay. Do not assume `supabase db reset` can rebuild the pre-baseline schema.
A vetted full schema dump is still required before creating a brand-new project.

## Workflow for new schema changes

```bash
npx supabase login
npx supabase link --project-ref rmxuwyxpoazsuqvdadlo
npx supabase migration new descriptive_change_name
# edit the generated SQL, test locally, then:
npx supabase db push --dry-run
npx supabase db push
```

Never run the loose SQL files directly against production. Keep every future
DDL change in a timestamped file under `supabase/migrations/` so local and
remote history remain aligned.

## Verification recorded after hardening

- `UNIQUE (athlete_id, data_source)` exists on `athlete_enrichment`.
- Every public table has RLS enabled.
- Browser roles have no table privileges on Instagram credentials/sessions or
  the other backend-only tables.
- Temporary compatibility policies remain only for the dashboard's direct
  `approval_decisions` and `pipeline_history` access. Move those calls behind
  authenticated server routes before removing the policies.
