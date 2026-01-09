"""Instagram DM operations using instagrapi."""

import asyncio
from datetime import datetime
from typing import Optional, Dict, Any, List
from pathlib import Path

from instagrapi import Client
from instagrapi.types import DirectThread, DirectMessage
from dotenv import load_dotenv

from backend.database import db
from backend.services.instagram_auth import instagram_auth

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class InstagramDMService:
    """Service for Instagram Direct Message operations."""

    def __init__(self):
        pass

    def _get_client(self) -> Optional[Client]:
        """Get the authenticated Instagram client."""
        return instagram_auth.get_client()

    async def _ensure_connected(self) -> bool:
        """Ensure we have an active connection."""
        if await instagram_auth.is_kill_switch_active():
            return False

        client = self._get_client()
        if not client:
            return False

        return True

    async def get_conversations(
        self,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Get list of DM conversations.

        Args:
            limit: Maximum number of threads to fetch

        Returns:
            List of conversation dicts
        """
        if not await self._ensure_connected():
            return []

        client = self._get_client()
        if not client:
            return []

        try:
            await instagram_auth._random_delay()
            threads: List[DirectThread] = client.direct_threads(amount=limit)

            conversations = []
            for thread in threads:
                # Get the other user(s) in the conversation
                other_users = [u for u in thread.users if u.pk != client.user_id]
                if not other_users:
                    continue

                primary_user = other_users[0]

                conversations.append({
                    "thread_id": str(thread.id),
                    "username": primary_user.username,
                    "full_name": primary_user.full_name,
                    "profile_pic": str(primary_user.profile_pic_url) if primary_user.profile_pic_url else None,
                    "last_message": thread.messages[0].text if thread.messages else None,
                    "last_message_at": thread.messages[0].timestamp.isoformat() if thread.messages else None,
                    "is_read": not thread.pending,
                    "user_count": len(thread.users),
                })

            return conversations

        except Exception as e:
            print(f"Error fetching conversations: {e}")
            return []

    async def get_thread_messages(
        self,
        thread_id: str,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Get messages from a specific thread.

        Args:
            thread_id: Instagram thread ID
            limit: Maximum messages to fetch

        Returns:
            List of message dicts
        """
        if not await self._ensure_connected():
            return []

        client = self._get_client()
        if not client:
            return []

        try:
            await instagram_auth._random_delay()
            thread: DirectThread = client.direct_thread(thread_id, amount=limit)

            messages = []
            for msg in thread.messages:
                messages.append({
                    "message_id": str(msg.id),
                    "thread_id": thread_id,
                    "user_id": str(msg.user_id),
                    "is_sent_by_me": str(msg.user_id) == str(client.user_id),
                    "text": msg.text,
                    "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
                    "item_type": msg.item_type,
                    "is_seen": msg.is_seen,
                })

            return messages

        except Exception as e:
            print(f"Error fetching thread messages: {e}")
            return []

    async def get_thread_by_username(
        self,
        username: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get or create a thread with a specific user.

        Args:
            username: Instagram username

        Returns:
            Thread info dict or None
        """
        if not await self._ensure_connected():
            return None

        client = self._get_client()
        if not client:
            return None

        try:
            await instagram_auth._random_delay()

            # Get user ID from username
            user_id = client.user_id_from_username(username)
            if not user_id:
                return None

            await instagram_auth._random_delay()

            # Get or create thread
            thread = client.direct_thread_by_participants([user_id])

            return {
                "thread_id": str(thread.id),
                "username": username,
                "user_id": str(user_id),
            }

        except Exception as e:
            print(f"Error getting thread for {username}: {e}")
            return None

    async def sync_sent_messages(self) -> Dict[str, Any]:
        """
        Sync sent messages from Instagram to database.

        Returns:
            Dict with sync results
        """
        if not await self._ensure_connected():
            return {"success": False, "error": "Not connected"}

        client = self._get_client()
        if not client:
            return {"success": False, "error": "No client"}

        # Start sync log
        try:
            sync_log = db.client.table("dm_sync_log").insert({
                "sync_type": "sent",
                "status": "running",
                "started_at": datetime.utcnow().isoformat()
            }).execute()
            sync_id = sync_log.data[0]["id"] if sync_log.data else None
        except Exception:
            sync_id = None

        try:
            await instagram_auth._random_delay()
            threads = client.direct_threads(amount=50)

            synced_count = 0
            errors = []

            for thread in threads:
                try:
                    # Get other user
                    other_users = [u for u in thread.users if u.pk != client.user_id]
                    if not other_users:
                        continue

                    primary_user = other_users[0]
                    username = primary_user.username

                    # Try to match to athlete
                    athlete_result = db.client.table("athletes").select("id").eq(
                        "instagram_handle", username
                    ).limit(1).execute()
                    athlete_id = athlete_result.data[0]["id"] if athlete_result.data else None

                    # Upsert conversation
                    conv_data = {
                        "thread_id": str(thread.id),
                        "instagram_username": username,
                        "athlete_id": athlete_id,
                        "last_message_at": thread.messages[0].timestamp.isoformat() if thread.messages else None,
                        "last_message_preview": (thread.messages[0].text or "")[:100] if thread.messages else None,
                        "is_active": True,
                    }

                    db.client.table("instagram_conversations").upsert(
                        conv_data,
                        on_conflict="thread_id"
                    ).execute()

                    # Get conversation ID
                    conv_result = db.client.table("instagram_conversations").select("id").eq(
                        "thread_id", str(thread.id)
                    ).single().execute()
                    conversation_id = conv_result.data["id"] if conv_result.data else None

                    if conversation_id and thread.messages:
                        for msg in thread.messages:
                            # Only sync messages sent by us
                            if str(msg.user_id) != str(client.user_id):
                                continue

                            msg_data = {
                                "conversation_id": conversation_id,
                                "instagram_message_id": str(msg.id),
                                "direction": "sent",
                                "content": msg.text or "",
                                "message_type": msg.item_type or "text",
                                "status": "read" if msg.is_seen else "sent",
                                "seen_at": None,  # Can't get exact seen time
                                "instagram_timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
                            }

                            try:
                                db.client.table("instagram_messages").upsert(
                                    msg_data,
                                    on_conflict="instagram_message_id"
                                ).execute()
                                synced_count += 1
                            except Exception:
                                pass

                    await instagram_auth._random_delay()

                except Exception as e:
                    errors.append(str(e))

            # Update sync log
            if sync_id:
                db.client.table("dm_sync_log").update({
                    "status": "completed",
                    "messages_synced": synced_count,
                    "completed_at": datetime.utcnow().isoformat(),
                    "metadata": {"errors": errors[:10]}  # Limit stored errors
                }).eq("id", sync_id).execute()

            return {
                "success": True,
                "synced": synced_count,
                "errors": len(errors)
            }

        except Exception as e:
            if sync_id:
                db.client.table("dm_sync_log").update({
                    "status": "failed",
                    "error_message": str(e),
                    "completed_at": datetime.utcnow().isoformat()
                }).eq("id", sync_id).execute()

            return {"success": False, "error": str(e)}

    async def sync_replies(self) -> Dict[str, Any]:
        """
        Sync incoming replies from Instagram to database.

        Returns:
            Dict with sync results
        """
        if not await self._ensure_connected():
            return {"success": False, "error": "Not connected"}

        client = self._get_client()
        if not client:
            return {"success": False, "error": "No client"}

        # Start sync log
        try:
            sync_log = db.client.table("dm_sync_log").insert({
                "sync_type": "replies",
                "status": "running",
                "started_at": datetime.utcnow().isoformat()
            }).execute()
            sync_id = sync_log.data[0]["id"] if sync_log.data else None
        except Exception:
            sync_id = None

        try:
            await instagram_auth._random_delay()
            threads = client.direct_threads(amount=50)

            synced_count = 0
            new_replies = []
            errors = []

            for thread in threads:
                try:
                    other_users = [u for u in thread.users if u.pk != client.user_id]
                    if not other_users:
                        continue

                    primary_user = other_users[0]
                    username = primary_user.username

                    # Get conversation from DB
                    conv_result = db.client.table("instagram_conversations").select("id, athlete_id").eq(
                        "thread_id", str(thread.id)
                    ).limit(1).execute()

                    if not conv_result.data:
                        # Create conversation if doesn't exist
                        athlete_result = db.client.table("athletes").select("id").eq(
                            "instagram_handle", username
                        ).limit(1).execute()
                        athlete_id = athlete_result.data[0]["id"] if athlete_result.data else None

                        conv_data = {
                            "thread_id": str(thread.id),
                            "instagram_username": username,
                            "athlete_id": athlete_id,
                            "is_active": True,
                        }
                        db.client.table("instagram_conversations").insert(conv_data).execute()
                        conv_result = db.client.table("instagram_conversations").select("id, athlete_id").eq(
                            "thread_id", str(thread.id)
                        ).single().execute()

                    conversation_id = conv_result.data["id"]
                    athlete_id = conv_result.data.get("athlete_id")

                    if thread.messages:
                        for msg in thread.messages:
                            # Only sync messages NOT sent by us (replies)
                            if str(msg.user_id) == str(client.user_id):
                                continue

                            # Check if message already exists
                            existing = db.client.table("instagram_messages").select("id").eq(
                                "instagram_message_id", str(msg.id)
                            ).limit(1).execute()

                            if existing.data:
                                continue

                            # New reply!
                            msg_data = {
                                "conversation_id": conversation_id,
                                "instagram_message_id": str(msg.id),
                                "direction": "received",
                                "content": msg.text or "",
                                "message_type": msg.item_type or "text",
                                "status": "received",
                                "instagram_timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
                            }

                            try:
                                db.client.table("instagram_messages").insert(msg_data).execute()
                                synced_count += 1

                                new_replies.append({
                                    "username": username,
                                    "athlete_id": athlete_id,
                                    "message_preview": (msg.text or "")[:50],
                                    "timestamp": msg.timestamp.isoformat() if msg.timestamp else None
                                })

                                # Update athlete pipeline stage to 'response' if in 'reach_out'
                                if athlete_id:
                                    athlete = db.client.table("athletes").select("pipeline_stage").eq(
                                        "id", athlete_id
                                    ).single().execute()

                                    if athlete.data and athlete.data.get("pipeline_stage") == "reach_out":
                                        db.client.table("athletes").update({
                                            "pipeline_stage": "response"
                                        }).eq("id", athlete_id).execute()

                            except Exception:
                                pass

                    # Update conversation with latest message
                    if thread.messages:
                        latest = thread.messages[0]
                        is_reply = str(latest.user_id) != str(client.user_id)
                        db.client.table("instagram_conversations").update({
                            "last_message_at": latest.timestamp.isoformat() if latest.timestamp else None,
                            "last_message_preview": (latest.text or "")[:100],
                            "unread_count": 1 if is_reply else 0,
                        }).eq("id", conversation_id).execute()

                    await instagram_auth._random_delay()

                except Exception as e:
                    errors.append(str(e))

            # Update sync log
            if sync_id:
                db.client.table("dm_sync_log").update({
                    "status": "completed",
                    "messages_synced": synced_count,
                    "completed_at": datetime.utcnow().isoformat(),
                    "metadata": {
                        "new_replies": new_replies[:20],
                        "errors": errors[:10]
                    }
                }).eq("id", sync_id).execute()

            return {
                "success": True,
                "synced": synced_count,
                "new_replies": new_replies,
                "errors": len(errors)
            }

        except Exception as e:
            if sync_id:
                db.client.table("dm_sync_log").update({
                    "status": "failed",
                    "error_message": str(e),
                    "completed_at": datetime.utcnow().isoformat()
                }).eq("id", sync_id).execute()

            return {"success": False, "error": str(e)}

    async def get_conversation_for_athlete(
        self,
        athlete_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get DM conversation for a specific athlete.

        Args:
            athlete_id: Database athlete ID

        Returns:
            Conversation with messages or None
        """
        try:
            # Get athlete's Instagram handle
            athlete = db.client.table("athletes").select(
                "instagram_handle"
            ).eq("id", athlete_id).single().execute()

            if not athlete.data or not athlete.data.get("instagram_handle"):
                return None

            username = athlete.data["instagram_handle"]

            # Get conversation from DB
            conv = db.client.table("instagram_conversations").select("*").eq(
                "athlete_id", athlete_id
            ).limit(1).execute()

            if not conv.data:
                # Try by username
                conv = db.client.table("instagram_conversations").select("*").eq(
                    "instagram_username", username
                ).limit(1).execute()

            if not conv.data:
                return None

            conversation = conv.data[0]

            # Get messages
            messages = db.client.table("instagram_messages").select("*").eq(
                "conversation_id", conversation["id"]
            ).order("instagram_timestamp", desc=True).limit(100).execute()

            return {
                "conversation": conversation,
                "messages": messages.data or [],
                "athlete_username": username
            }

        except Exception as e:
            print(f"Error getting conversation for athlete: {e}")
            return None


# Global DM service instance
instagram_dm = InstagramDMService()
