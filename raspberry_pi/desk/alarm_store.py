"""
alarm_store.py - making, changing and removing alarms from the LUMO page.

Alarms are Sage reminders (see alarms.py), so these write work items the way
a sync save does (item_actions), and every device sees the change. The desk
picks it up from the SYNC_APPLIED event the caller broadcasts.

A request names an alarm in the page's terms:

    {"label": "Gym", "time": "06:30", "days": [0, 2, 4], "enabled": true,
     "tone": "rising", "volume": 70, "snoozeMinutes": 9}

and the answer (describe) says the same back, plus when it rings next.
"""

import datetime
import os
import re
from typing import Any, Dict, Optional

import item_actions
from desk.alarms import LABEL, TONES, Alarm, clean_days, next_occurrence, options, sage_time

SOURCE = "lumo"
LABEL_LEN = 40
_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def describe(item: dict, tz) -> dict:
    alarm = Alarm(item, tz)
    return {
        "id": alarm.id,
        "label": alarm.title,
        "time": f"{alarm.h:02d}:{alarm.m:02d}",
        "days": alarm.days,
        "enabled": alarm.enabled,
        "nextRing": alarm.rings_at.isoformat() if alarm.rings_at else None,
        "snoozed": bool(alarm.enabled and alarm.rings_at and (alarm.rings_at.hour, alarm.rings_at.minute) != (alarm.h, alarm.m)),
        "tone": alarm.tone,
        "volume": alarm.volume,
        "snoozeMinutes": alarm.snooze,
    }


def _check(spec: Any, partial: bool) -> Dict[str, Any]:
    """The fields of `spec` that check out. Raises ValueError for the person."""
    if not isinstance(spec, dict):
        raise ValueError("An alarm must be an object.")
    unknown = set(spec) - {"label", "time", "days", "enabled", "tone", "volume", "snoozeMinutes"}
    if unknown:
        raise ValueError(f"Unknown alarm field: {', '.join(sorted(unknown))}.")
    out: Dict[str, Any] = {}
    if "label" in spec:
        label = " ".join(str(spec["label"] or "").split())[:LABEL_LEN]
        out["label"] = label or "Alarm"
    if "time" in spec:
        match = _TIME.match(str(spec["time"] or ""))
        if not match:
            raise ValueError("time must look like 07:30.")
        out["time"] = (int(match.group(1)), int(match.group(2)))
    elif not partial:
        raise ValueError("An alarm needs a time.")
    if "days" in spec:
        days = spec["days"]
        if not isinstance(days, list) or clean_days(days) != sorted(set(days)):
            raise ValueError("days must be a list of weekdays from 0 (Monday) to 6 (Sunday).")
        out["days"] = clean_days(days)
    if "enabled" in spec:
        if not isinstance(spec["enabled"], bool):
            raise ValueError("enabled must be true or false.")
        out["enabled"] = spec["enabled"]
    if "tone" in spec:
        if spec["tone"] is not None and spec["tone"] not in TONES:
            raise ValueError(f"tone must be one of: {', '.join(TONES)}.")
        out["tone"] = spec["tone"]
    for name, low, high in (("volume", 0, 100), ("snoozeMinutes", 1, 60)):
        if name in spec:
            value = spec[name]
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high):
                raise ValueError(f"{name} must be a whole number from {low} to {high}.")
            out[name] = value
    return out


def _schedule(h: int, m: int, days, enabled: bool, now: datetime.datetime) -> dict:
    """remindAt, startAt and dueDate for an alarm set for h:m. A one-off
    alarm rings at the next h:m on any day."""
    when = sage_time(next_occurrence(h, m, now, days or None))
    return {"remindAt": when if enabled else None, "startAt": when, "dueDate": when[:10]}


def create(spec: Any, now: datetime.datetime):
    """A new alarm. Returns (item, revision)."""
    fields = _check(spec, partial=False)
    h, m = fields["time"]
    days = fields.get("days", [])
    item = {
        "id": f"alarm-{now.strftime('%Y%m%d%H%M%S')}-{os.urandom(3).hex()}",
        "title": fields.get("label") or "Alarm",
        "entityType": "reminder",
        "status": "todo",
        "labels": [LABEL],
        "isInbox": False,
        "isFocus": False,
        "source": SOURCE,
        "customFields": {"alarm": {
            "days": days,
            "tone": fields.get("tone"),
            "volume": fields.get("volume"),
            "snoozeMinutes": fields.get("snoozeMinutes"),
        }},
        **_schedule(h, m, days, fields.get("enabled", True), now),
    }
    return item_actions.create_item(item, SOURCE, "lumo-alarm")


def update(item_id: str, spec: Any, now: datetime.datetime, tz):
    """Change an alarm. Returns (item, revision), or None when there is no
    such alarm. A new time, new days or switching it on sets it afresh (and
    ends a snooze); a new label or tone leaves a snooze alone."""
    fields = _check(spec, partial=True)

    def change(item: dict) -> None:
        if not any(str(label).strip().lower() == LABEL for label in item.get("labels") or []):
            raise LookupError("not an alarm")
        current = Alarm(item, tz)
        extra = dict(options(item) or {"days": current.days})
        if "label" in fields:
            item["title"] = fields["label"]
        for name in ("days", "tone", "volume", "snoozeMinutes"):
            if name in fields:
                extra[name] = fields[name]
        item["customFields"] = {**(item.get("customFields") or {}), "alarm": extra}
        if {"time", "days", "enabled"} & set(fields):
            h, m = fields.get("time", (current.h, current.m))
            enabled = fields.get("enabled", current.enabled)
            item.update(_schedule(h, m, extra.get("days") or [], enabled, now))

    try:
        return item_actions.update_item(item_id, change, SOURCE, "lumo-alarm")
    except LookupError:
        return None


def remove(item_id: str) -> Optional[tuple]:
    """Move an alarm to the Trash. None when there is no such alarm."""
    def change(item: dict) -> None:
        if not any(str(label).strip().lower() == LABEL for label in item.get("labels") or []):
            raise LookupError("not an alarm")
        item["deletedAt"] = item_actions.utc_now().isoformat()

    try:
        return item_actions.update_item(item_id, change, SOURCE, "lumo-delete")
    except LookupError:
        return None
