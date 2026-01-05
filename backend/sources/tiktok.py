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
    ACTOR_ID = "clockworks/tiktok-profile-scraper"
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
            "resultsPerPage": 0,  # Just profile info, no videos
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

            for item in data:
                username = item.get("uniqueId", "").lower()
                if username:
                    results[username] = {
                        "followers": item.get("followerCount"),
                        "following": item.get("followingCount"),
                        "likes": item.get("heartCount"),
                        "videos": item.get("videoCount"),
                        "bio": item.get("signature"),
                        "nickname": item.get("nickname"),
                        "is_verified": item.get("verified", False),
                        "profile_pic": item.get("avatarLarger"),
                        "url": f"https://www.tiktok.com/@{username}",
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
