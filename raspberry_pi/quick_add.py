"""
Server-side quick-add parser — a Python port of the subset of
quickAddParser.ts that matters for headless capture (Siri Shortcuts,
Share Sheet, email subjects, LUMO voice).

It runs synchronously and needs no AI model. The client-side parser is
still the primary one; this mirrors its token syntax so items created
from either feel the same.
"""

import re
import datetime
from typing import Optional, List, Tuple

WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
SHORT_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def _day_index(word: str) -> int:
    w = word.lower()[:3]
    for i, d in enumerate(SHORT_DAYS):
        if d == w:
            return i
    return -1


def _next_weekday(today: datetime.date, target: int) -> datetime.date:
    delta = (target - today.weekday()) % 7
    if delta == 0:
        delta = 7
    # Python weekday: Mon=0, but our WEEKDAYS list: Sun=0. Convert.
    return today + datetime.timedelta(days=delta)


def _py_weekday(our_index: int) -> int:
    """Convert our index (Sun=0..Sat=6) to Python (Mon=0..Sun=6)."""
    return (our_index - 1) % 7


def _month_index(word: str) -> int:
    w = word.lower()[:3]
    for i, m in enumerate(MONTHS):
        if m == w:
            return i
    return -1


def _strip(text: str, match: re.Match) -> str:
    start = match.start()
    end = match.end()
    before = text[:start].rstrip()
    after = text[end:].lstrip()
    return (before + " " + after).strip() if before and after else (before + after).strip()


class QuickAddResult:
    def __init__(self):
        self.title: str = ""
        self.entity_type: str = "task"  # task | event | reminder
        self.priority: Optional[str] = None
        self.date: Optional[str] = None  # YYYY-MM-DD
        self.time: Optional[str] = None  # HH:mm
        self.tags: List[str] = []
        self.location: Optional[str] = None
        self.repeat_rule: Optional[str] = None
        self.duration_minutes: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "entityType": self.entity_type,
            "priority": self.priority,
            "date": self.date,
            "time": self.time,
            "tags": self.tags,
            "location": self.location,
            "repeatRule": self.repeat_rule,
            "durationMinutes": self.duration_minutes,
        }


def parse_quick_add(text: str, now: Optional[datetime.datetime] = None) -> QuickAddResult:
    if now is None:
        now = datetime.datetime.now()
    today = now.date()
    result = QuickAddResult()
    work = text.strip()

    # --- Reminder prefix ---
    m = re.match(r"^remind\s+me\s+(?:to\s+|about\s+)?", work, re.I)
    if m:
        result.entity_type = "reminder"
        work = work[m.end():]

    # --- Tags: #word ---
    def _extract_tags(t: str) -> str:
        while True:
            m = re.search(r"(?:^|\s)#([a-zA-Z]\w{0,29})\b", t)
            if not m:
                break
            result.tags.append(m.group(1).lower())
            t = _strip(t, m)
        return t

    work = _extract_tags(work)

    # --- Priority: !urgent, !high, !low, !medium ---
    m = re.search(r"(?:^|\s)!(urgent|high|medium|med|low|important)\b", work, re.I)
    if m:
        p = m.group(1).lower()
        result.priority = "high" if p == "important" else ("medium" if p == "med" else p)
        work = _strip(work, m)

    # Bare priority words at end
    if not result.priority:
        m = re.search(r"\b(urgent|asap|important)\s*$", work, re.I)
        if m:
            w = m.group(1).lower()
            result.priority = "urgent" if w in ("urgent", "asap") else "high"
            work = _strip(work, m)

    # --- Duration: ~30m, ~2h, ~1h30m ---
    m = re.search(r"~(\d+)h(\d+)m\b", work, re.I)
    if m:
        result.duration_minutes = int(m.group(1)) * 60 + int(m.group(2))
        work = _strip(work, m)
    else:
        m = re.search(r"~(\d+)h\b", work, re.I)
        if m:
            result.duration_minutes = int(m.group(1)) * 60
            work = _strip(work, m)
        else:
            m = re.search(r"~(\d+)m\b", work, re.I)
            if m:
                result.duration_minutes = int(m.group(1))
                work = _strip(work, m)

    # --- Location: @place (but not email addresses) ---
    m = re.search(r"(?:^|\s)@([a-zA-Z]\w{0,39})\b", work)
    if m:
        result.location = m.group(1)
        work = _strip(work, m)

    # --- Recurrence (before dates, since "every monday" has a day in it) ---
    recurrence_patterns: List[Tuple[re.Pattern, str]] = [
        (re.compile(r"\bevery\s+day\b", re.I), "daily"),
        (re.compile(r"\bdaily\b", re.I), "daily"),
        (re.compile(r"\bevery\s+weekday\b", re.I), "weekdays"),
        (re.compile(r"\bweekdays\b", re.I), "weekdays"),
        (re.compile(r"\bevery\s+week\b", re.I), "weekly"),
        (re.compile(r"\bweekly\b", re.I), "weekly"),
        (re.compile(r"\bevery\s+month\b", re.I), "monthly"),
        (re.compile(r"\bmonthly\b", re.I), "monthly"),
        (re.compile(r"\bevery\s+year\b", re.I), "yearly"),
        (re.compile(r"\byearly\b", re.I), "yearly"),
        (re.compile(r"\bannually\b", re.I), "yearly"),
        (re.compile(r"\bevery\s+other\s+week\b", re.I), "every:2:weeks"),
    ]
    for pat, rule in recurrence_patterns:
        m = pat.search(work)
        if m:
            result.repeat_rule = rule
            work = _strip(work, m)
            break

    # "every N days/weeks/months"
    if not result.repeat_rule:
        m = re.search(r"\bevery\s+(\d+)\s+(day|week|month)s?\b", work, re.I)
        if m:
            n = int(m.group(1))
            unit = m.group(2).lower() + "s"
            result.repeat_rule = f"every:{n}:{unit}"
            work = _strip(work, m)

    # "every monday", "every mon, wed, fri"
    if not result.repeat_rule:
        m = re.search(
            r"\bevery\s+((?:(?:sun|mon|tue|wed|thu|fri|sat)\w*(?:\s*,?\s*)?)+)\b",
            work, re.I,
        )
        if m:
            days_text = m.group(1)
            indices = []
            for dw in re.findall(r"[a-zA-Z]+", days_text):
                idx = _day_index(dw)
                if idx >= 0:
                    indices.append(idx)
            if len(indices) == 1:
                result.repeat_rule = f"weekly:{indices[0]}"
            elif indices:
                result.repeat_rule = "weekly:" + ",".join(str(i) for i in sorted(set(indices)))
            work = _strip(work, m)

    # --- Dates ---
    connector = r"(?:(?:by|on|at|for|before|due|this|from|until|starting)\s+)?"

    # ISO: 2026-01-05
    m = re.search(connector + r"(\d{4}-\d{2}-\d{2})\b", work, re.I)
    if m:
        result.date = m.group(1)
        work = _strip(work, m)
    # "today"
    elif re.search(connector + r"\btoday\b", work, re.I):
        m = re.search(connector + r"\btoday\b", work, re.I)
        result.date = today.isoformat()
        work = _strip(work, m)
    # "tonight"
    elif re.search(connector + r"\btonight\b", work, re.I):
        m = re.search(connector + r"\btonight\b", work, re.I)
        result.date = today.isoformat()
        if not result.time:
            result.time = "21:00"
        work = _strip(work, m)
    # "tomorrow"
    elif re.search(connector + r"\btomorrow\b", work, re.I):
        m = re.search(connector + r"\btomorrow\b", work, re.I)
        result.date = (today + datetime.timedelta(days=1)).isoformat()
        work = _strip(work, m)
    # "this weekend"
    elif re.search(connector + r"\bthis\s+weekend\b", work, re.I):
        m = re.search(connector + r"\bthis\s+weekend\b", work, re.I)
        sat = today + datetime.timedelta(days=(5 - today.weekday()) % 7)
        if sat <= today:
            sat += datetime.timedelta(days=7)
        result.date = sat.isoformat()
        work = _strip(work, m)
    # "next week"
    elif re.search(connector + r"\bnext\s+week\b", work, re.I):
        m = re.search(connector + r"\bnext\s+week\b", work, re.I)
        result.date = (today + datetime.timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()
        work = _strip(work, m)
    # "in N days/weeks/months"
    else:
        m = re.search(connector + r"\bin\s+(\d+)\s+(day|week|month)s?\b", work, re.I)
        if m:
            n = int(m.group(1))
            unit = m.group(2).lower()
            if unit == "day":
                result.date = (today + datetime.timedelta(days=n)).isoformat()
            elif unit == "week":
                result.date = (today + datetime.timedelta(weeks=n)).isoformat()
            elif unit == "month":
                try:
                    result.date = today.replace(month=today.month + n).isoformat()
                except ValueError:
                    result.date = today.replace(month=((today.month - 1 + n) % 12) + 1,
                                                year=today.year + (today.month - 1 + n) // 12).isoformat()
            work = _strip(work, m)

    # Weekday names: "monday", "next friday", "this tuesday"
    if not result.date:
        day_re = r"(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)"
        m = re.search(connector + r"\b(?:next\s+)?" + day_re + r"\b", work, re.I)
        if m:
            idx = _day_index(m.group(1))
            if idx >= 0:
                target = _next_weekday(today, _py_weekday(idx))
                result.date = target.isoformat()
                work = _strip(work, m)

    # "oct 15", "15 october", "12/25"
    if not result.date:
        month_re = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
        m = re.search(connector + month_re + r"\s+(\d{1,2})\b", work, re.I)
        if m:
            mi = _month_index(m.group(1))
            day_num = int(m.group(2))
            if 0 <= mi and 1 <= day_num <= 31:
                try:
                    d = today.replace(month=mi + 1, day=day_num)
                    if d < today:
                        d = d.replace(year=d.year + 1)
                    result.date = d.isoformat()
                except ValueError:
                    pass
                work = _strip(work, m)
        if not result.date:
            m = re.search(connector + r"\b(\d{1,2})\s+" + month_re, work, re.I)
            if m:
                day_num = int(m.group(1))
                mi = _month_index(m.group(2))
                if 0 <= mi and 1 <= day_num <= 31:
                    try:
                        d = today.replace(month=mi + 1, day=day_num)
                        if d < today:
                            d = d.replace(year=d.year + 1)
                        result.date = d.isoformat()
                    except ValueError:
                        pass
                    work = _strip(work, m)
        # MM/DD
        if not result.date:
            m = re.search(connector + r"\b(\d{1,2})/(\d{1,2})\b", work, re.I)
            if m:
                mi = int(m.group(1)) - 1
                day_num = int(m.group(2))
                if 0 <= mi <= 11 and 1 <= day_num <= 31:
                    try:
                        d = today.replace(month=mi + 1, day=day_num)
                        if d < today:
                            d = d.replace(year=d.year + 1)
                        result.date = d.isoformat()
                    except ValueError:
                        pass
                    work = _strip(work, m)

    # --- Time: 3pm, 15:30, at 5, noon, midnight ---
    if not result.time:
        m = re.search(r"\b(\d{1,2}):(\d{2})\s*(am|pm)?\b", work, re.I)
        if m:
            h = int(m.group(1))
            minute = int(m.group(2))
            ampm = (m.group(3) or "").lower()
            if ampm == "pm" and h < 12:
                h += 12
            elif ampm == "am" and h == 12:
                h = 0
            result.time = f"{h:02d}:{minute:02d}"
            work = _strip(work, m)
        else:
            m = re.search(r"\b(\d{1,2})\s*(am|pm)\b", work, re.I)
            if m:
                h = int(m.group(1))
                ampm = m.group(2).lower()
                if ampm == "pm" and h < 12:
                    h += 12
                elif ampm == "am" and h == 12:
                    h = 0
                result.time = f"{h:02d}:00"
                work = _strip(work, m)
            else:
                m = re.search(r"\bat\s+(\d{1,2})\b(?!\s*(?:am|pm|:|/))", work, re.I)
                if m:
                    h = int(m.group(1))
                    if 1 <= h <= 12:
                        if h < 7:
                            h += 12
                        result.time = f"{h:02d}:00"
                        work = _strip(work, m)

    if not result.time:
        m = re.search(r"\bnoon\b", work, re.I)
        if m:
            result.time = "12:00"
            work = _strip(work, m)
        else:
            m = re.search(r"\bmidnight\b", work, re.I)
            if m:
                result.time = "00:00"
                work = _strip(work, m)
            else:
                m = re.search(r"\bthis\s+(morning|afternoon|evening)\b", work, re.I)
                if m:
                    part = m.group(1).lower()
                    result.time = {"morning": "09:00", "afternoon": "14:00", "evening": "19:00"}[part]
                    if not result.date:
                        result.date = today.isoformat()
                    work = _strip(work, m)

    # --- Event detection ---
    event_words = re.compile(
        r"\b(meeting|appointment|call\s+with|lunch|dinner|coffee|interview)\b", re.I,
    )
    if result.entity_type == "task" and (result.time or result.location) and event_words.search(work):
        result.entity_type = "event"

    # Clean up the title
    result.title = re.sub(r"\s+", " ", work).strip()
    if not result.title:
        result.title = "Untitled"

    return result
