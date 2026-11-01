"""Chart slides: every bar, slice and point must be a number copied from a cited quote.

A chart is only as true as its data. The validator checks that each value is a number in a
cited quote (same unit class), that each label sits next to its own value in that quote (so a
bar cannot carry another company's number), that one chart uses one unit, that a pie is a set
of shares of one whole, and that a line chart runs over time. Nothing is derived: no sums,
no "Others" slice.
"""

import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence

from . import ValidationIssue
from .normalize import norm
from .numbers import extract_number_mentions, find_ranges, NumMention

CHART_KINDS = ("bar", "pie", "line")

# Labels that mark a point in time: FY24, FY2025, 2025, Q2 2026, H1 FY25, 2025-26
TIME_LABEL = re.compile(
    r"^(?:(?:q[1-4]|h[12])\s*)?(?:fy\s?\d{2,4}(?:[-–]\d{2,4})?|(?:19|20)\d{2}(?:[-–]\d{2,4})?)$"
    r"|^(?:q[1-4]|h[12])\s+(?:fy\s?)?\d{2,4}$",
    re.I,
)


def series_of(slide: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [s for s in (slide.get("series") or []) if isinstance(s, dict)]


def chart_text(slide: Dict[str, Any]) -> str:
    """The chart's data as slide text ("Noise: 26.6%"), so number/entity checks see it."""
    return "\n".join(f"{s.get('label', '')}: {s.get('value_raw', '')}" for s in series_of(slide))


def first_mention(value_raw: str) -> Optional[NumMention]:
    mentions = extract_number_mentions(value_raw or "")
    return mentions[0] if mentions else None


def unit_class(m: NumMention) -> str:
    return m.cls


def normalize_series(series: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Fill value/unit from value_raw so the drawn bar always matches its printed label."""
    out = []
    for s in series:
        m = first_mention(str(s.get("value_raw", "")))
        item = dict(s)
        if m is not None:
            item["value"] = float(m.value)
            item["unit"] = unit_class(m)
        out.append(item)
    return out


def _label_owning_value(quote_n: str, value_raw_n: str, labels_n: List[str], direction: str = "nearest") -> Optional[str]:
    """The chart label that owns this value in the quote.

    In a table row ("Zebronics: 1,278 | Portronics: 340") a value belongs to the nearest label
    before it; in a sentence ("₹43.50 crore in FY24, ... ₹52.66 crore in FY25") to the nearest
    label on either side, measured between the closest edges, or only on one side when the
    whole sentence reads one way ("before": label then value; "after": "55% chose online").
    """
    v_pos = quote_n.find(value_raw_n)
    if v_pos < 0:
        return None
    v_end = v_pos + len(value_raw_n)
    is_row = " | " in quote_n
    best, best_d = None, None
    for lab in labels_n:
        for m in re.finditer(re.escape(lab), quote_n):
            if m.end() <= v_pos:
                if direction == "after":
                    continue
                d = v_pos - m.end()
            elif is_row or m.start() < v_end or direction == "before":
                continue
            else:
                d = m.start() - v_end
            if best_d is None or d < best_d:
                best, best_d = lab, d
    return best


def _quote_rows(q: str) -> Optional[List[str]]:
    """Header names of a table-row quote ("H: v | H: v"), else None."""
    if " | " not in q:
        return None
    parts = [p.split(":", 1)[0].strip() for p in q.split(" | ") if ":" in p]
    return parts or None


_TOTAL_LABEL = re.compile(r"\+|\b(?:total|subtotal|overall|all-in|incl(?:uding|\.)?)\b", re.I)


def check_chart(slide: Dict[str, Any], cited_quotes: Sequence[str]) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []

    def err(code: str, msg: str, off: Optional[str] = None) -> None:
        issues.append(ValidationIssue(severity="ERROR", code=code, message=msg, offending_text=off))

    kind = slide.get("chart_kind")
    if kind not in CHART_KINDS:
        err("CHART_KIND_INVALID", f"chart_kind must be one of {', '.join(CHART_KINDS)}, got '{kind}'", str(kind))
        return issues
    series = series_of(slide)
    if len(series) < 2 or len(series) > 6:
        err("CHART_SERIES_COUNT", f"chart needs 2 to 6 data points, got {len(series)}", str(len(series)))
        return issues

    quotes_n = [norm(q) for q in cited_quotes]
    labels_n = [norm(str(s.get("label", ""))) for s in series]
    q_mentions = [extract_number_mentions(q) for q in cited_quotes]
    mentions: List[Optional[NumMention]] = []
    source_quote_idx: List[Optional[int]] = []

    def value_in(qi: int, raw: str) -> Optional[str]:
        m = first_mention(raw)
        same = [qm for qm in q_mentions[qi] if m is not None and qm.value == m.value and qm.cls == m.cls]
        return norm(same[0].raw) if same else None

    def reading(qi: int) -> str:
        """The one direction in which every label in this sentence owns its own value, if any."""
        q = quotes_n[qi]
        if " | " in q:
            return "nearest"
        here = [(lab, value_in(qi, str(s.get("value_raw", "")))) for s, lab in zip(series, labels_n)]
        here = [(lab, v) for lab, v in here if lab and lab in q and v]
        for direction in ("before", "after"):
            if len(here) >= 2 and all(_label_owning_value(q, v, labels_n, direction) == lab for lab, v in here):
                return direction
        return "nearest"

    directions = [reading(qi) for qi in range(len(quotes_n))]

    for s, lab_n in zip(series, labels_n):
        raw = str(s.get("value_raw", ""))
        if find_ranges(raw):
            # "₹500 - ₹1,000 crore" has no single bar length; any length would be invented
            err("CHART_VALUE_IS_RANGE", f"'{raw}' is a range; a chart needs one number per bar (use a list slide)", raw)
            mentions.append(None)
            source_quote_idx.append(None)
            continue
        m = first_mention(raw)
        mentions.append(m)
        if m is None:
            err("CHART_VALUE_NOT_A_NUMBER", f"chart value '{raw}' is not a number", raw)
            source_quote_idx.append(None)
            continue
        if s.get("value") is not None and Decimal(str(s["value"])) != m.value:
            err("CHART_VALUE_MISMATCH", f"bar/slice size {s['value']} does not match its label '{raw}'", raw)
        # The value must be in a cited quote with the same unit class, next to this label
        candidates = []
        for qi, q in enumerate(quotes_n):
            same = [qm for qm in q_mentions[qi] if qm.value == m.value and qm.cls == m.cls]
            if lab_n and lab_n in q and same:
                candidates.append((qi, _label_owning_value(q, norm(same[0].raw), labels_n, directions[qi])))
        owned = [qi for qi, owner in candidates if owner == lab_n]
        source_quote_idx.append(owned[0] if owned else None)
        if owned:
            continue
        if candidates:
            err("CHART_LABEL_MISMATCH",
                f"'{raw}' belongs to '{candidates[0][1]}' in the source, not to '{s.get('label')}'", raw)
        elif not lab_n or not any(lab_n in q for q in quotes_n):
            err("CHART_LABEL_NOT_IN_QUOTE", f"chart label '{s.get('label')}' is not in the cited quotes", str(s.get("label")))
        else:
            err("CHART_VALUE_NOT_IN_QUOTE",
                f"'{raw}' for '{s.get('label')}' is not a number written with that label in the cited quotes", raw)

    found = [m for m in mentions if m is not None]
    if len({m.cls for m in found}) > 1:
        err("CHART_MIXED_UNITS", "chart mixes units: " + ", ".join(sorted({m.cls for m in found})))

    if kind == "pie":
        whole_from_one_source = (
            len({i for i in source_quote_idx}) == 1 and None not in source_quote_idx
        ) or (
            None not in source_quote_idx
            and len({tuple(_quote_rows(cited_quotes[i]) or ()) for i in source_quote_idx}) == 1
            and _quote_rows(cited_quotes[source_quote_idx[0]]) is not None
        )
        total = sum((m.value for m in found), Decimal(0))
        if not found or any(m.cls != "percent" for m in found) or not (Decimal(95) <= total <= Decimal("100.5")) \
                or not whole_from_one_source:
            err("PIE_NOT_A_WHOLE",
                f"a pie needs percentage shares of one whole from one table or sentence summing to 95-100.5 (got {total}); use a bar chart")

    # The source calls ₹434 "Cost + Failure Buffer" (a total); a bar labelled "Failure buffer"
    # turns the total into one of its parts
    source_labels: List[str] = []
    for s, m in zip(series, mentions):
        own = ""
        if m is not None:
            for q in cited_quotes:
                lm = re.match(r"^\s*([^:|]{2,60}?):\s*~?\s*" + re.escape(m.raw.lstrip("~ ").strip()), q.strip())
                if lm:
                    own = lm.group(1).strip()
                    break
        source_labels.append(own)
        label = str(s.get("label", ""))
        if own and _TOTAL_LABEL.search(own) and not _TOTAL_LABEL.search(label):
            err("CHART_TOTAL_RELABELED",
                f"'{s.get('value_raw')}' is '{own}' in the source (a total); the label '{label}' makes it look like one part", label)

    if kind in ("bar", "pie"):
        # "Cost + failure buffer" or "Total cost" beside its own parts double-counts them on screen
        is_total = [bool(_TOTAL_LABEL.search(str(s.get("label", ""))) or _TOTAL_LABEL.search(own))
                    for s, own in zip(series, source_labels)]
        totals = [str(s.get("label")) for s, t in zip(series, is_total) if t]
        # the other bars are its parts when they fit inside it (cost parts vs a cost total), not
        # when they are bigger figures such as the price and profit next to the cost
        rest = [m.value for m, t in zip(mentions, is_total) if not t and m is not None]
        top = max((m.value for m, t in zip(mentions, is_total) if t and m is not None), default=None)
        if totals and len(rest) >= 2 and top is not None and sum(rest) <= top:
            issues.append(ValidationIssue(
                severity="WARN", code="CHART_PART_AND_TOTAL",
                message=f"chart shows a total ('{totals[0]}') next to the parts it includes; chart the parts or the totals, not both",
                offending_text=totals[0]))

    if kind == "line":
        bad = [str(s.get("label")) for s in series if not TIME_LABEL.match(str(s.get("label", "")).strip())]
        if bad:
            err("LINE_NOT_TIME_SERIES", "a line chart needs time labels (FY24, 2025, Q2 2026); got " + ", ".join(bad))

    return issues
