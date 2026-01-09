# Session B: Batch Approval UI

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
Build the batch review interface where the user can quickly approve/edit/reject generated messages.

## What to Build

### 1. Approval Queue Page (`/pipeline/approval` or `/messages/approval`)
- List view of pending messages (10-20 at a time)
- Each row shows: Athlete name, photo, sport, follower count, message preview
- Quick actions: Approve, Edit, Reject buttons
- Bulk select + bulk approve functionality

### 2. Message Preview/Edit Modal
- Full athlete profile sidebar (enrichment data)
- Generated message in editable textarea
- Personalization highlights (show what data was used)
- Approve / Save Edit / Reject buttons

### 3. Send Queue View (`/messages/queue`)
- List of approved messages ready to send
- Status: pending, sent, delivered, replied
- "Copy to Clipboard" button for each message
- Mark as Sent button (manual logging)

### 4. Filters & Sorting
- Filter by: sport, template used, generation date
- Sort by: athlete score, follower count, date
- Search by athlete name

## Technical Requirements

### Components to Create
```
dashboard/src/components/
├── ApprovalQueue.tsx       # Main list component
├── MessageCard.tsx         # Individual message row
├── MessageEditModal.tsx    # Edit/preview modal
├── SendQueue.tsx           # Ready-to-send list
├── AthleteProfileSidebar.tsx  # Enrichment data display
└── BulkActionBar.tsx       # Bulk select actions
```

### API Endpoints (create if not exist)
- `GET /api/messages?status=pending` - Get pending messages
- `POST /api/messages/[id]/approve` - Approve message
- `POST /api/messages/[id]/reject` - Reject message
- `PUT /api/messages/[id]` - Update message content
- `POST /api/messages/bulk-approve` - Bulk approve

### State Management
- Use React state or context for selection
- Optimistic updates for approve/reject
- Toast notifications for actions

## Verification Loop

After each significant change:
1. Run: `cd dashboard && npm run build` (must pass)
2. Run: `cd dashboard && npx ts-node ../scripts/verify-ui.ts approval`
3. Start dev server: `cd dashboard && npm run dev`
4. Take screenshot, analyze for:
   - Layout issues
   - Missing elements
   - Responsive behavior
5. If errors, fix and repeat. If good, continue.

## Success Criteria
- [ ] Can view list of pending messages
- [ ] Can approve single message with one click
- [ ] Can edit message before approving
- [ ] Can reject with optional reason
- [ ] Can bulk select and approve multiple
- [ ] Approved messages appear in send queue
- [ ] Copy to clipboard works
- [ ] Mark as Sent updates status
- [ ] Builds pass, looks good visually

## Do NOT
- Do not build message generation (Session A handles that)
- Do not build Instagram API integration (Session C handles that)
- Do not skip verification steps

Start by reading CLAUDE.md, then begin implementation. Use /ralph-loop to run autonomously.
