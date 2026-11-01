"""Per-element position, size and text-style overrides from the deck editor.

A slide may carry an optional ``overrides`` map, keyed by element role:

    "overrides": {
        "headline": {"x": 110, "y": 300, "w": 860, "h": 240,
                     "font_family": "Inter", "font_size": 72, "font_weight": 700,
                     "color": "#000000", "line_height": 1.1, "text_align": "center"},
        "chart": {"x": 110, "y": 600, "w": 860, "h": 500}
    }

Every field is optional; a slide without ``overrides`` renders exactly as before. The renderer
lays the slide out as usual (auto-fit included), then APPLY_OVERRIDES_JS applies the styles and
lifts each positioned element out of the flow onto the canvas at x/y with size w/h, leaving a
same-size placeholder behind so the other elements stay where they were. A moved text box with
no explicit font size shrinks (never grows) until its text fits the box.

A deck may also carry ``colors`` ({"accent": "#...", "ink_black": "#...", "body_ink": "#..."}):
the style's own hex values are swapped for these in the rendered page.
"""

import json
import re
from typing import Any, Dict, Optional

# Element roles the editor can select, per slide type. Selectors cover both style packs.
ROLE_SELECTORS: Dict[str, Dict[str, str]] = {
    "cover": {
        "headline": ".headline-container",
    },
    "point": {
        "headline": ".point-headline",
        "accent_bar": ".accent-bar",
        "body": ".point-body",
        "source_note": ".slide-source",
    },
    "list": {
        "headline": ".list-headline",
        "accent_bar": ".accent-bar",
        "items": ".items-list, .list-items",
        "source_note": ".slide-source",
    },
    "stat": {
        "headline": ".stat-headline",
        "number": ".stat-number",
        "accent_bar": ".accent-bar",
        "body": ".stat-body",
        "source_note": ".slide-source",
    },
    "quote": {
        "quote_mark": ".quote-mark",
        "body": ".quote-body",
        "author": ".author-wrapper, .quote-author",
        "source_note": ".slide-source",
    },
    "chart": {
        "headline": ".chart-headline",
        "accent_bar": ".accent-bar",
        "body": ".chart-body",
        "chart": ".chart-wrap",
        "source_note": ".chart-source",
    },
    "table": {
        "headline": ".table-headline",
        "accent_bar": ".accent-bar",
        "body": ".table-body",
        "chart": ".data-table",
        "source_note": ".table-source",
    },
    "image": {
        "headline": ".image-headline",
        "accent_bar": ".accent-bar",
        "chart": ".image-frame",
        "body": ".image-caption",
        "items": ".image-bullets",
        "source_note": ".slide-source",
    },
    "cta": {
        "headline": ".cta-headline",
        "pill": ".cta-pill-wrapper, .cta-handle",
    },
}

GEOMETRY_KEYS = ("x", "y", "w", "h")
STYLE_KEYS = ("font_family", "font_size", "font_weight", "color", "line_height", "text_align")
TEXT_ALIGNS = ("left", "center", "right", "justify")
EDITABLE_COLORS = ("accent", "ink_black", "body_ink")

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_FONT = re.compile(r"^[A-Za-z0-9 _-]{1,40}$")


def _num(v: Any, lo: float, hi: float) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f < lo or f > hi:
        return None
    return round(f, 2)


def clean_overrides(raw: Any, slide_type: str) -> Dict[str, Dict[str, Any]]:
    """Keep only known roles and well-formed values, so a hand-edited slides.json cannot inject CSS."""
    if not isinstance(raw, dict):
        return {}
    roles = ROLE_SELECTORS.get(slide_type, {})
    out: Dict[str, Dict[str, Any]] = {}
    for role, ov in raw.items():
        if role not in roles or not isinstance(ov, dict):
            continue
        item: Dict[str, Any] = {}
        for k in GEOMETRY_KEYS:
            if k in ov:
                v = _num(ov[k], -2000, 4000) if k in ("x", "y") else _num(ov[k], 4, 4000)
                if v is not None:
                    item[k] = v
        # A position needs both coordinates; a size needs a position
        if not ("x" in item and "y" in item):
            for k in GEOMETRY_KEYS:
                item.pop(k, None)
        if "font_size" in ov:
            v = _num(ov["font_size"], 6, 400)
            if v is not None:
                item["font_size"] = v
        if "font_weight" in ov:
            v = _num(ov["font_weight"], 100, 900)
            if v is not None:
                item["font_weight"] = int(v)
        if "line_height" in ov:
            v = _num(ov["line_height"], 0.5, 3)
            if v is not None:
                item["line_height"] = v
        if isinstance(ov.get("color"), str) and _HEX.match(ov["color"]):
            item["color"] = ov["color"]
        if isinstance(ov.get("font_family"), str) and _FONT.match(ov["font_family"]):
            item["font_family"] = ov["font_family"]
        if ov.get("text_align") in TEXT_ALIGNS:
            item["text_align"] = ov["text_align"]
        if item:
            out[role] = item
    return out


def clean_colors(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if k in EDITABLE_COLORS and isinstance(v, str) and _HEX.match(v)}


def recolor_html(html: str, base_colors: Dict[str, str], new_colors: Dict[str, str]) -> str:
    """Swap the style's own hex colours for the deck's brand colours (case-insensitive)."""
    for key, new in clean_colors(new_colors).items():
        old = base_colors.get(key)
        if old and _HEX.match(old) and old.lower() != new.lower():
            html = re.sub(re.escape(old), new, html, flags=re.I)
    return html


APPLY_OVERRIDES_JS = r"""
window.applyOverrides = function(roles, ov) {
    const els = {};
    for (const role in roles) {
        const el = document.querySelector(roles[role]);
        if (el) { el.setAttribute('data-role', role); els[role] = el; }
    }
    // 1. Text styles first, so the natural layout reflects them
    for (const role in ov) {
        const el = els[role], o = ov[role];
        if (!el) continue;
        for (const t of window.textTargets(el)) {
            if (o.font_family) t.style.fontFamily = "'" + o.font_family + "', sans-serif";
            if (o.font_size) t.style.fontSize = o.font_size + 'px';
            if (o.font_weight) t.style.fontWeight = o.font_weight;
            if (o.color) t.style.color = o.color;
            if (o.line_height) t.style.lineHeight = o.line_height;
            if (o.text_align) t.style.textAlign = o.text_align;
        }
    }
    // 2. Measure everything before anything moves
    const rects = {};
    for (const role in els) rects[role] = els[role].getBoundingClientRect();
    // 3. Lift positioned elements onto the canvas, leaving a placeholder in the flow
    for (const role in ov) {
        const el = els[role], o = ov[role];
        if (!el || o.x === undefined || o.y === undefined) continue;
        window.placeElement(el, rects[role], o);
    }
    return { success: true, roles: Object.keys(els) };
};

// Container roles (cover headline block, list, author block) style the text children that carry their own CSS
window.textTargets = function(el) {
    const kids = el.querySelectorAll('.cover-headline, .item-text, .list-text, .author-pill');
    return kids.length ? Array.from(kids) : [el];
};

window.placeElement = function(el, rect, o) {
    if (!el.dataset.placed) {
        const cs = window.getComputedStyle(el);
        const ph = document.createElement('div');
        ph.className = 'ov-placeholder';
        ph.style.width = rect.width + 'px';
        ph.style.height = rect.height + 'px';
        ph.style.flex = 'none';
        ph.style.marginTop = cs.marginTop;
        ph.style.marginBottom = cs.marginBottom;
        el.parentNode.insertBefore(ph, el);
        // Keep the box model of the original (flex column containers stretch block children)
        if (cs.display === 'inline') el.style.display = 'inline-block';
        document.body.appendChild(el);
        el.dataset.placed = '1';
    }
    el.style.position = 'absolute';
    el.style.margin = '0';
    el.style.zIndex = '6';
    el.style.left = o.x + 'px';
    el.style.top = o.y + 'px';
    el.style.width = (o.w || rect.width) + 'px';
    if (el.dataset.role === 'chart') {
        const h = o.h || rect.height;
        el.style.height = h + 'px';
        const svg = el.querySelector('svg');
        if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; svg.style.maxWidth = 'none'; }
        return;
    }
    if (o.h) {
        el.style.height = o.h + 'px';
        el.style.overflow = 'visible';
        if (!o.font_size) {
            // Shrink (never grow) until the text fits its box
            const targets = window.textTargets(el);
            let fs = parseFloat(window.getComputedStyle(targets[0]).fontSize) || 40;
            while ((el.scrollHeight > o.h + 1 || el.scrollWidth > (o.w || rect.width) + 1) && fs > 14) {
                fs -= 1;
                for (const t of targets) t.style.fontSize = fs + 'px';
            }
        }
    }
};
// Evaluates to true, not to the last function: Playwright calls a string that evaluates to a function
true;
"""


def overrides_call(slide: Dict[str, Any]) -> Optional[str]:
    """The JS expression that applies this slide's overrides, or None when it has none."""
    s_type = slide.get("type", "point")
    ov = clean_overrides(slide.get("overrides"), s_type)
    if not ov:
        return None
    roles = ROLE_SELECTORS.get(s_type, {})
    return f"applyOverrides({json.dumps(roles)}, {json.dumps(ov)})"
