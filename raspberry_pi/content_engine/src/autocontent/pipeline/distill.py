"""Hierarchical document chunking, section prioritization, and multi-stage claim distillation."""

import re
from typing import Dict, List, Optional, Set, Tuple
from autocontent.ingest.units import Unit
from autocontent.llm.limiter import estimate_tokens
from autocontent.pipeline.chunking import KIND_PRIORITY

HIGH_PRIORITY_KEYWORDS = {
    "executive", "summary", "finding", "findings", "recommend", "recommendations",
    "conclusion", "conclusions", "takeaway", "takeaways", "highlight", "highlights",
    "result", "results", "key", "core", "action", "habits", "overview"
}

LOW_PRIORITY_KEYWORDS = {
    "method", "methodology", "demographic", "demographics", "sample", "sampling",
    "limitation", "limitations", "disclaimer", "disclaimers", "appendix", "appendices",
    "reference", "references", "footnote", "footnotes", "legal", "notes"
}


def classify_section_priority(section_name: Optional[str], unit_kind: str = "paragraph") -> int:
    """Classify the importance of a document section:

    3 = High (Executive summary, findings, recommendations, tables)
    2 = Medium (General content, market trends, analysis)
    1 = Low (Methodology, sample design, disclaimers, appendix)
    """
    if unit_kind == "table_row":
        return 3

    if not section_name:
        return 2

    words = set(re.findall(r'\b\w+\b', section_name.lower()))
    if any(k in words for k in HIGH_PRIORITY_KEYWORDS):
        return 3
    if any(k in words for k in LOW_PRIORITY_KEYWORDS):
        return 1
    return 2


def hierarchical_chunk_units(
    units: List[Unit],
    max_input_tokens: int = 1800
) -> List[Tuple[int, List[Unit]]]:
    """Group units into section-aware chunks tagged with their priority weight (3, 2, or 1).

    Never mixes high-priority sections with low-priority methodology sections.
    If the entire document is <= max_input_tokens, returns a single chunk.
    """
    if not units:
        return []

    total_tokens = sum(estimate_tokens(u.text) + 10 for u in units)
    if total_tokens <= max_input_tokens:
        return [(3, units)]

    chunks: List[Tuple[int, List[Unit]]] = []
    current_chunk: List[Unit] = []
    current_tokens = 0
    current_priority: Optional[int] = None
    heading_split_threshold = int(max_input_tokens * 0.6)

    for unit in units:
        unit_priority = classify_section_priority(unit.section, unit.kind)
        unit_tokens = estimate_tokens(unit.text) + 10

        # Change in section priority triggers chunk split if chunk already has content
        priority_changed = (current_priority is not None and unit_priority != current_priority and len(current_chunk) > 0)
        heading_split = (unit.kind == "heading" and current_tokens >= heading_split_threshold)
        overflow = (current_tokens + unit_tokens > max_input_tokens)

        if current_chunk and (priority_changed or heading_split or overflow):
            chunks.append((current_priority or 2, current_chunk))
            current_chunk = [unit]
            current_tokens = unit_tokens
            current_priority = unit_priority
        else:
            current_chunk.append(unit)
            current_tokens += unit_tokens
            if current_priority is None:
                current_priority = unit_priority
            else:
                # If chunk contains mixed units, retain higher priority
                current_priority = max(current_priority, unit_priority)

    if current_chunk:
        chunks.append((current_priority or 2, current_chunk))

    return chunks


def compute_jaccard_similarity(text1: str, text2: str) -> float:
    """Compute lexical token Jaccard similarity between two texts."""
    tokens1 = set(re.findall(r'\b\w+\b', text1.lower()))
    tokens2 = set(re.findall(r'\b\w+\b', text2.lower()))
    if not tokens1 or not tokens2:
        return 0.0
    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)
    return len(intersection) / len(union)


def deduplicate_claims(claims: list, jaccard_threshold: float = 0.80) -> list:
    """Filter out near-duplicate claims extracted across multiple chunks."""
    unique_claims = []
    for c in claims:
        is_dup = False
        c_quote = getattr(c, "quote", "")
        for uc in unique_claims:
            uc_quote = getattr(uc, "quote", "")
            if compute_jaccard_similarity(c_quote, uc_quote) >= jaccard_threshold:
                is_dup = True
                break
        if not is_dup:
            unique_claims.append(c)
    return unique_claims


def distill_claims(
    claims: list,
    units_by_id: Dict[str, Unit],
    max_claims: int = 30
) -> list:
    """Distill candidate claims using section priorities, de-duplication, and kind priority.

    Guarantees representation across high-priority sections without exceeding max_claims.
    """
    if not claims:
        return []

    # 1. Deduplicate near-identical claims
    deduped = deduplicate_claims(claims)
    if len(deduped) <= max_claims:
        return deduped

    # 2. Group by section priority
    p3_claims = []  # High
    p2_claims = []  # Medium
    p1_claims = []  # Low

    for c in deduped:
        uid = getattr(c, "unit_id", "")
        unit = units_by_id.get(uid)
        p = classify_section_priority(unit.section if unit else None, unit.kind if unit else "paragraph")
        if p == 3:
            p3_claims.append(c)
        elif p == 2:
            p2_claims.append(c)
        else:
            p1_claims.append(c)

    def get_kind_rank(c) -> int:
        k = getattr(c, "kind", "").lower()
        if k in KIND_PRIORITY:
            return KIND_PRIORITY.index(k)
        return len(KIND_PRIORITY)

    # Sort each group by kind priority
    p3_claims.sort(key=get_kind_rank)
    p2_claims.sort(key=get_kind_rank)
    p1_claims.sort(key=get_kind_rank)

    # Allocate slots: High priority takes first budget (up to 20), Medium (up to 8), Low (up to 2)
    selected = []
    # Take high priority (up to 20)
    selected.extend(p3_claims[:min(len(p3_claims), 20)])
    remaining = max_claims - len(selected)

    # Take medium priority
    if remaining > 0:
        take_p2 = min(len(p2_claims), remaining)
        selected.extend(p2_claims[:take_p2])
        remaining = max_claims - len(selected)

    # Take low priority (strictly capped at 2 max)
    if remaining > 0:
        take_p1 = min(len(p1_claims), min(remaining, 2))
        selected.extend(p1_claims[:take_p1])
        remaining = max_claims - len(selected)

    # If still space, backfill from remaining p3 then p2
    if remaining > 0:
        extra_p3 = [c for c in p3_claims if c not in selected]
        selected.extend(extra_p3[:remaining])
        remaining = max_claims - len(selected)

    if remaining > 0:
        extra_p2 = [c for c in p2_claims if c not in selected]
        selected.extend(extra_p2[:remaining])

    # Re-order according to original appearance order in deduped
    orig_order = {id(c): i for i, c in enumerate(claims)}
    selected.sort(key=lambda c: orig_order.get(id(c), 0))
    return selected[:max_claims]
