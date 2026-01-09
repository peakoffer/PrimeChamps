# Session L: Notification System

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
Build a notification system to alert users about new responses, upcoming appointments, and important events.

## Current State
- `NotificationsBell.tsx` component exists but is basic
- No notification storage or tracking
- No real-time updates
- No appointment reminders

## What to Build

### 1. Notifications Table
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'response', 'appointment', 'system', 'milestone'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- URL to navigate to
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
```

### 2. Notification Types

| Type | Trigger | Example |
|------|---------|---------|
| `response` | Athlete replies to message | "Sarah Johnson replied to your message" |
| `appointment` | Upcoming appointment (1hr before) | "Appointment with Mike T in 1 hour" |
| `appointment_reminder` | Day-of reminder | "You have 3 appointments today" |
| `milestone` | Athlete moves to contract | "Jessica R moved to contract stage!" |
| `system` | System alerts | "10 new athletes discovered" |

### 3. API Endpoints

```typescript
// GET /api/notifications
// Returns unread notifications, paginated
{
  notifications: [...],
  unread_count: 5,
  total: 23
}

// POST /api/notifications/mark-read
{
  notification_ids: string[] // or 'all'
}

// GET /api/notifications/unread-count
// Quick count for badge
{ count: 5 }

// POST /api/notifications/create
// Internal use - create notification
{
  type: 'response',
  title: 'New Reply',
  message: 'Sarah Johnson replied...',
  athlete_id: 'xxx',
  link: '/athletes/xxx'
}
```

### 4. Enhanced NotificationsBell Component

```typescript
// dashboard/src/components/NotificationsBell.tsx
export function NotificationsBell() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Poll for new notifications every 30s
  useEffect(() => {
    const poll = setInterval(fetchNotifications, 30000);
    return () => clearInterval(poll);
  }, []);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger>
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="badge">{unreadCount}</span>
        )}
      </PopoverTrigger>
      <PopoverContent>
        <NotificationList
          notifications={notifications}
          onMarkRead={handleMarkRead}
        />
      </PopoverContent>
    </Popover>
  );
}
```

### 5. Notification Triggers

Create notification on these events:

**Response received:**
```typescript
// In conversation message handler
await createNotification({
  type: 'response',
  title: 'New Reply',
  message: `${athlete.name} replied to your message`,
  athlete_id: athlete.id,
  link: `/athletes/${athlete.id}`
});
```

**Appointment reminder:**
```typescript
// Background job - check every 15 min
const upcoming = await getAppointmentsInNextHour();
for (const apt of upcoming) {
  await createNotification({
    type: 'appointment',
    title: 'Upcoming Appointment',
    message: `Appointment with ${apt.athlete_name} in 1 hour`,
    athlete_id: apt.athlete_id,
    link: `/pipeline/appointment`
  });
}
```

**Milestone:**
```typescript
// In pipeline move handler
if (to_stage === 'contract') {
  await createNotification({
    type: 'milestone',
    title: 'New Contract Prospect!',
    message: `${athlete.name} moved to contract stage`,
    athlete_id: athlete.id,
    link: `/pipeline/contract`
  });
}
```

### 6. Notifications Page

Full page view at `/notifications`:
- All notifications (read and unread)
- Filter by type
- Mark all as read
- Delete old notifications

### 7. Daily Digest (Optional)

Summary notification each morning:
- "You have 3 appointments today"
- "5 athletes awaiting approval"
- "2 new responses overnight"

## Files to Create/Modify

```
dashboard/src/app/api/notifications/
├── route.ts              # GET list, POST create
├── mark-read/route.ts    # POST mark as read
└── unread-count/route.ts # GET count for badge

dashboard/src/app/notifications/
└── page.tsx              # Full notifications page

dashboard/src/components/
├── NotificationsBell.tsx  # Enhance existing
├── NotificationList.tsx   # Dropdown list
├── NotificationItem.tsx   # Single notification
└── NotificationFilters.tsx

dashboard/src/lib/notifications.ts  # Helper functions

scripts/migration_v9_notifications.sql
```

## Verification

```bash
# 1. Run migration

# 2. Type check
cd dashboard && npx tsc --noEmit

# 3. Build
cd dashboard && npm run build

# 4. Create test notification
curl -X POST http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d '{"type": "system", "title": "Test", "message": "Test notification"}'

# 5. Check bell shows count
# Visit dashboard and verify bell shows unread count
```

## Success Criteria
- [ ] Notifications table created
- [ ] Bell shows unread count
- [ ] Clicking bell shows notification list
- [ ] Can mark notifications as read
- [ ] Notifications created on responses
- [ ] Notifications created on appointments
- [ ] Full notifications page works
- [ ] All builds pass

## Do NOT
- Don't add browser push notifications (future scope)
- Don't add email notifications (Session I handles email)
- Don't poll too frequently (30s minimum)
- Don't modify core pipeline logic

Start by reading CLAUDE.md, then create the migration and implement.
