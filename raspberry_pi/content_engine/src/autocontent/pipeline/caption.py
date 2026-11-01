"""Stage D: Grounded Instagram caption and hashtag generation."""

from .. import tuning
import html
import json
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

from autocontent.pipeline.extract_claims import Claim
from autocontent.validators.caption import validate_caption, _word_stem_in_source
from autocontent.llm.base import LLMClient


class CaptionDraft(BaseModel):
    hook: str = Field(description="Attention-grabbing 1-2 sentence hook highlighting the main takeaway")
    takeaways: List[str] = Field(description="3 to 4 concise bullet takeaways from verified claims")
    caveats: Optional[str] = Field(default=None, description="Preserved methodology, sample, or non-causal caveat if present")
    cta: str = Field(description="Clear Instagram call to action (e.g. Save this post, share)")
    hashtags: List[str] = Field(default_factory=list, description="Leave empty; the system adds the page's hashtags")
    topic_hashtags: List[str] = Field(default_factory=list, description="2 hashtags naming the post's topic, made only of words in the claims (e.g. #3dprinting)")


def clean_caption_text(text: str) -> str:
    """Plain caption text: HTML entities decoded (even double-escaped "R&amp;amp;D" -> "R&D"),
    markdown emphasis and shouted ellipses ("BUT...") normalised, whitespace collapsed."""
    prev = None
    while prev != text:  # unescape until stable so nested escapes are fully decoded
        prev, text = text, html.unescape(text)
    text = re.sub(r"\*\*|__", "", text)
    text = re.sub(r"\b(BUT|HOWEVER|THOUGH|ALTHOUGH)\b\s*(?:\.{2,}|…)?\s*",
                  lambda m: m.group(1).capitalize() + " ", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def format_caption(draft: CaptionDraft) -> str:
    """Format structured caption draft into standard Instagram caption format."""
    lines = [clean_caption_text(draft.hook), "", "Key takeaways:"]
    for t in draft.takeaways:
        clean_t = clean_caption_text(t).lstrip("•-* ").strip()
        lines.append(f"• {clean_t}")

    if draft.caveats and draft.caveats.strip():
        note = clean_caption_text(draft.caveats)
        # "but we rely ..." -> "But we rely ...": capitalised, never cut, since the connector is the caveat
        lines.extend(["", f"Note: {note[:1].upper() + note[1:]}"])

    lines.extend([
        "",
        draft.cta.strip(),
        "",
        " ".join(h if h.startswith('#') else f'#{h}' for h in draft.hashtags)
    ])
    return "\n".join(lines).strip()


DEFAULT_NICHE_HASHTAGS = [
    "#business", "#entrepreneurship", "#indianbusiness",
    "#startupindia", "#businessgrowth",
]


def build_brand_hashtags(
    brand_tag: str = "#business",
    brand_handle: str = "@minddeeds",
    brand_hashtags: Optional[List[str]] = None,
    limit: int = 5,
    topic_tags: Optional[List[str]] = None,
) -> List[str]:
    """A small fixed set of niche topic hashtags for the page.

    Hashtags are discovery/keyword metadata for the niche, NOT facts to be grounded
    in the document. Instagram now treats them as keywords and caps them at ~5 per
    post, so we use a stable brand set (configurable in brand.json) rather than words
    scraped from each source (which produced tags like #https, #coincidence, #CapEx)."""
    handle_tag = brand_handle.strip().replace("@", "#")
    if not handle_tag.startswith("#"):
        handle_tag = f"#{handle_tag}"

    pool = list(brand_hashtags) if brand_hashtags else list(DEFAULT_NICHE_HASHTAGS)
    # brand handle always included so the page is tagged on every post
    # topic tags (e.g. #3dprinting) reach the niche audience, so they go before the generic brand set
    ordered = [handle_tag] + list(topic_tags or [])[:2] + [t for t in pool]

    out: List[str] = []
    seen = set()
    for t in ordered:
        t = t.strip()
        if not t:
            continue
        if not t.startswith("#"):
            t = f"#{t}"
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
        if len(out) >= limit:
            break
    return out


def reformat_table_row_quote(quote: str) -> str:
    """Format a table-row quote into clean prose text without raw pipes."""
    if " | " not in quote:
        return quote
    parts = [p.strip() for p in quote.split(" | ")]
    if len(parts) == 2:
        p0, p1 = parts[0], parts[1]
        label = p0.split(":", 1)[-1].strip() if ":" in p0 else p0
        if ":" in p1:
            hdr, val = p1.split(":", 1)
            hdr, val = hdr.strip(), val.strip()
            short_hdr = hdr.lower()
            for prefix in ["share reporting a ", "share reporting ", "share of ", "percentage of ", "number of ", "count of "]:
                if short_hdr.startswith(prefix):
                    short_hdr = short_hdr[len(prefix):]
                    break
            if re.match(r'^\d+$', val):
                words = [w for w in re.findall(r'[a-zA-Z]+', hdr.lower()) if w not in {"reporting", "drop", "sign", "ups", "no", "in", "a", "of", "the", "number", "count"}]
                noun = words[0] if words else "items"
                return f"{label}: {val} {noun}"
            return f"{label}: {val} {short_hdr}"
        return f"{label}: {p1}"
    return ", ".join(parts)


def extract_grounded_keywords(claims: List[Claim], source_text: str = "") -> List[str]:
    """Extract candidate keywords that actually appear in the claims or source text."""
    combined = (source_text + " " + " ".join(c.quote for c in claims)).lower()
    stopwords = {
        "this", "that", "with", "from", "were", "their", "they", "what", "when",
        "more", "less", "than", "have", "been", "also", "said", "about", "some",
        "only", "most", "much", "each", "over", "under", "into", "other", "after",
        "before", "which", "there", "where", "these", "those", "would", "could",
        "should", "will", "year", "month", "week", "report", "survey", "table",
        "data", "notes", "none", "very", "many", "such", "then", "just", "note",
        "million", "billion", "trillion", "thousand", "hundred", "percent", "percentage",
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
        "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"
    }
    # Generic verbs/adjectives that make meaningless hashtags (#change, #drop, #held).
    stopwords |= {
        "change", "changes", "drop", "drops", "raised", "raise", "raising", "held", "flat",
        "reported", "reporting", "reports", "told", "found", "find", "helped", "help", "mattered",
        "matter", "disagreed", "agreed", "took", "take", "make", "made", "does", "doing", "done",
        "include", "including", "average", "operating", "interviewed", "first", "last", "next",
        "early", "every", "daily", "weekly", "monthly", "yearly", "quarter", "quarterly",
        "result", "results", "cannot", "could", "being", "still", "while", "because", "both",
        "same", "like", "time", "times", "thing", "things", "high", "higher", "lower", "least",
        "reduce", "reduced", "increase", "increased", "grew", "grow", "fell", "rose", "tracked",
        "random", "sample", "generalised", "generalized", "verified", "heading", "title", "caveats",
        "whether", "though", "although", "hours", "days", "weeks", "months", "years", "staff",
        "highly", "however", "despite", "company", "brand", "brands",
    }
    # Hyphenated compounds ("sign-ups", "early-stage") are skipped whole; their halves are not tags.
    words = [w for w in re.findall(r'\b[a-z]+(?:-[a-z]+)*\b', combined) if "-" not in w and len(w) >= 4]
    freq: Dict[str, int] = {}
    for w in words:
        if w not in stopwords:
            freq[w] = freq.get(w, 0) + 1
    return sorted(freq.keys(), key=lambda k: (-freq[k], k))


_STRONG_CAVEATS = ["did not test", "coincidence", "not a random", "cannot be generalised", "not verified", "small sample", "limited"]


def _has_caveat(text: str) -> bool:
    from autocontent.validators.hedges import CAVEAT_CONNECTORS
    t = text.lower()
    return any(re.search(r"(?:\b|\A)" + re.escape(c) + r"(?:\b|\Z)", t) for c in CAVEAT_CONNECTORS)


def _caveat_excerpt(quote: str) -> str:
    """Only the caveat of a claim, not the whole source chunk: the sentence holding the caveat,
    joined to the sentence it qualifies when it opens with the connector
    ("Exports grew 151% CAGR. BUT... we rely on imported machines." -> "..., but we rely ...")."""
    quote = clean_caption_text(quote)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", quote) if s.strip()]
    for i, sent in enumerate(sentences):
        if not _has_caveat(sent):
            continue
        opener = re.match(r"^(But|However|Though|Although)\b[\s,]*(.*)$", sent)
        if opener and i > 0:
            before = sentences[i - 1].rstrip(".!? ")
            return f"{before}, {opener.group(1).lower()} {opener.group(2)}".strip()
        return sent
    return quote


def _slide_subject(slide: Dict[str, Any], by_id: Dict[str, Claim]) -> Optional[str]:
    about = {e for cid in slide.get("claim_ids") or [] if cid in by_id for e in by_id[cid].about}
    return next(iter(about)) if len(about) == 1 else None


def _named(text: str, subject: Optional[str]) -> str:
    """"Ambrane: By the FY24–25 period, the brand's ..." when the text does not name its subject."""
    return f"{subject}: {text}" if subject and subject.lower() not in text.lower() else text


def _slide_takeaway(slide: Dict[str, Any], by_id: Dict[str, Claim]) -> Optional[str]:
    """One caption line per content slide, copied from what the slide shows."""
    t = slide.get("type")
    subject = _slide_subject(slide, by_id)
    if t == "chart":
        values = ", ".join(f"{p.get('label')}: {p.get('value_raw')}" for p in slide.get("series") or [])
        return _named(f"{slide.get('headline', '')} — {values}", subject) if values else None
    if t == "list":
        items = slide.get("items") or []
        return _named(f"{slide.get('headline', '')} — " + "; ".join(items), subject) if items else None
    if t == "stat" and slide.get("number") and str(slide["number"]) not in (slide.get("body") or ""):
        return _named(f"{slide['number']}: {(slide.get('body') or slide.get('headline', '')).strip()}", subject)
    if t in ("point", "stat", "quote"):
        bullets = slide.get("bullets") or []
        # each bullet as its own sentence: joined with "; " a capitalised bullet ("Fits in a
        # small garage") reads mid-sentence as a name and fails the entity check
        text = slide.get("body") or " ".join(b.rstrip() if b.rstrip().endswith((".", "!", "?")) else b.rstrip() + "."
                                             for b in bullets)
        return _named(text.strip(), subject) if text else None
    return None


def generate_extractive_caption(
    claims: List[Claim],
    brand_tag: str = "#business",
    brand_handle: str = "@minddeeds",
    source_text: str = "",
    slides: Optional[List[Dict[str, Any]]] = None,
    brand_hashtags: Optional[List[str]] = None
) -> str:
    """Deterministic fallback caption constructed from verbatim claims.

    With the deck's slides: hook = the cover line, takeaways = what the slides show (each
    naming its subject), and a caveat quoted whole whenever any claim carries one."""
    if not claims:
        clean_tag = brand_tag if brand_tag.startswith('#') else f'#{brand_tag}'
        return f"Key business insights from our latest report.\n\nFollow {brand_handle} for more.\n\n{clean_tag} #minddeeds"

    def is_table(c: Claim) -> bool:
        return c.kind == "table_row" or " | " in c.quote

    def is_caveat(c: Claim) -> bool:
        lower_q = c.quote.lower()
        return any(w in lower_q for w in _STRONG_CAVEATS)

    prose_claims = [c for c in claims if not is_table(c) and not is_caveat(c)]
    caveat_claims = [c for c in claims if is_caveat(c)]
    table_claims = [c for c in claims if is_table(c)]

    by_id = {c.id: c for c in claims}
    caveats_found = _caveat_excerpt(caveat_claims[0].quote) if caveat_claims else None
    if caveats_found is None:
        # Any "however"/"but"/"may" in a claim is a limit the caption must keep
        on_slides = [cid for s in (slides or []) for cid in s.get("claim_ids") or []]
        ordered = [by_id[cid] for cid in dict.fromkeys(on_slides) if cid in by_id] + claims
        hedged = next((c for c in ordered if _has_caveat(c.quote) and not is_table(c)), None)
        if hedged is not None:
            subject = hedged.about[0] if len(hedged.about) == 1 else None
            q = _caveat_excerpt(hedged.quote)
            caveats_found = f"{subject} — {q}" if subject and subject.lower() not in q.lower() else q

    content = [s for s in (slides or []) if s.get("type") not in ("cover", "cta")]
    deck_lines = [line for line in (_slide_takeaway(s, by_id) for s in content) if line]
    if slides and slides[0].get("type") == "cover" and deck_lines:
        hook = slides[0].get("headline", "").strip()
        # One takeaway per content slide (none skipped); the caveat is quoted once, in the Note
        caveat_core = (caveats_found or "").split(" — ", 1)[-1]
        takeaways = [t for t in dict.fromkeys(deck_lines) if not caveat_core or caveat_core not in t]
        remaining_prose, table_claims = [], []
    elif prose_claims:
        hook = prose_claims[0].quote.strip()
        remaining_prose = prose_claims[1:]
    elif table_claims:
        hook = reformat_table_row_quote(table_claims[0].quote.strip())
        remaining_prose = []
        table_claims = table_claims[1:]
    else:
        hook = claims[0].quote.strip()
        remaining_prose = []

    # Takeaways: up to 3 non-table claims
    if not deck_lines or not slides or slides[0].get("type") != "cover":
        takeaways = []
    seen = {hook} | set(takeaways)

    for c in remaining_prose:
        q = c.quote.strip()
        if q not in seen and len(takeaways) < 3:
            takeaways.append(q)
            seen.add(q)

    # Supplement with cleaned table claims if needed
    if len(takeaways) < 3 and not deck_lines:
        for tc in table_claims:
            clean_q = reformat_table_row_quote(tc.quote.strip())
            if clean_q not in seen and len(takeaways) < 3:
                takeaways.append(clean_q)
                seen.add(clean_q)

    if not takeaways:
        takeaways = [hook]

    # Fixed niche hashtags (brand set, not scraped from the source document)
    final_hashtags = build_brand_hashtags(brand_tag, brand_handle, brand_hashtags)

    draft = CaptionDraft(
        hook=hook,
        takeaways=takeaways,
        caveats=caveats_found,
        cta="Which of these stood out to you? Tell me in the comments.\nSave this for later and follow "
            f"{brand_handle} for more business breakdowns.",
        hashtags=final_hashtags
    )
    return format_caption(draft)


CAPTION_SYSTEM_PROMPT = """You are an expert social media copywriter for the Instagram business account MIND DEEDS.
You receive the carousel's slides (in order) and the strictly verified claims they were built from.
Your job: write the caption that makes a reader stop, learn something, then save and share the post.

STRICT GROUNDING RULES:
1. Every number, percentage, count, and statistic in your caption MUST appear verbatim in the provided claims, with its unit written the same way.
2. Never invent, extrapolate, or derive numbers (no sums, differences, percentages or averages). Never add facts, causes or promises the claims do not state. In statements, no superlatives and no "most", "all", "every", "always", "secret", "guaranteed" unless the claim uses them.
3. If a claim you use contains a caveat or contrast ("but", "however", "may", "some", "did not test", "small sample"), every sentence that uses that claim's number keeps the caveat with the same connector word, e.g. "Exports grew 151% CAGR, but machines are still imported." Put the caveat in "caveats" as ONE short plain sentence that also keeps the connector word.
4. Do not use raw table syntax or pipe characters.

WRITING RULES (Instagram):
5. "hook": 1 sentence, at most 20 words, that names the topic and what the reader will learn. Do not repeat the cover headline word for word. No emojis.
6. "takeaways": 3 to 4 bullets that follow the slides in order. Each bullet states one fact AND why it matters for the reader, both taken from the claims. Never paste a slide verbatim; at most 2 numbers per bullet.
7. "cta": one short comment question about the topic that readers can answer from their own experience or plans (not "which stood out"), then one line giving a concrete reason to save or share the post (e.g. "Save this for when you price your first order." or "Send this to an engineer friend.").
8. "hashtags": leave as []. "topic_hashtags": exactly 2 lowercase hashtags naming the topic, each made only of words that appear in the claims (e.g. #3dprinting, #manufacturing). No brand or generic tags.
9. Return JSON matching the schema."""


def generate_caption(
    claims: List[Claim],
    brand_info: Dict[str, Any],
    full_source_text: str = "",
    llm: Optional[LLMClient] = None,
    out_dir: Optional[Path] = None,
    slides: Optional[List[Dict[str, Any]]] = None
) -> Tuple[str, bool]:
    """Generate and validate Instagram caption.
    Returns: (formatted_caption_text, is_ai_generated)
    """
    brand_tag = brand_info.get("tag") or brand_info.get("default_tag", "#business")
    brand_handle = brand_info.get("handle", "@minddeeds")
    brand_tags_list = brand_info.get("hashtags")

    if llm is None:
        caption_text = generate_extractive_caption(claims, brand_tag=brand_tag, brand_handle=brand_handle, source_text=full_source_text, slides=slides, brand_hashtags=brand_tags_list)
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)
            with open(out_dir / "caption.txt", "w", encoding="utf-8") as f:
                f.write(caption_text + "\n")
        return caption_text, False

    slide_lines = []
    for sl in slides or []:
        if sl.get("type") == "cta":
            continue
        parts = [sl.get("headline", ""), sl.get("number") or "", sl.get("body") or ""]
        parts += sl.get("bullets") or []
        parts += sl.get("items") or []
        parts += [f"{p.get('label')}: {p.get('value_raw')}" for p in sl.get("series") or []]
        slide_lines.append(f"Slide {sl.get('n', len(slide_lines) + 1)} ({sl.get('type')}): " + " / ".join(p for p in parts if p))
    user_prompt = ("Slides:\n" + "\n".join(slide_lines) + "\n\n" if slide_lines else "") + \
        "Verified Claims:\n" + "\n".join(f"[{c.id}] {c.quote}" for c in claims)
    source_lower = (full_source_text + " " + " ".join(c.quote for c in claims)).lower()
    try:
        caption_text, has_error, feedback = "", True, ""
        for attempt in range(2):  # one retry with the validator's findings before falling back
            draft: CaptionDraft = llm.generate_json(
                system=CAPTION_SYSTEM_PROMPT,
                user=user_prompt + feedback,
                schema=CaptionDraft,
                temperature=tuning.temperature("caption"),
                stage="caption" if attempt == 0 else "caption_repair",
                log_dir=out_dir
            )
            # Hashtags: the page's fixed niche set, plus up to 2 topic tags made of the source's own words
            topic = ["#" + t.lower().lstrip("#") for t in draft.topic_hashtags
                     if re.fullmatch(r"#?[a-z0-9]{3,30}", t.lower()) and _word_stem_in_source(t, source_lower)]
            draft.hashtags = build_brand_hashtags(brand_tag, brand_handle, brand_tags_list, topic_tags=topic)
            caption_text = format_caption(draft)

            issues = validate_caption(caption_text, claims, full_source_text, brand_tag=brand_tag)
            errors = [i["message"] for i in issues if i["severity"] == "ERROR"]
            has_error = bool(errors)
            if not has_error:
                break
            hints = [f"- {e}" for e in errors]
            if any("caveat" in e for e in errors):
                hints.append('- Write the claim\'s own connector word ("but", "however", "may") in the takeaway that uses '
                             'its number AND at the start of "caveats"; "while" or a dash does not count.')
            feedback = "\n\nYOUR LAST CAPTION FAILED THESE CHECKS. FIX THEM:\n" + "\n".join(hints)
        if has_error:
            # Fallback to extractive caption if AI caption violates grounding
            caption_text = generate_extractive_caption(claims, brand_tag=brand_tag, brand_handle=brand_handle, source_text=full_source_text, slides=slides, brand_hashtags=brand_tags_list)
            is_ai = False
        else:
            is_ai = True
    except Exception:
        caption_text = generate_extractive_caption(claims, brand_tag=brand_tag, brand_handle=brand_handle, source_text=full_source_text, slides=slides, brand_hashtags=brand_tags_list)
        is_ai = False

    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        with open(out_dir / "caption.txt", "w", encoding="utf-8") as f:
            f.write(caption_text + "\n")

    return caption_text, is_ai
