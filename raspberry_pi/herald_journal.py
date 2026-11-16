"""
herald_journal.py - when you were home, and what Herald makes of it.

The journal is a short list of trips (left, back) kept in the metadata table.
From it come the presence card in Sage (a 24-hour bar per day) and the small
"memory" Herald uses in its lines ("third late return this week"). Everything
here except load/save is pure.
"""

import datetime
import json
import os
import sqlite3
from typing import Any, Dict, List, Optional, Set

KEY = "heraldJournal"
MIN_TRIP_S = 120      # shorter than this is a blip
KEEP_DAYS = 30
LATE_FROM_HOUR = 23     # back at 23:00 or later ...
LATE_UNTIL_HOUR = 4     # ... or before 04:00 counts as a late return

_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
_ORDINALS = {2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth", 7: "seventh"}


def _number(n: int) -> str:
    return _WORDS[n] if 0 <= n < len(_WORDS) else str(n)


def _db() -> str:
    return os.getenv("SAGE_DB_PATH", "sage_sync.db")


def load() -> dict:
    conn = sqlite3.connect(_db())
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
        row = conn.execute("SELECT value FROM metadata WHERE key = ?", (KEY,)).fetchone()
    finally:
        conn.close()
    try:
        j = json.loads(row[0]) if row else {}
    except ValueError:
        j = {}
    return j if isinstance(j, dict) and isinstance(j.get("trips", []), list) else {}


def save(j: dict) -> None:
    conn = sqlite3.connect(_db())
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", (KEY, json.dumps(j)))
        conn.commit()
    finally:
        conn.close()


def leave(j: dict, ts: float) -> dict:
    """You've left. A second leave while a trip is open (the Leave button, then Bluetooth dropping) is ignored. Pure."""
    j = dict(j)
    trips = [dict(t) for t in j.get("trips", [])]
    j.setdefault("since", ts)
    if trips and trips[-1].get("in") is None:
        return {**j, "trips": trips}
    trips.append({"out": ts, "in": None})
    cutoff = ts - KEEP_DAYS * 86400
    j["trips"] = [t for t in trips if (t.get("in") or t["out"]) >= cutoff]
    return j


def arrive(j: dict, ts: float) -> dict:
    """You're back: close the open trip. Pure."""
    j = dict(j)
    trips = [dict(t) for t in j.get("trips", [])]
    j.setdefault("since", ts)
    if trips and trips[-1].get("in") is None:
        trips[-1]["in"] = ts
        if ts - float(trips[-1]["out"]) < MIN_TRIP_S:
            trips.pop()          # a Bluetooth blip, not a trip
    j["trips"] = trips
    return j


def is_out(j: dict) -> bool:
    trips = j.get("trips") or []
    return bool(trips) and trips[-1].get("in") is None


def _minutes(ts: float, day: datetime.date, tz: datetime.tzinfo) -> float:
    start = datetime.datetime.combine(day, datetime.time(0), tzinfo=tz)
    return (datetime.datetime.fromtimestamp(ts, tz) - start).total_seconds() / 60


def day_report(j: dict, day: datetime.date, tz: datetime.tzinfo, now: float) -> dict:
    """One day: the stretches you were out (minutes from midnight) and how long you were home. Pure."""
    since = j.get("since")
    known_from = max(0.0, _minutes(since, day, tz)) if since else 1440.0
    known_to = min(1440.0, _minutes(now, day, tz))
    segs: List[List[int]] = []
    for t in j.get("trips", []):
        s = _minutes(t["out"], day, tz)
        e = _minutes(t["in"] if t.get("in") else now, day, tz)
        s, e = max(s, known_from), min(e, known_to)
        if e > s:
            segs.append([int(s), int(e)])
    known = max(0.0, known_to - known_from)
    away = sum(e - s for s, e in segs)
    return {"day": day.isoformat(), "known": known > 0, "from": int(known_from), "to": int(known_to),
            "out": segs, "awayMin": int(away), "homeMin": int(max(0.0, known - away))}


def report(j: dict, tz: datetime.tzinfo, now: float, days: int = 7) -> dict:
    today = datetime.datetime.fromtimestamp(now, tz).date()
    rows = [day_report(j, today - datetime.timedelta(days=n), tz, now) for n in range(days - 1, -1, -1)]
    return {"days": rows, "out": is_out(j), "since": j.get("since"), "late": late_returns(j, tz, now)}


def late_returns(j: dict, tz: datetime.tzinfo, now: float, days: int = 7) -> int:
    """How many returns in the last `days` were late at night. Pure."""
    cutoff = now - days * 86400
    n = 0
    for t in j.get("trips", []):
        back = t.get("in")
        if not back or back < cutoff:
            continue
        hour = datetime.datetime.fromtimestamp(back, tz).hour
        if hour >= LATE_FROM_HOUR or hour < LATE_UNTIL_HOUR:
            n += 1
    return n


def closed_streak(done_days: Set[str], today: datetime.date) -> int:
    """Days running (ending today, or yesterday if today has none yet) with at least one task closed. Pure."""
    day = today if today.isoformat() in done_days else today - datetime.timedelta(days=1)
    n = 0
    while day.isoformat() in done_days:
        n += 1
        day -= datetime.timedelta(days=1)
    return n


def memory_remark(late: int, streak: int, call_me: str = "") -> str:
    """One short remark about a pattern worth mentioning, or "". Pure.
    Late returns win over streaks; a single late return or a short streak is not a pattern."""
    name = f", {call_me}" if call_me else ""
    if late >= 2:
        ordinal = _ORDINALS.get(late, f"{late}th")
        return f"That is the {ordinal} late return this week{name}."
    if streak >= 3:
        return f"{_number(streak).capitalize()} days running with something closed{name}. Rather good."
    return ""
