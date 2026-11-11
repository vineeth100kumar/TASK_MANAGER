"""Automated deterministic faithfulness audit command."""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

from ..validators.quotes import verify_quote
from ..validators.numbers import extract_number_mentions, NumMention
from ..validators.quantifiers import check_quantifiers
from ..validators.hedges import check_hedges, check_scope
from ..validators.numbers import check_ranges
from ..validators.entities import extract_entities, check_entities
from ..validators.attribution import check_attribution
from ..validators.headlines import check_title_truncation
from ..validators.charts import check_chart, chart_text

from ..validators.normalize import norm


def audit_deck_folder(post_folder: Path | str) -> Tuple[bool, str]:
    """Audit slides.json and 01_units.json in post_folder.
    Writes audit.md into post_folder.
    Returns: (is_pass, audit_md_text)
    """
    folder = Path(post_folder).resolve()
    slides_file = folder / "slides.json"
    units_file = folder / "01_units.json"

    if not slides_file.exists():
        raise FileNotFoundError(f"slides.json not found in {folder}")
    with open(slides_file, "r", encoding="utf-8") as f:
        if json.load(f).get("mode_used") == "spec":
            return audit_spec_folder(folder)
    if not units_file.exists():
        raise FileNotFoundError(f"01_units.json not found in {folder}")

    with open(slides_file, "r", encoding="utf-8") as f:
        slides_data = json.load(f)
    with open(units_file, "r", encoding="utf-8") as f:
        units_data = json.load(f)

    units_by_id = {u["id"]: u["text"] for u in units_data}
    full_source_text = " ".join(u["text"] for u in units_data)

    claims_list = slides_data.get("claims", [])
    claims_by_id = {c["id"]: c for c in claims_list}
    claim_about = {c["id"]: c.get("about", []) for c in claims_list}
    doc_title = next((u["text"] for u in units_data if u.get("kind") == "heading"), None)

    audit_lines = [
        f"# Automated Faithfulness Audit: `{folder.name}`",
        f"- **Source File:** {slides_data.get('source_file', 'unknown')}",
        f"- **Mode Used:** {slides_data.get('mode_used', 'unknown')}",
        "",
        "## Slide Audits",
        ""
    ]

    has_errors = False
    fail_reasons: List[str] = []

    for s in slides_data.get("slides", []):
        if s.get("type") == "cta":
            continue

        n = s.get("n", 0)
        s_type = s.get("type", "unknown")
        audit_lines.append(f"### Slide {n} ({s_type})")

        # 1. Text fields
        audit_lines.append(f"- **Headline:** {s.get('headline', '')}")
        if s.get("body"):
            audit_lines.append(f"- **Body:** {s['body']}")
        if s.get("number"):
            audit_lines.append(f"- **Number:** {s['number']}")
        if s.get("bullets"):
            audit_lines.append(f"- **Bullets:** {s['bullets']}")
        if s.get("items"):
            audit_lines.append(f"- **Items:** {s['items']}")
        if s.get("series"):
            audit_lines.append(f"- **Chart ({s.get('chart_kind')}):** " + "; ".join(
                f"{p.get('label')} = {p.get('value_raw')}" for p in s["series"]))

        # 5. Cited claims quote verification
        cids = s.get("claim_ids") or []
        cited_quotes_parts = []
        cited_mentions: List[NumMention] = []

        audit_lines.append("- **Cited Claims Verification:**")
        if not cids and s_type != "cover":
            audit_lines.append("  - [FAIL] No claim IDs cited on content slide")
            has_errors = True
            fail_reasons.append(f"Slide {n}: No claim IDs cited")

        for cid in cids:
            claim = claims_by_id.get(cid)
            if not claim:
                audit_lines.append(f"  - [FAIL] Claim '{cid}' not found in deck claims list")
                has_errors = True
                fail_reasons.append(f"Slide {n}: Claim {cid} not found")
                continue

            u_text = units_by_id.get(claim["unit_id"], "")
            q_ok = verify_quote(claim["quote"], u_text)
            status_str = "OK" if q_ok else "NOT FOUND / VERIFY FAILED"
            audit_lines.append(f"  - `[{cid}]` (Unit `{claim['unit_id']}`): {status_str} -> \"{claim['quote']}\"")
            if not q_ok:
                has_errors = True
                fail_reasons.append(f"Slide {n}: Claim {cid} failed verify_quote against unit {claim['unit_id']}")
            cited_quotes_parts.append(claim["quote"])
            cited_mentions.extend(extract_number_mentions(claim["quote"]))

        cited_text = "\n".join(cited_quotes_parts)
        slide_text = "\n".join(
            [s.get("headline", ""), str(s.get("number") or ""), s.get("body") or ""]
            + list(s.get("bullets") or []) + list(s.get("items") or []) + [chart_text(s)]
        )

        # 2. Number mentions
        audit_lines.append("- **Number Mentions:**")
        slide_mentions = extract_number_mentions(slide_text)
        if not slide_mentions:
            audit_lines.append("  - None")
        else:
            allowed_counts = [len(s.get("items", []))] if s.get("items") else []
            for sm in slide_mentions:
                # Find matching quote mention
                matching_q = None
                for qm in cited_mentions:
                    if qm.value == sm.value and (qm.cls == sm.cls or {qm.cls, sm.cls} == {"year", "count"}):
                        matching_q = qm
                        break

                if matching_q:
                    audit_lines.append(f"  - `{sm.raw}` (value {sm.value}, {sm.cls}): MATCHED -> \"{matching_q.raw}\" in cited quotes")
                elif sm.cls == "count" and int(sm.value) in allowed_counts:
                    audit_lines.append(f"  - `{sm.raw}` (value {sm.value}): MATCHED -> Allowed derived list item count ({int(sm.value)})")
                else:
                    audit_lines.append(f"  - [FAIL] `{sm.raw}` (value {sm.value}, {sm.cls}): NOT FOUND in cited quotes")
                    has_errors = True
                    fail_reasons.append(f"Slide {n}: Number '{sm.raw}' NOT FOUND in cited quotes")

        # 3. Capitalised names / acronyms
        audit_lines.append("- **Entities & Acronyms:**")
        slide_entities = extract_entities(slide_text)

        if not slide_entities:
            audit_lines.append("  - None")
        else:
            for ent in sorted(slide_entities):
                loc = "NOT FOUND"
                if re.search(rf"\b{re.escape(ent)}\b", cited_text, re.IGNORECASE):
                    loc = "In cited quotes"
                elif re.search(rf"\b{re.escape(ent)}\b", full_source_text, re.IGNORECASE):
                    loc = "Elsewhere in source (WARN)"
                else:
                    loc = "NOT FOUND (FAIL)"
                    has_errors = True
                    fail_reasons.append(f"Slide {n}: Entity '{ent}' NOT FOUND in source")
                audit_lines.append(f"  - `{ent}`: {loc}")

        # 4. Quantifiers and hedges status
        q_issues = check_quantifiers(slide_text, cited_text)
        h_issues = check_hedges(slide_text, cited_text) + check_scope(slide_text, cited_text) + check_ranges(slide_text, cited_text)
        audit_lines.append("- **Quantifier & Hedge Status:**")
        if not q_issues and not h_issues:
            audit_lines.append("  - PASS: All quantifiers and hedges supported")
        else:
            for qi in q_issues:
                audit_lines.append(f"  - [{qi.severity}] Quantifier: {qi.message}")
                if qi.severity == "ERROR":
                    has_errors = True
                    fail_reasons.append(f"Slide {n}: {qi.message}")
            for hi in h_issues:
                audit_lines.append(f"  - [{hi.severity}] Hedge: {hi.message}")
                if hi.severity == "ERROR":
                    has_errors = True
                    fail_reasons.append(f"Slide {n}: {hi.message}")

        # 6. Who each fact is about, and headlines cut mid-phrase
        a_issues = check_attribution(slide_text, cids, claim_about)
        a_issues += check_title_truncation(s.get("headline", ""), cited_quotes_parts + [doc_title])
        if s_type == "chart":
            a_issues += check_chart(s, cited_quotes_parts)
        audit_lines.append("- **Attribution & Headline:**")
        if not a_issues:
            audit_lines.append("  - PASS: Every fact names its subject; headline is complete")
        for ai in a_issues:
            audit_lines.append(f"  - [{ai.severity}] {ai.code}: {ai.message}")
            if ai.severity == "ERROR":
                has_errors = True
                fail_reasons.append(f"Slide {n}: {ai.code} {ai.message}")

        audit_lines.append("")

    # Caption audit if caption.txt present
    caption_file = folder / "caption.txt"
    if caption_file.exists():
        audit_lines.append("## Instagram Caption Audit")
        try:
            with open(caption_file, "r", encoding="utf-8") as cf:
                caption_content = cf.read()
            from ..validators.caption import validate_caption
            from ..pipeline.extract_claims import Claim
            claim_objs = [Claim(**c) for c in claims_list]
            brand_obj = slides_data.get("brand") or {}
            brand_tag = brand_obj.get("tag")
            cap_issues = validate_caption(caption_content, claim_objs, full_source_text, brand_tag=brand_tag)
            if not cap_issues:
                audit_lines.append("- PASS: All numbers, entities, and quantifiers in caption are supported")
            else:
                for ci in cap_issues:
                    audit_lines.append(f"- [{ci['severity']}] {ci['message']}")
                    if ci["severity"] == "ERROR":
                        has_errors = True
                        fail_reasons.append(f"Caption: {ci['message']}")
        except Exception as ce:
            audit_lines.append(f"- [WARN] Caption audit encountered error: {ce}")
        audit_lines.append("")

    # 6. Final Result line
    if has_errors:
        result_line = f"AUDIT RESULT: FAIL ({'; '.join(fail_reasons)})"
    else:
        result_line = "AUDIT RESULT: PASS"

    audit_lines.append("---")
    audit_lines.append(f"## {result_line}")
    audit_lines.append("")

    report_text = "\n".join(audit_lines)
    with open(folder / "audit.md", "w", encoding="utf-8") as f:
        f.write(report_text)

    return (not has_errors), report_text


def audit_spec_folder(folder: Path) -> Tuple[bool, str]:
    """Audit a deck built from a post spec. The author's facts are trusted, so this checks
    what makes a post fail on screen: length limits, chart data, tables, images, the caption's
    Instagram limits, and the layout measured at render time (fit_report.json)."""
    from ..spec.build import deck_checks
    from ..spec.checks import check_fit, issues_summary

    data = json.loads((folder / "slides.json").read_text(encoding="utf-8"))
    slides = data.get("slides", [])
    issues = deck_checks(folder, data)

    fit_file = folder / "fit_report.json"
    fit_note = ""
    if fit_file.exists():
        fit = json.loads(fit_file.read_text(encoding="utf-8"))
        issues += check_fit(fit.get("slides", []))
        if fit.get("slide_count") != len(slides):
            fit_note = "Layout was measured for a different number of slides; render the deck again."
    else:
        fit_note = "Layout not measured yet (the deck has not been rendered)."
    pngs = sorted(folder.glob("slide_*.png"))
    if len(pngs) != len(slides):
        fit_note = fit_note or f"{len(pngs)} slide images for {len(slides)} slides; render the deck again."

    lines = [
        f"# Post Audit: `{folder.name}`",
        f"- **Source File:** {data.get('source_file', 'unknown')}",
        "- **Mode Used:** spec (facts supplied by the author; checked for layout, lengths, chart data and caption limits)",
        f"- **Result of checks:** {issues_summary(issues)}",
        "",
        "## Slide Checks",
        "",
    ]
    for n, s in enumerate(slides, start=1):
        lines.append(f"### Slide {n} ({s.get('type', 'unknown')})")
        if s.get("headline"):
            lines.append(f"- **Headline:** {s['headline']}")
        mine = [i for i in issues if i.slide == n]
        if not mine:
            lines.append("- PASS")
        for i in mine:
            lines.append(f"- [{i.severity}] {i.code}: {i.message}" + (f" Fix: {i.hint}" if i.hint else ""))
        lines.append("")
    general = [i for i in issues if not i.slide]
    lines.append("## Deck and Caption")
    if fit_note:
        lines.append(f"- [WARN] {fit_note}")
    if not general and not fit_note:
        lines.append("- PASS: caption within Instagram limits")
    for i in general:
        lines.append(f"- [{i.severity}] {i.code}: {i.message}" + (f" Fix: {i.hint}" if i.hint else ""))
    lines.append("")

    errors = [i for i in issues if i.severity == "ERROR"]
    if errors:
        reasons = "; ".join(f"Slide {i.slide}: {i.message}" if i.slide else i.message for i in errors)
        result_line = f"AUDIT RESULT: FAIL ({reasons})"
    else:
        result_line = "AUDIT RESULT: PASS"
    lines += ["---", f"## {result_line}", ""]
    text = "\n".join(lines)
    (folder / "audit.md").write_text(text, encoding="utf-8")
    return not errors, text
