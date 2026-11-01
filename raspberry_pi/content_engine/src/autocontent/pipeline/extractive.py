"""Extractive deck builder: purely deterministic, always truthful fallback."""

import re
from typing import List, Dict, Any, Tuple, Optional, Set
from ..ingest.units import Unit, _split_into_sentences
from ..ingest.reader import _clean_md_heading
from .extract_claims import Claim
from ..ingest.tables import ParsedTable, detect_column_type
from ..validators.headlines import _ends_dangling, DANGLING_END_WORDS
from ..validators.attribution import key_entities, claim_subjects, entities_in


def _truncate_heading(heading: str, max_words: int = 6) -> str:
    words = heading.split()
    if len(words) <= max_words:
        return heading
    return " ".join(words[:max_words])


def _fit_phrase(phrase: str, max_words: int = 6, max_chars: int = 40) -> str:
    """Shorten a heading to the limits (see _fit_phrase_raw); a parenthetical that the cut left
    open ("The Massive Trade Deficit (The") is dropped, never shown half-written."""
    fitted = _fit_phrase_raw(phrase, max_words, max_chars)
    if fitted.count("(") > fitted.count(")"):
        fitted = fitted[:fitted.rfind("(")].rstrip(",;:- ") or fitted
    return fitted


def _fit_phrase_raw(phrase: str, max_words: int = 6, max_chars: int = 40) -> str:
    """Shorten a heading to the limits at a natural break ("..., and", "of", "in"), never
    leaving a dangling last word. "Portronics: The Innovator in Corporate Utility" -> "Portronics: The Innovator"."""
    words = phrase.split()
    if len(words) <= max_words and len(phrase) <= max_chars and not _ends_dangling(phrase):
        return phrase
    best = ""
    for end in range(1, len(words)):
        nxt = words[end].lower().strip(",;:")
        if nxt in DANGLING_END_WORDS or words[end - 1].endswith((",", ";")):
            cand = " ".join(words[:end]).rstrip(",;:- ")
            if len(cand.split()) <= max_words and len(cand) <= max_chars and not _ends_dangling(cand):
                best = cand
    if best and len(best.split()) >= 2:
        return best
    trimmed = words[:max_words]
    while trimmed and (len(" ".join(trimmed)) > max_chars or _ends_dangling(" ".join(trimmed))):
        trimmed.pop()
    return " ".join(trimmed).rstrip(",;:- ") or " ".join(words[:max_words])


_GENERIC_HEADING_LABELS = {"introduction", "conclusion", "overview", "summary", "background", "context", "executive summary"}


def _slide_headline(heading: Optional[str], about: List[str], body: str) -> str:
    """Headline from the section heading that also names whom the slide is about.

    "Zebronics: High-Velocity Scale and Margin Compression" -> "Zebronics: High-Velocity Scale";
    a heading that does not name the slide's single subject gets it as a prefix ("Zebronics: ...").
    """
    h = re.sub(r"^\d+\.\s*", "", _clean_md_heading(heading or "") if heading else "")
    # A heading's aside with a number the slide does not show ("The Math (80%+ Margins?!)")
    # would print an unsupported figure: drop the aside.
    h = re.sub(r"\s*\(([^)]*\d[^)]*)\)",
               lambda m: m.group(0) if all(n in body for n in re.findall(r"\d[\d,.]*", m.group(1))) else "", h).strip()
    if not h:
        h = about[0] if len(about) == 1 else "Key finding"
    if h.lower() in _GENERIC_HEADING_LABELS and len(about) == 1:
        # "Conclusion" alone says nothing; "Conclusion: Portronics" says whose
        return _fit_phrase(f"{h}: {about[0]}")
    if len(about) == 1 and not entities_in(h + "\n" + body, about):
        rest = re.sub(r"^the\s+", "", h, flags=re.I)
        rest = rest[:1].upper() + rest[1:]
        return f"{about[0]}: " + _fit_phrase(rest, max_words=5, max_chars=38 - len(about[0]))
    if ":" in h:
        lead, rest = (p.strip() for p in h.split(":", 1))
        if lead.lower() in _GENERIC_HEADING_LABELS and rest:
            # "Introduction: The Macroeconomic Architecture of ..." -> "The Macroeconomic Architecture"
            return _fit_phrase(rest)
        if len(lead.split()) <= 2 and rest:
            return _fit_phrase(f"{lead}: {rest}")
        # "The Apex Predators: Navigating Around boAt, Noise, and Fire-Boltt" -> "The Apex Predators"
        if _fit_phrase(h) != h and 2 <= len(lead.split()) <= 6 and len(lead) <= 40:
            return lead
    return _fit_phrase(h)


_META_SENTENCE = re.compile(
    r"^(this (report|analysis|study|paper|section|case study|research)|in this (report|analysis|study|section)|"
    r"furthermore, this analysis|the following)|\bthis (report|analysis) (provides|examines|explores)", re.I)


def _salience(sentence: str, about: List[str], entities: List[str]) -> int:
    """How much a sentence is worth a slide: numbers and named subjects up, long or meta sentences down."""
    from ..validators.numbers import extract_number_mentions
    # A year dates a fact; it is not one ("in 2025", "FY24")
    sentence_no_fy = re.sub(r"\bFY\s?\d{2,4}\b", "", sentence)
    score = 2 * sum(1 for m in extract_number_mentions(sentence_no_fy)
                    if m.cls != "year" and not re.fullmatch(r"(?:19|20)\d{2}", m.raw.strip()))
    score += len(set(entities_in(sentence, entities)) | set(about))
    if len(sentence.split()) > 30:
        score -= 3
    if _META_SENTENCE.search(sentence):
        score -= 2
    return score


# A short title-case label that opens a list item ("Strategic Capital Expenditure: ")
_ITEM_LABEL = re.compile(r"^([A-Z][\w&/’'\-]*(?:\s+(?:[A-Z][\w&/’'\-]*|and|of|&|the)){0,5}):\s+(?=[A-Z])")


def _fits_body(text: str) -> bool:
    return len(text.split()) <= 30 and len(text) <= 200


def _fits_bullet(text: str) -> bool:
    return len(text.split()) <= 12 and len(text) <= 80


def _table_cells(text: str) -> Optional[List[Tuple[str, str]]]:
    cells = [c.split(":", 1) for c in text.split(" | ")]
    if len(cells) < 2 or not all(len(c) == 2 for c in cells):
        return None
    return [(h.strip(), v.strip()) for h, v in cells]


def _chart_value(cell: str) -> Optional[Tuple[str, Any]]:
    """("1,278", mention) for a cell that is just one number ("1,278 (As of early 2026)",
    "26.6%", "600+", "~3.64%"); None for ranges, text, or several numbers."""
    from ..validators.numbers import extract_number_mentions
    text = re.sub(r"\s*\([^)]*\)\s*$", "", cell).strip()
    mentions = extract_number_mentions(text)
    if len(mentions) != 1 or mentions[0].cls in ("year", "ordinal"):
        return None
    m = mentions[0]
    rest = text.lower().replace(m.raw.lower(), "", 1).strip(" ~≈+")
    if rest:
        return None
    return text, m


def _chart_label_ok(label: str) -> bool:
    return bool(label) and len(label.split()) <= 4 and len(label) <= 28


def _chart_kind(labels: List[str], mentions: List[Any]) -> str:
    from ..validators.charts import TIME_LABEL
    if all(TIME_LABEL.match(l.strip()) for l in labels):
        return "line"
    if all(m.cls == "percent" for m in mentions) and 95 <= float(sum(m.value for m in mentions)) <= 100.5:
        return "pie"
    return "bar"


def _metric_phrase(prefix: str) -> str:
    """The metric named just before a number: "...reported a Profit After Tax (PAT) of" ->
    "Profit After Tax"; "...the PAT margins remain ..., registering at just" -> "PAT margins"."""
    runs = re.findall(r"[A-Z][\w&\-]*(?:\s+(?:[A-Z][\w&\-]*|of|and))*(?:\s+[a-z]+s\b)?", prefix)
    runs = [re.sub(r"(?:\s+(?:of|and))+$", "", r).strip() for r in runs]
    runs = [r for r in runs if r and r.split()[0] not in ("The", "A", "An", "However", "In", "By", "Its", "This")]
    long_runs = [r for r in runs if len(r.split()) >= 2]
    return (long_runs or runs or [""])[-1]


def _chart_candidates(
    candidates: List[Tuple[str, str, Optional[str], str, List[str]]],
    tables: List[List[int]],
) -> List[Dict[str, Any]]:
    """Charts the source supports without deriving anything, best first.

    - a table column of single numbers (labels from the first column),
    - a table row of single numbers across columns (labels from the headers),
    - a sentence giving one metric for several periods ("₹43.50 crore in FY24 ... ₹52.66 crore in FY25").
    """
    from ..validators.numbers import extract_number_mentions
    found: List[Dict[str, Any]] = []

    def add(kind_labels: List[str], values: List[Tuple[str, Any]], indices: List[int], phrase: str, group: str):
        mentions = [v[1] for v in values]
        if len({m.cls for m in mentions}) != 1 or not 2 <= len(values) <= 6 or len(set(kind_labels)) != len(kind_labels):
            return
        about = sorted({e for i in indices for e in candidates[i][4]})
        found.append({
            "kind": _chart_kind(kind_labels, mentions),
            "series": [{"label": l, "value_raw": v[0]} for l, v in zip(kind_labels, values)],
            "indices": indices,
            "phrase": phrase,
            "section": candidates[indices[0]][2],
            "group": group,
            "score": 2 * len(values) + (3 if about else 0),
        })

    for t_no, t in enumerate(tables):
        rows = [_table_cells(candidates[i][1]) for i in t]
        if not all(rows) or len({tuple(h for h, _ in r) for r in rows}) != 1:
            continue
        headers = [h for h, _ in rows[0]]
        for j in range(1, len(headers)):
            good = [(i, r[0][1], _chart_value(r[j][1])) for i, r in zip(t, rows)]
            good = [(i, lab, v) for i, lab, v in good if v and _chart_label_ok(lab)]
            if len(good) == len(rows) or len(good) >= 3:
                add([g[1] for g in good[:6]], [g[2] for g in good[:6]], [g[0] for g in good[:6]], headers[j], f"table{t_no}")
        for i, r in zip(t, rows):
            good = [(h, _chart_value(v)) for h, v in r[1:]]
            good = [(h, v) for h, v in good if v and _chart_label_ok(h)]
            if len(good) == len(r) - 1 or len(good) >= 3:
                add([g[0] for g in good], [g[1] for g in good], [i], r[0][1], f"table{t_no}")

    period = re.compile(r"^\s+(?:in|for|during|by)\s+(?:the\s+)?(FY\s?\d{2,4}|(?:19|20)\d{2})\b")
    for idx, c in enumerate(candidates):
        if c[0] != "sentence":
            continue
        text = c[1]
        pairs: List[Tuple[str, Tuple[str, Any]]] = []
        first_pos = None
        for m in extract_number_mentions(text):
            if m.cls in ("year", "ordinal"):
                continue
            pos = text.lower().find(m.raw.lower())
            if pos < 0:
                continue
            raw = text[pos:pos + len(m.raw)]
            after = period.match(text[pos + len(m.raw):])
            if after:
                pairs.append((after.group(1), (raw, m)))
                first_pos = pos if first_pos is None else first_pos
        if len(pairs) >= 2:
            add([p[0] for p in pairs], [p[1] for p in pairs], [idx], _metric_phrase(text[:first_pos]), f"sentence{idx}")

    found.sort(key=lambda f: (-f["score"], f["indices"][0]))
    return found


def _fits_cover(text: str, max_words: int = 8) -> bool:
    return len(text.split()) <= max_words and len(text) <= 64


def _cover_hook(content_slides: List[Dict[str, Any]], claims: List[Claim]) -> Optional[Tuple[str, List[str]]]:
    """A number-first cover line copied from a later slide, with that slide's claim ids.

    - a line chart: "Zebronics PAT: ₹43.50 crore to ₹52.66 crore" (both ends in one quote),
    - else the stat slide: "Ambrane's total annual turnover: ₹260 crore".
    Nothing is computed; the subject is named only when the quote is about one subject.
    """
    by_id = {c.id: c for c in claims}

    def subject_of(slide: Dict[str, Any]) -> Optional[str]:
        about = sorted({e for cid in slide.get("claim_ids", []) if cid in by_id for e in by_id[cid].about})
        return about[0] if len(about) == 1 else None

    for s in content_slides:
        if s["type"] != "chart" or s.get("chart_kind") != "line" or len(s["series"]) < 2:
            continue
        subj = subject_of(s)
        quote = " ".join(by_id[cid].quote for cid in s["claim_ids"] if cid in by_id)
        metric = s["headline"].split(":", 1)[1].strip() if ":" in s["headline"] else s["headline"]
        span = f"{s['series'][0]['value_raw']} to {s['series'][-1]['value_raw']}"
        acronym = re.search(re.escape(metric) + r"\s*\(([A-Z]{2,6})\)", quote)
        options = []
        if subj:
            options += [f"{subj} {metric}: {span}"]
            if acronym:
                options.append(f"{subj} {acronym.group(1)}: {span}")
            options.append(f"{subj}: {span}")
        else:
            options.append(f"{metric}: {span}")
        for o in options:
            if _fits_cover(o):
                return o, list(s["claim_ids"])

    for s in content_slides:
        if s["type"] != "stat":
            continue
        subj = subject_of(s)
        body, number = s.get("body", ""), s.get("number", "")
        pos = body.find(number)
        m = re.search(r"\b((?:[a-z]+\s+){0,2}[a-z]+)\s+(?:had\s+|has\s+|have\s+)?(?:reached|of|was|were|is|hit|crossed|stood at)\s+$",
                      body[:pos] if pos > 0 else "")
        if not (subj and m):
            continue
        metric = re.sub(r"^(?:the|its|their|total)\s+", "", m.group(1))
        hook = f"{subj}'s {metric}: {number}"
        if _fits_cover(hook):
            return hook, list(s["claim_ids"])
    return None


_HOOK_NUMBER = re.compile(r"(?:[₹$€£]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|crores?|lakhs?|billion|million)?(?:\s+(?:CAGR|[Cc]rores?|[Ll]akhs?))?", re.I)
_HOOK_VERBS = ("grew", "rose", "hit", "reached", "jumped", "surged", "crossed", "fell", "dropped")
_HOOK_CAVEATS = ("but", "however", "though", "although")


def _caveated_cover_hook(claim_ids: List[str], claims_by_id: Dict[str, Claim]) -> Optional[Tuple[str, List[str]]]:
    """A number-first cover that keeps the quote's own caveat, built only from the quote's words:
    "India's 3D printed exports grew by a staggering 151% CAGR recently. BUT... we rely heavily on
    imported machines." -> "Exports grew 151% CAGR, but we rely on imported machines".
    None when the cited quotes hold no striking number followed by a caveat sentence."""
    for cid in claim_ids:
        c = claims_by_id.get(cid)
        if c is None:
            continue
        sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+", c.quote) if x.strip()]
        for i, sent in enumerate(sentences[:-1]):
            num = next((n for n in _HOOK_NUMBER.finditer(sent)
                        if re.search(r"%|crore|lakh|billion|million|[₹$€£]", n.group(0), re.I)), None)
            if not num:
                continue
            nxt = sentences[i + 1]
            if re.fullmatch(r"\W*(?:" + "|".join(_HOOK_CAVEATS) + r")\W*", nxt, re.I) and i + 2 < len(sentences):
                nxt = f"{nxt} {sentences[i + 2]}"  # "BUT... we rely ..." splits after the ellipsis
            m = re.match(r"^\W*(" + "|".join(_HOOK_CAVEATS) + r")\b\W*(.+?)[.!?]*$", nxt, re.I)
            if not m:
                continue
            connector = m.group(1).lower()
            caveat = re.sub(r"\s+(?:heavily|largely|mostly|highly|really|very|greatly|strongly)\b", "", m.group(2)).strip()
            number = num.group(0).strip()
            before = sent[:num.start()]
            verb = next((v for v in _HOOK_VERBS if re.search(r"\b" + v + r"\b", before, re.I)), None)
            options = []
            if verb:
                noun = re.search(r"(\w+)\s+" + verb + r"\b", before, re.I)
                if noun:
                    options.append(f"{noun.group(1).capitalize()} {verb} {number}, {connector} {caveat}")
            options.append(f"{number}, {connector} {caveat}")
            for o in options:
                if _fits_cover(o, max_words=10):  # the caveat clause earns two extra words
                    return o, [cid]
    return None


# Sections whose sentences close a deck: the report's own conclusion or recommendation
_CLOSING_HEADING = re.compile(r"\b(conclusions?|recommendations?|takeaways?|implications|lessons|bottom line|what this means|next steps)\b", re.I)


def clean_cover_title(candidate_title: str) -> Tuple[str, Optional[str]]:
    """Determine clean cover headline respecting semantic boundaries and avoiding false truncations.
    Returns: (cover_headline, optional_warning_msg)
    """
    clean_title = candidate_title.strip()
    words = clean_title.split()

    # 1. Full title if <= 8 words and <= 46 chars
    if len(words) <= 8 and len(clean_title) <= 46:
        return clean_title, None

    # 2. Part before colon or dash if it fits and is meaningful
    for sep in [":", " — ", " - "]:
        if sep in clean_title:
            before_sep = clean_title.split(sep)[0].strip()
            w_before = before_sep.split()
            if 2 <= len(w_before) <= 8 and len(before_sep) <= 60:
                warn = f"Cover title shortened to pre-colon phrase: '{before_sep}' (original: '{clean_title}')"
                return before_sep, warn

    # 2b. A complete noun phrase from the title: the object of its last "of"
    # ("Market Dynamics of India's Homegrown Consumer Electronics Brands" -> "India's Homegrown
    # Consumer Electronics Brands"). Never a phrase cut in the middle.
    parts = re.split(r":| — | - ", clean_title)
    for part in parts:
        segments = re.split(r"\s+of\s+", part.strip())
        if len(segments) > 1:
            tail = segments[-1].strip().rstrip(".,;")
            w_tail = tail.split()
            if 3 <= len(w_tail) <= 8 and len(tail) <= 60 and not _ends_dangling(tail):
                warn = f"Cover title shortened to its core phrase: '{tail}' (original: '{clean_title}')"
                return tail, warn

    # 3. Leading clause trimmed at word boundary without dangling stop-words
    dangling_words = {
        "and", "of", "the", "for", "in", "on", "at", "to", "with", "by", "from",
        "market", "survey", "notes", "report", "overview", "study", "brief", "draft", "v1", "v2"
    }
    truncated = words[:8]
    while truncated and (
        len(" ".join(truncated)) > 60
        or truncated[-1].lower().rstrip(":,.-") in dangling_words
        or _ends_dangling(" ".join(truncated))
    ):
        truncated.pop()

    if not truncated:
        truncated = words[:min(5, len(words))]

    headline = " ".join(truncated).rstrip(":,.-")
    warn = f"WARN [TITLE_SHORTENED]: Cover title shortened from '{clean_title}' to '{headline}'"
    return headline, warn


def doc_entities(units: List[Unit]) -> List[str]:
    """The named subjects of a document (companies, people, products) from its headings and text."""
    return key_entities([u.text for u in units], [u.text for u in units if u.kind == "heading"])


Candidate = Tuple[str, str, Optional[str], str, List[str]]  # (kind, text, heading, unit_id, about)


def _content_candidates(units: List[Unit], ents: List[str]) -> List[Candidate]:
    """Sentences and table rows of the document with their heading, unit id and subjects."""
    out: List[Candidate] = []
    current_heading: Optional[str] = None
    for u in units:
        if u.kind == "heading":
            current_heading = u.text
        elif u.kind == "table_row":
            out.append(("table_row", u.text, current_heading, u.id, claim_subjects(u.text, u.section, ents)))
        else:
            for s_i, s in enumerate(_split_into_sentences(u.text)):
                s_strip = s.strip()
                if s_i == 0 and u.kind == "list_item":
                    # "Revenue Growth: The company crossed ..." -> the sentence after the label
                    m = _ITEM_LABEL.match(s_strip)
                    if m and not entities_in(m.group(1), ents):
                        s_strip = s_strip[m.end():]
                if s_strip:
                    out.append(("sentence", s_strip, current_heading, u.id, claim_subjects(s_strip, u.section, ents)))
    return out


def _group_tables(candidates: List[Candidate]) -> List[List[int]]:
    """Indices of table rows grouped per table (same section, consecutive units)."""
    tables: List[List[int]] = []
    prev_uid_num = None
    for i, c in enumerate(candidates):
        if c[0] != "table_row":
            continue
        uid_num = int(re.sub(r"\D", "", c[3]) or 0)
        if tables and prev_uid_num is not None and uid_num == prev_uid_num + 1 \
                and candidates[tables[-1][-1]][2] == c[2]:
            tables[-1].append(i)
        else:
            tables.append([i])
        prev_uid_num = uid_num
    return tables


def _build_chart_slide(cand: Dict[str, Any], candidates: List[Candidate]) -> Optional[Dict[str, Any]]:
    """A chart slide (without claim ids) for one chart candidate, or None when it fails the
    chart rules or would drop a caveat or scope its source sentence carries."""
    from ..validators.charts import check_chart, normalize_series, chart_text
    from ..validators.hedges import check_hedges, check_scope
    quotes = [candidates[i][1] for i in cand["indices"]]
    about = sorted({e for i in cand["indices"] for e in candidates[i][4]})
    labels_text = " ".join(p["label"] for p in cand["series"])
    phrase = cand["phrase"] or (cand["section"] or "Key numbers")
    headline = _fit_phrase(phrase)
    if len(about) == 1 and not entities_in(headline + "\n" + labels_text, about):
        headline = f"{about[0]}: " + _fit_phrase(phrase, max_words=5, max_chars=38 - len(about[0]))
    # "Table 2" when the report names the table just above it, else the section heading
    source = re.sub(r"^\d+\.\s*", "", (cand["section"] or "")).replace(":", " –").strip()
    first = cand["indices"][0]
    if candidates[first][0] == "table_row":
        k = first - 1
        while k >= 0 and candidates[k][0] == "table_row":
            k -= 1
        for k in range(k, max(-1, k - 3), -1):
            tm = re.match(r"^(Table \d+)\b", candidates[k][1])
            if tm:
                source = tm.group(1)
                break
    slide = {
        "type": "chart",
        "chart_kind": cand["kind"],
        "headline": headline,
        "series": normalize_series(cand["series"]),
        "source_note": _fit_phrase(f"Source: {source}", max_words=8, max_chars=60) if source else "",
        "claim_ids": [],
        "_order": first,
    }
    if check_chart(slide, quotes):
        return None
    shown = headline + "\n" + chart_text(slide)
    joined = "\n".join(quotes)
    if any(i.severity == "ERROR" for i in check_hedges(shown, joined) + check_scope(shown, joined)):
        return None
    return slide


def add_source_charts(
    slides: List[Dict[str, Any]],
    units: List[Unit],
    claims_by_id: Dict[str, Claim],
    entities: Optional[List[str]] = None,
    max_charts: int = 2,
) -> List[str]:
    """Give a composed deck the charts its source supports (in place).

    Charts are built from the document's own tables and sentences, exactly as in extractive
    decks, and each one replaces the weakest content slide: first a slide showing the same
    source text, then a fallback slide, then a plain point slide. Never the cover, slide 2 or
    the last content slide. New claims are added to claims_by_id. Returns progress notes.
    """
    ents = entities if entities is not None else doc_entities(units)
    have = sum(1 for s in slides if s.get("type") == "chart")
    if have >= max_charts:
        return []
    candidates = _content_candidates(units, ents)
    notes: List[str] = []
    used_groups: Set[str] = set()
    last_content = max((k for k, s in enumerate(slides) if s.get("type") not in ("cover", "cta")), default=0)
    protected = {0, 1, last_content}
    for cand in _chart_candidates(candidates, _group_tables(candidates)):
        if have >= max_charts:
            break
        if cand["group"] in used_groups:
            continue
        chart = _build_chart_slide(cand, candidates)
        if chart is None:
            continue
        chart.pop("_order", None)
        quotes = {candidates[i][1] for i in cand["indices"]}

        def weakness(k: int) -> Optional[Tuple[int, int]]:
            s = slides[k]
            if k in protected or s.get("type") not in ("point", "list", "quote") \
                    or _CLOSING_HEADING.search(s.get("headline", "")):
                return None
            cited = {claims_by_id[c].quote for c in s.get("claim_ids") or [] if c in claims_by_id}
            if cited & quotes:
                return (0, k)
            if s.get("source_status") == "extractive_fallback":
                return (1, k)
            return (2, k) if s.get("type") == "point" else None

        options = sorted(w for w in (weakness(k) for k in range(len(slides))) if w is not None)
        if not options:
            break
        k = options[0][1]
        n = 1 + len([c for c in claims_by_id if c.startswith("C_CH_")])
        for i in cand["indices"]:
            cid = f"C_CH_{n:02d}"
            n += 1
            claims_by_id[cid] = Claim(id=cid, unit_id=candidates[i][3], quote=candidates[i][1], kind="number",
                                      about=candidates[i][4])
            chart["claim_ids"].append(cid)
        chart["source_status"] = "extractive_chart"
        notes.append(f"Slide {k + 1} ({slides[k].get('type')} '{slides[k].get('headline', '')}') replaced by "
                     f"{chart['chart_kind']} chart '{chart['headline']}' from the source")
        slides[k] = chart
        used_groups.add(cand["group"])
        have += 1
    return notes


def build_extractive_deck(
    units: List[Unit],
    content_slide_count: int,
    tag: str,
    doc_title: Optional[str] = None,
    entities: Optional[List[str]] = None
) -> Tuple[List[Dict[str, Any]], List[Claim], List[str], List[Dict[str, str]]]:
    """Build slides using verbatim text from units without LLM calls.
    Returns: (slides, synthetic_claims, warnings, not_included)
    """
    warnings: List[str] = []
    slides: List[Dict[str, Any]] = []
    synthetic_claims: List[Claim] = []
    claim_counter = 1
    ents = entities if entities is not None else doc_entities(units)

    # 1. Determine Cover Headline
    candidate_title = doc_title or ""
    if not candidate_title:
        for u in units:
            if u.kind == "heading":
                candidate_title = u.text
                break
    if not candidate_title and units:
        candidate_title = units[0].text

    cover_headline, title_warn = clean_cover_title(candidate_title)
    if title_warn:
        warnings.append(title_warn)

    # Create synthetic claim for cover
    cover_cid = f"C{claim_counter:02d}"
    claim_counter += 1
    # Find matching unit
    cov_uid = units[0].id if units else "U001"
    for u in units:
        if cover_headline in u.text:
            cov_uid = u.id
            break
    synthetic_claims.append(
        Claim(id=cover_cid, unit_id=cov_uid, quote=cover_headline, kind="finding",
              about=claim_subjects(cover_headline, None, ents))
    )

    slides.append({
        "type": "cover",
        "headline": cover_headline,
        "claim_ids": [cover_cid],
        "source_status": "extractive"
    })

    # 2. Extract content sentences and table rows with unit_id provenance
    content_candidates = _content_candidates(units, ents)

    used_candidate_indices: Set[int] = set()
    used_headings_count: Dict[str, int] = {}

    def get_slide_headline(raw_heading: Optional[str], about: List[str], body: str) -> str:
        clean_h = _slide_headline(raw_heading, about, body)
        count = used_headings_count.get(clean_h, 0)
        used_headings_count[clean_h] = count + 1
        if count == 0:
            return clean_h
        # Second or subsequent usage: append " (cont.)" (D10)
        return f"{_fit_phrase(clean_h, max_words=5, max_chars=33)} (cont.)"

    def new_claim(text: str, uid: str, kind: str, about: List[str]) -> str:
        nonlocal claim_counter
        cid = f"C{claim_counter:02d}"
        claim_counter += 1
        synthetic_claims.append(Claim(id=cid, unit_id=uid, quote=text, kind=kind, about=about))
        return cid

    created_content_slides: List[Dict[str, Any]] = []

    # Table rows: grouped per table (same section, consecutive units) so tables are never mixed.
    tables_found = _group_tables(content_candidates)

    # Charts: numbers the source already lines up (a numeric table column, a table row across
    # companies, one metric over several periods) become a chart slide; up to three in a
    # 9-slide deck. Every bar is a number copied from its row or sentence; check_chart must pass.
    max_charts = 3 if content_slide_count >= 7 else 2 if content_slide_count >= 6 else 1
    used_groups: Set[str] = set()
    for cand in _chart_candidates(content_candidates, tables_found):
        if sum(1 for s in created_content_slides if s["type"] == "chart") >= max_charts \
                or len(created_content_slides) >= content_slide_count - 1:
            break
        if cand["group"] in used_groups or any(i in used_candidate_indices for i in cand["indices"]):
            continue
        chart_slide = _build_chart_slide(cand, content_candidates)
        if chart_slide is None:
            continue
        chart_slide["source_status"] = "extractive"
        for i in cand["indices"]:
            used_candidate_indices.add(i)
            chart_slide["claim_ids"].append(new_claim(content_candidates[i][1], content_candidates[i][3], "number",
                                                      content_candidates[i][4]))
        used_groups.add(cand["group"])
        created_content_slides.append(chart_slide)

    # Stat: the most striking number gets a slide of its own in longer decks; a 9-slide deck
    # gets a second big figure, about a different subject when there is one.
    from ..validators.numbers import extract_number_mentions, check_ranges
    max_stats = 2 if content_slide_count >= 7 else 1 if content_slide_count >= 5 else 0
    stat_subjects: List[Tuple[str, ...]] = []
    for stat_no in range(max_stats):
        if len(created_content_slides) >= content_slide_count - 2:
            break
        best_stat = None
        for i, c in enumerate(content_candidates):
            if c[0] != "sentence" or i in used_candidate_indices or len(c[1].split()) > 20 or len(c[1]) > 140:
                continue
            ms = []
            for m in extract_number_mentions(c[1]):
                pos = c[1].lower().find(m.raw.lower())
                # "10-12%" is a range; showing "12%" alone would drop half of it
                if pos < 0 or (pos > 0 and c[1][pos - 1] in "-–~0123456789") or check_ranges(m.raw, c[1]):
                    continue
                if m.cls == "percent" or m.cls.startswith("currency:"):
                    ms.append(m)
            if not ms:
                continue
            score = _salience(c[1], c[4], ents) + (2 if ms[0].cls.startswith("currency:") else 0)
            score -= 3 * (tuple(c[4]) in stat_subjects)
            if best_stat is None or score > best_stat[0]:
                best_stat = (score, i, ms[0])
        if best_stat is None:
            break
        _, i, m = best_stat
        c = content_candidates[i]
        pos = c[1].lower().find(m.raw.lower())
        number = c[1][pos:pos + len(m.raw)] if pos >= 0 else m.raw
        used_candidate_indices.add(i)
        if len(number.split()) > 3 or len(number) > 20:
            continue
        stat_subjects.append(tuple(c[4]))
        created_content_slides.append({
            "type": "stat",
            "headline": get_slide_headline(c[2], c[4], c[1]),
            "number": number,
            "body": c[1],
            "claim_ids": [new_claim(c[1], c[3], "number", c[4])],
            "source_status": "extractive",
            "_order": i,
            "_best": stat_no == 0,
        })

    for t_indices in tables_found:
        if len(created_content_slides) >= content_slide_count or len(t_indices) < 3:
            continue
        if any(i in used_candidate_indices for i in t_indices):
            continue  # already shown as a chart
        rows_to_use_indices = t_indices[:4]
        first_row = content_candidates[rows_to_use_indices[0]]
        raw_list_heading = first_row[2] or "Key data"

        # Rebuild the table from "Header: value | Header: value" quotes so rows are
        # formatted by ParsedTable (keeps the column meaning: "Raised 20%: 3 founders").
        parsed_rows = []
        for idx in rows_to_use_indices:
            r_text = content_candidates[idx][1]
            cells = [c.split(":", 1) for c in r_text.split(" | ")]
            parsed_rows.append(cells if all(len(c) == 2 for c in cells) else None)
        table = None
        if all(parsed_rows) and len({len(r) for r in parsed_rows}) == 1:
            headers = [c[0].strip() for c in parsed_rows[0]]
            rows = [[c[1].strip() for c in r] for r in parsed_rows]
            col_types = [detect_column_type([r[i] for r in rows]) for i in range(len(headers))]
            table = ParsedTable(headers=headers, rows=rows, col_types=col_types)
            if headers[0]:
                raw_list_heading = headers[0]

        item_texts = []
        for k, idx in enumerate(rows_to_use_indices):
            r_text = content_candidates[idx][1]
            formatted = None
            if table is not None:
                try:
                    formatted = table.format_row_for_slide(table.rows[k])
                except ValueError:
                    formatted = None
            if formatted:
                item_texts.append(formatted)
            elif " | " in r_text and ":" in r_text:
                parts = [p.split(":", 1) for p in r_text.split(" | ") if ":" in p]
                if len(parts) == 2:
                    lbl, v = parts[0][1].strip(), parts[1][1].strip()
                    item_texts.append(f"{lbl} — {v}")
                elif len(parts) == 3:
                    lbl, v1, v2 = parts[0][1].strip(), parts[1][1].strip(), parts[2][1].strip()
                    item_texts.append(f"{lbl} — {v1} ({v2})")
                else:
                    item_texts.append(r_text)
            else:
                item_texts.append(r_text)

        # A wide comparison table (one column per company) does not fit as short items;
        # leave it out rather than cut a row or drop whose value it is.
        if any(len(t.split()) > 10 or len(t) > 70 for t in item_texts):
            continue

        list_claim_ids = []
        for idx in rows_to_use_indices:
            used_candidate_indices.add(idx)
            _, r_text, _, r_uid, r_about = content_candidates[idx]
            list_claim_ids.append(new_claim(r_text, r_uid, "number", r_about))
        created_content_slides.append({
            "type": "list",
            "headline": get_slide_headline(raw_list_heading, [], " ".join(item_texts)),
            "items": item_texts,
            "claim_ids": list_claim_ids,
            "source_status": "extractive",
            "_order": rows_to_use_indices[0],
        })
        break

    # Closing slide: the report's own conclusion or recommendation, one whole sentence that fits.
    closing_slide: Optional[Dict[str, Any]] = None
    if content_slide_count >= 4 and len(created_content_slides) < content_slide_count:
        closing = [i for i, c in enumerate(content_candidates)
                   if c[0] == "sentence" and i not in used_candidate_indices and c[2]
                   and _CLOSING_HEADING.search(c[2]) and _fits_body(c[1]) and not _META_SENTENCE.search(c[1])]
        if closing:
            i = max(closing, key=lambda k: (_salience(content_candidates[k][1], content_candidates[k][4], ents), -k))
            c = content_candidates[i]
            used_candidate_indices.add(i)
            closing_slide = {
                "type": "point",
                "headline": get_slide_headline(c[2], c[4], c[1]),
                "body": c[1],
                "claim_ids": [new_claim(c[1], c[3], "finding", c[4])],
                "source_status": "extractive",
            }
            content_slide_count -= 1

    # Prose: group sentences by heading, rank sections by their most salient sentence.
    sections: List[Tuple[Optional[str], List[int]]] = []
    seen_sec: Dict[Optional[str], List[int]] = {}
    for idx, c in enumerate(content_candidates):
        if c[0] == "table_row" or idx in used_candidate_indices:
            continue
        sec_h = c[2]
        if sec_h not in seen_sec:
            seen_sec[sec_h] = []
            sections.append((sec_h, seen_sec[sec_h]))
        seen_sec[sec_h].append(idx)

    scores = {idx: _salience(content_candidates[idx][1], content_candidates[idx][4], ents)
              for _, s_indices in sections for idx in s_indices}

    def section_groups(s_indices: List[int]) -> List[List[int]]:
        """Slide bodies for one section, best first: the top sentence plus, when it fits, the next
        best sentence about the same subject. Sentences are never cut; over-long ones are skipped."""
        fitting = [i for i in s_indices if _fits_body(content_candidates[i][1])]
        ranked = sorted(fitting, key=lambda i: (-scores[i], i))
        groups: List[List[int]] = []
        taken: Set[int] = set()
        for i in ranked:
            if i in taken:
                continue
            group = [i]
            taken.add(i)
            for j in ranked:
                if j in taken or content_candidates[j][4] != content_candidates[i][4] or scores[j] <= 0:
                    continue
                if _fits_body(" ".join(content_candidates[k][1] for k in sorted(group + [j]))):
                    group.append(j)
                    taken.add(j)
                    break
            groups.append(sorted(group))
        return groups

    sec_groups = [(sec_h, section_groups(s_indices)) for sec_h, s_indices in sections]
    sec_groups = [(sec_h, g) for sec_h, g in sec_groups if g]

    # A document of only long sentences: fall back to trimming them at a word boundary
    if not sec_groups and sections:
        sec_groups = [(sec_h, [[i] for i in s_indices]) for sec_h, s_indices in sections]

    remaining_slots = content_slide_count - len(created_content_slides)
    if remaining_slots > 0 and sec_groups:
        def group_score(g: List[int]) -> int:
            return max(scores[i] for i in g)

        # Every section's best group competes first, then the second-best groups, and so on.
        # A subject that already has a slide counts 2 less, so a report about three companies
        # covers each of them before a second slide on one.
        picks: List[Tuple[int, int]] = []
        covered: Dict[Tuple[str, ...], int] = {}
        by_rank: Dict[int, List[Tuple[int, int]]] = {}
        for s_pos, (_, groups) in enumerate(sec_groups):
            for g_rank in range(len(groups)):
                by_rank.setdefault(g_rank, []).append((s_pos, g_rank))
        for g_rank in sorted(by_rank):
            pool = list(by_rank[g_rank])
            while pool and len(picks) < remaining_slots:
                def adjusted(p: Tuple[int, int]) -> Tuple[int, int]:
                    g = sec_groups[p[0]][1][p[1]]
                    subj = tuple(content_candidates[g[0]][4])
                    return (-(group_score(g) - 2 * covered.get(subj, 0) * bool(subj)), p[0])
                best = min(pool, key=adjusted)
                pool.remove(best)
                picks.append(best)
                subj = tuple(content_candidates[sec_groups[best[0]][1][best[1]][0]][4])
                covered[subj] = covered.get(subj, 0) + 1
        # Present in document order
        picks.sort()

        for s_pos, g_rank in picks:
            sec_h, groups = sec_groups[s_pos]
            group = groups[g_rank]
            texts = []
            for idx in group:
                sent_text = content_candidates[idx][1]
                if not _fits_body(sent_text):
                    words = sent_text.split()
                    sub_words = []
                    for w in words:
                        if len(" ".join(sub_words + [w])) <= 195 and len(sub_words) < 28:
                            sub_words.append(w)
                        else:
                            break
                    sent_text = " ".join(sub_words)
                texts.append(sent_text)
            about = content_candidates[group[0]][4]
            grouped_cids = []
            for idx, text in zip(group, texts):
                used_candidate_indices.add(idx)
                grouped_cids.append(new_claim(text, content_candidates[idx][3], "finding", content_candidates[idx][4]))
            body_text = " ".join(texts)
            if not _fits_body(body_text):
                warnings.append(f"Extractive slide sentence exceeds limits: '{body_text[:40]}...'")

            point_slide = {
                "type": "point",
                "headline": get_slide_headline(sec_h, about, body_text),
                "body": body_text,
                "claim_ids": grouped_cids,
                "source_status": "extractive",
                "_order": group[0],
            }
            # Two or more short facts read better as bullets than as a paragraph
            if len(texts) >= 2 and all(_fits_bullet(t) for t in texts):
                point_slide["body"] = ""
                point_slide["bullets"] = texts
            created_content_slides.append(point_slide)

    # Slides follow the document; context first: a data list or chart reads better after the
    # first prose slide ("About this study").
    created_content_slides.sort(key=lambda sl: sl.get("_order", 0))
    for sl in created_content_slides:
        sl.pop("_order", None)
    if created_content_slides and created_content_slides[0]["type"] in ("list", "chart") and len(created_content_slides) > 1:
        created_content_slides.insert(1, created_content_slides.pop(0))
    # Slide 2 is the reason to keep swiping: the single most striking number
    stat_at = next((k for k, sl in enumerate(created_content_slides) if sl.pop("_best", False)), None)
    for sl in created_content_slides:
        sl.pop("_best", None)
    if stat_at:
        created_content_slides.insert(0, created_content_slides.pop(stat_at))
    if closing_slide is not None:
        created_content_slides.append(closing_slide)

    # Cover: a number-first hook copied from a later slide (which pays it off), else the title
    hook = _cover_hook(created_content_slides, synthetic_claims)
    if hook is not None:
        slides[0]["headline"], slides[0]["claim_ids"] = hook[0], hook[1]
        synthetic_claims[:] = [c for c in synthetic_claims if c.id != cover_cid]

    slides.extend(created_content_slides)
    # Compute not_included items (D5)
    not_included: List[Dict[str, str]] = []
    for idx, c in enumerate(content_candidates):
        if idx not in used_candidate_indices:
            not_included.append({
                "unit_id": c[3],
                "text": c[1]
            })

    return slides, synthetic_claims, warnings, not_included


def _shorten_quote(quote: str) -> str:
    """A quote over 30 words or 200 chars ended at its last clause break that fits
    ("..., which is projected to reach $65 billion to $66 billion calendar year value."),
    else trimmed to a word boundary within limits."""
    words = quote.split()
    # whole sentences first: a cut mid-sentence ("The Opportunity: Set up.") reads as broken
    sentence_ends = [i for i in range(8, min(len(words), 30) + 1)
                     if words[i - 1].endswith((".", "!", "?")) and not words[i - 1].endswith("...")
                     and len(" ".join(words[:i])) <= 195]
    if sentence_ends:
        return " ".join(words[:sentence_ends[-1]])
    clause_ends = [i for i in range(8, min(len(words), 30) + 1)
                   if words[i - 1].endswith((",", ";")) and len(" ".join(words[:i])) <= 195]
    if clause_ends:
        words = words[:clause_ends[-1]]
    trimmed_words: List[str] = []
    curr_chars = 0
    for w in words[:30]:
        add_len = len(w) + (1 if trimmed_words else 0)
        if curr_chars + add_len > 195:
            break
        trimmed_words.append(w)
        curr_chars += add_len
    body_str = " ".join(trimmed_words)
    if len(quote.split()) > len(trimmed_words):
        body_str = body_str.rstrip(",;:- ") + "."
    return body_str


def _trim_drops_caveat(quote: str) -> bool:
    """True when shortening a too-long quote would cut a caveat it has
    ("... not merely by product quality, but by extreme agility ...")."""
    from ..validators.hedges import check_hedges
    if _fits_body(quote):
        return False
    return any(i.code == "CAVEAT_DROPPED" for i in check_hedges(_shorten_quote(quote), quote))


def _table_row_list_slide(claim: Claim) -> Optional[Dict[str, Any]]:
    """List slide from one "Header: value | Header: value" row: headline is the row label,
    items are the other columns ("Zebronics India Pvt Ltd: ₹1,448.66 Crore (Reported)")."""
    cells = [c.split(":", 1) for c in claim.quote.split(" | ")]
    if not all(len(c) == 2 for c in cells) or not 4 <= len(cells) <= 5:
        return None
    items = [f"{h.strip()}: {v.strip()}" for h, v in cells[1:]]
    if any(len(i.split()) > 10 or len(i) > 70 for i in items):
        return None
    headline = _fit_phrase(cells[0][1].strip())
    return {
        "type": "list",
        "headline": headline,
        "items": items,
        "claim_ids": [claim.id],
        "source_status": "extractive_fallback",
    }


def fallback_slide_from_claims(
    slide_index: int,
    claim_ids: List[str],
    claims_by_id: Dict[str, Claim],
    units: List[Unit],
    doc_title: Optional[str],
    entities: Optional[List[str]] = None,
    exclude_ids: Optional[Set[str]] = None
) -> Tuple[Dict[str, Any], str]:
    """Return (slide_dict, reason_text). Never cuts inside a quote.
    exclude_ids: claims shown on other slides, never borrowed as a replacement quote.
    Preserves whole quotes, matches heading, and sets source_status='extractive_fallback'.
    """
    units_by_id = {u.id: u for u in units}

    if slide_index == 0:
        # Cover slide fallback: reuse cover-headline logic
        candidate_title = doc_title or ""
        if not candidate_title:
            for u in units:
                if u.kind == "heading":
                    candidate_title = u.text
                    break
        if not candidate_title and units:
            candidate_title = units[0].text

        hook = _caveated_cover_hook(claim_ids, claims_by_id)
        if hook is not None:
            slide = {
                "type": "cover",
                "headline": hook[0],
                "claim_ids": hook[1],
                "source_status": "extractive_fallback",
                "fallback_reason": "Cover rebuilt from its cited quote with the quote's caveat kept"
            }
            return slide, "Cover rebuilt from its cited quote with the quote's caveat kept"

        cover_headline, _ = clean_cover_title(candidate_title)

        cov_uid = units[0].id if units else "U001"
        for u in units:
            if cover_headline in u.text:
                cov_uid = u.id
                break

        fallback_cid = "C_FB_00"
        ents = entities if entities is not None else doc_entities(units)
        claims_by_id[fallback_cid] = Claim(id=fallback_cid, unit_id=cov_uid, quote=cover_headline, kind="finding",
                                           about=claim_subjects(cover_headline, None, ents))

        slide = {
            "type": "cover",
            "headline": cover_headline,
            "claim_ids": [fallback_cid],
            "source_status": "extractive_fallback",
            "fallback_reason": "Cover slide replaced by extractive document title"
        }
        return slide, "Cover slide replaced by extractive document title"

    # Non-cover slide: take cited claims in order
    usable_claims: List[Claim] = [claims_by_id[cid] for cid in claim_ids if cid in claims_by_id]
    if not usable_claims:
        # Fallback to first available accepted claim
        first_claim = next(iter(claims_by_id.values())) if claims_by_id else None
        if first_claim:
            usable_claims = [first_claim]
            reason = "No valid cited claims found on slide; used first accepted claim"
        else:
            reason = "No claims available in document"
    else:
        reason = "Slide replaced by whole quotes from cited claims"
    # Never combine facts about different subjects on one slide
    usable_claims = [c for c in usable_claims if c.about == usable_claims[0].about]

    # A comparison-table row ("Metric: FY25 Revenue | Zebronics: ₹1,448.66 Crore | Portronics: ...")
    # becomes a list with one item per column, so each value stays next to its company.
    if usable_claims and " | " in usable_claims[0].quote:
        row_slide = _table_row_list_slide(usable_claims[0])
        if row_slide is not None:
            row_slide["fallback_reason"] = "Table row shown as one item per column"
            return row_slide, row_slide["fallback_reason"]

    # Add WHOLE quotes until adding next exceeds 30 words or 200 chars
    used_quotes: List[str] = []
    used_claim_ids: List[str] = []
    total_words = 0
    total_chars = 0

    for c in usable_claims:
        q_words = len(c.quote.split())
        q_chars = len(c.quote)
        if total_words + q_words > 30 or total_chars + q_chars > 200:
            # Also true for a first quote that alone is too long: it is shortened below
            break
        used_quotes.append(c.quote)
        used_claim_ids.append(c.id)
        total_words += q_words
        total_chars += q_chars

    if not used_quotes and usable_claims and _trim_drops_caveat(usable_claims[0].quote):
        # Shortening this quote would cut its "but ..."/"however ..." clause and make it an
        # absolute claim. Use another accepted quote that fits whole instead, one not on any
        # other slide, about the same subject when possible.
        spare =[c for c in claims_by_id.values()
                 if c.id not in (exclude_ids or set()) and c.id not in claim_ids and " | " not in c.quote
                 and _fits_body(c.quote) and not _META_SENTENCE.search(c.quote)]
        spare.sort(key=lambda c: (c.about != usable_claims[0].about, c.id))
        if spare:
            usable_claims = [spare[0]]
            used_quotes, used_claim_ids = [spare[0].quote], [spare[0].id]
            reason = "Cited quote could not be shortened without dropping its caveat; used another whole quote"

    if not used_quotes and usable_claims:
        # Quote exceeds 30 words or 200 chars: end it at its last clause break that fits
        # ("..., which is projected to reach $65 billion to $66 billion calendar year value."),
        # else trim to a word boundary within limits
        first_c = usable_claims[0]
        used_quotes.append(_shorten_quote(first_c.quote))
        used_claim_ids.append(first_c.id)

    # A quote that introduced a list ("...pushing 3D printing into critical sectors:") would
    # end the slide on a dangling colon; the list itself is not on the slide.
    body_text = " ".join(used_quotes).rstrip().rstrip(":").rstrip()

    # Headline: nearest preceding heading before first used claim's unit
    first_uid = usable_claims[0].unit_id if usable_claims else None
    heading_text: Optional[str] = None
    if first_uid and units:
        # Scan units backwards to find nearest preceding heading
        unit_indices = {u.id: i for i, u in enumerate(units)}
        target_idx = unit_indices.get(first_uid, 0)
        for i in range(target_idx, -1, -1):
            if units[i].kind == "heading":
                heading_text = units[i].text
                break
    headline = _slide_headline(heading_text, usable_claims[0].about if usable_claims else [], body_text)

    slide = {
        "type": "point",
        "headline": headline,
        "body": body_text,
        "claim_ids": used_claim_ids,
        "source_status": "extractive_fallback",
        "fallback_reason": reason
    }
    # Several short quotes ("Material Cost: ₹240", "Profit per part: ₹1,965!") run together as
    # one paragraph read as a dump; each whole quote becomes its own bullet when they all fit
    if 2 <= len(used_quotes) <= 4 and all(_fits_bullet(q.rstrip(":")) for q in used_quotes):
        slide.pop("body")
        slide["bullets"] = [q.rstrip().rstrip(":").rstrip() for q in used_quotes]
    return slide, reason
