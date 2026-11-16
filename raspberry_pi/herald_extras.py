"""
herald_extras.py - what Herald says beyond the welcome and the goodbye.

Pure helpers, no I/O, so speaker.py stays readable and these are easy to test:

- Return recap: after a real trip, who messaged or rang while you were out
  (names only, as set) and which timed reminders slipped past.
- Call etiquette: lines held during a call come back as one line afterwards.
- Wind-down: one evening line, what you closed today and what comes first tomorrow.

All wording is hand-written (Alfred/Jarvis), never written by an AI, and only
ever says who, never what.
"""

import re
from typing import Dict, List, Optional

RECAP_MIN_AWAY_S = 15 * 60     # a trip at least this long gets a recap
MAX_NAMES = 4

_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
_PHONE_NUMBER = re.compile(r"^[\d\s\+\-\(\)]{7,}$")


def number(n: int) -> str:
    return _WORDS[n] if 0 <= n < len(_WORDS) else str(n)


def join_names(names: List[str]) -> str:
    """"A", "A and B", "A, B and C", and past MAX_NAMES "A, B, C and two others". Pure."""
    names = list(dict.fromkeys(n for n in names if n))
    if len(names) > MAX_NAMES:
        rest = len(names) - (MAX_NAMES - 1)
        names = names[:MAX_NAMES - 1] + [f"{number(rest)} others"]
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def is_named(sender: str) -> bool:
    """Only people you have saved: an empty title or a bare number is skipped."""
    sender = (sender or "").strip()
    return bool(sender) and not _PHONE_NUMBER.match(sender)


def _sentences(messages: List[str], emails: List[str], calls: List[str], reminders: List[str], rem_verb: str) -> List[str]:
    out: List[str] = []
    if messages:
        out.append(f"{join_names(messages)} messaged you.")
    if emails:
        out.append(f"{join_names(emails)} emailed you.")
    if calls:
        out.append(f"{join_names(calls)} tried to ring you.")
    reminders = [r for r in reminders if r]
    if len(reminders) == 1:
        out.append(f"A reminder {rem_verb}: {reminders[0]}.")
    elif reminders:
        out.append(f"{number(len(reminders)).capitalize()} reminders {rem_verb}, starting with {reminders[0]}.")
    return out


def _name(call_me: str) -> str:
    return f", {call_me}" if call_me else ""


_RECAP_OPEN = ["While you were out{name},", "In your absence{name},", "Since you left{name},"]
_CALL_OPEN = ["While you were on the call{name},", "During your call{name},"]


def _join_body(opener: str, body: List[str]) -> str:
    """Opener then the sentences; a leading "A reminder..." drops its capital, a name keeps its own. Pure."""
    first = body[0]
    if re.match(r"^(A|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+) reminders?\b", first):
        first = first[0].lower() + first[1:]
    return f"{opener} {first}" + ("" if len(body) == 1 else " " + " ".join(body[1:]))


def recap_line(messages: List[str], emails: List[str], calls: List[str], reminders: List[str], call_me: str = "", idx: int = 0) -> str:
    """The return recap, or "" if there is nothing to report. Pure."""
    body = _sentences(messages, emails, calls, reminders, "slipped by")
    if not body:
        return ""
    opener = _RECAP_OPEN[idx % len(_RECAP_OPEN)].format(name=_name(call_me))
    return _join_body(opener, body)


def replay_line(held: List[dict], call_me: str = "", idx: int = 0) -> str:
    """One line for everything held during a call. Each held entry is {kind, who, title}. Pure."""
    messages = [h["who"] for h in held if h.get("kind") in ("whatsapp", "message") and is_named(h.get("who", ""))]
    emails = [h["who"] for h in held if h.get("kind") == "email" and is_named(h.get("who", ""))]
    reminders = [h.get("title", "") for h in held if h.get("kind") == "reminder"]
    body = _sentences(messages, emails, [], reminders, "came up")
    if not body:
        return ""
    opener = _CALL_OPEN[idx % len(_CALL_OPEN)].format(name=_name(call_me))
    return _join_body(opener, body)


def missed_reminders(items: List[dict], left_hhmm: str, now_hhmm: str, today: str) -> List[str]:
    """Titles of open, visible tasks due today at a clock time that fell inside the trip. Pure.
    `items` are open work items; both times are "HH:MM" on `today`."""
    out = []
    for item in items:
        if item.get("isHidden") or "alarm" in (item.get("labels") or []):
            continue
        if item.get("dueDate") != today:
            continue
        t = str(item.get("dueTime") or "")
        if re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t) and left_hhmm <= t <= now_hhmm:
            title = str(item.get("title") or "").strip()
            if title:
                out.append(title)
    return out


_WIND_OPEN = ["That's the day{name}.", "And so the day winds down{name}.", "Another day done{name}."]
_WIND_REST = ["Rest well.", "Sleep well.", "Do get some rest."]


def wind_down_line(closed: int, first_tomorrow: Optional[str], call_me: str = "", idx: int = 0, remark: str = "") -> str:
    """The evening line. Pure."""
    parts = [_WIND_OPEN[idx % len(_WIND_OPEN)].format(name=_name(call_me))]
    if closed:
        parts.append(f"You closed {number(closed)} {'thing' if closed == 1 else 'things'} today.")
    else:
        parts.append("Nothing was ticked off today, but tomorrow is a fresh page.")
    if first_tomorrow:
        parts.append(f"First up tomorrow: {first_tomorrow}.")
    else:
        parts.append("Tomorrow is clear so far.")
    if remark:
        parts.append(remark)
    parts.append(_WIND_REST[idx % len(_WIND_REST)])
    return " ".join(parts)


def summarize_held(held: List[dict]) -> Dict[str, int]:
    """How many of each kind were held (for the UI and logs). Pure."""
    out: Dict[str, int] = {}
    for h in held:
        out[h.get("kind", "line")] = out.get(h.get("kind", "line"), 0) + 1
    return out
