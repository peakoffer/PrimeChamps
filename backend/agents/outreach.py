"""Outreach Agent - Generates and manages personalized outreach messages."""

from typing import Dict, Any, List, Optional
from backend.agents.base import BaseAgent
from backend.database import OutreachStatus, ApprovalStatus


class OutreachAgent(BaseAgent):
    """Agent responsible for generating and sending outreach messages."""

    # Default message template
    DEFAULT_TEMPLATE = """Hey {first_name}!

I came across your profile and I'm really impressed by {personalized_hook}.

I'm reaching out because I work with Prime Champs - we partner with athletes like yourself to create exclusive athletic content on OnlyFans. It's a great way to connect with fans and build an additional income stream while doing what you love.

We've had great success with athletes in {sport} and I think you'd be a perfect fit. Would you be open to a quick chat about what this could look like for you?

No pressure at all - just wanted to plant the seed!

Best,
Prime Champs Team"""

    def __init__(self):
        super().__init__("outreach_agent")

    async def run(
        self,
        athlete_ids: Optional[List[str]] = None,
        campaign_id: Optional[str] = None,
        template: Optional[str] = None,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Generate outreach messages for athletes.

        Args:
            athlete_ids: Specific athletes to message, or None for auto-selection
            campaign_id: Campaign to associate messages with
            template: Custom message template, or None for default
            progress_callback: Optional callback for progress updates (current, total, message)

        Returns:
            Dict with results summary
        """
        # Get athletes to message
        if athlete_ids:
            athletes = [self.db.get_athlete(aid) for aid in athlete_ids]
            athletes = [a for a in athletes if a]
        else:
            # Auto-select enriched athletes not yet contacted
            athletes = self._get_outreach_candidates()

        if not athletes:
            self.log_info("No athletes to generate messages for")
            return {"generated": 0}

        total = len(athletes)
        results = {"generated": 0, "failed": 0}
        message_template = template or self.DEFAULT_TEMPLATE

        if progress_callback:
            progress_callback(0, total, f"Generating messages for {total} athletes...")

        for i, athlete in enumerate(athletes):
            try:
                message = await self._generate_message(athlete, message_template)
                self.db.create_outreach_message(
                    athlete_id=athlete["id"],
                    campaign_id=campaign_id,
                    message_content=message["content"],
                    personalization_data=message["personalization"]
                )
                results["generated"] += 1
                self.log_info(f"Generated message for {athlete['name']}")
            except Exception as e:
                self.log_error(f"Failed to generate message for {athlete['id']}: {str(e)}")
                results["failed"] += 1

            # Update progress
            if progress_callback:
                progress_callback(i + 1, total, f"Generated {i + 1}/{total}: {athlete.get('name', 'Unknown')}")

        return results

    def _get_outreach_candidates(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get athletes that are ready for outreach."""
        # Get enriched athletes
        from backend.database import EnrichmentStatus
        enriched = self.db.list_athletes(enrichment_status=EnrichmentStatus.ENRICHED, limit=limit * 2)

        # Filter out those already contacted
        # (In production, would join with outreach_messages table)
        candidates = []
        for athlete in enriched:
            # Check if already has outreach message
            # This is simplified - real implementation would be a proper query
            candidates.append(athlete)
            if len(candidates) >= limit:
                break

        return candidates

    async def _generate_message(
        self,
        athlete: Dict[str, Any],
        template: str
    ) -> Dict[str, Any]:
        """Generate a personalized outreach message for an athlete."""

        # Get enrichment data for personalization
        enrichments = self.db.get_athlete_enrichment(athlete["id"])
        insights = {}
        for e in enrichments:
            if e.get("extracted_insights"):
                insights.update(e["extracted_insights"])

        # Extract first name
        first_name = athlete["name"].split()[0] if athlete.get("name") else "there"

        # Generate personalized hook using AI
        personalized_hook = await self._generate_personalized_hook(athlete, insights)

        # Build personalization data
        personalization = {
            "first_name": first_name,
            "personalized_hook": personalized_hook,
            "sport": athlete.get("sport", "your sport"),
            "talking_points": insights.get("talking_points", []),
            "achievements": insights.get("achievements", [])
        }

        # Format the message
        content = template.format(**personalization)

        return {
            "content": content,
            "personalization": personalization
        }

    async def _generate_personalized_hook(
        self,
        athlete: Dict[str, Any],
        insights: Dict[str, Any]
    ) -> str:
        """Generate a personalized opening hook for the message."""
        prompt = f"""Generate a personalized opening hook for an outreach message to this athlete:

Name: {athlete.get('name')}
Sport: {athlete.get('sport')}
Instagram: @{athlete.get('instagram_handle', 'N/A')}

Insights:
- Talking points: {insights.get('talking_points', 'None')}
- Achievements: {insights.get('achievements', 'None')}
- Notes: {athlete.get('notes', 'None')}

Create a SHORT (10-20 words) personalized hook that:
1. References something specific about them
2. Feels genuine, not salesy
3. Shows you've done your research

Examples:
- "your recent tournament win and the way you've been growing your following"
- "your dedication to gymnastics and the amazing content you share with your fans"
- "your journey in professional swimming and your incredible work ethic"

Return ONLY the hook text, nothing else.
"""

        try:
            response = self.call_claude(
                prompt=prompt,
                system="You are an expert at writing personalized outreach. Be genuine and specific.",
                max_tokens=100
            )
            return response.strip().strip('"').strip("'")
        except Exception as e:
            self.log_error(f"Failed to generate hook: {str(e)}")
            # Fallback to generic hook
            return f"your work in {athlete.get('sport', 'athletics')}"

    async def send_approved_messages(self, limit: int = 20) -> Dict[str, Any]:
        """
        Send messages that have been approved.

        NOTE: This is a placeholder. Real implementation needs:
        - Instagram DM automation (careful with rate limiting)
        - Email sending for those with emails
        - Proper error handling and retry logic

        Returns:
            Dict with send results
        """
        # Get approved messages
        approved = self.db.client.table("outreach_messages").select("*, athletes(*)").eq(
            "approval_status", ApprovalStatus.APPROVED.value
        ).eq(
            "status", OutreachStatus.APPROVED.value
        ).limit(limit).execute()

        if not approved.data:
            self.log_info("No approved messages to send")
            return {"sent": 0}

        results = {"sent": 0, "failed": 0}

        for message in approved.data:
            try:
                # Placeholder for actual sending
                # Real implementation would:
                # 1. Send via Instagram DM API/automation
                # 2. Or send via email if available
                # 3. Update status to SENT
                # 4. Log the event

                self.log_info(f"Would send message to {message['athletes']['name']} (sending not implemented)")
                results["sent"] += 1

            except Exception as e:
                self.log_error(f"Failed to send message {message['id']}: {str(e)}")
                results["failed"] += 1

        return results
