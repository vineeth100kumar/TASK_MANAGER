"""Slide renderer using Jinja2 templates and Playwright with self-contained assets."""

from pathlib import Path
import json
import math
import base64
import re
from typing import List, Dict, Any, Optional, Tuple
from jinja2 import Environment, FileSystemLoader
from PIL import Image, ImageDraw, ImageFont

from ..settings import PROJECT_ROOT, FONTS_DIR, STYLES_DIR
from .textures import make_paper
from .doodles import brush_underline, dashed_loop
from .grid import make_grid_data_url, grid_dashed_loop, arrow_button_svg
from .fit import FIT_TEXT_JS
from .overrides import APPLY_OVERRIDES_JS, ROLE_SELECTORS, overrides_call, recolor_html, clean_colors
from .style_config import load_style_config, StyleConfig, list_available_styles, CANVAS_FORMATS
from ..progress import report



def browser_launch_options() -> dict:
    """Chromium launch options. Sage on the Raspberry Pi sets AUTOCONTENT_CHROMIUM to
    the system browser (apt chromium) and, because the service runs sandboxed,
    AUTOCONTENT_NO_SANDBOX=1. Without them this is the stock Playwright launch."""
    import os
    options: dict = {}
    path = os.environ.get("AUTOCONTENT_CHROMIUM", "").strip()
    if path:
        options["executable_path"] = path
    if os.environ.get("AUTOCONTENT_NO_SANDBOX", "").strip() not in ("", "0"):
        options["args"] = ["--no-sandbox"]
    return options


def _file_to_data_url(file_path: Path, mime_type: str) -> str:
    with open(file_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime_type};base64,{b64}"


_NUMERIC_CELL = re.compile(r"^[~≈]?\s*[-−+]?\s*(?:₹|\$|€|£|¥|rs\.?\s*)?[-−+]?\s*\d[\d,.]*\s*(?:%|x|×|k|m|mn|b|bn|cr|crore|lakhs?|l)?\+?$", re.I)


def _table_context(slide: Dict[str, Any]) -> Dict[str, Any]:
    """Table slide data for the template: right-aligned numeric columns and the highlighted row."""
    table = slide.get("table") or {}
    columns = [str(c) for c in (table.get("columns") or [])]
    rows = [[str(c) for c in r] for r in (table.get("rows") or []) if isinstance(r, list)]
    width = max([len(columns)] + [len(r) for r in rows]) if (columns or rows) else 0
    numeric = []
    for i in range(width):
        cells = [r[i].strip() for r in rows if i < len(r) and r[i].strip()]
        numeric.append(i > 0 and bool(cells) and all(_NUMERIC_CELL.match(c) for c in cells))
    hl = str(slide.get("highlight") or "").strip().lower()
    highlight = next((i for i, r in enumerate(rows) if hl and r and r[0].strip().lower() == hl), -1)
    return {"columns": columns, "rows": rows, "numeric": numeric, "highlight": highlight}


# Info slides with a source line: the text that shrinks to make room, and its smallest size
SOURCE_SHRINK = {
    "point": (".point-body", 24),
    "list": (".item-text, .list-text", 22),
    "stat": (".stat-body", 24),
    "quote": (".quote-body", 30),
    "statement": (".statement-body", 24),
}


# Default vertical placement of a slide's content (a slide's own `align:` wins)
DEFAULT_ALIGN = {"stat": "center", "quote": "center", "statement": "center"}
BALANCED_TYPES = ("point", "list", "stat", "quote", "table", "chart", "image", "statement", "compare")

_HEX6 = re.compile(r"#[0-9a-fA-F]{6}\b")
_HIGHLIGHT = re.compile(r"==([^=<>'\"\n]{1,120}?)==")
_CONTAINER = re.compile(r'(<div class="(?:content-container|headline-container|cta-container)"[^>]*>)')


def _mix(a: str, b: str, t: float) -> str:
    """Colour a blended toward b by t (0..1)."""
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(ca, cb))


def theme_palette(theme: str, colors: Dict[str, str]) -> Dict[str, str]:
    """old hex -> new hex for a dark or accent slide. colors: the slide's effective palette
    (background, ink, body, accent). Light slides keep the style's own colours."""
    bg, ink, body, accent = colors["background"], colors["ink"], colors["body"], colors["accent"]
    greys = ["#777777", "#666666", "#555555", "#444444", "#999999", "#6B6458"]
    fills = ["#E9E9E9", "#F3F3F3", "#F2F2F2", "#E2E2E2", "#E8E8E8"]
    if theme == "dark":
        new_bg = "#121110" if colors.get("warm") else "#0E0E10"
        m = {bg: new_bg, ink: "#FFFFFF", body: "#ECECEC", "#FFFFFF": new_bg}
        m.update({g: _mix(g, "#FFFFFF", 0.45) for g in greys})
        m.update({f: _mix(new_bg, "#FFFFFF", 0.09) for f in fills})
    elif theme == "accent":
        m = {bg: accent, ink: "#FFFFFF", body: "#FFFFFF", accent: "#111111", "#FFFFFF": accent}
        m.update({g: _mix(accent, "#FFFFFF", 0.72) for g in greys})
        m.update({f: _mix(accent, "#000000", 0.12) for f in fills})
    else:
        return {}
    return {k.upper(): v for k, v in m.items() if k}


def swap_colors(html: str, mapping: Dict[str, str]) -> str:
    """Swap every mapped hex colour at once (no chains: #FFF->#000 and #000->#FFF both apply)."""
    if not mapping:
        return html
    return _HEX6.sub(lambda m: mapping.get(m.group(0).upper(), m.group(0)), html)


def decorate_html(html: str, slide: Dict[str, Any], accent: str) -> str:
    """==word== -> accent-coloured word; `kicker:` -> small label above the slide's content."""
    css = (f".hlw {{ color: {accent}; }}\n"
           f".kicker {{ font-family: 'Inter', sans-serif; font-weight: 800; font-size: 26px; letter-spacing: 0.16em;"
           f" text-transform: uppercase; color: {accent}; margin-bottom: 26px; line-height: 1.2; }}\n")
    html = html.replace("</style>", css + "</style>", 1)
    html = _HIGHLIGHT.sub(r'<span class="hlw">\1</span>', html)
    kicker = str(slide.get("kicker") or "").strip()
    if kicker:
        from html import escape
        html = _CONTAINER.sub(lambda m: m.group(1) + f'<div class="kicker">{escape(kicker)}</div>', html, count=1)
    return html


# Measures, after layout, whether any text ran into the footer / source note or off the slide.
FIT_PROBE_JS = """
() => {
    const problems = [];
    const W = window.innerWidth, H = window.innerHeight;
    const footer = document.querySelector('.footer-row');
    const footTop = footer ? footer.getBoundingClientRect().top : H;
    const src = document.querySelector('.chart-source, .table-source, .slide-source');
    const limit = Math.min(footTop, src ? src.getBoundingClientRect().top : footTop) - 2;
    document.querySelectorAll('.content-container, .headline-container').forEach((box) => {
        let bottom = 0, right = 0;
        box.querySelectorAll('*').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { bottom = Math.max(bottom, r.bottom); right = Math.max(right, r.right); }
            const clips = ['hidden', 'clip'].includes(getComputedStyle(el).overflowX);   // clips on purpose (picture frames)
            if (!clips && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && !(el instanceof SVGElement)) {
                const t = (el.innerText || '').trim().slice(0, 40);
                problems.push(`Text is wider than its box${t ? ' ("' + t + '")' : ''}: a word or table cell is too long`);
            }
        });
        if (bottom > limit + 1) problems.push(`Content runs into the footer (ends at y=${Math.round(bottom)}, must end above y=${Math.round(limit)})`);
        if (right > W - 30) problems.push(`Content runs off the right edge (x=${Math.round(right)} of ${W})`);
    });
    return Array.from(new Set(problems));
}
"""


class SlideRenderer:
    def __init__(self, style_name: str = "beige_grain", canvas_format: str = "portrait",
                 colors: Optional[Dict[str, str]] = None):
        self.style_name = style_name
        self.canvas_format = canvas_format
        # Brand colours from the deck editor ({"accent": "#..."}), swapped in after templating
        self.color_overrides: Dict[str, str] = clean_colors(colors)
        self.style_config: StyleConfig = load_style_config(style_name, format_name=canvas_format)
        self.style_dir = STYLES_DIR / style_name
        # Deck folder that image slides' paths ("assets/slide_04.jpg") are relative to
        self.base_dir: Optional[Path] = None
        # Spec decks: record layout problems per slide (fit_report) instead of stopping at the first
        self.collect_fit = False
        self.fit_report: List[Dict[str, Any]] = []
        self.jinja_env = Environment(
            loader=FileSystemLoader(str(self.style_dir)),
            autoescape=False
        )

        # Cache font data URLs
        league_path = FONTS_DIR / "LeagueSpartan-Variable.ttf"
        inter_path = FONTS_DIR / "Inter-Variable.ttf"
        montserrat_path = FONTS_DIR / "Montserrat-Variable.ttf"
        self.league_url = _file_to_data_url(league_path, "font/truetype") if league_path.exists() else ""
        self.inter_url = _file_to_data_url(inter_path, "font/truetype") if inter_path.exists() else ""
        self.montserrat_url = _file_to_data_url(montserrat_path, "font/truetype") if montserrat_path.exists() else ""

    def build_slide_html(
        self,
        slide: Dict[str, Any],
        brand: Dict[str, Any],
        total_slides: int,
        seed: int,
        asset_url=None
    ) -> str:
        """The slide's HTML before layout. asset_url(kind, path) -> URL lets the editor link
        fonts and textures instead of inlining them; by default they are inlined as data URLs."""
        slide_n = slide.get("n", 1)
        slide_type = slide.get("type", "point")
        slide_seed = seed + slide_n

        # Doodles & backgrounds per style
        underline_svg = ""
        loop_svg = ""
        arrow_svg = ""
        texture_url = ""
        grid_pattern_url = ""
        main_words = ""
        pill_word = ""

        headline_text = slide.get("headline", "")
        c_width = self.style_config.canvas.width
        c_height = self.style_config.canvas.height
        is_sq = (self.canvas_format == "square")

        theme = slide.get("theme") or "light"
        if self.style_name == "grid_pill":
            grid_line = self.style_config.colors.grid_line or "#E8E8E8"
            if theme == "dark":
                grid_line = "#232326"
            elif theme == "accent":
                acc = clean_colors({"accent": slide.get("accent")}).get("accent") or self.color_overrides.get("accent") \
                    or self.style_config.colors.accent
                grid_line = _mix(acc, "#FFFFFF", 0.14)
            grid_pattern_url = make_grid_data_url(
                width=c_width,
                height=c_height,
                grid_size=135,
                line_color=grid_line,
                bg_color=self.style_config.colors.background,
                line_width=2.2
            )
            arrow_svg = arrow_button_svg(
                stroke=self.style_config.colors.ink_black,
                arrow_color=self.style_config.colors.ink_black
            )
            if slide_type == "cover":
                loop_svg = grid_dashed_loop(
                    color=self.style_config.colors.accent,
                    seed=slide_seed,
                    width=c_width,
                    height=c_height
                )
                words = headline_text.split()
                # A headline ending in a number keeps the number and its unit together in the pill
                trailing_num = re.search(r"(?:^|\s)(\S*\d\S*(?:\s+(?:crore|lakh|million|billion|thousand|cr|mn|bn))?)$",
                                         headline_text, re.I)
                # A spec can name the pill phrase itself, if it is how the headline ends
                pill_req = str(slide.get("pill") or "").strip()
                head = headline_text.rstrip()
                if pill_req.lower() in ("none", "no", "off", "-") or ("==" in head and not pill_req):
                    # `pill: none`, or a headline with its own ==highlight==: no pill
                    main_words, pill_word = headline_text, ""
                elif pill_req and head.lower().endswith(pill_req.lower()) and len(pill_req) < len(head):
                    main_words = head[:len(head) - len(pill_req)].strip()
                    pill_word = head[len(head) - len(pill_req):]
                elif trailing_num and len(trailing_num.group(1).split()) < len(words):
                    pill_word = trailing_num.group(1)
                    main_words = headline_text[:trailing_num.start(1)].strip()
                elif len(words) >= 2:
                    main_words = " ".join(words[:-1])
                    pill_word = words[-1]
                else:
                    main_words = headline_text
                    pill_word = ""
            elif slide_type == "cta":
                loop_svg = grid_dashed_loop(
                    color=self.style_config.colors.accent,
                    seed=slide_seed + 100,
                    width=c_width,
                    height=c_height
                )
        else:
            # Paper texture style (e.g. beige_grain)
            texture_path = make_paper(
                width=c_width,
                height=c_height,
                seed=slide_seed
            )
            texture_url = (asset_url("generated", texture_path) if asset_url
                           else _file_to_data_url(texture_path, "image/png"))

            if slide_type == "cover":
                cover_underline_y = 805.0 if is_sq else 1007.0
                underline_svg = brush_underline(
                    x0=115.0, x1=697.0, y=cover_underline_y, t0=8.0, t1=17.0, rise=26.0,
                    seed=slide_seed, color=self.style_config.colors.accent,
                    canvas_width=c_width, canvas_height=c_height
                )
                loop_svg = dashed_loop(
                    seed=slide_seed,
                    canvas_width=c_width,
                    canvas_height=c_height
                )
            elif slide_type in ("point", "list", "chart", "table", "image", "statement", "compare"):
                underline_svg = brush_underline(
                    x0=0.0, x1=460.0, y=20.0, t0=7.0, t1=13.0, rise=12.0,
                    seed=slide_seed, color=self.style_config.colors.accent, absolute=False,
                    canvas_width=c_width, canvas_height=c_height
                )
            elif slide_type == "stat":
                underline_svg = brush_underline(
                    x0=0.0, x1=350.0, y=15.0, t0=6.0, t1=12.0, rise=10.0,
                    seed=slide_seed, color=self.style_config.colors.accent, absolute=False,
                    canvas_width=c_width, canvas_height=c_height
                )
            elif slide_type == "cta":
                cta_underline_y = 744.0 if is_sq else 930.0
                underline_svg = brush_underline(
                    x0=114.0, x1=650.0, y=cta_underline_y, t0=9.0, t1=16.0, rise=25.0,
                    seed=slide_seed, color=self.style_config.colors.accent,
                    canvas_width=c_width, canvas_height=c_height
                )
                loop_svg = dashed_loop(
                    seed=slide_seed + 100,
                    canvas_width=c_width,
                    canvas_height=c_height
                )

        counter_str = f"{slide_n:02d}/{total_slides:02d}"

        if asset_url:
            font_urls = {
                "league": asset_url("fonts", FONTS_DIR / "LeagueSpartan-Variable.ttf"),
                "inter": asset_url("fonts", FONTS_DIR / "Inter-Variable.ttf"),
                "montserrat": asset_url("fonts", FONTS_DIR / "Montserrat-Variable.ttf"),
            }
        else:
            font_urls = {"league": self.league_url, "inter": self.inter_url, "montserrat": self.montserrat_url}

        # Load base CSS and format with font/pattern data URLs
        with open(self.style_dir / "base.css", "r", encoding="utf-8") as f:
            base_css_template = f.read()
        css_vars = self.style_config.to_css_variables()
        base_css = (
            css_vars + "\n" +
            base_css_template
            .replace("{{ league_spartan_url }}", font_urls["league"])
            .replace("{{ inter_url }}", font_urls["inter"])
            .replace("{{ montserrat_url }}", font_urls["montserrat"])
            .replace("{{ paper_texture_url }}", texture_url)
            .replace("{{ grid_pattern_url }}", grid_pattern_url)
        )

        # A slide's own accent (spec decks) overrides the deck's colours for this slide only
        overrides = dict(self.color_overrides)
        overrides.update(clean_colors({"accent": slide.get("accent")}))
        chart_markup = ""
        if slide_type == "chart":
            from .charts import chart_svg
            colors = self.style_config.colors
            chart_markup = chart_svg(slide, {
                "accent": overrides.get("accent", colors.accent),
                "ink": colors.ink_black,
                "text": colors.body_ink,
                "bg": colors.background,
            }, width=self.style_config.layout.content_width, max_height=440 if is_sq else 700)

        table_ctx = _table_context(slide) if slide_type == "table" else {"columns": [], "rows": [], "numeric": [], "highlight": -1}
        from ..spec.imagefx import css_for, halftone_params, merge_styles
        image_style = self.image_style_for(slide) if slide_type == "image" else {}
        image_url = self._image_url(slide.get("image"), halftone_params(image_style)) if slide_type == "image" else ""
        fx = css_for(image_style,
                     overrides.get("accent", self.style_config.colors.accent), self.style_config.colors.ink_black)
        placeholder = (slide.get("image_prompt") or ("Search: " + slide["image_search"] if slide.get("image_search") else "")
                       or slide.get("alt") or slide.get("image_source") or "") if slide_type == "image" else ""

        # Render template HTML
        template_name = f"{slide_type}.html"
        template = self.jinja_env.get_template(template_name)

        html_content = template.render(
            brand=brand,
            headline=headline_text,
            main_words=main_words,
            pill_word=pill_word,
            body=slide.get("body", ""),
            number=slide.get("number", slide.get("stat_number", "")),
            author=slide.get("author", slide.get("quote_author", "")),
            items=slide.get("items", []),
            bullets=slide.get("bullets") or [],
            chart_svg=chart_markup,
            source_note=slide.get("source_note") or "",
            table=table_ctx,
            image_url=image_url,
            image_fit="contain" if slide.get("image_fit") == "contain" else "cover",
            fx=fx,
            placeholder=placeholder,
            alt=slide.get("alt") or "",
            counter=counter_str,
            base_css=base_css,
            underline_svg=underline_svg,
            loop_svg=loop_svg,
            arrow_svg=arrow_svg,
            left=slide.get("left") or {"label": "", "items": []},
            right=slide.get("right") or {"label": "", "items": []},
        )
        base = self.style_config.colors.model_dump()
        html_content = recolor_html(html_content, base, overrides)
        accent = overrides.get("accent", self.style_config.colors.accent)
        html_content = decorate_html(html_content, slide, accent)
        if theme in ("dark", "accent"):
            pal = {"background": base.get("background") or "#FFFFFF",
                   "ink": overrides.get("ink_black", self.style_config.colors.ink_black),
                   "body": overrides.get("body_ink", self.style_config.colors.body_ink),
                   "accent": accent, "warm": self.style_name == "beige_grain"}
            html_content = swap_colors(html_content, theme_palette(theme, pal))
            # paper grain stays visible on a coloured page
            html_content = html_content.replace("</style>", "body { background-blend-mode: multiply; }\n</style>", 1)
        return html_content

    def image_style_for(self, slide: Dict[str, Any]) -> Dict[str, Any]:
        """The slide's picture style on top of the app-wide look (brand.json image_defaults,
        black-and-white dots by default). Text is never on the picture: an old deck that says
        text_position "over" is shown with the text below."""
        from ..spec.imagefx import app_default_style, merge_styles
        own = dict(slide.get("image_style") or {})
        if "fit" not in own and slide.get("image_fit"):
            own["fit"] = slide["image_fit"]
        style = merge_styles(app_default_style(self.brand_image_defaults()), own)
        if style.get("text_position") not in ("above", "below"):
            style["text_position"] = "below"
        return style

    @staticmethod
    def brand_image_defaults() -> Dict[str, Any]:
        try:
            from ..settings import load_brand_config
            return load_brand_config().image_defaults
        except Exception:
            return {}

    def _image_url(self, ref: Optional[str], halftone: Optional[Dict[str, Any]] = None) -> str:
        """Data URL of an image slide's picture (a path inside the deck folder), or "" if missing.
        With `halftone` settings the picture is turned into black dots on white first."""
        if not ref:
            return ""
        p = Path(ref)
        if not p.is_absolute() and self.base_dir is not None and (self.base_dir / p).is_file():
            p = self.base_dir / p
        elif not p.is_file():
            # a bare file name typed in the editor: look in the deck folder and the app's images folder
            from ..spec.checks import resolve_image
            found = resolve_image(ref, [self.base_dir] if self.base_dir is not None else [])
            if found is None:
                return ""
            p = found
        if halftone is not None:
            try:
                from .halftone import halftone_png
                png = halftone_png(p, halftone.get("dot"), halftone.get("angle"))
                return "data:image/png;base64," + base64.b64encode(png).decode("ascii")
            except Exception:
                pass                                   # not a readable picture: show it as it is
        mime = {".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}.get(p.suffix.lower(), "image/jpeg")
        return _file_to_data_url(p, mime)

    def layout_steps(self, slide: Dict[str, Any]) -> List[Tuple[str, Optional[str]]]:
        """Auto-fit and anchoring scripts for this slide, in order, as (js, label) pairs.
        A step with a label must return {success: true}; otherwise the slide failed to fit.
        The last step applies the editor's per-element overrides, if any."""
        slide_type = slide.get("type", "point")
        is_sq = (self.canvas_format == "square")
        preset = CANVAS_FORMATS.get(self.canvas_format, CANVAS_FORMATS["portrait"])
        max_headline_h = preset["max_headline_h"]
        max_point_h = preset["max_point_h"]
        max_list_bottom_y = preset["max_list_bottom_y"]
        max_stat_h = preset["max_stat_h"]
        max_quote_h = preset["max_quote_h"]
        max_cta_h = preset["max_cta_h"]
        target_cover_anchor_y = preset["cover_anchor_y"].get(
            self.style_name,
            1120 if self.style_name == "grid_pill" else 932
        )
        target_cta_anchor_y = preset["cta_anchor_y"].get(self.style_name, 870)

        content_w = self.style_config.layout.content_width
        cover_w = max(content_w, 860)
        c_w_minus = 110 + cover_w  # the pill ends inside the headline column
        steps: List[Tuple[str, Optional[str]]] = []

        if slide_type == "cover":
            steps.append((f"fitText('.cover-headline', {cover_w}, {max_headline_h}, 72, 168)", "cover headline"))
            target_cap_top_y = 210 if is_sq else 295

            if self.style_name == "grid_pill":
                steps.append((f"""
                    () => {{
                        // A number pill ("₹52.66 crore") stays on one line within the content width
                        // The pill reads as the headline's last words: same size as the headline, never wider than the slide
                        const pillEl = document.querySelector('.accent-pill');
                        const headEl = document.querySelector('.cover-headline');
                        if (pillEl) {{
                            pillEl.style.whiteSpace = 'nowrap';
                            let fs = Math.min(parseFloat(window.getComputedStyle(pillEl).fontSize),
                                              headEl ? parseFloat(window.getComputedStyle(headEl).fontSize) : 168);
                            pillEl.style.fontSize = fs + 'px';
                            while (pillEl.getBoundingClientRect().right > {c_w_minus} && fs > 48) {{
                                fs -= 2;
                                pillEl.style.fontSize = fs + 'px';
                            }}
                        }}
                        const container = document.querySelector('.headline-container');
                        const h1 = document.querySelector('.cover-headline');
                        if (container && h1) {{
                            const rect = h1.getBoundingClientRect();
                            const diff = {target_cap_top_y} - rect.top;
                            const currentTop = parseFloat(window.getComputedStyle(container).top) || {target_cap_top_y};
                            container.style.top = (currentTop + diff) + 'px';
                        }}

                        const pill = document.querySelector('.accent-pill');
                        const loopPath = document.querySelector('.grid-dashed-loop path');
                        if (loopPath) {{
                            const pillRect = pill ? pill.getBoundingClientRect() : {{ right: 700 }};
                            const pr = Math.max(740, Math.round(pillRect.right) + 15);
                            const d = ({'true' if is_sq else 'false'}) ?
                                `M ${{pr}} 824 C ${{pr + 60}} 828, 860 828, 930 804 C 985 784, 1025 736, 1020 664 C 1015 592, 970 552, 920 555 C 865 560, 830 608, 835 672 C 840 728, 875 748, 915 752 C 960 756, 1000 772, 1080 776` :
                                `M ${{pr}} 1020 C ${{pr + 60}} 1025, 860 1025, 930 995 C 995 970, 1040 910, 1030 830 C 1020 750, 975 710, 920 720 C 865 730, 825 790, 830 860 C 835 920, 875 945, 920 950 C 965 955, 1010 970, 1080 975`;
                            loopPath.setAttribute('d', d);
                            // The doodle only goes where it touches no text
                            const lr = loopPath.getBoundingClientRect();
                            const boxes = [];
                            if (h1) {{
                                const range = document.createRange();
                                range.selectNodeContents(h1);
                                boxes.push(...range.getClientRects());
                            }}
                            if (pill) boxes.push(pill.getBoundingClientRect());
                            const hit = boxes.some((b) => b.right > lr.left - 12 && b.left < lr.right + 12
                                                       && b.bottom > lr.top - 12 && b.top < lr.bottom + 12);
                            if (hit) {{
                                const svg = loopPath.closest('svg');
                                if (svg) svg.style.display = 'none';
                            }}
                        }}
                    }}
                """, None))
            else:
                steps.append((f"""
                    () => {{
                        const anchor = document.getElementById('baseline-anchor');
                        const container = document.querySelector('.headline-container');
                        if (anchor && container) {{
                            const anchorBottom = anchor.getBoundingClientRect().bottom;
                            const currentTop = parseFloat(window.getComputedStyle(container).top) || 0;
                            container.style.top = (currentTop + ({target_cover_anchor_y} - anchorBottom)) + 'px';
                        }}
                    }}
                """, None))
        elif slide_type == "point":
            steps.append((f"fitText('.point-headline', {content_w}, 350, 48, 84)", "headline"))
            steps.append((f"fitText('.point-body', {content_w}, {max_point_h}, 26, 56)", "body"))
        elif slide_type == "list":
            steps.append((f"fitText('.list-headline', {content_w}, 350, 48, 84)", "headline"))
            steps.append((f"fitListItems('.items-list, .list-items', {max_list_bottom_y}, 52, 24)", "list items"))
        elif slide_type == "chart":
            steps.append((f"fitText('.chart-headline', {content_w}, 260, 48, 84)", "chart headline"))
            steps.append((f"fitText('.chart-body', {content_w}, 150, 26, 40)", None))
            # Shrink the chart (keeping its proportions) so it ends above the source note
            steps.append((f"""
                () => {{
                    const svg = document.querySelector('.chart-wrap svg');
                    if (!svg) return;
                    let top = svg.getBoundingClientRect().top;
                    let room = {max_list_bottom_y - 10} - top;
                    const h = svg.getBoundingClientRect().height;
                    // Labels must stay readable: give the chart room from the headline first
                    if (h * 0.9 > room) {{
                        fitText('.chart-headline', {content_w}, 180, 48, 84);
                        top = svg.getBoundingClientRect().top;
                        room = {max_list_bottom_y - 10} - top;
                    }}
                    if (h > room && room > 120) {{
                        svg.style.height = room + 'px';
                        svg.style.width = 'auto';
                    }}
                }}
            """, None))
        elif slide_type == "table":
            steps.append((f"fitText('.table-headline', {content_w}, 260, 48, 84)", "table headline"))
            if slide.get("body"):
                steps.append((f"fitText('.table-body', {content_w}, 140, 24, 38)", "table intro"))
            # Largest table text (40px down to 20px) that ends above the source note and fits the width
            steps.append((f"""
                () => {{
                    const t = document.querySelector('.data-table');
                    if (!t) return {{ success: true }};
                    const src = document.querySelector('.table-source');
                    const limit = (src ? src.getBoundingClientRect().top - 24 : {max_list_bottom_y});
                    for (let fs = 40; fs >= 20; fs--) {{
                        t.style.fontSize = fs + 'px';
                        if (t.getBoundingClientRect().bottom <= limit && t.scrollWidth <= {content_w} + 1) {{
                            return {{ success: true, fontSize: fs }};
                        }}
                    }}
                    return {{ success: false, reason: `the table does not fit even at 20px text (ends at y=${{Math.round(t.getBoundingClientRect().bottom)}}, limit ${{Math.round(limit)}})` }};
                }}
            """, "table"))
        elif slide_type == "image":
            if slide.get("headline"):
                steps.append((f"fitText('.image-headline', {content_w}, 240, 44, 84)", "image headline"))
            above = self.image_style_for(slide).get("text_position") == "above"
            if slide.get("body"):
                steps.append((f"fitText('.image-caption', {content_w}, 130, 24, 36)", "image caption"))
            # The picture takes the room left between the headline and the caption
            steps.append((f"""
                () => {{
                    const frame = document.querySelector('.image-frame');
                    if (!frame) return {{ success: true }};
                    // text above the picture already pushes the frame down, so only text below takes room from it
                    const above = {'true' if above else 'false'};
                    const cap = document.querySelector('.image-caption');
                    const capH = cap && !above ? cap.getBoundingClientRect().height + 28 : 0;
                    const src = document.querySelector('.slide-source');
                    const bottom = Math.min({max_list_bottom_y}, src ? src.getBoundingClientRect().top - 24 : 1e9);
                    // bullets under the picture shrink (down to 28px) until the picture keeps at least 340px
                    const bul = document.querySelector('.image-bullets');
                    let bulFs = bul ? Math.round(parseFloat(getComputedStyle(bul).fontSize)) : 0;
                    const bulH = () => (bul && !above ? bul.getBoundingClientRect().height + 24 : 0);
                    while (bul && bulFs > 28 && bottom - frame.getBoundingClientRect().top - capH - bulH() < 340) {{
                        bulFs -= 1;
                        bul.style.fontSize = bulFs + 'px';
                    }}
                    const h = bottom - frame.getBoundingClientRect().top - capH - bulH();
                    if (h < 260) return {{ success: false, reason: `only ${{Math.round(h)}}px are left for the picture; shorten the headline or caption` }};
                    frame.style.height = Math.floor(h) + 'px';
                    return {{ success: true }};
                }}
            """, "image"))
        elif slide_type == "stat":
            steps.append((f"fitText('.stat-number', {content_w}, 300, 80, 220)", None))
            steps.append((f"fitText('.stat-body', {content_w}, {max_stat_h}, 26, 48)", None))
        elif slide_type == "quote":
            steps.append((f"fitText('.quote-body', {content_w}, {max_quote_h}, 32, 72)", None))
        elif slide_type == "statement":
            has_body = bool(slide.get("body"))
            head_h = (460 if is_sq else 600) if has_body else (640 if is_sq else 820)
            steps.append((f"fitText('.statement-headline', {content_w}, {head_h}, 56, 150)", "statement"))
            if has_body:
                steps.append((f"fitText('.statement-body', {content_w}, {200 if is_sq else 260}, 26, 46)", "statement text"))
        elif slide_type == "compare":
            if slide.get("headline"):
                steps.append((f"fitText('.compare-headline', {content_w}, 260, 44, 84)", "compare headline"))
            steps.append((f"""
                () => {{
                    const grid = document.querySelector('.compare-grid');
                    if (!grid) return {{ success: true }};
                    const src = document.querySelector('.slide-source');
                    const foot = document.querySelector('.footer-row');
                    const limit = Math.min(src ? src.getBoundingClientRect().top - 30 : 1e9,
                                           foot ? foot.getBoundingClientRect().top - 40 : 1e9);
                    const wide = () => [...grid.querySelectorAll('.compare-item span:last-child, .compare-label')]
                        .some((e) => e.scrollWidth > e.clientWidth + 2);
                    for (let fs = 40; fs >= 22; fs--) {{
                        grid.style.fontSize = fs + 'px';
                        if (grid.getBoundingClientRect().bottom <= limit && !wide()) return {{ success: true, fontSize: fs }};
                    }}
                    return {{ success: false, reason: `the two columns do not fit even at 22px text; use fewer or shorter points` }};
                }}
            """, "comparison"))
        elif slide_type == "cta":
            steps.append((f"fitText('.cta-headline', {cover_w}, {max_cta_h}, 56, 120)", "CTA headline"))
            steps.append((f"""
                () => {{
                    const anchor = document.getElementById('cta-baseline-anchor') || document.getElementById('baseline-anchor');
                    const container = document.querySelector('.cta-container') || document.querySelector('.headline-container');
                    if (anchor && container) {{
                        const anchorBottom = anchor.getBoundingClientRect().bottom;
                        const currentTop = parseFloat(window.getComputedStyle(container).top) || 0;
                        container.style.top = (currentTop + ({target_cta_anchor_y} - anchorBottom)) + 'px';
                    }}
                }}
            """, None))

        if slide.get("source_note") and slide_type in SOURCE_SHRINK:
            # Text shrinks (never grows) until the content ends above the source line
            sel, min_px = SOURCE_SHRINK[slide_type]
            steps.append((f"""
                () => {{
                    const src = document.querySelector('.slide-source');
                    const box = document.querySelector('.content-container');
                    const els = [...document.querySelectorAll('{sel}')];
                    if (!src || !box || !els.length) return {{ success: true }};
                    const limit = src.getBoundingClientRect().top - 24;
                    const bottom = () => Math.max(...[...box.querySelectorAll('*')].map((e) => e.getBoundingClientRect().bottom));
                    let fs = Math.round(parseFloat(getComputedStyle(els[0]).fontSize));
                    while (bottom() > limit && fs > {min_px}) {{
                        fs -= 1;
                        els.forEach((e) => {{ e.style.fontSize = fs + 'px'; }});
                    }}
                    return bottom() <= limit ? {{ success: true }}
                        : {{ success: false, reason: `the text still runs into the source line at ${{fs}}px` }};
                }}
            """, "text above the source line"))

        align = slide.get("align") or DEFAULT_ALIGN.get(slide_type, "top")
        if slide_type in BALANCED_TYPES and align in ("center", "bottom"):
            # Move the whole block down into the free space between the header and the source line / footer
            steps.append((f"""
                () => {{
                    const box = document.querySelector('.content-container');
                    if (!box) return;
                    const foot = document.querySelector('.footer-row');
                    const src = [...document.querySelectorAll('.slide-source, .chart-source, .table-source')]
                        .find((e) => !box.contains(e));
                    const limit = Math.min(foot ? foot.getBoundingClientRect().top - 50 : window.innerHeight,
                                           src ? src.getBoundingClientRect().top - 40 : 1e9);
                    const kids = [...box.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0);
                    if (!kids.length) return;
                    const bottom = Math.max(...kids.map((e) => e.getBoundingClientRect().bottom));
                    const free = limit - bottom;
                    if (free < 24) return;
                    const shift = {'0.5' if align == 'center' else '1'} * free;
                    box.style.top = (parseFloat(getComputedStyle(box).top) + shift) + 'px';
                }}
            """, None))

        ov_call = overrides_call(slide)
        if ov_call:
            steps.append((ov_call, None))
        return steps

    def editor_html(self, slide: Dict[str, Any], brand: Dict[str, Any], total_slides: int, seed: int, asset_url) -> str:
        """The slide page for the editor canvas: same HTML and layout steps as the PNG render,
        plus a window.__runLayout() the editor calls once the page has loaded."""
        html = self.build_slide_html(slide, brand, total_slides, seed, asset_url=asset_url)
        steps = [js for js, _ in self.layout_steps(slide)]
        roles = ROLE_SELECTORS.get(slide.get("type", "point"), {})
        script = (
            "<script>\n" + FIT_TEXT_JS + "\n" + APPLY_OVERRIDES_JS + "\n"
            "window.__roles = " + json.dumps(roles) + ";\n"
            "window.__layoutSteps = " + json.dumps(steps) + ";\n"
            "window.__runLayout = async function() {\n"
            "  await document.fonts.ready;\n"
            "  for (const s of window.__layoutSteps) { const r = (0, eval)(s); if (typeof r === 'function') r(); }\n"
            "  window.applyOverrides(window.__roles, {});\n"
            "  return true;\n"
            "};\n"
            "</script>\n"
        )
        return html.replace("</body>", script + "</body>") if "</body>" in html else html + script

    def render_slide(
        self,
        slide: Dict[str, Any],
        brand: Dict[str, Any],
        total_slides: int,
        seed: int,
        out_path: Path,
        page=None
    ) -> Path:
        """Render a single slide to PNG."""
        slide_n = slide.get("n", 1)
        html_content = self.build_slide_html(slide, brand, total_slides, seed)

        close_browser = False
        if page is None:
            from playwright.sync_api import sync_playwright
            playwright = sync_playwright().start()
            browser = playwright.chromium.launch(**browser_launch_options())
            page = browser.new_page(
                viewport={"width": self.style_config.canvas.width, "height": self.style_config.canvas.height},
                device_scale_factor=1
            )
            close_browser = True

        try:
            page.set_content(html_content, wait_until="networkidle")
            page.evaluate("document.fonts.ready")

            # Run auto-fit, then the editor's overrides (last step, when the slide has any)
            page.evaluate(FIT_TEXT_JS)
            page.evaluate(APPLY_OVERRIDES_JS)
            problems: List[str] = []
            for js, label in self.layout_steps(slide):
                res = page.evaluate(js)
                if label and res and not res.get("success"):
                    msg = f"The {label} does not fit: {res.get('reason')}"
                    if not self.collect_fit:
                        raise RuntimeError(f"Slide {slide_n} {label} failed to fit: {res.get('reason')}")
                    problems.append(msg)
            if self.collect_fit:
                problems += [p for p in (page.evaluate(FIT_PROBE_JS) or []) if p not in problems]
                self.fit_report.append({"n": slide_n, "type": slide.get("type"), "ok": not problems, "problems": problems})

            out_path.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(out_path), full_page=False)

        finally:
            if close_browser:
                browser.close()
                playwright.stop()

        return out_path

    def render_deck(self, slides_data: Dict[str, Any], out_dir: Path) -> List[Path]:
        """Render all slides from slides_data dict into out_dir."""
        from playwright.sync_api import sync_playwright

        if "canvas_format" in slides_data and slides_data["canvas_format"] != self.canvas_format:
            self.canvas_format = slides_data["canvas_format"]
            self.style_config = load_style_config(self.style_name, format_name=self.canvas_format)

        if "colors" in slides_data:
            self.color_overrides = clean_colors(slides_data.get("colors"))

        slides = slides_data.get("slides", [])
        brand = slides_data.get("brand", {})
        seed = slides_data.get("seed", 20261017)
        total_slides = len(slides)
        if self.base_dir is None:
            self.base_dir = Path(out_dir)
        self.fit_report = []

        rendered_paths: List[Path] = []

        report("Starting Chromium for rendering...")
        with sync_playwright() as p:
            browser = p.chromium.launch(**browser_launch_options())
            page = browser.new_page(
                viewport={"width": self.style_config.canvas.width, "height": self.style_config.canvas.height},
                device_scale_factor=1
            )

            for idx, slide in enumerate(slides, start=1):
                report(f"Rendering slide {idx} of {total_slides} ({slide.get('type', 'slide')})...")
                out_path = out_dir / f"slide_{idx:02d}.png"
                self.render_slide(slide, brand, total_slides, seed, out_path, page=page)
                rendered_paths.append(out_path)

            browser.close()

        # Build contact sheet
        self.build_contact_sheet(rendered_paths, out_dir / "contact_sheet.png")

        return rendered_paths

    def build_contact_sheet(self, image_paths: List[Path], out_file: Path) -> Path:
        """Create a 3-column contact sheet grid of slide thumbnails."""
        if not image_paths:
            return out_file

        cols = min(3, len(image_paths))
        rows = math.ceil(len(image_paths) / cols)

        thumb_w = 360
        thumb_h = 450
        for p in image_paths:
            if p.exists():
                with Image.open(p) as im:
                    thumb_h = int(round(thumb_w * (im.height / im.width)))
                break

        padding = 24
        header_space = 40

        sheet_w = cols * thumb_w + (cols + 1) * padding
        sheet_h = rows * thumb_h + (rows + 1) * padding + (rows * header_space)

        sheet = Image.new("RGB", (sheet_w, sheet_h), (240, 240, 240))
        draw = ImageDraw.Draw(sheet)

        for i, img_path in enumerate(image_paths):
            if not img_path.exists():
                continue
            r = i // cols
            c = i % cols

            x = padding + c * (thumb_w + padding)
            y = padding + r * (thumb_h + padding + header_space)

            draw.text((x + 4, y), f"Slide {i+1:02d}", fill=(40, 40, 40))

            with Image.open(img_path) as im:
                thumb = im.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                sheet.paste(thumb, (x, y + 24))

        sheet.save(out_file, format="PNG")
        return out_file


def make_contact_sheet(image_paths: List[Path], out_file: Path) -> Path:
    """Create a contact sheet grid of slide thumbnails."""
    return SlideRenderer().build_contact_sheet(image_paths, out_file)
