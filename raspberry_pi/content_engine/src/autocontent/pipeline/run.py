"""End-to-end pipeline execution and orchestration."""

from datetime import datetime
import json
import os
from pathlib import Path
import random
import sys
from typing import List, Dict, Any, Optional, Tuple

from ..settings import load_brand_config, BrandConfig, OUTPUT_DIR, get_env_setting
from ..ingest.reader import read_document
from ..ingest.units import to_units, Unit
from ..validators.deck import validate_deck, DeckValidationReport
from ..llm.base import LLMClient, LLMUnavailable, LLMBadOutput, LLMRequestTooLarge
from .extract_claims import extract_claims, Claim
from .compose import compose_deck, deck_to_slides, Deck, SlideDraft
from .verify import verify_slides, VerifierReport, Verdict
from .extractive import build_extractive_deck, fallback_slide_from_claims, doc_entities, add_source_charts
from .chunking import check_word_limit
from .salvage import salvage_slides
from ..validators.limits import check_field_limits
from ..validators.hedges import CAVEAT_CONNECTORS
from ..progress import report, listening, reset as reset_progress, ProgressFn


def _model_label(llm: Any, role: str) -> str:
    """Readable provider/model name for progress lines, e.g. 'Groq openai/gpt-oss-20b'."""
    provider_name = type(llm).__name__.replace("Client", "")
    model = getattr(llm, f"{role}_model", None) or getattr(llm, "model", None)
    return f"{provider_name} {model}" if model else provider_name


def _hook_payoff_warnings(slides: List[Dict[str, Any]]) -> List[str]:
    """WARN when a number in the cover headline is not repeated on any later content slide."""
    import re
    cover = next((s for s in slides if s.get("type") == "cover"), None)
    if cover is None:
        return []
    # "3D" in "3D printed" is a name, not a figure
    numbers = re.findall(r"(?<![\w.,])\d[\d,]*(?:\.\d+)?(?![A-Za-z])", cover.get("headline", ""))
    # a year ("by 2030") dates the hook; it is not a figure the deck has to explain
    numbers = [n for n in numbers if not re.fullmatch(r"(?:19|20)\d\d", n)]
    if not numbers:
        return []
    later = []
    for s in slides:
        if s is cover or s.get("type") == "cta":
            continue
        later += [s.get(f) or "" for f in ("headline", "body", "number")]
        later += s.get("bullets") or []
        later += s.get("items") or []
        later += [p.get("value_raw", "") for p in s.get("series") or []]
    text = " ".join(later)
    missing = [n for n in numbers if not re.search(r"(?<![\d.,])" + re.escape(n) + r"(?![\d]|[.,]\d)", text)]
    return [f"WARN [HOOK_NOT_PAID_OFF]: cover number '{n}' does not appear on any later slide" for n in missing]


REPAIR_WARN_CODES = ("HOOK_NOT_PAID_OFF", "DUPLICATE_CLAIM", "CHART_PART_AND_TOTAL")


def _stat_from_claim(claim: Claim, numbers: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
    """A stat slide built only from one quote: its number as written (the first one, or the one
    starting with one of `numbers`) and the quote's sentence with its caveat as the body
    ("India's 3D printed exports grew ... 151% CAGR recently, but we rely heavily on imported
    machines."). None when the quote has no number or that body is over the stat limit."""
    from ..validators.numbers import extract_number_mentions
    from ..validators.limits import get_limit
    from .caption import _caveat_excerpt

    mentions = [m for m in extract_number_mentions(claim.quote) if m.cls != "year"]
    if numbers:
        mentions = [m for m in mentions if any(m.raw.lstrip("₹$€£~ ").startswith(n) for n in numbers)]
    if not mentions:
        return None
    body = _caveat_excerpt(claim.quote).rstrip(" .!") + "."
    max_words, max_chars = get_limit("stat", "body")
    if len(body.split()) > max_words or len(body) > max_chars:
        return None
    number = mentions[0].raw.strip()
    return {
        "type": "stat",
        "headline": f"Behind the {number}",
        "number": number,
        "body": body,
        "claim_ids": [claim.id],
        "source_status": "extractive_fallback",
    }


def _pay_off_cover(
    slides: List[Dict[str, Any]],
    claims_by_id: Dict[str, Claim],
    full_source_text: str,
    doc_title: Optional[str],
) -> Optional[str]:
    """When the cover's number is never picked up again, put a stat slide for it at slide 2:
    the number as written in the cover's own quote, and that quote's sentence with its caveat
    as the body. It replaces the content slide that teaches least (one whose facts are on other
    slides, then the one with fewest numbers, findings and examples; never a chart). Undone if
    the deck then fails validation. Returns a note, or None when nothing changed."""
    import re

    if not _hook_payoff_warnings(slides) or len(slides) < 3 or slides[0].get("type") != "cover":
        return None
    cover = slides[0]
    numbers = re.findall(r"(?<![\w.,])\d[\d,]*(?:\.\d+)?(?![A-Za-z])", cover.get("headline", ""))
    for cid in cover.get("claim_ids") or []:
        claim = claims_by_id.get(cid)
        stat = _stat_from_claim(claim, numbers) if claim is not None else None
        if stat is None:
            continue
        number = stat["number"]

        def keep_score(k: int) -> Tuple[int, int, int]:
            s = slides[k]
            elsewhere = {c for j, o in enumerate(slides) if j not in (0, k) for c in o.get("claim_ids") or []}
            ids = s.get("claim_ids") or []
            teaching = sum(1 for c in ids if c in claims_by_id
                           and claims_by_id[c].kind in ("number", "finding", "example", "contrast"))
            return (0 if ids and set(ids) <= elsewhere else 1, teaching, len(ids))

        options = [k for k in range(1, len(slides)) if slides[k].get("type") not in ("chart", "cta", "cover")]
        if not options:
            return None
        drop = min(options, key=keep_score)
        trial = [s for k, s in enumerate(slides) if k != drop]
        trial.insert(1, stat)
        check = validate_deck(trial + [{"type": "cta", "headline": "x"}],
                              {i: c.quote for i, c in claims_by_id.items()}, full_source_text,
                              {i: c.about for i, c in claims_by_id.items()}, doc_title)
        if check.slides[1].has_error:  # the new stat slide must pass every check on its own
            continue
        dropped = slides[drop].get("headline", "")
        slides[:] = trial
        return f"INFO [HOOK_PAID_OFF]: added a stat slide for the cover's {number} at slide 2 (replaced '{dropped}')"
    return None


def _report_validation(val_report: DeckValidationReport, label: str) -> None:
    """One progress line per slide: OK / WARN / FAIL with the issue codes."""
    for res in val_report.slides:
        errors = list(dict.fromkeys(i["code"] for i in res.issues if i["severity"] == "ERROR"))
        warns = list(dict.fromkeys(i["code"] for i in res.issues if i["severity"] != "ERROR"))
        if errors:
            report(f"{label} slide {res.slide_n}: FAIL ({', '.join(errors)})")
        elif warns:
            report(f"{label} slide {res.slide_n}: WARN ({', '.join(warns)})")
        else:
            report(f"{label} slide {res.slide_n}: OK")


def _build_grounding_report(
    slides: List[Dict[str, Any]],
    claims_by_id: Dict[str, Claim],
    val_report: DeckValidationReport,
    final_verdicts: Dict[int, Verdict],
    mode_used: str,
    source_filename: str,
    warnings: Optional[List[str]] = None,
    not_included: Optional[List[Dict[str, str]]] = None,
    fallback_info: Optional[Dict[int, str]] = None,
    caption: Optional[str] = None
) -> str:
    """Generate Markdown grounding report readable by human editors."""
    lines: List[str] = [
        "# Mind Deeds Grounding & Fact Verification Report",
        f"- **Source File:** `{source_filename}`",
        f"- **Mode Used:** `{mode_used}`",
        f"- **Generated At:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
    ]

    # Notes section at top
    if warnings:
        lines.append("## Notes")
        for w in warnings:
            lines.append(f"- [!] {w}")
        lines.append("")

    lines.extend([
        "## Summary",
        "| Slide # | Type | Status | Issues | Source Status |",
        "|---|---|---|---|---|"
    ])

    val_by_n = {res.slide_n: res for res in val_report.slides}
    slide_details: List[str] = ["", "## Slide-by-Slide Details", ""]

    fb_map = fallback_info or {}

    for idx, s in enumerate(slides, start=1):
        s_type = s.get("type", "unknown")
        src_status = s.get("source_status", "unknown")
        v_res = val_by_n.get(idx)
        verdict = final_verdicts.get(idx)

        has_err = v_res.has_error if v_res else False
        has_wrn = v_res.has_warn if v_res else False
        if verdict and verdict.verdict != "supported":
            has_err = True

        status = "FAIL" if has_err else ("WARN" if has_wrn else "PASS")
        issue_count = len(v_res.issues) if v_res else 0

        lines.append(f"| {idx} | {s_type} | **{status}** | {issue_count} | `{src_status}` |")

        # Details
        slide_details.append(f"### Slide {idx} ({s_type}) - Status: {status}")
        slide_details.append(f"- **Headline:** {s.get('headline', '')}")
        if s.get("body"):
            slide_details.append(f"- **Body:** {s['body']}")
        if s.get("number"):
            slide_details.append(f"- **Number:** {s['number']}")
        for key, label in (("bullets", "Bullets"), ("items", "Items")):
            if s.get(key):
                slide_details.append(f"- **{label}:**")
                for itm in s[key]:
                    slide_details.append(f"  - {itm}")
        if s.get("series"):
            slide_details.append(f"- **Chart ({s.get('chart_kind')}):** " + "; ".join(
                f"{p.get('label')} = {p.get('value_raw')}" for p in s["series"]))
            if s.get("source_note"):
                slide_details.append(f"  - {s['source_note']}")

        slide_details.append(f"- **Source Status:** `{src_status}`")

        cids = s.get("claim_ids") or []
        if cids:
            slide_details.append("- **Cited Claims:**")
            for cid in cids:
                claim_obj = claims_by_id.get(cid)
                if claim_obj:
                    slide_details.append(f"  - `[{cid}]` (from unit `{claim_obj.unit_id}`): \"{claim_obj.quote}\"")
                else:
                    slide_details.append(f"  - `[{cid}]`: (unknown)")
        else:
            slide_details.append("- **Cited Claims:** None (system or CTA)")

        if v_res and v_res.issues:
            slide_details.append("- **Validator Issues:**")
            for iss in v_res.issues:
                off = f" (offending: '{iss['offending_text']}')" if iss.get("offending_text") else ""
                slide_details.append(f"  - **{iss['severity']}** [{iss['code']}]: {iss['message']}{off}")

        if idx in fb_map:
            slide_details.append(f"- **Fallback Notice:** Replaced by extractive fallback. Reason: {fb_map[idx]}")
        elif verdict:
            slide_details.append(f"- **Verifier Verdict:** `{verdict.verdict}`")
            if verdict.unsupported_phrases:
                slide_details.append(f"  - Unsupported phrases: {verdict.unsupported_phrases}")
            if verdict.note:
                slide_details.append(f"  - Note: {verdict.note}")

        slide_details.append("")

    # Not included section at the end (D5)
    if not_included:
        slide_details.append("## Not included in this deck")
        slide_details.append(
            f"The following {len(not_included)} content items from the source document were not selected for this deck:"
        )
        for item in not_included:
            slide_details.append(f"- `[{item['unit_id']}]` {item['text']}")
        slide_details.append("")

    if caption:
        slide_details.extend([
            "## Instagram Caption",
            "```text",
            caption,
            "```",
            ""
        ])

    return "\n".join(lines + slide_details)


def run_pipeline(
    file_path: str | Path,
    mode: str = "auto",
    slide_count: int = 8,
    tag: Optional[str] = None,
    no_llm: bool = False,
    allow_fail: bool = False,
    out_dir: Optional[Path] = None,
    llm: Optional[LLMClient] = None,
    provider: Optional[str] = None,
    style: str = "beige_grain",
    canvas_format: str = "portrait",
    progress: Optional[ProgressFn] = None
) -> Tuple[Path, Dict[str, Any], str]:
    """Execute the Mind Deeds content generation pipeline.
    `progress` receives one short line per stage; by default lines go to stderr.
    Returns: (output_folder_path, slides_dict, grounding_report_text)
    """
    reset_progress()
    with listening(progress):
        return _run_pipeline(
            file_path, mode, slide_count, tag, no_llm, allow_fail, out_dir, llm, provider, style, canvas_format
        )


def _run_pipeline(
    file_path: str | Path,
    mode: str,
    slide_count: int,
    tag: Optional[str],
    no_llm: bool,
    allow_fail: bool,
    out_dir: Optional[Path],
    llm: Optional[LLMClient],
    provider: Optional[str],
    style: str,
    canvas_format: str
) -> Tuple[Path, Dict[str, Any], str]:
    path = Path(file_path).resolve()
    brand: BrandConfig = load_brand_config()
    chosen_tag = tag or brand.default_tag

    # Determine output folder
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_out = out_dir or (OUTPUT_DIR / f"{path.stem}_{timestamp}")
    target_out.mkdir(parents=True, exist_ok=True)

    # 1. Read document
    report(f"Reading document {path.name}...")
    raw_doc = read_document(path)
    report("Splitting document into units...")
    units, total_words = to_units(raw_doc)
    report(f"Document has {total_words} words in {len(units)} units")

    # Hard cap check
    check_word_limit(total_words, max_words=25000)

    full_source_text = " ".join(u.text for u in units)
    entities = doc_entities(units)
    if entities:
        report(f"Named subjects: {', '.join(entities)}")

    # Write 01_units.json
    with open(target_out / "01_units.json", "w", encoding="utf-8") as f:
        json.dump([u.model_dump() for u in units], f, indent=2, ensure_ascii=False)

    # 2. Determine mode
    content_slides = max(1, slide_count - 2)
    mode_chosen = mode
    mode_reason = ""

    if no_llm:
        mode_chosen = "keep"
        mode_reason = "--no-llm flag specified; using extractive fallback"
    elif mode == "auto":
        # Mode logic: word_count <= content_slides * 30 -> keep, else summarize
        if total_words <= content_slides * 30:
            mode_chosen = "keep"
            mode_reason = f"Word count ({total_words}) <= {content_slides} * 30 ({content_slides * 30}); using keep mode"
        else:
            mode_chosen = "summarize"
            mode_reason = f"Word count ({total_words}) > {content_slides} * 30; using summarize mode"
    elif mode == "keep":
        mode_reason = "Explicitly requested keep mode"
    else:
        mode_reason = "Explicitly requested summarize mode"
    report(f"Mode: {mode_chosen} ({mode_reason})")

    warnings_list: List[str] = []
    not_included_items: List[Dict[str, str]] = []
    final_verdicts: Dict[int, Verdict] = {}
    fallback_info: Dict[int, str] = {}
    fallback_log: List[Dict[str, Any]] = []

    final_slides: List[Dict[str, Any]] = []
    all_claims: List[Claim] = []
    claims_by_id: Dict[str, Claim] = {}

    if mode_chosen == "keep":
        # Extractive mode
        report(f"Building extractive deck of {content_slides} content slides (no AI)...")
        slides_drafts, syn_claims, warnings, not_included = build_extractive_deck(
            units, content_slides, chosen_tag, doc_title=raw_doc.title, entities=entities
        )
        report(f"Extractive deck built from {len(syn_claims)} source sentences; {len(not_included)} not included")
        final_slides = slides_drafts
        all_claims = syn_claims
        claims_by_id = {c.id: c for c in all_claims}
        warnings_list.extend(warnings)
        not_included_items = not_included

        if not_included:
            total_content_count = len(not_included) + sum(len(s.get("claim_ids", [])) for s in slides_drafts)
            print(
                f"WARNING: {len(not_included)} of {total_content_count} content sentences were not included. "
                f"Use --slides 9 or --mode summarize to cover more."
            )

    else:
        # Summarize mode with LLM
        if llm is None:
            # get_env_setting also loads .env, so the API key is found even when --provider is given
            chosen_provider = (provider or "").lower() or get_env_setting("LLM_PROVIDER", "groq").lower()
            if provider:
                get_env_setting("LLM_PROVIDER")
            if chosen_provider == "ollama":
                from ..llm.ollama import OllamaClient
                llm = OllamaClient()
            elif chosen_provider == "gemini":
                from ..llm.gemini import GeminiClient
                llm = GeminiClient()
            else:
                from ..llm.groq import GroqClient
                llm = GroqClient()

        # Step A: extract claims
        report(f"Extracting claims from {len(units)} units with {_model_label(llm, 'extract')}...")
        try:
            claims, rejected = extract_claims(units, llm, out_dir=target_out, entities=entities)
        except Exception as e:
            msg = f"AI provider extraction failed: {e}. Re-run with --no-llm for an extractive deck."
            print(msg, file=sys.stderr)
            with open(target_out / "FAILED.txt", "w", encoding="utf-8") as f:
                f.write(msg + "\n")
            sys.exit(3)

        all_claims = claims
        claims_by_id = {c.id: c for c in all_claims}
        report(f"Claims: {len(claims)} accepted, {len(rejected)} rejected (quote did not match the source)")

        if len(claims) < 6:
            # Fall back to extractive if not enough verifiable claims
            report(f"Fallback: only {len(claims)} verifiable claims (need 6); building extractive deck instead")
            slides_drafts, syn_claims, warnings, not_included = build_extractive_deck(
                units, content_slides, chosen_tag, doc_title=raw_doc.title, entities=entities
            )
            final_slides = slides_drafts
            all_claims = syn_claims
            claims_by_id = {c.id: c for c in all_claims}
            warnings_list.extend(warnings)
            not_included_items = not_included
            for s in final_slides:
                s["source_status"] = "extractive_fallback"
        else:
            # Step B: compose
            report(f"Composing {content_slides} slides with {_model_label(llm, 'compose')}...")
            try:
                deck = compose_deck(all_claims, content_slides, chosen_tag, llm, out_dir=target_out)
            except Exception as e:
                msg = f"AI provider composition failed: {e}. Re-run with --no-llm for an extractive deck."
                print(msg, file=sys.stderr)
                with open(target_out / "FAILED.txt", "w", encoding="utf-8") as f:
                    f.write(msg + "\n")
                sys.exit(3)

            working_slides: List[Dict[str, Any]] = deck_to_slides(deck, {c.id: c for c in all_claims})
            for note in salvage_slides(working_slides, claims_by_id):
                report(f"Fix: {note}")

            # Append temporary CTA slide for sequence validation
            cta_draft = {
                "type": "cta",
                "headline": brand.cta_headline,
                "handle": brand.handle,
                "subtext": brand.cta_subtext,
                "claim_ids": [],
                "source_status": "system"
            }
            deck_with_cta = working_slides + [cta_draft]

            claims_map_str = {c.id: c.quote for c in all_claims}
            claim_about = {c.id: c.about for c in all_claims}
            report("Validating composed slides against the source...")
            val_report = validate_deck(deck_with_cta, claims_map_str, full_source_text, claim_about, raw_doc.title)
            _report_validation(val_report, "Validation")

            # Step C: Verifier call with error protection
            verifier_available = True
            verifier_report: Optional[VerifierReport] = None
            report(f"Verifying slides with {_model_label(llm, 'verify')}...")
            try:
                verifier_report = verify_slides(working_slides, claims_map_str, llm, out_dir=target_out)
                for v in verifier_report.verdicts:
                    final_verdicts[v.slide_n] = v
                    report(f"Verifier slide {v.slide_n}: {v.verdict}")
            except (LLMUnavailable, LLMBadOutput, Exception) as e:
                verifier_available = False
                warn_msg = f"AI_VERIFIER_UNAVAILABLE: Verifier failed ({e}). Using deterministic validation only."
                print(f"[!] Warning: {warn_msg}", file=sys.stderr)
                report("Verifier unavailable; using deterministic validation only")
                warnings_list.append(warn_msg)

            # Check if any slide failed
            failing_slides = []
            repair_notes = []

            for res in val_report.slides[:-1]:  # Exclude CTA
                idx = res.slide_n
                v_match = final_verdicts.get(idx)
                reasons = []
                if res.has_error:
                    reasons.extend([f"Validator Error: {iss['message']}" for iss in res.issues if iss['severity'] == "ERROR"])
                if v_match and v_match.verdict in ("partial", "unsupported"):
                    unsupp = ", ".join(v_match.unsupported_phrases) if v_match.unsupported_phrases else "Unverified claims"
                    reasons.append(f"Verifier rejected ({v_match.verdict}): {unsupp}. Note: {v_match.note}")

                # Story problems (a cover number never explained, a fact told twice, a chart that
                # double-counts) are warnings, but worth one recompose with the reason spelled out
                reasons.extend([f"Fix: {iss['message']}" for iss in res.issues if iss['code'] in REPAIR_WARN_CODES])

                if reasons:
                    failing_slides.append(idx)
                    repair_notes.append(f"Slide {idx}:\n  " + "\n  ".join(reasons))

            if len(working_slides) < content_slides + 1:
                unused = [c.id for c in all_claims if not any(c.id in (s.get("claim_ids") or []) for s in working_slides)]
                failing_slides.append(len(working_slides) + 1)
                repair_notes.append(
                    f"Deck: you wrote {len(working_slides)} slides; write exactly {content_slides + 1} "
                    f"(cover + {content_slides}). Unused quotes: {', '.join(unused) or 'none'}.")

            # Repair loop (max once)
            if failing_slides:
                feedback = "\n".join(repair_notes)
                report(f"Repair attempt: slides {failing_slides} failed checks; recomposing with feedback...")
                try:
                    repaired_deck = compose_deck(
                        all_claims,
                        content_slides,
                        chosen_tag,
                        llm,
                        repair_feedback=feedback,
                        out_dir=target_out,
                        stage_suffix="_repair"
                    )
                    working_slides = deck_to_slides(repaired_deck, {c.id: c for c in all_claims})
                    for note in salvage_slides(working_slides, claims_by_id):
                        report(f"Fix: {note}")
                except Exception as e:
                    print(f"Repair compose failed ({e}). Proceeding to extractive fallback...", file=sys.stderr)

                deck_with_cta = working_slides + [cta_draft]
                val_report = validate_deck(deck_with_cta, claims_map_str, full_source_text, claim_about, raw_doc.title)
                _report_validation(val_report, "Validation after repair:")

                if verifier_available:
                    report("Re-verifying repaired slides...")
                    try:
                        rep_verify = verify_slides(working_slides, claims_map_str, llm, out_dir=target_out)
                        for v in rep_verify.verdicts:
                            final_verdicts[v.slide_n] = v
                            report(f"Verifier slide {v.slide_n}: {v.verdict}")
                    except Exception as e:
                        print(f"Verifier call on repair failed: {e}", file=sys.stderr)

                # Final fallback for any still failing slides (F3.1)
                for res in val_report.slides[:-1]:
                    idx = res.slide_n
                    v_match = final_verdicts.get(idx)
                    is_bad = res.has_error or (v_match and v_match.verdict in ("partial", "unsupported"))
                    if is_bad:
                        has_dropped_caveat = any(iss.get('code') == 'CAVEAT_DROPPED' for iss in res.issues)
                        if has_dropped_caveat:
                            warnings_list.append(f"WARN [CAVEAT_DROPPED]: Finding on slide {idx} lacked required caveat from source; replaced with full-context fallback.")
                        slide_to_replace = working_slides[idx - 1]
                        cids = slide_to_replace.get("claim_ids") or []
                        fb_slide, fb_reason = fallback_slide_from_claims(
                            slide_index=idx - 1,
                            claim_ids=cids,
                            claims_by_id=claims_by_id,
                            units=units,
                            doc_title=raw_doc.title,
                            entities=entities,
                            exclude_ids={c for k, s in enumerate(working_slides) if k != idx - 1
                                         for c in (s.get("claim_ids") or [])}
                        )
                        # A failed stat slide stays a stat: its number and the quote's own sentence
                        # (with its caveat) read far better than the whole quote pasted as a paragraph
                        if slide_to_replace.get("type") == "stat":
                            for cid in cids:
                                stat = _stat_from_claim(claims_by_id[cid]) if cid in claims_by_id else None
                                if stat is None:
                                    continue
                                own = slide_to_replace.get("headline") or ""
                                if own and not check_field_limits("stat", "headline", own):
                                    stat["headline"] = own
                                trial = working_slides[:idx - 1] + [stat] + working_slides[idx:] + [cta_draft]
                                chk = validate_deck(trial, claims_map_str, full_source_text, claim_about, raw_doc.title)
                                if not chk.slides[idx - 1].has_error:
                                    fb_slide, fb_reason = stat, "Stat rebuilt from its cited quote's own sentence"
                                    break
                        # Check if fallback slide text has caveat
                        fb_text = " ".join([fb_slide.get("headline", ""), fb_slide.get("body") or ""] + list(fb_slide.get("bullets") or []) + list(fb_slide.get("items") or []))
                        if has_dropped_caveat and not any(c in fb_text.lower() for c in CAVEAT_CONNECTORS):
                            # Caveat could not be fit: demote finding to not_included
                            for cid in cids:
                                clm = claims_by_id.get(cid)
                                if clm:
                                    not_included_items.append({"unit_id": clm.unit_id, "text": clm.quote})
                            warnings_list.append(f"WARN [CAVEAT_DROPPED]: Finding from slide {idx} demoted to not_included because caveat could not be fit.")
                        # Two fallbacks from one source section get the same section heading
                        # ("The Math" twice); keep the composer's headline instead when it fits
                        taken = {s.get("headline", "").lower() for k, s in enumerate(working_slides) if k != idx - 1}
                        own = slide_to_replace.get("headline") or ""
                        if idx > 1 and fb_slide.get("headline", "").lower() in taken and own and own.lower() not in taken \
                                and not check_field_limits(fb_slide.get("type", "point"), "headline", own):
                            fb_slide["headline"] = own
                        working_slides[idx - 1] = fb_slide
                        fallback_info[idx] = fb_reason
                        report(f"Fallback: slide {idx} replaced with source sentences ({fb_reason})")
                        # Remove stale verifier verdict (F3.5)
                        if idx in final_verdicts:
                            del final_verdicts[idx]

                        reasons_list = [iss['message'] for iss in res.issues]
                        if v_match:
                            reasons_list.append(f"Verdict: {v_match.verdict} ({v_match.note})")
                        fallback_log.append({
                            "slide_n": idx,
                            "original_slide": slide_to_replace,
                            "reasons": reasons_list
                        })
                    else:
                        working_slides[idx - 1]["source_status"] = "verified" if verifier_available else "verified_deterministic_only"
            else:
                for s in working_slides:
                    s["source_status"] = "verified" if verifier_available else "verified_deterministic_only"

            final_slides = working_slides

            # A deck the composer left short gets a slide per unused claim: advice first, since it
            # closes a deck; a quote that only introduces a list ("Let's print ...:") never stands alone.
            # One claim per slide, so two unrelated quotes are never run together.
            closing_kinds = {"recommendation": 0, "finding": 1, "example": 2, "number": 3, "contrast": 4}
            while len(final_slides) < content_slides + 1:
                shown = {c for s in final_slides for c in s.get("claim_ids") or []}
                unused = sorted((c for c in all_claims if c.id not in shown and " | " not in c.quote
                                 and not c.quote.rstrip().endswith(":") and len(c.quote.split()) >= 6),
                                key=lambda c: closing_kinds.get(c.kind or "", 5))
                if not unused:
                    break
                fb_slide = _stat_from_claim(unused[0]) if unused[0].kind in ("number", "finding") else None
                fb_reason = "Stat built from an unused quote's own sentence"
                if fb_slide is None:
                    fb_slide, fb_reason = fallback_slide_from_claims(
                        slide_index=len(final_slides), claim_ids=[unused[0].id],
                        claims_by_id=claims_by_id, units=units, doc_title=raw_doc.title,
                        entities=entities, exclude_ids=shown)
                if set(fb_slide.get("claim_ids") or []) & shown:
                    break
                final_slides.append(fb_slide)
                msg = f"INFO [SHORT_DECK_FILLED]: slide {len(final_slides)} added from unused quotes ({fb_reason})"
                report(msg)
                warnings_list.append(msg)

            # Graphs: a composed deck gets the charts its source supports, built from the
            # document's own tables/sentences; a chart that fails validation is undone.
            before = list(final_slides)
            chart_notes = add_source_charts(final_slides, units, claims_by_id, entities,
                                            max_charts=2 if content_slides >= 6 else 1)
            if chart_notes:
                check = validate_deck(final_slides + [{"type": "cta", "headline": "x"}],
                                      {cid: c.quote for cid, c in claims_by_id.items()}, full_source_text,
                                      {cid: c.about for cid, c in claims_by_id.items()}, raw_doc.title)
                for res in check.slides[:-1]:
                    k = res.slide_n - 1
                    if final_slides[k] is not before[k] and res.has_error:
                        final_slides[k] = before[k]
                        chart_notes = [n for n in chart_notes if not n.startswith(f"Slide {k + 1} ")]
                for note in chart_notes:
                    report(note)
                    warnings_list.append(f"INFO [CHART_ADDED]: {note}")

            # Sync all_claims with any fallback claims created in claims_by_id
            for cid, clm in claims_by_id.items():
                if not any(c.id == cid for c in all_claims):
                    all_claims.append(clm)


    # Drop a content slide that repeats an earlier one word for word (two fallbacks can land on
    # the same quote). A repeated slide wastes a swipe and reads as a bug.
    seen_content = set()
    deduped_slides = []
    for s in final_slides:
        if s.get("type") in ("cover", "cta"):
            deduped_slides.append(s)
            continue
        key = json.dumps(
            [s.get(f) for f in ("body", "bullets", "items", "number", "series")],
            sort_keys=True, ensure_ascii=False,
        )
        if key != json.dumps([None] * 5) and key in seen_content:
            msg = f"INFO [DUPLICATE_SLIDE_DROPPED]: dropped a slide ('{s.get('headline', '')}') identical to an earlier one"
            report(msg)
            warnings_list.append(msg)
            continue
        seen_content.add(key)
        deduped_slides.append(s)
    final_slides = deduped_slides

    # Hook payoff: a number on the cover ("151% CAGR") should be picked up again by a later
    # slide, or the hook is never paid off. Fixed from the cover's own quote when possible.
    if mode_chosen != "keep":
        note = _pay_off_cover(final_slides, claims_by_id, full_source_text, raw_doc.title)
        if note:
            report(note)
            warnings_list.append(note)
    for msg in _hook_payoff_warnings(final_slides):
        report(msg)
        warnings_list.append(msg)

    # Append official CTA slide
    cta_slide = {
        "type": "cta",
        "headline": brand.cta_headline,
        "handle": brand.handle,
        "subtext": brand.cta_subtext,
        "claim_ids": [],
        "source_status": "system"
    }
    final_slides.append(cta_slide)

    # Assign 1-indexed slide numbers
    for idx, s in enumerate(final_slides, start=1):
        s["n"] = idx

    # Final validation report for record (F3.6)
    claims_map_str = {c.id: c.quote for c in all_claims}
    report(f"Final validation of {len(final_slides)} slides...")
    final_val_report = validate_deck(
        final_slides, claims_map_str, full_source_text, {c.id: c.about for c in all_claims}, raw_doc.title
    )
    _report_validation(final_val_report, "Final")
    with open(target_out / "04_validation.json", "w", encoding="utf-8") as f:
        json.dump(final_val_report.model_dump(), f, indent=2, ensure_ascii=False)

    # Save 06_fallback_log.json if any fallbacks occurred (F3.5)
    if fallback_log:
        with open(target_out / "06_fallback_log.json", "w", encoding="utf-8") as f:
            json.dump(fallback_log, f, indent=2, ensure_ascii=False)

    # Write 00_input_info.json with warnings (F2.2)
    with open(target_out / "00_input_info.json", "w", encoding="utf-8") as f:
        json.dump({
            "source_file": path.name,
            "word_count": total_words,
            "mode_requested": mode,
            "mode_chosen": mode_chosen,
            "mode_reason": mode_reason,
            "slide_count_total": slide_count,
            "content_slides": content_slides,
            "tag": chosen_tag,
            "warnings": warnings_list
        }, f, indent=2, ensure_ascii=False)

    # Generate slides.json with not_included (F2.2)
    seed_value = int(datetime.now().strftime("%Y%m%d"))
    slides_data = {
        "post_id": f"{path.stem}_{timestamp}",
        "brand": {
            "page_name": brand.page_name,
            "handle": brand.handle,
            "tag": chosen_tag,
            "cta_pill": brand.cta_pill,
            "cta_pill_subtext": brand.cta_pill_subtext
        },
        "style": style,
        "canvas_format": canvas_format,
        "seed": seed_value,
        "mode_used": mode_chosen,
        "source_file": path.name,
        "claims": [c.model_dump() for c in all_claims],
        "slides": final_slides,
        "not_included": not_included_items
    }

    # Generate grounded Instagram caption
    from .caption import generate_caption
    report("Writing Instagram caption" + (f" with {_model_label(llm, 'compose')}..." if mode_chosen != "keep" else " (no AI)..."))
    caption_text, _ = generate_caption(
        claims=all_claims,
        brand_info={"tag": chosen_tag, "handle": brand.handle, "page_name": brand.page_name, "hashtags": brand.hashtags},
        full_source_text=full_source_text,
        llm=llm if mode_chosen != "keep" else None,
        out_dir=target_out,
        slides=final_slides
    )
    slides_data["caption"] = caption_text

    with open(target_out / "slides.json", "w", encoding="utf-8") as f:
        json.dump(slides_data, f, indent=2, ensure_ascii=False)

    # Generate grounding_report.md
    report_md = _build_grounding_report(
        slides=final_slides,
        claims_by_id=claims_by_id,
        val_report=final_val_report,
        final_verdicts=final_verdicts,
        mode_used=mode_chosen,
        source_filename=path.name,
        warnings=warnings_list,
        not_included=not_included_items,
        fallback_info=fallback_info,
        caption=caption_text
    )
    with open(target_out / "grounding_report.md", "w", encoding="utf-8") as f:
        f.write(report_md)

    report(f"Saved slides.json and grounding_report.md to {target_out.name}")

    # Final Gate Check (F3.6)
    if not final_val_report.is_valid:
        error_slides = [s.slide_n for s in final_val_report.slides if s.has_error]
        print(f"Validation failed on slides: {error_slides}", file=sys.stderr)
        for s in final_val_report.slides:
            for iss in s.issues:
                if iss['severity'] == "ERROR":
                    print(f"  Slide {s.slide_n} ERROR [{iss['code']}]: {iss['message']}", file=sys.stderr)

        if not allow_fail:
            print("Aborting image generation due to validation errors. Use --allow-fail to force render.", file=sys.stderr)
            sys.exit(2)

    return target_out, slides_data, report_md
