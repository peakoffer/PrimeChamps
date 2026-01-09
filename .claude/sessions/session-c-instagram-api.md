# Session C: Instagram API Authentication & Tracking

## AUTONOMOUS MODE - READ FIRST

Run in Ralph Loop mode - NO human approval needed:

```
1. IMPLEMENT the task below
2. VERIFY: python scripts/verify-session.py --screenshots
3. If FAIL: fix errors, goto step 2
4. If PASS: continue to next task or report DONE
```

Use /verify or the verify-app agent. Take screenshots to verify UI:
```bash
source .venv/bin/activate && python -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={\"width\": 1280, \"height\": 800})
    pg.goto(\"http://localhost:3000/YOUR_PAGE\", wait_until=\"networkidle\")
    pg.screenshot(path=\"screenshots/verify.png\")
    b.close()
"
```

Then read the screenshot to verify visually.

---


## Objective
Build secure Instagram API integration for auto-logging sent messages and tracking replies.

## What to Build

### 1. Instagram Auth System (Python Backend)
- Use `instagrapi` library (most maintained unofficial API)
- Secure credential storage (encrypted in Supabase or env)
- Session management with 2FA support
- Rate limiting (max 20 requests/hour)
- Session persistence (avoid re-login)

### 2. DM Tracking Service
- Poll for sent messages (every 5-10 minutes)
- Poll for new replies (every 5-10 minutes)
- Match messages to athletes in database
- Update message status: sent, delivered, read, replied

### 3. API Endpoints
- `POST /api/instagram/auth` - Authenticate with Instagram
- `GET /api/instagram/status` - Check connection status
- `POST /api/instagram/sync-sent` - Sync sent messages
- `POST /api/instagram/sync-replies` - Sync new replies
- `GET /api/instagram/conversations/[athlete_id]` - Get DM thread

### 4. Safety Measures
- Exponential backoff on rate limits
- Random delays between requests (2-5 seconds)
- Session refresh before expiry
- Alert on suspicious activity
- Kill switch to stop all polling

## Technical Requirements

### Python Dependencies (add to requirements.txt)
```
instagrapi>=2.0.0
cryptography>=41.0.0
```

### Files to Create
```
backend/
├── sources/instagram_dm.py     # DM-specific operations
├── services/instagram_auth.py  # Auth management
├── services/dm_tracker.py      # Background polling service
└── routes/instagram.py         # FastAPI routes
```

### Database Schema (if needed)
```sql
CREATE TABLE IF NOT EXISTS instagram_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username TEXT NOT NULL,
  session_data JSONB NOT NULL,  -- Encrypted session
  is_active BOOLEAN DEFAULT true,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dm_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,  -- 'sent' or 'replies'
  messages_synced INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  error_message TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Security Requirements
- NEVER log Instagram credentials
- Encrypt session data at rest
- Use environment variables for sensitive config
- Implement request signing

## Verification Loop

After each significant change:
1. Run: `cd backend && python -m mypy . --ignore-missing-imports`
2. Run: `cd backend && python -m pytest tests/ -v` (if tests exist)
3. Start backend: `cd backend && uvicorn server:app --reload`
4. Test endpoint: `curl http://localhost:8000/api/instagram/status`
5. Check for errors in logs
6. If errors, fix and repeat. If good, continue.

## Success Criteria
- [ ] Can authenticate with Instagram (manual test with real account)
- [ ] Session persists across restarts
- [ ] Can fetch sent DM history
- [ ] Can fetch incoming replies
- [ ] Messages matched to athletes in DB
- [ ] Rate limiting working (no more than 20 req/hour)
- [ ] Random delays between requests
- [ ] Kill switch works
- [ ] No credentials in logs

## Do NOT
- Do not build message generation (Session A handles that)
- Do not build approval UI (Session B handles that)
- Do not exceed rate limits during testing
- Do not log any credentials or session tokens
- Do not skip security measures

## IMPORTANT: Testing Safely
- Use test DMs to yourself first
- Start with read-only operations
- Add write operations only after read works
- Monitor account for any warnings

Start by reading CLAUDE.md, then begin implementation. Use /ralph-loop to run autonomously.
