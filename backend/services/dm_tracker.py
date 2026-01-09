"""Background DM tracking service with polling."""

import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

from backend.database import db
from backend.services.instagram_auth import instagram_auth
from backend.sources.instagram_dm import instagram_dm

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class DMTrackerService:
    """Background service for polling Instagram DMs."""

    def __init__(self):
        self._scheduler: Optional[AsyncIOScheduler] = None
        self._is_running = False
        self._last_sync_sent: Optional[datetime] = None
        self._last_sync_replies: Optional[datetime] = None
        self._consecutive_errors = 0
        self._backoff_until: Optional[datetime] = None

    async def _get_poll_interval(self) -> int:
        """Get polling interval from config (in minutes)."""
        try:
            result = db.client.table("instagram_config").select("*").eq(
                "key", "poll_interval_minutes"
            ).single().execute()
            if result.data:
                return int(result.data["value"])
        except Exception:
            pass
        return 5  # Default 5 minutes

    async def _is_polling_enabled(self) -> bool:
        """Check if polling is enabled in config."""
        try:
            result = db.client.table("instagram_config").select("*").eq(
                "key", "polling_enabled"
            ).single().execute()
            if result.data:
                value = result.data["value"]
                return value == True or value == "true"
        except Exception:
            pass
        return True  # Default enabled

    async def _check_backoff(self) -> bool:
        """Check if we're in backoff period. Returns True if OK to proceed."""
        if self._backoff_until is None:
            return True

        if datetime.utcnow() >= self._backoff_until:
            self._backoff_until = None
            self._consecutive_errors = 0
            return True

        return False

    def _apply_backoff(self) -> None:
        """Apply exponential backoff after errors."""
        self._consecutive_errors += 1

        # Exponential backoff: 1min, 2min, 4min, 8min, max 30min
        backoff_minutes = min(2 ** (self._consecutive_errors - 1), 30)
        self._backoff_until = datetime.utcnow() + timedelta(minutes=backoff_minutes)

        print(f"DM Tracker: Applying {backoff_minutes}min backoff after {self._consecutive_errors} errors")

    async def _poll_job(self) -> None:
        """Single polling job that syncs both sent and replies."""
        # Check kill switch
        if await instagram_auth.is_kill_switch_active():
            print("DM Tracker: Kill switch active, skipping poll")
            return

        # Check polling enabled
        if not await self._is_polling_enabled():
            print("DM Tracker: Polling disabled, skipping")
            return

        # Check backoff
        if not await self._check_backoff():
            print(f"DM Tracker: In backoff until {self._backoff_until}")
            return

        # Check if we have an active session
        status = await instagram_auth.get_status()
        if not status.get("connected"):
            print("DM Tracker: Not connected to Instagram, skipping poll")
            return

        try:
            # Sync sent messages
            print("DM Tracker: Syncing sent messages...")
            sent_result = await instagram_dm.sync_sent_messages()
            self._last_sync_sent = datetime.utcnow()

            if not sent_result.get("success"):
                self._apply_backoff()
                return

            # Small delay between operations
            await asyncio.sleep(3)

            # Sync replies
            print("DM Tracker: Syncing replies...")
            replies_result = await instagram_dm.sync_replies()
            self._last_sync_replies = datetime.utcnow()

            if not replies_result.get("success"):
                self._apply_backoff()
                return

            # Success - reset error counter
            self._consecutive_errors = 0
            self._backoff_until = None

            # Log results
            new_replies = replies_result.get("new_replies", [])
            if new_replies:
                print(f"DM Tracker: Found {len(new_replies)} new replies!")
                for reply in new_replies[:5]:
                    print(f"  - @{reply['username']}: {reply['message_preview']}")

            print(f"DM Tracker: Sync complete. Sent: {sent_result.get('synced', 0)}, Replies: {replies_result.get('synced', 0)}")

        except Exception as e:
            print(f"DM Tracker: Error during poll: {e}")
            self._apply_backoff()

    async def start(self) -> Dict[str, Any]:
        """Start the background polling service."""
        if self._is_running:
            return {"success": False, "message": "Already running"}

        # Check kill switch
        if await instagram_auth.is_kill_switch_active():
            return {"success": False, "message": "Kill switch is active"}

        # Get poll interval
        interval_minutes = await self._get_poll_interval()

        # Create scheduler
        self._scheduler = AsyncIOScheduler()
        self._scheduler.add_job(
            self._poll_job,
            trigger=IntervalTrigger(minutes=interval_minutes),
            id="dm_poll",
            name="Instagram DM Polling",
            replace_existing=True
        )

        self._scheduler.start()
        self._is_running = True

        # Run an initial poll
        asyncio.create_task(self._poll_job())

        return {
            "success": True,
            "message": f"DM tracker started (polling every {interval_minutes} minutes)"
        }

    async def stop(self) -> Dict[str, Any]:
        """Stop the background polling service."""
        if not self._is_running:
            return {"success": False, "message": "Not running"}

        if self._scheduler:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None

        self._is_running = False

        return {"success": True, "message": "DM tracker stopped"}

    async def get_status(self) -> Dict[str, Any]:
        """Get current tracker status."""
        return {
            "is_running": self._is_running,
            "last_sync_sent": self._last_sync_sent.isoformat() if self._last_sync_sent else None,
            "last_sync_replies": self._last_sync_replies.isoformat() if self._last_sync_replies else None,
            "consecutive_errors": self._consecutive_errors,
            "backoff_until": self._backoff_until.isoformat() if self._backoff_until else None,
            "polling_enabled": await self._is_polling_enabled(),
            "poll_interval_minutes": await self._get_poll_interval(),
            "kill_switch_active": await instagram_auth.is_kill_switch_active()
        }

    async def trigger_sync(self, sync_type: str = "both") -> Dict[str, Any]:
        """Manually trigger a sync operation."""
        if await instagram_auth.is_kill_switch_active():
            return {"success": False, "error": "Kill switch is active"}

        results = {}

        if sync_type in ["both", "sent"]:
            results["sent"] = await instagram_dm.sync_sent_messages()

        if sync_type in ["both", "replies"]:
            results["replies"] = await instagram_dm.sync_replies()

        return {"success": True, "results": results}

    async def get_sync_logs(self, limit: int = 20) -> list:
        """Get recent sync logs from database."""
        try:
            result = db.client.table("dm_sync_log").select("*").order(
                "started_at", desc=True
            ).limit(limit).execute()
            return result.data or []
        except Exception:
            return []


# Global tracker instance
dm_tracker = DMTrackerService()
