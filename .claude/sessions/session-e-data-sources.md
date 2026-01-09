# Session E: Data Source Implementations

## STATUS: COMPLETE

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
Implement the stubbed data source classes in `backend/sources/` to enable real data fetching.

## Current State
All source files are stubs returning empty/placeholder data:
- `backend/sources/instagram.py` - InstagramScraper stub
- `backend/sources/tiktok.py` - TikTok stub
- `backend/sources/onlyfans.py` - OnlyFans stub
- `backend/sources/web_search.py` - Web search stub

## What to Build

### 1. Instagram Source (`instagram.py`)
Use Apify Instagram Scraper (already have API key):
```python
class InstagramScraper:
    async def get_profile(self, username: str) -> Dict:
        # Use Apify actor: apify/instagram-profile-scraper
        # Return: bio, follower_count, following_count, posts, etc.

    async def get_recent_posts(self, username: str, limit: int = 12) -> List[Dict]:
        # Fetch recent posts with engagement data
```

### 2. Web Search Source (`web_search.py`)
Use SerpAPI for news/web search:
```python
class WebSearchSource:
    async def search_athlete_news(self, name: str) -> List[Dict]:
        # Search for recent news articles

    async def search_athlete_wikipedia(self, name: str) -> Optional[str]:
        # Find Wikipedia page if exists
```

### 3. TikTok Source (`tiktok.py`) - Lower Priority
- Can use Apify TikTok scraper
- Get follower count and engagement

### 4. OnlyFans Source (`onlyfans.py`) - Lower Priority
- Check if username exists on OnlyFans
- No API available - may need web scraping

## Environment Variables
```
APIFY_API_KEY=already_set
SERPAPI_KEY=needed_for_web_search
```

## Files to Modify
- `backend/sources/instagram.py`
- `backend/sources/web_search.py`
- `backend/sources/tiktok.py`
- `backend/sources/onlyfans.py`

## Verification
```bash
cd backend && python -c "
from sources.instagram import InstagramScraper
import asyncio
scraper = InstagramScraper()
profile = asyncio.run(scraper.get_profile('some_test_handle'))
print(profile)
"
```

## Success Criteria
- [x] Instagram profile fetching works via Apify
- [x] Instagram posts fetching works
- [x] TikTok profile fetching works via Apify
- [x] Web search returns news articles
- [x] OnlyFans checking works via Playwright
- [x] Sources integrate with EnrichmentAgent
- [x] Enriched 36 athletes successfully
- [x] Scored 322 athletes with tiers

## Do NOT
- Don't violate any platform ToS
- Don't hardcode API keys
- Don't skip error handling
- Don't make excessive API calls (rate limit)

Start by reading backend/sources/instagram.py, then implement using Apify.
