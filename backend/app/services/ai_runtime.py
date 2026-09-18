"""
How long to wait for the Pi, and who to tell while it thinks.

Two things this module owns:

**An adaptive timeout.** A fixed number is wrong in both directions: too short
and the first request after boot dies while the model is still loading off the
SD card, too long and a wedged Ollama holds a request open for the better part
of a minute. So the budget is learned from what this Pi actually does --
recent response times, scaled by how much text was sent -- and widened for a
cold start, when loading the weights dominates everything else.

**A busy signal.** Inference pins the CPU on a Pi 5, so while it runs the rest
of the app is sluggish and a request that would normally take 50ms can take
several seconds. Rather than let that read as the app being broken, every
connected client is told when the model starts and stops, and `/api/v1/ai/status`
reports the same thing to a client that arrives mid-run. A single semaphore
keeps it to one inference at a time: two captures at once on this hardware do
not go twice as fast, they go four times as slow and are likelier to time out.
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional

from .ws_manager import ws_manager

# Bounds on the learned budget. The floor has to clear one ordinary generation
# on a Pi 5; the ceiling is the point past which a person assumes it is broken.
MIN_TIMEOUT_SECONDS = 6.0
MAX_TIMEOUT_SECONDS = 45.0

# Until the model has answered once, the weights may still be coming off disk.
COLD_START_TIMEOUT_SECONDS = 40.0

# Headroom over the typical observed time, so ordinary variance is not a timeout.
TIMEOUT_SAFETY_FACTOR = 2.5

# Characters of input the learned average is taken to represent. Longer notes
# generate more tokens and get proportionally longer, within the bounds above.
REFERENCE_INPUT_CHARS = 120

# How many recent runs shape the estimate.
SAMPLE_WINDOW = 12

# A run slower than this is treated as the Pi being busy rather than as the new
# normal, so one bad sample cannot drag the budget to the ceiling permanently.
OUTLIER_SECONDS = 30.0


@dataclass
class _Stats:
    durations: Deque[float] = field(default_factory=lambda: deque(maxlen=SAMPLE_WINDOW))
    failures: int = 0
    last_error: Optional[str] = None
    cold: bool = True

    def record_success(self, seconds: float) -> None:
        self.cold = False
        self.failures = 0
        self.last_error = None
        if seconds <= OUTLIER_SECONDS:
            self.durations.append(seconds)

    def record_failure(self, error: str) -> None:
        self.failures += 1
        self.last_error = error

    @property
    def typical_seconds(self) -> Optional[float]:
        if not self.durations:
            return None
        ordered = sorted(self.durations)
        # The median, not the mean: one slow run while the Pi was busy should
        # not move the budget much.
        middle = len(ordered) // 2
        if len(ordered) % 2:
            return ordered[middle]
        return (ordered[middle - 1] + ordered[middle]) / 2


_stats = _Stats()
_inference_lock = asyncio.Semaphore(1)
_active = 0


def adaptive_timeout(input_chars: int = 0) -> float:
    """
    The budget for the next call, in seconds.

    Cold, it is generous, because loading the weights dominates. Warm, it is
    the median recent time with headroom, scaled by input length.
    """
    typical = _stats.typical_seconds
    if typical is None:
        return COLD_START_TIMEOUT_SECONDS

    scale = 1.0
    if input_chars > REFERENCE_INPUT_CHARS:
        scale = min(3.0, input_chars / REFERENCE_INPUT_CHARS)

    budget = typical * TIMEOUT_SAFETY_FACTOR * scale

    # Repeated failures usually mean Ollama is stopped or wedged. Backing off
    # keeps a broken model from holding every capture open for its full budget.
    if _stats.failures >= 2:
        budget = min(budget, MIN_TIMEOUT_SECONDS)

    return max(MIN_TIMEOUT_SECONDS, min(MAX_TIMEOUT_SECONDS, budget))


def status() -> Dict[str, object]:
    """What the model is doing, for the UI and for /api/v1/ai/status."""
    typical = _stats.typical_seconds
    return {
        "busy": _active > 0,
        "active_requests": _active,
        "warm": not _stats.cold,
        "typical_seconds": round(typical, 2) if typical is not None else None,
        "next_timeout_seconds": round(adaptive_timeout(), 1),
        "consecutive_failures": _stats.failures,
        "last_error": _stats.last_error,
        "samples": len(_stats.durations),
    }


class inference:
    """
    Async context manager around one model call.

    Serialises inference, announces start and finish to every connected client,
    and feeds the observed duration back into the timeout estimate.
    """

    def __init__(self, label: str = "capture", input_chars: int = 0):
        self.label = label
        self.input_chars = input_chars
        self.timeout = adaptive_timeout(input_chars)
        self._started = 0.0
        self._failed = False

    async def __aenter__(self) -> "inference":
        global _active
        await _inference_lock.acquire()
        # Recompute once we hold the lock: a queued request should use the
        # estimate as it stands now, not as it stood when it started waiting.
        self.timeout = adaptive_timeout(self.input_chars)
        _active += 1
        self._started = time.monotonic()
        await _broadcast_state(self.label, self.timeout)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        global _active
        elapsed = time.monotonic() - self._started
        if exc_type is not None:
            _stats.record_failure(exc_type.__name__)
        elif not self._failed:
            _stats.record_success(elapsed)
        # A call that reported its own failure is deliberately not recorded as
        # a success. Ollama being unreachable returns in milliseconds, and
        # learning that as "the model is very fast" would shrink the budget to
        # the floor and then time out the first real generation.
        _active -= 1
        _inference_lock.release()
        await _broadcast_state(self.label, self.timeout, elapsed=elapsed)
        return False

    def record_failure(self, reason: str) -> None:
        """Mark a call that returned without raising but produced nothing useful."""
        self._failed = True
        _stats.record_failure(reason)


async def _broadcast_state(label: str, timeout: float, elapsed: Optional[float] = None) -> None:
    payload: Dict[str, object] = {
        "busy": _active > 0,
        "label": label,
        "expected_seconds": round(timeout, 1),
    }
    if elapsed is not None:
        payload["elapsed_seconds"] = round(elapsed, 2)
    try:
        await ws_manager.broadcast({"type": "AI_BUSY", "data": payload})
    except Exception:
        # Telling the UI is a courtesy; never fail the capture over it.
        pass


def reset_for_tests() -> None:
    global _active
    _stats.durations.clear()
    _stats.failures = 0
    _stats.last_error = None
    _stats.cold = True
    _active = 0
