"""Deterministic fixes for near-miss composed slides, applied before validation.

The composer often gets a slide almost right: a number from a quote it forgot to cite, one
bullet a few characters too long, a headline one word over. Throwing such a slide away for an
extractive fallback (raw quotes pasted as a paragraph) costs far more than these small fixes.
Nothing here adds wording: citations are added only for quotes that hold the number, and
text is only removed (a whole bullet, an article, a parenthetical)."""

import re
from typing import Any, Dict, List

from .extract_claims import Claim
from ..validators.limits import get_limit
from ..validators.numbers import check_numbers, extract_number_mentions


def _fits(slide_type: str, field: str, text: str) -> bool:
    limit = get_limit(slide_type, field)
    return limit is None or (len(text.split()) <= limit[0] and len(text) <= limit[1])


def _slide_text(slide: Dict[str, Any]) -> str:
    parts = [slide.get("headline") or "", slide.get("body") or "", str(slide.get("number") or "")]
    parts += slide.get("bullets") or []
    parts += slide.get("items") or []
    parts += [str(p.get("value_raw", "")) for p in slide.get("series") or []]
    return "\n".join(p for p in parts if p)


def _cite_missing_numbers(slide: Dict[str, Any], claims: Dict[str, Claim], used_elsewhere: set) -> List[str]:
    """Add the claim that holds a number the slide prints but does not cite."""
    added: List[str] = []
    ids = slide.setdefault("claim_ids", [])
    cited = "\n".join(claims[c].quote for c in ids if c in claims)
    for issue in check_numbers(_slide_text(slide), cited):
        if issue.code != "UNSUPPORTED_NUMBER" or not issue.offending_text:
            continue
        wanted = extract_number_mentions(issue.offending_text)
        if not wanted:
            continue
        w = wanted[0]
        owners = [c for c in claims.values() if c.id not in ids
                  and any(m.value == w.value and m.cls == w.cls for m in extract_number_mentions(c.quote))]
        if not owners:
            continue
        owners.sort(key=lambda c: (c.id in used_elsewhere, c.id))  # a quote no other slide uses first
        ids.append(owners[0].id)
        added.append(owners[0].id)
        cited = "\n".join(claims[c].quote for c in ids if c in claims)
    return added


_FILLER = re.compile(r"\s*\([^)]*\)|\b(?:the|a|an|very|really|just)\s+", re.I)


def _shorten_headline(slide_type: str, headline: str) -> str:
    """Drop parentheticals and articles until the headline fits; unchanged when it still does not."""
    if _fits(slide_type, "headline", headline):
        return headline
    shorter = re.sub(r"\s{2,}", " ", _FILLER.sub(" ", headline)).strip(" ,")
    if shorter and _fits(slide_type, "headline", shorter):
        return shorter[0].upper() + shorter[1:]
    return headline


def salvage_slides(slides: List[Dict[str, Any]], claims_by_id: Dict[str, Claim]) -> List[str]:
    """Fix near-miss slides in place; returns one note per change."""
    notes: List[str] = []
    for n, slide in enumerate(slides, start=1):
        t = slide.get("type")
        others = {c for k, s in enumerate(slides, start=1) if k != n for c in s.get("claim_ids") or []}

        added = _cite_missing_numbers(slide, claims_by_id, others)
        if added:
            notes.append(f"Slide {n}: cited {', '.join(added)} for numbers it already showed")

        # A list of 2 items, or items a little over the list limit, is a valid bullet slide
        items = slide.get("items")
        if t == "list" and items and (len(items) < 3 or not all(_fits(t, "item", i) for i in items)) \
                and 2 <= len(items) <= 4 and all(_fits("point", "bullet", i) for i in items):
            slide["type"] = t = "point"
            slide["bullets"] = slide.pop("items")
            notes.append(f"Slide {n}: list shown as bullets")

        if slide.get("headline"):
            short = _shorten_headline(t, slide["headline"])
            if short != slide["headline"]:
                notes.append(f"Slide {n}: headline shortened to '{short}'")
                slide["headline"] = short

        for field, unit, keep in (("bullets", "bullet", 3), ("items", "item", 3)):
            rows = slide.get(field)
            if not rows:
                continue
            fitting = [r for r in rows if _fits(t, unit, r)]
            if len(fitting) < len(rows) and len(fitting) >= keep:
                slide[field] = fitting
                notes.append(f"Slide {n}: dropped {len(rows) - len(fitting)} over-long {unit}(s)")
            elif len(rows) > 4 and len(fitting) >= keep:
                slide[field] = fitting[:4]
                notes.append(f"Slide {n}: kept the first 4 {field}")
    return notes
