"""Groq LLM Client implementation with rate limiting and structured output."""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Type, TypeVar
from pydantic import BaseModel, ValidationError

from autocontent.llm.base import LLMBadOutput, LLMClient, LLMRequestTooLarge, LLMUnavailable
from autocontent.llm.limiter import RateLimiter, estimate_tokens
from autocontent.progress import report
from autocontent.settings import PROJECT_ROOT

T = TypeVar("T", bound=BaseModel)

DEFAULT_EXTRACT_MODEL = "openai/gpt-oss-20b"
DEFAULT_COMPOSE_MODEL = "openai/gpt-oss-120b"
DEFAULT_VERIFY_MODEL = "qwen/qwen3.8-27b"


def strip_thinking_tags(text: str) -> str:
    """Strip any <think>...</think> reasoning blocks from text."""
    clean = re.sub(r"<think>[\s\S]*?</think>", "", text)
    # Also strip code fence markdown if wrapped in ```json ... ```
    clean = clean.strip()
    match = re.search(r"^```(?:json)?\s*([\s\S]*?)\s*```$", clean)
    if match:
        clean = match.group(1).strip()
    return clean


class GroqClient(LLMClient):
    """Client for Groq LLM API with structured output, rate limiting, and fallbacks."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        limiter: Optional[RateLimiter] = None,
    ):
        self.api_key = api_key or os.environ.get("GROQ_API_KEY")
        if not self.api_key or self.api_key == "your_groq_api_key_here":
            self.client = None
        else:
            try:
                from groq import Groq
                self.client = Groq(api_key=self.api_key)
            except ImportError:
                self.client = None

        self.limiter = limiter or RateLimiter()
        self.extract_model = os.environ.get("GROQ_MODEL_EXTRACT", DEFAULT_EXTRACT_MODEL)
        self.compose_model = os.environ.get("GROQ_MODEL_COMPOSE", DEFAULT_COMPOSE_MODEL)
        self.verify_model = os.environ.get("GROQ_MODEL_VERIFY", DEFAULT_VERIFY_MODEL)

        fb_str = os.environ.get(
            "GROQ_FALLBACK_MODELS",
            f"{DEFAULT_EXTRACT_MODEL},{DEFAULT_COMPOSE_MODEL},{DEFAULT_VERIFY_MODEL}"
        )
        self.fallback_models = [m.strip() for m in fb_str.split(",") if m.strip()]
        self.warnings: List[str] = []

    def select_model(self, stage: str) -> str:
        """Select model according to stage with daily limit fallback handling."""
        if stage == "extract_claims" or stage.startswith("extract"):
            primary = self.extract_model
        elif stage.startswith("compose"):
            primary = self.compose_model
        elif stage.startswith("verify"):
            primary = self.verify_model
        else:
            primary = self.compose_model

        # Check if primary model is exhausted
        usage = self.limiter.load_usage()
        if not self.limiter.is_model_exhausted(primary, usage):
            return primary

        # Primary is exhausted; try fallbacks
        for fb in self.fallback_models:
            if not self.limiter.is_model_exhausted(fb, usage):
                if stage.startswith("verify") and fb == self.compose_model:
                    warn = "verifier is not independent of composer"
                    print(f"[!] Warning: {warn}", file=sys.stderr)
                    if warn not in self.warnings:
                        self.warnings.append(warn)
                return fb

        # All models exhausted
        print("Daily Groq limits reached. Try later or run with --no-llm.", file=sys.stderr)
        sys.exit(3)

    def _call_groq_api(
        self,
        model: str,
        messages: List[Dict[str, str]],
        max_tokens: int,
        temperature: float,
        schema: Type[T],
        try_json_schema: bool = True,
        reasoning_effort: str = "low",
    ) -> Tuple[str, str, int]:
        """Execute chat completion and return (content, finish_reason, total_tokens)."""
        extra_kwargs: Dict[str, Any] = {}

        # Groq structured output: try json_schema or fallback to json_object
        if try_json_schema:
            try:
                response_format = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema.__name__,
                        "strict": True,
                        "schema": schema.model_json_schema(),
                    },
                }
            except Exception:
                response_format = {"type": "json_object"}
        else:
            response_format = {"type": "json_object"}

        # Reasoning parameter
        if "gpt-oss" in model:
            extra_kwargs["reasoning_effort"] = reasoning_effort

        retries_5xx = 0
        retries_json = 0
        backoffs_429 = [5.0, 15.0, 30.0]
        retry_429_idx = 0

        while True:
            try:
                resp = self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_completion_tokens=max_tokens,
                    response_format=response_format,
                    **extra_kwargs,
                )
                choice = resp.choices[0]
                content = choice.message.content or ""
                finish_reason = choice.finish_reason or "stop"
                total_tokens = resp.usage.total_tokens if resp.usage else 0
                return content, finish_reason, total_tokens

            except Exception as e:
                err_str = str(e)
                status_code = getattr(e, "status_code", None)

                # 401 Unauthorized
                if status_code == 401 or "401" in err_str:
                    raise LLMUnavailable("Groq rejected the API key.") from e

                # 413 Request Too Large
                if status_code == 413 or "413" in err_str:
                    raise LLMRequestTooLarge(f"Groq request too large (413): {err_str}") from e

                # 429 Rate Limit
                if status_code == 429 or "429" in err_str:
                    # Check for daily limit in message
                    if "daily" in err_str.lower() or "day" in err_str.lower():
                        usage = self.limiter.load_usage()
                        m_stat = usage.setdefault("per_model", {}).setdefault(model, {"requests": 0, "tokens": 0})
                        m_stat["tokens"] = 200000
                        self.limiter.save_usage(usage)
                        raise LLMUnavailable(f"Groq daily limit reached for model {model}.") from e

                    # Per-minute rate limit: check retry-after header
                    retry_after = getattr(e, "response", None)
                    wait_s = None
                    if retry_after and hasattr(retry_after, "headers"):
                        hdr = retry_after.headers.get("retry-after")
                        if hdr and hdr.isdigit():
                            wait_s = float(hdr)

                    if wait_s is None:
                        if retry_429_idx < len(backoffs_429):
                            wait_s = backoffs_429[retry_429_idx]
                            retry_429_idx += 1
                        else:
                            raise LLMUnavailable("Exceeded rate limit retries (429).") from e

                    report(f"Groq rate limit hit (429) on {model}. Waiting {int(wait_s)}s before retry...")
                    time.sleep(wait_s)
                    continue

                # 400 Bad Request: if json_schema is rejected, retry once with json_object
                if (status_code == 400 or "400" in err_str) and try_json_schema:
                    return self._call_groq_api(
                        model=model,
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        schema=schema,
                        try_json_schema=False,
                        reasoning_effort=reasoning_effort,
                    )

                # The model sometimes returns an empty or broken JSON body (json_validate_failed);
                # a second sample usually succeeds
                if "json_validate_failed" in err_str and retries_json < 2:
                    retries_json += 1
                    report(f"Groq returned invalid JSON on {model}. Retry {retries_json}/2...")
                    continue

                # 5xx Server Errors
                if (status_code and status_code >= 500) or any(c in err_str for c in ["500", "502", "503", "504"]):
                    if retries_5xx < 3:
                        retries_5xx += 1
                        sleep_s = 2.0 ** retries_5xx
                        report(f"Groq server error on {model}. Retry {retries_5xx}/3 in {int(sleep_s)}s...")
                        time.sleep(sleep_s)
                        continue
                    raise LLMUnavailable(f"Groq service unavailable after 3 retries: {err_str}") from e

                # Other unhandled exception
                raise LLMUnavailable(f"Groq API error: {err_str}") from e

    def generate_json(
        self,
        system: str,
        user: str,
        schema: Type[T],
        temperature: float = 0.0,
        stage: str = "default",
        log_dir: Optional[Path] = None,
    ) -> T:
        if not self.client:
            raise LLMUnavailable("GroqClient not configured with valid GROQ_API_KEY.")

        model = self.select_model(stage)
        max_tokens = self.limiter.get_stage_cap(stage)

        # Append schema instructions to system prompt for reliability
        schema_json = json.dumps(schema.model_json_schema(), indent=2)
        system_with_schema = f"{system}\n\nYou MUST return valid JSON adhering strictly to this schema:\n{schema_json}"

        # Rate limiter check & acquire
        prompt_text = system_with_schema + user
        self.limiter.acquire(model, prompt_text, max_tokens)
        report(f"Calling Groq {model} ({stage})...")

        messages = [
            {"role": "system", "content": system_with_schema},
            {"role": "user", "content": user},
        ]

        t0 = time.time()
        content, finish_reason, actual_tokens = self._call_groq_api(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            schema=schema,
            try_json_schema=True,
            reasoning_effort="low",
        )
        duration_s = time.time() - t0

        if actual_tokens > 0:
            self.limiter.record_usage(model, actual_tokens)
        else:
            self.limiter.record_usage(model, estimate_tokens(prompt_text) + estimate_tokens(content))

        # Handle truncated response (finish_reason == "length")
        if finish_reason == "length":
            raised_tokens = int(max_tokens * 1.5)
            # Check limiter budget for retry
            m_limits = self.limiter.get_model_limits(model)
            budget_tpm = int(m_limits.get("tokens_per_minute", 8000) * self.limiter.safety_factors.get("tpm_factor", 0.85))
            est_retry = estimate_tokens(prompt_text) + raised_tokens
            if est_retry <= budget_tpm:
                print(f"Warning: Response truncated on stage '{stage}'. Retrying with raised cap {raised_tokens}...")
                self.limiter.acquire(model, prompt_text, raised_tokens)
                t0 = time.time()
                content, finish_reason, actual_tokens = self._call_groq_api(
                    model=model,
                    messages=messages,
                    max_tokens=raised_tokens,
                    temperature=temperature,
                    schema=schema,
                    try_json_schema=False,
                    reasoning_effort="low",
                )
                duration_s = time.time() - t0
                self.limiter.record_usage(model, actual_tokens or raised_tokens)

            if finish_reason == "length":
                raise LLMBadOutput("Groq response was truncated (finish_reason: length).")

        # Strip any thinking tags or code fences
        clean_content = strip_thinking_tags(content)

        # Log call
        if log_dir:
            self._log_call(
                log_dir=log_dir,
                stage=stage,
                model=model,
                est_tokens=estimate_tokens(prompt_text) + max_tokens,
                actual_tokens=actual_tokens,
                duration_s=duration_s,
                finish_reason=finish_reason,
                raw_response=content,
            )

        # Parse & validate schema
        try:
            return schema.model_validate_json(clean_content)
        except (ValidationError, json.JSONDecodeError) as e:
            # Retry once with error feedback
            print(f"Validation failed for stage '{stage}': {e}. Retrying once with error feedback...")
            retry_messages = list(messages)
            retry_messages.append({"role": "assistant", "content": content})
            retry_messages.append({
                "role": "user",
                "content": f"Your previous response had JSON/schema validation errors:\n{e}\n\nPlease fix and return ONLY valid JSON matching the schema.",
            })

            retry_prompt = "\n".join(m["content"] for m in retry_messages)
            self.limiter.acquire(model, retry_prompt, max_tokens)
            t0 = time.time()
            content2, finish2, tok2 = self._call_groq_api(
                model=model,
                messages=retry_messages,
                max_tokens=max_tokens,
                temperature=temperature,
                schema=schema,
                try_json_schema=False,
                reasoning_effort="low",
            )
            duration2 = time.time() - t0
            self.limiter.record_usage(model, tok2 or max_tokens)

            if log_dir:
                self._log_call(
                    log_dir=log_dir,
                    stage=f"{stage}_retry",
                    model=model,
                    est_tokens=estimate_tokens(retry_prompt) + max_tokens,
                    actual_tokens=tok2,
                    duration_s=duration2,
                    finish_reason=finish2,
                    raw_response=content2,
                )

            clean_content2 = strip_thinking_tags(content2)
            try:
                return schema.model_validate_json(clean_content2)
            except Exception as e2:
                raise LLMBadOutput(f"Failed to parse Groq response into {schema.__name__} after retry: {e2}\nRaw: {clean_content2[:300]}") from e2

    def _log_call(
        self,
        log_dir: Path,
        stage: str,
        model: str,
        est_tokens: int,
        actual_tokens: int,
        duration_s: float,
        finish_reason: str,
        raw_response: str,
    ):
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / "llm_log.jsonl"
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": stage,
            "model": model,
            "estimated_tokens": est_tokens,
            "actual_tokens": actual_tokens,
            "duration_s": round(duration_s, 2),
            "finish_reason": finish_reason,
            "raw_response": raw_response,
        }
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
