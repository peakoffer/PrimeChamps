# Session H: Conversation Thread Management

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
Build a complete conversation management system with full message history, manual reply composition, and outcome tracking.

## Current State
- `conversations` and `conversation_messages` tables exist
- `/inbox` page exists but is basic
- Athlete detail page doesn't show conversation history
- No way to manually log messages or replies
- `/api/conversations` endpoints exist but are minimal

## What to Build

### 1. Enhanced Inbox Page (`/inbox`)

**Conversation List:**
- All conversations sorted by last message
- Unread indicator
- Athlete name, photo, sport
- Message preview
- Status badge (active, needs reply, closed)

**Conversation Detail Panel:**
- Full message thread (like iMessage/WhatsApp)
- Messages show: content, timestamp, direction (sent/received)
- Scroll to load older messages
- Real-time feel (optimistic updates)

**Compose Area:**
- Text input for manual message logging
- "Log as Sent" vs "Log as Received" toggle
- Quick reply templates dropdown
- Attach to existing Instagram thread option

### 2. Outcome Tracking

**Conversation Outcomes:**
- Positive (interested, wants call)
- Negative (not interested, declined)
- Neutral (needs follow-up, no response)
- Converted (moved to appointment/contract)

**Outcome Modal:**
- Select outcome type
- Add notes
- Schedule follow-up date (optional)
- Auto-move athlete to appropriate stage

### 3. Athlete Detail Integration

Add "Conversations" tab to athlete detail page:
- Show all conversations with this athlete
- Message count and last activity
- Quick compose button
- Link to full inbox view

### 4. API Endpoints

```typescript
// GET /api/conversations
// List all conversations with pagination
{
  conversations: [
    {
      id, athlete_id, athlete_name, athlete_photo,
      last_message_preview, last_message_at,
      unread_count, status, outcome
    }
  ],
  total: number,
  page: number
}

// GET /api/conversations/[id]
// Get conversation with messages
{
  conversation: { id, athlete_id, status, outcome, ... },
  athlete: { id, name, sport, photo_url, ... },
  messages: [
    { id, content, direction, sent_at, source }
  ]
}

// POST /api/conversations/[id]/messages
// Add a message to conversation
{
  content: string,
  direction: 'sent' | 'received',
  source: 'manual' | 'instagram_sync'
}

// PUT /api/conversations/[id]/outcome
// Update conversation outcome
{
  outcome: 'positive' | 'negative' | 'neutral' | 'converted',
  notes: string,
  follow_up_date?: string
}

// POST /api/conversations
// Start new conversation with athlete
{
  athlete_id: string,
  initial_message?: string
}

// GET /api/athletes/[id]/conversations
// Get all conversations for an athlete
```

### 5. Components

```
dashboard/src/components/conversations/
├── ConversationList.tsx        # Left sidebar list
├── ConversationThread.tsx      # Message thread display
├── MessageBubble.tsx           # Individual message
├── ComposeBox.tsx              # Message input area
├── OutcomeModal.tsx            # Set outcome
├── ConversationHeader.tsx      # Athlete info + actions
└── QuickReplyPicker.tsx        # Template dropdown
```

### 6. Real-time Feel

Even without WebSockets, make it feel responsive:
- Optimistic UI updates when sending
- Polling every 30s for new messages (optional)
- Loading skeletons
- Smooth scroll to new messages

## Files to Create/Modify

```
dashboard/src/app/inbox/
└── page.tsx                              # Enhance significantly

dashboard/src/app/api/conversations/
├── route.ts                              # GET list, POST create
└── [id]/
    ├── route.ts                         # GET detail
    ├── messages/route.ts                # GET messages, POST new
    └── outcome/route.ts                 # PUT outcome

dashboard/src/app/api/athletes/[id]/
└── conversations/route.ts               # GET athlete's conversations

dashboard/src/app/athletes/[id]/
└── page.tsx                             # Add conversations tab

dashboard/src/components/conversations/
├── ConversationList.tsx
├── ConversationThread.tsx
├── MessageBubble.tsx
├── ComposeBox.tsx
├── OutcomeModal.tsx
└── QuickReplyPicker.tsx
```

## Database Queries

```sql
-- Get conversations with latest message
SELECT
  c.*,
  a.name as athlete_name,
  a.sport,
  a.profile_photo_url,
  (SELECT content FROM conversation_messages
   WHERE conversation_id = c.id
   ORDER BY sent_at DESC LIMIT 1) as last_message_preview,
  (SELECT sent_at FROM conversation_messages
   WHERE conversation_id = c.id
   ORDER BY sent_at DESC LIMIT 1) as last_message_at
FROM conversations c
JOIN athletes a ON c.athlete_id = a.id
ORDER BY last_message_at DESC;

-- Get messages for conversation
SELECT * FROM conversation_messages
WHERE conversation_id = $1
ORDER BY sent_at ASC;

-- Update outcome and optionally move pipeline stage
UPDATE conversations SET outcome = $1, outcome_notes = $2 WHERE id = $3;
-- If outcome = 'converted', also update athlete pipeline_stage
```

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Inbox                                        [Search] [+]  │
├──────────────────┬──────────────────────────────────────────┤
│ ┌──────────────┐ │  Sarah Johnson - MMA            [•••]   │
│ │ Sarah J.     │ │  ──────────────────────────────────────  │
│ │ Hey! Thanks  │ │                                          │
│ │ 2m ago    ●  │ │  ┌─────────────────────────────────┐    │
│ └──────────────┘ │  │ Hey Sarah! Loved your recent... │    │
│ ┌──────────────┐ │  └─────────────────────────────────┘    │
│ │ Mike T.      │ │                              Jan 8 2:30pm│
│ │ Sounds good  │ │                                          │
│ │ 1h ago       │ │       ┌─────────────────────────────┐   │
│ └──────────────┘ │       │ Hey! Thanks for reaching    │   │
│ ┌──────────────┐ │       │ out. Tell me more?          │   │
│ │ Jessica R.   │ │       └─────────────────────────────┘   │
│ │ Not interes  │ │                              Jan 8 2:45pm│
│ │ 3d ago       │ │                                          │
│ └──────────────┘ │  ┌──────────────────────────────────────┤
│                  │  │ Type a message...        [Send]       │
│                  │  │ ○ Sent  ● Received    [Templates ▼]  │
└──────────────────┴──┴──────────────────────────────────────┘
```

## Verification

```bash
# 1. Type check
cd dashboard && npx tsc --noEmit

# 2. Build
cd dashboard && npm run build

# 3. Test endpoints
curl http://localhost:3000/api/conversations
curl http://localhost:3000/api/conversations/CONV_ID
curl -X POST http://localhost:3000/api/conversations/CONV_ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Test message", "direction": "sent"}'

# 4. Visual check
# Visit /inbox and test the full flow
```

## Success Criteria
- [ ] Inbox shows all conversations sorted by recency
- [ ] Can click conversation to see full thread
- [ ] Messages display in chat bubble format
- [ ] Can manually log sent/received messages
- [ ] Can set conversation outcome
- [ ] Athlete detail page shows conversation tab
- [ ] Quick reply templates work
- [ ] All builds pass

## Do NOT
- Don't integrate with Instagram API (Session C handles that)
- Don't modify research agent or data sources
- Don't add real WebSocket support (polling is fine)
- Don't build auto-reply AI (future scope)

Start by reading CLAUDE.md, then implement API endpoints, then build the UI.
