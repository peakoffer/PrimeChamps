# Session A: Message Generation System

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
Build the AI-powered message generation system that creates personalized outreach DMs using full enrichment data.

## What to Build

### 1. Message Generator API (`/api/messages/generate`)
- Input: athlete_id, template_id (optional)
- Pull full enrichment data: Instagram stats, recent posts, achievements, news mentions
- Use Claude API to generate personalized message
- Return: generated message with personalization points highlighted

### 2. Message Templates System
- Create `outreach_templates` table if not exists
- CRUD API for templates (`/api/templates/*`)
- Support variables: {{name}}, {{sport}}, {{achievement}}, {{follower_count}}, etc.
- Track template performance (for future A/B testing)

### 3. Batch Generation
- Endpoint to generate messages for multiple athletes
- Queue system to avoid overwhelming Claude API
- Progress tracking

## Technical Requirements

### Database Schema (if needed)
```sql
CREATE TABLE IF NOT EXISTS outreach_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  category TEXT DEFAULT 'initial_outreach',
  is_active BOOLEAN DEFAULT true,
  times_used INTEGER DEFAULT 0,
  response_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Files to Create/Modify
- `dashboard/src/app/api/messages/generate/route.ts`
- `dashboard/src/app/api/templates/route.ts`
- `dashboard/src/lib/message-generator.ts`
- `backend/agents/outreach.py` (enhance if needed)

## Verification Loop

After each significant change:
1. Run: `cd dashboard && npm run build` (must pass)
2. Run: `cd dashboard && npx ts-node ../scripts/verify-ui.ts messages`
3. Test API: `curl -X POST http://localhost:3000/api/messages/generate -H "Content-Type: application/json" -d '{"athlete_id": "TEST_ID"}'`
4. Check screenshot for any visual issues
5. If errors, fix and repeat. If good, continue to next task.

## Success Criteria
- [ ] Can generate personalized message for any enriched athlete
- [ ] Messages include sport-specific references
- [ ] Messages mention recent achievements/posts when available
- [ ] Template system working with variable substitution
- [ ] Batch generation works for 10+ athletes
- [ ] All builds pass, no console errors

## Do NOT
- Do not build the approval UI (Session B handles that)
- Do not build Instagram integration (Session C handles that)
- Do not skip verification steps

Start by reading CLAUDE.md, then begin implementation. Use /ralph-loop to run autonomously.
