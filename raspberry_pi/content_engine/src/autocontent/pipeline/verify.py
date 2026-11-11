"""Stage C: Verifier - strict factual verification of slides against cited quotes."""

import json
from pathlib import Path
from typing import List, Literal, Optional, Dict, Any
from pydantic import BaseModel

from ..llm.base import LLMClient
from ..llm.limiter import estimate_tokens
from .. import tuning

VerdictKind = Literal["supported", "partial", "unsupported"]


class Verdict(BaseModel):
    slide_n: int
    verdict: VerdictKind
    unsupported_phrases: List[str]
    note: str


class VerifierReport(BaseModel):
    verdicts: List[Verdict]


VERIFIER_SYSTEM_PROMPT = """You are a strict fact-checker. For each slide you get the slide text and the only source quotes it may rely on.
Decide whether EVERY claim in the slide text is directly supported by the quotes.
- "supported": every statement is supported; wording may be shorter or different but the meaning is the same, including caveats.
- "partial": some phrase adds meaning, causation, scope or emphasis that the quotes do not contain.
- "unsupported": a statement contradicts or is absent from the quotes.
List the exact slide phrases that are not supported. Be strict about: dropped caveats, "some" turned into "most", correlation turned into cause, new numbers, new names, promises about outcomes.
Return JSON only, matching the schema."""


def _format_slide_verification(idx: int, s: Dict[str, Any], claims_by_id: Dict[str, str]) -> str:
    cids = s.get("claim_ids") or []
    cited_text = "\n".join(f"- [{cid}] {claims_by_id.get(cid, '')}" for cid in cids if cid in claims_by_id)

    slide_pieces = [s.get("headline", "")]
    if s.get("body"):
        slide_pieces.append(s["body"])
    if s.get("number"):
        slide_pieces.append(str(s["number"]))
    if s.get("bullets"):
        slide_pieces.extend(s["bullets"])
    if s.get("items"):
        slide_pieces.extend(s["items"])
    if s.get("series"):
        kind = s.get("chart_kind", "chart")
        slide_pieces.append(f"{kind} chart: " + "; ".join(f"{p.get('label')}: {p.get('value_raw')}" for p in s["series"]))
    content_text = " | ".join(slide_pieces)

    return (
        f"Slide {idx} (type: {s.get('type')}):\n"
        f"Slide Text: {content_text}\n"
        f"Cited Quotes:\n{cited_text}\n"
    )


def verify_slides(
    slides: List[Dict[str, Any]],
    claims_by_id: Dict[str, str],
    llm: LLMClient,
    out_dir: Optional[Path] = None
) -> VerifierReport:
    """Verify slides against ONLY their cited quotes, batching calls <= 3,000 tokens."""
    # Filter non-cta slides with their 1-based index
    target_slides = [(idx, s) for idx, s in enumerate(slides, start=1) if s.get("type") != "cta"]
    if not target_slides:
        return VerifierReport(verdicts=[])

    # Group into batches where estimated tokens <= 3000
    batches: List[List[Tuple[int, Dict[str, Any]]]] = []
    current_batch: List[Tuple[int, Dict[str, Any]]] = []
    current_tokens = estimate_tokens(VERIFIER_SYSTEM_PROMPT)

    for idx, s in target_slides:
        slide_text = _format_slide_verification(idx, s, claims_by_id)
        tokens = estimate_tokens(slide_text)
        if current_tokens + tokens > 3000 and current_batch:
            batches.append(current_batch)
            current_batch = [(idx, s)]
            current_tokens = estimate_tokens(VERIFIER_SYSTEM_PROMPT) + tokens
        else:
            current_batch.append((idx, s))
            current_tokens += tokens

    if current_batch:
        batches.append(current_batch)

    all_verdicts: List[Verdict] = []
    total_slides_count = len(slides)

    for b_idx, batch in enumerate(batches, start=1):
        user_message = "\n".join(_format_slide_verification(idx, s, claims_by_id) for idx, s in batch)
        stage_name = f"verify_slides_batch_{b_idx}" if len(batches) > 1 else "verify_slides"

        report: VerifierReport = llm.generate_json(
            system=tuning.with_notes(VERIFIER_SYSTEM_PROMPT, "verify"),
            user=user_message,
            schema=VerifierReport,
            temperature=tuning.temperature("verify"),
            stage=stage_name,
            log_dir=out_dir
        )

        for v in report.verdicts:
            # Ignore verdicts out of range
            if 1 <= v.slide_n <= total_slides_count:
                all_verdicts.append(v)

    # Synthesise missing verdicts for non-CTA slides (F3.2)
    verdict_by_slide = {v.slide_n: v for v in all_verdicts}
    final_verdicts: List[Verdict] = []

    for idx, s in target_slides:
        if idx in verdict_by_slide:
            final_verdicts.append(verdict_by_slide[idx])
        else:
            final_verdicts.append(
                Verdict(
                    slide_n=idx,
                    verdict="unsupported",
                    unsupported_phrases=[],
                    note="Verifier returned no verdict for this slide"
                )
            )

    combined_report = VerifierReport(verdicts=final_verdicts)

    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        with open(out_dir / "04_verify.json", "w", encoding="utf-8") as f:
            json.dump(combined_report.model_dump(), f, indent=2, ensure_ascii=False)

    return combined_report
