# Prime Champs

Automated athlete outreach CRM for managing partnerships with athletes. Features Instagram enrichment, Fit Score benchmarking against historical data, and a full pipeline management system.

## Features

- **Pipeline Management** - Kanban-style board with stages: Research → Approval → Reach Out → Response → Appointment → Contract
- **Instagram Enrichment** - Automated profile scraping via Apify (followers, engagement rate, posts, ratio)
- **Fit Score** - Compare athletes against historical benchmarks with A/B/C/D grading
- **Research Agent** - AI-powered athlete discovery by sport/criteria
- **Bulk Operations** - Batch enrichment, approval, and photo fetching
- **Photo Storage** - Instagram posts saved to Supabase storage

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Backend**: Python (agents), Next.js API routes
- **Database**: Supabase (PostgreSQL)
- **APIs**: Apify (Instagram scraping), OpenAI/Anthropic (research agent)
- **Storage**: Supabase Storage (profile pics, post images)

## Project Structure

```
├── dashboard/           # Next.js frontend
│   ├── src/
│   │   ├── app/        # Pages and API routes
│   │   ├── components/ # React components
│   │   └── lib/        # Utilities (supabase, auth)
│   └── scripts/        # Batch processing scripts
├── backend/            # Python agents
│   ├── agents/         # Research, enrichment, scoring agents
│   └── sources/        # Data source integrations
├── scripts/            # Database migrations and utilities
└── supabase/           # Supabase migrations
```

## Setup

### 1. Environment Variables

Copy the example env files:

```bash
cp .env.example .env
cp dashboard/.env.local.example dashboard/.env.local
```

Required variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_server_secret_key

# Apify (Instagram scraping)
APIFY_API_KEY=your_apify_key

# One-time first-owner conversion only; remove after /setup succeeds
AUTH_USERS=zac:your-current-preview-password:Zac
```

For per-user Microsoft, Instagram, webhook, invitation, and encryption setup,
see [`docs/CONNECTED_ACCOUNTS.md`](docs/CONNECTED_ACCOUNTS.md).

### 2. Database Setup

For the existing Supabase project, link the CLI and use managed migrations:

```bash
npx supabase login
npx supabase link --project-ref rmxuwyxpoazsuqvdadlo
npx supabase db push --dry-run
npx supabase db push
```

Managed history starts from the existing production baseline; see
`scripts/MIGRATIONS.md` before attempting to create a brand-new database.

### 3. Install Dependencies

```bash
# Dashboard
cd dashboard
npm install

# Backend (optional - for Python agents)
cd ..
python -m pip install -r backend/requirements.txt
```

### 4. Run Development Server

```bash
cd dashboard
npm run dev
```

Visit http://localhost:3000

On a fresh install, open http://localhost:3000/setup once to create Zac as the
Supabase-backed owner. Invite Dylan and other teammates later from `/team` so
each person owns their own provider connections.

Before enabling any automation, keep both `PIPELINE_AUTORUN_ENABLED=false` and
`INSTAGRAM_DM_SENDING_ENABLED=false` until the staging checklist in `DEPLOY.md`
has passed.

## Key Features

### Fit Score Benchmarking

Athletes are scored against historical data:

| Metric | Calculation |
|--------|-------------|
| Followers | 25th-75th percentile = ideal range |
| Ratio | Follower/following ratio vs median |
| Engagement | (likes + comments) / followers × 100 |
| Posts | Activity level vs average |

Grades: A (85%+), B (70%+), C (55%+), D (<55%)

### Pipeline Stages

1. **Research** - AI discovers potential athletes
2. **Approval** - Review and approve/reject candidates
3. **Reach Out** - Generate and send outreach messages
4. **Response** - Track replies and conversations
5. **Appointment** - Schedule calls/meetings
6. **Contract** - Finalize partnerships

### Batch Scripts

```bash
# Enrich all historical athletes with Instagram data
node dashboard/scripts/batch-enrich-historical.js

# Fetch photos for all athletes
node dashboard/scripts/batch-fetch-photos.js
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/benchmarks` | GET | Get benchmark metrics from historical data |
| `/api/athletes/[id]/enrich` | POST | Enrich athlete with Instagram data |
| `/api/pipeline/athletes` | GET | Get athletes by pipeline stage |
| `/api/research/run` | POST | Run research agent for a sport |
| `/api/instagram/photos` | GET/POST | Fetch/load athlete photos |

## License

Private - All rights reserved
