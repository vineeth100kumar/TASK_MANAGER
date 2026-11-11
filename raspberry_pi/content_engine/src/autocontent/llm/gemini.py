"""Google Gemini implementation of LLMClient using google-genai SDK."""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Type, TypeVar, Optional
from pydantic import BaseModel, ValidationError

from .base import LLMClient, LLMUnavailable, LLMBadOutput
from ..settings import get_env_setting

T = TypeVar("T", bound=BaseModel)

RETRY_DELAYS = [2.0, 6.0, 15.0]


class GeminiClient(LLMClient):
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or get_env_setting("GEMINI_API_KEY", "")
        self.model = model or get_env_setting("GEMINI_MODEL", "gemini-2.5-flash")
        self._client = None

    def _get_client(self):
        if not self.api_key:
            raise LLMUnavailable(
                "GEMINI_API_KEY is not set. Please add it to your .env file or use --no-llm mode."
            )
        if self._client is None:
            try:
                from google import genai
                self._client = genai.Client(api_key=self.api_key)
            except Exception as e:
                raise LLMUnavailable(f"Failed to initialize Gemini client: {e}")
        return self._client

    def _log_call(
        self,
        log_dir: Optional[Path],
        stage: str,
        system: str,
        user: str,
        raw_response: str,
        duration: float,
        tokens: Optional[dict] = None
    ):
        if not log_dir:
            return
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_dir / "llm_log.jsonl"
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stage": stage,
                "model": self.model,
                "seconds": round(duration, 3),
                "tokens": tokens or {},
                "system_prompt": system,
                "user_prompt": user,
                "raw_response": raw_response
            }
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass  # Logging failure should not break pipeline

    def generate_json(
        self,
        system: str,
        user: str,
        schema: Type[T],
        temperature: float = 0.0,
        stage: str = "default",
        log_dir: Optional[Path] = None
    ) -> T:
        client = self._get_client()
        from google.genai import types

        current_user_prompt = user
        validation_retries = 0

        while validation_retries <= 1:
            # Attempt API call with rate-limit exponential backoff
            raw_text = ""
            tokens_info = {}
            start_time = time.time()
            api_succeeded = False

            for attempt, delay in enumerate([0.0] + RETRY_DELAYS):
                if delay > 0:
                    time.sleep(delay)
                try:
                    config = types.GenerateContentConfig(
                        system_instruction=system,
                        temperature=temperature,
                        response_mime_type="application/json",
                        response_schema=schema,
                    )
                    response = client.models.generate_content(
                        model=self.model,
                        contents=current_user_prompt,
                        config=config
                    )
                    raw_text = response.text or ""
                    if hasattr(response, "usage_metadata") and response.usage_metadata:
                        tokens_info = {
                            "prompt_tokens": getattr(response.usage_metadata, "prompt_token_count", None),
                            "candidates_tokens": getattr(response.usage_metadata, "candidates_token_count", None),
                            "total_tokens": getattr(response.usage_metadata, "total_token_count", None),
                        }
                    api_succeeded = True
                    break
                except Exception as e:
                    err_msg = str(e).lower()
                    # Check for rate limit or transient 5xx errors
                    is_transient = (
                        "429" in err_msg
                        or "resource_exhausted" in err_msg
                        or "rate limit" in err_msg
                        or "quota" in err_msg
                        or "500" in err_msg
                        or "503" in err_msg
                        or "overloaded" in err_msg
                    )
                    if not is_transient or attempt >= len(RETRY_DELAYS):
                        raise LLMUnavailable(
                            f"Gemini API request failed ({e}). Check your API key, network, or try --no-llm."
                        )

            duration = time.time() - start_time
            self._log_call(log_dir, stage, system, current_user_prompt, raw_text, duration, tokens_info)

            # Validate against Pydantic schema
            try:
                # If raw_text is wrapped in ```json ... ```, strip it
                cleaned_text = raw_text.strip()
                if cleaned_text.startswith("```"):
                    lines = cleaned_text.splitlines()
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    cleaned_text = "\n".join(lines).strip()

                parsed = schema.model_validate_json(cleaned_text)
                return parsed
            except (ValidationError, json.JSONDecodeError) as val_err:
                validation_retries += 1
                if validation_retries > 1:
                    raise LLMBadOutput(
                        f"LLM output failed Pydantic validation for schema {schema.__name__}: {val_err}\nRaw output: {raw_text}"
                    )
                # Retry once with error feedback appended to user prompt
                current_user_prompt = (
                    f"{user}\n\n"
                    f"PREVIOUS ATTEMPT FAILED VALIDATION:\n"
                    f"{val_err}\n"
                    f"Please output valid JSON matching the exact schema."
                )
