"""Scoring Agent - Calculates lead scores and assigns tiers to athletes."""

from typing import Dict, Any, List, Optional
import json
from backend.agents.base import BaseAgent
from backend.database import EnrichmentStatus


class ScoringAgent(BaseAgent):
    """Agent responsible for scoring athletes and assigning priority tiers."""

    # Combat sports get bonus points based on OF's historical success
    COMBAT_SPORTS = [
        "MMA", "UFC", "Boxing", "Wrestling", "Jiu-Jitsu", "BJJ",
        "Kickboxing", "Muay Thai", "Karate", "Taekwondo"
    ]

    # Follower sweet spots
    IDEAL_MIN_FOLLOWERS = 100_000
    IDEAL_MAX_FOLLOWERS = 500_000

    def __init__(self):
        super().__init__("scoring_agent")

    async def run(
        self,
        athlete_ids: Optional[List[str]] = None,
        rescore: bool = False,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Score athletes and assign priority tiers.

        Args:
            athlete_ids: Specific athletes to score, or None for all enriched
            rescore: If True, rescore even if already scored
            progress_callback: Optional callback for progress updates (current, total, message)

        Returns:
            Dict with results summary
        """
        if athlete_ids:
            athletes = [self.db.get_athlete(aid) for aid in athlete_ids]
            athletes = [a for a in athletes if a]
        else:
            # Get all enriched athletes
            athletes = self.db.list_athletes(
                enrichment_status=EnrichmentStatus.ENRICHED,
                limit=500
            )

        if not athletes:
            self.log_info("No athletes to score")
            return {"scored": 0}

        total = len(athletes)
        results = {"scored": 0, "skipped": 0, "failed": 0}

        if progress_callback:
            progress_callback(0, total, f"Scoring {total} athletes...")

        for i, athlete in enumerate(athletes):
            try:
                # Check if already scored
                existing_score = self._get_existing_score(athlete["id"])
                if existing_score and not rescore:
                    results["skipped"] += 1
                    continue

                # Calculate score
                score, factors = self._calculate_score(athlete)
                tier = self._assign_tier(score)

                # Save score
                self._save_score(athlete["id"], score, tier, factors)
                results["scored"] += 1

                self.log_info(
                    f"Scored {athlete['name']}: {score} ({tier})",
                    {"athlete_id": athlete["id"], "score": score, "tier": tier}
                )

            except Exception as e:
                self.log_error(f"Failed to score {athlete.get('id')}: {str(e)}")
                results["failed"] += 1

            # Update progress
            if progress_callback:
                progress_callback(i + 1, total, f"Scored {i + 1}/{total}: {athlete.get('name', 'Unknown')}")

        return results

    def _calculate_score(self, athlete: Dict[str, Any]) -> tuple[int, Dict[str, int]]:
        """
        Calculate priority score for an athlete (0-100).

        Returns:
            Tuple of (total_score, factors_breakdown)
        """
        factors = {}
        total = 0

        # 1. Follower count in sweet spot (max 25 points)
        followers = athlete.get("follower_count") or 0
        if self.IDEAL_MIN_FOLLOWERS <= followers <= self.IDEAL_MAX_FOLLOWERS:
            factors["followers_sweet_spot"] = 25
        elif 50_000 <= followers < self.IDEAL_MIN_FOLLOWERS:
            factors["followers_sweet_spot"] = 15
        elif self.IDEAL_MAX_FOLLOWERS < followers <= 1_000_000:
            factors["followers_sweet_spot"] = 10
        elif followers > 0:
            factors["followers_sweet_spot"] = 5
        else:
            factors["followers_sweet_spot"] = 0
        total += factors["followers_sweet_spot"]

        # 2. Parse IG data from notes (contains enrichment info)
        ig_data = self._parse_ig_data(athlete.get("notes", ""))

        # 3. Verified account (15 points)
        if ig_data.get("verified"):
            factors["verified"] = 15
        else:
            factors["verified"] = 0
        total += factors["verified"]

        # 4. Combat sport bonus (15 points)
        sport = (athlete.get("sport") or "").lower()
        is_combat = any(cs.lower() in sport for cs in self.COMBAT_SPORTS)
        if is_combat:
            factors["combat_sport"] = 15
        else:
            factors["combat_sport"] = 0
        total += factors["combat_sport"]

        # 5. High engagement - based on posts/followers ratio as proxy (15 points)
        posts = ig_data.get("posts", 0)
        if posts and followers:
            # Active poster = likely engaged audience
            if posts >= 100:
                factors["engagement_proxy"] = 15
            elif posts >= 50:
                factors["engagement_proxy"] = 10
            else:
                factors["engagement_proxy"] = 5
        else:
            factors["engagement_proxy"] = 0
        total += factors["engagement_proxy"]

        # 6. Has email (10 points) - backup outreach channel
        if athlete.get("email"):
            factors["has_email"] = 10
        else:
            factors["has_email"] = 0
        total += factors["has_email"]

        # 7. Not private account (10 points)
        if not ig_data.get("private", True):
            factors["not_private"] = 10
        else:
            factors["not_private"] = 0
        total += factors["not_private"]

        # 8. Business account (5 points) - easier to contact
        if ig_data.get("business"):
            factors["business_account"] = 5
        else:
            factors["business_account"] = 0
        total += factors["business_account"]

        # 9. Good follower/following ratio (5 points)
        following = ig_data.get("following", 0)
        if followers and following:
            ratio = followers / max(following, 1)
            if ratio >= 10:  # Has 10x more followers than following
                factors["follow_ratio"] = 5
            else:
                factors["follow_ratio"] = 0
        else:
            factors["follow_ratio"] = 0
        total += factors["follow_ratio"]

        return min(100, total), factors

    def _parse_ig_data(self, notes: str) -> Dict[str, Any]:
        """Parse IG_DATA JSON from notes field."""
        if not notes:
            return {}

        try:
            # Find IG_DATA: {...} pattern
            import re
            match = re.search(r'IG_DATA:\s*(\{[^}]+\})', notes)
            if match:
                return json.loads(match.group(1))
        except (json.JSONDecodeError, AttributeError):
            pass

        return {}

    def _assign_tier(self, score: int) -> str:
        """Assign lead tier based on score."""
        if score >= 70:
            return "hot"
        elif score >= 40:
            return "warm"
        else:
            return "cold"

    def _get_existing_score(self, athlete_id: str) -> Optional[Dict[str, Any]]:
        """Check if athlete already has a score."""
        try:
            result = self.db.client.table("athlete_scores").select("*").eq(
                "athlete_id", athlete_id
            ).execute()
            return result.data[0] if result.data else None
        except Exception:
            return None

    def _save_score(
        self,
        athlete_id: str,
        score: int,
        tier: str,
        factors: Dict[str, int]
    ) -> None:
        """Save or update athlete score."""
        data = {
            "athlete_id": athlete_id,
            "score": score,
            "tier": tier,
            "factors": factors,
            "scored_at": "now()"
        }

        # Upsert - update if exists, insert if not
        self.db.client.table("athlete_scores").upsert(
            data,
            on_conflict="athlete_id"
        ).execute()

    async def score_single(self, athlete_id: str) -> Dict[str, Any]:
        """Score a single athlete and return details."""
        athlete = self.db.get_athlete(athlete_id)
        if not athlete:
            return {"error": "Athlete not found"}

        score, factors = self._calculate_score(athlete)
        tier = self._assign_tier(score)

        self._save_score(athlete_id, score, tier, factors)

        return {
            "athlete_id": athlete_id,
            "name": athlete["name"],
            "score": score,
            "tier": tier,
            "factors": factors
        }

    def get_top_leads(self, limit: int = 20, tier: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get top scoring leads."""
        query = self.db.client.table("athlete_scores").select(
            "*, athletes(*)"
        ).order("score", desc=True).limit(limit)

        if tier:
            query = query.eq("tier", tier)

        result = query.execute()
        return result.data or []
