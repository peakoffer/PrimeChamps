---
description: Run all tests and validation for this project
---

Run the complete verification suite for Prime Champs:

## Quick Verify (run all at once)
```bash
cd /Users/maindrive/AntiGravity/Prime\ Champs && source .venv/bin/activate && python scripts/verify-session.py
```

## With Screenshots (visual verification)
```bash
cd /Users/maindrive/AntiGravity/Prime\ Champs && source .venv/bin/activate && python scripts/verify-session.py --screenshots
```

Screenshots saved to: `/Users/maindrive/AntiGravity/Prime Champs/screenshots/`

---

## Manual Steps (if needed)

### 1. TypeScript Type Checking
```bash
cd dashboard && npx tsc --noEmit
```

### 2. Build Verification
```bash
cd dashboard && npm run build
```

### 3. Python Backend
```bash
source .venv/bin/activate && python -m py_compile backend/server.py backend/database.py
```

### 4. API Health Checks
```bash
curl -s http://localhost:3000/api/benchmarks | head -c 200
curl -s http://localhost:3000/api/pipeline/athletes?stage=approval | head -c 200
```

### 5. Take Screenshot of Specific Page
```bash
source .venv/bin/activate && python -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto('http://localhost:3000/YOUR_PAGE_HERE', wait_until='networkidle')
    page.screenshot(path='screenshots/verify.png')
    browser.close()
    print('Screenshot saved')
"
```

---

## After Verification

- **If PASSED**: Continue to next task or report completion
- **If FAILED**: Fix errors, then run verify again (ralph loop)

Success criteria:
- No TypeScript errors
- Build completes without errors
- Python syntax valid
- API endpoints respond
- Screenshots show expected UI (if applicable)
