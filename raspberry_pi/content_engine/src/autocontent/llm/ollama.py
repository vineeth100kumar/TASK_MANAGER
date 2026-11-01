"""Local Ollama LLM Client implementation for 100% offline, private inference."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Any, Dict, List, Optional, Type, TypeVar
import urllib.error
import urllib.request
from pydantic import BaseModel, ValidationError

from autocontent.llm.base import LLMBadOutput, LLMClient, LLMUnavailable
from autocontent.llm.groq import strip_thinking_tags

T = TypeVar("T", bound=BaseModel)

DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_EXTRACT_MODEL = "qwen2.5:7b"
DEFAULT_COMPOSE_MODEL = "llama3.1:8b"
DEFAULT_VERIFY_MODEL = "qwen2.5:7b"


class OllamaClient(LLMClient):
    """Client for local Ollama REST API with structured JSON output and zero data leakage."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 120.0,
    ):
        raw_url = base_url or os.environ.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_URL)
        self.base_url = raw_url.rstrip("/")
        self.timeout = float(os.environ.get("OLLAMA_TIMEOUT", str(timeout)))

        self.extract_model = os.environ.get("OLLAMA_MODEL_EXTRACT", DEFAULT_EXTRACT_MODEL)
        self.compose_model = os.environ.get("OLLAMA_MODEL_COMPOSE", DEFAULT_COMPOSE_MODEL)
        self.verify_model = os.environ.get("OLLAMA_MODEL_VERIFY", DEFAULT_VERIFY_MODEL)
        self.warnings: List[str] = []

    def is_available(self) -> bool:
        """Check if local Ollama service is reachable."""
        url = f"{self.base_url}/api/tags"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MindDeedsAutoContent/1.0"})
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                return resp.status == 200
        except Exception:
            return False

    def list_models(self) -> List[str]:
        """Fetch list of locally installed model names."""
        url = f"{self.base_url}/api/tags"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MindDeedsAutoContent/1.0"})
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return [m.get("name", "") for m in data.get("models", []) if "name" in m]
        except Exception:
            pass
        return []

    def select_model(self, stage: str) -> str:
        """Select appropriate model for the requested pipeline stage."""
        if stage == "extract_claims" or stage.startswith("extract"):
            return self.extract_model
        elif stage.startswith("compose"):
            return self.compose_model
        elif stage.startswith("verify"):
            return self.verify_model
        return self.compose_model

    def _call_chat_api(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Execute POST /api/chat with the given payload."""
        url = f"{self.base_url}/api/chat"
        req_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=req_bytes,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "MindDeedsAutoContent/1.0",
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                resp_bytes = resp.read()
                return json.loads(resp_bytes.decode("utf-8"))
        except urllib.error.URLError as e:
            raise LLMUnavailable(
                f"Ollama is unreachable at {self.base_url}: {e}. "
                "Ensure Ollama is running ('ollama serve') or use --no-llm."
            ) from e
        except Exception as e:
            raise LLMUnavailable(f"Ollama request failed: {e}") from e

    def generate_json(
        self,
        system: str,
        user: str,
        schema: Type[T],
        temperature: float = 0.0,
        stage: str = "default",
        log_dir: Optional[Path] = None
    ) -> T:
        """Generate structured JSON matching Pydantic schema using local Ollama model."""
        model = self.select_model(stage)
        schema_dict = schema.model_json_schema()

        system_instruction = (
            f"{system}\n\n"
            "CRITICAL: You must output strictly valid JSON conforming to this schema:\n"
            f"{json.dumps(schema_dict, indent=2)}\n"
            "Do not include any explanation, preamble, or commentary outside the JSON."
        )

        messages = [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user}
        ]

        # Ollama 0.5+ supports schema directly as format dict, with fallback to "json" string
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "format": schema_dict,
            "stream": False,
            "options": {
                "temperature": temperature,
            }
        }

        t0 = time.time()
        try:
            resp = self._call_chat_api(payload)
        except LLMUnavailable as e:
            # If 400 Bad Request on schema format, fallback to format="json"
            if "HTTP Error 400" in str(e):
                payload["format"] = "json"
                resp = self._call_chat_api(payload)
            else:
                raise

        latency_ms = int((time.time() - t0) * 1000)

        # Parse message content
        raw_content = resp.get("message", {}).get("content", "")
        clean_content = strip_thinking_tags(raw_content)

        prompt_eval = resp.get("prompt_eval_count", 0)
        eval_count = resp.get("eval_count", 0)

        # Attempt to parse
        parsed_obj: Optional[T] = None
        parse_err: Optional[Exception] = None

        try:
            data = json.loads(clean_content)
            parsed_obj = schema.model_validate(data)
        except Exception as e:
            parse_err = e

        # If failed, retry once with explicit repair prompt
        if parsed_obj is None:
            retry_messages = list(messages)
            retry_messages.append({"role": "assistant", "content": clean_content})
            retry_messages.append({
                "role": "user",
                "content": f"The response was invalid: {parse_err}. Fix all errors and return valid JSON only."
            })
            retry_payload = {
                "model": model,
                "messages": retry_messages,
                "format": "json",
                "stream": False,
                "options": {"temperature": temperature}
            }
            try:
                resp2 = self._call_chat_api(retry_payload)
                raw_content2 = resp2.get("message", {}).get("content", "")
                clean_content2 = strip_thinking_tags(raw_content2)
                data2 = json.loads(clean_content2)
                parsed_obj = schema.model_validate(data2)
                eval_count += resp2.get("eval_count", 0)
            except Exception as e2:
                raise LLMBadOutput(
                    f"Ollama model {model} failed to produce valid JSON for {schema.__name__}: {e2}"
                ) from e2

        # Log request if log_dir provided
        if log_dir is not None:
            try:
                log_dir.mkdir(parents=True, exist_ok=True)
                log_file = log_dir / "llm_log.jsonl"
                entry = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "provider": "ollama",
                    "model": model,
                    "stage": stage,
                    "prompt_tokens": prompt_eval,
                    "completion_tokens": eval_count,
                    "temperature": temperature,
                    "latency_ms": latency_ms,
                    "status": "success",
                }
                with open(log_file, "a", encoding="utf-8") as lf:
                    lf.write(json.dumps(entry) + "\n")
            except Exception:
                pass

        return parsed_obj
