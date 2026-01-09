# Session G: Analytics & Reporting Dashboard

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
Build a comprehensive analytics dashboard to track campaign performance, conversion funnels, and template effectiveness.

## Current State
- No analytics page exists
- `/api/benchmarks` has some historical data queries
- Pipeline data exists but no aggregated reporting
- No visibility into what's working

## What to Build

### 1. Analytics Dashboard Page (`/analytics`)

**Key Metrics Cards:**
- Total athletes in pipeline
- Conversion rate (research → signed)
- Average time to conversion
- Response rate to outreach
- This week vs last week comparison

**Conversion Funnel Chart:**
```
Research (150) → Approval (120) → Reach Out (80) → Response (40) → Appointment (20) → Contract (10)
     100%           80%              53%            27%             13%              7%
```

**Template Performance Table:**
| Template | Sent | Replies | Reply Rate | Conversions |
|----------|------|---------|------------|-------------|
| Casual Introduction | 45 | 12 | 26.7% | 3 |
| Achievement Focus | 38 | 15 | 39.5% | 5 |
| Direct Pitch | 22 | 4 | 18.2% | 1 |

**Sport Breakdown:**
- Athletes by sport (pie chart)
- Conversion rate by sport (bar chart)
- Best performing sports

**Timeline Charts:**
- Athletes added per week
- Messages sent per day
- Responses received per day

### 2. API Endpoints

```typescript
// GET /api/analytics/overview
{
  total_athletes: number,
  by_stage: { research: n, approval: n, ... },
  conversion_rate: number,
  avg_days_to_conversion: number,
  response_rate: number,
  week_over_week: { athletes: +12%, responses: -5% }
}

// GET /api/analytics/funnel
{
  stages: [
    { name: 'research', count: 150, percent: 100 },
    { name: 'approval', count: 120, percent: 80 },
    ...
  ]
}

// GET /api/analytics/templates
{
  templates: [
    { id, name, sent: 45, replies: 12, reply_rate: 0.267, conversions: 3 },
    ...
  ]
}

// GET /api/analytics/by-sport
{
  sports: [
    { sport: 'MMA', count: 45, conversion_rate: 0.12 },
    ...
  ]
}

// GET /api/analytics/timeline?period=30d
{
  dates: ['2025-01-01', ...],
  athletes_added: [5, 3, 8, ...],
  messages_sent: [12, 8, 15, ...],
  responses: [2, 1, 4, ...]
}
```

### 3. Components

**Charts (use Recharts - already installed):**
- `FunnelChart.tsx` - Conversion funnel visualization
- `TimelineChart.tsx` - Line chart for trends
- `SportPieChart.tsx` - Distribution by sport
- `TemplateBarChart.tsx` - Template comparison

**Cards:**
- `MetricCard.tsx` - Single metric with trend indicator
- `TemplatePerformanceTable.tsx` - Sortable table

### 4. Export Features
- Export to CSV button
- Date range selector
- Filter by sport

## Files to Create

```
dashboard/src/app/analytics/
└── page.tsx                        # Main analytics page

dashboard/src/app/api/analytics/
├── overview/route.ts               # Key metrics
├── funnel/route.ts                 # Conversion funnel
├── templates/route.ts              # Template performance
├── by-sport/route.ts               # Sport breakdown
├── timeline/route.ts               # Time series data
└── export/route.ts                 # CSV export

dashboard/src/components/analytics/
├── MetricCard.tsx
├── FunnelChart.tsx
├── TimelineChart.tsx
├── SportPieChart.tsx
├── TemplatePerformanceTable.tsx
└── DateRangePicker.tsx
```

## Database Queries

```sql
-- Conversion funnel
SELECT pipeline_stage, COUNT(*) as count
FROM athletes
GROUP BY pipeline_stage;

-- Template performance
SELECT
  t.id,
  t.name,
  COUNT(m.id) as sent,
  COUNT(CASE WHEN m.response_received_at IS NOT NULL THEN 1 END) as replies,
  COUNT(CASE WHEN a.pipeline_stage = 'contract' THEN 1 END) as conversions
FROM outreach_templates t
LEFT JOIN outreach_messages m ON m.template_id = t.id
LEFT JOIN athletes a ON m.athlete_id = a.id
GROUP BY t.id, t.name;

-- Timeline (athletes added per day)
SELECT
  DATE(created_at) as date,
  COUNT(*) as count
FROM athletes
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date;

-- Sport breakdown
SELECT
  sport,
  COUNT(*) as total,
  COUNT(CASE WHEN pipeline_stage = 'contract' THEN 1 END) as converted
FROM athletes
GROUP BY sport
ORDER BY total DESC;
```

## Verification

```bash
# 1. Type check
cd dashboard && npx tsc --noEmit

# 2. Build
cd dashboard && npm run build

# 3. Test endpoints
curl http://localhost:3000/api/analytics/overview
curl http://localhost:3000/api/analytics/funnel
curl http://localhost:3000/api/analytics/templates

# 4. Visual check
# Visit /analytics and verify charts render correctly
```

## Success Criteria
- [ ] Analytics page loads with real data
- [ ] Conversion funnel displays correctly
- [ ] Template performance table shows all templates
- [ ] Sport breakdown pie chart works
- [ ] Timeline charts show trends
- [ ] Week-over-week comparison works
- [ ] CSV export downloads valid file
- [ ] All builds pass

## Do NOT
- Don't modify research agent or data sources
- Don't add real-time websocket updates (future scope)
- Don't build predictive analytics (future scope)

Start by reading CLAUDE.md, then implement the API endpoints first, then the UI.
