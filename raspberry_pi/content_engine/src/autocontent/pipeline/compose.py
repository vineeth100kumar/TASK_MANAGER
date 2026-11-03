"""Stage B: Carousel slide composition from verified claims."""

import json
from pathlib import Path
from typing import List, Literal, Optional, Dict
from pydantic import BaseModel

from .extract_claims import Claim
from .chunking import KIND_PRIORITY
from ..llm.base import LLMClient
from ..llm.limiter import estimate_tokens

SlideType = Literal["cover", "point", "list", "stat", "chart"]


class ChartPoint(BaseModel):
    label: str
    value_raw: str


class SlideDraft(BaseModel):
    type: SlideType
    headline: str
    body: Optional[str] = None
    bullets: Optional[List[str]] = None
    items: Optional[List[str]] = None
    number: Optional[str] = None
    chart_kind: Optional[Literal["bar", "pie", "line"]] = None
    series: Optional[List[ChartPoint]] = None
    source_note: Optional[str] = None
    claim_ids: List[str]


class Deck(BaseModel):
    slides: List[SlideDraft]


SYSTEM_PROMPT_TEMPLATE = """You write the slide text for an Instagram carousel for the business page "Mind Deeds".
You are given a list of VERIFIED QUOTES from a source document. You may use ONLY information contained in these quotes. You have not seen the rest of the document and must not guess what it says.

OUTPUT: exactly {content_slides_plus_cover} slides: slide 1 is type "cover"; the other {content_slides} slides are type "point", "list", "stat" or "chart". Do NOT create a call-to-action slide; the system adds it.

FACT RULES (the most important part)
1. Every fact, number, name, date and recommendation must come from the quotes. Do not add examples, statistics, causes, benefits, or advice that are not in the quotes.
2. Re-word and shorten freely, but keep the meaning identical. Keep every caveat ("may", "some", "reported", "did not test whether...", "small sample", "coincidence", "not verified") or the sentence becomes untrue. Do not turn a correlation into a cause. If a cited quote contains a caveat or limitation, you MUST include the caveat clause on the slide; a finding without its caveat is an invented certainty and will fail validation. Keep who the finding applies to: if the quote says "Three founders", "Some founders", "One founder" or "A majority of founders", the slide (including the cover headline) must keep that word; never turn a finding about some people into a general rule.
3. Do not turn "some/several/many" into "most/all/every". Do not round or change numbers. Never use one end of a range: "$65 billion to $66 billion" stays "$65 billion to $66 billion", never "$65 billion". A projection or estimate stays a projection ("projected to reach"). Do not combine numbers into new numbers (no sums, no averages, no "double").
4. Do not use superlatives (best, biggest, fastest...), promises ("you will earn more"), or words like proven, guaranteed, secret, ultimate unless the quote uses them.
5. Do not write "studies show", "experts say", "research proves" unless the quote says it. Name the source only as the quotes name it.
6. No emojis, no hashtags, no URLs, no quotation marks around phrases. Never end a headline, bullet or item with a dash.
7. Every slide must list in "claim_ids" all the quotes it relies on (at least one). Never cite a quote you did not use. Put claim ids ONLY in the "claim_ids" field. NEVER write a claim id like "(C01)" or "C04" inside headline, body, bullets, items, number or source_note: that text is printed on the slide and looks broken.
8. Name the company (or person/organisation) on every slide whose facts are about one; never write 'the company' without naming it. Never combine facts about different companies on one slide unless each fact names its company. A quote marked "about: X" is about X even when it only says "the company" or "its".
9. Use each claim on AT MOST ONE content slide. Never repeat the same fact (e.g. a 5% market share) on two slides; each slide must earn its place with new information.
10. Never add a describing word the quote does not use: no "average", "typical", "mean", "median", "net", "gross", "total", "annual", "estimated" or "approximately" unless that word is in the cited quote. "Profit per part: ₹1,965" is "Profit per part", never "Average profit per part".
11. Use as many of the distinct claims as the slide count allows. Favour the vivid, concrete and surprising facts (a striking number, a real example, a sharp contrast) over vague statements: these are what make people save and share. Do not drop a striking example to make room for a generic sentence.

SLIDE TYPES (the word and character limits are hard: the system counts them, and a slide one word over is thrown away and replaced with raw source text, so stay a word or two under)
- point: headline <= 6 words (a short punchy label), then EITHER "body" (<= 30 words, one idea) OR "bullets" (3 to 4 bullets, each <= 12 words; use 2 only when that is genuinely all the facts allow). Prefer bullets: a point slide should feel full, never one lonely line on an empty slide. Group related facts so each content slide carries 3-4 real points when the claims allow.
- list: headline <= 6 words, 3 to 4 items, each <= 10 words. Use a list only when 3+ quotes belong together (e.g. recommendations).
- stat: one big number. "number" is ONE number copied exactly from a quote with its unit ("₹50 crore", "200%", "50,000"); never half of a range. "body" (<= 20 words) says what it is, whose it is, and why it matters to the reader, using only the quotes (e.g. the quote's "but ..." clause, or the consequence the quote states). headline <= 6 words and states the takeaway, not a label like "Print speed breakthrough".
- chart: use 1 or 2 charts when the quotes contain 2 to 6 comparable numbers with the same unit. "series" is a list of {{"label", "value_raw"}}: label = the company, category or period exactly as written in the quote; value_raw = the number exactly as written in the quote, with its unit ("₹1,448.66 crore", "26.6%", "1,278"). Each label must sit next to its own number in the cited quote. "chart_kind":
  * "bar" to compare companies or categories (default);
  * "line" only for the same metric over time (labels are periods: FY24, FY25, 2025);
  * "pie" only for percentage shares of ONE whole from the same table or sentence that add up to 95-100%. Otherwise use bar.
  Never put a total or subtotal next to its own parts ("Cost + failure buffer ₹434" beside "Material cost ₹240"): the bars then double-count. Chart either the parts, or the totals that answer the reader's question (e.g. cost vs price vs profit), never both.
  Every value_raw is ONE number: a range ("₹500 - ₹1,000 Crore", "19% to 21%") cannot be a bar; leave that item out or use a list slide. Never compute a number, never add an "Others" slice, never mix units (% with ₹) in one chart. "source_note": a short human-readable label like "Source: Unit economics" (<= 8 words) — NEVER a claim id such as "Source: C06". "body" (<= 20 words): what the chart shows and what the context is (e.g. which product, which period), taken from a quote.

ENGAGEMENT RULES (make people stop scrolling, without breaking the fact rules)
- Cover headline (hard limit 12 words, 72 characters): name WHOSE number it is (the country, company, product or market, e.g. "India's 3D print exports up 151% CAGR, but machines imported"), never a bare "Exports grew 151%". Aim for 8 words; up to 12 only when it carries a caveat clause, and then the caveat clause is whole ("but machines are imported", never "but import"). Never use the document title as the cover. Scan ALL quotes and pick the single most attention-grabbing number: a big growth rate (e.g. a CAGR or % jump) or a large money figure (crores, billions) beats a small unit cost or a count. Lead with that number (number-first hook). Other hook styles only when no quote has a striking number: (b) a contrast "X, not Y" only if both sides are in the quotes, (c) a bold direct statement of the most striking finding, (d) a question that later slides clearly answer.
- Cover caveat: if the quote holding the cover number also contains a caveat or contrast ("but", "however", "though", "may", "could"), the cover headline MUST keep it, using the same connector word, e.g. "Exports up 151% CAGR, but machines are imported". A cover without the quote's "but ..." clause fails validation.
- Hook payoff: if the cover headline contains a number, at least one later slide must expand on that number with context (what it measures, whose it is, the period, any caveat).
- Cover payoff: the cover's claim MUST also appear on a later content slide (best: the "stat" slide for that number, with the caveat in its body), and that later slide also keeps the caveat. Cite the same claim id on both the cover and that slide.
- Slide 2 explains the cover: what the cover number measures, why it matters and the problem or opportunity it reveals (usually the stat slide for the cover's number, with the quote's "but ..." clause). It must NOT be a "why act now" or urgency slide.
- Use one "stat" slide for the single most striking number (the cover's number, with its caveat in the body), and a chart when the quotes have comparable numbers. Mix slide types; never two plain paragraph slides in a row.
- Every slide must be full and useful: a point slide carries 3-4 crisp bullets, not a single line floating on empty space. If a slide would hold only one short fact, either add a related fact to it or merge it into another slide.
- Slide order tells a story the reader can follow: hook -> what the hook means (slide 2) -> evidence and examples -> how it works / the numbers -> what the reader can do -> why now. Urgency or timing quotes ("window", "right now", "soon") go on the LAST content slide, never early.
- One idea per slide: every bullet on a slide supports its headline. Do not mix profit, entry cost and a business model on one slide; split them or leave the weakest out.
- Teach, do not just list: each content slide should leave the reader knowing one thing they did not know, plus why it matters, both from the quotes. Prefer a quote that gives context to a number ("Let's price one 500 ml bottle made in a single shift") over a second bare number.
- Write every headline in sentence case ("Where the money is", not "Where The Money Is"): capitalise only the first word, names and acronyms. Make each headline a specific takeaway the reader can learn from that slide alone ("Imports dwarf local supply"), never a generic label like "Key facts", "Overview" or "Market context".
- Plain, confident, human tone. Short sentences. No jargon. No filler like "In today's world".
- Never pad slide text with attribution filler such as "according to the data", "as per the report", "based on the analysis" or "the data shows that". State the fact directly: "Profit per part is Rs 1,965", not "Profit per part is Rs 1,965 according to the data".

Return JSON only, matching the schema."""


import re as _re

# Matches an inline claim reference the model sometimes leaks into visible text,
# e.g. "(C01)", " (C01, C04)", "[C12]", or a trailing bare "C06". Never touches
# real content because claim ids are always C followed by digits.
_CLAIM_REF_RE = _re.compile(r"\s*[\(\[]\s*C\d+(?:\s*,\s*C\d+)*\s*[\)\]]|\bC\d+\b")


def strip_claim_refs(text: Optional[str]) -> Optional[str]:
    """Remove any claim id the composer printed into slide-visible text. Claim ids
    belong only in the claim_ids field; left in, they render as "(C01)" on the slide."""
    if not isinstance(text, str):
        return text
    cleaned = _CLAIM_REF_RE.sub("", text)
    # tidy the spaces/punctuation the removal can leave behind
    cleaned = _re.sub(r"\s{2,}", " ", cleaned)
    cleaned = _re.sub(r"\s+([.,;:!?])", r"\1", cleaned)
    cleaned = _re.sub(r"\(\s*\)|\[\s*\]", "", cleaned)
    # a dangling dash the model sometimes ends a bullet with ("... ~₹5.2 Lakhs –")
    cleaned = _re.sub(r"\s+[–—-]+\s*$", "", cleaned)
    return cleaned.strip()


def _clean_source_note(note: Optional[str]) -> Optional[str]:
    """Drop a source_note that is just a claim id ("Source: C06") rather than a real label."""
    if not isinstance(note, str):
        return note
    stripped = strip_claim_refs(note)
    # "Source:" with nothing meaningful left -> no note
    if _re.sub(r"(?i)^\s*source\s*:?\s*", "", stripped).strip() == "":
        return None
    return stripped


# Describing words the composer sometimes adds to a figure ("Average profit per part")
# that turn a single quoted number into a claimed statistic. Dropped unless the quote has them.
_QUALIFIER_WORDS = ("average", "typical", "mean", "median", "net", "gross", "estimated", "approximately")


def drop_ungrounded_qualifiers(text: Optional[str], cited_text: str) -> Optional[str]:
    """Remove a qualifier such as "Average" from slide text when none of the cited quotes use it."""
    if not isinstance(text, str):
        return text
    cited = cited_text.lower()
    out = text
    for w in _QUALIFIER_WORDS:
        if _re.search(r"\b" + w + r"\b", cited):
            continue
        out = _re.sub(r"(?i)\b" + w + r"\b\s*", "", out)
    out = _re.sub(r"\s{2,}", " ", out).strip()
    if out and out[0].islower() and text[:1].isupper():
        out = out[0].upper() + out[1:]
    return out


# Attribution filler the composer pads slide text with ("... according to the data").
# It adds no information and reads as hedging, so it is cut from body/bullets/items.
_FILLER_RE = _re.compile(
    r"(?i)[,\s]*\b(?:according to (?:the|this) (?:data|report|analysis|document|source)"
    r"|as per (?:the|this) (?:data|report|analysis|document|source)"
    r"|based on (?:the|this) (?:data|report|analysis|document)"
    r"|(?:the|this) (?:data|report|analysis) (?:shows|suggests|indicates) that)\b,?\s*"
)


def strip_filler_phrases(text: Optional[str]) -> Optional[str]:
    """Remove attribution filler like "according to the data" from slide-visible text."""
    if not isinstance(text, str):
        return text
    out = _FILLER_RE.sub(" ", text)
    out = _re.sub(r"\s{2,}", " ", out)
    out = _re.sub(r"\s+([.,;:!?])", r"\1", out).strip()
    out = _re.sub(r"^[,;:]\s*", "", out)
    if out and out[0].islower() and text[:1].isupper():
        out = out[0].upper() + out[1:]
    return out


def deck_to_slides(deck: "Deck", claims_by_id: Optional[Dict[str, Claim]] = None) -> List[Dict]:
    """Slide dicts from a composed deck: empty fields dropped, each chart value's size
    taken from its printed value_raw so a bar can never be drawn longer than its label says,
    and any leaked claim id (e.g. "(C01)") scrubbed from visible text."""
    from ..validators.charts import normalize_series
    slides = []
    for s in deck.slides:
        d = {k: v for k, v in s.model_dump().items() if v is not None}
        cited = " ".join(claims_by_id[c].quote for c in d.get("claim_ids") or [] if c in claims_by_id) if claims_by_id else None
        for field in ("headline", "body", "number"):
            if field in d:
                d[field] = strip_claim_refs(d[field])
                if cited is not None:
                    d[field] = drop_ungrounded_qualifiers(d[field], cited)
                if field == "body":
                    d[field] = strip_filler_phrases(d[field])
        for field in ("bullets", "items"):
            if isinstance(d.get(field), list):
                d[field] = [strip_claim_refs(x) for x in d[field]]
                if cited is not None:
                    d[field] = [drop_ungrounded_qualifiers(x, cited) for x in d[field]]
                d[field] = [strip_filler_phrases(x) for x in d[field]]
        if "source_note" in d:
            note = _clean_source_note(d["source_note"])
            if note is None:
                d.pop("source_note", None)
            else:
                d["source_note"] = note
        if d.get("series"):
            d["series"] = normalize_series(d["series"])
        slides.append(d)
    return slides


def _build_user_prompt(claims: List[Claim], tag: str, repair_feedback: Optional[str] = None) -> str:
    def label(c: Claim) -> str:
        return f"{c.kind}; about: {', '.join(c.about)}" if c.about else f"{c.kind}"

    claims_text = "\n".join(f'[{c.id}] ({label(c)}) "{c.quote}"' for c in claims)
    prompt = f"Tag: {tag}\n\nClaims:\n{claims_text}"
    if repair_feedback:
        prompt += f"\n\nFIX THESE PROBLEMS:\n{repair_feedback}"
    return prompt


def compose_deck(
    claims: List[Claim],
    content_slides: int,
    tag: str,
    llm: LLMClient,
    repair_feedback: Optional[str] = None,
    out_dir: Optional[Path] = None,
    stage_suffix: str = ""
) -> Deck:
    """Compose slide drafts using ONLY verified claims. Never sees original document."""
    content_slides_plus_cover = content_slides + 1
    from .. import tuning
    cfg = tuning.load()["compose"]
    system_prompt = tuning.with_notes(SYSTEM_PROMPT_TEMPLATE.format(
        content_slides=content_slides,
        content_slides_plus_cover=content_slides_plus_cover
    ), "compose")

    # Compose guard: if the prompt exceeds the budget (default 4,800 tokens), drop lowest-priority claims (4,800 + 1,400
    # completion stays under the 6,800 usable tokens per minute of the Groq free tier)
    active_claims = list(claims)
    user_prompt = _build_user_prompt(active_claims, tag, repair_feedback)

    def get_rank(c: Claim) -> int:
        k = (c.kind or "").lower()
        return KIND_PRIORITY.index(k) if k in KIND_PRIORITY else len(KIND_PRIORITY)

    while estimate_tokens(system_prompt + user_prompt) > cfg["prompt_token_budget"] and len(active_claims) > cfg["min_claims_kept"]:
        # Find claim with lowest priority (highest rank index)
        lowest_idx = max(range(len(active_claims)), key=lambda i: get_rank(active_claims[i]))
        active_claims.pop(lowest_idx)
        user_prompt = _build_user_prompt(active_claims, tag, repair_feedback)

    stage_name = f"compose{stage_suffix}"
    deck: Deck = llm.generate_json(
        system=system_prompt,
        user=user_prompt,
        schema=Deck,
        temperature=tuning.temperature("compose"),
        stage=stage_name,
        log_dir=out_dir
    )

    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        filename = "05_compose_repair_raw.json" if repair_feedback else "03_compose_raw.json"
        with open(out_dir / filename, "w", encoding="utf-8") as f:
            json.dump(deck.model_dump(), f, indent=2, ensure_ascii=False)

    return deck
