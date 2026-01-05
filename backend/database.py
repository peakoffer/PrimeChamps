"""Supabase database client and operations."""

from supabase import create_client, Client
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel
from enum import Enum

from backend.config import config


class EnrichmentStatus(str, Enum):
    PENDING = "pending"
    ENRICHED = "enriched"
    FAILED = "failed"


class AthleteSource(str, Enum):
    SEED_DATA = "seed_data"
    RESEARCH_AGENT = "research_agent"
    MANUAL = "manual"


class OutreachStatus(str, Enum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    REPLIED = "replied"
    DECLINED = "declined"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Athlete(BaseModel):
    """Athlete data model."""
    id: Optional[str] = None
    name: str
    sport: str
    instagram_url: Optional[str] = None
    instagram_handle: Optional[str] = None
    email: Optional[str] = None
    profile_url: Optional[str] = None
    wikipedia_url: Optional[str] = None
    follower_count: Optional[int] = None
    engagement_rate: Optional[float] = None
    country: Optional[str] = None
    age: Optional[int] = None
    notes: Optional[str] = None
    # New fields for OnlyFans contract data
    contract_year: Optional[int] = None
    division: Optional[str] = None
    of_username: Optional[str] = None
    of_url: Optional[str] = None
    contract_end_date: Optional[str] = None  # Store as string, parse as needed
    enrichment_status: EnrichmentStatus = EnrichmentStatus.PENDING
    source: AthleteSource = AthleteSource.SEED_DATA
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class Database:
    """Supabase database operations."""

    def __init__(self):
        self._client: Optional[Client] = None

    @property
    def client(self) -> Client:
        """Get or create Supabase client."""
        if self._client is None:
            if not config.supabase.url or not config.supabase.service_key:
                raise ValueError("Supabase URL and service key are required")
            self._client = create_client(
                config.supabase.url,
                config.supabase.service_key
            )
        return self._client

    # ==================== Athletes ====================

    def create_athlete(self, athlete: Athlete) -> Dict[str, Any]:
        """Create a new athlete record."""
        data = athlete.model_dump(exclude={"id", "created_at", "updated_at"})
        data = {k: v for k, v in data.items() if v is not None}

        result = self.client.table("athletes").insert(data).execute()
        return result.data[0] if result.data else {}

    def get_athlete(self, athlete_id: str) -> Optional[Dict[str, Any]]:
        """Get an athlete by ID."""
        result = self.client.table("athletes").select("*").eq("id", athlete_id).execute()
        return result.data[0] if result.data else None

    def get_athlete_by_instagram(self, instagram_handle: str) -> Optional[Dict[str, Any]]:
        """Get an athlete by Instagram handle."""
        result = self.client.table("athletes").select("*").eq("instagram_handle", instagram_handle).execute()
        return result.data[0] if result.data else None

    def list_athletes(
        self,
        sport: Optional[str] = None,
        enrichment_status: Optional[EnrichmentStatus] = None,
        source: Optional[AthleteSource] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List athletes with optional filters."""
        query = self.client.table("athletes").select("*")

        if sport:
            query = query.eq("sport", sport)
        if enrichment_status:
            query = query.eq("enrichment_status", enrichment_status.value)
        if source:
            query = query.eq("source", source.value)

        query = query.range(offset, offset + limit - 1)
        result = query.execute()
        return result.data or []

    def update_athlete(self, athlete_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update an athlete record."""
        data["updated_at"] = datetime.utcnow().isoformat()
        result = self.client.table("athletes").update(data).eq("id", athlete_id).execute()
        return result.data[0] if result.data else {}

    def get_athletes_pending_enrichment(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get athletes that need enrichment."""
        result = (
            self.client.table("athletes")
            .select("*")
            .eq("enrichment_status", EnrichmentStatus.PENDING.value)
            .limit(limit)
            .execute()
        )
        return result.data or []

    # ==================== Enrichment ====================

    def save_enrichment(
        self,
        athlete_id: str,
        data_source: str,
        raw_data: Dict[str, Any],
        extracted_insights: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Save enrichment data for an athlete."""
        data = {
            "athlete_id": athlete_id,
            "data_source": data_source,
            "raw_data": raw_data,
            "extracted_insights": extracted_insights or {},
            "enriched_at": datetime.utcnow().isoformat()
        }
        result = self.client.table("athlete_enrichment").insert(data).execute()
        return result.data[0] if result.data else {}

    def get_athlete_enrichment(self, athlete_id: str) -> List[Dict[str, Any]]:
        """Get all enrichment data for an athlete."""
        result = (
            self.client.table("athlete_enrichment")
            .select("*")
            .eq("athlete_id", athlete_id)
            .order("enriched_at", desc=True)
            .execute()
        )
        return result.data or []

    # ==================== Outreach ====================

    def create_outreach_message(
        self,
        athlete_id: str,
        campaign_id: Optional[str],
        message_content: str,
        personalization_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create a new outreach message."""
        data = {
            "athlete_id": athlete_id,
            "campaign_id": campaign_id,
            "message_content": message_content,
            "personalization_data": personalization_data or {},
            "status": OutreachStatus.PENDING_APPROVAL.value,
            "approval_status": ApprovalStatus.PENDING.value
        }
        result = self.client.table("outreach_messages").insert(data).execute()
        return result.data[0] if result.data else {}

    def get_pending_approvals(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get messages pending human approval."""
        result = (
            self.client.table("outreach_messages")
            .select("*, athletes(*)")
            .eq("approval_status", ApprovalStatus.PENDING.value)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def approve_message(self, message_id: str, approved_by: str) -> Dict[str, Any]:
        """Approve an outreach message for sending."""
        data = {
            "approval_status": ApprovalStatus.APPROVED.value,
            "status": OutreachStatus.APPROVED.value,
            "approved_by": approved_by,
            "approved_at": datetime.utcnow().isoformat()
        }
        result = self.client.table("outreach_messages").update(data).eq("id", message_id).execute()
        return result.data[0] if result.data else {}

    def reject_message(self, message_id: str, approved_by: str) -> Dict[str, Any]:
        """Reject an outreach message."""
        data = {
            "approval_status": ApprovalStatus.REJECTED.value,
            "approved_by": approved_by,
            "approved_at": datetime.utcnow().isoformat()
        }
        result = self.client.table("outreach_messages").update(data).eq("id", message_id).execute()
        return result.data[0] if result.data else {}

    # ==================== Analytics ====================

    def log_event(
        self,
        event_type: str,
        athlete_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Log an analytics event."""
        data = {
            "event_type": event_type,
            "athlete_id": athlete_id,
            "campaign_id": campaign_id,
            "metadata": metadata or {}
        }
        result = self.client.table("analytics_events").insert(data).execute()
        return result.data[0] if result.data else {}

    def log_system(
        self,
        level: str,
        component: str,
        message: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Log a system event."""
        data = {
            "log_level": level,
            "component": component,
            "message": message,
            "metadata": metadata or {}
        }
        result = self.client.table("system_logs").insert(data).execute()
        return result.data[0] if result.data else {}


# Global database instance
db = Database()
