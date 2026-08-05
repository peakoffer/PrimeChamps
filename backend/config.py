"""Configuration management for Prime Champs backend."""

import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic import BaseModel

# Load environment variables
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)


class SupabaseConfig(BaseModel):
    """Supabase configuration."""
    url: str = os.getenv("SUPABASE_URL", "")
    anon_key: str = os.getenv("SUPABASE_ANON_KEY", "")
    service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")


class AIConfig(BaseModel):
    """AI provider configuration."""
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")


class EnrichmentConfig(BaseModel):
    """Enrichment API configuration."""
    apify_api_key: str = os.getenv("APIFY_API_KEY", "")


class Config(BaseModel):
    """Main configuration."""
    supabase: SupabaseConfig = SupabaseConfig()
    ai: AIConfig = AIConfig()
    enrichment: EnrichmentConfig = EnrichmentConfig()


# Global config instance
config = Config()
