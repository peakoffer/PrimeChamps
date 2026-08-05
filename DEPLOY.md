# Prime Champs — Deployment Runbook

Target architecture:

```
app.prime-champs.com  ──>  Vercel (Next.js dashboard)
                              │  server routes proxy (X-API-Key) to:
                              ▼
                            Railway (FastAPI backend, Docker)
                              │
                              ▼
                            Supabase (Postgres) — project rmxuwyxpoazsuqvdadlo
```

Marketing site stays on `prime-champs.com` (Lovable). The CRM lives on the
`app.` subdomain.

---

## 0. Pre-flight (do once, before deploying)

1. **Apply the pending DB migrations** to Supabase (review each first):
   - `scripts/migration_v11_enrichment_unique_constraint.sql` (fixes silent
     enrichment data loss)
   - `scripts/migration_v12_rls_lockdown.sql` (RLS + advisor remediation)
   Apply via the Supabase SQL editor or `supabase db execute --file <path>`.
2. **Generate production secrets** (don't reuse the dev ones):
   ```bash
   openssl rand -hex 32   # JWT_SECRET
   openssl rand -hex 32   # BACKEND_API_KEY  (same value used in both services)
   ```
3. **Rotate the secrets currently sitting in `~/.claude/settings.json`** (the
   Cloudflare token, n8n key, and GitHub PAT are in plaintext there).

---

## 1. Backend → Railway

1. New Railway project → "Deploy from GitHub repo" → select `peakoffer/PrimeChamps`.
2. Railway auto-detects `Dockerfile` + `railway.json` at the repo root.
3. Set service **environment variables** (from `.env.example`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`, `APIFY_API_KEY`
   - `INSTAGRAM_SESSION_SECRET` (+ optional `INSTAGRAM_SESSION_SALT`)
   - `BACKEND_API_KEY` = the value from step 0.2
   - `BACKEND_CORS_ORIGINS=https://app.prime-champs.com`
   - `PIPELINE_AUTORUN_ENABLED=false` (flip to `true` only when you're ready to
     let the loop run unattended)
   - `INSTAGRAM_DM_SENDING_ENABLED=false` (independent outbound-DM gate; leave
     off through staging verification), `PIPELINE_INTERVAL_MINUTES=60`
4. Deploy. Confirm health: `https://<railway-domain>/health` → `200`.
5. Confirm auth: `https://<railway-domain>/agents` with no key → `401`; with
   `X-API-Key: <BACKEND_API_KEY>` → `200`.
6. Note the public Railway URL — it's `BACKEND_URL` for Vercel below.

> Playwright/chromium is installed in the image for the OnlyFans scraper, so
> the first build is a few minutes. If you don't use that source, you can drop
> the `playwright install` line to slim the image.

---

## 2. Dashboard → Vercel

1. New Vercel project → import `peakoffer/PrimeChamps`.
2. **Root Directory: `dashboard`** (important — the app is in a subdir).
   `vercel.json` there sets the Next.js framework/build.
3. Set **environment variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`
   - `JWT_SECRET` = the value from step 0.2
   - `AUTH_USERS=zac:<strong-password>:Zac` (and anyone else)
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`,
     `APIFY_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_WEBHOOK_SECRET`
   - `BACKEND_URL` and `AGENT_SERVER_URL` = the Railway URL from step 1.6
   - `BACKEND_API_KEY` = the SAME value as Railway (step 0.2)
   - Leave `ENABLE_SETUP_ROUTES` unset (schema is already applied).
4. Deploy. The build must pass `next build` (it does locally).

---

## 3. Domain → app.prime-champs.com

1. In Vercel project → Settings → Domains → add `app.prime-champs.com`.
2. In the `prime-champs.com` DNS (Cloudflare): add the CNAME Vercel shows
   (`cname.vercel-dns.com`). If proxied through Cloudflare, set DNS-only
   (grey cloud) initially to let Vercel issue the cert, then re-enable proxy.
3. Wait for the cert, then verify `https://app.prime-champs.com` loads the
   login page.

---

## 4. Post-deploy verification

- [ ] `https://app.prime-champs.com` → redirects to `/login`
- [ ] Login with `AUTH_USERS` creds works; old `zac/zac` is dead
- [ ] An unauthenticated API call (`/api/pipeline/athletes`) → `401`
- [ ] Dashboard can reach the backend (try a bulk-enrich) — confirms the
      `X-API-Key` handshake works end-to-end
- [ ] Supabase advisors re-run clean-ish after v12 (no RLS-disabled ERRORs on
      credential tables)
- [ ] Instagram kill switch reachable; `pause_all_outreach=true` halts sends

---

## 5. Turning on the autonomous loop (when ready)

1. Connect the Instagram account via the dashboard (encrypted session stored).
2. Sanity-check `outreach_settings`: `daily_dm_limit`, `pause_all_outreach`,
   `min_hours_between_touchpoints`, `approval_mode`.
3. In staging, explicitly set `INSTAGRAM_DM_SENDING_ENABLED=true`, verify one
   approved-message send, then set `PIPELINE_AUTORUN_ENABLED=true` and redeploy
   (or POST `/pipeline/scheduler/start` with the API key).
4. Watch `system_logs` (component `pipeline_scheduler`) for tick results.
5. Kill switches: `pause_all_outreach=true` (DB) stops sending; the Instagram
   `kill_switch` config stops all IG ops; `INSTAGRAM_DM_SENDING_ENABLED=false`
   blocks outbound DMs; `PIPELINE_AUTORUN_ENABLED=false` + redeploy stops
   scheduler autorun.
