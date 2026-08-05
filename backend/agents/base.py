"""Base agent class for Prime Champs agents."""

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import anthropic
from backend.config import config
from backend.database import db

LATEST_CLAUDE_SONNET_MODEL = "claude-sonnet-5"


class BaseAgent(ABC):
    """Base class for all Prime Champs agents."""

    def __init__(self, name: str):
        self.name = name
        self.db = db
        self._client: Optional[anthropic.Anthropic] = None

    @property
    def ai_client(self) -> anthropic.Anthropic:
        """Get or create Anthropic client."""
        if self._client is None:
            self._client = anthropic.Anthropic(
                api_key=config.ai.anthropic_api_key
            )
        return self._client

    def log_info(self, message: str, metadata: Optional[Dict[str, Any]] = None):
        """Log an info message."""
        self.db.log_system("info", self.name, message, metadata)

    def log_warning(self, message: str, metadata: Optional[Dict[str, Any]] = None):
        """Log a warning message."""
        self.db.log_system("warning", self.name, message, metadata)

    def log_error(self, message: str, metadata: Optional[Dict[str, Any]] = None):
        """Log an error message."""
        self.db.log_system("error", self.name, message, metadata)

    def call_claude(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: int = 1024
    ) -> str:
        """Call Claude API with a prompt."""
        messages = [{"role": "user", "content": prompt}]

        response = self.ai_client.messages.create(
            model=LATEST_CLAUDE_SONNET_MODEL,
            max_tokens=max_tokens,
            system=system or "You are a helpful assistant.",
            messages=messages
        )

        return response.content[0].text

    @abstractmethod
    async def run(self, *args, **kwargs) -> Any:
        """Run the agent's main task."""
        pass
