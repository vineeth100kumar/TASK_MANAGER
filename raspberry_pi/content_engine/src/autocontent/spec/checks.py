"""Checks for spec decks: will the post render well?

The author's facts are trusted, so nothing here compares text with a source. What is checked:
required fields, length limits (soft = WARN "may render small", hard = ERROR "will not fit"),
item counts, chart data (numbers, one unit, pie shares of one whole), table shape, images,
and the caption's Instagram limits. Layout fit itself is measured at render time
(fit_report.json) and checked by check_fit.
"""

import difflib
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from .parser import SpecIssue, parse_value, SLIDE_TYPES, MAX_SLIDES, plain

# (type, field): (soft words, soft chars, hard words, hard chars)
LIMITS = {
    ("cover", "headline"): (12, 70, 16, 100),
    ("point", "headline"): (8, 45, 12, 70),
    ("point", "body"): (30, 200, 50, 320),
    ("point", "bullet"): (12, 80, 18, 120),
    ("list", "headline"): (8, 45, 12, 70),
    ("list", "item"): (12, 75, 18, 110),
    ("stat", "headline"): (8, 45, 12, 70),
    ("stat", "number"): (3, 12, 4, 16),
    ("stat", "body"): (24, 150, 40, 240),
    ("quote", "body"): (28, 180, 45, 280),
    ("quote", "author"): (6, 40, 10, 60),
    ("table", "headline"): (8, 45, 12, 70),
    ("table", "body"): (16, 100, 25, 160),
    ("table", "cell"): (5, 24, 8, 36),
    ("table", "source_note"): (10, 60, 16, 90),
    ("chart", "headline"): (8, 45, 12, 70),
    ("chart", "body"): (20, 130, 30, 200),
    ("chart", "label"): (4, 22, 6, 32),
    ("chart", "value"): (3, 14, 4, 20),
    ("chart", "source_note"): (10, 60, 16, 90),
    ("image", "headline"): (8, 45, 12, 70),
    ("image", "bullet"): (10, 60, 16, 90),
    ("image", "body"): (16, 100, 25, 160),
    ("cta", "headline"): (8, 50, 12, 80),
    ("statement", "headline"): (14, 80, 18, 110),
    ("statement", "body"): (16, 100, 28, 170),
    ("compare", "headline"): (8, 45, 12, 70),
    ("compare", "label"): (2, 14, 4, 22),
    ("compare", "item"): (6, 40, 10, 60),
    ("compare", "body"): (14, 90, 22, 140),
    **{(t, "source_note"): (10, 60, 16, 90) for t in ("point", "list", "stat", "quote", "image", "statement", "compare")},
}
# (type): (min, soft max, hard max)
COUNTS = {
    ("point", "bullets"): (2, 4, 5),
    ("list", "items"): (2, 5, 6),
    ("table", "columns"): (2, 4, 4),
    ("table", "rows"): (1, 6, 8),
    ("chart", "bar"): (2, 6, 8),
    ("chart", "pie"): (2, 5, 6),
    ("chart", "line"): (2, 8, 10),
    ("image", "bullets"): (1, 3, 4),
    ("compare", "items"): (1, 4, 5),
}
# Missing is a warning: the slide renders fine without one
OPTIONAL_REQUIRED = {"point": ("headline",), "list": ("headline",), "table": ("headline",), "chart": ("headline",),
                     "compare": ("headline",)}
REQUIRED = {
    "cover": ("headline",),
    "point": ("headline",),
    "list": ("headline",),
    "stat": ("number",),
    "quote": ("body",),
    "table": ("headline",),
    "chart": ("headline",),
    "image": ("image",),
    "statement": ("headline",),
    "compare": ("headline",),
    "cta": (),
}
FIELD_NAMES = {"body": "body", "number": "number", "image": "image", "headline": "headline"}
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
CAPTION_MAX = 2200
HASHTAG_MAX = 30

_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E0-\U0001F1FF]")
_URL = re.compile(r"https?://\S+|www\.\S+", re.I)
_HASHTAG = re.compile(r"(?<![\w&])#[A-Za-z]\w*")


def _issue(sev: str, code: str, msg: str, n: int, fld: Optional[str] = None, hint: Optional[str] = None) -> SpecIssue:
    return SpecIssue(sev, code, msg, slide=n, field=fld, hint=hint)


def _length(stype: str, fld: str, text: str, n: int, label: Optional[str] = None) -> List[SpecIssue]:
    key = (stype, fld)
    if key not in LIMITS or not text:
        return []
    sw, sc, hw, hc = LIMITS[key]
    text = plain(text)
    words, chars = len(text.split()), len(text)
    name = label or fld
    # Only text that cannot possibly fit stops the render; anything else is fitted and reported by the render
    if words > hw * 2 or chars > hc * 2:
        return [_issue("ERROR", "TOO_LONG", f"The {name} is {words} words / {chars} characters; "
                       f"far more than fits ({hw} words / {hc} characters is the most that normally does).", n, fld,
                       f"Shorten it to about {sw} words, or split the slide in two.")]
    if words > hw or chars > hc:
        return [_issue("WARN", "MAY_NOT_FIT", f"The {name} is {words} words / {chars} characters, more than usually fits "
                       f"({hw} words / {hc} characters); it will be set very small or may not fit. The render checks it.",
                       n, fld, f"Shorten it to about {sw} words, or split the slide in two.")]
    if words > sw or chars > sc:
        return [_issue("WARN", "LONG", f"The {name} is {words} words / {chars} characters "
                       f"(best under {sw} words / {sc} characters); the text will be set smaller.", n, fld)]
    return []


def _text_hygiene(text: str, n: int, fld: str) -> List[SpecIssue]:
    out = []
    if _EMOJI.search(text):
        out.append(_issue("WARN", "EMOJI_IN_SLIDE", f"The {fld} contains an emoji; the slide fonts may not draw it.",
                          n, fld, "Remove emojis from slide text (they are fine in the caption)."))
    if _URL.search(text):
        out.append(_issue("WARN", "URL_IN_SLIDE", f"The {fld} contains a link; links cannot be clicked on a slide.",
                          n, fld, "Put links in the caption or bio."))
    if _HASHTAG.search(text):
        out.append(_issue("WARN", "HASHTAG_IN_SLIDE", f"The {fld} contains a hashtag.", n, fld,
                          "Put hashtags in the ## hashtags section."))
    return out


def _count(kind: tuple, have: int, n: int, what: str) -> List[SpecIssue]:
    lo, soft, hard = COUNTS[kind]
    if have < lo:
        # a chart with one point cannot be drawn; a one-item list or one-column table still can
        sev = "ERROR" if kind[0] == "chart" or kind == ("table", "rows") else "WARN"
        return [_issue(sev, "TOO_FEW", f"This slide has {have} {what}; {lo} or more looks right.", n, kind[1])]
    if have > -(-hard * 3 // 2):
        return [_issue("ERROR", "TOO_MANY", f"This slide has {have} {what}; far more than fit (about {hard} is the most).",
                       n, kind[1], "Split them over two slides.")]
    if have > hard:
        return [_issue("WARN", "MAY_NOT_FIT", f"{have} {what} is more than usually fit (about {hard}); the text will be very "
                       "small or may not fit. The render checks it.", n, kind[1], "Split them over two slides.")]
    if have > soft:
        return [_issue("WARN", "MANY", f"{have} {what} is a lot for one slide (best {soft} or fewer); the text will be small.",
                       n, kind[1])]
    return []


def check_chart(slide: Dict[str, Any], n: int) -> List[SpecIssue]:
    out: List[SpecIssue] = []
    kind = slide.get("chart_kind", "bar")
    series = [p for p in (slide.get("series") or []) if isinstance(p, dict)]
    if not series:
        return [_issue("ERROR", "CHART_NO_DATA", "The chart has no data.", n, "series",
                       "Add a 2-column table (label | value) or a ```data block with one 'label: value' per line.")]
    out += _count(("chart", kind), len(series), n, "data points")
    units = []
    values = []
    for p in series:
        label, raw = str(p.get("label", "")).strip(), str(p.get("value_raw", "")).strip()
        if not label:
            out.append(_issue("ERROR", "CHART_LABEL_EMPTY", f"A data point ({raw or 'no value'}) has no label.", n, "series"))
        out += _length("chart", "label", label, n, f"label '{label}'")
        out += _length("chart", "value", raw, n, f"value '{raw}'")
        value, unit, problem = parse_value(raw)
        if problem:
            out.append(_issue("ERROR", "CHART_VALUE_INVALID", f"The value for '{label}' ('{raw}') {problem}.", n, "series",
                              "Write each value as one number, optionally with a currency, %, x, or crore/lakh/K/M/B."))
            continue
        units.append(unit)
        values.append(value)
    distinct = sorted(set(units))
    if len(distinct) > 1:
        out.append(_issue("ERROR", "CHART_MIXED_UNITS", f"The chart mixes units ({', '.join(distinct)}); bars would not compare.",
                          n, "series", "Use one unit for every value, or use a table slide instead."))
    if kind == "pie" and values and len(distinct) == 1:
        if distinct[0] != "percent":
            out.append(_issue("ERROR", "PIE_NOT_PERCENT", "Pie slices must be percentages (like 42%).", n, "series",
                              "Write the shares as percentages of one whole, or use kind: bar."))
        else:
            total = sum(values)
            if total > 100.5:
                out.append(_issue("ERROR", "PIE_OVER_100", f"The pie slices add up to {total:g}%, more than 100%.", n, "series",
                                  "Pie slices must be shares of one whole. Use kind: bar for values that overlap."))
            elif total < 95:
                out.append(_issue("WARN", "PIE_UNDER_100", f"The pie slices add up to {total:g}%; the rest of the circle stays empty.",
                                  n, "series", "Add the missing share as its own slice if it matters."))
    if values and max(values) <= 0:
        out.append(_issue("ERROR", "CHART_ALL_ZERO", "Every value is zero, so there is nothing to draw.", n, "series"))
    if kind == "line" and len(series) > 6 and max(len(str(p.get("label", ""))) for p in series) > 6:
        out.append(_issue("WARN", "LINE_LABELS_CROWDED", "Long labels on a line chart with many points may overlap.", n, "series",
                          "Use short period labels such as FY24, Q2, 2025."))
    return out


def check_table(slide: Dict[str, Any], n: int) -> List[SpecIssue]:
    table = slide.get("table") or {}
    cols, rows = table.get("columns") or [], table.get("rows") or []
    if not rows:
        return [_issue("ERROR", "TABLE_NO_DATA", "The table slide has no table.", n, "table",
                       "Add a Markdown table: a | header | row, a |---| row, then 1 to 8 | data | rows.")]
    out: List[SpecIssue] = []
    width = len(cols) if cols else max(len(r) for r in rows)
    out += _count(("table", "columns"), width, n, "columns")
    out += _count(("table", "rows"), len(rows), n, "rows")
    for cell in list(cols) + [c for r in rows for c in r]:
        out += _length("table", "cell", str(cell), n, f"cell '{cell}'")
    hl = slide.get("highlight")
    if hl and not any(r and str(r[0]).strip().lower() == hl.strip().lower() for r in rows):
        out.append(_issue("WARN", "HIGHLIGHT_NOT_FOUND", f"highlight: '{hl}' does not match the first cell of any row.", n, "highlight",
                          "Copy the row's first cell exactly."))
    return out


def resolve_image(ref: str, base_dirs: Sequence[Path]) -> Optional[Path]:
    """The picture file a spec names. Tried in order, for each folder (the spec's own folder, an
    `images` folder beside it, the app's shared images/ folder): the path as written, its bare file
    name, then a case-insensitive match, with or without the extension (farm, FARM.JPG, farm.jpeg)."""
    from ..settings import IMAGES_DIR
    ref = (ref or "").strip().strip("\"'<>")
    if not ref:
        return None
    p = Path(ref)
    if p.is_absolute():
        return p if p.is_file() else None
    folders: List[Path] = []
    for d in base_dirs:
        if d:
            folders += [Path(d), Path(d) / "images"]
    folders.append(IMAGES_DIR)
    for d in folders:
        if (d / p).is_file():
            return d / p
    for d in folders:
        if (d / p.name).is_file():
            return d / p.name
    want, want_stem = p.name.lower(), p.stem.lower()
    for d in folders:
        try:
            entries = sorted(d.iterdir(), key=lambda e: e.name.lower()) if d.is_dir() else []
        except OSError:
            continue
        for e in entries:
            if e.is_file() and e.suffix.lower() in IMAGE_EXTS and (e.name.lower() == want or e.stem.lower() == want_stem):
                return e
    return None


def image_library() -> List[str]:
    """File names in the app's shared images/ folder (what a spec can name by itself)."""
    from ..settings import IMAGES_DIR
    if not IMAGES_DIR.is_dir():
        return []
    return sorted((f.name for f in IMAGES_DIR.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTS),
                  key=str.lower)


_PLACEHOLDER_HINT = ("Put the picture in the app's images folder and write  image: <file name>, "
                     "or make it with an AI image tool from the prompt.")


def check_image(slide: Dict[str, Any], n: int, base_dirs: Sequence[Path], allow_urls: bool,
                placeholders: str = "WARN") -> List[SpecIssue]:
    """placeholders: severity of a slide that has only a `prompt:` (or whose picture is missing but has
    one): WARN while writing a spec, ERROR once the deck is rendered or posted."""
    ref = (slide.get("image") or "").strip()
    prompt = (slide.get("image_prompt") or "").strip()
    search = (slide.get("image_search") or "").strip()
    if not ref:
        if search:
            if placeholders == "ERROR":
                return [_issue("ERROR", "IMAGE_PLACEHOLDER",
                               f"No picture was found for the search \"{search[:60]}\"; the slide shows a placeholder.", n, "image",
                               "Use Fetch pictures to choose one, add your own to the images folder, or check the internet connection.")]
            from . import stock
            if stock.pick_for(search):
                return []
            return [_issue("WARN", "IMAGE_SEARCH",
                           f"A free stock picture for \"{search[:60]}\" will be downloaded when the post is built (needs internet).",
                           n, "image", "Use Fetch pictures to choose one yourself; the credit is added to the slide automatically.")]
        if prompt:
            return [_issue(placeholders, "IMAGE_PLACEHOLDER",
                           f"This slide has no picture yet; it shows a placeholder with the prompt \"{prompt[:70]}\".", n, "image",
                           _PLACEHOLDER_HINT)]
        return []
    if re.match(r"^https?://", ref, re.I):
        if not allow_urls:
            return [_issue("ERROR", "IMAGE_NOT_LOCAL", f"The image '{ref}' was never downloaded into the deck.", n, "image")]
        return []
    if re.match(r"^[a-z]+://", ref, re.I) or ref.startswith("data:"):
        return [_issue("ERROR", "IMAGE_BAD_REF", f"'{ref[:60]}' is not a file path or an http(s) link.", n, "image")]
    if Path(ref).suffix and Path(ref).suffix.lower() not in IMAGE_EXTS:
        return [_issue("ERROR", "IMAGE_TYPE", f"'{ref}' is not a picture file ({', '.join(IMAGE_EXTS)}).", n, "image")]
    path = resolve_image(ref, base_dirs)
    if path is None:
        if prompt:
            return [_issue(placeholders, "IMAGE_PLACEHOLDER",
                           f"The picture '{ref}' was not found; the slide shows a placeholder with the prompt \"{prompt[:60]}\".",
                           n, "image", _PLACEHOLDER_HINT)]
        have = image_library()
        near = difflib.get_close_matches(Path(ref).name, have, n=1, cutoff=0.5)
        return [_issue(placeholders, "IMAGE_NOT_FOUND", f"Image file not found: {ref} (the slide is drawn as a text slide)", n, "image",
                       (f"Did you mean '{near[0]}'? " if near else "")
                       + "Put the file in the app's images folder (Create screen: Add pictures) and use its file name, "
                       "or use a full path (C:\\Users\\you\\Pictures\\photo.jpg) or an https:// link. "
                       "No picture yet? Write  prompt: <what it should show>  instead of image:.")]
    try:
        from PIL import Image
        with Image.open(path) as im:
            w, h = im.size
    except Exception as e:
        return [_issue("ERROR", "IMAGE_UNREADABLE", f"Could not open the image {ref}: {e}", n, "image")]
    if max(w, h) < 600:
        return [_issue("WARN", "IMAGE_SMALL", f"The image is only {w}x{h} pixels and will look blurry on a 1080px slide.",
                       n, "image", "Use a picture at least 1080 pixels wide.")]
    return []


def check_slides(slides: List[Dict[str, Any]], base_dirs: Iterable[Path] = (), allow_urls: bool = False,
                 placeholders: str = "WARN") -> List[SpecIssue]:
    """Every check that can run on the slide dicts alone (spec parse, editor, render, audit)."""
    base_dirs = list(base_dirs)
    out: List[SpecIssue] = []
    if not slides:
        return [SpecIssue("ERROR", "NO_SLIDES", "The spec has no slides.",
                          hint="Add slides as sections that start with '## cover', '## point', and so on.")]
    if len(slides) > MAX_SLIDES:
        out.append(SpecIssue("ERROR", "TOO_MANY_SLIDES", f"The post has {len(slides)} slides; Instagram allows {MAX_SLIDES}.",
                             hint="Remove or merge slides."))
    if slides[0].get("type") != "cover":
        out.append(_issue("WARN", "FIRST_NOT_COVER", "The first slide is not a cover; the first slide is the hook people see.", 1))
    if len(slides) > 1 and slides[-1].get("type") != "cta":
        out.append(_issue("WARN", "NO_CTA", "The last slide is not a cta (follow / save) slide.", len(slides)))

    for n, s in enumerate(slides, start=1):
        stype = s.get("type")
        if stype not in SLIDE_TYPES:
            out.append(_issue("ERROR", "UNKNOWN_TYPE", f"Unknown slide type {stype!r}.", n))
            continue
        for fld in REQUIRED[stype]:
            if fld == "image" and stype == "image" and (s.get("image_prompt") or s.get("image_search")):
                continue  # a prompt or a search stands in for the picture until it is supplied
            if not str(s.get(fld) or "").strip():
                name = "quote" if (stype == "quote" and fld == "body") else fld
                if fld in OPTIONAL_REQUIRED.get(stype, ()):
                    out.append(_issue("WARN", "NO_HEADLINE", f"The {stype} slide has no {name}; it is drawn without one.", n, fld,
                                      f"Add a line '{name}: ...' under '## {stype}'."))
                    continue
                out.append(_issue("ERROR", "MISSING_FIELD", f"The {stype} slide has no {name}.", n, fld,
                                  f"Add a line '{name}: ...' under '## {stype}'."))
        accent = str(s.get("accent") or "")
        if accent and re.match(r"^#[0-9A-Fa-f]{6}$", accent):
            r, g, b = (int(accent[i:i + 2], 16) / 255 for i in (1, 3, 5))
            if 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.72:
                out.append(_issue("WARN", "ACCENT_LIGHT", f"The accent {accent} is very light; white text on it will be hard to read.",
                                  n, "accent", "Pick a darker colour."))
        for fld in ("headline", "body", "number", "author", "source_note"):
            text = str(s.get(fld) or "")
            if text:
                if not (stype == "point" and fld == "body" and s.get("bullets")):  # checked as the intro line below
                    out += _length(stype, fld, text, n)
                out += _text_hygiene(text, n, fld)
        if stype == "point":
            bullets = s.get("bullets") or []
            if not bullets and not s.get("body"):
                out.append(_issue("ERROR", "MISSING_FIELD", "The point slide has neither a body nor bullets.", n, "body",
                                  "Add 'body: ...' or 2 to 4 lines starting with '- '."))
            if len(bullets) == 1:
                out.append(_issue("WARN", "ONE_BULLET", "A single bullet looks odd; write it as body: instead.", n, "bullets"))
            elif bullets:
                out += _count(("point", "bullets"), len(bullets), n, "bullets")
            for b in bullets:
                out += _length("point", "bullet", b, n, f"bullet '{b[:30]}'")
                out += _text_hygiene(b, n, "bullet")
            if s.get("body") and bullets:
                out += _length("point", "bullet", s["body"], n, "intro line above the bullets")
        elif stype == "list":
            items = s.get("items") or []
            out += _count(("list", "items"), len(items), n, "items")
            for it in items:
                out += _length("list", "item", it, n, f"item '{it[:30]}'")
                out += _text_hygiene(it, n, "item")
        elif stype == "stat":
            num = str(s.get("number") or "")
            if num and not re.search(r"\d", num):
                out.append(_issue("WARN", "STAT_NO_DIGIT", f"The stat number '{num}' has no digits.", n, "number",
                                  "Stat slides work best with a figure like 151% or ₹5.2L."))
        elif stype == "chart":
            out += check_chart(s, n)
        elif stype == "table":
            out += check_table(s, n)
        elif stype == "compare":
            for side in ("left", "right"):
                col = s.get(side) or {}
                items = col.get("items") or []
                if not items:
                    out.append(_issue("WARN", "COMPARE_EMPTY", f"The {side} column has no points.", n, side,
                                      f"Under '{side}: <label>' add 1 to 4 lines starting with '- '."))
                else:
                    out += _count(("compare", "items"), len(items), n, f"{side} points")
                out += _length("compare", "label", col.get("label") or "", n, f"{side} label")
                for it in items:
                    out += _length("compare", "item", it, n, f"point '{it[:30]}'")
        elif stype == "image":
            out += check_image(s, n, base_dirs, allow_urls, placeholders)
            ib = s.get("bullets") or []
            if ib:
                out += _count(("image", "bullets"), len(ib), n, "bullets under the picture")
            for b in ib:
                out += _length("image", "bullet", b, n, f"bullet '{b[:30]}'")
    return out


def check_caption(caption: Optional[str], hashtags: Sequence[str] = (), auto: bool = False) -> List[SpecIssue]:
    out: List[SpecIssue] = []
    if auto:
        out.append(SpecIssue("WARN", "NO_CAPTION", "There is no ## caption section; a caption is built from the slide headlines.",
                             hint="Add a ## caption section to write your own."))
        return out
    text = (caption or "").strip()
    tags = set(t.lower() for t in _HASHTAG.findall(text)) | set(t.lower() for t in hashtags)
    full_len = len(text) + sum(len(t) + 1 for t in hashtags if t.lower() not in text.lower())
    if not text:
        out.append(SpecIssue("ERROR", "CAPTION_EMPTY", "The ## caption section is empty.", hint="Write the caption, or remove the section."))
    if full_len > CAPTION_MAX:
        out.append(SpecIssue("ERROR", "CAPTION_TOO_LONG", f"The caption with hashtags is {full_len} characters; Instagram allows {CAPTION_MAX}.",
                             hint="Shorten the caption."))
    if len(tags) > HASHTAG_MAX:
        out.append(SpecIssue("ERROR", "TOO_MANY_HASHTAGS", f"{len(tags)} hashtags; Instagram allows {HASHTAG_MAX}.",
                             hint="Keep 3 to 10 focused hashtags."))
    elif len(tags) > 15:
        out.append(SpecIssue("WARN", "MANY_HASHTAGS", f"{len(tags)} hashtags; 3 to 10 focused ones usually work better."))
    return out


def check_fit(fit_report: List[Dict[str, Any]]) -> List[SpecIssue]:
    """Layout problems measured while rendering (text that overflowed its box or the slide)."""
    out = []
    for r in fit_report or []:
        for p in r.get("problems", []):
            out.append(SpecIssue("ERROR", "LAYOUT_OVERFLOW", p, slide=r.get("n"),
                                 hint="Shorten the text on this slide (or use fewer rows / items)."))
    return out


def issues_summary(issues: Sequence[SpecIssue]) -> str:
    errors = sum(1 for i in issues if i.severity == "ERROR")
    warns = sum(1 for i in issues if i.severity == "WARN")
    return f"{errors} error{'s' if errors != 1 else ''}, {warns} warning{'s' if warns != 1 else ''}"
