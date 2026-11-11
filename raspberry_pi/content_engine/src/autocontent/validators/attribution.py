"""Entity attribution: which company (or person, product, organisation) a claim is about.

A report comparing Zebronics, Ambrane and Portronics often says "The company's liquidity is
strong" under a "Zebronics" heading. Shown alone on a slide that sentence loses its subject,
and two such sentences from different sections can be merged into one false statement.
"""

import re
from collections import Counter
from typing import Dict, Iterable, List, Optional, Sequence

from . import ValidationIssue
from .normalize import norm

# Words that stand in for a named subject ("The company's EBITDA rose ...")
ANAPHORS = re.compile(
    r"(?:\b|\A)(the (?:company|brand|firm|business|group|startup|manufacturer|organi[sz]ation|enterprise)|"
    r"its|it's|they|their)(?:\b|\Z)"
)

# Proper nouns that name a setting rather than a subject
_NOT_SUBJECTS = {
    "india", "indian", "china", "chinese", "us", "usa", "uk", "europe", "asia", "global",
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december", "monday", "q1", "q2", "q3", "q4", "fy", "the", "a", "an",
    "introduction", "conclusion", "summary", "overview", "table", "figure", "appendix",
}

_WORD = re.compile(r"[A-Za-z][A-Za-z0-9&+\-]*")


def key_entities(texts: Sequence[str], headings: Sequence[str], min_count: int = 3) -> List[str]:
    """Proper nouns that name the document's subjects.

    A word qualifies when it appears in a heading, occurs at least `min_count` times in the
    text, and is (almost) never written in lower case there, so ordinary capitalised words
    ("Legacy", "Evolution") are not mistaken for names.
    """
    body = " ".join(texts)
    tokens = _WORD.findall(body)
    cap = Counter(t for t in tokens if t[0].isupper())
    low = Counter(t.lower() for t in tokens if t[0].islower())
    heading_words = {w for h in headings for w in _WORD.findall(h) if w[0].isupper()}
    found = []
    for w in heading_words:
        lw = w.lower()
        if lw in _NOT_SUBJECTS or len(w) < 3 or w.isupper():  # acronyms are usually terms (EBITDA, SKU)
            continue
        if cap[w] >= min_count and low[lw] <= cap[w] * 0.05:
            found.append(w)
    return sorted(found)


def entities_in(text: str, entities: Iterable[str]) -> List[str]:
    t = norm(text)
    return [e for e in entities if re.search(r"(?:\b|\A)" + re.escape(e.lower()) + r"(?:\b|'|’|\Z)", t)]


def claim_subjects(quote: str, section: Optional[str], entities: Sequence[str]) -> List[str]:
    """The entities a quote is about: those it names itself, else those its section heading names."""
    named = entities_in(quote, entities)
    from_section = entities_in(section or "", entities)
    if ANAPHORS.search(norm(quote)):
        # "The company's EBITDA ..." under a Portronics heading is about Portronics
        return sorted(set(named) | set(from_section))
    return named or from_section


def check_attribution(
    slide_text: str,
    cited_ids: Sequence[str],
    claim_about: Dict[str, List[str]],
) -> List[ValidationIssue]:
    """ERROR when a slide loses or mixes who its facts are about.

    - ENTITY_UNNAMED: the slide says "the company"/"its" but never names whom.
    - ENTITY_MIXED: the slide combines claims about different subjects without naming each one.
    """
    subjects = [claim_about.get(cid) or [] for cid in cited_ids]
    subjects = [s for s in subjects if s]
    if not subjects:
        return []
    issues: List[ValidationIssue] = []
    named_on_slide = set(entities_in(slide_text, {e for s in subjects for e in s}))

    distinct = {tuple(sorted(s)) for s in subjects}
    if len(distinct) > 1:
        missing = sorted({e for s in subjects for e in s} - named_on_slide)
        unnamed_groups = [s for s in distinct if not named_on_slide.intersection(s)]
        if unnamed_groups:
            issues.append(ValidationIssue(
                severity="ERROR",
                code="ENTITY_MIXED",
                message="slide combines facts about different subjects without naming each one: " + ", ".join(missing),
                offending_text=", ".join(missing),
            ))
            return issues

    if ANAPHORS.search(norm(slide_text)):
        for s in subjects:
            if not named_on_slide.intersection(s):
                issues.append(ValidationIssue(
                    severity="ERROR",
                    code="ENTITY_UNNAMED",
                    message=f"slide says 'the company'/'its' but never names who: {', '.join(s)}",
                    offending_text=", ".join(s),
                ))
                break
    return issues
