"""today.py - the Today list as the clock's Tasks screen shows it."""

import datetime
from typing import List
from zoneinfo import ZoneInfo

import notifier
from desk.alarms import is_alarm
from desk.controller import fit

MAX_ITEMS = 5
# The firmware keeps 96 bytes per line, less the terminating 0.
LINE_LEN = 95


def lines(items: List[dict], now: datetime.datetime, tz: ZoneInfo) -> List[str]:
    """What's due today in Today's order, then what's overdue, as
    "07:30 Gym" or "Pay rent (overdue)". Alarms have their own place."""
    due, overdue = notifier.plan_for_today([i for i in items if not is_alarm(i)], now, tz)
    out = []
    for item in due:
        at = notifier._time_of_day(item, tz)
        title = item.get("title") or "Untitled"
        out.append(fit(f"{at} {title}" if at else title, LINE_LEN))
    for item in overdue:
        out.append(fit(f"{item.get('title') or 'Untitled'} (overdue)", LINE_LEN))
    return out[:MAX_ITEMS]
