"""Hedge and causal language validation."""

import re
from typing import List
from . import ValidationIssue
from .normalize import norm

HEDGE_WORDS: List[str] = [
    "may", "might", "could", "can", "suggests", "suggest", "appears", "likely",
    "reported", "some", "several", "up to", "about", "approximately", "around",
    "roughly", "often", "tends"
]

CAVEAT_CONNECTORS: List[str] = [
    "though", "however", "but", "although", "may", "might", "could",
    "not a random", "cannot be generalis", "did not test", "coincidence",
    "small sample", "not verified", "limited", "preliminary", "correlation"
]

CAUSAL_WORDS: List[str] = [
    "because", "causes", "caused", "leads to", "results in", "due to", "therefore",
    "drives", "boosts", "improves", "increases", "reduces", "prevents", "ensures", "helps"
]


def check_hedges(slide_text: str, cited_quotes_text: str) -> List[ValidationIssue]:
    """Check for dropped hedges, dropped caveats, and introduced causal claims:
    - If cited quotes contain any caveat connector and slide text contains none of that quote's
      caveat words, emit ERROR 'CAVEAT_DROPPED'.
    - If cited quotes contain other general hedges and slide text drops them, emit WARN 'HEDGE_DROPPED'.
    - If slide text contains a causal word not present in cited quotes:
      WARN 'possible causal claim not in source'.
    """
    slide_norm = norm(slide_text)
    quote_norm = norm(cited_quotes_text)
    issues: List[ValidationIssue] = []

    # 1. Check for caveat connectors (ERROR if dropped)
    quote_caveats = []
    for c in CAVEAT_CONNECTORS:
        pattern = r'(?:\b|\A)' + re.escape(c) + r'(?:\b|\Z)'
        if re.search(pattern, quote_norm):
            quote_caveats.append(c)

    if quote_caveats:
        slide_has_caveat = False
        for c in CAVEAT_CONNECTORS:
            pattern = r'(?:\b|\A)' + re.escape(c) + r'(?:\b|\Z)'
            if re.search(pattern, slide_norm):
                slide_has_caveat = True
                break
        if not slide_has_caveat:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="CAVEAT_DROPPED",
                    message="caveat or limitation dropped; slide presents conditional finding as absolute fact",
                    offending_text=", ".join(quote_caveats[:2])
                )
            )
    else:
        # Check if quote had a softer general hedge (WARN if dropped)
        quote_has_hedge = False
        for hedge in HEDGE_WORDS:
            pattern = r'(?:\b|\A)' + re.escape(hedge) + r'(?:\b|\Z)'
            if re.search(pattern, quote_norm):
                quote_has_hedge = True
                break

        if quote_has_hedge:
            slide_has_hedge = False
            for hedge in HEDGE_WORDS:
                pattern = r'(?:\b|\A)' + re.escape(hedge) + r'(?:\b|\Z)'
                if re.search(pattern, slide_norm):
                    slide_has_hedge = True
                    break
            if not slide_has_hedge:
                issues.append(
                    ValidationIssue(
                        severity="WARN",
                        code="HEDGE_DROPPED",
                        message="hedge dropped; slide may sound more certain than the source",
                        offending_text=None
                    )
                )

    # 2. Check for newly introduced causal words
    for causal in CAUSAL_WORDS:
        pattern = r'(?:\b|\A)' + re.escape(causal) + r'(?:\b|\Z)'
        if re.search(pattern, slide_norm):
            if not re.search(pattern, quote_norm):
                issues.append(
                    ValidationIssue(
                        severity="WARN",
                        code="UNSUPPORTED_CAUSAL",
                        message=f"possible causal claim not in source: '{causal}'",
                        offending_text=causal
                    )
                )

    return issues


# Words that limit who a finding applies to ("Three founders reported ...").
_SCOPE_COUNT_WORDS: List[str] = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "some", "several", "a few", "a handful of", "a minority of",
    "a majority of", "half of the", "half", "most", "many", "few",
]

_POPULATION_NOUNS: str = (
    r"founders?|respondents?|people|persons?|companies|company|firms?|customers?|users?|"
    r"participants?|businesses|business|employees?|owners?|leaders?|executives?|managers?|"
    r"teams?|organi[sz]ations?|ceos?|startups?|interviewees?|members?|clients?|workers?|"
    r"households?|consumers?|buyers?|sellers?|investors?|students?|staff|brands?|stores?|retailers?"
)

_SCOPE_RE = re.compile(
    # Only subject position counts (start of a sentence or clause): "Three founders reported",
    # "but most other founders disagreed". "We interviewed 40 founders" is the sample, not a scope.
    r"(?:\A|[.;:,(]\s*|\b(?:but|and|while|whereas|yet)\s+)("
    + "|".join(re.escape(w) for w in sorted(_SCOPE_COUNT_WORDS, key=len, reverse=True))
    + r"|\d+(?:\s+of\s+\d+)?)"
    r"\s+(?:of\s+(?:the\s+|our\s+)?)?(?:[a-z-]+\s+){0,2}?(?:" + _POPULATION_NOUNS + r")\b"
)


def scope_phrases(text: str) -> List[str]:
    """Return the scope markers (e.g. 'three', 'a majority of', 'some') that limit a finding to part of a group."""
    return [m.group(1) for m in _SCOPE_RE.finditer(norm(text))]


def check_scope(slide_text: str, cited_quotes_text: str) -> List[ValidationIssue]:
    """ERROR 'SCOPE_DROPPED' when the source limits a finding to part of a group
    ("Three founders reported ...") and the slide keeps none of those limits,
    turning an anecdote into a general rule ("20% price hikes didn't cut sign-ups").
    """
    quote_scopes = scope_phrases(cited_quotes_text)
    if not quote_scopes:
        return []
    slide_norm = norm(slide_text)
    for scope in quote_scopes:
        variants = {scope, scope.split(" of ")[0]}
        for v in variants:
            if re.search(r"(?:\b|\A)" + re.escape(v) + r"(?:\b|\Z)", slide_norm):
                return []
    return [
        ValidationIssue(
            severity="ERROR",
            code="SCOPE_DROPPED",
            message="source limits this finding to part of a group; slide states it as a general rule",
            offending_text=", ".join(dict.fromkeys(quote_scopes))[:80],
        )
    ]
