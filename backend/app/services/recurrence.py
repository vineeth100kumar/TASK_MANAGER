"""
When a repeating thing comes round again.

The rule is a short string on the item rather than a full RFC 5545 RRULE,
because everything Sage needs to say fits in one line and a calendar-grade
recurrence library is a dependency the Pi does not need to carry.

Every rule may take an interval, so the same four shapes cover "every day",
"every other Tuesday" and "the third Friday of every month" without a fifth
kind of rule.
"""

import calendar
import datetime
from typing import List, Optional, Tuple

NAME_TO_WEEKDAY = {
    "mon": 0, "monday": 0,
    "tue": 1, "tuesday": 1,
    "wed": 2, "wednesday": 2,
    "thu": 3, "thursday": 3,
    "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5,
    "sun": 6, "sunday": 6,
}

WEEKDAY_TO_NAME = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

ORDINALS = {"1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "last": -1}


def _split_interval(body: str) -> Tuple[int, str]:
    """
    Pull a leading interval off a rule body: "2:mon,wed" -> (2, "mon,wed").

    Without one the interval is 1, which is what every rule written before
    intervals existed means. That is what keeps the old strings working.
    """
    if ":" in body:
        head, rest = body.split(":", 1)
        if head.strip().isdigit():
            return max(1, int(head.strip())), rest
    return 1, body


def _weekdays_in(body: str) -> List[int]:
    days = [NAME_TO_WEEKDAY[d.strip()] for d in body.split(",") if d.strip() in NAME_TO_WEEKDAY]
    return sorted(set(days))


def _nth_weekday_of_month(year: int, month: int, weekday: int, nth: int) -> Optional[datetime.date]:
    """The nth given weekday of a month; nth of -1 means the last one."""
    first_weekday, days_in_month = calendar.monthrange(year, month)
    first_of_kind = 1 + (weekday - first_weekday) % 7
    all_of_kind = list(range(first_of_kind, days_in_month + 1, 7))
    if not all_of_kind:
        return None
    if nth == -1:
        return datetime.date(year, month, all_of_kind[-1])
    if nth > len(all_of_kind):
        # "the 5th Friday" of a month that has four is the last one, not a
        # skipped month: a rule that silently produces nothing is worse than
        # one that lands a week early.
        return datetime.date(year, month, all_of_kind[-1])
    return datetime.date(year, month, all_of_kind[nth - 1])


def _add_months(year: int, month: int, count: int) -> Tuple[int, int]:
    total = (year * 12 + (month - 1)) + count
    return total // 12, total % 12 + 1


def calculate_next_occurrence(
    repeat_rule: str,
    base_date: Optional[datetime.datetime] = None,
) -> Optional[datetime.datetime]:
    """
    The next moment a rule fires after `base_date`, keeping its time of day.

    Rule syntax, all of which may carry an interval:
      - 'daily'                every day
      - 'daily:3'              every third day
      - 'weekdays'             Monday to Friday
      - 'weekly:mon,wed,fri'   those days, every week
      - 'weekly:2:tue'         every other Tuesday
      - 'monthly:1'            the 1st of each month
      - 'monthly:3:15'         the 15th, every third month
      - 'monthly:3rd-tue'      the third Tuesday of each month
      - 'monthly:last-fri'     the last Friday of each month
      - 'yearly'               the same date next year
      - 'custom:14d' / 'custom:2w'
    """
    if not repeat_rule:
        return None

    rule = repeat_rule.strip().lower()
    now = base_date or datetime.datetime.now()
    clock = now.time()

    def at_clock(d: datetime.date) -> datetime.datetime:
        return datetime.datetime.combine(d, clock)

    # --- daily ---
    if rule == "daily" or rule.startswith("daily:"):
        step = 1
        if rule.startswith("daily:"):
            body = rule.split("daily:", 1)[1].strip()
            if body.isdigit():
                step = max(1, int(body))
        return now + datetime.timedelta(days=step)

    # --- weekdays ---
    if rule == "weekdays":
        candidate = now + datetime.timedelta(days=1)
        while candidate.weekday() >= 5:
            candidate += datetime.timedelta(days=1)
        return candidate

    # --- weekly ---
    if rule.startswith("weekly:"):
        interval, body = _split_interval(rule.split("weekly:", 1)[1])
        target_days = _weekdays_in(body)
        if not target_days:
            return now + datetime.timedelta(weeks=interval)

        # A listed day still to come in the current week is the next one,
        # whatever the interval: the base date is itself an occurrence, so the
        # week it sits in is an "on" week.
        for weekday in target_days:
            if weekday > now.weekday():
                return now + datetime.timedelta(days=weekday - now.weekday())

        # Otherwise the week is spent. Step whole weeks from the Monday of
        # this one, so "every other Tuesday" skips a week rather than landing
        # on the next Tuesday seven days later.
        this_monday = now - datetime.timedelta(days=now.weekday())
        target_monday = this_monday + datetime.timedelta(weeks=interval)
        return target_monday + datetime.timedelta(days=target_days[0])

    # --- monthly ---
    if rule.startswith("monthly:"):
        interval, body = _split_interval(rule.split("monthly:", 1)[1])
        body = body.strip()

        # "3rd-tue", "last-fri"
        if "-" in body:
            ordinal_name, _, day_name = body.partition("-")
            nth = ORDINALS.get(ordinal_name.strip())
            weekday = NAME_TO_WEEKDAY.get(day_name.strip())
            if nth is not None and weekday is not None:
                # This month's occurrence first, in case it is still ahead.
                this_month = _nth_weekday_of_month(now.year, now.month, weekday, nth)
                if interval == 1 and this_month and this_month > now.date():
                    return at_clock(this_month)
                year, month = _add_months(now.year, now.month, interval)
                found = _nth_weekday_of_month(year, month, weekday, nth)
                if found:
                    return at_clock(found)
            return now + datetime.timedelta(days=30)

        # "15" — a day of the month
        if body.isdigit():
            target_day = int(body)
            if interval == 1:
                _, days_this_month = calendar.monthrange(now.year, now.month)
                if target_day > now.day and target_day <= days_this_month:
                    return at_clock(datetime.date(now.year, now.month, target_day))
            year, month = _add_months(now.year, now.month, interval)
            max_days = calendar.monthrange(year, month)[1]
            return at_clock(datetime.date(year, month, min(target_day, max_days)))

        return now + datetime.timedelta(days=30)

    # --- yearly ---
    if rule == "yearly" or rule.startswith("yearly:"):
        step = 1
        if rule.startswith("yearly:"):
            body = rule.split("yearly:", 1)[1].strip()
            if body.isdigit():
                step = max(1, int(body))
        year = now.year + step
        # 29 February in a year that has none.
        day = min(now.day, calendar.monthrange(year, now.month)[1])
        return now.replace(year=year, day=day)

    # --- custom: a plain span ---
    if rule.startswith("custom:"):
        val = rule.split("custom:", 1)[1].strip()
        try:
            if val.endswith("d"):
                return now + datetime.timedelta(days=int(val[:-1]))
            if val.endswith("w"):
                return now + datetime.timedelta(weeks=int(val[:-1]))
            if val.endswith("m"):
                year, month = _add_months(now.year, now.month, int(val[:-1]))
                day = min(now.day, calendar.monthrange(year, month)[1])
                return at_clock(datetime.date(year, month, day))
        except (ValueError, TypeError):
            pass

    return now + datetime.timedelta(days=1)


def recurrence_has_ended(
    repeat_until: Optional[str],
    repeat_count: Optional[int],
    repeat_done: Optional[int],
    next_date: Optional[datetime.datetime],
) -> bool:
    """
    Whether a rule has run its course, so no further occurrence should spawn.

    Every rule used to run forever, which meant a task like "take the tablets
    for ten days" had to be deleted by hand to make it stop.
    """
    if next_date is None:
        return True

    if repeat_count is not None and (repeat_done or 0) >= repeat_count:
        return True

    if repeat_until:
        try:
            last_day = datetime.date.fromisoformat(repeat_until[:10])
        except (ValueError, TypeError):
            return False
        if next_date.date() > last_day:
            return True

    return False


def describe_rule(repeat_rule: Optional[str]) -> str:
    """The rule as a person would say it, for the one line the UI shows."""
    if not repeat_rule:
        return "One-time"

    rule = repeat_rule.strip().lower()

    def every(n: int, unit: str) -> str:
        if n == 1:
            return f"Every {unit}"
        if n == 2:
            return f"Every other {unit}"
        return f"Every {n} {unit}s"

    if rule == "daily":
        return "Every day"
    if rule.startswith("daily:"):
        body = rule.split("daily:", 1)[1].strip()
        return every(int(body), "day") if body.isdigit() else "Every day"
    if rule == "weekdays":
        return "Every weekday"
    if rule == "yearly":
        return "Every year"

    if rule.startswith("weekly:"):
        interval, body = _split_interval(rule.split("weekly:", 1)[1])
        days = _weekdays_in(body)
        names = ", ".join(WEEKDAY_TO_NAME[d].capitalize() for d in days) if days else "week"
        if interval == 1:
            return f"Every {names}"
        return f"{every(interval, 'week')} on {names}"

    if rule.startswith("monthly:"):
        interval, body = _split_interval(rule.split("monthly:", 1)[1])
        body = body.strip()
        if "-" in body:
            ordinal_name, _, day_name = body.partition("-")
            weekday = NAME_TO_WEEKDAY.get(day_name.strip())
            day_label = WEEKDAY_TO_NAME[weekday].capitalize() if weekday is not None else day_name
            word = "last" if ordinal_name == "last" else ordinal_name
            base = f"The {word} {day_label} of the month"
            return base if interval == 1 else f"{base}, every {interval} months"
        if body.isdigit():
            base = f"Day {int(body)} of the month"
            return base if interval == 1 else f"{base}, every {interval} months"
        return "Monthly"

    if rule.startswith("custom:"):
        val = rule.split("custom:", 1)[1].strip()
        try:
            if val.endswith("d"):
                return every(int(val[:-1]), "day")
            if val.endswith("w"):
                return every(int(val[:-1]), "week")
            if val.endswith("m"):
                return every(int(val[:-1]), "month")
        except (ValueError, TypeError):
            pass

    return "Repeats"
