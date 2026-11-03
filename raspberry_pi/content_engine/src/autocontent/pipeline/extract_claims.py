"""Stage A: Verbatim quote / claim extraction from numbered units with chunking."""

import json
import re
from pathlib import Path
from typing import List, Literal, Optional, Tuple, Dict
from pydantic import BaseModel

from ..ingest.units import Unit
from ..validators.quotes import verify_quote
from ..validators.normalize import norm
from ..validators.attribution import key_entities, claim_subjects
from ..llm.base import LLMClient
from .chunking import chunk_units, cap_claims
from .distill import hierarchical_chunk_units, distill_claims
from ..progress import report
from .. import tuning

ClaimKind = Literal[
    "finding", "number", "recommendation", "definition",
    "contrast", "example", "context"
]


class RawClaim(BaseModel):
    unit_id: str
    quote: str
    kind: ClaimKind


class ClaimList(BaseModel):
    claims: List[RawClaim]


class Claim(BaseModel):
    id: str  # e.g. "C01"
    unit_id: str
    quote: str
    kind: Optional[ClaimKind] = "finding"
    about: List[str] = []  # entities the claim is about ("Zebronics"), see validators.attribution


SYSTEM_PROMPT_TEMPLATE = """You are a precise quote extractor for a business social-media team.
You receive a document split into numbered units, formatted as: [U001] text.
Your job: {claim_target_instruction} that would make the most useful and interesting points for an Instagram carousel for business readers.

STRICT RULES
1. Each quote MUST be copied character-for-character from ONE unit. Do not fix typos. Do not change punctuation or numbers. Do not combine two units. Do not paraphrase.
2. Each quote is between 3 and 40 words. A complete sentence is preferred, but a clause is allowed if it is copied exactly.
3. Prefer: concrete findings with numbers, surprising contrasts, clear recommendations, definitions, specific examples.
4. Avoid: boilerplate, tables of contents, author bios, references, legal disclaimers, page furniture.
5. If the document is short, return fewer quotes. Never invent text to reach 12.
6. Keep any caveat or limitation that is attached to a finding (words like "may", "some", "did not test", "coincidence", "small sample", "not verified") inside the quote. If a finding and its caveat are in the same sentence or adjacent clauses, keep them together in ONE quote; never split them.
7. Context makes numbers teachable: when you pick numbers from a list or breakdown (costs, prices, specs), also pick the sentence that says what they are about (e.g. "Let's price one 500 ml bottle made in a single shift:") as kind "context", and pick every item of the breakdown, small ones included, so no total is shown without its parts.
8. "kind" must be one of: finding, number, recommendation, definition, contrast, example, context.
9. Return JSON only, matching the schema."""


def _source_span(quote: str, unit_text: str) -> Optional[str]:
    """The exact text of unit_text that quote copies, allowing only a different quote
    character ("Micro-Factory" vs 'Micro-Factory') and spacing; None when it is not there."""
    parts = []
    for ch in " ".join(quote.split()):
        if ch in "\"'“”‘’`":
            parts.append("[\"'“”‘’`]")
        elif ch.isspace():
            parts.append(r"\s+")
        else:
            parts.append(re.escape(ch))
    m = re.search("".join(parts), unit_text, re.I)
    return m.group(0) if m else None


def extract_claims(
    units: List[Unit],
    llm: LLMClient,
    out_dir: Optional[Path] = None,
    entities: Optional[List[str]] = None
) -> Tuple[List[Claim], List[Dict]]:
    """Extract claims using LLM with chunking and strictly verify quotes against source units.
    Writes 02_claims.json, 02_claims_rejected.json, and per-chunk files if out_dir is provided.
    """
    units_by_id = {u.id: u.text for u in units}
    units_obj_map = {u.id: u for u in units}
    cfg = tuning.load()["extract_claims"]
    chunk_tuples = hierarchical_chunk_units(units, max_input_tokens=cfg["chunk_max_input_tokens"])
    chunks = [c[1] for c in chunk_tuples] if chunk_tuples else [units]

    raw_claims_all: List[RawClaim] = []

    for idx, chunk in enumerate(chunks, start=1):
        lo, hi = cfg["quotes_single_chunk"] if len(chunks) == 1 else cfg["quotes_per_chunk"]
        target_instruction = f"choose between {lo} and {hi} quotes"

        sys_prompt = tuning.with_notes(SYSTEM_PROMPT_TEMPLATE.format(claim_target_instruction=target_instruction), "extract_claims")
        user_message = "\n".join(f"[{u.id}] {u.text}" for u in chunk)

        if len(chunks) > 1:
            report(f"Extracting claims: chunk {idx} of {len(chunks)} ({len(chunk)} units)...")
        claim_list: ClaimList = llm.generate_json(
            system=sys_prompt,
            user=user_message,
            schema=ClaimList,
            temperature=tuning.temperature("extract_claims"),
            stage=f"extract_claims_chunk_{idx}" if len(chunks) > 1 else "extract_claims",
            log_dir=out_dir
        )

        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)
            chunk_file = out_dir / f"02_claims_chunk_{idx}.json"
            with open(chunk_file, "w", encoding="utf-8") as f:
                json.dump(claim_list.model_dump(), f, indent=2, ensure_ascii=False)

        raw_claims_all.extend(claim_list.claims)

    accepted_claims: List[Claim] = []
    rejected_claims: List[Dict] = []
    seen_quotes = set()

    for raw in raw_claims_all:
        unit_text = units_by_id.get(raw.unit_id)
        if not unit_text:
            rejected_claims.append({
                "raw_claim": raw.model_dump(),
                "reason": f"unit_id '{raw.unit_id}' not found in source document units"
            })
            continue

        if not verify_quote(raw.quote, unit_text):
            # The model often swaps the source's double quotes for single ones (or back) to
            # keep its JSON simple; keep the claim with the source's own wording.
            span = _source_span(raw.quote, unit_text)
            if span and verify_quote(span, unit_text):
                raw.quote = span
        if not verify_quote(raw.quote, unit_text):
            rejected_claims.append({
                "raw_claim": raw.model_dump(),
                "reason": "quote failed exact substring or length (3-60 words) verification against unit"
            })
            continue

        normalized_quote = norm(raw.quote)
        if normalized_quote in seen_quotes:
            # Drop duplicate quote
            continue
        seen_quotes.add(normalized_quote)

        # Temporary claim object for ranking/capping
        accepted_claims.append(
            Claim(
                id="C00",
                unit_id=raw.unit_id,
                quote=raw.quote,
                kind=raw.kind
            )
        )

    # Cap total at 30 if needed (hierarchical section prioritization, de-duplication, and kind priority)
    if len(accepted_claims) > 30:
        accepted_claims = distill_claims(accepted_claims, units_obj_map, max_claims=30)

    # Renumber globally in document order: C01, C02, ...
    # and record whom each claim is about (its own names, else its section heading's)
    if entities is None:
        entities = key_entities([u.text for u in units], [u.text for u in units if u.kind == "heading"])
    for i, c in enumerate(accepted_claims, start=1):
        c.id = f"C{i:02d}"
        src_unit = units_obj_map.get(c.unit_id)
        c.about = claim_subjects(c.quote, src_unit.section if src_unit else None, entities)

    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        with open(out_dir / "02_claims.json", "w", encoding="utf-8") as f:
            json.dump([c.model_dump() for c in accepted_claims], f, indent=2, ensure_ascii=False)
        with open(out_dir / "02_claims_rejected.json", "w", encoding="utf-8") as f:
            json.dump(rejected_claims, f, indent=2, ensure_ascii=False)

    return accepted_claims, rejected_claims
