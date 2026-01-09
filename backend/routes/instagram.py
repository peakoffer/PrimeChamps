"""Instagram API routes for DM tracking and authentication."""

from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.instagram_auth import instagram_auth
from backend.services.dm_tracker import dm_tracker
from backend.sources.instagram_dm import instagram_dm
from backend.database import db


router = APIRouter(prefix="/api/instagram", tags=["instagram"])


# Request/Response Models

class LoginRequest(BaseModel):
    """Request to authenticate with Instagram."""
    username: str
    password: str
    verification_code: Optional[str] = None


class LoginResponse(BaseModel):
    """Response from login attempt."""
    success: bool
    message: str
    requires_2fa: bool = False
    requires_challenge: bool = False


class StatusResponse(BaseModel):
    """Instagram connection status."""
    connected: bool
    username: Optional[str] = None
    message: str
    kill_switch_active: bool = False
    has_saved_session: bool = False
    last_used: Optional[str] = None
    requests_this_hour: int = 0


class TrackerStatusResponse(BaseModel):
    """DM tracker status."""
    is_running: bool
    last_sync_sent: Optional[str] = None
    last_sync_replies: Optional[str] = None
    consecutive_errors: int = 0
    backoff_until: Optional[str] = None
    polling_enabled: bool = True
    poll_interval_minutes: int = 5
    kill_switch_active: bool = False


class SyncRequest(BaseModel):
    """Request to trigger manual sync."""
    sync_type: str = "both"  # 'sent', 'replies', or 'both'


class ConfigUpdateRequest(BaseModel):
    """Request to update config."""
    key: str
    value: str


# Authentication Routes

@router.post("/auth", response_model=LoginResponse)
async def authenticate(request: LoginRequest):
    """
    Authenticate with Instagram.

    Securely stores session for future use. If 2FA is required,
    the response will indicate this and you should call again
    with the verification_code.
    """
    success, message = await instagram_auth.login(
        username=request.username,
        password=request.password,
        verification_code=request.verification_code
    )

    return LoginResponse(
        success=success,
        message=message,
        requires_2fa=message == "2FA_REQUIRED",
        requires_challenge=message == "CHALLENGE_REQUIRED"
    )


@router.post("/logout")
async def logout():
    """Logout and invalidate the current session."""
    success, message = await instagram_auth.logout()
    return {"success": success, "message": message}


@router.get("/status", response_model=StatusResponse)
async def get_status():
    """Get current Instagram connection status."""
    status = await instagram_auth.get_status()
    return StatusResponse(
        connected=status.get("connected", False),
        username=status.get("username"),
        message=status.get("message", ""),
        kill_switch_active=status.get("kill_switch_active", False),
        has_saved_session=status.get("has_saved_session", False),
        last_used=status.get("last_used"),
        requests_this_hour=status.get("requests_this_hour", 0)
    )


@router.post("/refresh")
async def refresh_session():
    """Refresh the current session to prevent expiry."""
    success, message = await instagram_auth.refresh_session()
    return {"success": success, "message": message}


# DM Sync Routes

@router.post("/sync-sent")
async def sync_sent_messages():
    """
    Sync sent messages from Instagram.

    Fetches recent DM threads and stores messages we sent
    in the database, matching them to athletes.
    """
    result = await instagram_dm.sync_sent_messages()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Sync failed"))
    return result


@router.post("/sync-replies")
async def sync_replies():
    """
    Sync incoming replies from Instagram.

    Fetches recent DM threads and stores new messages received,
    automatically moving athletes to 'response' stage when they reply.
    """
    result = await instagram_dm.sync_replies()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Sync failed"))
    return result


@router.post("/sync")
async def trigger_sync(request: SyncRequest):
    """
    Manually trigger a sync operation.

    Args:
        sync_type: 'sent', 'replies', or 'both'
    """
    result = await dm_tracker.trigger_sync(request.sync_type)
    return result


# Conversation Routes

@router.get("/conversations")
async def get_conversations(limit: int = 20):
    """
    Get list of DM conversations.

    Returns recent DM threads with basic info.
    """
    conversations = await instagram_dm.get_conversations(limit=limit)
    return {"conversations": conversations}


@router.get("/conversations/{athlete_id}")
async def get_athlete_conversation(athlete_id: str):
    """
    Get DM conversation for a specific athlete.

    Returns the conversation history with the athlete
    based on their Instagram handle.
    """
    result = await instagram_dm.get_conversation_for_athlete(athlete_id)
    if not result:
        raise HTTPException(status_code=404, detail="No conversation found for this athlete")
    return result


@router.get("/thread/{thread_id}/messages")
async def get_thread_messages(thread_id: str, limit: int = 50):
    """
    Get messages from a specific DM thread.

    Args:
        thread_id: Instagram thread ID
        limit: Maximum messages to fetch
    """
    messages = await instagram_dm.get_thread_messages(thread_id, limit=limit)
    return {"messages": messages}


# Tracker Routes

@router.get("/tracker/status", response_model=TrackerStatusResponse)
async def get_tracker_status():
    """Get DM tracker service status."""
    status = await dm_tracker.get_status()
    return TrackerStatusResponse(**status)


@router.post("/tracker/start")
async def start_tracker():
    """Start the background DM polling service."""
    result = await dm_tracker.start()
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@router.post("/tracker/stop")
async def stop_tracker():
    """Stop the background DM polling service."""
    result = await dm_tracker.stop()
    return result


@router.get("/sync-logs")
async def get_sync_logs(limit: int = 20):
    """Get recent sync operation logs."""
    logs = await dm_tracker.get_sync_logs(limit=limit)
    return {"logs": logs}


# Config Routes

@router.get("/config")
async def get_config():
    """Get all Instagram service configuration."""
    try:
        result = db.client.table("instagram_config").select("*").execute()
        config = {item["key"]: item["value"] for item in (result.data or [])}
        return {"config": config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config")
async def update_config(request: ConfigUpdateRequest):
    """
    Update a config value.

    Keys: kill_switch, polling_enabled, poll_interval_minutes,
          max_requests_per_hour, min_delay_seconds, max_delay_seconds
    """
    try:
        # Validate key exists
        existing = db.client.table("instagram_config").select("*").eq(
            "key", request.key
        ).single().execute()

        if not existing.data:
            raise HTTPException(status_code=404, detail=f"Config key '{request.key}' not found")

        # Convert value appropriately
        if request.value.lower() in ["true", "false"]:
            value = request.value.lower() == "true"
        elif request.value.isdigit():
            value = int(request.value)
        else:
            try:
                value = float(request.value)
            except ValueError:
                value = request.value

        # Update
        db.client.table("instagram_config").update({
            "value": value,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("key", request.key).execute()

        return {"success": True, "key": request.key, "value": value}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/kill-switch/activate")
async def activate_kill_switch():
    """Emergency stop all Instagram operations."""
    try:
        db.client.table("instagram_config").update({
            "value": True,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("key", "kill_switch").execute()

        # Stop tracker if running
        await dm_tracker.stop()

        return {"success": True, "message": "Kill switch activated. All Instagram operations stopped."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/kill-switch/deactivate")
async def deactivate_kill_switch():
    """Deactivate the kill switch."""
    try:
        db.client.table("instagram_config").update({
            "value": False,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("key", "kill_switch").execute()

        return {"success": True, "message": "Kill switch deactivated. Instagram operations can resume."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
