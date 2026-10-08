"""
alarms.py - Sage reminders labelled "alarm", rung by the desk clock.

An alarm is an ordinary Sage reminder with the label `alarm`: it rings at its
`remindAt`, the time it is set for is its `startAt`, and switching it off clears
`remindAt` while keeping the time. So an alarm set in the app rings at the desk,
and nothing here needs a table of its own.

Sage's reminder sweep runs every 30 seconds, which is too coarse for an alarm,
so the desk checks the alarms it has cached once a second instead.
"""

import datetime
from typing import Iterable, List, Optional, Set
from zoneinfo import ZoneInfo

LABEL = "alarm"
# An alarm whose time passed while the Pi was off should ring tomorrow, not
# the moment the power comes back. Anything older than this is rolled forward.
GRACE_SECONDS = 300
SNOOZE_MINUTES = 5


def parse_local(value, tz: ZoneInfo) -> Optional[datetime.datetime]:
    if not value or not isinstance(value, str) or len(value) < 16:
        return None
    try:
        when = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.replace(tzinfo=tz) if when.tzinfo is None else when.astimezone(tz)


def sage_time(when: datetime.datetime) -> str:
    """Sage stores local times as YYYY-MM-DDTHH:MM."""
    return when.strftime("%Y-%m-%dT%H:%M")


def is_alarm(item: dict) -> bool:
    return any(str(label).strip().lower() == LABEL for label in item.get("labels") or [])


def next_occurrence(hour: int, minute: int, after: datetime.datetime) -> datetime.datetime:
    """The next time after `after` that the clock reads hour:minute."""
    candidate = after.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= after:
        candidate += datetime.timedelta(days=1)
    return candidate


class Alarm:
    def __init__(self, item: dict, tz: ZoneInfo) -> None:
        self.id: str = item.get("id", "")
        self.title: str = item.get("title") or "Alarm"
        self.remind_at: Optional[str] = item.get("remindAt")
        self.rings_at = parse_local(self.remind_at, tz)
        set_for = parse_local(item.get("startAt"), tz) or self.rings_at
        self.h = set_for.hour if set_for else 0
        self.m = set_for.minute if set_for else 0

    @property
    def key(self) -> str:
        # A snooze changes remindAt, so the same alarm can ring again.
        return f"{self.id}:{self.remind_at}"


class Alarms:
    def __init__(self, tz: ZoneInfo) -> None:
        self.tz = tz
        self.alarms: List[Alarm] = []
        self.ringing: Optional[Alarm] = None
        self._rung: Set[str] = set()

    def load(self, items: Iterable[dict]) -> None:
        self.alarms = [Alarm(i, self.tz) for i in items if is_alarm(i)]
        self._rung &= {a.key for a in self.alarms}

    def missed(self, now: datetime.datetime) -> List[Alarm]:
        """Alarms that should have rung a while ago, to roll forward."""
        return [
            a for a in self.alarms
            if a.rings_at and a.key not in self._rung and (now - a.rings_at).total_seconds() > GRACE_SECONDS
        ]

    def due(self, now: datetime.datetime) -> Optional[Alarm]:
        """The alarm to ring now, if any; it is then counted as rung."""
        if self.ringing:
            return None
        for alarm in self.alarms:
            if alarm.rings_at and alarm.key not in self._rung and 0 <= (now - alarm.rings_at).total_seconds() <= GRACE_SECONDS:
                self._rung.add(alarm.key)
                self.ringing = alarm
                return alarm
        return None

    def upcoming(self, now: datetime.datetime, hours: int = 24, limit: int = 4) -> List[Alarm]:
        """The alarms that ring within `hours`, soonest first."""
        until = now + datetime.timedelta(hours=hours)
        soon = sorted((a for a in self.alarms if a.rings_at and now < a.rings_at <= until), key=lambda a: a.rings_at)
        return soon[:limit]

    def next(self, now: datetime.datetime) -> Optional[Alarm]:
        """The alarm that rings soonest, for the clock face."""
        upcoming = [a for a in self.alarms if a.rings_at and a.rings_at > now]
        return min(upcoming, key=lambda a: a.rings_at) if upcoming else None

    @staticmethod
    def snoozed(now: datetime.datetime, minutes: int = SNOOZE_MINUTES) -> dict:
        """Fields for a few more minutes. Only remindAt moves, so tomorrow's
        alarm is still set for the time it always was."""
        return {"remindAt": sage_time(now + datetime.timedelta(minutes=minutes))}

    @staticmethod
    def rolled(alarm: Alarm, now: datetime.datetime) -> dict:
        """Fields that set an alarm for its next occurrence."""
        when = sage_time(next_occurrence(alarm.h, alarm.m, now))
        return {"remindAt": when, "startAt": when, "dueDate": when[:10]}
