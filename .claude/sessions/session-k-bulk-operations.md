# Session K: Bulk Pipeline Operations

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
Add bulk operations for managing multiple athletes at once - bulk move, bulk approve/reject, CSV export, and mass actions.

## Current State
- Pipeline kanban works for individual athletes
- Approval modal works one at a time
- No bulk selection or mass actions
- No CSV export functionality

## What to Build

### 1. Bulk Selection UI
Add checkbox selection to athlete lists:

```typescript
// Selection state
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [selectAll, setSelectAll] = useState(false);

// Bulk action bar (appears when items selected)
{selectedIds.size > 0 && (
  <BulkActionBar
    count={selectedIds.size}
    onMove={(stage) => handleBulkMove(stage)}
    onApprove={() => handleBulkApprove()}
    onReject={() => handleBulkReject()}
    onExport={() => handleExport()}
    onClear={() => setSelectedIds(new Set())}
  />
)}
```

### 2. API Endpoints

```typescript
// POST /api/pipeline/bulk-move
{
  athlete_ids: string[],
  to_stage: string,
  reason?: string
}

// POST /api/athletes/bulk-approve
{
  athlete_ids: string[],
  notes?: string
}

// POST /api/athletes/bulk-reject
{
  athlete_ids: string[],
  reason: string
}

// GET /api/athletes/export?stage=approval&format=csv
// Returns CSV file download

// POST /api/athletes/import
// Accepts CSV file upload
```

### 3. Bulk Action Bar Component

```typescript
// dashboard/src/components/BulkActionBar.tsx
interface BulkActionBarProps {
  count: number;
  allowedActions: ('move' | 'approve' | 'reject' | 'export' | 'delete')[];
  onMove?: (stage: string) => void;
  onApprove?: () => void;
  onReject?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onClear: () => void;
}

// Sticky bar at bottom of screen when items selected
<div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t p-4">
  <div className="flex items-center justify-between max-w-7xl mx-auto">
    <span>{count} athletes selected</span>
    <div className="flex gap-2">
      <Button onClick={onApprove}>Approve All</Button>
      <Button onClick={() => setShowMoveModal(true)}>Move to...</Button>
      <Button onClick={onExport}>Export CSV</Button>
      <Button variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  </div>
</div>
```

### 4. CSV Export/Import

**Export:**
```typescript
// Generate CSV from athletes
const csv = athletes.map(a => ({
  name: a.name,
  sport: a.sport,
  instagram: a.instagram_handle,
  email: a.email,
  followers: a.follower_count,
  stage: a.pipeline_stage,
  score: a.score,
}));

// Return as downloadable file
return new Response(convertToCSV(csv), {
  headers: {
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="athletes.csv"'
  }
});
```

**Import:**
```typescript
// POST /api/athletes/import
// Parse CSV, validate, insert new athletes
// Skip duplicates by instagram_handle
// Return: { imported: 45, skipped: 3, errors: [] }
```

### 5. Enhanced Pipeline Page

Add to `/pipeline` page:
- "Select All" checkbox in header
- Individual checkboxes per athlete card
- Bulk action bar when items selected
- Filter + bulk action combination

### 6. Quick Actions Menu

Per-stage quick actions:
- Research: "Approve top 10 by score"
- Approval: "Move all approved to reach-out"
- Reach-out: "Generate messages for all"

## Files to Create/Modify

```
dashboard/src/app/api/pipeline/bulk-move/route.ts
dashboard/src/app/api/athletes/bulk-approve/route.ts
dashboard/src/app/api/athletes/bulk-reject/route.ts
dashboard/src/app/api/athletes/export/route.ts
dashboard/src/app/api/athletes/import/route.ts

dashboard/src/components/BulkActionBar.tsx
dashboard/src/components/SelectableAthleteCard.tsx
dashboard/src/components/ImportModal.tsx

dashboard/src/app/pipeline/page.tsx (enhance)
dashboard/src/app/athletes/page.tsx (enhance)
dashboard/src/app/pipeline/approval/page.tsx (enhance)
```

## Verification

```bash
# 1. Type check
cd dashboard && npx tsc --noEmit

# 2. Build
cd dashboard && npm run build

# 3. Test bulk move
curl -X POST http://localhost:3000/api/pipeline/bulk-move \
  -H "Content-Type: application/json" \
  -d '{"athlete_ids": ["id1", "id2"], "to_stage": "approval"}'

# 4. Test export
curl http://localhost:3000/api/athletes/export?stage=approval

# 5. Visual check - verify bulk selection works in UI
```

## Success Criteria
- [ ] Can select multiple athletes with checkboxes
- [ ] Bulk action bar appears when items selected
- [ ] Can bulk move athletes between stages
- [ ] Can bulk approve/reject
- [ ] CSV export downloads valid file
- [ ] CSV import creates new athletes
- [ ] Pipeline history logs bulk actions
- [ ] All builds pass

## Do NOT
- Don't allow bulk delete without confirmation
- Don't skip validation on import
- Don't break individual athlete actions
- Don't modify research or data source code

Start by reading CLAUDE.md, then implement the bulk action bar first.
