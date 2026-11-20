"""
call_tasks.py - a missed call becomes a "Call <name> back" task.

Pure helpers: whether a missed call earns a task, and the task itself. The
caller (speaker.py) saves it with item_actions.create_item and tells the web
app. Only named callers count; an unknown number never makes a task.
"""

import os
from typing import Dict

import herald_extras

CALL_TASK_GAP_S = 30 * 60      # the same caller makes at most one task per 30 min
SOURCE = "sage-herald"


def should_make_task(name: str, last_at: float, now: float) -> bool:
    name = (name or "").strip()
    if not name or not herald_extras.is_named(name):
        return False
    return now - last_at >= CALL_TASK_GAP_S


def task_payload(name: str, today: str, now_iso: str) -> Dict:
    """A plain to-do due today, in the shape the web app expects."""
    return {
        "id": f"call-{now_iso[:19].replace('-', '').replace(':', '').replace('T', '')}-{os.urandom(3).hex()}",
        "title": f"Call {name.strip()[:60]} back",
        "entityType": "task",
        "status": "todo",
        "priority": "medium",
        "labels": ["call"],
        "isInbox": False,
        "isFocus": False,
        "dueDate": today,
        "source": SOURCE,
    }
