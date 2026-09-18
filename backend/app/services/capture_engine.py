"""
Natural-language quick capture.

Turns one line of ordinary writing -- "going out with cousins at 7.30pm so
leave office by 6.30pm" -- into the work items it describes, with their dates,
times, reminders, priorities, projects and context tags already filled in.

The whole engine is deterministic, pure Python and has no I/O, so it runs in
well under a millisecond on a Raspberry Pi and works with Ollama stopped. It is
the source of truth for anything structured: dates, times, recurrence, money and
durations are never handed to a 1.5B model, which gets them wrong often enough
to be worse than useless. `capture_ai` lets the model read the note, then checks
everything it returns against this parse and replaces whatever does not hold up.

The entry point is `parse_capture(text)`.
"""

import calendar
import datetime
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ----------------------------------------------------------------------------
# Vocabulary
# ----------------------------------------------------------------------------

WEEKDAYS = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2, "weds": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

MONTHS = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

# Hour of day a vague part-of-day reference resolves to.
DAY_PARTS = {
    "morning": 9,
    "afternoon": 14,
    "evening": 18,
    "tonight": 20,
    "night": 20,
    "noon": 12,
    "midday": 12,
    "midnight": 0,
}

# Words that make a bare hour an evening hour ("dinner at 8" is 8pm).
EVENING_WORDS = {
    "dinner", "supper", "drinks", "party", "movie", "film", "concert", "show",
    "evening", "tonight", "night", "bed", "sleep", "dine",
}
MORNING_WORDS = {
    "breakfast", "morning", "sunrise", "wake", "standup", "stand-up",
}

EVENT_WORDS = {
    "meeting", "meet", "meetup", "call", "sync", "standup", "stand-up", "1:1",
    "interview", "appointment", "appt", "consultation", "checkup", "check-up",
    "party", "birthday", "anniversary", "wedding", "reception", "ceremony",
    "naming", "funeral", "dinner", "lunch", "brunch", "breakfast", "drinks",
    "flight", "train", "bus", "trip", "visit", "class", "lecture", "session",
    "webinar", "conference", "concert", "match", "game", "movie", "film",
    "doctor", "dentist", "hospital", "clinic", "salon", "haircut",
}

# Phrases that mean "this is an outing", so a segment with a time is an event.
EVENT_PHRASES = (
    "going out", "going to", "heading out", "heading to", "hanging out",
    "catching up", "meeting up", "picking up", "dropping",
)

REMINDER_LEADS = (
    "remind me to", "remind me", "reminder to", "reminder:", "remember to",
    "don't forget to", "dont forget to", "don't forget", "dont forget",
    "make sure to", "make sure i", "alert me", "ping me", "nudge me",
)

# Leading filler stripped from a title without changing the user's own words.
TITLE_FILLERS = (
    "i need to", "i have to", "i want to", "i should", "i must", "i'll",
    "i will", "need to", "have to", "got to", "gotta", "please", "pls",
    "can you", "could you", "let's", "lets", "we need to", "we should",
    "remind me to", "remind me", "reminder to", "remember to",
    "don't forget to", "dont forget to", "don't forget", "dont forget",
    "make sure to", "make sure i", "make sure",
)

# Connectors that separate two distinct actions in one sentence.
SEGMENT_SPLITTERS = (
    " so that i ", " so that ", " so i ", " so ",
    " and then ", " then ", " after that ", " afterwards ",
    " also ", " plus ", " as well as ", " followed by ",
    " before that ", " meanwhile ",
)

# Verbs that make the right-hand side of "and" its own action.
ACTION_VERBS = {
    "leave", "go", "call", "email", "send", "buy", "get", "pick", "drop",
    "pay", "book", "check", "review", "finish", "start", "submit", "file",
    "clean", "wash", "cook", "prepare", "prep", "write", "read", "study",
    "fix", "update", "renew", "cancel", "order", "collect", "return",
    "attend", "join", "visit", "meet", "remind", "remember", "take", "bring",
    "schedule", "plan", "confirm", "reply", "respond", "print", "pack",
}

# Doing one of these *about* an event is still a task: booking a flight is not
# the flight.
TASK_VERBS = {
    "book", "buy", "order", "pay", "get", "arrange", "schedule", "plan",
    "prepare", "prep", "check", "confirm", "cancel", "renew", "submit",
    "send", "email", "file", "finish", "review", "write", "fix", "update",
    "collect", "print", "pack", "return", "reply", "respond",
}

# Nouns that are an occasion in their own right, with or without a time.
STRONG_EVENT_WORDS = {
    "meeting", "appointment", "appt", "interview", "wedding", "reception",
    "ceremony", "funeral", "party", "flight", "conference", "webinar",
    "lecture", "concert",
}

# Nouns that make a bare number an amount of money rather than anything else.
MONEY_NOUNS = (
    "rent", "bill", "emi", "fee", "fees", "salary", "subscription",
    "recharge", "premium", "instalment", "installment", "tuition", "invoice",
)

CONTEXT_KEYWORDS = {
    "office": "@office",
    "home": "@home",
    "call": "@calls",
    "phone": "@calls",
    "email": "@email",
    "market": "@errands",
    "shop": "@errands",
    "shopping": "@errands",
    "grocery": "@errands",
    "groceries": "@errands",
    "bank": "@errands",
    "online": "@computer",
    "laptop": "@computer",
    "computer": "@computer",
}

URGENT_WORDS = ("urgent", "asap", "critical", "emergency", "right away", "immediately", "top priority")
HIGH_WORDS = ("important", "high priority", "must ", "cannot miss", "can't miss", "dont miss", "don't miss", "deadline", "priority")
LOW_WORDS = ("low priority", "whenever", "someday", "some day", "sometime", "no rush", "if i get time", "eventually", "nice to have")

HIGH_ENERGY_WORDS = ("write", "draft", "design", "code", "build", "study", "learn", "research", "analyse", "analyze", "plan", "strategy", "deep work", "focus")
LOW_ENERGY_WORDS = ("email", "call", "reply", "file", "pay", "buy", "pick up", "drop", "clean", "tidy", "laundry", "admin", "book", "order")

PAYMENT_MODE_WORDS = (
    ("cash", "cash"),
    ("upi", "upi"),
    ("gpay", "upi"),
    ("google pay", "upi"),
    ("phonepe", "upi"),
    ("paytm", "upi"),
    ("credit card", "credit_card"),
    ("credit", "credit_card"),
    ("debit card", "debit_card"),
    ("debit", "debit_card"),
    ("card", "debit_card"),
    ("net banking", "net_banking"),
    ("netbanking", "net_banking"),
    ("bank transfer", "net_banking"),
    ("neft", "net_banking"),
    ("imps", "net_banking"),
)

# Deadline prepositions -- "by 6.30" is something to be done before a moment,
# not something that starts at it.
DEADLINE_PREPS = ("by", "before", "until", "till", "ahead of", "no later than")

DEFAULT_EVENT_MINUTES = 60
DEFAULT_TASK_MINUTES = 30
DEFAULT_EVENT_LEAD_MINUTES = 15


# ----------------------------------------------------------------------------
# Result types
# ----------------------------------------------------------------------------

@dataclass
class CapturedItem:
    """One work item recovered from a fragment of natural language."""
    title: str
    source_text: str
    entity_type: str = "task"
    status: str = "todo"
    priority: str = "medium"
    energy: str = "medium"
    description: Optional[str] = None
    due_date: Optional[str] = None       # YYYY-MM-DD
    start_at: Optional[str] = None       # ISO datetime
    end_at: Optional[str] = None         # ISO datetime
    remind_at: Optional[str] = None      # ISO datetime
    repeat_rule: Optional[str] = None
    estimated_minutes: int = DEFAULT_TASK_MINUTES
    context_tags: str = ""
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    expense: Optional[Dict[str, Any]] = None
    # What the engine recognised, for the "picked up as you type" hints.
    tokens: List[Dict[str, str]] = field(default_factory=list)
    # True when a bare hour had to be guessed am/pm.
    time_is_ambiguous: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "source_text": self.source_text,
            "entity_type": self.entity_type,
            "status": self.status,
            "priority": self.priority,
            "energy": self.energy,
            "description": self.description,
            "due_date": self.due_date,
            "start_at": self.start_at,
            "end_at": self.end_at,
            "remind_at": self.remind_at,
            "repeat_rule": self.repeat_rule,
            "estimated_minutes": self.estimated_minutes,
            "context_tags": self.context_tags,
            "project_id": self.project_id,
            "project_name": self.project_name,
            "expense": self.expense,
            "tokens": self.tokens,
            "time_is_ambiguous": self.time_is_ambiguous,
        }


@dataclass
class CaptureResult:
    items: List[CapturedItem]
    raw_text: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw_text": self.raw_text,
            "items": [i.to_dict() for i in self.items],
        }


# ----------------------------------------------------------------------------
# Span bookkeeping
# ----------------------------------------------------------------------------

class _Spans:
    """Tracks which characters of a segment have been consumed by a matcher."""

    def __init__(self, text: str):
        self.text = text
        self._taken: List[Tuple[int, int]] = []

    def claim(self, start: int, end: int) -> None:
        self._taken.append((start, end))

    def is_free(self, start: int, end: int) -> bool:
        return all(end <= s or start >= e for s, e in self._taken)

    def remainder(self) -> str:
        if not self._taken:
            return self.text
        chars = list(self.text)
        for s, e in self._taken:
            for i in range(max(0, s), min(len(chars), e)):
                chars[i] = " "
        return "".join(chars)

    def search(self, pattern: str, flags: int = re.I):
        """First match of `pattern` that does not overlap an existing claim."""
        for m in re.finditer(pattern, self.text, flags):
            if self.is_free(m.start(), m.end()):
                return m
        return None


# ----------------------------------------------------------------------------
# Segmentation
# ----------------------------------------------------------------------------

def _looks_like_own_action(fragment: str) -> bool:
    """True when a fragment carries its own verb or its own time."""
    words = re.findall(r"[a-z']+", fragment.lower())
    if not words:
        return False
    if words[0] in ACTION_VERBS:
        return True
    if any(w in ACTION_VERBS for w in words[:3]):
        return True
    if re.search(r"\b\d{1,2}([:.]\d{2})?\s*(am|pm)\b", fragment, re.I):
        return True
    if re.search(r"\b(today|tomorrow|tonight|tmrw)\b", fragment, re.I):
        return True
    return False


def split_segments(text: str) -> List[str]:
    """
    Break one line of writing into the separate actions it describes.

    "going out with cousins at 7.30pm so leave office by 6.30pm" is two
    actions; "buy milk and eggs" is one.
    """
    parts: List[str] = []
    for line in re.split(r"[\n;]+|(?<=[.!?])\s+(?=[A-Za-z])", text):
        line = line.strip()
        if line:
            parts.append(line)

    # Split on explicit connectors.
    for splitter in SEGMENT_SPLITTERS:
        expanded: List[str] = []
        for part in parts:
            pieces = re.split(re.escape(splitter), part, flags=re.I)
            if len(pieces) == 1:
                expanded.append(part)
                continue
            head = pieces[0].strip()
            if head:
                expanded.append(head)
            for piece in pieces[1:]:
                piece = piece.strip()
                if not piece:
                    continue
                if _looks_like_own_action(piece) or not expanded:
                    expanded.append(piece)
                else:
                    expanded[-1] = f"{expanded[-1]}{splitter}{piece}"
        parts = expanded

    # "and" / comma only separate when the right side stands on its own. The
    # separator is kept so a list that does not split ("milk and eggs") reads
    # back exactly as it was typed.
    expanded = []
    for part in parts:
        pieces = re.split(r"(,\s+and\s+|\s+and\s+|,\s+)", part, flags=re.I)
        if len(pieces) == 1:
            expanded.append(part)
            continue
        current = pieces[0].strip()
        for separator, piece in zip(pieces[1::2], pieces[2::2]):
            piece = piece.strip()
            if not piece:
                continue
            if _looks_like_own_action(piece):
                if current:
                    expanded.append(current)
                current = piece
            else:
                current = f"{current}{separator}{piece}" if current else piece
        if current:
            expanded.append(current)
    parts = expanded

    return [p.strip(" ,.-") for p in parts if p.strip(" ,.-")]


# ----------------------------------------------------------------------------
# Time & date
# ----------------------------------------------------------------------------

def _resolve_meridiem(hour: int, minute: int, segment: str, now: datetime.datetime,
                      date_is_explicit: bool) -> Tuple[int, bool]:
    """
    Decide am/pm for a bare hour, and report whether it had to be guessed.

    With no date given, the reading that is still ahead today wins -- at 10am
    "leave office by 6.30" means half past six this evening, not this morning.
    """
    if hour == 0 or hour > 12:
        return hour, False
    lowered = segment.lower()
    if any(w in lowered for w in EVENING_WORDS):
        return (hour + 12 if hour < 12 else hour), True
    if any(w in lowered for w in MORNING_WORDS):
        return (hour if hour != 12 else 0), True

    if date_is_explicit:
        # No "later today" to lean on, so fall back on ordinary daily rhythm.
        return (hour + 12 if 1 <= hour <= 6 else hour), True

    today = now.date()
    for candidate in (hour, hour + 12 if hour < 12 else hour):
        moment = datetime.datetime.combine(today, datetime.time(candidate % 24, minute))
        if moment >= now:
            return candidate % 24, True
    return (hour + 12 if 1 <= hour <= 6 else hour), True


def _extract_time(spans: _Spans, now: datetime.datetime, date_is_explicit: bool):
    """
    Returns (hour, minute, end_hm, is_deadline, ambiguous, label) or None.
    """
    segment = spans.text

    # 1. A range: "from 5pm to 7pm", "5-6pm", "between 4 and 5"
    m = spans.search(
        r"\b(?:from\s+|between\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to|till|until|and)\s*"
        r"(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b"
    )
    if m:
        end_h = int(m.group(4))
        end_min = int(m.group(5) or 0)
        end_mer = m.group(6).lower()
        if end_mer == "pm" and end_h < 12:
            end_h += 12
        elif end_mer == "am" and end_h == 12:
            end_h = 0
        start_h = int(m.group(1))
        start_min = int(m.group(2) or 0)
        start_mer = (m.group(3) or "").lower()
        if start_mer == "pm" and start_h < 12:
            start_h += 12
        elif start_mer == "am" and start_h == 12:
            start_h = 0
        elif not start_mer and start_h + 12 <= end_h:
            start_h += 12
        spans.claim(m.start(), m.end())
        return start_h, start_min, (end_h, end_min), False, False, m.group(0).strip()

    # 2. "half past seven", "quarter to eight"
    m = spans.search(r"\b(half|quarter)\s+(past|to)\s+(\d{1,2}|" + "|".join(_NUMBER_WORDS) + r")\b")
    if m:
        base = _word_to_number(m.group(3))
        if base is not None:
            offset = 30 if m.group(1).lower() == "half" else 15
            if m.group(2).lower() == "to":
                hour, minute = (base - 1) % 24, 60 - offset
            else:
                hour, minute = base % 24, offset
            hour, ambiguous = _resolve_meridiem(hour, minute, segment, now, date_is_explicit)
            spans.claim(m.start(), m.end())
            return hour, minute, None, _preceded_by_deadline(segment, m.start(), m.group(0)), ambiguous, m.group(0).strip()

    # 3. "in 20 minutes", "in 2 hours"
    m = spans.search(r"\bin\s+(a|an|\d{1,3})\s*(min|mins|minute|minutes|hr|hrs|hour|hours)\b")
    if m:
        qty = 1 if m.group(1).lower() in ("a", "an") else int(m.group(1))
        delta = datetime.timedelta(minutes=qty) if m.group(2).lower().startswith("min") \
            else datetime.timedelta(hours=qty)
        moment = now + delta
        spans.claim(m.start(), m.end())
        return moment.hour, moment.minute, None, False, False, m.group(0).strip()

    # 4. Explicit clock time: "7.30pm", "19:30", "7 pm", "7 o'clock"
    m = spans.search(r"(?<![\d.])(\d{1,2})[:.](\d{2})\s*(am|pm)?(?![\d])")
    if m:
        hour, minute = int(m.group(1)), int(m.group(2))
        mer = (m.group(3) or "").lower()
        ambiguous = False
        if mer == "pm" and hour < 12:
            hour += 12
        elif mer == "am" and hour == 12:
            hour = 0
        elif not mer:
            hour, ambiguous = _resolve_meridiem(hour, minute, segment, now, date_is_explicit)
        if hour < 24 and minute < 60:
            spans.claim(m.start(), m.end())
            return hour, minute, None, _preceded_by_deadline(segment, m.start(), m.group(0)), ambiguous, m.group(0).strip()

    m = spans.search(r"\b(\d{1,2})\s*(am|pm)\b|\b(\d{1,2})\s*o'?clock\b|"
                     r"(?:\bat|\bby|\bbefore|\baround)\s+(\d{1,2})\b(?![:.\d])")
    if m:
        if m.group(1):
            hour, mer = int(m.group(1)), m.group(2).lower()
            if mer == "pm" and hour < 12:
                hour += 12
            elif mer == "am" and hour == 12:
                hour = 0
            ambiguous = False
        else:
            raw_hour = int(m.group(3) or m.group(4))
            if raw_hour > 23:
                return None
            hour, ambiguous = _resolve_meridiem(raw_hour, 0, segment, now, date_is_explicit)
        if hour < 24:
            spans.claim(m.start(), m.end())
            return hour, 0, None, _preceded_by_deadline(segment, m.start(), m.group(0)), ambiguous, m.group(0).strip()

    # 5. A named hour: noon, midnight, this evening
    m = spans.search(r"\b(noon|midday|midnight|tonight|this\s+(?:morning|afternoon|evening)|"
                     r"(?:in\s+the\s+)?(?:morning|afternoon|evening))\b")
    if m:
        label = m.group(0).lower()
        for name, hour in DAY_PARTS.items():
            if name in label:
                spans.claim(m.start(), m.end())
                return hour, 0, None, False, False, m.group(0).strip()

    return None


_NUMBER_WORDS = ("one", "two", "three", "four", "five", "six", "seven", "eight",
                 "nine", "ten", "eleven", "twelve")


def _word_to_number(token: str) -> Optional[int]:
    token = token.lower()
    if token.isdigit():
        return int(token)
    if token in _NUMBER_WORDS:
        return _NUMBER_WORDS.index(token) + 1
    return None


def _preceded_by_deadline(segment: str, index: int, matched: str = "") -> bool:
    """True when this date or time is a deadline rather than a starting point."""
    if matched and any(matched.lower().lstrip().startswith(p + " ") for p in DEADLINE_PREPS):
        return True
    prefix = segment[:index].lower().rstrip()
    return any(prefix.endswith(p) for p in DEADLINE_PREPS)


def _extract_date(spans: _Spans, now: datetime.datetime):
    """Returns (date, is_deadline, label) or None."""
    today = now.date()
    segment = spans.text

    m = spans.search(r"\b(\d{4})-(\d{2})-(\d{2})\b")
    if m:
        try:
            d = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            spans.claim(m.start(), m.end())
            return d, _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0)
        except ValueError:
            pass

    m = spans.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b")
    if m:
        day, month = int(m.group(1)), int(m.group(2))
        year = int(m.group(3)) if m.group(3) else today.year
        if year < 100:
            year += 2000
        try:
            d = datetime.date(year, month, day)
            if not m.group(3) and d < today:
                d = datetime.date(year + 1, month, day)
            spans.claim(m.start(), m.end())
            return d, _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0)
        except ValueError:
            pass

    month_names = "|".join(MONTHS)
    m = spans.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({month_names})\b(?:\s+(\d{{4}}))?")
    if not m:
        m2 = spans.search(rf"\b({month_names})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b(?:,?\s+(\d{{4}}))?")
        if m2:
            month, day, year_s = MONTHS[m2.group(1).lower()], int(m2.group(2)), m2.group(3)
            m = m2
        else:
            month = day = year_s = None
    else:
        day, month, year_s = int(m.group(1)), MONTHS[m.group(2).lower()], m.group(3)
    if m and month:
        year = int(year_s) if year_s else today.year
        try:
            d = datetime.date(year, month, min(day, calendar.monthrange(year, month)[1]))
            if not year_s and d < today:
                d = d.replace(year=year + 1)
            spans.claim(m.start(), m.end())
            return d, _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0)
        except ValueError:
            pass

    m = spans.search(r"\b(day\s+after\s+tomorrow|tomorrow|tmrw|tmw|tomo|today|tonight)\b")
    if m:
        label = m.group(1).lower()
        if label.startswith("day after"):
            d = today + datetime.timedelta(days=2)
        elif label in ("today", "tonight"):
            d = today
        else:
            d = today + datetime.timedelta(days=1)
        spans.claim(m.start(), m.end())
        return d, _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0)

    m = spans.search(r"\bin\s+(a|an|\d{1,3})\s*(day|days|week|weeks|month|months)\b")
    if m:
        qty = 1 if m.group(1).lower() in ("a", "an") else int(m.group(1))
        unit = m.group(2).lower()
        if unit.startswith("day"):
            d = today + datetime.timedelta(days=qty)
        elif unit.startswith("week"):
            d = today + datetime.timedelta(weeks=qty)
        else:
            d = _add_months(today, qty)
        spans.claim(m.start(), m.end())
        return d, _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0)

    # A full weekday name stands alone; a short abbreviation needs a cue word in
    # front of it, so "I sat down" is never read as Saturday.
    full_names = "|".join(n for n in WEEKDAYS if len(n) > 4)
    short_names = "|".join(n for n in WEEKDAYS if len(n) <= 4)
    cue = r"(?:this\s+|next\s+|coming\s+|on\s+|by\s+|before\s+)"
    m = (spans.search(rf"\b{cue}?({full_names})\b")
         or spans.search(rf"\b{cue}({short_names})\b"))
    if m:
        target = WEEKDAYS[m.group(1).lower()]
        wants_next = bool(re.search(r"\bnext\b", m.group(0), re.I))
        if wants_next:
            # "next friday" is the Friday of the following week.
            next_monday = today + datetime.timedelta(days=(7 - today.weekday()) or 7)
            d = next_monday + datetime.timedelta(days=target)
        else:
            d = today + datetime.timedelta(days=(target - today.weekday()) % 7)
        spans.claim(m.start(), m.end())
        return d, _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0).strip()

    m = spans.search(r"\bnext\s+(week|month)\b")
    if m:
        if m.group(1).lower() == "week":
            d = today + datetime.timedelta(days=(7 - today.weekday()) % 7 or 7)
        else:
            d = _add_months(today, 1)
        spans.claim(m.start(), m.end())
        return d, _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0)

    m = spans.search(r"\b(?:end\s+of\s+(?:the\s+)?month|eom)\b")
    if m:
        d = today.replace(day=calendar.monthrange(today.year, today.month)[1])
        spans.claim(m.start(), m.end())
        return d, True, m.group(0)

    m = spans.search(r"\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b")
    if m:
        day = int(m.group(1))
        year, month = today.year, today.month
        if day < today.day:
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        day = min(day, calendar.monthrange(year, month)[1])
        spans.claim(m.start(), m.end())
        return datetime.date(year, month, day), _preceded_by_deadline(segment, m.start(), m.group(0)), m.group(0)

    return None


def _add_months(d: datetime.date, months: int) -> datetime.date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    return datetime.date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


# ----------------------------------------------------------------------------
# Other attributes
# ----------------------------------------------------------------------------

def _extract_repeat(spans: _Spans, now: datetime.datetime) -> Optional[Tuple[str, str]]:
    weekday_names = "|".join(WEEKDAYS)

    m = spans.search(rf"\bevery\s+((?:{weekday_names})(?:\s*(?:,|and|&)\s*(?:{weekday_names}))*)\b")
    if m:
        days = re.findall(rf"\b({weekday_names})\b", m.group(1), re.I)
        short = sorted({d.lower()[:3] for d in days}, key=lambda d: WEEKDAYS[d])
        spans.claim(m.start(), m.end())
        return f"weekly:{','.join(short)}", m.group(0)

    m = spans.search(r"\bevery\s+(\d{1,3})\s*(day|days|week|weeks)\b")
    if m:
        qty, unit = int(m.group(1)), m.group(2).lower()
        spans.claim(m.start(), m.end())
        return (f"custom:{qty}d" if unit.startswith("day") else f"custom:{qty}w"), m.group(0)

    m = spans.search(r"\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(?:every|each)\s+month\b")
    if m:
        spans.claim(m.start(), m.end())
        return f"monthly:{min(int(m.group(1)), 28)}", m.group(0)

    m = spans.search(r"\b(?:every\s+month|monthly)(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?\b")
    if m:
        # Without an explicit day the caller resolves it from the parsed date.
        day = int(m.group(1)) if m.group(1) else 0
        spans.claim(m.start(), m.end())
        return f"monthly:{min(day, 28)}", m.group(0)

    m = spans.search(r"\b(?:every\s+(?:week\s?day|working\s+day)|on\s+weekdays|every\s+weekday)s?\b")
    if m:
        spans.claim(m.start(), m.end())
        return "weekdays", m.group(0)

    m = spans.search(r"\b(?:every\s*day|everyday|daily)\b")
    if m:
        spans.claim(m.start(), m.end())
        return "daily", m.group(0)

    m = spans.search(r"\b(?:every\s+week|weekly)\b")
    if m:
        short = next(n for n, idx in WEEKDAYS.items() if idx == now.weekday() and len(n) == 3)
        spans.claim(m.start(), m.end())
        return f"weekly:{short}", m.group(0)

    return None


def _extract_duration(spans: _Spans) -> Optional[Tuple[int, str]]:
    m = spans.search(r"~\s*(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hours)\b")
    if m:
        qty = int(m.group(1))
        minutes = qty * 60 if m.group(2).lower().startswith("h") else qty
        spans.claim(m.start(), m.end())
        return minutes, m.group(0)

    m = spans.search(r"\bfor\s+(?:about\s+|around\s+)?(half\s+an\s+hour|an\s+hour|a\s+couple\s+of\s+hours)\b")
    if m:
        qty_raw = m.group(1).lower()
        minutes = 30 if qty_raw.startswith("half") else (60 if qty_raw == "an hour" else 120)
        spans.claim(m.start(), m.end())
        return minutes, m.group(0)

    m = spans.search(r"\bfor\s+(?:about\s+|around\s+)?(\d{1,3})\s*"
                     r"(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b")
    if m:
        qty = int(m.group(1))
        minutes = qty * 60 if m.group(2).lower().startswith("h") else qty
        spans.claim(m.start(), m.end())
        return minutes, m.group(0)

    m = spans.search(r"\b(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\s+(?:task|job|call|meeting|session|block)\b")
    if m:
        qty = int(m.group(1))
        minutes = qty * 60 if m.group(2).lower().startswith("h") else qty
        spans.claim(m.start(), m.end())
        return minutes, m.group(0)

    return None


def _extract_priority(spans: _Spans) -> Optional[Tuple[str, str]]:
    m = spans.search(r"(?:^|\s)(!(?:urgent|high|med|medium|low)|\bp[1-4]\b)(?=\s|$|[.,])")
    if m:
        tag = m.group(1).lower().lstrip("!")
        mapping = {"urgent": "urgent", "p1": "urgent", "high": "high", "p2": "high",
                   "med": "medium", "medium": "medium", "p3": "medium",
                   "low": "low", "p4": "low"}
        spans.claim(m.start(1), m.end(1))
        return mapping.get(tag, "medium"), m.group(1)

    found: Optional[Tuple[str, str]] = None
    for level, words in (("urgent", URGENT_WORDS), ("high", HIGH_WORDS), ("low", LOW_WORDS)):
        for word in words:
            while True:
                m = spans.search(r"\b" + re.escape(word.strip()) + r"\b")
                if not m:
                    break
                spans.claim(m.start(), m.end())
                if found is None:
                    found = (level, m.group(0))
    return found


def _extract_tags(spans: _Spans) -> List[str]:
    tags: List[str] = []
    for m in list(re.finditer(r"(?:^|\s)(@([a-z0-9_-]+))\b", spans.text, re.I)):
        if spans.is_free(m.start(1), m.end(1)):
            tags.append(f"@{m.group(2).lower()}")
            spans.claim(m.start(1), m.end(1))
    return tags


def _extract_project(spans: _Spans, projects: Sequence[Dict[str, Any]]):
    m = spans.search(r"(?:^|\s)(#([a-z0-9_-]+))\b")
    if m:
        query = m.group(2).lower().replace("_", "").replace("-", "")
        spans.claim(m.start(1), m.end(1))
        for project in projects:
            name = str(project.get("name", "")).lower().replace(" ", "").replace("_", "").replace("-", "")
            if name and (name.startswith(query) or query.startswith(name) or query in name):
                return project.get("id"), project.get("name"), m.group(1)
        return None, m.group(2), m.group(1)

    for project in projects:
        name = str(project.get("name", "")).strip()
        if len(name) < 3:
            continue
        m = spans.search(rf"\b{re.escape(name)}\b")
        if m:
            spans.claim(m.start(), m.end())
            return project.get("id"), name, m.group(0)
    return None, None, None


def _extract_expense(spans: _Spans) -> Optional[Tuple[Dict[str, Any], str]]:
    """
    Money, and only money. A number that is a clock time is never an amount, so
    every pattern requires an explicit currency marker or a spending verb.
    """
    patterns = (
        r"(?:rs\.?|inr|₹|\$|usd)\s*(\d[\d,]*(?:\.\d{1,2})?)",
        r"(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rs\.?|inr|rupees|rupee|bucks|dollars?)\b",
        r"\b(?:paid|pay|spent|spend|costs?|bought|charged)\s+(?:rs\.?|inr|₹|\$)?\s*(\d[\d,]*(?:\.\d{1,2})?)\b",
    )
    for pattern in patterns:
        m = spans.search(pattern)
        if not m:
            continue
        # Reject anything that is really a time of day.
        tail = spans.text[m.end():m.end() + 12].lower()
        if re.match(r"\s*(am|pm|o'?clock|hrs|hours|mins|minutes)\b", tail):
            continue
        try:
            amount = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        if amount <= 0:
            continue
        spans.claim(m.start(), m.end())
        return {"amount": amount, "payment_mode": _payment_mode(spans), "category": None}, m.group(0)

    # A bare number is an amount only when the segment is plainly about money.
    lowered = spans.text.lower()
    if any(re.search(rf"\b{noun}\b", lowered) for noun in MONEY_NOUNS):
        m = spans.search(r"\b(\d{3,9})\b")
        if m:
            tail = spans.text[m.end():m.end() + 12].lower()
            if not re.match(r"\s*(am|pm|o'?clock|hrs|hours|mins|minutes)\b", tail):
                spans.claim(m.start(), m.end())
                return ({"amount": float(m.group(1)), "payment_mode": _payment_mode(spans),
                         "category": None}, m.group(0))
    return None


def _payment_mode(spans: _Spans) -> str:
    """Reads the payment method out of the segment and consumes the phrase."""
    for word, resolved in PAYMENT_MODE_WORDS:
        m = spans.search(r"(?:\b(?:via|by|through|using|on)\s+)?\b" + re.escape(word) + r"\b")
        if m:
            spans.claim(m.start(), m.end())
            return resolved
    return "upi"


def _classify(segment: str, has_time: bool, has_date: bool, is_deadline: bool) -> str:
    lowered = segment.lower()
    if any(lead in lowered for lead in REMINDER_LEADS):
        return "reminder"
    if is_deadline and has_time:
        # "leave office by 6.30pm" is a nudge, not an appointment. "submit the
        # form by friday" has no moment to nudge at, so it stays a task.
        return "reminder"

    words = set(re.findall(r"[a-z']+", lowered))
    # Arranging an occasion is a task; the occasion itself is the event.
    first_verbs = [w for w in re.findall(r"[a-z']+", lowered)[:2] if w in TASK_VERBS]
    if first_verbs:
        return "task"
    if words & STRONG_EVENT_WORDS:
        return "event"
    if (words & EVENT_WORDS or any(p in lowered for p in EVENT_PHRASES)) and (has_time or has_date):
        return "event"
    return "task"


def _infer_energy(segment: str) -> str:
    lowered = segment.lower()
    if any(w in lowered for w in HIGH_ENERGY_WORDS):
        return "high"
    if any(w in lowered for w in LOW_ENERGY_WORDS):
        return "low"
    return "medium"


def _infer_tags(segment: str) -> List[str]:
    lowered = segment.lower()
    found = []
    for keyword, tag in CONTEXT_KEYWORDS.items():
        if re.search(rf"\b{keyword}\b", lowered) and tag not in found:
            found.append(tag)
    return found[:2]


def _clean_title(remainder: str, original: str) -> str:
    title = re.sub(r"\s+", " ", remainder).strip(" ,.-;:")
    lowered = title.lower()

    # Drop a leading connector left behind by segmentation.
    lowered_stripped = re.sub(r"^(?:so|and|then|also|plus|but|that)\s+", "", lowered)
    if lowered_stripped != lowered:
        title = title[len(title) - len(title.lstrip()) + (len(lowered) - len(lowered_stripped)):]
        lowered = title.lower()

    for filler in TITLE_FILLERS:
        if lowered.startswith(filler + " "):
            title = title[len(filler):].strip()
            lowered = title.lower()
            break

    # Prepositions orphaned when the thing they pointed at was consumed.
    orphan = r"\s*\b(at|by|on|in|for|to|from|of|until|till|before|after|around|every|next|this|via|the)\b[\s,.-]*$"
    while True:
        stripped = re.sub(orphan, "", title, flags=re.I).strip(" ,.-;:")
        if stripped == title:
            break
        title = stripped
    title = re.sub(r"\s{2,}", " ", title).strip(" ,.-;:")

    if not title:
        title = re.sub(r"\s+", " ", original).strip(" ,.-;:")
    if not title:
        return "Untitled item"
    return title[0].upper() + title[1:]


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------

def _matches_rule(day: datetime.date, rule: str) -> bool:
    if rule == "daily" or rule.startswith("custom:") or rule.startswith("monthly:"):
        return True
    if rule == "weekdays":
        return day.weekday() < 5
    if rule.startswith("weekly:"):
        wanted = {WEEKDAYS[d] for d in rule.split(":", 1)[1].split(",") if d in WEEKDAYS}
        return not wanted or day.weekday() in wanted
    return True


def _advance_to_rule(day: datetime.date, rule: str) -> datetime.date:
    """Move a first occurrence forward to the next day the rule allows."""
    for _ in range(14):
        if _matches_rule(day, rule):
            return day
        day += datetime.timedelta(days=1)
    return day


def parse_segment(segment: str, now: Optional[datetime.datetime] = None,
                  projects: Optional[Sequence[Dict[str, Any]]] = None) -> CapturedItem:
    """Turn a single clause into one work item."""
    now = now or datetime.datetime.now()
    projects = projects or []
    spans = _Spans(segment)
    tokens: List[Dict[str, str]] = []

    repeat = _extract_repeat(spans, now)
    if repeat:
        tokens.append({"type": "repeat", "text": repeat[1], "display": repeat[0]})

    project_id, project_name, project_text = _extract_project(spans, projects)
    if project_text:
        tokens.append({"type": "project", "text": project_text, "display": project_name or project_text})

    tags = _extract_tags(spans)

    duration = _extract_duration(spans)
    if duration:
        tokens.append({"type": "estimate", "text": duration[1], "display": f"{duration[0]}m"})

    expense = _extract_expense(spans)
    if expense:
        tokens.append({"type": "expense", "text": expense[1], "display": f"{expense[0]['amount']:g}"})

    date_hit = _extract_date(spans, now)
    if date_hit:
        tokens.append({"type": "date", "text": date_hit[2], "display": date_hit[0].isoformat()})

    time_hit = _extract_time(spans, now, date_is_explicit=date_hit is not None)
    if time_hit:
        tokens.append({"type": "time", "text": time_hit[5], "display": f"{time_hit[0]:02d}:{time_hit[1]:02d}"})

    priority_hit = _extract_priority(spans)
    if priority_hit:
        tokens.append({"type": "priority", "text": priority_hit[1], "display": priority_hit[0]})

    title = _clean_title(spans.remainder(), segment)

    is_deadline = bool(date_hit and date_hit[1]) or bool(time_hit and time_hit[3])
    entity_type = _classify(
        segment,
        has_time=time_hit is not None,
        has_date=date_hit is not None,
        is_deadline=is_deadline,
    )

    # Resolve the moment this item happens.
    due_date: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    remind_at: Optional[str] = None
    ambiguous = bool(time_hit and time_hit[4])

    day = date_hit[0] if date_hit else None
    if time_hit:
        hour, minute = time_hit[0], time_hit[1]
        if day is None:
            day = now.date()
            moment = datetime.datetime.combine(day, datetime.time(hour % 24, minute))
            if moment < now:
                day = day + datetime.timedelta(days=1)
        moment = datetime.datetime.combine(day, datetime.time(hour % 24, minute))
        due_date = day.isoformat()
        if entity_type == "event" and not is_deadline:
            start_at = moment.isoformat()
            if time_hit[2]:
                end_at = datetime.datetime.combine(
                    day, datetime.time(time_hit[2][0] % 24, time_hit[2][1])
                ).isoformat()
            remind_at = (moment - datetime.timedelta(minutes=DEFAULT_EVENT_LEAD_MINUTES)).isoformat()
        else:
            start_at = moment.isoformat()
            remind_at = moment.isoformat()
    elif day is not None:
        due_date = day.isoformat()
        if entity_type == "reminder":
            remind_at = datetime.datetime.combine(day, datetime.time(9, 0)).isoformat()

    # A recurring item must first land on a day its own rule allows: a weekday
    # standup rolled past Friday belongs on Monday, not Saturday.
    if repeat and due_date:
        aligned = _advance_to_rule(datetime.date.fromisoformat(due_date), repeat[0])
        if aligned.isoformat() != due_date:
            shift = aligned - datetime.date.fromisoformat(due_date)
            due_date = aligned.isoformat()
            for attr in ("start_at", "end_at", "remind_at"):
                value = locals().get(attr)
                if value:
                    moved = datetime.datetime.fromisoformat(value) + shift
                    if attr == "start_at":
                        start_at = moved.isoformat()
                    elif attr == "end_at":
                        end_at = moved.isoformat()
                    else:
                        remind_at = moved.isoformat()

    repeat_rule = repeat[0] if repeat else None
    if repeat_rule and not due_date:
        first = now.date()
        if repeat_rule.startswith("monthly:"):
            target_day = int(repeat_rule.split(":", 1)[1]) or now.day
            year, month = first.year, first.month
            if target_day < first.day:
                year, month = (year + 1, 1) if month == 12 else (year, month + 1)
            first = datetime.date(year, month, min(target_day, calendar.monthrange(year, month)[1]))
        else:
            first = _advance_to_rule(first, repeat_rule)
        due_date = first.isoformat()

    if repeat_rule == "monthly:0":
        anchor = datetime.date.fromisoformat(due_date).day if due_date else now.day
        repeat_rule = f"monthly:{min(anchor, 28)}"

    if duration:
        minutes = duration[0]
    elif end_at and start_at:
        minutes = max(5, int((datetime.datetime.fromisoformat(end_at)
                              - datetime.datetime.fromisoformat(start_at)).total_seconds() // 60))
    else:
        minutes = DEFAULT_EVENT_MINUTES if entity_type == "event" else DEFAULT_TASK_MINUTES

    all_tags = tags + [t for t in _infer_tags(segment) if t not in tags]

    expense_payload = None
    if expense:
        expense_payload = dict(expense[0])
        expense_payload["description"] = title

    return CapturedItem(
        title=title,
        source_text=segment,
        entity_type=entity_type,
        priority=priority_hit[0] if priority_hit else "medium",
        energy=_infer_energy(segment),
        due_date=due_date,
        start_at=start_at,
        end_at=end_at,
        remind_at=remind_at,
        repeat_rule=repeat_rule,
        estimated_minutes=minutes,
        context_tags=" ".join(all_tags),
        project_id=project_id,
        project_name=project_name,
        expense=expense_payload,
        tokens=tokens,
        time_is_ambiguous=ambiguous,
    )


def parse_capture(text: str, now: Optional[datetime.datetime] = None,
                  projects: Optional[Sequence[Dict[str, Any]]] = None) -> CaptureResult:
    """
    Parse a whole capture box into the items it describes.

    >>> res = parse_capture("going out with cousins at 7.30pm so leave office by 6.30pm")
    >>> [i.entity_type for i in res.items]
    ['event', 'reminder']
    """
    now = now or datetime.datetime.now()
    raw = (text or "").strip()
    if not raw:
        return CaptureResult(items=[], raw_text=text or "")

    items = [parse_segment(segment, now, projects) for segment in split_segments(raw)]
    items = [i for i in items if i.title and i.title != "Untitled item"] or items
    kept = [i for i in items if not _is_dangling_verb(i)]
    return CaptureResult(items=dedupe_items(kept or items), raw_text=raw)


def _is_dangling_verb(item: "CapturedItem") -> bool:
    """
    A leftover verb that carries nothing of its own.

    "going out with cousins at 7.30 so finish and leave office by 6.30pm"
    splits on "and", which strands "finish" as its own segment. On its own it
    is a word, not a thing to do, and a task called "Finish" is noise in the
    list. A single verb that claimed no date, time, money or recurrence is
    that case; anything with an object or a schedule is kept.
    """
    words = re.findall(r"[a-z]+", item.title.lower())
    if len(words) != 1:
        return False
    if item.due_date or item.start_at or item.end_at or item.remind_at:
        return False
    if item.expense or item.repeat_rule:
        return False
    return words[0] in ACTION_VERBS or words[0] in TASK_VERBS


def item_signature(item: "CapturedItem") -> tuple:
    """
    What makes two captured items the same thing.

    The same words at the same moment are one item, however many readings of
    the note produced them. Two items that share a title but sit at different
    times ("call mum at 5 and again at 8") are not the same thing and both
    survive.
    """
    title = re.sub(r"\s+", " ", (item.title or "").strip().lower())
    return (title, item.entity_type, item.due_date, item.start_at, item.remind_at)


def dedupe_items(items: Sequence["CapturedItem"]) -> List["CapturedItem"]:
    """Drop repeats, keeping the first reading of each."""
    seen = set()
    unique: List[CapturedItem] = []
    for item in items:
        signature = item_signature(item)
        if signature in seen:
            continue
        seen.add(signature)
        unique.append(item)
    return unique
