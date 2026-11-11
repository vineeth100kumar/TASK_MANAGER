"""
tools.py - the desk clock's timer and stopwatch, kept by Sage.

Both run here, on the Pi, so the LUMO page in Sage and the clock always agree:
start a timer from your phone and the clock counts it down; press OK on the
clock and the page shows it paused. The clock is sent where things stand
(TIMER, STOPWATCH) whenever they change and counts the seconds between
messages itself.

A timer that runs out rings on the clock (with a softer pattern than an
alarm) until a button is pressed, it is dismissed in Sage, or a minute
passes.
"""

import time
from typing import Callable, List, Optional

MAX_TIMER_SECONDS = 24 * 3600
TIMER_RING_SECONDS = 60
LABEL_LEN = 24
MAX_LAPS = 99
CLOCK_LAPS = 4   # the clock's screen shows the last few


class Timer:
    def __init__(self, clock: Callable[[], float] = time.monotonic, wall: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._wall = wall
        self.state = "idle"       # idle, running, paused or done
        self.total = 0.0
        self.label = ""
        self.ends_at = 0.0        # on self._clock, while running
        self.left = 0.0           # while paused
        self.done_at = 0.0
        self.last_total = 5 * 60  # what OK on the clock starts when nothing is set

    def remaining(self) -> float:
        if self.state == "running":
            return max(0.0, self.ends_at - self._clock())
        if self.state == "paused":
            return self.left
        return 0.0

    def start(self, seconds: int, label: str = "") -> None:
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 1 <= seconds <= MAX_TIMER_SECONDS:
            raise ValueError("A timer runs from 1 second to 24 hours.")
        self.total = float(seconds)
        self.last_total = int(seconds)
        self.label = " ".join(str(label or "").split())[:LABEL_LEN]
        self.ends_at = self._clock() + seconds
        self.state = "running"

    def pause(self) -> None:
        if self.state == "running":
            self.left = self.remaining()
            self.state = "paused"

    def resume(self) -> None:
        if self.state == "paused":
            self.ends_at = self._clock() + self.left
            self.state = "running"

    def toggle(self) -> None:
        """OK on the clock: pause, carry on, or start the last one again."""
        if self.state == "running":
            self.pause()
        elif self.state == "paused":
            self.resume()
        else:
            self.start(self.last_total, self.label)

    def add(self, seconds: int) -> None:
        if self.state == "running":
            self.ends_at = min(self.ends_at + seconds, self._clock() + MAX_TIMER_SECONDS)
            self.total += seconds
        elif self.state == "paused":
            self.left = min(self.left + seconds, MAX_TIMER_SECONDS)
            self.total += seconds
        else:
            self.start(seconds, self.label)

    def cancel(self) -> None:
        self.state = "idle"
        self.left = 0.0

    def tick(self) -> Optional[str]:
        """'done' the moment it runs out, 'idle' when an unanswered ring ends."""
        if self.state == "running" and self._clock() >= self.ends_at:
            self.state = "done"
            self.done_at = self._clock()
            return "done"
        if self.state == "done" and self._clock() - self.done_at >= TIMER_RING_SECONDS:
            self.state = "idle"
            return "idle"
        return None

    def command(self) -> dict:
        return {"cmd": "TIMER", "state": self.state, "left_ms": int(self.remaining() * 1000),
                "total_ms": int(self.total * 1000), "label": self.label}

    def describe(self) -> dict:
        left = self.remaining()
        return {
            "state": self.state,
            "remaining": round(left, 1),
            "total": round(self.total, 1),
            "label": self.label,
            # When it runs out, for the page to count down to by itself.
            "endsAt": int((self._wall() + left) * 1000) if self.state == "running" else None,
        }


class Stopwatch:
    def __init__(self, clock: Callable[[], float] = time.monotonic, wall: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._wall = wall
        self.running = False
        self.base = 0.0           # seconds counted before the last start
        self.started = 0.0
        self.laps: List[float] = []   # the elapsed time at each lap

    def elapsed(self) -> float:
        return self.base + (self._clock() - self.started if self.running else 0.0)

    def start(self) -> None:
        if not self.running:
            self.started = self._clock()
            self.running = True

    def pause(self) -> None:
        if self.running:
            self.base = self.elapsed()
            self.running = False

    def toggle(self) -> None:
        self.pause() if self.running else self.start()

    def lap(self) -> None:
        if self.running and len(self.laps) < MAX_LAPS:
            self.laps.append(self.elapsed())

    def reset(self) -> None:
        self.running = False
        self.base = 0.0
        self.laps = []

    def splits(self) -> List[float]:
        """Each lap's own length."""
        return [t - (self.laps[i - 1] if i else 0.0) for i, t in enumerate(self.laps)]

    def command(self) -> dict:
        return {"cmd": "STOPWATCH", "running": self.running, "elapsed_ms": int(self.elapsed() * 1000),
                "laps": [int(s * 1000) for s in self.splits()[-CLOCK_LAPS:]], "lap_count": len(self.laps)}

    def describe(self) -> dict:
        elapsed = self.elapsed()
        return {
            "running": self.running,
            "elapsed": round(elapsed, 2),
            "startedAt": int((self._wall() - elapsed) * 1000) if self.running else None,
            "laps": [round(s, 2) for s in self.splits()],
        }
