"""Autonomous pipeline scheduler.

Runs the outreach pipeline end-to-end on an interval:
    enrich (pending) -> score (enriched) -> generate outreach -> send approved

Sending only ever touches APPROVED messages, so the human approval gate still
applies in manual approval mode. Every tick is guarded by:
  - PIPELINE_AUTORUN_ENABLED env (must be "true" to auto-start)
  - outreach_settings.pause_all_outreach (hard stop)
  - INSTAGRAM_DM_SENDING_ENABLED env (must be "true" to send)
  - the Instagram kill switch (for the send step, inside the outreach agent)

Note: the research/discovery step is intentionally NOT scheduled here — the
working research pipeline lives in the dashboard (/api/research/run), and the
backend ResearchAgent is still a stub. Enrich/score/generate/send are wired.
"""

import os
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

from backend.database import db
from backend.agents import EnrichmentAgent, ScoringAgent, OutreachAgent
from backend.services.instagram_auth import instagram_auth

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class PipelineScheduler:
    """Background service that advances the pipeline on a fixed interval."""

    def __init__(self):
        self._scheduler: Optional[AsyncIOScheduler] = None
        self._is_running = False
        self._last_run: Optional[datetime] = None
        self._last_result: Optional[Dict[str, Any]] = None
        self._running_tick = False  # guard against overlapping ticks

    @staticmethod
    def autorun_enabled() -> bool:
        return os.getenv("PIPELINE_AUTORUN_ENABLED", "false").strip().lower() == "true"

    @staticmethod
    def interval_minutes() -> int:
        try:
            return int(os.getenv("PIPELINE_INTERVAL_MINUTES", "60"))
        except ValueError:
            return 60

    def _is_paused(self) -> bool:
        try:
            res = db.client.table("outreach_settings").select("value").eq(
                "key", "pause_all_outreach"
            ).single().execute()
            return res.data and res.data.get("value") in (True, "true")
        except Exception:
            return False

    async def _tick(self) -> Dict[str, Any]:
        """Run one full pipeline pass. Never raises."""
        if self._running_tick:
            return {"skipped": "previous tick still running"}
        self._running_tick = True
        result: Dict[str, Any] = {"started_at": datetime.utcnow().isoformat()}

        try:
            if self._is_paused():
                result["paused"] = True
                return result

            # 1. Enrich pending athletes
            try:
                result["enrich"] = await EnrichmentAgent().run(batch_size=10)
            except Exception as e:
                result["enrich_error"] = str(e)

            # 2. Score newly enriched athletes
            try:
                result["score"] = await ScoringAgent().run()
            except Exception as e:
                result["score_error"] = str(e)

            # 3. Generate outreach for uncontacted candidates
            outreach = OutreachAgent()
            try:
                result["generate"] = await outreach.run()
            except Exception as e:
                result["generate_error"] = str(e)

            # 4. Send approved messages (respects approval gate + guardrails)
            try:
                result["send"] = await outreach.send_approved_messages()
            except Exception as e:
                result["send_error"] = str(e)

            return result
        finally:
            self._running_tick = False
            self._last_run = datetime.utcnow()
            result["finished_at"] = self._last_run.isoformat()
            self._last_result = result
            try:
                db.log_system(
                    level="info",
                    component="pipeline_scheduler",
                    message="pipeline tick complete",
                    metadata=result,
                )
            except Exception:
                pass

    async def start(self) -> Dict[str, Any]:
        if self._is_running:
            return {"success": False, "message": "Already running"}

        interval = self.interval_minutes()
        self._scheduler = AsyncIOScheduler()
        self._scheduler.add_job(
            self._tick,
            trigger=IntervalTrigger(minutes=interval),
            id="pipeline_tick",
            name="Autonomous outreach pipeline",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.start()
        self._is_running = True
        return {"success": True, "message": f"Pipeline scheduler started (every {interval} min)"}

    async def stop(self) -> Dict[str, Any]:
        if not self._is_running:
            return {"success": False, "message": "Not running"}
        if self._scheduler:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None
        self._is_running = False
        return {"success": True, "message": "Pipeline scheduler stopped"}

    async def trigger_once(self) -> Dict[str, Any]:
        """Run a single pipeline tick on demand (manual trigger)."""
        return await self._tick()

    async def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self._is_running,
            "autorun_enabled": self.autorun_enabled(),
            "instagram_dm_sending_enabled": (
                os.getenv("INSTAGRAM_DM_SENDING_ENABLED", "false").strip().lower() == "true"
            ),
            "interval_minutes": self.interval_minutes(),
            "paused": self._is_paused(),
            "last_run": self._last_run.isoformat() if self._last_run else None,
            "last_result": self._last_result,
            "kill_switch_active": await instagram_auth.is_kill_switch_active(),
        }


# Global scheduler instance
pipeline_scheduler = PipelineScheduler()
