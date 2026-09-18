"""
The local model's reading of a capture.

Ollama (qwen2.5:1.5b on the Pi) is what actually understands the sentence: it
decides how many things were said, what each one is called, and whether each is
a task, an event or a reminder. That is what a language model is good at, and
it handles phrasing no rule set will ever cover.

What it is not good at, at 1.5B parameters, is arithmetic on dates. Asked for
"7.30pm tomorrow" it will cheerfully return last year, or 07:30, or a date that
does not exist. So every scheduling field it returns is checked here against
`capture_engine`'s deterministic reading of the same words, and anything that
does not hold up is replaced by the parsed value. The model leads; the parser
keeps it honest.

If Ollama is stopped, slow, or returns nonsense, `understand()` falls through to
the deterministic parse and the feature keeps working exactly as before.
"""

import datetime
import re
from typing import Any, Dict, List, Optional, Sequence

import httpx

from .ai_engine import OLLAMA_HOST, OLLAMA_MODEL, safe_parse_json
from .capture_engine import CapturedItem, parse_capture, split_segments

# A Pi 5 running qwen2.5:1.5b answers a short extraction in a few seconds. The
# user has pressed a button and is waiting, so this is a real budget, not a
# background one.
DEFAULT_TIMEOUT_SECONDS = 20.0

VALID_ENTITY_TYPES = {"task", "event", "reminder"}
VALID_PRIORITIES = {"low", "medium", "high", "urgent"}
VALID_ENERGY = {"low", "medium", "high"}
VALID_PAYMENT_MODES = {"upi", "debit_card", "cash", "net_banking", "credit_card"}

# How far outside today a model-supplied date may land before it is treated as
# a hallucination rather than an instruction.
MAX_PAST_DAYS = 1
MAX_FUTURE_DAYS = 730

REPEAT_RULE_PATTERN = re.compile(
    r"^(daily|weekdays|weekly:[a-z,]+|monthly:\d{1,2}|custom:\d{1,3}[dw])$"
)


def build_prompt(text: str, now: datetime.datetime, projects: Sequence[Dict[str, Any]]) -> str:
    """The extraction prompt. Deliberately short -- a 1.5B model loses the plot in a long one."""
    today = now.strftime("%Y-%m-%d")
    weekday = now.strftime("%A")
    tomorrow = (now + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    project_names = ", ".join(str(p.get("name", "")) for p in projects if p.get("name")) or "none"

    return f"""You turn a person's note into the items it describes for a task manager.

Right now it is {now.strftime("%H:%M")} on {weekday} {today}. Tomorrow is {tomorrow}.
Known projects: {project_names}

Read the note and output every separate thing the person has to do.
One note often describes more than one item. "Going out with cousins at 7.30pm
so leave office by 6.30pm" is TWO items: the outing at 19:30, and leaving the
office at 18:30.

Rules:
- "type" is "event" for something that happens at a time (meeting, dinner,
  party, appointment, flight), "reminder" for a nudge or a deadline
  ("remind me", "by 6.30pm", "don't forget"), otherwise "task".
- "title" is short and plain, in the person's own words. No dates or times in
  the title. Do not invent detail that is not in the note.
- Times are 24-hour. "7.30pm" is 19:30. Dates are YYYY-MM-DD.
- "amount" is money only. A clock time is never money: "at 11.30 am" has no
  amount. Use null when no money is mentioned.
- Use null for anything the note does not say. Never guess.

Note: "{text}"

Respond with JSON only:
{{"items": [{{
  "title": "short title",
  "type": "task",
  "priority": "low|medium|high|urgent",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM or null",
  "end_time": "HH:MM or null",
  "is_deadline": false,
  "repeat": "daily|weekdays|weekly:mon,fri|monthly:5|null",
  "minutes": 30,
  "project": "project name or null",
  "tags": ["@context"],
  "amount": null,
  "payment_mode": "upi|cash|debit_card|credit_card|net_banking or null"
}}]}}"""


async def extract_with_ollama(
    text: str,
    now: datetime.datetime,
    projects: Sequence[Dict[str, Any]],
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> Optional[List[Dict[str, Any]]]:
    """Ask the local model to read the note. Returns None whenever it cannot help."""
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": build_prompt(text, now, projects),
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.0, "num_predict": 700},
                },
            )
        if resp.status_code != 200:
            return None
        data = safe_parse_json(resp.json().get("response", ""))
    except Exception:
        return None

    if isinstance(data, dict):
        items = data.get("items")
    elif isinstance(data, list):
        items = data
    else:
        return None

    if not isinstance(items, list):
        return None
    items = [i for i in items if isinstance(i, dict) and str(i.get("title", "")).strip()]
    return items or None


# ----------------------------------------------------------------------------
# Checking the model's work
# ----------------------------------------------------------------------------

def _coerce_date(value: Any, now: datetime.datetime) -> Optional[datetime.date]:
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", value)
    if not match:
        return None
    try:
        day = datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None
    delta = (day - now.date()).days
    # A 1.5B model reaches for last year's dates surprisingly often.
    if delta < -MAX_PAST_DAYS or delta > MAX_FUTURE_DAYS:
        return None
    return day


def _coerce_time(value: Any) -> Optional[datetime.time]:
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d{1,2})[:.](\d{2})", value)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return datetime.time(hour, minute)


def _pick_baseline(ai_item: Dict[str, Any], baseline: List[CapturedItem], index: int) -> Optional[CapturedItem]:
    """
    Find the deterministic reading of the same fragment.

    Matched on shared words first, because the model reorders and renames; by
    position only as a last resort.
    """
    if not baseline:
        return None
    title_words = set(re.findall(r"[a-z]{3,}", str(ai_item.get("title", "")).lower()))
    best, best_score = None, 0
    for candidate in baseline:
        source_words = set(re.findall(r"[a-z]{3,}", candidate.source_text.lower()))
        score = len(title_words & source_words)
        if score > best_score:
            best, best_score = candidate, score
    if best is not None and best_score > 0:
        return best
    if index < len(baseline):
        return baseline[index]
    return baseline[0]


def reconcile(
    ai_items: List[Dict[str, Any]],
    baseline: List[CapturedItem],
    now: datetime.datetime,
) -> List[CapturedItem]:
    """
    Build the final items: the model's reading, with every scheduling field
    verified against the parser and replaced where it does not hold up.
    """
    results: List[CapturedItem] = []

    for index, ai_item in enumerate(ai_items):
        fallback = _pick_baseline(ai_item, baseline, index)
        base = fallback or CapturedItem(title="", source_text="")

        title = str(ai_item.get("title", "")).strip() or base.title
        if not title:
            continue

        entity_type = str(ai_item.get("type", "")).strip().lower()
        if entity_type not in VALID_ENTITY_TYPES:
            entity_type = base.entity_type

        priority = str(ai_item.get("priority", "")).strip().lower()
        if priority not in VALID_PRIORITIES:
            priority = base.priority

        energy = str(ai_item.get("energy", "")).strip().lower()
        if energy not in VALID_ENERGY:
            energy = base.energy

        repeat_rule = ai_item.get("repeat")
        if isinstance(repeat_rule, str):
            repeat_rule = repeat_rule.strip().lower()
        if not (isinstance(repeat_rule, str) and REPEAT_RULE_PATTERN.match(repeat_rule)):
            repeat_rule = base.repeat_rule

        # --- scheduling: the model proposes, the parser disposes -------------
        day = _coerce_date(ai_item.get("date"), now)
        clock = _coerce_time(ai_item.get("time"))
        end_clock = _coerce_time(ai_item.get("end_time"))

        if day is None and base.due_date:
            day = datetime.date.fromisoformat(base.due_date)
        if clock is None and base.start_at:
            clock = datetime.datetime.fromisoformat(base.start_at).time()
        # The model dropped a time the parser is sure about, or invented one the
        # parser never saw in the text: trust the text.
        if clock is not None and base.start_at is None and base.due_date is None and not _text_has_time(base.source_text):
            clock = None

        is_deadline = bool(ai_item.get("is_deadline")) or entity_type == "reminder"

        due_date = day.isoformat() if day else None
        start_at = end_at = remind_at = None
        if day and clock:
            moment = datetime.datetime.combine(day, clock)
            start_at = moment.isoformat()
            if entity_type == "event" and not is_deadline:
                remind_at = (moment - datetime.timedelta(minutes=15)).isoformat()
                if end_clock:
                    end_at = datetime.datetime.combine(day, end_clock).isoformat()
            else:
                remind_at = moment.isoformat()
        elif day and entity_type == "reminder":
            remind_at = datetime.datetime.combine(day, datetime.time(9, 0)).isoformat()

        # Nothing survived from the model; keep the parser's schedule wholesale.
        if due_date is None and base.due_date:
            due_date, start_at = base.due_date, base.start_at
            end_at, remind_at = base.end_at, base.remind_at

        minutes = ai_item.get("minutes")
        if not isinstance(minutes, int) or not 1 <= minutes <= 1440:
            minutes = base.estimated_minutes

        tags = ai_item.get("tags")
        if isinstance(tags, list):
            cleaned = [f"@{str(t).lstrip('@').strip().lower()}" for t in tags if str(t).strip()]
            context_tags = " ".join(dict.fromkeys(cleaned)) or base.context_tags
        else:
            context_tags = base.context_tags

        results.append(CapturedItem(
            title=title,
            source_text=base.source_text or title,
            entity_type=entity_type,
            priority=priority,
            energy=energy,
            due_date=due_date,
            start_at=start_at,
            end_at=end_at,
            remind_at=remind_at,
            repeat_rule=repeat_rule,
            estimated_minutes=minutes,
            context_tags=context_tags,
            project_id=base.project_id,
            project_name=base.project_name or _project_or_none(ai_item.get("project")),
            expense=_reconcile_expense(ai_item, base, title),
            tokens=base.tokens,
            time_is_ambiguous=base.time_is_ambiguous,
        ))

    return results or baseline


def _text_has_time(text: str) -> bool:
    return bool(re.search(r"\d{1,2}\s*(?::|\.)?\d{0,2}\s*(am|pm)|\b\d{1,2}:\d{2}\b|"
                          r"\b(noon|midnight|morning|afternoon|evening|tonight)\b", text, re.I))


def _project_or_none(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip() and value.strip().lower() != "null":
        return value.strip()
    return None


def _reconcile_expense(ai_item: Dict[str, Any], base: CapturedItem, title: str) -> Optional[Dict[str, Any]]:
    """
    Money is only ever accepted when the words actually contain money.

    This is the guard that stops "at 11.30 am" becoming a spend of 11.30 -- a
    mistake this model made often enough that the previous engine carried a
    hand-written patch for it.
    """
    if not base.expense:
        return None
    amount = ai_item.get("amount")
    if not isinstance(amount, (int, float)) or amount <= 0:
        return dict(base.expense)

    resolved = dict(base.expense)
    # Believe the model's figure only if it agrees with the one in the text.
    if abs(float(amount) - float(base.expense.get("amount", 0))) > 0.01:
        return resolved
    mode = ai_item.get("payment_mode")
    if isinstance(mode, str) and mode.strip().lower() in VALID_PAYMENT_MODES:
        resolved["payment_mode"] = mode.strip().lower()
    resolved["description"] = title
    return resolved


# ----------------------------------------------------------------------------
# Public entry point
# ----------------------------------------------------------------------------

async def understand(
    text: str,
    now: Optional[datetime.datetime] = None,
    projects: Optional[Sequence[Dict[str, Any]]] = None,
    use_ai: bool = True,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> List[CapturedItem]:
    """
    Read a capture with the local model, checked against the deterministic parse.

    Set use_ai=False for the hints shown while someone is still typing, where
    the answer has to be instant.
    """
    now = now or datetime.datetime.now()
    projects = list(projects or [])
    baseline = parse_capture(text, now=now, projects=projects).items
    if not use_ai or not baseline:
        return baseline

    ai_items = await extract_with_ollama(text, now, projects, timeout_seconds)
    if not ai_items:
        return baseline

    # A model that returns one item for a note the parser clearly split into
    # several has missed something; keep the richer reading.
    if len(ai_items) < len(baseline) and len(split_segments(text)) > len(ai_items):
        return baseline

    return reconcile(ai_items, baseline, now)
