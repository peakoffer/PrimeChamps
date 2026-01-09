"""Enrichment Agent - Fetches and processes additional data about athletes."""

from typing import Dict, Any, List, Optional
import httpx
import re
import json
from backend.agents.base import BaseAgent
from backend.database import EnrichmentStatus
from backend.sources.instagram import InstagramScraper
from backend.sources.tiktok import TikTokScraper
from backend.sources.web_search import WebSearchScraper, WikipediaScraper
from backend.sources.onlyfans import OnlyFansScraper


class EnrichmentAgent(BaseAgent):
    """Agent responsible for enriching athlete data from various sources."""

    def __init__(self):
        super().__init__("enrichment_agent")

    async def run(
        self,
        athlete_id: Optional[str] = None,
        batch_size: int = 10,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Run enrichment on athletes.

        Args:
            athlete_id: Specific athlete to enrich, or None for batch processing
            batch_size: Number of athletes to process in batch mode
            progress_callback: Optional callback for progress updates (current, total, message)

        Returns:
            Dict with results summary
        """
        if athlete_id:
            athletes = [self.db.get_athlete(athlete_id)]
            athletes = [a for a in athletes if a]
        else:
            athletes = self.db.get_athletes_pending_enrichment(limit=batch_size)

        if not athletes:
            self.log_info("No athletes to enrich")
            return {"processed": 0, "success": 0, "failed": 0}

        total = len(athletes)
        results = {"processed": 0, "success": 0, "failed": 0}

        if progress_callback:
            progress_callback(0, total, f"Enriching {total} athletes...")

        for i, athlete in enumerate(athletes):
            try:
                await self._enrich_athlete(athlete)
                results["success"] += 1
            except Exception as e:
                self.log_error(f"Failed to enrich athlete {athlete['id']}: {str(e)}")
                self.db.update_athlete(athlete["id"], {
                    "enrichment_status": EnrichmentStatus.FAILED.value
                })
                results["failed"] += 1
            results["processed"] += 1

            # Update progress
            if progress_callback:
                progress_callback(i + 1, total, f"Enriched {i + 1}/{total}: {athlete.get('name', 'Unknown')}")

        return results

    async def _enrich_athlete(self, athlete: Dict[str, Any]) -> None:
        """Enrich a single athlete with data from all sources."""
        athlete_id = athlete["id"]
        enrichment_data = {}
        handle = athlete.get("instagram_handle")

        # 1. Extract Instagram handle if not present
        if athlete.get("instagram_url") and not handle:
            handle = self._extract_instagram_handle(athlete["instagram_url"])
            if handle:
                self.db.update_athlete(athlete_id, {"instagram_handle": handle})
                athlete["instagram_handle"] = handle

        # 2. Fetch Instagram data with engagement metrics
        if handle:
            instagram_data = await self._fetch_instagram_data(handle)
            if instagram_data:
                enrichment_data["instagram"] = instagram_data
                self.db.save_enrichment(
                    athlete_id=athlete_id,
                    data_source="instagram",
                    raw_data=instagram_data
                )

        # 3. Fetch TikTok data (use same handle as Instagram)
        if handle:
            tiktok_data = await self._fetch_tiktok_data(handle)
            if tiktok_data:
                enrichment_data["tiktok"] = tiktok_data
                self.db.save_enrichment(
                    athlete_id=athlete_id,
                    data_source="tiktok",
                    raw_data=tiktok_data
                )

        # 4. Web search for news, achievements, talking points
        if athlete.get("name"):
            sport = athlete.get("sport", "")
            web_data = await self._fetch_web_search_data(athlete["name"], sport)
            if web_data:
                enrichment_data["web_search"] = web_data
                self.db.save_enrichment(
                    athlete_id=athlete_id,
                    data_source="web_search",
                    raw_data=web_data
                )

        # 5. Check OnlyFans (use Instagram handle)
        if handle:
            onlyfans_data = await self._check_onlyfans(handle)
            if onlyfans_data:
                enrichment_data["onlyfans"] = onlyfans_data
                self.db.save_enrichment(
                    athlete_id=athlete_id,
                    data_source="onlyfans",
                    raw_data=onlyfans_data
                )

        # 6. Fetch Wikipedia/profile data if URL exists
        if athlete.get("profile_url"):
            profile_data = await self._fetch_profile_data(athlete["profile_url"])
            if profile_data:
                enrichment_data["profile"] = profile_data
                self.db.save_enrichment(
                    athlete_id=athlete_id,
                    data_source="profile",
                    raw_data=profile_data
                )

        # 7. Generate AI insights from all enrichment data
        if enrichment_data:
            insights = await self._generate_insights(athlete, enrichment_data)
            self.db.save_enrichment(
                athlete_id=athlete_id,
                data_source="ai_insights",
                raw_data={},
                extracted_insights=insights
            )

        # 8. Update athlete with enriched data
        update_data = {
            "enrichment_status": EnrichmentStatus.ENRICHED.value
        }

        # Instagram data
        ig_data = enrichment_data.get("instagram", {})
        if ig_data:
            if ig_data.get("follower_count"):
                update_data["follower_count"] = ig_data["follower_count"]
            if ig_data.get("profile_pic"):
                update_data["profile_pic_url"] = ig_data["profile_pic"]

        # Build comprehensive notes for scoring agent
        notes_parts = []

        # IG_DATA
        if ig_data:
            ig_summary = {
                "followers": ig_data.get("follower_count"),
                "following": ig_data.get("following_count"),
                "posts": ig_data.get("posts_count"),
                "verified": ig_data.get("is_verified"),
                "private": ig_data.get("is_private"),
                "business": ig_data.get("is_business"),
                "bio": (ig_data.get("bio") or "")[:150],
            }
            notes_parts.append(f"IG_DATA: {json.dumps(ig_summary)}")

        # TT_DATA (TikTok)
        tt_data = enrichment_data.get("tiktok", {})
        if tt_data:
            tt_summary = {
                "followers": tt_data.get("follower_count"),
                "likes": tt_data.get("likes_count"),
                "videos": tt_data.get("video_count"),
                "verified": tt_data.get("is_verified"),
            }
            notes_parts.append(f"TT_DATA: {json.dumps(tt_summary)}")

        # OF_DATA (OnlyFans)
        of_data = enrichment_data.get("onlyfans", {})
        if of_data:
            of_summary = {
                "exists": of_data.get("exists"),
                "name": of_data.get("name"),
            }
            notes_parts.append(f"OF_DATA: {json.dumps(of_summary)}")

        # ACHIEVEMENTS
        web_data = enrichment_data.get("web_search", {})
        if web_data and web_data.get("achievements"):
            achievements = [a.get("title", "")[:50] for a in web_data["achievements"][:3]]
            notes_parts.append(f"ACHIEVEMENTS: {json.dumps(achievements)}")

        # TALKING_POINTS
        if web_data and web_data.get("talking_points"):
            notes_parts.append(f"TALKING_POINTS: {json.dumps(web_data['talking_points'][:3])}")

        # Preserve existing non-enrichment notes
        existing_notes = athlete.get("notes", "") or ""
        preserved_notes = existing_notes
        for prefix in ["IG_DATA:", "TT_DATA:", "OF_DATA:", "ACHIEVEMENTS:", "TALKING_POINTS:"]:
            preserved_notes = re.sub(rf'{prefix}\s*\[[^\]]*\]', '', preserved_notes)
            preserved_notes = re.sub(rf'{prefix}\s*\{{[^}}]*\}}', '', preserved_notes)
        preserved_notes = preserved_notes.strip(" |")

        if preserved_notes:
            notes_parts.append(preserved_notes)

        update_data["notes"] = " | ".join(notes_parts)[:2000]

        self.db.update_athlete(athlete_id, update_data)
        self.log_info(f"Enriched athlete: {athlete['name']}", {
            "athlete_id": athlete_id,
            "sources": list(enrichment_data.keys())
        })

    def _extract_instagram_handle(self, url: str) -> Optional[str]:
        """Extract Instagram handle from URL."""
        patterns = [
            r"instagram\.com/([^/?]+)",
            r"@([a-zA-Z0-9_.]+)"
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                handle = match.group(1).rstrip("/")
                if handle not in ["p", "reel", "stories", "explore"]:
                    return handle
        return None

    async def _fetch_instagram_data(self, handle: str) -> Optional[Dict[str, Any]]:
        """
        Fetch Instagram data for a handle using Apify.

        Returns:
            Dict with: followers, following, posts, bio, is_verified, etc.
        """
        try:
            scraper = InstagramScraper()
            data = scraper.scrape_profile(handle)

            if data:
                self.log_info(f"Fetched Instagram data for @{handle}", {
                    "followers": data.get("followers"),
                    "verified": data.get("is_verified")
                })

                # Transform to our expected format
                return {
                    "follower_count": data.get("followers"),
                    "following_count": data.get("following"),
                    "posts_count": data.get("posts"),
                    "bio": data.get("bio"),
                    "full_name": data.get("full_name"),
                    "is_verified": data.get("is_verified", False),
                    "is_private": data.get("is_private", False),
                    "is_business": data.get("is_business", False),
                    "external_url": data.get("external_url"),
                    "profile_pic": data.get("profile_pic"),
                    "category": data.get("category"),
                }
            else:
                self.log_warning(f"No data returned for @{handle}")
                return None

        except Exception as e:
            self.log_error(f"Instagram fetch failed for @{handle}: {str(e)}")
            return None

    async def _fetch_tiktok_data(self, handle: str) -> Optional[Dict[str, Any]]:
        """
        Fetch TikTok data for a handle using Apify.

        Returns:
            Dict with: followers, likes, videos, bio, is_verified, etc.
        """
        try:
            scraper = TikTokScraper()
            data = scraper.scrape_profile(handle)

            if data and data.get("followers"):
                self.log_info(f"Fetched TikTok data for @{handle}", {
                    "followers": data.get("followers"),
                    "verified": data.get("is_verified")
                })

                return {
                    "follower_count": data.get("followers"),
                    "following_count": data.get("following"),
                    "likes_count": data.get("likes"),
                    "video_count": data.get("videos"),
                    "bio": data.get("bio"),
                    "nickname": data.get("nickname"),
                    "is_verified": data.get("is_verified", False),
                    "profile_pic": data.get("profile_pic"),
                    "url": data.get("url"),
                }
            else:
                self.log_info(f"No TikTok data for @{handle}")
                return None

        except Exception as e:
            self.log_error(f"TikTok fetch failed for @{handle}: {str(e)}")
            return None

    async def _fetch_web_search_data(self, name: str, sport: str) -> Optional[Dict[str, Any]]:
        """
        Fetch news, achievements, and talking points via web search.

        Returns:
            Dict with: achievements, recent_news, talking_points
        """
        try:
            scraper = WebSearchScraper()
            data = scraper.search_athlete(name, sport)

            if data and data.get("sources_searched", 0) > 0:
                self.log_info(f"Web search for {name}", {
                    "sources": data.get("sources_searched"),
                    "achievements": len(data.get("achievements", []))
                })

                return {
                    "achievements": data.get("achievements", []),
                    "recent_news": data.get("recent_news", []),
                    "talking_points": data.get("talking_points", []),
                    "sources_searched": data.get("sources_searched", 0),
                }
            else:
                self.log_info(f"No web search results for {name}")
                return None

        except Exception as e:
            self.log_error(f"Web search failed for {name}: {str(e)}")
            return None

    async def _fetch_wikipedia_data(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Fetch Wikipedia data for an athlete.

        Returns:
            Dict with: bio, career_summary, nationality, etc.
        """
        try:
            scraper = WikipediaScraper()
            data = scraper.get_athlete_info(name)

            if data:
                self.log_info(f"Fetched Wikipedia data for {name}")
                return data
            else:
                self.log_info(f"No Wikipedia page for {name}")
                return None

        except Exception as e:
            self.log_error(f"Wikipedia fetch failed for {name}: {str(e)}")
            return None

    async def _check_onlyfans(self, handle: str) -> Optional[Dict[str, Any]]:
        """
        Check if athlete has an OnlyFans account.

        Returns:
            Dict with: exists, name, url, etc.
        """
        try:
            scraper = OnlyFansScraper()
            data = scraper.check_profile_exists(handle)

            if data.get("exists"):
                self.log_info(f"OnlyFans found for @{handle}", {
                    "name": data.get("name")
                })
                return data
            elif data.get("exists") is False:
                self.log_info(f"No OnlyFans for @{handle}")
                return {"exists": False}
            else:
                # Error or couldn't determine
                return None

        except Exception as e:
            self.log_error(f"OnlyFans check failed for @{handle}: {str(e)}")
            return None

    async def _fetch_profile_data(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Fetch profile/Wikipedia data.

        NOTE: Real implementation would use Firecrawl or similar.
        """
        # Placeholder
        self.log_info(f"Profile enrichment pending implementation for {url}")
        return None

    async def _generate_insights(
        self,
        athlete: Dict[str, Any],
        enrichment_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate AI-powered insights from all enrichment data."""

        # Build a structured summary for Claude
        ig = enrichment_data.get("instagram", {})
        tt = enrichment_data.get("tiktok", {})
        of = enrichment_data.get("onlyfans", {})
        web = enrichment_data.get("web_search", {})

        # Format follower counts
        ig_followers = ig.get('follower_count')
        ig_followers_str = f"{ig_followers:,}" if isinstance(ig_followers, int) else "N/A"
        tt_followers = tt.get('follower_count')
        tt_followers_str = f"{tt_followers:,}" if isinstance(tt_followers, int) else "N/A"
        tt_likes = tt.get('likes_count')
        tt_likes_str = f"{tt_likes:,}" if isinstance(tt_likes, int) else "N/A"

        prompt = f"""Analyze this athlete's data for OnlyFans partnership outreach:

**ATHLETE PROFILE**
Name: {athlete['name']}
Sport: {athlete.get('sport', 'Unknown')}
Instagram: @{athlete.get('instagram_handle', 'N/A')}

**INSTAGRAM DATA**
- Followers: {ig_followers_str}
- Posts: {ig.get('posts_count', 'N/A')}
- Verified: {ig.get('is_verified', False)}
- Bio: {(ig.get('bio') or 'N/A')[:200]}

**TIKTOK DATA**
- Followers: {tt_followers_str}
- Total Likes: {tt_likes_str}
- Verified: {tt.get('is_verified', False)}

**ONLYFANS STATUS**
- Has OnlyFans: {of.get('exists', 'Unknown')}
- OF Name: {of.get('name', 'N/A')}

**WEB SEARCH RESULTS**
- Achievements: {web.get('achievements', [])}
- Recent News: {web.get('recent_news', [])}
- Pre-generated Talking Points: {web.get('talking_points', [])}

---

Based on this data, provide:

1. **outreach_score** (1-10): How promising is this athlete for OnlyFans partnership?
2. **talking_points**: 3-5 personalized conversation starters mentioning their achievements/career
3. **personalization_angles**: How to make the pitch feel personal to them
4. **concerns**: Any red flags (already has OF, private account, controversial content, etc.)
5. **recommended_approach**: Best way to approach them (DM style, timing, etc.)

Return valid JSON only with these exact keys: outreach_score, talking_points, personalization_angles, concerns, recommended_approach
"""

        try:
            response = self.call_claude(
                prompt=prompt,
                system="You are an expert at analyzing athlete profiles for OnlyFans partnership outreach. You understand what makes athletes good candidates and how to personalize messages. Return valid JSON only.",
                max_tokens=800
            )
            # Parse JSON response (with fallback)
            try:
                # Handle potential markdown code blocks
                clean_response = response.strip()
                if clean_response.startswith("```"):
                    clean_response = clean_response.split("```")[1]
                    if clean_response.startswith("json"):
                        clean_response = clean_response[4:]
                return json.loads(clean_response)
            except json.JSONDecodeError:
                return {"raw_insights": response}
        except Exception as e:
            self.log_error(f"Failed to generate insights: {str(e)}")
            return {}
