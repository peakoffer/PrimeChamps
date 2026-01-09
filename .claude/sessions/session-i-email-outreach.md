# Session I: Email Outreach Integration

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
Add email as a secondary outreach channel alongside Instagram DMs, with templates, sending, and tracking.

## Current State
- Instagram DM system built (Session C)
- Message generation works (Session A)
- No email capability exists
- Some athletes have email addresses in database

## What to Build

### 1. Email Service Integration
Use Resend (recommended) or SendGrid:

```typescript
// dashboard/src/lib/email-service.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendOutreachEmail({
  to,
  subject,
  body,
  athleteId,
}: {
  to: string;
  subject: string;
  body: string;
  athleteId: string;
}) {
  const result = await resend.emails.send({
    from: 'outreach@yourdomain.com',
    to,
    subject,
    html: body,
  });

  // Log to database
  await logEmailSent(athleteId, result.id, subject, body);

  return result;
}
```

### 2. Email Templates Table
```sql
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  category TEXT DEFAULT 'initial_outreach',
  is_active BOOLEAN DEFAULT true,
  times_used INTEGER DEFAULT 0,
  open_rate DECIMAL(5,2),
  reply_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,
  template_id UUID REFERENCES email_templates(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, delivered, opened, replied, bounced
  external_id TEXT, -- Resend/SendGrid message ID
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. API Endpoints

```
POST /api/email/send           - Send single email
POST /api/email/batch          - Send batch emails
GET  /api/email/templates      - List email templates
POST /api/email/templates      - Create template
PUT  /api/email/templates/[id] - Update template
GET  /api/email/messages       - List sent emails
POST /api/email/webhook        - Resend webhook for tracking
```

### 4. UI Components

**Email Composer Modal:**
- Select athlete(s)
- Choose template or write custom
- Preview with variable substitution
- Send button

**Email Templates Page:**
- List all templates
- Create/edit templates
- View performance stats

**Reach Out Page Enhancement:**
- Toggle between Instagram DM and Email
- Show which athletes have emails
- Dual-channel sequencing option

### 5. Tracking & Webhooks
Set up Resend webhooks for:
- `email.delivered`
- `email.opened`
- `email.clicked`
- `email.bounced`
- `email.complained`

## Files to Create

```
dashboard/src/lib/email-service.ts
dashboard/src/app/api/email/
├── send/route.ts
├── batch/route.ts
├── templates/route.ts
├── templates/[id]/route.ts
├── messages/route.ts
└── webhook/route.ts

dashboard/src/components/
├── EmailComposer.tsx
├── EmailTemplateEditor.tsx
└── EmailStatusBadge.tsx

dashboard/src/app/email/
└── templates/page.tsx

scripts/migration_v8_email.sql
```

## Environment Variables
```
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM_ADDRESS=outreach@yourdomain.com
EMAIL_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
```

## Verification

```bash
# 1. Install Resend
cd dashboard && npm install resend

# 2. Type check
cd dashboard && npx tsc --noEmit

# 3. Build
cd dashboard && npm run build

# 4. Test send (use test email)
curl -X POST http://localhost:3000/api/email/send \
  -H "Content-Type: application/json" \
  -d '{"athlete_id": "TEST", "to": "test@example.com", "subject": "Test", "body": "Hello"}'
```

## Success Criteria
- [ ] Can send email to athlete with valid email
- [ ] Email templates work with variables
- [ ] Sent emails logged in database
- [ ] Webhook updates email status
- [ ] UI shows email option on reach-out page
- [ ] Can view email history per athlete
- [ ] All builds pass

## Do NOT
- Don't modify Instagram DM system
- Don't auto-send without approval
- Don't send to invalid/missing emails
- Don't expose webhook secret

Start by reading CLAUDE.md, then install Resend and implement.
