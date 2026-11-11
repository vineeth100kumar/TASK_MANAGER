"""Rate limiter and daily usage tracker for LLM providers (Groq)."""

import json
import math
import os
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from autocontent.llm.base import LLMRequestTooLarge, LLMUnavailable
from autocontent.settings import PROJECT_ROOT, CONFIG_DIR, OUTPUT_DIR
from autocontent.progress import report

LIMITS_PATH = CONFIG_DIR / "llm_limits.json"
USAGE_PATH = OUTPUT_DIR / ".usage.json"


def estimate_tokens(text: str) -> int:
    """Conservative token estimate: ceil(len(text) / 3.2)."""
    return math.ceil(len(text) / 3.2)


class RateLimiter:
    """Enforces per-model rolling 60-second RPM/TPM limits and daily usage budget."""

    def __init__(
        self,
        limits_file: Optional[Path] = None,
        usage_file: Optional[Path] = None,
        time_fn: Callable[[], float] = time.time,
        sleep_fn: Callable[[float], None] = time.sleep,
    ):
        self.limits_file = limits_file or LIMITS_PATH
        self.usage_file = usage_file or USAGE_PATH
        self.time_fn = time_fn
        self.sleep_fn = sleep_fn
        self._load_limits()
        # Per-model rolling window: deque of (timestamp, tokens)
        self.windows: Dict[str, deque] = {}

    def _load_limits(self):
        if self.limits_file.exists():
            with open(self.limits_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = {}

        self.safety_factors = data.get("safety_factors", {
            "tpm_factor": 0.85,
            "max_requests_per_minute": 25,
        })
        self.stage_caps = data.get("stage_max_completion_tokens", {
            "extract_claims": 1800,
            "compose": 1400,
            "verify_slides": 800,
        })
        self.models_config = data.get("models", {
            "openai/gpt-oss-120b": {
                "requests_per_minute": 30,
                "requests_per_day": 1000,
                "tokens_per_minute": 8000,
                "tokens_per_day": 200000,
            },
            "openai/gpt-oss-20b": {
                "requests_per_minute": 30,
                "requests_per_day": 1000,
                "tokens_per_minute": 8000,
                "tokens_per_day": 200000,
            },
            "qwen/qwen3.8-27b": {
                "requests_per_minute": 30,
                "requests_per_day": 1000,
                "tokens_per_minute": 8000,
                "tokens_per_day": 200000,
            },
        })

    def get_model_limits(self, model: str) -> dict:
        return self.models_config.get(model, {
            "requests_per_minute": 30,
            "requests_per_day": 1000,
            "tokens_per_minute": 8000,
            "tokens_per_day": 200000,
        })

    def get_stage_cap(self, stage: str) -> int:
        for k, v in self.stage_caps.items():
            if stage.startswith(k):
                return v
        return 1400

    def _get_today_utc(self) -> str:
        # Use time_fn to derive UTC date so fake clocks work
        ts = self.time_fn()
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

    def load_usage(self) -> dict:
        today = self._get_today_utc()
        if self.usage_file.exists():
            try:
                with open(self.usage_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("date_utc") == today:
                    return data
            except Exception:
                pass
        return {"date_utc": today, "per_model": {}}

    def save_usage(self, usage: dict):
        self.usage_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.usage_file, "w", encoding="utf-8") as f:
            json.dump(usage, f, indent=2)

    def is_model_exhausted(self, model: str, usage: Optional[dict] = None) -> bool:
        if usage is None:
            usage = self.load_usage()
        m_limits = self.get_model_limits(model)
        m_usage = usage.get("per_model", {}).get(model, {"requests": 0, "tokens": 0})
        t_limit = m_limits.get("tokens_per_day", 200000)
        r_limit = m_limits.get("requests_per_day", 1000)
        return (m_usage["tokens"] >= 0.95 * t_limit) or (m_usage["requests"] >= 0.95 * r_limit)

    def check_daily_warnings(self, model: str, usage: Optional[dict] = None):
        if usage is None:
            usage = self.load_usage()
        m_limits = self.get_model_limits(model)
        m_usage = usage.get("per_model", {}).get(model, {"requests": 0, "tokens": 0})
        t_limit = m_limits.get("tokens_per_day", 200000)
        r_limit = m_limits.get("requests_per_day", 1000)
        if m_usage["tokens"] >= 0.80 * t_limit or m_usage["requests"] >= 0.80 * r_limit:
            print(f"[!] Warning: Model {model} has reached 80% of its daily quota.", file=sys.stderr)

    def _clean_window(self, model: str, now: float):
        if model not in self.windows:
            self.windows[model] = deque()
            return
        w = self.windows[model]
        cutoff = now - 60.0
        while w and w[0][0] <= cutoff:
            w.popleft()

    def acquire(self, model: str, prompt_text: str, max_tokens: int):
        """Check limits, wait if necessary, and reserve estimated tokens."""
        est_tokens = estimate_tokens(prompt_text) + max_tokens
        m_limits = self.get_model_limits(model)
        tpm_factor = self.safety_factors.get("tpm_factor", 0.85)
        max_rpm = self.safety_factors.get("max_requests_per_minute", 25)

        budget_tpm = int(m_limits.get("tokens_per_minute", 8000) * tpm_factor)
        budget_rpm = min(m_limits.get("requests_per_minute", 30), max_rpm)

        if est_tokens > budget_tpm:
            raise LLMRequestTooLarge(
                f"Estimated tokens ({est_tokens}) exceeds minute token budget ({budget_tpm}) for model {model}."
            )

        reported_wait: Optional[float] = None
        while True:
            now = self.time_fn()
            self._clean_window(model, now)
            w = self.windows[model]

            current_tokens = sum(item[1] for item in w)
            current_requests = len(w)

            if (current_tokens + est_tokens <= budget_tpm) and (current_requests < budget_rpm):
                # We can proceed; record estimate in window
                w.append((now, est_tokens))
                break

            # Need to wait
            oldest_ts = w[0][0]
            wait_s = max(1.0, math.ceil(oldest_ts + 60.0 - now))
            # Announce the wait once, then every ~10s, instead of a line per second
            if reported_wait is None or reported_wait - wait_s >= 10:
                report(f"Waiting {int(wait_s)}s for Groq per-minute token limit on {model}...")
                reported_wait = wait_s
            self.sleep_fn(1.0)

    def record_usage(self, model: str, actual_tokens: int):
        """Update window with actual token count and persist daily usage."""
        now = self.time_fn()
        self._clean_window(model, now)
        w = self.windows.get(model)
        if w:
            # Replace the latest estimate with actual tokens
            ts, _ = w.pop()
            w.append((ts, actual_tokens))

        # Update daily usage
        usage = self.load_usage()
        per_model = usage.setdefault("per_model", {})
        m_stat = per_model.setdefault(model, {"requests": 0, "tokens": 0})
        m_stat["requests"] += 1
        m_stat["tokens"] += actual_tokens
        self.save_usage(usage)
        self.check_daily_warnings(model, usage)
