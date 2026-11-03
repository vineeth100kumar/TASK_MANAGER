"""Headline checks: a headline must not be a sentence or title cut off in the middle."""

from typing import Iterable, List, Optional

from . import ValidationIssue
from .normalize import norm

DANGLING_END_WORDS = {
    "a", "an", "the", "and", "or", "but", "of", "for", "in", "on", "at", "to", "with", "by",
    "from", "into", "as", "than", "that", "which", "who", "its", "their", "our", "your", "his", "her",
    "around", "across", "through", "between", "beyond", "within", "via", "versus", "vs", "toward",
    "towards", "against", "among", "amid", "without",
}


def _ends_dangling(phrase: str) -> bool:
    """True when a phrase stops where a reader expects more: "...of", "...India's"."""
    words = phrase.split()
    if not words:
        return True
    last = words[-1].lower().rstrip(":,.-")
    return last in DANGLING_END_WORDS or last.endswith(("'s", "’s", "s'"))


def _words(text: str) -> List[str]:
    return [w.strip(":,.;!?-\"'()") for w in norm(text).split()]


def check_title_truncation(headline: str, longer_texts: Iterable[Optional[str]]) -> List[ValidationIssue]:
    """ERROR [TITLE_TRUNCATED] when the headline is the start of a longer quote or title that was
    cut where it dangles ("Strategic Evolution and Market Dynamics of India's")."""
    if not headline or not _ends_dangling(headline):
        return []
    hw = _words(headline)
    for text in longer_texts:
        tw = _words(text or "")
        if len(hw) < len(tw) and tw[:len(hw)] == hw:
            return [ValidationIssue(
                severity="ERROR",
                code="TITLE_TRUNCATED",
                message=f"headline is cut off in the middle of a longer phrase: '{headline}'",
                offending_text=headline,
            )]
    return []
