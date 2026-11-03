"""Abstract base class and exceptions for LLM providers."""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Type, TypeVar, Optional
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Base exception for LLM operations."""
    pass


class LLMUnavailable(LLMError):
    """Raised when the LLM service is unreachable or rate limited after retries."""
    pass


class LLMBadOutput(LLMError):
    """Raised when the LLM output cannot be parsed into the expected schema."""
    pass


class LLMRequestTooLarge(LLMError):
    """Raised when a request exceeds token or chunking budget."""
    pass



class LLMClient(ABC):
    """Abstract interface for structured JSON LLM generation."""

    @abstractmethod
    def generate_json(
        self,
        system: str,
        user: str,
        schema: Type[T],
        temperature: float = 0.0,
        stage: str = "default",
        log_dir: Optional[Path] = None
    ) -> T:
        """Generate structured JSON matching the Pydantic schema."""
        pass
