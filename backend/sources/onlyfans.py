"""OnlyFans profile scraper.

Note: Full profile scraping via Apify requires renting a paid actor.
Basic profile existence checking is available without Apify.
"""

import os
import re
import httpx
from typing import Dict, Any, List, Optional
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class OnlyFansScraper:
    """
    Scrape OnlyFans profile data.

    Two modes:
    1. Basic mode (free): Just checks if profile exists
    2. Full mode (requires paid Apify actor): Gets full profile data
    """

    # Apify OnlyFans Profile Scraper actor (requires rental)
    ACTOR_ID = "hnCZKiaPQdBhjh5En"
    BASE_URL = "https://api.apify.com/v2"

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or os.getenv("APIFY_API_KEY")

    def check_profile_exists(self, username: str) -> Dict[str, Any]:
        """
        Check if OnlyFans profile exists using Playwright (headless browser).

        Returns:
            Dict with exists=True/False and basic profile info
        """
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return {
                "exists": None,
                "username": username,
                "url": f"https://onlyfans.com/{username}",
                "error": "Playwright not installed. Run: pip install playwright && playwright install chromium",
            }

        url = f"https://onlyfans.com/{username}"

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                )
                page = context.new_page()
                page.goto(url, wait_until="networkidle", timeout=30000)

                # Wait for content to load
                page.wait_for_timeout(2000)

                # Check if profile exists by looking for user name element
                name_el = page.query_selector(".g-user-name")

                if not name_el:
                    # No user name element = profile doesn't exist
                    browser.close()
                    return {"exists": False, "username": username, "url": url}

                # Profile exists - extract info
                result = {
                    "exists": True,
                    "username": username,
                    "url": url,
                    "name": name_el.inner_text() if name_el else None,
                }

                # Get avatar
                try:
                    avatar_el = page.query_selector(".g-avatar img")
                    if avatar_el:
                        result["avatar_url"] = avatar_el.get_attribute("src")
                except:
                    pass

                # Get bio/about
                try:
                    bio_el = page.query_selector(".g-user-bio")
                    if bio_el:
                        result["about"] = bio_el.inner_text()
                except:
                    pass

                browser.close()
                return result

        except Exception as e:
            return {
                "exists": None,
                "username": username,
                "url": url,
                "error": str(e),
            }

    def check_profile(self, username: str) -> Optional[Dict[str, Any]]:
        """
        Check/scrape an OnlyFans profile.

        First tries Apify (full data), falls back to basic existence check.
        """
        # Try Apify first for full data
        result = self.scrape_profile(username)
        if result and result.get("exists"):
            return result

        # Fall back to basic check
        return self.check_profile_exists(username)

    def scrape_profile(self, username: str) -> Optional[Dict[str, Any]]:
        """
        Scrape an OnlyFans profile via Apify (requires paid actor rental).

        Returns:
            Dict with full profile data if exists, None if not found
        """
        return self.scrape_profiles([username]).get(username.lower())

    def check_profiles(self, usernames: List[str]) -> Dict[str, Dict[str, Any]]:
        """Alias for scrape_profiles for backward compatibility."""
        return self.scrape_profiles(usernames)

    def scrape_profiles(self, usernames: List[str], batch_size: int = 10) -> Dict[str, Dict[str, Any]]:
        """
        Scrape multiple OnlyFans profiles.

        Args:
            usernames: List of usernames to scrape
            batch_size: Profiles per API call

        Returns:
            Dict mapping username -> profile data
        """
        results = {}

        # Process in batches
        for i in range(0, len(usernames), batch_size):
            batch = usernames[i:i + batch_size]
            batch_results = self._run_scraper(batch)
            results.update(batch_results)

        return results

    def _run_scraper(self, usernames: List[str]) -> Dict[str, Dict[str, Any]]:
        """Run the Apify scraper for a batch of usernames."""

        # Convert usernames to URLs
        profile_urls = [f"https://onlyfans.com/{username}" for username in usernames]

        # Prepare input for the actor
        actor_input = {
            "profileUrls": profile_urls,
        }

        url = f"{self.BASE_URL}/acts/{self.ACTOR_ID}/run-sync-get-dataset-items"

        try:
            response = httpx.post(
                url,
                params={"token": self.api_token},
                json=actor_input,
                timeout=120
            )
            response.raise_for_status()
            data = response.json()

            # Parse results
            results = {}
            for item in data:
                username = item.get("username", "").lower()
                if username:
                    results[username] = {
                        "exists": True,
                        "username": item.get("username"),
                        "name": item.get("name"),
                        "of_id": item.get("id"),
                        "about": item.get("rawAbout") or item.get("about"),
                        "verified": item.get("isVerified", False),
                        "performer": item.get("isPerformer", False),
                        "subscribers_count": item.get("subscribersCount"),
                        "favorites_count": item.get("favoritesCount"),
                        "posts_count": item.get("postsCount"),
                        "photos_count": item.get("photosCount"),
                        "videos_count": item.get("videosCount"),
                        "audios_count": item.get("audiosCount"),
                        "subscription_price": item.get("subscribePrice"),
                        "location": item.get("location"),
                        "website": item.get("website"),
                        "avatar_url": item.get("avatar"),
                        "header_url": item.get("header"),
                        "join_date": item.get("joinDate"),
                        "url": f"https://onlyfans.com/{item.get('username')}",
                        # Social media links from OF profile
                        "instagram_url": item.get("instagram"),
                        "twitter_url": item.get("twitter"),
                        "youtube_url": item.get("youtube"),
                        "tiktok_url": item.get("tiktok"),
                        "discord_url": item.get("discord"),
                        # Engagement capabilities
                        "can_chat": item.get("canChat", False),
                        "has_stories": item.get("hasStories", False),
                        "has_stream": item.get("hasStream", False),
                        # Tip settings
                        "tip_min": item.get("tipMinInternal"),
                        "tip_max": item.get("tipMaxInternal"),
                    }

            return results

        except httpx.HTTPStatusError as e:
            print(f"Apify API error: {e}")
            if e.response.status_code == 404:
                return {}
            return {}
        except Exception as e:
            print(f"OnlyFans scraper error: {e}")
            return {}


def check_athlete_onlyfans(instagram_handle: str) -> Dict[str, Any]:
    """
    Convenience function to check if an athlete has OnlyFans.

    Checks both the exact handle and common variations.
    """
    scraper = OnlyFansScraper()

    # Try exact match first
    result = scraper.check_profile(instagram_handle)
    if result:
        return result

    # Try without underscores
    clean_handle = instagram_handle.replace("_", "")
    if clean_handle != instagram_handle:
        result = scraper.check_profile(clean_handle)
        if result:
            return result

    return {"exists": False}
