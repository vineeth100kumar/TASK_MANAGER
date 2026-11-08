"""Parse a post spec (.md) into slide dicts, deterministically.

The format is documented for authors (people or AIs) in POST_FORMAT.md. In short:

    ---
    autocontent: post
    title: ...
    style: grid_pill
    ---

    ## cover
    headline: ...

    ## chart
    headline: ...
    kind: bar
    | Year | Revenue |
    |------|---------|
    | FY24 | ₹43.50 crore |

    ## caption
    ...

A file is a spec only when its front matter says `autocontent: post`, so ordinary Markdown
reports (and loose "SLIDE 1: The Hook" scripts) keep going through the normal pipeline.

The parser is forgiving about how a spec is written: headings of any of several shapes, field
and slide-type aliases, typos, slides with no type at all (guessed from their content), many
data syntaxes. Anything it had to guess or repair is reported as a WARN with what it did; an
ERROR is only for something that would render wrongly or not at all.
"""

import csv
import difflib
import io
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .imagefx import STYLE_FIELDS, merge_styles, parse_image_style

SPEC_VERSION = 1
SLIDE_TYPES = ("cover", "point", "list", "stat", "quote", "table", "chart", "image", "statement", "compare", "cta")
EXTRA_SECTIONS = ("caption", "hashtags")
CHART_KINDS = ("bar", "pie", "line")
# Slides that carry information and can show a source line above the footer
INFO_TYPES = ("point", "list", "stat", "quote", "table", "chart", "image", "statement", "compare")
# Design knobs every slide accepts (and the header sets for the whole post)
THEMES = ("light", "dark", "accent")
ALIGNS = ("top", "center", "bottom")
THEME_ALIASES = {"light": "light", "white": "light", "default": "light", "normal": "light", "paper": "light",
                 "dark": "dark", "black": "dark", "night": "dark", "inverted": "dark", "invert": "dark",
                 "accent": "accent", "color": "accent", "colour": "accent", "bold": "accent", "brand": "accent",
                 "pop": "accent", "loud": "accent"}
ALIGN_ALIASES = {"top": "top", "start": "top", "up": "top", "center": "center", "centre": "center",
                 "middle": "center", "centered": "center", "centred": "center", "bottom": "bottom", "end": "bottom",
                 "down": "bottom", "low": "bottom"}
NO_SOURCE = ("none", "-", "no", "n/a", "off")
MAX_SLIDES = 20  # Instagram's carousel limit

_MARKER = re.compile(r"^\s*autocontent\s*:\s*['\"]?(?:post|carousel|spec|deck)\b", re.I)

# Section names an author may use for each slide type ("## bar chart" is a chart of kind bar)
TYPE_ALIASES: Dict[str, Tuple[str, Optional[str]]] = {
    **{t: (t, None) for t in SLIDE_TYPES},
    **{t: (t, None) for t in EXTRA_SECTIONS},
    "hook": ("cover", None), "title": ("cover", None), "intro": ("cover", None), "opening": ("cover", None),
    "bullets": ("point", None), "points": ("point", None), "pointers": ("point", None), "bullet": ("point", None),
    "bullet_points": ("point", None), "key_points": ("point", None), "highlights": ("point", None),
    "text": ("point", None), "content": ("point", None), "tip": ("point", None), "insight": ("point", None),
    "steps": ("list", None), "numbered": ("list", None), "takeaways": ("list", None), "numbered_list": ("list", None),
    "checklist": ("list", None), "ranking": ("list", None),
    "number": ("stat", None), "big_number": ("stat", None), "metric": ("stat", None), "kpi": ("stat", None),
    "statistic": ("stat", None), "big_stat": ("stat", None), "figure": ("stat", None),
    "testimonial": ("quote", None), "quotation": ("quote", None),
    "comparison": ("table", None), "data_table": ("table", None),
    "graph": ("chart", None),
    "bar": ("chart", "bar"), "bar_chart": ("chart", "bar"), "bars": ("chart", "bar"), "bar_graph": ("chart", "bar"),
    "pie": ("chart", "pie"), "pie_chart": ("chart", "pie"), "donut": ("chart", "pie"), "donut_chart": ("chart", "pie"),
    "pie_graph": ("chart", "pie"),
    "line": ("chart", "line"), "line_chart": ("chart", "line"), "trend": ("chart", "line"), "line_graph": ("chart", "line"),
    "statement": ("statement", None), "big_text": ("statement", None), "punchline": ("statement", None),
    "big_idea": ("statement", None), "truth": ("statement", None), "reveal": ("statement", None),
    "one_liner": ("statement", None), "bold_statement": ("statement", None), "message": ("statement", None),
    "takeaway": ("statement", None), "lesson": ("statement", None), "fact": ("statement", None),
    "compare": ("compare", None), "versus": ("compare", None), "vs": ("compare", None), "myth_vs_fact": ("compare", None),
    "myth_vs_reality": ("compare", None), "before_after": ("compare", None), "before_vs_after": ("compare", None),
    "do_dont": ("compare", None), "dos_and_donts": ("compare", None), "pros_cons": ("compare", None),
    "pros_and_cons": ("compare", None), "this_vs_that": ("compare", None), "contrast": ("compare", None),
    "photo": ("image", None), "picture": ("image", None), "img": ("image", None), "visual": ("image", None),
    "follow": ("cta", None), "outro": ("cta", None), "end": ("cta", None), "closing": ("cta", None),
    "call_to_action": ("cta", None), "closer": ("cta", None), "thanks": ("cta", None), "follow_us": ("cta", None),
    "tags": ("hashtags", None), "hash_tags": ("hashtags", None), "hashtag": ("hashtags", None),
    "instagram_caption": ("caption", None), "post_caption": ("caption", None), "caption_text": ("caption", None),
}
# Sections that are for the author, not the post: skipped with a note
IGNORED_SECTIONS = {"notes", "note", "speaker_notes", "references", "sources", "bibliography", "credits",
                    "instructions", "metadata", "outline", "assets"}

FIELD_ALIASES: Dict[str, str] = {
    "headline": "headline", "title": "headline", "heading": "headline", "hook": "headline", "label": "headline",
    "header": "headline", "slide_title": "headline", "main_text": "headline",
    "body": "body", "text": "body", "description": "body", "sentence": "body", "context": "body",
    "paragraph": "body", "copy": "body", "details": "body", "subtitle": "body", "summary": "body",
    "number": "number", "stat": "number", "value": "number", "big_number": "number", "metric": "number",
    "figure": "number", "statistic": "number", "big_stat": "number",
    "quote": "quote", "quotation": "quote", "testimonial": "quote",
    "author": "author", "by": "author", "speaker": "author", "attribution": "author", "name": "author",
    "said_by": "author", "quoted_by": "author",
    "source": "source", "source_note": "source", "credit": "source", "courtesy": "source", "credits": "source",
    "sources": "source", "via": "source", "data_source": "source", "reference": "source", "references": "source",
    "citation": "source", "cite": "source", "photo_credit": "source", "image_credit": "source",
    "kind": "kind", "chart": "kind", "chart_kind": "kind", "chart_type": "kind", "type": "kind", "graph_type": "kind",
    "image": "image", "src": "image", "path": "image", "url": "image", "file": "image", "photo": "image",
    "img": "image", "picture": "image", "image_url": "image", "image_path": "image", "photo_url": "image",
    "caption": "caption",
    "fit": "fit", "alt": "alt",
    "pill": "pill", "highlight": "highlight",
    "subtext": "subtext", "pill_subtext": "subtext",
    "bullets": "bullets", "points": "bullets", "bullet_points": "bullets",
    "items": "items", "steps": "items", "list": "items",
    "data": "data", "series": "data", "labels": "labels", "categories": "labels", "values": "values",
    "accent": "accent", "accent_color": "accent", "accent_colour": "accent", "color": "accent", "colour": "accent",
    "search": "search", "stock": "search", "find": "search", "photo_search": "search", "search_images": "search",
    "keywords": "search", "stock_search": "search",
    "prompt": "prompt", "ai_prompt": "prompt", "image_prompt": "prompt", "picture_prompt": "prompt", "generate": "prompt",
    "focus": "focus", "focal_point": "focus", "focus_point": "focus", "crop": "focus", "anchor": "focus",
    "filter": "filter", "filters": "filter", "effect": "filter", "effects": "filter", "treatment": "filter", "look": "filter",
    "brightness": "brightness", "contrast": "contrast", "saturation": "saturation", "saturate": "saturation",
    "grayscale": "grayscale", "greyscale": "grayscale", "sepia": "sepia", "blur": "blur", "hue": "hue",
    "tint": "tint", "duotone": "duotone", "overlay": "overlay", "darken": "overlay", "dim": "overlay", "scrim": "overlay",
    "rounded": "rounded", "corners": "rounded", "radius": "rounded", "round": "rounded", "corner_radius": "rounded",
    "border": "border", "frame": "border",
    "text_position": "text_position", "caption_position": "text_position", "caption_at": "text_position",
    "text_at": "text_position", "text_placement": "text_position", "caption_placement": "text_position",
    "dot_size": "dot_size", "dots": "dot_size", "dot": "dot_size", "halftone_size": "dot_size", "dot_spacing": "dot_size",
    "dot_angle": "dot_angle", "dots_angle": "dot_angle", "halftone_angle": "dot_angle",
    "note": "note", "notes": "note", "speaker_notes": "note", "design_note": "note",
    "theme": "theme", "background": "theme", "bg": "theme", "mode": "theme", "colorway": "theme", "scheme": "theme",
    "align": "align", "alignment": "align", "vertical": "align", "valign": "align", "placement": "align",
    "kicker": "kicker", "eyebrow": "kicker", "overline": "kicker", "tagline": "kicker", "small_label": "kicker",
    "pretitle": "kicker", "section": "kicker",
    "left": "left", "left_label": "left", "before": "left", "myth": "left", "dont": "left", "con": "left", "cons": "left",
    "right": "right", "right_label": "right", "after": "right", "fact": "right", "reality": "right", "do": "right",
    "pro": "right", "pros": "right", "truth": "right",
}
# Fields every slide type accepts
DESIGN_FIELDS = {"theme", "align", "kicker", "accent"}

ALLOWED_FIELDS: Dict[str, set] = {
    "cover": {"headline", "pill", "accent"},
    "point": {"headline", "body", "source", "bullets", "items", "accent"},
    "list": {"headline", "source", "items", "bullets", "accent"},
    "stat": {"headline", "number", "body", "source", "accent"},
    "quote": {"quote", "body", "author", "source", "accent"},
    "table": {"headline", "body", "source", "highlight", "accent"},
    "chart": {"headline", "body", "source", "kind", "data", "labels", "values", "accent"},
    "image": {"headline", "image", "caption", "body", "alt", "source", "bullets", "items", "accent", "prompt", "search"} | set(STYLE_FIELDS)
             | {"saturation", "grayscale"},
    "statement": {"headline", "body", "source", "accent"},
    "compare": {"headline", "body", "source", "left", "right", "bullets", "items", "accent"},
    "cta": {"headline", "pill", "subtext", "accent"},
}
ALLOWED_FIELDS = {k: v | DESIGN_FIELDS for k, v in ALLOWED_FIELDS.items()}

META_KEYS = {
    "autocontent": "autocontent", "title": "title", "style": "style", "format": "format", "size": "format",
    "tag": "tag", "topic": "tag", "handle": "handle", "page_name": "page_name", "page": "page_name",
    "brand": "page_name", "cta_pill": "cta_pill", "cta_pill_subtext": "cta_pill_subtext",
    "hashtags": "hashtags", "seed": "seed",
    "source": "source", "credit": "source", "courtesy": "source", "sources": "source",
    **{f"image_{k}": f"image_{k}" for k in ("fit", "focus", "filter", "brightness", "contrast", "saturation", "grayscale",
                                           "sepia", "blur", "hue", "tint", "duotone", "overlay", "rounded", "border", "text_position",
                                           "dot_size", "dot_angle")},
    "image_filters": "image_filter", "image_effect": "image_filter", "image_corners": "image_rounded",
    "image_caption_position": "image_text_position",
    "accent": "accent", "accent_color": "accent", "accent_colour": "accent", "color": "accent", "colour": "accent",
    "theme": "theme", "background": "theme", "mode": "theme",
}
STYLE_ALIASES = {"grid_pill": "grid_pill", "grid": "grid_pill", "grid_and_pill": "grid_pill", "pill": "grid_pill",
                 "white": "grid_pill", "clean": "grid_pill", "modern": "grid_pill",
                 "beige_grain": "beige_grain", "beige": "beige_grain", "paper": "beige_grain", "grain": "beige_grain",
                 "warm": "beige_grain", "cream": "beige_grain"}
FORMAT_ALIASES = {"portrait": "portrait", "4:5": "portrait", "4x5": "portrait", "1080x1350": "portrait",
                  "feed": "portrait", "vertical": "portrait", "tall": "portrait",
                  "square": "square", "1:1": "square", "1x1": "square", "1080x1080": "square",
                  "reel": "reel", "reels": "reel", "9:16": "reel", "9x16": "reel", "1080x1920": "reel", "story": "reel"}
NAMED_COLORS = {"red": "#E53935", "orange": "#F86036", "blue": "#1E6FE8", "green": "#1E9E5A", "purple": "#7B3FE4",
                "pink": "#E8479B", "teal": "#0FA3A3", "yellow": "#F2B600", "black": "#111111", "navy": "#12264F"}


@dataclass
class SpecIssue:
    severity: str              # "ERROR" | "WARN"
    code: str
    message: str
    slide: Optional[int] = None
    line: Optional[int] = None
    field: Optional[str] = None
    hint: Optional[str] = None

    def where(self) -> str:
        parts = []
        if self.line:
            parts.append(f"line {self.line}")
        if self.slide:
            parts.append(f"slide {self.slide}")
        return ", ".join(parts)

    def __str__(self) -> str:
        loc = self.where()
        text = f"{self.severity}{' (' + loc + ')' if loc else ''}: {self.message}"
        return text + (f" Fix: {self.hint}" if self.hint else "")

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["text"] = str(self)
        return d


@dataclass
class ParsedSpec:
    meta: Dict[str, Any] = field(default_factory=dict)
    slides: List[Dict[str, Any]] = field(default_factory=list)
    slide_lines: List[int] = field(default_factory=list)
    caption: Optional[str] = None
    hashtags: List[str] = field(default_factory=list)
    issues: List[SpecIssue] = field(default_factory=list)
    base_dir: Optional[Path] = None

    @property
    def errors(self) -> List[SpecIssue]:
        return [i for i in self.issues if i.severity == "ERROR"]

    @property
    def warnings(self) -> List[SpecIssue]:
        return [i for i in self.issues if i.severity == "WARN"]

    @property
    def ok(self) -> bool:
        return not self.errors


# ---------- detection ----------

def _front_matter(lines: List[str]) -> Tuple[Optional[List[str]], int]:
    """Front matter lines between the opening and closing '---', and the index after it."""
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i].strip() != "---":
        return None, 0
    for j in range(i + 1, min(len(lines), i + 80)):
        if lines[j].strip() in ("---", "..."):
            return lines[i + 1:j], j + 1
    return None, 0


def is_spec_text(text: str) -> bool:
    """True when the text opens with front matter containing `autocontent: post`."""
    fm, _ = _front_matter(text.lstrip("﻿").splitlines()[:90])
    return bool(fm) and any(_MARKER.match(line) for line in fm)


def is_spec_file(path: Path) -> bool:
    path = Path(path)
    if path.suffix.lower() not in (".md", ".markdown", ".txt") or not path.is_file():
        return False
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            head = f.read(6000)
    except OSError:
        return False
    return is_spec_text(head)


# ---------- values ----------

_SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "million": 1e6, "b": 1e9, "bn": 1e9,
          "billion": 1e9, "t": 1e12, "tn": 1e12, "trillion": 1e12, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5,
          "cr": 1e7, "crore": 1e7, "crores": 1e7}
_CURRENCY = {"₹": "₹", "rs": "₹", "rs.": "₹", "inr": "₹", "$": "$", "usd": "$", "us$": "$", "€": "€",
             "eur": "€", "£": "£", "gbp": "£", "¥": "¥"}
_VALUE = re.compile(
    r"^\s*(?P<cur>₹|\$|€|£|¥|rs\.?|inr|usd|us\$|eur|gbp)?\s*(?P<sign>[-−–])?\s*(?P<cur2>₹|\$|€|£|¥)?\s*"
    r"(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)\s*"
    r"(?:(?P<scale>thousand|million|billion|trillion|lakhs?|lac|crores?|cr|mn|bn|tn|k|m|b|t)(?![a-z]))?\.?\s*"
    r"(?P<suffix>%|x|×)?\s*(?P<plus>\+)?\s*(?P<unit>[^\d]*?)\s*$",
    re.I,
)


def parse_value(raw: str) -> Tuple[Optional[float], str, Optional[str]]:
    """A chart value as written ("₹43.50 crore", "29.7%", "2.4M", "600+") -> (value, unit class, problem).

    The unit class is "currency:₹", "percent", "multiplier" or "number"; values are scaled
    (crore, lakh, k, M, B) so bars compare correctly. problem says why it is not usable."""
    text = (raw or "").strip()
    if not text:
        return None, "", "is empty"
    m = _VALUE.match(text)
    if not m:
        if len(re.findall(r"\d+(?:[.,]\d+)*", text)) > 1:
            return None, "", "has more than one number (use a single value, not a range)"
        if not re.search(r"\d", text):
            return None, "", "is not a number"
        return None, "", "could not be read as a number"
    if m.group("sign"):
        return None, "", "is negative (charts start at zero; use a table for negative numbers)"
    num = float(m.group("num").replace(",", ""))
    scale = (m.group("scale") or "").lower()
    num *= _SCALE.get(scale, 1.0)
    cur = (m.group("cur") or m.group("cur2") or "").lower()
    suffix = (m.group("suffix") or "").lower()
    if cur:
        unit = f"currency:{_CURRENCY.get(cur, cur)}"
    elif suffix == "%":
        unit = "percent"
    elif suffix in ("x", "×"):
        unit = "multiplier"
    else:
        unit = "number"
    return num, unit, None


def clean_text(s: str) -> str:
    """Slide text without Markdown decoration: **bold**, _italic_, `code`, [links](url), quotes."""
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1].strip()
    s = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"(\*\*|__)(.+?)\1", r"\2", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1", s)
    s = re.sub(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])", r"\1", s)
    s = s.replace("`", "")
    return re.sub(r"\s+", " ", s).strip()


def _split_row(line: str) -> List[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    cells = re.split(r"(?<!\\)\|", body)
    return [clean_text(c.replace("\\|", "|")) for c in cells]


def _is_separator_row(line: str, loose: bool = False) -> bool:
    if loose:
        return bool(re.match(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$", line)) and "-" in line
    return bool(re.match(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$", line))


def _norm_key(k: str) -> str:
    return re.sub(r"[\s\-]+", "_", k.strip().lower())


def _norm_color(v: str) -> Optional[str]:
    v = (v or "").strip().lower()
    if v in NAMED_COLORS:
        return NAMED_COLORS[v]
    m = re.match(r"^#?([0-9a-f]{6}|[0-9a-f]{3})$", v)
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.upper()


def _luminance(hex_color: str) -> float:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


# ---------- headings ----------

_HEADER = re.compile(r"^(#{1,3})(?!#)(\s*)(.*?)\s*#*\s*$")
_KEY_LINE = re.compile(r"^\s*(?:\*\*|__)?([A-Za-z][A-Za-z _\-]{0,24}?)(?:\*\*|__)?\s*:(?:\*\*|__)?(?:\s+(.*)|\s*)$")
_BULLET = re.compile(r"^\s*[-*•+]\s+(.*)$")
_NUMBERED = re.compile(r"^\s*\d{1,2}[.)]\s+(.*)$")
_FENCE = re.compile(r"^\s*(```|~~~)\s*([\w\-]*)")
_HASHTAG = re.compile(r"#[^\s#.,;:!?()\[\]{}\"']+")
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")
# Keys a bulleted line may carry on a scan ("- Source: X"); others stay plain bullets
_SCAN_BULLET_KEYS = {"headline", "body", "image", "quote", "author", "source", "kind", "pill", "subtext", "accent",
                     "highlight", "bullets", "items", "labels", "data", "values", "caption"}


def _strip_comments(text: str) -> str:
    """Remove <!-- comments --> but keep their line breaks, so line numbers stay right."""
    return re.sub(r"<!--.*?-->", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)


def _lookup_type(word: str, fuzzy: bool) -> Tuple[Optional[str], bool]:
    """A slide-type key for a heading word: exact, plural, or (when allowed) the closest spelling."""
    k = re.sub(r"_(slide|section|page|card)$", "", re.sub(r"[^\w]+", "_", word.strip().lower()).strip("_"))
    if not k:
        return None, False
    if k in TYPE_ALIASES:
        return k, False
    if k.endswith("s") and k[:-1] in TYPE_ALIASES:
        return k[:-1], False
    if fuzzy and len(k) >= 4:
        m = difflib.get_close_matches(k, list(TYPE_ALIASES), n=1, cutoff=0.8)
        if m:
            return m[0], True
    return None, False


def _resolve_heading(raw_title: str, level: int, spaced: bool) -> Optional[Dict[str, Any]]:
    """What a heading means: {"key", "label", "fuzzy", "text"} (key None = a slide of unknown type),
    or None if the heading is not a slide start at all (an ordinary heading inside a slide)."""
    t = clean_text(raw_title)
    t = re.sub(r"^[^\w(\[]+", "", t)  # leading emoji / bullets
    slide_like = bool(re.match(r"(?i)^(slide|page|card)\b\s*#?\s*\d+", t))
    t2 = re.sub(r"(?i)^(slide|page|card)\b\s*#?\s*\d*\s*[:.\-–—·|)]*\s*", "", t).strip()
    if level != 2 and not spaced:
        return None
    exact: List[Tuple[str, str]] = [(t2, "")]
    for m in re.finditer(r"[(\[]([^)\]]+)[)\]]", t2):
        exact.append((m.group(1), (t2[:m.start()] + t2[m.end():]).strip(" :-–—·|")))
    loose_ok = level == 2 or slide_like
    parts = [p.strip() for p in re.split(r"\s+[-–—·|]\s+|\s*:\s*", t2) if p.strip()]
    if loose_ok and len(parts) > 1:
        exact.append((parts[0], " ".join(parts[1:])))
        exact.append((parts[-1], " ".join(parts[:-1])))
    for word, label in exact:
        key, fuzzy = _lookup_type(word, fuzzy=loose_ok)
        if key:
            return {"key": key, "label": label.strip(), "fuzzy": fuzzy, "text": t}
    if loose_ok:
        words = t2.split()
        for word in ([words[0], words[-1]] if words else []):
            key, _ = _lookup_type(word, fuzzy=False)
            if key and key not in IGNORED_SECTIONS:
                return {"key": key, "label": "", "fuzzy": False, "text": t}
        low = _norm_key(t2)
        if low in IGNORED_SECTIONS:
            return {"key": "__ignored__", "label": "", "fuzzy": False, "text": t}
        return {"key": None, "label": t2, "fuzzy": False, "text": t}
    return None


@dataclass
class _Section:
    key: Optional[str]                 # alias key, "__ignored__", or None = slide of unknown type
    line: int
    label: str = ""
    text: str = ""
    fuzzy: bool = False
    lines: List[Tuple[int, str]] = field(default_factory=list)


# ---------- header (front matter) ----------

def _parse_meta(fm: List[str], start_line: int, issues: List[SpecIssue]) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    for off, raw in enumerate(fm):
        ln = start_line + off
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][\w \-]*?)\s*:\s*(.*)$", line)
        if not m:
            issues.append(SpecIssue("WARN", "META_UNREADABLE", f"Header line '{line}' is not 'key: value'; ignored.", line=ln))
            continue
        key = META_KEYS.get(_norm_key(m.group(1)))
        if key is None:
            issues.append(SpecIssue("WARN", "META_UNKNOWN", f"Unknown setting '{m.group(1)}'; ignored.", line=ln,
                                    hint="Known settings: " + ", ".join(sorted(set(META_KEYS.values()) - {"autocontent"})) + "."))
            continue
        value = m.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        meta[key] = value
        meta.setdefault("_lines", {})[key] = ln
    return meta


def _match_choice(value: str, aliases: Dict[str, str], norm) -> Tuple[Optional[str], bool]:
    first = norm(re.split(r"\s+#|\s{2,}|\(", value.strip())[0].replace("&", "and"))
    if first in aliases:
        return aliases[first], False
    m = difflib.get_close_matches(first, list(aliases), n=1, cutoff=0.7)
    return (aliases[m[0]], True) if m else (None, False)


def _check_meta(meta: Dict[str, Any], issues: List[SpecIssue]) -> None:
    lines = meta.get("_lines", {})
    if "style" in meta:
        style, guessed = _match_choice(meta["style"], STYLE_ALIASES, _norm_key)
        if style is None:
            issues.append(SpecIssue("WARN", "STYLE_UNKNOWN", f"Unknown style '{meta['style']}'; using grid_pill.",
                                    line=lines.get("style"), hint="Use style: grid_pill or style: beige_grain."))
        elif guessed:
            issues.append(SpecIssue("WARN", "STYLE_GUESSED", f"Style '{meta['style']}' was read as {style}.",
                                    line=lines.get("style")))
        meta["style"] = style or "grid_pill"
    if "format" in meta:
        fmt, guessed = _match_choice(meta["format"], FORMAT_ALIASES, lambda s: s.strip().lower().replace(" ", ""))
        if fmt is None:
            issues.append(SpecIssue("WARN", "FORMAT_UNKNOWN", f"Unknown format '{meta['format']}'; using portrait.",
                                    line=lines.get("format"),
                                    hint="Use format: portrait (1080x1350), format: square (1080x1080) or format: reel (1080x1920)."))
        elif guessed:
            issues.append(SpecIssue("WARN", "FORMAT_GUESSED", f"Format '{meta['format']}' was read as {fmt}.",
                                    line=lines.get("format")))
        meta["format"] = fmt or "portrait"
    if meta.get("tag"):
        tag = meta["tag"].strip()
        meta["tag"] = tag if tag.startswith("#") else f"#{tag}"
    if "accent" in meta:
        color = _norm_color(meta["accent"])
        if color is None:
            issues.append(SpecIssue("WARN", "ACCENT_INVALID", f"accent '{meta['accent']}' is not a colour; ignored.",
                                    line=lines.get("accent"), hint="Use a hex colour like #1E6FE8, or a name like blue."))
            meta.pop("accent")
        else:
            meta["accent"] = color
    if "seed" in meta:
        try:
            meta["seed"] = int(meta["seed"])
        except ValueError:
            issues.append(SpecIssue("WARN", "SEED_NOT_NUMBER", "seed must be a whole number; ignored.", line=lines.get("seed")))
            meta.pop("seed")
    for key, limit in (("handle", 40), ("page_name", 40), ("tag", 30), ("cta_pill", 24), ("cta_pill_subtext", 40)):
        if meta.get(key) and len(meta[key]) > limit:
            issues.append(SpecIssue("ERROR", "META_TOO_LONG", f"{key} is {len(meta[key])} characters (max {limit}).",
                                    line=lines.get(key), hint=f"Shorten {key}."))


def _hashtags_from(text: str) -> List[str]:
    tags = []
    for tok in re.split(r"[\s,]+", text):
        tok = tok.strip()
        if not tok:
            continue
        tok = tok if tok.startswith("#") else f"#{tok}"
        if re.match(r"^#[^\W_][\w]*$", tok) and tok.lower() not in (t.lower() for t in tags):
            tags.append(tok)
    return tags


# ---------- data syntaxes ----------

def _split_list(v: str, commas: bool = False) -> List[str]:
    """Items written inline: `a; b; c`, `a | b | c` (and `a, b, c` for labels and numbers)."""
    v = (v or "").strip()
    if ";" in v:
        parts = v.split(";")
    elif " | " in v or (v.count("|") >= 1 and "," not in v):
        parts = v.split("|")
    elif commas and re.search(r",\s+", v):
        parts = re.split(r",\s+", v)
    else:
        parts = [v]
    return [clean_text(p) for p in parts if p.strip()]


_TRAIL_NUM = re.compile(r"^(.+?)\s+([-+]?\s?[₹$€£¥]?\s?\d[\d,]*(?:\.\d+)?\s?(?:%|x|×|k|m|mn|b|bn|cr|crore|lakhs?|l)?)$", re.I)


def _pair_from_text(s: str) -> Optional[List[str]]:
    """[label, value] from one line of chart data in any common shape, or None."""
    s = re.sub(r"^\s*[-*•+]\s+|^\s*\d{1,2}[.)]\s+", "", s.strip()).strip()
    if not s:
        return None
    if "|" in s:
        cells = [c for c in _split_row(s)]
        return cells[:2] if len(cells) >= 2 else None
    if "\t" in s:
        cells = [clean_text(c) for c in s.split("\t") if c.strip()]
        return cells[:2] if len(cells) >= 2 else None
    for sep in (":", "="):
        lab, found, val = s.rpartition(sep)
        if found and lab.strip() and val.strip():
            return [clean_text(lab), clean_text(val)]
    dash = re.split(r"\s[-–—]\s", s)
    if len(dash) >= 2 and dash[-1].strip():
        return [clean_text(" - ".join(dash[:-1])), clean_text(dash[-1])]
    m = _TRAIL_NUM.match(s)
    if m:
        return [clean_text(m.group(1)).rstrip(",;:- "), clean_text(m.group(2))]
    m = re.match(r"^(.+?),\s*([^,]*\d[^,]*)$", s)
    if m:
        return [clean_text(m.group(1)), clean_text(m.group(2))]
    return None


def _table_rows(src: List[Tuple[int, str]]) -> Tuple[List[str], List[Tuple[int, List[str]]]]:
    """Header cells and (line, cells) data rows of a pipe table; a |---| row marks the header."""
    has_header = len(src) > 1 and _is_separator_row(src[1][1], loose=True)
    header: List[str] = []
    rows: List[Tuple[int, List[str]]] = []
    for i, (ln, raw) in enumerate(src):
        if _is_separator_row(raw):
            continue
        cells = _split_row(raw)
        if i == 0 and has_header:
            header = cells
        elif i == 1 and has_header:
            continue
        else:
            rows.append((ln, cells))
    return header, rows


def _csv_rows(f_line: int, body: List[str]) -> List[Tuple[int, List[str]]]:
    text = "\n".join(body)
    delim = "\t" if "\t" in text else "|" if "|" in text else ";" if ";" in text else ","
    out = []
    for i, row in enumerate(csv.reader(io.StringIO(text), delimiter=delim, skipinitialspace=True)):
        cells = [clean_text(c) for c in row]
        if any(cells):
            out.append((f_line + 1 + i, cells))
    return out


# ---------- scanning and type guessing ----------

def _key_match(line: str, allowed: Optional[set] = None, scan: bool = False):
    """(match, canonical field) for a `key: value` line, including a bulleted one (`- Source: X`)."""
    km = _KEY_LINE.match(line)
    if km:
        return km, FIELD_ALIASES.get(_norm_key(km.group(1)))
    bm = _BULLET.match(line)
    if bm:
        km = _KEY_LINE.match(bm.group(1))
        if km:
            canon = FIELD_ALIASES.get(_norm_key(km.group(1)))
            if canon and ((scan and canon in _SCAN_BULLET_KEYS) or (allowed is not None and (canon in allowed or canon == "note"))):
                return km, canon
    return None, None


def _scan(sec: _Section) -> Dict[str, Any]:
    keys: set = set()
    tables: List[List[Tuple[int, str]]] = []
    fences: List[Tuple[int, List[str]]] = []
    bullets = numbered = text = 0
    bullet_texts: List[str] = []
    md_image = False
    in_fence: Optional[Tuple[int, str, List[str]]] = None
    cur: Optional[List[Tuple[int, str]]] = None
    for ln, raw in sec.lines:
        if in_fence is not None:
            if raw.strip().startswith(in_fence[1]):
                fences.append((in_fence[0], in_fence[2]))
                in_fence = None
            else:
                in_fence[2].append(raw)
            continue
        fm = _FENCE.match(raw)
        if fm:
            in_fence = (ln, fm.group(1), [])
            cur = None
            continue
        line = raw.rstrip()
        if not line.strip():
            cur = None
            continue
        if line.lstrip().startswith("|"):
            if cur is None:
                cur = []
                tables.append(cur)
            cur.append((ln, line))
            continue
        cur = None
        km, canon = _key_match(line, scan=True)
        if km and canon:
            keys.add(canon)
            continue
        if _MD_IMAGE.search(line):
            md_image = True
        if _BULLET.match(line):
            bullets += 1
            bullet_texts.append(line)
        elif _NUMBERED.match(line):
            numbered += 1
        elif not re.match(r"^\s*(---+|\*\*\*+|___+)\s*$", line) and not line.lstrip().startswith("#"):
            text += 1
    if in_fence is not None:
        fences.append((in_fence[0], in_fence[2]))
    return {"keys": keys, "tables": tables, "fences": fences, "bullets": bullets, "numbered": numbered,
            "md_image": md_image, "text": text, "bullet_texts": bullet_texts}


def _bullets_are_data(texts: List[str]) -> bool:
    """True when every bullet is 'label: value' with the same kind of money, percent or multiplier value
    (or period labels): a chart written as a list, not points to read."""
    from ..validators.charts import TIME_LABEL
    if len(texts) < 2:
        return False
    units, labels = set(), []
    for t in texts:
        pair = _pair_from_text(t)
        if pair is None:
            return False
        value, unit, problem = parse_value(pair[1])
        if problem:
            return False
        units.add(unit)
        labels.append(pair[0])
    if len(units) != 1:
        return False
    return next(iter(units)) != "number" or all(TIME_LABEL.match(l.strip()) for l in labels)


def _guess_type(scan: Dict[str, Any], first: bool, last: bool) -> Tuple[str, Optional[str], str]:
    """The slide type a section with no (known) type most likely is, and why."""
    k = scan["keys"]
    if "image" in k or scan["md_image"] or k & {"prompt", "focus", "filter", "duotone", "search"}:
        return "image", None, "has a picture"
    if "quote" in k:
        return "quote", None, "has a quote"
    if "number" in k:
        return "stat", None, "has a big number"
    if "pill" in k:
        return ("cover" if first or not last else "cta"), None, "has a pill"
    if "subtext" in k:
        return "cta", None, "has pill subtext"
    if k & {"kind", "data", "labels", "values"}:
        return "chart", None, "has chart data"
    if scan["tables"]:
        _, rows = _table_rows(scan["tables"][0])
        chartish = len(rows) >= 2 and all(len(c) == 2 for _, c in rows) and all(parse_value(c[1])[2] is None for _, c in rows)
        return ("chart", None, "is a label | number table") if chartish else ("table", None, "has a table")
    if scan["fences"]:
        return "chart", None, "has a data block"
    if "items" in k or (scan["numbered"] >= 2 and not scan["bullets"]):
        return "list", None, "has numbered items"
    if scan["bullets"] and not scan["numbered"] and _bullets_are_data(scan["bullet_texts"]):
        return "chart", None, "is a list of label: value pairs"
    if "bullets" in k or scan["bullets"]:
        return "point", None, "has bullets"
    if first and not scan["bullets"] and not scan["numbered"]:
        return "cover", None, "is the first slide"
    if last and scan["text"] <= 1 and not scan["bullets"] and not scan["numbered"]:
        return "cta", None, "is the last slide"
    return "point", None, "is plain text"


# ---------- one slide ----------

_MARK_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")


def _mark(v: str) -> str:
    """**word** -> ==word== so clean_text keeps the emphasis; the renderer draws it in the accent colour."""
    return _MARK_BOLD.sub(lambda m: "==" + (m.group(1) or m.group(2)) + "==", v or "")


def _mark_text(lines: List[str]) -> str:
    return clean_text(_mark(" ".join(lines)))


def plain(text: Any) -> str:
    """Slide text without ==highlight== markers (for captions, checks and lengths)."""
    return re.sub(r"==(.+?)==", r"\1", str(text or ""))


def _design_fields(slide: Dict[str, Any], vals: Dict[str, str], field_lines: Dict[str, int], line: int, add_issue) -> None:
    """theme / align / kicker: accepted on every slide."""
    for key, aliases, choices in (("theme", THEME_ALIASES, THEMES), ("align", ALIGN_ALIASES, ALIGNS)):
        raw = vals.get(key, "")
        if not raw:
            continue
        got = aliases.get(_norm_key(raw).replace("_", ""), aliases.get(_norm_key(raw)))
        if got:
            slide[key] = got
        else:
            add_issue("WARN", f"{key.upper()}_UNKNOWN", f"{key} '{raw}' is not one of {', '.join(choices)}; it was ignored.",
                      field_lines.get(key, line), key)
    if vals.get("kicker"):
        slide["kicker"] = plain(vals["kicker"])[:60]


def _parse_slide(sec: _Section, slide_n: int, issues: List[SpecIssue], stype: str, kind_hint: Optional[str],
                 fallback_headline: str = "") -> Dict[str, Any]:
    slide: Dict[str, Any] = {"type": stype}
    allowed = ALLOWED_FIELDS[stype]
    fields: Dict[str, str] = {}
    field_lines: Dict[str, int] = {}
    text_lines: List[str] = []
    bullets: List[str] = []
    numbered: List[str] = []
    tables: List[List[Tuple[int, str]]] = []
    fences: List[Tuple[int, str, List[str]]] = []
    notes: List[str] = []
    last_key: Optional[str] = None
    in_fence: Optional[Tuple[int, str, str, List[str]]] = None
    current_table: Optional[List[Tuple[int, str]]] = None
    side: Optional[str] = None                      # compare slides: the column the next bullets belong to
    sides: Dict[str, List[str]] = {"left": [], "right": []}

    def add_issue(sev: str, code: str, msg: str, ln: int, fld: Optional[str] = None, hint: Optional[str] = None):
        issues.append(SpecIssue(sev, code, msg, slide=slide_n, line=ln, field=fld, hint=hint))

    for ln, raw in sec.lines:
        if in_fence is not None:
            if raw.strip().startswith(in_fence[1]):
                fences.append((in_fence[0], in_fence[2], in_fence[3]))
                in_fence = None
            else:
                in_fence[3].append(raw)
            continue
        fm = _FENCE.match(raw)
        if fm:
            in_fence = (ln, fm.group(1), fm.group(2).lower(), [])
            last_key = None
            current_table = None
            continue
        line = raw.rstrip()
        if not line.strip():
            last_key = None
            current_table = None
            continue
        if line.lstrip().startswith("|"):
            if current_table is None:
                current_table = []
                tables.append(current_table)
            current_table.append((ln, line))
            last_key = None
            continue
        current_table = None
        if re.match(r"^\s*(---+|\*\*\*+|___+)\s*$", line):
            continue
        km, canon = _key_match(line, allowed)
        if canon == "note":
            notes.append(clean_text(km.group(2) or ""))
            last_key = "note"
            continue
        if canon and canon in allowed:
            if canon in fields:
                add_issue("WARN", "FIELD_REPEATED", f"'{km.group(1)}:' appears twice on this slide; the last one is used.", ln, canon)
            fields[canon] = km.group(2) or ""
            field_lines[canon] = ln
            last_key = canon
            if canon in ("left", "right"):
                side = canon
                last_key = None
            continue
        if canon and canon not in allowed and canon not in ("kind",):
            add_issue("WARN", "FIELD_NOT_USED",
                      f"'{km.group(1)}:' is not a {stype}-slide field, so this line is treated as text.", ln, canon,
                      f"{stype} slides use: {', '.join(sorted(allowed | {'note'}))}.")
        if km:
            last_key = None  # a "Label: text" line is its own text, not a continuation
        bm = _BULLET.match(line) or _NUMBERED.match(line)
        if bm and stype == "compare" and side:
            sides[side].append(clean_text(bm.group(1)))
            last_key = None
            continue
        bm = _BULLET.match(line)
        if bm:
            bullets.append(clean_text(bm.group(1)))
            last_key = None
            continue
        nm = _NUMBERED.match(line)
        if nm:
            numbered.append(clean_text(nm.group(1)))
            last_key = None
            continue
        if line.lstrip().startswith("#"):
            add_issue("WARN", "HEADING_IGNORED", f"Heading '{line.strip()}' inside a slide is ignored (slides start with '## type').", ln)
            continue
        if last_key == "note":
            notes[-1] = (notes[-1] + " " + clean_text(line)).strip()
        elif last_key:
            fields[last_key] = (fields[last_key] + " " + line.strip()).strip()
        else:
            text_lines.append(line.strip())

    if in_fence is not None:
        add_issue("ERROR", "FENCE_NOT_CLOSED", f"Code block opened with {in_fence[1]} is never closed.", in_fence[0],
                  hint=f"Add a closing {in_fence[1]} line.")
        fences.append((in_fence[0], in_fence[2], in_fence[3]))

    # **bold** or ==marked== words in a headline are drawn in the accent colour (kept as ==word==)
    vals = {k: clean_text(_mark(v) if k in ("headline", "body", "number") else v) for k, v in fields.items()}
    free_text = clean_text(" ".join(text_lines))
    if notes:
        slide["notes"] = " ".join(n for n in notes if n)
    if vals.get("source") and stype in INFO_TYPES:
        slide["source_note"] = vals["source"]
    _design_fields(slide, vals, field_lines, sec.line, add_issue)
    if "accent" in fields:
        color = _norm_color(vals.get("accent", ""))
        if color:
            slide["accent"] = color
        else:
            add_issue("WARN", "ACCENT_INVALID", f"accent '{vals.get('accent', '')}' is not a colour; the style's own accent is used.",
                      field_lines.get("accent", sec.line), "accent", "Use a hex colour like #1E6FE8, or a name like blue.")

    def body_from(*keys: str) -> str:
        for k in keys:
            if vals.get(k):
                return vals[k]
        return ""

    def leftover(what: str, used: bool) -> None:
        if not used:
            add_issue("WARN", "CONTENT_IGNORED", f"{what} on a {stype} slide is not shown; it was ignored.", sec.line,
                      hint="Move it to a slide type that shows it, or put it in a note: line.")

    def listed() -> List[str]:
        """Items from `- ` / `1. ` lines plus inline `bullets:` / `items:` fields."""
        inline = []
        for key in ("bullets", "items"):
            if fields.get(key):
                inline += _split_list(fields[key])
        return bullets + numbered + inline

    if stype == "cover":
        slide["headline"] = vals.get("headline") or _mark_text(text_lines) or fallback_headline
        if vals.get("headline") and free_text:
            leftover("Extra text", False)
        if vals.get("pill"):
            slide["pill"] = vals["pill"]
        leftover("A list", not (bullets or numbered))
    elif stype == "point":
        slide["headline"] = vals.get("headline") or fallback_headline
        body = " ".join(x for x in (vals.get("body", ""), free_text) if x)
        if body:
            slide["body"] = body
        items = listed()
        if items:
            slide["bullets"] = items
    elif stype == "list":
        slide["headline"] = vals.get("headline") or fallback_headline
        slide["items"] = numbered + bullets + [i for key in ("items", "bullets") if fields.get(key) for i in _split_list(fields[key])]
        leftover("Plain text", not free_text)
    elif stype == "stat":
        slide["headline"] = vals.get("headline") or fallback_headline
        slide["number"] = vals.get("number", "")
        body = " ".join(x for x in (vals.get("body", ""), free_text) if x)
        if body:
            slide["body"] = body
        leftover("A list", not (bullets or numbered))
    elif stype == "quote":
        slide["body"] = body_from("quote", "body") or free_text
        if body_from("quote", "body") and free_text:
            leftover("Extra text", False)
        if vals.get("author"):
            slide["author"] = re.sub(r"^[-—–]\s*", "", vals["author"])
    elif stype == "statement":
        slide["headline"] = vals.get("headline") or _mark_text(text_lines) or fallback_headline
        if vals.get("body"):
            slide["body"] = vals["body"]
        elif vals.get("headline") and free_text:
            slide["body"] = free_text
        items = listed()
        if items:
            slide["body"] = " ".join(x for x in (slide.get("body", ""), " · ".join(items)) if x)
    elif stype == "compare":
        slide["headline"] = vals.get("headline") or fallback_headline
        if vals.get("body") or free_text:
            slide["body"] = " ".join(x for x in (vals.get("body", ""), free_text) if x)
        loose = listed()
        if not sides["left"] and not sides["right"] and loose:
            # no left:/right: labels: first half of the list is the left column, the rest the right
            half = (len(loose) + 1) // 2
            sides["left"], sides["right"] = loose[:half], loose[half:]
        slide["left"] = {"label": vals.get("left") or "Before", "items": sides["left"]}
        slide["right"] = {"label": vals.get("right") or "After", "items": sides["right"]}
    elif stype == "cta":
        slide["headline"] = vals.get("headline") or _mark_text(text_lines) or fallback_headline
        if vals.get("pill"):
            slide["cta_pill"] = vals["pill"]
        if vals.get("subtext"):
            slide["cta_pill_subtext"] = vals["subtext"]
    elif stype == "image":
        slide["headline"] = vals.get("headline") or fallback_headline
        body = " ".join(x for x in (body_from("caption", "body"), free_text) if x)
        if body:
            slide["body"] = body
        slide["image"] = (fields.get("image") or "").strip().strip("<>").strip("\"'")
        auto = re.match(r"(?i)^(?:auto|search|find|stock)(?:\s*:\s*|\s+)(.+)$", slide["image"])
        search = vals.get("search", "")
        if auto or slide["image"].lower() in ("auto", "search", "stock"):
            # `image: auto workshop 3d printer` asks for a free stock picture; bare `image: auto` searches by the headline
            search = search or (auto.group(1).strip() if auto else "")
            slide["image"] = ""
            if not search:
                search = vals.get("headline") or fallback_headline or vals.get("prompt", "") or vals.get("alt", "")
        if search:
            slide["image_search"] = search[:120]
        if not slide["image"]:
            img = _MD_IMAGE.search("\n".join(r for _, r in sec.lines))
            if img:
                slide["image"] = img.group(1)
                slide["body"] = clean_text(re.sub(r"!\[[^\]]*\]\([^)]*\)", "", slide.get("body", ""))) or slide.get("body", "")
                if not slide["body"]:
                    slide.pop("body")
        items = listed()
        if items:
            slide["bullets"] = items
        if vals.get("prompt"):
            slide["image_prompt"] = vals["prompt"]
        style, problems = parse_image_style({k: vals.get(k, "") for k in STYLE_FIELDS})
        for code, msg, fld in problems:
            add_issue("WARN", f"IMAGE_{code}", msg, field_lines.get(fld, sec.line), fld)
        if style:
            slide["image_style"] = style
        slide["image_fit"] = style.get("fit", "cover")
        if vals.get("alt"):
            slide["alt"] = vals["alt"]
    elif stype in ("table", "chart"):
        slide["headline"] = vals.get("headline") or fallback_headline
        body = " ".join(x for x in (vals.get("body", ""), free_text) if x)
        if body:
            slide["body"] = body
        if stype == "table":
            if vals.get("highlight"):
                slide["highlight"] = vals["highlight"]
            _fill_table(slide, tables, fences, slide_n, sec.line, issues)
        else:
            _fill_series(slide, tables, fences, bullets, fields, slide_n, sec.line, issues)
            raw_kind = (vals.get("kind") or kind_hint or "").lower().replace("chart", "").strip(" _-")
            kind = {"donut": "pie", "doughnut": "pie", "bars": "bar", "column": "bar", "columns": "bar",
                    "trend": "line", "area": "line", "graph": "bar"}.get(raw_kind, raw_kind)
            if kind and kind not in CHART_KINDS:
                close = difflib.get_close_matches(kind, list(CHART_KINDS), n=1, cutoff=0.6)
                if close:
                    add_issue("WARN", "CHART_KIND_GUESSED", f"Chart kind '{vals.get('kind')}' was read as {close[0]}.",
                              field_lines.get("kind", sec.line), "kind")
                    kind = close[0]
                else:
                    add_issue("WARN", "CHART_KIND_UNKNOWN", f"Chart kind '{vals.get('kind')}' is not bar, pie or line; drawn as a bar chart.",
                              field_lines.get("kind", sec.line), "kind", "Use kind: bar, kind: pie or kind: line.")
                    kind = "bar"
            if not kind:
                from ..validators.charts import TIME_LABEL
                labels = [str(p.get("label", "")) for p in slide.get("series", [])]
                if len(labels) >= 3 and all(TIME_LABEL.match(l.strip()) for l in labels):
                    kind = "line"
                    add_issue("WARN", "CHART_KIND_GUESSED", "The labels are periods, so this is drawn as a line chart.",
                              sec.line, "kind", "Add kind: bar to draw bars instead.")
                else:
                    kind = "bar"
            slide["chart_kind"] = kind
        leftover("A list", stype == "chart" or not (bullets or numbered))
    if stype not in ("table", "chart") and (tables or fences):
        leftover("A table or code block", False)
    return slide


def _fill_table(slide: Dict[str, Any], tables, fences, slide_n: int, line: int, issues: List[SpecIssue]) -> None:
    header: List[str] = []
    rows: List[List[str]] = []
    first_line = line
    if tables:
        header, src_rows = _table_rows(tables[0])
        rows = [c for _, c in src_rows]
        first_line = tables[0][0][0]
    elif fences:
        f_line, _, body = fences[0]
        parsed = _csv_rows(f_line, body)
        if parsed:
            header = parsed[0][1]
            rows = [c for _, c in parsed[1:]]
            first_line = f_line
    if len(tables) + (len(fences) if tables else max(len(fences) - 1, 0)) > 0 and (len(tables) > 1):
        issues.append(SpecIssue("WARN", "EXTRA_TABLE", "Only the first table on a slide is used.", slide=slide_n,
                                line=tables[1][0][0]))
    width = len(header) if header else max((len(r) for r in rows), default=0)
    fixed = False
    for r in rows:
        if len(r) < width:
            r.extend([""] * (width - len(r)))
            fixed = True
        elif len(r) > width:
            del r[width:]
            fixed = True
    if fixed:
        issues.append(SpecIssue("WARN", "TABLE_RAGGED",
                                f"Some table rows had a different number of cells than the {width} columns; short rows were padded "
                                "and extra cells dropped.", slide=slide_n, line=first_line,
                                hint="Give every row the same number of | cells."))
    slide["table"] = {"columns": header, "rows": rows}


def _fill_series(slide: Dict[str, Any], tables, fences, bullets: List[str], fields: Dict[str, str], slide_n: int,
                 line: int, issues: List[SpecIssue]) -> None:
    pairs: List[Tuple[int, str, str]] = []
    if tables:
        _, rows = _table_rows(tables[0])
        extra = False
        for ln, cells in rows:
            if len(cells) < 2:
                issues.append(SpecIssue("ERROR", "CHART_TABLE_COLUMNS",
                                        f"Chart tables need a label column and a value column; this row has {len(cells)} cell.",
                                        slide=slide_n, line=ln, hint="Write rows like  | Label | 12 |"))
                continue
            extra = extra or len(cells) > 2
            pairs.append((ln, cells[0], cells[1]))
        if extra:
            issues.append(SpecIssue("WARN", "CHART_EXTRA_COLUMNS",
                                    "The chart table has more than 2 columns; only the first two (label, value) are drawn.",
                                    slide=slide_n, line=tables[0][0][0],
                                    hint="Use a table slide to show every column."))
    elif fences:
        f_line, _, body = fences[0]
        for i, raw in enumerate(body):
            ln = f_line + 1 + i
            s = raw.strip()
            if not s or s.startswith("#") or _is_separator_row(s):
                continue
            cells = _pair_from_text(s)
            if cells is None and not pairs and i <= 1 and re.search(r"[,\t|]", s):
                continue  # a header line such as "label, value"
            if cells is None:
                issues.append(SpecIssue("ERROR", "CHART_ROW_UNREADABLE", f"Chart data line '{s}' is not 'label: value'.",
                                        slide=slide_n, line=ln, hint="Write one point per line, like  FY24: ₹43.50 crore"))
                continue
            if not pairs and not re.search(r"\d", cells[1]) and i <= 1:
                continue  # a header line such as "label, value"
            pairs.append((ln, cells[0], cells[1]))
    elif fields.get("data") or (fields.get("labels") and fields.get("values")):
        if fields.get("data"):
            for piece in re.split(r";|,\s+(?=[A-Za-z(])", fields["data"]):
                cells = _pair_from_text(piece)
                if cells is None:
                    if piece.strip():
                        issues.append(SpecIssue("ERROR", "CHART_ROW_UNREADABLE", f"Chart data '{piece.strip()}' is not 'label: value'.",
                                                slide=slide_n, line=line, hint="Write  data: FY24: 10; FY25: 12"))
                    continue
                pairs.append((line, cells[0], cells[1]))
        else:
            labels = _split_list(fields["labels"], commas=True)
            values = _split_list(fields["values"], commas=True)
            if len(labels) != len(values):
                issues.append(SpecIssue("ERROR", "CHART_LABELS_VALUES",
                                        f"There are {len(labels)} labels but {len(values)} values.", slide=slide_n, line=line,
                                        hint="Give one value for each label."))
            pairs = [(line, a, b) for a, b in zip(labels, values)]
    elif bullets:
        for b in bullets:
            cells = _pair_from_text(b)
            if cells:
                pairs.append((line, cells[0], cells[1]))
    series = []
    for ln, label, value_raw in pairs:
        value, unit, _ = parse_value(value_raw)
        item: Dict[str, Any] = {"label": label, "value_raw": value_raw}
        if value is not None:
            item["value"] = value
            item["unit"] = unit
        series.append(item)
    slide["series"] = series
    if len(tables) + len(fences) > 1:
        issues.append(SpecIssue("WARN", "EXTRA_DATA", "Only the first table or data block on a chart slide is used.",
                                slide=slide_n, line=line))


# ---------- whole spec ----------

def parse_spec(text: str, base_dir: Optional[Path] = None, require_marker: bool = True) -> ParsedSpec:
    """Parse spec text. Never raises for bad content: problems are returned as issues
    (with line numbers), and the slide checks from checks.py are included.

    require_marker=False also accepts a file with no `autocontent: post` header (run --spec)."""
    from .checks import check_slides, check_caption

    spec = ParsedSpec(base_dir=Path(base_dir) if base_dir else None)
    text = _strip_comments(text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n"))
    lines = text.split("\n")
    fm, body_start = _front_matter(lines)
    marked = fm is not None and any(_MARKER.match(l) for l in fm)
    if not marked and require_marker:
        spec.issues.append(SpecIssue(
            "ERROR", "NOT_A_SPEC", "This file does not start with the post spec header.", line=1,
            hint="Start the file with three lines:  ---  /  autocontent: post  /  ---  (see POST_FORMAT.md)."))
        return spec
    if fm is not None:
        fm_start = next(i for i, l in enumerate(lines) if l.strip() == "---") + 2
        spec.meta = _parse_meta(fm, fm_start, spec.issues)
        _check_meta(spec.meta, spec.issues)
    else:
        body_start = 0
        spec.issues.append(SpecIssue("WARN", "NO_HEADER", "There is no header (--- autocontent: post ---); defaults are used.", line=1,
                                     hint="Add the header to set the style, size and tag."))

    sections: List[_Section] = []
    in_fence = None
    for idx in range(body_start, len(lines)):
        raw = lines[idx]
        ln = idx + 1
        fm_ = _FENCE.match(raw)
        if fm_ and (in_fence is None or raw.strip().startswith(in_fence)):
            in_fence = None if in_fence else fm_.group(1)
        h = _HEADER.match(raw) if in_fence is None else None
        res = _resolve_heading(h.group(3), len(h.group(1)), bool(h.group(2))) if h and h.group(3) else None
        if res:
            sections.append(_Section(res["key"], ln, label=res["label"], text=res["text"], fuzzy=res["fuzzy"]))
            continue
        if sections:
            sections[-1].lines.append((ln, raw))
        elif raw.strip():
            hm = re.match(r"^#(?!#)\s+(.+)$", raw.strip())
            if hm and "title" not in spec.meta:
                spec.meta["title"] = clean_text(hm.group(1))
            elif not hm:
                spec.issues.append(SpecIssue("WARN", "TEXT_BEFORE_SLIDES",
                                             "Text before the first '## ' slide is ignored.", line=ln))

    slide_secs = [s for s in sections if s.key is None or (s.key in TYPE_ALIASES and TYPE_ALIASES[s.key][0] in SLIDE_TYPES)]
    seen_caption = False
    for sec in sections:
        if sec.key == "__ignored__":
            spec.issues.append(SpecIssue("WARN", "SECTION_IGNORED", f"The section '## {sec.text}' is not a slide; it was skipped.",
                                         line=sec.line))
            continue
        stype = kind_hint = None
        if sec.key is not None:
            stype, kind_hint = TYPE_ALIASES[sec.key]
        if stype == "caption":
            if seen_caption:
                spec.issues.append(SpecIssue("WARN", "CAPTION_REPEATED", "There are two caption sections; the last one is used.", line=sec.line))
            seen_caption = True
            body = "\n".join(r.rstrip() for _, r in sec.lines).strip("\n")
            spec.caption = re.sub(r"\n{3,}", "\n\n", body).strip()
            continue
        if stype == "hashtags":
            spec.hashtags += [t for t in _hashtags_from(" ".join(r for _, r in sec.lines))
                              if t.lower() not in (x.lower() for x in spec.hashtags)]
            continue
        n = len(spec.slides) + 1
        pos = slide_secs.index(sec)
        label = sec.label
        if stype is None:
            stype, kind_hint, why = _guess_type(_scan(sec), first=pos == 0, last=pos == len(slide_secs) - 1)
            spec.issues.append(SpecIssue(
                "WARN", "SLIDE_TYPE_GUESSED",
                f"'## {sec.text}' is not a slide type, so it was read as a {stype} slide because it {why}.",
                slide=n, line=sec.line, hint=f"Write '## {stype}' to choose the type yourself."))
        elif sec.fuzzy:
            spec.issues.append(SpecIssue("WARN", "SLIDE_TYPE_TYPO", f"'## {sec.text}' was read as '{sec.key}' (closest match).",
                                         slide=n, line=sec.line))
        spec.slides.append(_parse_slide(sec, n, spec.issues, stype, kind_hint, fallback_headline=label))
        spec.slide_lines.append(sec.line)

    apply_source_defaults(spec.slides, spec.meta.get("source"))
    apply_image_defaults(spec, spec.meta)
    apply_design_defaults(spec)
    for n, sl in enumerate(spec.slides, start=1):
        if sl.get("type") == "image" and not (sl.get("image") or sl.get("image_search") or sl.get("image_prompt")):
            image_to_text(sl)
            spec.issues.append(SpecIssue("WARN", "IMAGE_NONE", "This picture slide has no image:, search: or prompt:, "
                                         "so it is drawn as a text slide.", slide=n, line=spec.slide_lines[n - 1],
                                         hint="Add  image: <file or link>  or  search: <words>  to show a picture."))

    if spec.meta.get("hashtags") and not spec.hashtags:
        spec.hashtags = _hashtags_from(spec.meta["hashtags"])

    for issue in check_slides(spec.slides, base_dirs=_image_dirs(spec.base_dir), allow_urls=True):
        if issue.slide and issue.line is None and issue.slide <= len(spec.slide_lines):
            issue.line = spec.slide_lines[issue.slide - 1]
        spec.issues.append(issue)
    spec.issues.extend(check_caption(spec.caption, spec.hashtags, auto=spec.caption is None))
    return spec


def apply_image_defaults(spec: "ParsedSpec", meta: Dict[str, Any]) -> None:
    """Header `image_filter:`, `image_rounded:` ... are the look of every image slide that does not set its own."""
    raw = {k[len("image_"):]: v for k, v in meta.items() if k.startswith("image_") and isinstance(v, str)}
    if not raw:
        return
    defaults, problems = parse_image_style(raw)
    lines = meta.get("_lines", {})
    for code, msg, fld in problems:
        spec.issues.append(SpecIssue("WARN", f"IMAGE_{code}", f"In the header: {msg}", line=lines.get(f"image_{fld}"), field=fld))
    if not defaults:
        return
    for s in spec.slides:
        if s.get("type") != "image":
            continue
        merged = merge_styles(defaults, s.get("image_style") or {})
        s["image_style"] = merged
        s["image_fit"] = merged.get("fit", "cover")


def apply_design_defaults(spec: "ParsedSpec") -> None:
    """Header `theme:` is the look of every slide that does not set its own."""
    raw = str(spec.meta.get("theme") or "").strip()
    if not raw:
        return
    theme = THEME_ALIASES.get(_norm_key(raw))
    if not theme:
        spec.issues.append(SpecIssue("WARN", "THEME_UNKNOWN", f"theme '{raw}' is not one of {', '.join(THEMES)}; it was ignored.",
                                     line=spec.meta.get("_lines", {}).get("theme"), field="theme"))
        return
    for s in spec.slides:
        s.setdefault("theme", theme)


def image_to_text(slide: Dict[str, Any]) -> None:
    """A picture slide with no picture becomes a point slide that keeps its words."""
    for k in ("image", "image_search", "image_prompt", "image_style", "image_fit", "alt", "image_source"):
        slide.pop(k, None)
    slide["type"] = "point"
    bullets = slide.get("bullets") or []
    if not slide.get("body") and not bullets:
        slide["body"] = slide.get("headline", "")
    if len(bullets) == 1:
        slide["body"] = " ".join(x for x in (slide.get("body", ""), bullets[0]) if x)
        slide.pop("bullets")


def apply_source_defaults(slides: List[Dict[str, Any]], default: Optional[str]) -> None:
    """A header `source:` goes on every info slide without its own; `source: none` on a slide
    (or in the header) means no source line."""
    default = clean_text(default or "")
    if default.lower() in NO_SOURCE:
        default = ""
    for s in slides:
        own = str(s.get("source_note") or "").strip()
        if own.lower() in NO_SOURCE:
            s.pop("source_note", None)
        elif not own and default and s.get("type") in INFO_TYPES:
            s["source_note"] = default
            s["_source_default"] = True   # a stock picture's own credit may replace this (see build.collect_images)


def _image_dirs(base_dir: Optional[Path]) -> List[Path]:
    from ..settings import PROJECT_ROOT
    dirs = [base_dir] if base_dir else []
    return dirs + [PROJECT_ROOT]
