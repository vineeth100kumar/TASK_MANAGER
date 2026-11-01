"""Whole-deck validation orchestrator."""

import re
from typing import List, Dict, Any, Optional, Set
from pydantic import BaseModel, Field
from . import ValidationIssue
from .numbers import check_numbers, check_ranges
from .quantifiers import check_quantifiers
from .hedges import check_hedges, check_scope
from .entities import check_entities
from .limits import check_field_limits
from .tables import validate_table_row_associations
from .attribution import check_attribution
from .headlines import check_title_truncation
from .charts import check_chart, chart_text, series_of


class SlideValidationResult(BaseModel):
    slide_n: int
    slide_type: str
    issues: List[Dict[str, Any]] = Field(default_factory=list)
    has_error: bool = False
    has_warn: bool = False


class DeckValidationReport(BaseModel):
    is_valid: bool
    total_errors: int = 0
    total_warnings: int = 0
    slides: List[SlideValidationResult] = Field(default_factory=list)


def validate_deck(
    slides: List[Dict[str, Any]],
    claims_by_id: Dict[str, str],
    full_source_text: str,
    claim_about: Optional[Dict[str, List[str]]] = None,
    doc_title: Optional[str] = None
) -> DeckValidationReport:
    """Validate a deck of slides against claims and source text according to
    deterministic rules.

    slides: list of dicts with keys: type, headline, [body], [items], [claim_ids]
    claims_by_id: map of claim_id (e.g. 'C01') -> verbatim quote string
    full_source_text: full text of original document
    claim_about: map of claim_id -> entities the claim is about (Claim.about)
    doc_title: document title, so a cover cut off mid-phrase is caught
    """
    total_errors = 0
    total_warnings = 0
    slide_results: List[SlideValidationResult] = []

    # 1. Determine allowed derived counts from list slides (e.g. 3 items allows '3' on cover)
    allowed_derived_counts: Set[int] = set()
    for s in slides:
        if s.get("type") == "list":
            items = s.get("items") or []
            if len(items) > 0:
                allowed_derived_counts.add(len(items))

    # 2. Check slide sequence: cover, then point/list, then cta
    sequence_issues: List[ValidationIssue] = []
    if slides:
        if slides[0].get("type") != "cover":
            sequence_issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="INVALID_SEQUENCE",
                    message="First slide must be of type 'cover'",
                    offending_text=slides[0].get("type")
                )
            )
        if slides[-1].get("type") != "cta":
            sequence_issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="INVALID_SEQUENCE",
                    message="Last slide must be of type 'cta'",
                    offending_text=slides[-1].get("type")
                )
            )
        for i in range(1, len(slides) - 1):
            st = slides[i].get("type")
            if st not in ("point", "list", "stat", "quote", "chart"):
                sequence_issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="INVALID_SEQUENCE",
                        message=f"Interior slide {i+1} must be 'point', 'list', 'stat', 'quote' or 'chart', got '{st}'",
                        offending_text=st
                    )
                )

    # 3. Check cover claim payoff: cover claims should appear on at least one later slide
    cover_claims: Set[str] = set()
    later_claims: Set[str] = set()
    if slides and slides[0].get("type") == "cover":
        cover_claims = set(slides[0].get("claim_ids") or [])
        for s in slides[1:]:
            for cid in (s.get("claim_ids") or []):
                later_claims.add(cid)

    # A claim told on two content slides repeats a fact and wastes a swipe
    first_use: Dict[str, int] = {}
    for k, s in enumerate(slides[1:], start=2):
        if s.get("type") in ("cover", "cta"):
            continue
        for cid in dict.fromkeys(s.get("claim_ids") or []):
            first_use.setdefault(cid, k)

    # Process each slide
    for idx, slide in enumerate(slides, start=1):
        s_type = slide.get("type", "point")
        claim_ids = slide.get("claim_ids") or []
        slide_issues: List[ValidationIssue] = []

        # Include sequence issues on appropriate slides
        if idx == 1 and sequence_issues:
            slide_issues.extend([iss for iss in sequence_issues if "First" in iss.message])
        if idx == len(slides) and sequence_issues:
            slide_issues.extend([iss for iss in sequence_issues if "Last" in iss.message])

        # CTA slide is exempt from fact checks and claim requirements
        if s_type == "cta":
            headline = slide.get("headline", "")
            # Basic sanity check on CTA headline
            if not headline:
                slide_issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="EMPTY_CTA",
                        message="CTA slide must have a headline",
                        offending_text=""
                    )
                )
        else:
            # Non-CTA slide must have >= 1 valid claim_id
            if not claim_ids:
                slide_issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="MISSING_CLAIMS",
                        message=f"Non-CTA slide {idx} must cite at least one claim_id",
                        offending_text=None
                    )
                )
            else:
                for cid in claim_ids:
                    if cid not in claims_by_id:
                        slide_issues.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="INVALID_CLAIM_ID",
                                message=f"Cited claim_id '{cid}' is not recognized",
                                offending_text=cid
                            )
                        )

            if s_type != "cover":
                for cid in dict.fromkeys(claim_ids):
                    if first_use.get(cid, idx) < idx:
                        slide_issues.append(
                            ValidationIssue(
                                severity="WARN",
                                code="DUPLICATE_CLAIM",
                                message=f"Claim '{cid}' is already used on slide {first_use[cid]}; use each fact once",
                                offending_text=cid
                            )
                        )

            # Combine all cited quote texts for this slide
            cited_quotes_list = [claims_by_id[cid] for cid in claim_ids if cid in claims_by_id]
            cited_text = "\n".join(cited_quotes_list)

            # Gather all content text from this slide (excluding system counters/handles)
            headline = slide.get("headline", "")
            if headline:
                slide_issues.extend(check_field_limits(s_type, "headline", headline))
                content_pieces = [headline]
            else:
                content_pieces = []

            if s_type == "point":
                body = slide.get("body") or ""
                bullets = slide.get("bullets") or []
                if body or not bullets:
                    slide_issues.extend(check_field_limits("point", "body", body))
                    content_pieces.append(body)
                if bullets and not 2 <= len(bullets) <= 4:
                    slide_issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="BULLET_COUNT",
                            message=f"Point slide bullets must be 2 to 4, got {len(bullets)}",
                            offending_text=str(len(bullets))
                        )
                    )
                for b in bullets:
                    slide_issues.extend(check_field_limits("point", "bullet", b))
                    content_pieces.append(b)

            elif s_type == "chart":
                body = slide.get("body") or ""
                if body:
                    slide_issues.extend(check_field_limits("chart", "body", body))
                    content_pieces.append(body)
                for pt in series_of(slide):
                    slide_issues.extend(check_field_limits("chart", "label", str(pt.get("label", ""))))
                    slide_issues.extend(check_field_limits("chart", "value", str(pt.get("value_raw", ""))))
                # The source note ("Source: Table 2") is not a fact; only its length and format are checked
                slide_issues.extend(check_field_limits("chart", "source_note", slide.get("source_note") or ""))
                content_pieces.append(chart_text(slide))
                slide_issues.extend(check_chart(slide, cited_quotes_list))

            elif s_type == "stat":
                num = str(slide.get("number", slide.get("stat_number", "")))
                body = slide.get("body", "")
                slide_issues.extend(check_field_limits("stat", "number", num))
                slide_issues.extend(check_field_limits("stat", "body", body))
                if not re.search(r"\d", num):
                    # the big number is the whole point of a stat slide; without it the slide is blank
                    slide_issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="STAT_NO_NUMBER",
                            message="Stat slide has no number; set 'number' to one number copied from a quote",
                            offending_text=num
                        )
                    )
                content_pieces.extend([num, body])

            elif s_type == "quote":
                body = slide.get("body", "")
                author = slide.get("author", slide.get("quote_author", ""))
                slide_issues.extend(check_field_limits("quote", "body", body))
                if author:
                    slide_issues.extend(check_field_limits("quote", "author", author))
                    content_pieces.append(author)
                content_pieces.append(body)

            elif s_type == "list":
                items = slide.get("items") or []
                if len(items) < 3 or len(items) > 4:
                    slide_issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="LIST_ITEM_COUNT",
                            message=f"List slide must have 3 to 4 items, got {len(items)}",
                            offending_text=str(len(items))
                        )
                    )
                for item in items:
                    slide_issues.extend(check_field_limits("list", "item", item))
                    content_pieces.append(item)

            elif s_type == "cover":
                # "..., but import" keeps the connector but not the caveat: a broken hook
                tail = re.search(r"\b(?:but|however|though|although|while)\b\W*(.*)$", headline, re.I)
                if tail and len(re.findall(r"[A-Za-z0-9₹$%]+", tail.group(1))) < 2:
                    slide_issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="COVER_CAVEAT_FRAGMENT",
                            message=f"Cover caveat '{tail.group(0)}' is cut off; give the whole clause (e.g. 'but machines are imported') or shorten the start",
                            offending_text=tail.group(0)
                        )
                    )
                # Check hook paid off
                for cc in cover_claims:
                    if cc not in later_claims:
                        slide_issues.append(
                            ValidationIssue(
                                severity="WARN",
                                code="HOOK_NOT_PAID_OFF",
                                message=f"Cover claim '{cc}' does not appear on any later slide",
                                offending_text=cc
                            )
                        )

            full_slide_content = "\n".join(content_pieces)

            # Factual checks against cited quotes
            slide_issues.extend(check_numbers(full_slide_content, cited_text, allowed_derived_counts))
            slide_issues.extend(check_quantifiers(full_slide_content, cited_text))
            slide_issues.extend(check_hedges(full_slide_content, cited_text))
            slide_issues.extend(check_scope(full_slide_content, cited_text))
            slide_issues.extend(check_ranges(full_slide_content, cited_text))
            slide_issues.extend(check_entities(full_slide_content, cited_text, full_source_text))
            slide_issues.extend(check_attribution(full_slide_content, claim_ids, claim_about or {}))
            slide_issues.extend(check_title_truncation(headline, cited_quotes_list + [doc_title]))

            # Table row pairing checks (a chart's labels are column headers by design; check_chart
            # already ties each value to its own label)
            all_tbl_quotes = [q for q in claims_by_id.values() if " | " in q and ":" in q]
            tbl_issues = [] if s_type == "chart" else validate_table_row_associations(
                full_slide_content, cited_quotes_list, all_table_quotes=all_tbl_quotes)
            for ti in tbl_issues:
                slide_issues.append(
                    ValidationIssue(
                        severity=ti["severity"],
                        code=ti["code"],
                        message=ti["message"],
                        offending_text=""
                    )
                )

        has_err = any(i.severity == "ERROR" for i in slide_issues)
        has_wrn = any(i.severity == "WARN" for i in slide_issues)
        for i in slide_issues:
            if i.severity == "ERROR":
                total_errors += 1
            else:
                total_warnings += 1

        slide_results.append(
            SlideValidationResult(
                slide_n=idx,
                slide_type=s_type,
                issues=[
                    {
                        "severity": i.severity,
                        "code": i.code,
                        "message": i.message,
                        "offending_text": i.offending_text,
                    }
                    for i in slide_issues
                ],
                has_error=has_err,
                has_warn=has_wrn
            )
        )

    return DeckValidationReport(
        is_valid=(total_errors == 0),
        total_errors=total_errors,
        total_warnings=total_warnings,
        slides=slide_results
    )
