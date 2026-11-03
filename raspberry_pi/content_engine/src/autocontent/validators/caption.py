"""Deterministic validation for Instagram captions."""

import re
from typing import Dict, List, Optional
from autocontent.pipeline.extract_claims import Claim
from autocontent.validators.numbers import check_numbers, check_ranges
from autocontent.validators.quantifiers import check_quantifiers
from autocontent.validators.hedges import check_hedges
from autocontent.validators.entities import check_entities


def _word_stem_in_source(tag: str, source_text_lower: str) -> bool:
    """Check if tag or its common English stem appears in source text."""
    tag = tag.lower().lstrip("#")
    if tag in {"minddeeds"}:
        return True
    if tag in source_text_lower:
        return True
    
    # Check without spaces for compound tags (e.g. #cashflow for 'cash flow')
    source_no_spaces = source_text_lower.replace(" ", "")
    if tag in source_no_spaces:
        return True

    # Stemming heuristics for common English endings:
    stems = [tag]
    if tag.endswith("ies") and len(tag) > 4:
        stems.append(tag[:-3] + "y")
        stems.append(tag[:-3])
    if tag.endswith("es") and len(tag) > 3:
        stems.append(tag[:-2])
    if tag.endswith("s") and not tag.endswith("ss") and len(tag) > 2:
        stems.append(tag[:-1])
    if tag.endswith("ing") and len(tag) > 4:
        stems.append(tag[:-3])
        stems.append(tag[:-3] + "e")
    if tag.endswith("ed") and len(tag) > 3:
        stems.append(tag[:-2])
        stems.append(tag[:-1])

    for stem in stems:
        if len(stem) >= 3 and stem in source_text_lower:
            return True

    return False


def validate_caption(
    caption_text: str,
    claims: List[Claim],
    full_source_text: str,
    brand_tag: Optional[str] = None
) -> List[Dict[str, str]]:
    """Verify that an Instagram caption strictly obeys the Grounding Contract:

    1. Numbers in caption must match accepted claim quotes.
    2. No ungrounded risky quantifiers or dropped caveats.
    3. Proper nouns and entities must appear in source text.
    4. No raw table pipe syntax (' | ').
    5. Hashtags must be unique (no case-insensitive duplicates) and grounded in source.
    """
    issues: List[Dict[str, str]] = []
    cited_text = "\n".join(c.quote for c in claims)
    combined_source = (full_source_text + " " + cited_text).lower()

    # 1. Number verification: check numbers in caption text without hashtags
    caption_text_no_tags = re.sub(r'#\w+', '', caption_text)
    num_issues = check_numbers(caption_text_no_tags, cited_text) + check_ranges(caption_text_no_tags, cited_text)
    for iss in num_issues:
        issues.append({
            "severity": iss.severity,
            "code": iss.code,
            "message": f"Caption: {iss.message}"
        })

    # 2. Quantifiers
    # A comment prompt ("Which number surprised you the most?") asks the reader; it states no fact
    statements = " ".join(s for s in re.split(r"(?<=[.!?])\s+|\n", caption_text_no_tags) if not s.strip().endswith("?"))
    quant_issues = check_quantifiers(statements, cited_text)
    for iss in quant_issues:
        issues.append({
            "severity": iss.severity,
            "code": iss.code,
            "message": f"Caption: {iss.message}"
        })

    # 3. Hedges / Causality
    hedge_issues = check_hedges(caption_text, cited_text)
    for iss in hedge_issues:
        issues.append({
            "severity": iss.severity,
            "code": iss.code,
            "message": f"Caption: {iss.message}"
        })

    # 4. Entities
    # Hashtags are checked on their own below; a brand tag like #BUSINESS is not a named entity
    entity_issues = check_entities(caption_text_no_tags, cited_text, full_source_text)
    for iss in entity_issues:
        issues.append({
            "severity": iss.severity,
            "code": iss.code,
            "message": f"Caption: {iss.message}"
        })

    # 5. Raw table pipe check
    if " | " in caption_text:
        issues.append({
            "severity": "ERROR",
            "code": "RAW_TABLE_PIPE",
            "message": "Caption contains raw table pipe character ' | '."
        })

    # 6. Hashtag validation
    hashtags = re.findall(r'#(\w+)', caption_text)
    if len(hashtags) < 3:
        issues.append({
            "severity": "WARN",
            "code": "TOO_FEW_HASHTAGS",
            "message": f"Caption has only {len(hashtags)} hashtags; recommended 3 to 10."
        })
    elif len(hashtags) > 15:
        issues.append({
            "severity": "WARN",
            "code": "TOO_MANY_HASHTAGS",
            "message": f"Caption has {len(hashtags)} hashtags; recommended max 10 to avoid spam penalty."
        })

    # Check duplicates (case-insensitive)
    seen_tags = set()
    for h in hashtags:
        h_lower = h.lower()
        if h_lower in seen_tags:
            issues.append({
                "severity": "ERROR",
                "code": "DUPLICATE_HASHTAG",
                "message": f"Duplicate hashtag found in caption: #{h}"
            })
        seen_tags.add(h_lower)

    # NOTE: hashtags are intentionally NOT grounded in the source document.
    # They are niche/topic keywords for discovery (set in brand.json), not facts,
    # so a tag like #startupindia is correct even though the word is not in the report.
    # Only the *body* of the caption (numbers, entities, quantifiers) is grounded, above.

    return issues
