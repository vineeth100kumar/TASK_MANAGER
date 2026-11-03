"""Risky quantifier validation."""

import re
from typing import List
from . import ValidationIssue
from .normalize import norm

# Plain list of risky words/phrases editable by the owner
RISKY_QUANTIFIERS: List[str] = [
    "all",
    "every",
    "everyone",
    "everything",
    "always",
    "never",
    "only",
    "none",
    "nobody",
    "most",
    "majority",
    "many",
    "few",
    "best",
    "worst",
    "biggest",
    "largest",
    "greatest",
    "top",
    "#1",
    "number one",
    "guaranteed",
    "guarantee",
    "proven",
    "double",
    "triple",
    "twice",
    "half",
    "doubled",
    "tripled",
    "fastest",
    "easiest",
    "instantly",
    "overnight",
    "secret",
    "ultimate",
    "perfect",
    "zero",
]


def check_quantifiers(slide_text: str, cited_quotes_text: str) -> List[ValidationIssue]:
    """If a risky quantifier appears in slide_text, it must also appear
    in cited_quotes_text. Otherwise ERROR.
    """
    slide_norm = norm(slide_text)
    quote_norm = norm(cited_quotes_text)

    issues: List[ValidationIssue] = []

    for word in RISKY_QUANTIFIERS:
        # Check word boundary
        pattern = r'(?:\b|\A)' + re.escape(word) + r'(?:\b|\Z)'
        if re.search(pattern, slide_norm):
            if not re.search(pattern, quote_norm):
                issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="UNSUPPORTED_QUANTIFIER",
                        message=f"Risky quantifier '{word}' appears in slide text but not in cited quotes.",
                        offending_text=word
                    )
                )

    return issues
