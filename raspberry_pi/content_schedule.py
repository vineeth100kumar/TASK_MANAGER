"""
Content schedule: posts and reels saved with a date are drawn in the background, ahead of time.

A post or reel made with a date (status "planned") keeps its script and waits. Every minute this
looks at them, oldest date first, and starts one when:

  - its slot is no more than LEAD_MINUTES away (a margin, so an outage or a slow render
    still leaves it finished in time), or
  - the Pi is otherwise idle (nothing drawing or waiting) and the slot is within EARLY_HOURS.

One at a time: posts.py and reels.py share one drawing lock, so a release only queues work.
When the drawing ends, posts.py / reels.py email you as before and Herald says it is ready.

Post-time reminders (remind_due, same loop): a finished post or reel with a date that is not posted
yet reminds you at that time, and once more the next morning, by push, email and Herald. "Won't post"
(wontPost) and Mark posted stop them. Setting a new time starts them again.
"""

import asyncio
import datetime
import json
import os
from typing import List, Optional

import logstore
import notifier
import posts
import reels

LEAD_MINUTES = int(os.getenv("SAGE_CONTENT_LEAD_MINUTES", "60"))
EARLY_HOURS = int(os.getenv("SAGE_CONTENT_EARLY_HOURS", "24"))
CHECK_EVERY = 60
MORNING_HOUR = 9           # the next-morning nudge goes out at 09:00 local time
STALE_DAYS = 3             # a date this far past is not worth a reminder any more


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
            if item.get("wontPost"):
                continue
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


def _finished(mod) -> List[dict]:
    """Finished, unposted, undropped items of a kind that have a date (read straight from its table)."""
    conn = mod._db()
    try:
        rows = conn.execute("SELECT payload FROM %s WHERE status = 'done'" % ("posts" if mod is posts else "reels")).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        item = json.loads(r["payload"])
        if item.get("scheduledFor") and not item.get("posted") and not item.get("wontPost") and not item.get("archived"):
            out.append(item)
    return out


def next_stage(item: dict, now: datetime.datetime, tz) -> Optional[int]:
    """Which post-time reminder is due for this item now: 1 (at the time), 2 (next morning), or None."""
    due = _due(item)
    if due is None:
        return None
    stage = int(item.get("remindStage") or 0)
    local_due = due.astimezone(tz)
    morning = (local_due + datetime.timedelta(days=1)).replace(hour=MORNING_HOUR, minute=0, second=0, microsecond=0)
    if stage == 0 and now >= due:
        return 1 if now < morning else 2
    if stage == 1 and now >= morning:
        return 2
    return None


async def remind_due(now: Optional[datetime.datetime] = None, deliver=None) -> List[tuple]:
    """Send the post-time reminders that are due. Returns [(kind, id, stage)] it handled."""
    prefs = await asyncio.to_thread(notifier.get_prefs)
    tz = notifier._tz(prefs)
    now = (now or datetime.datetime.now(datetime.timezone.utc)).astimezone(tz)
    deliver = deliver or _deliver_reminder
    done: List[tuple] = []
    for kind, mod in (("post", posts), ("reel", reels)):
        for item in _finished(mod):
            stage = next_stage(item, now, tz)
            if stage is None:
                continue
            stale = (now - _due(item)) > datetime.timedelta(days=STALE_DAYS)
            item["remindStage"] = 2 if stale else stage
            await mod.save_async(item)   # mark first: a failed send must not repeat every minute
            if stale:
                continue
            try:
                await deliver(kind, item, stage)
            except Exception as e:
                logstore.warn("posts", f"Post reminder for {kind} {item.get('id')} failed: {e}")
            done.append((kind, item["id"], stage))
    return done


async def _deliver_reminder(kind: str, item: dict, stage: int) -> None:
    prefs = await asyncio.to_thread(notifier.get_prefs)
    facts = posts.ready_facts(item, kind)
    where = f" in {facts['project']}" if facts["project"] else ""
    if stage == 1:
        title, body = f"Time to post: {item['title']}", f"Your {kind}{where} is ready. Post it, then mark it posted."
    else:
        title, body = f"Still not posted: {item['title']}", f"Your {kind}{where} was due {facts['when'] or 'earlier'} and is not marked posted."
    link = posts.post_link(item) if kind == "post" else reels.reel_link(item)
    message = {"title": title, "body": body, "tag": f"post-due-{item['id']}", "url": f"/?{kind}={item['id']}", "urgency": "high", "ttl": 6 * 3600}
    email = (title, notifier.email_text(title, body, [], link, f"Open {kind}"), notifier.email_html(title, body, [], link, f"Open {kind}"))
    await asyncio.to_thread(notifier._deliver, prefs, message, email)
    await posts._say_due(item, kind, stage)


async def run() -> None:
    """The background loop, started with the server."""
    while True:
        try:
            release_due()
            await remind_due()
        except Exception as e:
            logstore.warn("posts", f"Content schedule check failed: {e}")
        await asyncio.sleep(CHECK_EVERY)
