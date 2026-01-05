# Prime Champs - Automated Athlete Outreach System
## Action Plan

---

## Executive Summary

Prime Champs is an automated outreach system designed to identify, research, and contact athletes for OnlyFans athletic content partnerships. The system will:

1. Store and manage athlete data in Supabase
2. Enrich athlete profiles using web crawling/APIs
3. Automatically discover new potential athletes
4. Automate personalized Instagram DM outreach
5. Provide a web dashboard for human oversight
6. Track performance metrics and optimize over time

---

## Phase 1: Foundation & Database Setup
**Priority: Critical | Build First**

### 1.1 Project Initialization
- [ ] Initialize Git repository
- [ ] Set up Python backend (automation, AI agents, data processing)
- [ ] Set up TypeScript/Next.js frontend (dashboard)
- [ ] Configure environment variables and secrets management
- [ ] Set up Supabase project

### 1.2 Database Schema Design (Supabase)

```
Tables:
├── athletes
│   ├── id (uuid, primary key)
│   ├── name (text)
│   ├── sport (text)
│   ├── instagram_url (text)
│   ├── instagram_handle (text)
│   ├── email (text, nullable)
│   ├── profile_url (text)
│   ├── wikipedia_url (text, nullable)
│   ├── follower_count (integer, nullable)
│   ├── engagement_rate (decimal, nullable)
│   ├── country (text, nullable)
│   ├── age (integer, nullable)
│   ├── notes (text, nullable)
│   ├── enrichment_status (enum: pending, enriched, failed)
│   ├── source (enum: seed_data, research_agent, manual)
│   ├── created_at (timestamp)
│   └── updated_at (timestamp)
│
├── athlete_enrichment
│   ├── id (uuid, primary key)
│   ├── athlete_id (uuid, foreign key)
│   ├── data_source (text) -- e.g., 'instagram_api', 'firecrawl', 'manual'
│   ├── raw_data (jsonb)
│   ├── extracted_insights (jsonb)
│   └── enriched_at (timestamp)
│
├── outreach_campaigns
│   ├── id (uuid, primary key)
│   ├── name (text)
│   ├── status (enum: draft, active, paused, completed)
│   ├── message_template (text)
│   ├── target_sports (text[])
│   ├── created_at (timestamp)
│   └── updated_at (timestamp)
│
├── outreach_messages
│   ├── id (uuid, primary key)
│   ├── athlete_id (uuid, foreign key)
│   ├── campaign_id (uuid, foreign key)
│   ├── message_content (text)
│   ├── personalization_data (jsonb)
│   ├── status (enum: draft, pending_approval, approved, sent, delivered, read, replied, declined)
│   ├── approval_status (enum: pending, approved, rejected)
│   ├── approved_by (text, nullable)
│   ├── approved_at (timestamp, nullable)
│   ├── sent_at (timestamp, nullable)
│   ├── response_received_at (timestamp, nullable)
│   ├── response_content (text, nullable)
│   └── created_at (timestamp)
│
├── research_queue
│   ├── id (uuid, primary key)
│   ├── search_query (text)
│   ├── sport_category (text)
│   ├── status (enum: pending, processing, completed, failed)
│   ├── results_count (integer)
│   ├── processed_at (timestamp)
│   └── created_at (timestamp)
│
├── analytics_events
│   ├── id (uuid, primary key)
│   ├── event_type (text) -- e.g., 'message_sent', 'reply_received', 'conversion'
│   ├── athlete_id (uuid, nullable)
│   ├── campaign_id (uuid, nullable)
│   ├── metadata (jsonb)
│   └── created_at (timestamp)
│
└── system_logs
    ├── id (uuid, primary key)
    ├── log_level (enum: info, warning, error)
    ├── component (text) -- e.g., 'enrichment', 'outreach', 'research'
    ├── message (text)
    ├── metadata (jsonb)
    └── created_at (timestamp)
```

### 1.3 Import Seed Data
- [ ] Create data import script
- [ ] Parse Google Sheets CSV export
- [ ] Clean and normalize data (extract Instagram handles, standardize sports)
- [ ] Insert into Supabase athletes table
- [ ] Mark all as `source: seed_data`

---

## Phase 2: Data Enrichment Pipeline
**Priority: High | Build Second**

### 2.1 Enrichment Sources
| Source | Data Retrieved | Implementation |
|--------|---------------|----------------|
| Instagram API/Scraping | Follower count, engagement, recent posts, bio | Apify or custom scraper |
| Firecrawl | Wikipedia data, news articles, achievements | Firecrawl API |
| Google Search API | Recent news, sponsorship deals | SerpAPI or Google Custom Search |
| Social Blade | Growth trends, historical data | API or scraping |

### 2.2 Enrichment Agent (Python)
```
enrichment_agent/
├── __init__.py
├── agent.py              # Main orchestrator
├── sources/
│   ├── instagram.py      # Instagram data fetcher
│   ├── firecrawl.py      # Web crawling
│   ├── wikipedia.py      # Wikipedia parsing
│   └── social_blade.py   # Social metrics
├── processors/
│   ├── data_cleaner.py   # Normalize data
│   └── insight_extractor.py  # AI-powered insights
└── scheduler.py          # Background job runner
```

### 2.3 Enrichment Workflow
1. Pull athletes with `enrichment_status: pending` from queue
2. Run enrichment sources in parallel
3. Store raw data in `athlete_enrichment` table
4. Use AI to extract key insights (talking points, recent achievements)
5. Update athlete record with enriched data
6. Mark as `enrichment_status: enriched`

---

## Phase 3: Research Agent (New Athlete Discovery)
**Priority: High | Build Third**

### 3.1 Research Sources
- Google News (sport + "athlete" + "rising star")
- Instagram hashtag searches (#collegegymnastics, #proswimmer, etc.)
- Sports databases (specific to each sport)
- Reddit communities (r/swimming, r/tennis, etc.)
- TikTok trending athletes

### 3.2 Research Agent (Python)
```
research_agent/
├── __init__.py
├── agent.py              # Main orchestrator
├── sources/
│   ├── google_news.py    # News discovery
│   ├── instagram_hashtags.py  # IG discovery
│   ├── reddit.py         # Reddit mentions
│   └── sports_databases.py    # Sport-specific DBs
├── filters/
│   ├── duplicate_checker.py   # Avoid existing athletes
│   ├── relevance_scorer.py    # AI scoring for fit
│   └── eligibility_checker.py # Basic criteria
└── scheduler.py          # Cron job runner
```

### 3.3 Research Workflow
1. Run scheduled searches across all sources
2. Filter out existing athletes (dedup)
3. Score relevance using AI (0-100 scale)
4. Athletes scoring >70 added to `athletes` table with `source: research_agent`
5. Queue for human review in dashboard
6. Queue for enrichment

### 3.4 Target Criteria (Configurable)
- Follower range: 10K - 500K (sweet spot)
- Sports: Configurable list
- Engagement rate: >2%
- No existing OF presence
- Active posting (within last 30 days)

---

## Phase 4: Outreach Automation
**Priority: High | Build Fourth**

### 4.1 Message Generation (AI-Powered)
```
outreach_engine/
├── __init__.py
├── message_generator.py   # AI message composition
├── personalization.py     # Dynamic content injection
├── templates/
│   ├── initial_outreach.txt
│   ├── follow_up_1.txt
│   └── follow_up_2.txt
└── sender/
    ├── instagram_dm.py    # IG DM automation
    └── email.py           # Email fallback
```

### 4.2 Message Personalization Points
- Athlete's recent achievements
- Specific sport references
- Follower count acknowledgment
- Recent post references
- Mutual connections (if any)

### 4.3 Outreach Workflow
1. Select athletes for campaign (filter by sport, enrichment status, etc.)
2. Generate personalized messages using AI + enrichment data
3. Store in `outreach_messages` with `status: pending_approval`
4. **Human reviews and approves in dashboard**
5. On approval, queue for sending
6. Send via Instagram DM (with rate limiting)
7. Track delivery, read receipts, replies
8. Auto-queue follow-ups based on response status

### 4.4 Instagram DM Automation Options
| Option | Pros | Cons |
|--------|------|------|
| Instagram Graph API | Official, reliable | Limited to business accounts responding to you |
| Browser Automation (Playwright) | Full control | Risk of account ban, maintenance |
| Third-party service (Phantombuster, etc.) | Easy setup | Cost, dependency |
| **Recommendation: Hybrid** | Use API where possible, careful automation for cold outreach |

### 4.5 Safety & Compliance
- Rate limiting (max 20-30 DMs/day to avoid bans)
- Warm-up period for new accounts
- Human approval required for all messages
- Easy opt-out tracking
- No spam, genuine value proposition

---

## Phase 5: Web Dashboard (Next.js + Supabase)
**Priority: High | Build Fifth**

### 5.1 Dashboard Structure
```
dashboard/
├── app/
│   ├── page.tsx                    # Overview/Home
│   ├── athletes/
│   │   ├── page.tsx                # Athlete list
│   │   └── [id]/page.tsx           # Athlete detail
│   ├── outreach/
│   │   ├── page.tsx                # Campaign list
│   │   ├── [id]/page.tsx           # Campaign detail
│   │   └── approve/page.tsx        # Message approval queue
│   ├── research/
│   │   └── page.tsx                # New discoveries review
│   ├── analytics/
│   │   └── page.tsx                # Performance metrics
│   └── settings/
│       └── page.tsx                # System config
├── components/
│   ├── AthleteCard.tsx
│   ├── MessagePreview.tsx
│   ├── ApprovalQueue.tsx
│   └── StatsCard.tsx
└── lib/
    ├── supabase.ts
    └── api.ts
```

### 5.2 Key Dashboard Features

**Home/Overview**
- Total athletes in pipeline
- Messages pending approval
- Sent this week / Replies received
- Conversion funnel visualization

**Athletes View**
- Filterable/searchable table
- Status badges (new, enriched, contacted, replied, converted)
- Quick actions (enrich, add to campaign, view profile)
- Detail view with full enrichment data

**Outreach Approval Queue** (Critical)
- List of pending messages
- Preview generated message
- Edit before sending
- One-click approve/reject
- Bulk actions

**Research Review**
- New athlete discoveries
- Relevance scores
- Quick add to database or dismiss
- Source attribution

**Analytics**
- Response rates by sport
- Best performing message templates
- Time-to-reply metrics
- Conversion tracking

---

## Phase 6: Analytics & Optimization
**Priority: Medium | Build Sixth**

### 6.1 Metrics to Track
- **Outreach Metrics**
  - Messages sent per day/week
  - Delivery rate
  - Read rate
  - Reply rate
  - Positive reply rate
  - Conversion rate (signed to OF)

- **Research Metrics**
  - New athletes discovered per week
  - Quality score distribution
  - Source effectiveness

- **Template Performance**
  - A/B test different templates
  - Reply rate by template
  - Sentiment of replies

### 6.2 Optimization Agent (Future)
- Analyze which messages get best responses
- Auto-suggest template improvements
- Identify best times to send
- Sport-specific insights

---

## Phase 7: Tech Stack Summary

### Backend (Python)
```
requirements.txt:
- supabase
- openai (or anthropic)
- firecrawl-py
- playwright
- apscheduler
- pydantic
- httpx
- python-dotenv
```

### Frontend (TypeScript/Next.js)
```
package.json:
- next
- react
- @supabase/supabase-js
- @supabase/auth-helpers-nextjs
- tailwindcss
- shadcn/ui
- recharts (analytics)
- tanstack/react-table
```

### Infrastructure
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **File Storage**: Supabase Storage (for exports, screenshots)
- **Background Jobs**: Python scheduler (or Supabase Edge Functions)
- **Hosting**: Vercel (dashboard) + Railway/Fly.io (Python workers)

---

## Implementation Order (Chronological)

### Week 1: Foundation
1. [ ] Initialize project structure (monorepo)
2. [ ] Set up Supabase project and create schema
3. [ ] Import seed data from Google Sheets
4. [ ] Basic Python CLI to query athletes

### Week 2: Enrichment
5. [ ] Build Instagram data fetcher
6. [ ] Build Firecrawl integration
7. [ ] Create enrichment agent orchestrator
8. [ ] Enrich all seed data athletes

### Week 3: Dashboard Core
9. [ ] Initialize Next.js dashboard
10. [ ] Build athlete list/detail views
11. [ ] Build approval queue UI
12. [ ] Connect to Supabase real-time

### Week 4: Outreach Engine
13. [ ] Build AI message generator
14. [ ] Create message templates
15. [ ] Build Instagram DM sender (careful approach)
16. [ ] Integrate with approval workflow

### Week 5: Research Agent
17. [ ] Build Google News discovery
18. [ ] Build Instagram hashtag discovery
19. [ ] Create relevance scoring AI
20. [ ] Integrate with dashboard review

### Week 6: Polish & Analytics
21. [ ] Build analytics dashboard
22. [ ] Add system logging
23. [ ] Performance optimization
24. [ ] Documentation

---

## Environment Variables Needed

```env
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# AI
OPENAI_API_KEY= (or ANTHROPIC_API_KEY)

# Enrichment
FIRECRAWL_API_KEY=
SERPAPI_KEY=
APIFY_API_KEY=

# Instagram (careful with these)
INSTAGRAM_SESSION_ID=
INSTAGRAM_CSRF_TOKEN=

# Dashboard
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Instagram account ban | Rate limiting, warm-up, human approval, multiple accounts |
| Low response rates | A/B testing, personalization, timing optimization |
| Data quality issues | Validation, dedup, human review |
| Scalability | Start small, prove model, then scale |

---

## Success Metrics (First 90 Days)

- [ ] 100+ athletes in database (enriched)
- [ ] 50+ outreach messages sent
- [ ] >10% reply rate
- [ ] 5+ positive conversations
- [ ] 1+ athlete signed to OnlyFans

---

## Next Steps

**Ready to begin Phase 1?** We'll start by:
1. Initializing the project structure
2. Setting up Supabase
3. Creating the database schema
4. Importing your seed data

Let me know when you're ready to proceed!
