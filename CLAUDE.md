# Prime Champs - Claude Code Instructions

## Project Overview

Prime Champs is an **Automated Athlete Outreach CRM** for managing partnerships with athletes for OnlyFans content partnerships. The system identifies, researches, enriches, scores, and contacts athletes through a pipeline workflow with human oversight.

**Repository**: https://github.com/peakoffer/prime-champs
**Status**: ~60% complete - Core foundation built, dashboard functional, agents implemented

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS | Dashboard at `/dashboard` |
| **Backend** | Python 3.11, FastAPI | Agents at `/backend` |
| **Database** | Supabase (PostgreSQL) | Schema in `/scripts/schema.sql` |
| **APIs** | Apify (Instagram), Anthropic Claude, SerpAPI | Enrichment sources |
| **Storage** | Supabase Storage | Athlete photos, profile pics |

## Project Structure

```
Prime Champs/
├── dashboard/              # Next.js 15 frontend
│   ├── src/
│   │   ├── app/           # Pages + API routes (App Router)
│   │   │   ├── api/       # 20+ API endpoints
│   │   │   ├── pipeline/  # Main pipeline kanban + stage pages
│   │   │   ├── athletes/  # Athletes list/detail
│   │   │   ├── inbox/     # Conversations
│   │   │   └── historical/# Existing athletes
│   │   ├── components/    # React components
│   │   └── lib/           # Utilities (supabase, auth)
│   └── scripts/           # Batch processing (JS)
├── backend/               # Python FastAPI server
│   ├── agents/            # AI agents (research, enrichment, scoring, outreach)
│   ├── sources/           # Data sources (instagram, tiktok, onlyfans, web)
│   ├── server.py          # FastAPI server
│   ├── database.py        # Supabase operations
│   └── cli.py             # CLI interface
├── scripts/               # Database migrations (SQL)
├── data/                  # Seed data (480+ athletes CSV)
├── supabase/              # Supabase config
└── start.sh               # Starts both services
```

## Key Conventions

### Code Style
- **TypeScript**: Strict mode, use interfaces over types, prefer `async/await`
- **Python**: Type hints, Pydantic models, async where possible
- **React**: Functional components, hooks, no class components
- **CSS**: Tailwind only, no custom CSS files, use `cn()` utility for conditionals

### Naming
- **Files**: kebab-case (`athlete-card.tsx`, `batch-enrich.js`)
- **Components**: PascalCase (`AthleteCard`, `ApprovalModal`)
- **Functions**: camelCase (`fetchAthletes`, `enrichProfile`)
- **Database**: snake_case (`athlete_enrichment`, `pipeline_stage`)
- **API Routes**: `/api/resource/[id]/action` pattern

### Database Patterns
- Always use Supabase client from `lib/supabase.ts` (frontend) or `database.py` (backend)
- Use `service_role` key for server-side operations that bypass RLS
- All tables have `id` (UUID), `created_at`, `updated_at` columns
- Use JSONB for flexible data (`enrichment_data`, `metadata`, `config`)

### Error Handling
- API routes: Return `{ error: string }` with appropriate status codes
- Frontend: Use try/catch, show toast notifications for errors
- Backend: Raise HTTPException with detail messages

## Pipeline Stages

Athletes flow through 6 stages (stored in `pipeline_stage` column):

1. **research** - AI discovers potential athletes
2. **approval** - Human review and approve/reject
3. **reach_out** - Generate and send outreach messages
4. **response** - Track replies and conversations
5. **appointment** - Schedule calls/meetings
6. **contract** - Finalize partnerships
7. **rejected** - Athletes that didn't pass approval

## Common Mistakes to Avoid

**CRITICAL - Add to this list whenever Claude makes a mistake!**

1. **Don't use `settings.local.json` for settings** - Use `settings.json` for shared config, `settings.local.json` is for permissions only
2. **Don't hardcode Supabase URLs or keys** - Always use environment variables
3. **Don't forget `await` with Supabase calls** - All Supabase operations are async
4. **Don't use relative imports in Next.js API routes** - Use `@/` alias
5. **Don't commit `.env` or `.env.local`** - Only commit `.env.example`
6. **Don't use `__NEW_LINE__` in bash permissions** - Invalid syntax that breaks settings
7. **Don't put bare URLs in Bash permissions** - Must have a command prefix like `curl`

## Verification Steps

After making changes, verify with these commands:

### Quick Verification
```bash
# Type check dashboard
cd dashboard && npx tsc --noEmit

# Lint check
cd dashboard && npm run lint

# Build check (catches runtime issues)
cd dashboard && npm run build
```

### Full Verification
```bash
# 1. Type check
cd dashboard && npx tsc --noEmit

# 2. Lint
cd dashboard && npm run lint

# 3. Build
cd dashboard && npm run build

# 4. Start dev server and verify it runs
cd dashboard && npm run dev
# Visit http://localhost:3000 - should show dashboard

# 5. Test API endpoints
curl http://localhost:3000/api/benchmarks
curl http://localhost:3000/api/pipeline/athletes?stage=research
```

### Backend Verification
```bash
# Activate venv
source .venv/bin/activate

# Type check
cd backend && python -m mypy . --ignore-missing-imports

# Start server
cd backend && python -m uvicorn server:app --reload
# Visit http://localhost:8000/docs for API docs
```

## Running the Project

### Development
```bash
# Start both frontend and backend
./start.sh

# Or separately:
# Frontend (port 3000)
cd dashboard && npm run dev

# Backend (port 8000)
source .venv/bin/activate && cd backend && uvicorn server:app --reload
```

### Environment Setup
```bash
# Copy env files
cp .env.example .env
cp dashboard/.env.local.example dashboard/.env.local

# Install dependencies
cd dashboard && npm install
cd backend && pip install -r requirements.txt
```

## Current State

### Working
- Dashboard with stats, pipeline kanban (6 stages)
- Athletes list and detail pages
- Instagram enrichment via Apify
- Fit Score benchmarking with A/B/C/D grades
- Approval/rejection workflow modals
- 480+ seed athletes imported
- Photo storage to Supabase

### In Progress
- Message generation and approval flow
- Research agent integration with dashboard
- Conversation tracking

### Not Started
- Instagram DM automation (complex - ban risk)
- Advanced analytics dashboard
- Appointment scheduling UI
- Contract management

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/benchmarks` | GET | Get benchmark metrics from historical data |
| `/api/athletes/[id]/enrich` | POST | Enrich athlete with Instagram data |
| `/api/athletes/bulk-enrich` | POST | Batch enrich multiple athletes |
| `/api/pipeline/athletes` | GET | Get athletes by pipeline stage |
| `/api/pipeline/move` | POST | Move athlete to different stage |
| `/api/research/run` | POST | Run research agent for a sport |
| `/api/instagram/photos` | GET/POST | Fetch/load athlete photos |
| `/api/messages/generate` | POST | Generate outreach message |
| `/api/messages/approve` | POST | Approve a pending message |

## Installed Plugins

Run `/plugin list` to see current plugins. Recommended:
- `code-simplifier` - Simplify complex code after writing
- `typescript-lsp` - TypeScript language server integration
- `python-lsp` - Python language server integration
- `pr-review-toolkit` - PR review capabilities
- `commit-commands` - Enhanced git workflows

## Slash Commands

- `/verify` - Run full verification suite
- `/commit-push-pr` - Commit, push, and create PR
- `/resume` - Get up to speed in a new session
- `/status` - Show current project state
- `/plan` - Enter plan mode before coding
- `/simplify` - Run code-simplifier on recent changes

## Autonomous Session Mode (Ralph Loops)

Sessions should run autonomously without human intervention. Follow this loop:

### The Ralph Loop
```
1. READ task/goal from session file
2. IMPLEMENT the feature/fix
3. VERIFY using /verify or:
   python scripts/verify-session.py --screenshots
4. IF errors: FIX and go to step 3
5. IF passed: CONTINUE to next task or REPORT completion
```

### Self-Verification Tools

**Quick verify (build + types + python):**
```bash
cd /Users/maindrive/AntiGravity/Prime\ Champs && source .venv/bin/activate && python scripts/verify-session.py
```

**Full verify with screenshots:**
```bash
cd /Users/maindrive/AntiGravity/Prime\ Champs && source .venv/bin/activate && python scripts/verify-session.py --screenshots
```

**Screenshot specific page:**
```bash
source .venv/bin/activate && python -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.goto('http://localhost:3000/YOUR_PAGE', wait_until='networkidle')
    page.screenshot(path='screenshots/check.png')
    browser.close()
"
```

**View screenshot (Claude can read images):**
```
Read the file: /Users/maindrive/AntiGravity/Prime Champs/screenshots/check.png
```

### Key Principles
- Don't wait for human approval on code changes
- Verify your own work with builds and screenshots
- Fix errors immediately, then re-verify
- Only report back when task is COMPLETE or BLOCKED
- Use screenshots to verify UI visually

## Dependencies

### Dashboard (package.json)
- next: ^15.1.0
- react: ^19.0.0
- @supabase/supabase-js: ^2.47.0
- @tanstack/react-table: ^8.20.0
- tailwind-merge, clsx, lucide-react, recharts

### Backend (requirements.txt)
- fastapi, uvicorn
- supabase, httpx
- anthropic (Claude API)
- apscheduler, pydantic
- playwright, pandas

## Environment Variables

See `.env.example` for full list. Critical ones:
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` - Database access
- `APIFY_API_KEY` - Instagram enrichment
- `ANTHROPIC_API_KEY` - AI features
- `AUTH_PASSWORD` - Dashboard authentication
