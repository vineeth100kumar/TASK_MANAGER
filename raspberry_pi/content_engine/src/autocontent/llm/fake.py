"""Fake LLM client for deterministic testing and adversarial verification."""

import json
from pathlib import Path
from typing import Type, TypeVar, Optional, Any, Dict, List
from pydantic import BaseModel
from .base import LLMClient

T = TypeVar("T", bound=BaseModel)


class FakeLLM(LLMClient):
    def __init__(self, responses: Optional[List[Any]] = None):
        """responses can be a list of Pydantic models or JSON strings / dicts."""
        self.responses = list(responses or [])
        self.calls = []

    def queue_response(self, response: Any):
        self.responses.append(response)

    def generate_json(
        self,
        system: str,
        user: str,
        schema: Type[T],
        temperature: float = 0.0,
        stage: str = "default",
        log_dir: Optional[Path] = None
    ) -> T:
        self.calls.append({
            "stage": stage,
            "system": system,
            "user": user,
            "schema": schema,
            "temperature": temperature
        })

        if not self.responses:
            raise RuntimeError(f"FakeLLM has no scripted response for stage '{stage}' with schema {schema.__name__}")

        resp = self.responses.pop(0)

        if isinstance(resp, schema):
            return resp
        elif isinstance(resp, dict):
            return schema.model_validate(resp)
        elif isinstance(resp, str):
            return schema.model_validate_json(resp)
        else:
            return schema.model_validate(resp)
