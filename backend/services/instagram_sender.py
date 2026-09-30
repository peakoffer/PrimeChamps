"""Automated Instagram first-DM sender.

Sends approved outreach messages one at a time, slowly, so the sending account
looks like a person working through a list. Every condition below must hold on
each tick, or nothing is sent:

  - INSTAGRAM_DM_SENDING_ENABLED=true on the backend (deployment switch)
  - outreach_settings.auto_send_instagram is true (owner switch in the dashboard)
  - outreach_settings.pause_all_outreach is false (one-click pause)
  - the Instagram kill switch is off and the account session is connected
  - the local time is inside the sending window
  - fewer than daily_dm_limit DMs were sent in the last 24 hours

Each message must already be approved by a person; this never approves or
writes messages. Using the unofficial Instagram API breaks Instagram's terms
and can get the sending account restricted or banned; the owner accepted that
risk, and these limits keep volume low.
"""

import asyncio
import os
import random
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from backend.agents.outreach import OutreachAgent

MIN_GAP_MINUTES = 6
MAX_GAP_MINUTES = 15
DEFAULT_DAILY_LIMIT = 15
MAXIMUM_DAILY_LIMIT = 30


def _truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() == "true")


class InstagramSender:
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self.last_run_at: Optional[str] = None
        self.last_result: Optional[Dict[str, Any]] = None
        self.next_run_at: Optional[str] = None

    @staticmethod
    def deployment_enabled() -> bool:
        return os.getenv("INSTAGRAM_DM_SENDING_ENABLED", "false").strip().lower() == "true"

    def settings(self, agent: OutreachAgent) -> Dict[str, Any]:
        limit = agent._get_setting("daily_dm_limit", DEFAULT_DAILY_LIMIT)
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = DEFAULT_DAILY_LIMIT
        return {
            "auto_send": _truthy(agent._get_setting("auto_send_instagram", False)),
            "paused": _truthy(agent._get_setting("pause_all_outreach", False)),
            "daily_limit": max(0, min(MAXIMUM_DAILY_LIMIT, limit)),
            "window_start": int(agent._get_setting("send_window_start_hour", 9)),
            "window_end": int(agent._get_setting("send_window_end_hour", 20)),
            "timezone": str(agent._get_setting("send_timezone", "America/New_York")),
        }

    @staticmethod
    def inside_window(settings: Dict[str, Any], now: Optional[datetime] = None) -> bool:
        try:
            zone = ZoneInfo(settings["timezone"])
        except Exception:
            zone = ZoneInfo("America/New_York")
        local = (now or datetime.now(timezone.utc)).astimezone(zone)
        return settings["window_start"] <= local.hour < settings["window_end"]

    async def tick(self) -> Dict[str, Any]:
        """Send at most one approved message if every condition holds."""
        agent = OutreachAgent()
        settings = self.settings(agent)
        if not self.deployment_enabled():
            return {"sent": 0, "reason": "sending_disabled_on_backend"}
        if not settings["auto_send"]:
            return {"sent": 0, "reason": "auto_send_off"}
        if settings["paused"]:
            return {"sent": 0, "reason": "paused"}
        if not self.inside_window(settings):
            return {"sent": 0, "reason": "outside_sending_hours"}
        if agent._dms_sent_today() >= settings["daily_limit"]:
            return {"sent": 0, "reason": "daily_limit_reached"}
        # send_approved_messages re-checks the pause, cap, kill switch and rate limit.
        result = await agent.send_approved_messages(limit=1)
        return {"sent": result.get("sent", 0), "failed": result.get("failed", 0), "reason": "ran"}

    async def _loop(self) -> None:
        while True:
            gap = random.uniform(MIN_GAP_MINUTES, MAX_GAP_MINUTES) * 60
            self.next_run_at = datetime.fromtimestamp(
                datetime.now(timezone.utc).timestamp() + gap, timezone.utc
            ).isoformat()
            await asyncio.sleep(gap)
            try:
                self.last_result = await self.tick()
            except Exception as error:  # never let one failure stop the loop
                self.last_result = {"sent": 0, "reason": f"error:{type(error).__name__}"}
            self.last_run_at = datetime.now(timezone.utc).isoformat()

    def start(self) -> bool:
        if not self.deployment_enabled() or (self._task and not self._task.done()):
            return False
        self._task = asyncio.create_task(self._loop())
        return True

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None

    def status(self) -> Dict[str, Any]:
        agent = OutreachAgent()
        settings = self.settings(agent)
        return {
            "deployment_enabled": self.deployment_enabled(),
            "running": bool(self._task and not self._task.done()),
            "inside_window": self.inside_window(settings),
            "sent_last_24h": agent._dms_sent_today(),
            "last_run_at": self.last_run_at,
            "last_result": self.last_result,
            "next_run_at": self.next_run_at,
            **settings,
        }


instagram_sender = InstagramSender()
