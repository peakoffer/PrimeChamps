"""TikTok profile scraper using Apify."""

import os
import httpx
from typing import Dict, Any, List, Optional
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class TikTokScraper:
    """Scrape TikTok profile data using Apify."""

    # Apify TikTok Profile Scraper actor
    ACTOR_ID = "0FXVyOXXEmdGcV88a"
    BASE_URL = "https://api.apify.com/v2"

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or os.getenv("APIFY_API_KEY")
        if not self.api_token:
            raise ValueError("APIFY_API_KEY not set")

    def scrape_profile(self, username: str) -> Optional[Dict[str, Any]]:
        """
        Scrape a TikTok profile.

        Returns:
            Dict with: followers, following, likes, bio, verified, etc.
        """
        return self.scrape_profiles([username]).get(username.lower())

    def scrape_profiles(self, usernames: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Scrape multiple TikTok profiles.

        Args:
            usernames: List of TikTok handles (without @)

        Returns:
            Dict mapping username -> profile data
        """
        results = {}

        # Prepare input for the actor
        profiles = [f"https://www.tiktok.com/@{u}" for u in usernames]

        actor_input = {
            "profiles": profiles,
            "resultsPerPage": 1,  # Minimum 1 required
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

            # Group results by author to get profile data
            profiles_seen = set()
            for item in data:
                author = item.get("authorMeta", {})
                username = author.get("name", "").lower()
                if username and username not in profiles_seen:
                    profiles_seen.add(username)
                    results[username] = {
                        "followers": author.get("fans"),
                        "following": author.get("following"),
                        "likes": author.get("heart"),
                        "videos": author.get("video"),
                        "bio": author.get("signature"),
                        "nickname": author.get("nickName"),
                        "is_verified": author.get("verified", False),
                        "profile_pic": author.get("originalAvatarUrl"),
                        "url": author.get("profileUrl"),
                    }

            return results

        except httpx.HTTPError as e:
            print(f"TikTok API error: {e}")
            return {}
        except Exception as e:
            print(f"TikTok scraper error: {e}")
            return {}


def test_tiktok_scraper():
    """Test the TikTok scraper."""
    try:
        scraper = TikTokScraper()
        # Test with a known athlete
        result = scraper.scrape_profile("thenotoriousmma")
        if result:
            print(f"✅ TikTok scraper working!")
            print(f"   Followers: {result.get('followers'):,}")
            print(f"   Verified: {result.get('is_verified')}")
            return True
        else:
            print("❌ No TikTok data returned")
            return False
    except Exception as e:
        print(f"❌ TikTok error: {e}")
        return False


if __name__ == "__main__":
    test_tiktok_scraper()
