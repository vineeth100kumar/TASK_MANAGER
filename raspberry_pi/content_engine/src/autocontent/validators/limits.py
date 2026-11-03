"""Length, word count, character, and formatting limits per slide field."""

import re
from typing import List, Literal, Optional
from . import ValidationIssue
from .. import tuning

FIELD_LIMITS = {
    ("cover", "headline"): (12, 72),  # room for whose number it is plus its "but ..." caveat
    ("point", "headline"): (6, 40),
    ("point", "body"): (30, 200),
    ("point", "bullet"): (12, 80),
    ("list", "headline"): (6, 40),
    ("list", "item"): (10, 70),
    ("stat", "headline"): (6, 40),
    ("stat", "number"): (3, 20),
    ("stat", "body"): (20, 140),
    ("quote", "headline"): (6, 40),
    ("quote", "body"): (25, 180),
    ("quote", "author"): (6, 50),
    ("cta", "headline"): (8, 50),
    ("chart", "headline"): (6, 40),
    ("chart", "body"): (20, 140),
    ("chart", "label"): (4, 28),
    ("chart", "value"): (3, 24),
    ("chart", "source_note"): (8, 60),
}

def get_limit(slide_type: str, field_name: str):
    """(max words, max chars) for a slide field, after the config's overrides and limit_slack, or None."""
    return tuning.field_limit(slide_type, field_name, FIELD_LIMITS.get((slide_type, field_name)))


# Regex to detect URLs
URL_PATTERN = re.compile(r'https?://\S+|www\.\S+', re.IGNORECASE)

# Regex to detect hashtags in slide content
HASHTAG_PATTERN = re.compile(r'#\w+')

# Regex to detect emojis
# Covers major Unicode emoji blocks: Emoticons, Misc Symbols & Pictographs, Transport, Supplemental, Symbols, etc.
EMOJI_PATTERN = re.compile(
    r'[\U0001F600-\U0001F64F]'  # emoticons
    r'|[\U0001F300-\U0001F5FF]'  # symbols & pictographs
    r'|[\U0001F680-\U0001F6FF]'  # transport & map
    r'|[\U0001F1E0-\U0001F1FF]'  # flags
    r'|[\U00002702-\U000027B0]'  # dingbats
    r'|[\U000024C2-\U0001F251]'  # enclosed chars
    r'|[\U0001F900-\U0001F9FF]'  # supplemental symbols
    r'|[\U0001FA00-\U0001FA6F]'  # chess symbols etc
    r'|[\U0001FA70-\U0001FAFF]'  # symbols and pictographs extended-a
    r'|[\U00002600-\U000026FF]'  # misc symbols
)


def check_forbidden_patterns(text: str, field_name: str) -> List[ValidationIssue]:
    """Check that text contains no emojis, hashtags, or URLs."""
    issues: List[ValidationIssue] = []

    if EMOJI_PATTERN.search(text):
        match = EMOJI_PATTERN.search(text)
        issues.append(
            ValidationIssue(
                severity="ERROR",
                code="EMOJI_FORBIDDEN",
                message=f"Emoji found in {field_name}. Emojis are forbidden in slide text.",
                offending_text=match.group(0) if match else None
            )
        )

    if HASHTAG_PATTERN.search(text):
        match = HASHTAG_PATTERN.search(text)
        issues.append(
            ValidationIssue(
                severity="ERROR",
                code="HASHTAG_FORBIDDEN",
                message=f"Hashtag found in {field_name}. Hashtags are forbidden in slide text.",
                offending_text=match.group(0) if match else None
            )
        )

    if URL_PATTERN.search(text):
        match = URL_PATTERN.search(text)
        issues.append(
            ValidationIssue(
                severity="ERROR",
                code="URL_FORBIDDEN",
                message=f"URL found in {field_name}. URLs are forbidden in slide text.",
                offending_text=match.group(0) if match else None
            )
        )

    return issues


def check_field_limits(
    slide_type: str,
    field_name: str,
    text: str
) -> List[ValidationIssue]:
    """Check word count and character count limits for a field."""
    issues: List[ValidationIssue] = []

    # First check forbidden patterns
    issues.extend(check_forbidden_patterns(text, f"{slide_type}.{field_name}"))

    limit = get_limit(slide_type, field_name)
    if limit:
        max_words, max_chars = limit
        words = len(text.split())
        chars = len(text)

        if words > max_words:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="WORD_LIMIT_EXCEEDED",
                    message=f"{slide_type}.{field_name} exceeded word limit ({words} > {max_words})",
                    offending_text=text
                )
            )

        if chars > max_chars:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="CHAR_LIMIT_EXCEEDED",
                    message=f"{slide_type}.{field_name} exceeded char limit ({chars} > {max_chars})",
                    offending_text=text
                )
            )

    return issues
