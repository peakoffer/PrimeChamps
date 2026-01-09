---
description: Run all tests and validation for this project
---

Run the complete verification suite for Prime Champs:

## 1. TypeScript Type Checking
```bash
cd dashboard && npx tsc --noEmit
```

## 2. ESLint
```bash
cd dashboard && npm run lint
```

## 3. Build Verification
```bash
cd dashboard && npm run build
```

## 4. Start Dev Server (if not running)
```bash
cd dashboard && npm run dev &
sleep 5
```

## 5. API Health Checks
```bash
# Test key endpoints
curl -s http://localhost:3000/api/benchmarks | head -c 200
curl -s http://localhost:3000/api/pipeline/athletes?stage=research | head -c 200
```

## 6. Python Backend (if applicable)
```bash
cd backend && python -m py_compile server.py database.py
```

Report any failures with clear explanations of what went wrong and specific suggestions to fix. If everything passes, confirm the app is working correctly.

Success criteria:
- No TypeScript errors
- No ESLint errors (warnings OK)
- Build completes without errors
- Dev server starts and responds to requests
- API endpoints return valid JSON
