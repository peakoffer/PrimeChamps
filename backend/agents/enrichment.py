"""Enrichment Agent - Fetches and processes additional data about athletes."""

from typing import Dict, Any, List, Optional
import httpx
import re
import json
from backend.agents.base import BaseAgent
from backend.database import EnrichmentStatus
from backend.sources.instagram import InstagramScraper


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

        # 1. Extract Instagram handle if not present
        if athlete.get("instagram_url") and not athlete.get("instagram_handle"):
            handle = self._extract_instagram_handle(athlete["instagram_url"])
            if handle:
                self.db.update_athlete(athlete_id, {"instagram_handle": handle})
                athlete["instagram_handle"] = handle

        # 2. Fetch Instagram data (placeholder - needs actual implementation)
        if athlete.get("instagram_handle"):
            instagram_data = await self._fetch_instagram_data(athlete["instagram_handle"])
            if instagram_data:
                enrichment_data["instagram"] = instagram_data
                self.db.save_enrichment(
                    athlete_id=athlete_id,
                    data_source="instagram",
                    raw_data=instagram_data
                )

        # 3. Fetch Wikipedia/profile data if URL exists
        if athlete.get("profile_url"):
            profile_data = await self._fetch_profile_data(athlete["profile_url"])
            if profile_data:
                enrichment_data["profile"] = profile_data
                self.db.save_enrichment(
                    athlete_id=athlete_id,
                    data_source="profile",
                    raw_data=profile_data
                )

        # 4. Generate AI insights from enrichment data
        if enrichment_data:
            insights = await self._generate_insights(athlete, enrichment_data)
            self.db.save_enrichment(
                athlete_id=athlete_id,
                data_source="ai_insights",
                raw_data={},
                extracted_insights=insights
            )

        # 5. Update athlete with enriched data
        update_data = {
            "enrichment_status": EnrichmentStatus.ENRICHED.value
        }

        ig_data = enrichment_data.get("instagram", {})
        if ig_data:
            if ig_data.get("follower_count"):
                update_data["follower_count"] = ig_data["follower_count"]
            if ig_data.get("profile_pic"):
                update_data["profile_pic_url"] = ig_data["profile_pic"]

            # Build IG_DATA notes for scoring agent
            ig_summary = {
                "following": ig_data.get("following_count"),
                "posts": ig_data.get("posts_count"),
                "verified": ig_data.get("is_verified"),
                "private": ig_data.get("is_private"),
                "business": ig_data.get("is_business"),
                "bio": (ig_data.get("bio") or "")[:200],
                "full_name": ig_data.get("full_name"),
            }

            # Preserve existing notes
            existing_notes = athlete.get("notes", "") or ""
            preserved_notes = re.sub(r'IG_DATA:\s*\{[^}]+\}', '', existing_notes).strip()

            new_notes = f"IG_DATA: {json.dumps(ig_summary)}"
            if preserved_notes and not preserved_notes.startswith("|"):
                new_notes = f"{new_notes} | {preserved_notes}"

            update_data["notes"] = new_notes[:1000]

        self.db.update_athlete(athlete_id, update_data)
        self.log_info(f"Enriched athlete: {athlete['name']}", {"athlete_id": athlete_id})

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
        """Generate AI-powered insights from enrichment data."""
        prompt = f"""Analyze this athlete data and provide insights for personalized outreach:

Athlete: {athlete['name']}
Sport: {athlete['sport']}
Instagram: {athlete.get('instagram_handle', 'N/A')}

Enrichment Data:
{enrichment_data}

Provide:
1. Key talking points for outreach (3-5 bullet points)
2. Recent achievements to mention
3. Suggested personalization angles
4. Any concerns or red flags

Format as JSON with keys: talking_points, achievements, personalization_angles, concerns
"""

        try:
            response = self.call_claude(
                prompt=prompt,
                system="You are an expert at analyzing athlete profiles for partnership outreach. Return valid JSON only.",
                max_tokens=500
            )
            # Parse JSON response (with fallback)
            import json
            try:
                return json.loads(response)
            except json.JSONDecodeError:
                return {"raw_insights": response}
        except Exception as e:
            self.log_error(f"Failed to generate insights: {str(e)}")
            return {}
