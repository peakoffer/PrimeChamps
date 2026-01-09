"""Instagram authentication service with secure session management."""

import os
import json
import base64
import asyncio
import random
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from instagrapi import Client
from instagrapi.exceptions import (
    LoginRequired,
    TwoFactorRequired,
    ChallengeRequired,
    BadPassword,
    PleaseWaitFewMinutes,
)
from dotenv import load_dotenv

from backend.database import db

load_dotenv(Path(__file__).parent.parent.parent / ".env")


class InstagramAuthService:
    """Manages Instagram authentication with encrypted session storage."""

    # Rate limiting constants
    MAX_REQUESTS_PER_HOUR = 20
    MIN_DELAY_SECONDS = 2
    MAX_DELAY_SECONDS = 5

    def __init__(self):
        self._client: Optional[Client] = None
        self._username: Optional[str] = None
        self._encryption_key: Optional[bytes] = None
        self._request_count = 0
        self._request_window_start: Optional[datetime] = None

    def _get_encryption_key(self) -> bytes:
        """Get or generate encryption key from environment."""
        if self._encryption_key:
            return self._encryption_key

        # Use environment variable for key derivation
        secret = os.getenv("INSTAGRAM_SESSION_SECRET")
        if not secret:
            raise ValueError("INSTAGRAM_SESSION_SECRET environment variable not set")

        # Derive a key using PBKDF2
        salt = os.getenv("INSTAGRAM_SESSION_SALT", "prime_champs_ig_salt").encode()
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=480000,
        )
        self._encryption_key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
        return self._encryption_key

    def _encrypt_session(self, session_data: Dict[str, Any]) -> str:
        """Encrypt session data for storage."""
        key = self._get_encryption_key()
        f = Fernet(key)
        json_data = json.dumps(session_data)
        return f.encrypt(json_data.encode()).decode()

    def _decrypt_session(self, encrypted_data: str) -> Dict[str, Any]:
        """Decrypt session data from storage."""
        key = self._get_encryption_key()
        f = Fernet(key)
        decrypted = f.decrypt(encrypted_data.encode())
        return json.loads(decrypted.decode())

    async def _check_rate_limit(self) -> bool:
        """Check if we're within rate limits. Returns True if OK to proceed."""
        now = datetime.utcnow()

        # Reset window if needed
        if self._request_window_start is None or \
           (now - self._request_window_start) > timedelta(hours=1):
            self._request_window_start = now
            self._request_count = 0

        # Check config for current limits
        try:
            config = db.client.table("instagram_config").select("*").eq(
                "key", "max_requests_per_hour"
            ).single().execute()
            max_requests = int(config.data["value"]) if config.data else self.MAX_REQUESTS_PER_HOUR
        except Exception:
            max_requests = self.MAX_REQUESTS_PER_HOUR

        if self._request_count >= max_requests:
            return False

        self._request_count += 1
        return True

    async def _random_delay(self) -> None:
        """Add random delay between requests to avoid detection."""
        try:
            min_conf = db.client.table("instagram_config").select("*").eq(
                "key", "min_delay_seconds"
            ).single().execute()
            max_conf = db.client.table("instagram_config").select("*").eq(
                "key", "max_delay_seconds"
            ).single().execute()

            min_delay = float(min_conf.data["value"]) if min_conf.data else self.MIN_DELAY_SECONDS
            max_delay = float(max_conf.data["value"]) if max_conf.data else self.MAX_DELAY_SECONDS
        except Exception:
            min_delay = self.MIN_DELAY_SECONDS
            max_delay = self.MAX_DELAY_SECONDS

        delay = random.uniform(min_delay, max_delay)
        await asyncio.sleep(delay)

    async def is_kill_switch_active(self) -> bool:
        """Check if kill switch is active."""
        try:
            result = db.client.table("instagram_config").select("*").eq(
                "key", "kill_switch"
            ).single().execute()
            if result.data:
                return result.data["value"] == True or result.data["value"] == "true"
            return False
        except Exception:
            return False

    async def login(
        self,
        username: str,
        password: str,
        verification_code: Optional[str] = None
    ) -> Tuple[bool, str]:
        """
        Authenticate with Instagram.

        Args:
            username: Instagram username
            password: Instagram password
            verification_code: 2FA code if required

        Returns:
            Tuple of (success, message)
        """
        if await self.is_kill_switch_active():
            return False, "Instagram operations are disabled (kill switch active)"

        if not await self._check_rate_limit():
            return False, "Rate limit exceeded. Try again later."

        await self._random_delay()

        try:
            self._client = Client()
            self._username = username

            # Configure client to avoid detection
            self._client.delay_range = [1, 3]  # Random delay between requests

            # Try to load existing session first
            session = await self._load_session(username)
            if session:
                try:
                    self._client.set_settings(session)
                    self._client.login(username, password)
                    # Verify session is still valid
                    self._client.get_timeline_feed()
                    return True, "Logged in using saved session"
                except LoginRequired:
                    # Session expired, need to login again
                    self._client = Client()
                    self._client.delay_range = [1, 3]
                except Exception:
                    # Session invalid, start fresh
                    self._client = Client()
                    self._client.delay_range = [1, 3]

            # Perform fresh login with relogin flag for better handling
            if verification_code:
                self._client.login(username, password, verification_code=verification_code)
            else:
                # Try login with relogin=True which handles some edge cases
                self._client.login(username, password, relogin=True)

            # Save the session
            await self._save_session(username, self._client.get_settings())

            return True, "Login successful"

        except TwoFactorRequired:
            return False, "2FA_REQUIRED"
        except ChallengeRequired as e:
            print(f"Challenge required: {type(e).__name__}")
            return False, "CHALLENGE_REQUIRED"
        except BadPassword as e:
            # Instagram often returns BadPassword for automated logins even with correct password
            print(f"BadPassword error (may be false positive): {type(e).__name__}")
            return False, "Invalid password - Instagram may be blocking automated login. Try logging in via browser first, then export session."
        except PleaseWaitFewMinutes:
            return False, "Rate limited by Instagram. Please wait a few minutes."
        except Exception as e:
            # NEVER log credentials
            error_msg = str(e)
            error_type = type(e).__name__
            print(f"Login exception: {error_type}")
            if password in error_msg:
                error_msg = "Authentication error (details redacted)"
            return False, f"Login failed ({error_type}): {error_msg}"

    async def _save_session(self, username: str, settings: Dict[str, Any]) -> None:
        """Save encrypted session to database."""
        # Remove any sensitive data we don't need
        safe_settings = {
            k: v for k, v in settings.items()
            if k not in ["password", "two_factor_secret"]
        }

        encrypted = self._encrypt_session(safe_settings)

        try:
            db.client.table("instagram_sessions").upsert({
                "account_username": username,
                "session_data": {"encrypted": encrypted},
                "is_active": True,
                "last_used": datetime.utcnow().isoformat(),
            }, on_conflict="account_username").execute()
        except Exception as e:
            # Don't expose session data in error
            raise Exception("Failed to save session") from None

    async def _load_session(self, username: str) -> Optional[Dict[str, Any]]:
        """Load and decrypt session from database."""
        try:
            result = db.client.table("instagram_sessions").select("*").eq(
                "account_username", username
            ).eq("is_active", True).single().execute()

            if not result.data:
                return None

            encrypted = result.data["session_data"].get("encrypted")
            if not encrypted:
                return None

            return self._decrypt_session(encrypted)

        except Exception:
            return None

    async def logout(self) -> Tuple[bool, str]:
        """Logout and invalidate session."""
        if not self._username:
            return False, "Not logged in"

        try:
            # Mark session as inactive
            db.client.table("instagram_sessions").update({
                "is_active": False
            }).eq("account_username", self._username).execute()

            self._client = None
            self._username = None

            return True, "Logged out successfully"
        except Exception as e:
            return False, f"Logout failed: {e}"

    async def get_status(self) -> Dict[str, Any]:
        """Get current connection status."""
        if await self.is_kill_switch_active():
            return {
                "connected": False,
                "username": None,
                "kill_switch_active": True,
                "message": "Instagram operations disabled"
            }

        if not self._client or not self._username:
            # Check if we have a saved session
            try:
                result = db.client.table("instagram_sessions").select("*").eq(
                    "is_active", True
                ).limit(1).execute()

                if result.data:
                    return {
                        "connected": False,
                        "username": result.data[0]["account_username"],
                        "has_saved_session": True,
                        "last_used": result.data[0]["last_used"],
                        "message": "Session available but not active"
                    }
            except Exception:
                pass

            return {
                "connected": False,
                "username": None,
                "message": "Not connected"
            }

        # Verify connection is still valid
        try:
            await self._random_delay()
            self._client.get_timeline_feed()
            return {
                "connected": True,
                "username": self._username,
                "requests_this_hour": self._request_count,
                "message": "Connected"
            }
        except Exception:
            return {
                "connected": False,
                "username": self._username,
                "message": "Session expired"
            }

    def get_client(self) -> Optional[Client]:
        """Get the active Instagram client."""
        return self._client

    async def refresh_session(self) -> Tuple[bool, str]:
        """Refresh the current session to prevent expiry."""
        if not self._client or not self._username:
            return False, "Not logged in"

        if await self.is_kill_switch_active():
            return False, "Kill switch active"

        if not await self._check_rate_limit():
            return False, "Rate limit exceeded"

        try:
            await self._random_delay()
            self._client.get_timeline_feed()

            # Update last_used timestamp
            db.client.table("instagram_sessions").update({
                "last_used": datetime.utcnow().isoformat()
            }).eq("account_username", self._username).execute()

            return True, "Session refreshed"
        except Exception as e:
            return False, f"Failed to refresh: {e}"


# Global auth service instance
instagram_auth = InstagramAuthService()
