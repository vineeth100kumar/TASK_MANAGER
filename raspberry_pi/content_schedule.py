"""
Content schedule: posts and reels saved with a date are drawn in the background, ahead of time.

A post or reel made with a date (status "planned") keeps its script and waits. Every minute this
looks at them, oldest date first, and starts one when:

  - its slot is no more than LEAD_MINUTES away (a margin, so an outage or a slow render
    still leaves it finished in time), or
  - the Pi is otherwise idle (nothing drawing or waiting) and the slot is within EARLY_HOURS.

One at a time: posts.py and reels.py share one drawing lock, so a release only queues work.
When the drawing ends, posts.py / reels.py email you as before and Herald says it is ready.
"""

import asyncio
import datetime
import os
from typing import List, Optional

import logstore
import posts
import reels

LEAD_MINUTES = int(os.getenv("SAGE_CONTENT_LEAD_MINUTES", "60"))
EARLY_HOURS = int(os.getenv("SAGE_CONTENT_EARLY_HOURS", "24"))
CHECK_EVERY = 60


def _due(item: dict) -> Optional[datetime.datetime]:
    try:
        return datetime.datetime.fromisoformat(str(item.get("scheduledFor")).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def should_release(due: datetime.datetime, now: datetime.datetime, idle: bool,
                   lead_minutes: int = LEAD_MINUTES, early_hours: int = EARLY_HOURS) -> bool:
    """Whether a planned item due at `due` should start drawing now."""
    wait = due - now
    if wait <= datetime.timedelta(minutes=lead_minutes):
        return True
    return idle and wait <= datetime.timedelta(hours=early_hours)


def release_due(now: Optional[datetime.datetime] = None) -> int:
    """Start what is due. Returns how many were started. Runs on the event loop."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    waiting: List[tuple] = []
    for kind, mod in (("post", posts), ("reel", reels)):
        for item in mod.planned():
            due = _due(item)
            if due is None:
                # A planned item with no usable date would wait forever: draw it now.
                waiting.append((datetime.datetime.min.replace(tzinfo=datetime.timezone.utc), kind, mod, item))
            else:
                waiting.append((due, kind, mod, item))
    waiting.sort(key=lambda w: w[0])
    started = 0
    for due, kind, mod, item in waiting:
        idle = started == 0 and posts.queue_length() + reels.queue_length() == 0
        if should_release(due, now, idle) and mod.release(item):
            started += 1
            logstore.info("posts", f"Drawing {kind} {item['id']} ahead of its slot")
    return started


async def run() -> None:
    """The background loop, started with the server."""
    while True:
        try:
            release_due()
        except Exception as e:
            logstore.warn("posts", f"Content schedule check failed: {e}")
        await asyncio.sleep(CHECK_EVERY)
