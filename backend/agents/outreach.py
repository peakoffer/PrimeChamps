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
        """Get enriched athletes that do NOT already have an outreach message."""
        from backend.database import EnrichmentStatus

        # Set of athletes that already have a message of any status. Pulled in
        # one query rather than per-athlete to avoid N+1.
        contacted_ids = set()
        try:
            existing = (
                self.db.client.table("outreach_messages")
                .select("athlete_id")
                .execute()
            )
            contacted_ids = {
                row["athlete_id"] for row in (existing.data or []) if row.get("athlete_id")
            }
        except Exception as e:
            self.log_error(f"Could not load already-contacted athletes: {e}")
            # Fail safe: if we can't tell who was contacted, don't message anyone.
            return []

        candidates: List[Dict[str, Any]] = []
        offset = 0
        page = max(limit * 2, 50)
        # Page through enriched athletes until we collect `limit` uncontacted ones.
        while len(candidates) < limit:
            enriched = self.db.list_athletes(
                enrichment_status=EnrichmentStatus.ENRICHED, limit=page, offset=offset
            )
            if not enriched:
                break
            for athlete in enriched:
                if athlete["id"] not in contacted_ids:
                    candidates.append(athlete)
                    if len(candidates) >= limit:
                        break
            offset += page

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

    def _get_setting(self, key: str, default: Any) -> Any:
        """Read a value from outreach_settings, falling back to a default."""
        try:
            res = self.db.client.table("outreach_settings").select("value").eq(
                "key", key
            ).single().execute()
            if res.data is not None and res.data.get("value") is not None:
                return res.data["value"]
        except Exception:
            pass
        return default

    def _dms_sent_today(self) -> int:
        """Count outreach messages already marked sent in the last 24h."""
        from datetime import datetime, timedelta
        since = (datetime.utcnow() - timedelta(hours=24)).isoformat()
        try:
            res = self.db.client.table("outreach_messages").select(
                "id", count="exact"
            ).eq("status", OutreachStatus.SENT.value).gte("sent_at", since).execute()
            return res.count or 0
        except Exception:
            return 0

    async def send_approved_messages(self, limit: int = 20) -> Dict[str, Any]:
        """
        Send approved outreach messages via Instagram DM.

        Guardrails (all enforced before any send):
        - outreach_settings.pause_all_outreach must be falsy
        - Instagram kill switch must be off (checked inside send_dm)
        - daily_dm_limit caps sends per rolling 24h
        - hourly rate limit + randomized delay (inside send_dm)

        A message is marked SENT only after Instagram confirms delivery; failures
        leave it APPROVED so it is retried next run.
        """
        from datetime import datetime

        if self._get_setting("pause_all_outreach", False) in (True, "true"):
            self.log_info("Outreach paused via outreach_settings.pause_all_outreach")
            return {"sent": 0, "skipped": 0, "failed": 0, "paused": True}

        daily_limit = int(self._get_setting("daily_dm_limit", 50))
        already_today = self._dms_sent_today()
        remaining_today = max(0, daily_limit - already_today)
        if remaining_today == 0:
            self.log_info(f"Daily DM limit reached ({already_today}/{daily_limit})")
            return {"sent": 0, "skipped": 0, "failed": 0, "daily_limit_reached": True}

        send_budget = min(limit, remaining_today)

        approved = self.db.client.table("outreach_messages").select("*, athletes(*)").eq(
            "approval_status", ApprovalStatus.APPROVED.value
        ).eq(
            "status", OutreachStatus.APPROVED.value
        ).limit(send_budget).execute()

        rows = approved.data or []
        if not rows:
            self.log_info("No approved messages to send")
            return {"sent": 0, "skipped": 0, "failed": 0}

        # Imported here to avoid a hard dependency at module load.
        from backend.sources.instagram_dm import instagram_dm

        results = {"sent": 0, "skipped": 0, "failed": 0}

        for message in rows:
            athlete = message.get("athletes") or {}
            handle = athlete.get("instagram_handle")
            if not handle:
                self.log_info(f"Skipping {athlete.get('name')}: no instagram_handle")
                results["skipped"] += 1
                continue

            send_result = await instagram_dm.send_dm(handle, message["message_content"])

            if send_result.get("success"):
                self.db.client.table("outreach_messages").update({
                    "status": OutreachStatus.SENT.value,
                    "sent_at": datetime.utcnow().isoformat(),
                }).eq("id", message["id"]).execute()
                try:
                    self.db.log_event(
                        event_type="outreach_sent",
                        athlete_id=athlete.get("id"),
                        metadata={"channel": "instagram_dm", "message_id": message["id"]},
                    )
                except Exception:
                    pass
                results["sent"] += 1
                self.log_info(f"Sent DM to {athlete.get('name')} (@{handle})")
            elif send_result.get("error") == "kill_switch_active":
                self.log_info("Kill switch active — stopping send run")
                break
            elif send_result.get("error") in ("rate_limited",):
                self.log_info("Hourly rate limit hit — stopping send run")
                break
            else:
                self.log_error(
                    f"Failed to DM {athlete.get('name')}: {send_result.get('error')}"
                )
                results["failed"] += 1

        return results
