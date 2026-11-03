"""Document chunking and token budget guards for Groq free-tier limits."""

import math
from typing import List, Tuple
from autocontent.ingest.units import Unit
from autocontent.llm.base import LLMRequestTooLarge
from autocontent.llm.limiter import estimate_tokens

KIND_PRIORITY = [
    "number",
    "finding",
    "contrast",
    "recommendation",
    "example",
    "definition",
    "context",
]


def chunk_units(units: List[Unit], max_input_tokens: int = 1800) -> List[List[Unit]]:
    """Group consecutive units into chunks <= max_input_tokens.
    Starts a new chunk before a heading when current chunk is > 60% full.
    Never splits a unit.
    """
    if not units:
        return []

    chunks: List[List[Unit]] = []
    current_chunk: List[Unit] = []
    current_tokens = 0
    heading_split_threshold = int(max_input_tokens * 0.6)

    for unit in units:
        unit_tokens = estimate_tokens(unit.text) + 10  # small overhead for formatting/id

        # Check if we should split before a heading
        should_split_for_heading = (
            unit.kind == "heading"
            and current_tokens >= heading_split_threshold
            and len(current_chunk) > 0
        )

        # Check if adding this unit exceeds max_input_tokens
        would_overflow = (current_tokens + unit_tokens > max_input_tokens) and len(current_chunk) > 0

        if should_split_for_heading or would_overflow:
            chunks.append(current_chunk)
            current_chunk = [unit]
            current_tokens = unit_tokens
        else:
            current_chunk.append(unit)
            current_tokens += unit_tokens

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def cap_claims(claims: list, max_claims: int = 30) -> list:
    """Cap claims list at max_claims by kind priority, preserving document order."""
    if len(claims) <= max_claims:
        return claims

    # Map kind to priority rank
    def get_rank(c) -> int:
        kind = getattr(c, "kind", "").lower()
        if kind in KIND_PRIORITY:
            return KIND_PRIORITY.index(kind)
        return len(KIND_PRIORITY)

    # Annotate with original index to restore order
    indexed = list(enumerate(claims))
    # Sort by priority rank
    sorted_by_rank = sorted(indexed, key=lambda item: get_rank(item[1]))
    selected = sorted_by_rank[:max_claims]
    # Re-sort by original index
    selected.sort(key=lambda item: item[0])
    return [item[1] for item in selected]


def check_word_limit(word_count: int, max_words: int = 25000):
    """Enforce hard word count cap."""
    if word_count > max_words:
        raise ValueError(
            f"Document is too long ({word_count} words > {max_words}) for free daily budget; please split the report."
        )
