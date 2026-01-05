"""Web search and news scraper using Apify."""

import os
import httpx
from typing import Dict, Any, List, Optional
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class WebSearchScraper:
    """Search Google for athlete news and achievements using Apify."""

    # Apify Google Search Scraper actor
    ACTOR_ID = "apify/google-search-scraper"
    BASE_URL = "https://api.apify.com/v2"

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or os.getenv("APIFY_API_KEY")
        if not self.api_token:
            raise ValueError("APIFY_API_KEY not set")

    def search_athlete(self, name: str, sport: str = "") -> Dict[str, Any]:
        """
        Search for an athlete's recent news and achievements.

        Returns:
            Dict with news articles, achievements, and talking points
        """
        # Build search queries
        queries = [
            f'"{name}" athlete {sport} news 2024',
            f'"{name}" {sport} championship winner',
            f'"{name}" {sport} achievements',
        ]

        all_results = []
        for query in queries:
            results = self._search(query, max_results=5)
            all_results.extend(results)

        return self._parse_results(all_results, name)

    def _search(self, query: str, max_results: int = 10) -> List[Dict[str, Any]]:
        """Run a Google search."""

        actor_input = {
            "queries": query,
            "maxPagesPerQuery": 1,
            "resultsPerPage": max_results,
            "languageCode": "en",
            "mobileResults": False,
        }

        url = f"{self.BASE_URL}/acts/{self.ACTOR_ID}/run-sync-get-dataset-items"

        try:
            response = httpx.post(
                url,
                params={"token": self.api_token},
                json=actor_input,
                timeout=60
            )
            response.raise_for_status()
            data = response.json()

            results = []
            for item in data:
                organic = item.get("organicResults", [])
                for result in organic:
                    results.append({
                        "title": result.get("title"),
                        "description": result.get("description"),
                        "url": result.get("url"),
                        "date": result.get("date"),
                    })

            return results

        except Exception as e:
            print(f"Google search error: {e}")
            return []

    def _parse_results(self, results: List[Dict], name: str) -> Dict[str, Any]:
        """Parse search results into structured data."""

        # Deduplicate by URL
        seen_urls = set()
        unique_results = []
        for r in results:
            if r["url"] not in seen_urls:
                seen_urls.add(r["url"])
                unique_results.append(r)

        # Extract key information
        achievements = []
        news = []
        talking_points = []

        achievement_keywords = ["win", "won", "champion", "title", "gold", "record", "first", "best"]
        news_keywords = ["signed", "announced", "joined", "returns", "fight", "match", "tournament"]

        for result in unique_results[:15]:
            title = (result.get("title") or "").lower()
            desc = result.get("description") or ""

            if any(kw in title for kw in achievement_keywords):
                achievements.append({
                    "title": result["title"],
                    "url": result["url"],
                    "snippet": desc[:200],
                })
            elif any(kw in title for kw in news_keywords):
                news.append({
                    "title": result["title"],
                    "url": result["url"],
                    "date": result.get("date"),
                })

        # Generate talking points from achievements
        for ach in achievements[:3]:
            point = ach["title"]
            if name.lower() in point.lower():
                # Remove name to make it more conversational
                point = point.replace(name, "you").replace(name.lower(), "you")
            talking_points.append(point)

        return {
            "achievements": achievements[:5],
            "recent_news": news[:5],
            "talking_points": talking_points[:3],
            "sources_searched": len(unique_results),
        }


class WikipediaScraper:
    """Scrape Wikipedia for athlete information using Apify."""

    ACTOR_ID = "apify/web-scraper"
    BASE_URL = "https://api.apify.com/v2"

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or os.getenv("APIFY_API_KEY")
        if not self.api_token:
            raise ValueError("APIFY_API_KEY not set")

    def get_athlete_info(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Get athlete information from Wikipedia.

        Returns:
            Dict with bio, career info, achievements
        """
        # Search Wikipedia for the athlete
        wiki_url = f"https://en.wikipedia.org/wiki/{name.replace(' ', '_')}"

        actor_input = {
            "startUrls": [{"url": wiki_url}],
            "pageFunction": """
                async function pageFunction(context) {
                    const $ = context.jQuery;

                    // Get infobox data
                    const infobox = {};
                    $('.infobox tr').each((i, row) => {
                        const header = $(row).find('th').text().trim();
                        const value = $(row).find('td').text().trim();
                        if (header && value) {
                            infobox[header] = value;
                        }
                    });

                    // Get first paragraph (bio)
                    const bio = $('.mw-parser-output > p').first().text().trim();

                    // Get career section
                    let career = '';
                    $('#Career, #Professional_career').nextUntil('h2').each((i, el) => {
                        if ($(el).is('p')) {
                            career += $(el).text().trim() + ' ';
                        }
                    });

                    return {
                        title: $('h1').text().trim(),
                        bio: bio.substring(0, 500),
                        career: career.substring(0, 1000),
                        infobox: infobox,
                        url: context.request.url,
                    };
                }
            """,
        }

        url = f"{self.BASE_URL}/acts/{self.ACTOR_ID}/run-sync-get-dataset-items"

        try:
            response = httpx.post(
                url,
                params={"token": self.api_token},
                json=actor_input,
                timeout=60
            )
            response.raise_for_status()
            data = response.json()

            if data and len(data) > 0:
                item = data[0]
                infobox = item.get("infobox", {})

                return {
                    "name": item.get("title"),
                    "bio": item.get("bio"),
                    "career_summary": item.get("career"),
                    "birth_date": infobox.get("Born"),
                    "nationality": infobox.get("Nationality") or infobox.get("Country"),
                    "height": infobox.get("Height"),
                    "weight": infobox.get("Weight"),
                    "team": infobox.get("Team") or infobox.get("Club"),
                    "division": infobox.get("Division") or infobox.get("Weight class"),
                    "record": infobox.get("Record") or infobox.get("MMA record"),
                    "wikipedia_url": item.get("url"),
                }
            return None

        except Exception as e:
            print(f"Wikipedia scraper error: {e}")
            return None


def search_athlete_news(name: str, sport: str = "") -> Dict[str, Any]:
    """Convenience function to search for athlete news."""
    scraper = WebSearchScraper()
    return scraper.search_athlete(name, sport)


def get_wikipedia_info(name: str) -> Optional[Dict[str, Any]]:
    """Convenience function to get Wikipedia info."""
    scraper = WikipediaScraper()
    return scraper.get_athlete_info(name)
