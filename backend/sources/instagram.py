"""Instagram data enrichment using Apify."""

import os
import httpx
from typing import Dict, Any, List, Optional
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class InstagramScraper:
    """Scrape Instagram profile data using Apify."""

    # Apify Instagram Profile Scraper actor
    # Use the actual actor ID instead of the name path
    ACTOR_ID = "dSCLg0C3YEZ83HzYX"  # apify/instagram-profile-scraper
    BASE_URL = "https://api.apify.com/v2"

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or os.getenv("APIFY_API_KEY")
        if not self.api_token:
            raise ValueError("APIFY_API_KEY not set")

    def scrape_profile(self, username: str) -> Optional[Dict[str, Any]]:
        """
        Scrape a single Instagram profile.

        Returns:
            Dict with: followers, following, posts, bio, is_verified, etc.
        """
        return self.scrape_profiles([username]).get(username)

    def scrape_profiles(self, usernames: List[str], batch_size: int = 25) -> Dict[str, Dict[str, Any]]:
        """
        Scrape multiple Instagram profiles.

        Args:
            usernames: List of Instagram handles (without @)
            batch_size: Profiles per API call (default 25 to manage costs)

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

        # Prepare input for the actor
        actor_input = {
            "usernames": usernames,
            "resultsLimit": 1,  # Just profile info, not posts
        }

        # Run the actor synchronously
        url = f"{self.BASE_URL}/acts/{self.ACTOR_ID}/run-sync-get-dataset-items"

        try:
            response = httpx.post(
                url,
                params={"token": self.api_token},
                json=actor_input,
                timeout=120  # 2 minutes max
            )
            response.raise_for_status()
            data = response.json()

            # Parse results
            results = {}
            for item in data:
                username = item.get("username", "").lower()
                if username:
                    results[username] = {
                        "followers": item.get("followersCount"),
                        "following": item.get("followsCount"),
                        "posts": item.get("postsCount"),
                        "bio": item.get("biography"),
                        "full_name": item.get("fullName"),
                        "is_verified": item.get("verified", False),
                        "is_private": item.get("private", False),
                        "is_business": item.get("isBusinessAccount", False),
                        "external_url": item.get("externalUrl"),
                        "profile_pic": item.get("profilePicUrl"),
                        "category": item.get("businessCategoryName"),
                    }

            return results

        except httpx.HTTPError as e:
            print(f"Apify API error: {e}")
            return {}
        except Exception as e:
            print(f"Scraper error: {e}")
            return {}

    def get_recent_posts(self, username: str, limit: int = 12) -> List[Dict[str, Any]]:
        """
        Get recent posts with engagement data for a user.

        Args:
            username: Instagram handle (without @)
            limit: Number of posts to fetch (default 12)

        Returns:
            List of posts with likes, comments, caption, etc.
        """
        # Use Instagram Post Scraper actor
        POSTS_ACTOR_ID = "nH2AHrwxeTRJoN5hX"

        actor_input = {
            "username": [username],
            "resultsLimit": limit,
        }

        url = f"{self.BASE_URL}/acts/{POSTS_ACTOR_ID}/run-sync-get-dataset-items"

        try:
            response = httpx.post(
                url,
                params={"token": self.api_token},
                json=actor_input,
                timeout=300  # 5 minutes for large accounts
            )
            response.raise_for_status()
            data = response.json()

            posts = []
            for item in data:
                posts.append({
                    "id": item.get("id"),
                    "shortcode": item.get("shortCode"),
                    "caption": item.get("caption", "")[:500] if item.get("caption") else "",
                    "likes": item.get("likesCount", 0),
                    "comments": item.get("commentsCount", 0),
                    "timestamp": item.get("timestamp"),
                    "type": item.get("type"),  # Image, Video, Sidecar
                    "url": item.get("url"),
                    "display_url": item.get("displayUrl"),
                    "video_views": item.get("videoViewCount"),
                    "video_plays": item.get("videoPlayCount"),
                })

            return posts

        except httpx.HTTPError as e:
            print(f"Posts API error: {e}")
            return []
        except Exception as e:
            print(f"Posts scraper error: {e}")
            return []

    def get_profile_with_engagement(self, username: str, posts_limit: int = 12) -> Dict[str, Any]:
        """
        Get profile data along with engagement metrics from recent posts.

        Returns:
            Dict with profile data + engagement_rate, avg_likes, avg_comments
        """
        profile = self.scrape_profile(username)
        if not profile or not profile.get("followers"):
            return profile or {}

        posts = self.get_recent_posts(username, posts_limit)
        if posts:
            total_likes = sum(p.get("likes", 0) for p in posts)
            total_comments = sum(p.get("comments", 0) for p in posts)
            avg_likes = total_likes / len(posts)
            avg_comments = total_comments / len(posts)

            profile["recent_posts"] = posts
            profile["avg_likes"] = round(avg_likes)
            profile["avg_comments"] = round(avg_comments)
            profile["engagement_rate"] = self.calculate_engagement_rate(
                profile, int(avg_likes), int(avg_comments)
            )

        return profile

    def calculate_engagement_rate(self, profile_data: Dict[str, Any], recent_likes: int = 0, recent_comments: int = 0) -> float:
        """
        Calculate engagement rate.

        Formula: (avg likes + comments) / followers * 100
        """
        followers = profile_data.get("followers", 0)
        if not followers:
            return 0.0

        total_engagement = recent_likes + recent_comments
        return round((total_engagement / followers) * 100, 2)


# Quick test function
def test_scraper():
    """Test the scraper with a sample profile."""
    try:
        scraper = InstagramScraper()
        result = scraper.scrape_profile("funkmastermma")  # Aljamain Sterling
        if result:
            print(f"✅ Scraper working!")
            print(f"   Followers: {result.get('followers'):,}")
            print(f"   Verified: {result.get('is_verified')}")
            return True
        else:
            print("❌ No data returned")
            return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


if __name__ == "__main__":
    test_scraper()
