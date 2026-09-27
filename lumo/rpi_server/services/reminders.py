"""
Sage reminders, felt at the desk.

Any Sage item with a reminder time (remindAt) that is not one of Lumo's
alarms becomes a buzz and a notification card on the clock when it falls due.
Alarms are left to AlarmManager, which sounds the buzzer instead.

Sage's Pi server has no reminder sweep of its own, so Lumo watches the times
itself from the copy of Sage's items the client already keeps.
"""

import datetime
import logging
from typing import Optional

from config import SAGE_ALARM_TAG
from services.sage_client import now_local

logger = logging.getLogger("Reminders")

# A reminder that came due while the Pi was off is not worth a buzz hours later.
GRACE_SECONDS = 300


def _parse(value: Optional[str]) -> Optional[datetime.datetime]:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


class ReminderWatcher:
    def __init__(self, sage):
        self.sage = sage
        # (item id, remindAt) pairs already announced, so a reminder moved to a
        # new time can ring again but the same one never rings twice.
        self._announced: set[tuple[str, str]] = set()

    def due_now(self) -> list[dict]:
        now = now_local()
        tag = SAGE_ALARM_TAG.lower()
        due = []
        for item in self.sage.items.values():
            remind_at = item.get("remindAt")
            when = _parse(remind_at)
            if not when or item.get("deletedAt") or item.get("status") == "done" or item.get("completedAt"):
                continue
            if tag in [str(label).strip().lower() for label in item.get("labels") or []]:
                continue
            if (item.get("id"), remind_at) in self._announced:
                continue
            if 0 <= (now - when).total_seconds() <= GRACE_SECONDS:
                due.append(item)
        return due

    async def poll(self, notify) -> None:
        """notify(title) is awaited once for each reminder that has come due."""
        for item in self.due_now():
            self._announced.add((item.get("id"), item.get("remindAt")))
            title = item.get("title") or "Reminder"
            logger.info(f"Sage reminder due: {title}")
            await notify(title)
