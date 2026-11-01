"""Picture treatments for image slides: filters, focus point, tint, overlay, corners, border.

A spec writes them as plain fields (or `image_*` defaults in its header):

    filter: grayscale, contrast 120%      focus: top left        overlay: 40%
    duotone: accent                       tint: blue 30%         rounded: large
    border: thick accent                  text_position: over    fit: contain

parse_image_style() turns those into one style dict (stored as slide["image_style"]), and
css_for() turns a style into the CSS the slide templates use. Presets (grayscale, sepia, warm,
cool, vivid, faded, ...) are stored by name, so the editor can offer them in a menu.
"""

import difflib
import re
from typing import Any, Dict, List, Optional, Tuple

from ..render.halftone import MAX_DOT, MIN_DOT

# Named looks -> CSS filter amounts (see FILTER_ORDER for what the keys mean)
PRESETS: Dict[str, Dict[str, float]] = {
    "grayscale": {"grayscale": 1.0},
    "sepia": {"sepia": 0.85},
    "warm": {"sepia": 0.25, "saturate": 1.15, "brightness": 1.03},
    "cool": {"hue": 12.0, "saturate": 0.95, "brightness": 1.03},
    "vivid": {"saturate": 1.4, "contrast": 1.08},
    "faded": {"saturate": 0.7, "contrast": 0.9, "brightness": 1.08},
    "high_contrast": {"contrast": 1.35},
    "moody": {"brightness": 0.82, "contrast": 1.15, "saturate": 0.9},
    "bright": {"brightness": 1.15, "saturate": 1.05},
    "vintage": {"sepia": 0.45, "contrast": 0.95, "saturate": 0.85, "brightness": 1.03},
    "soft": {"blur": 2.5, "brightness": 1.04},
    "blur": {"blur": 6.0},
    "halftone": {"grayscale": 1.0},     # the dots themselves are made by render/halftone.py
}
PRESET_ALIASES = {
    "bw": "grayscale", "b_and_w": "grayscale", "black_and_white": "grayscale", "black_white": "grayscale",
    "greyscale": "grayscale", "gray": "grayscale", "grey": "grayscale", "monochrome": "grayscale", "mono": "grayscale",
    "retro": "vintage", "old": "vintage", "dark": "moody", "dim": "moody", "muted": "faded", "washed": "faded",
    "pop": "vivid", "saturated": "vivid", "contrast": "high_contrast", "highcontrast": "high_contrast",
    "light": "bright", "warmer": "warm", "cooler": "cool", "dreamy": "soft",
    "dots": "halftone", "dotted": "halftone", "dot": "halftone", "stipple": "halftone", "dither": "halftone",
    "bw_halftone": "halftone", "bw_dots": "halftone", "bw_dotted": "halftone", "black_and_white_dots": "halftone",
    "black_and_white_halftone": "halftone", "bw_and_dots": "halftone", "bw_dotted_filter": "halftone",
}
NUMERIC = {  # field -> (css name, low, high)
    "brightness": ("brightness", 0.2, 2.5), "contrast": ("contrast", 0.2, 2.5),
    "saturation": ("saturate", 0.0, 3.0), "saturate": ("saturate", 0.0, 3.0),
    "grayscale": ("grayscale", 0.0, 1.0), "greyscale": ("grayscale", 0.0, 1.0),
    "sepia": ("sepia", 0.0, 1.0), "blur": ("blur", 0.0, 30.0), "hue": ("hue", -180.0, 180.0),
}
NUMERIC_DEFAULT = {"grayscale": 1.0, "greyscale": 1.0, "sepia": 0.85, "blur": 6.0}
FILTER_ORDER = ("grayscale", "sepia", "hue", "saturate", "brightness", "contrast", "blur")
ROUNDED = {"none": 0, "square": 0, "small": 12, "medium": 28, "large": 48, "round": 9999, "circle": 9999, "pill": 9999}
BORDER_WIDTHS = {"none": 0, "thin": 3, "medium": 6, "thick": 10, "heavy": 16}
FOCUS_WORDS = {"center", "centre", "top", "bottom", "left", "right", "middle"}
TEXT_POSITIONS = {"below": "below", "under": "below", "beneath": "below", "after": "below", "bottom": "below",
                  "above": "above", "above_the_picture": "above", "above_the_image": "above", "above_picture": "above",
                  "below_the_picture": "below", "below_the_image": "below", "under_the_picture": "below", "under_the_image": "below", "before": "above", "top": "above",
                  "over": "over", "on": "over", "overlay": "over", "inside": "over", "on_image": "over",
                  "on_picture": "over", "on_the_picture": "over", "on_the_image": "over", "over_the_picture": "over",
                  "over_the_image": "over", "on_top": "over"}
FIT_VALUES = {"cover": "cover", "fill": "cover", "crop": "cover", "contain": "contain", "fit": "contain", "whole": "contain"}

STYLE_FIELDS = ("fit", "focus", "filter", "brightness", "contrast", "saturation", "saturate", "grayscale",
                "greyscale", "sepia", "blur", "hue", "tint", "duotone", "overlay", "rounded", "border", "text_position",
                "dot_size", "dot_angle")

Problem = Tuple[str, str, str]  # (code, message, field)


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.strip().lower().replace("&", " and ")).strip("_")


def _number(token: str) -> Optional[float]:
    m = re.match(r"^\s*([-+]?\d+(?:\.\d+)?)\s*(%|px|deg|°)?\s*$", token or "", re.I)
    if not m:
        return None
    v = float(m.group(1))
    return v / 100.0 if m.group(2) == "%" else v


def _amount(name: str, token: str) -> Optional[float]:
    """A filter amount: '120%', '1.2' or a bare 120 (percent when large) for the unit-less filters."""
    css, lo, hi = NUMERIC[name]
    v = _number(token)
    if v is None:
        return None
    raw_has_pct = "%" in token
    if css in ("brightness", "contrast", "saturate", "grayscale", "sepia") and not raw_has_pct and v > 3:
        v = v / 100.0
    return max(lo, min(hi, v))


def _color(token: str) -> Optional[str]:
    from .parser import _norm_color
    t = (token or "").strip().lower()
    if t in ("accent", "ink"):
        return t
    return _norm_color(t)


def _suggest(word: str, options) -> str:
    close = difflib.get_close_matches(_key(word), list(options), n=1, cutoff=0.6)
    return f" Did you mean '{close[0].replace('_', ' ')}'?" if close else ""


def _split_tokens(value: str) -> List[str]:
    return [t.strip() for t in re.split(r"\s*[,;+|]\s*", value or "") if t.strip()]


def _parse_filter(value: str, style: Dict[str, Any], problems: List[Problem], field: str) -> None:
    presets: List[str] = []
    adjust: Dict[str, float] = dict(style.get("adjust") or {})
    for tok in _split_tokens(value):
        m = re.match(r"^([A-Za-z_ &-]+?)\s*[:=]?\s*([-+]?\d[\d.]*\s*(?:%|px|deg|°)?)?$", tok)
        if not m:
            problems.append(("FILTER_UNKNOWN", f"Could not read the filter '{tok}'; ignored.", field))
            continue
        raw_name, amount = _key(m.group(1)), (m.group(2) or "").strip()
        if amount and raw_name in NUMERIC:                    # "contrast 120%", "blur 4px", "grayscale 60%"
            v = _amount(raw_name, amount)
            if v is None:
                problems.append(("FILTER_VALUE", f"'{tok}': '{amount}' is not a number like 120% or 1.2; ignored.", field))
            else:
                adjust[NUMERIC[raw_name][0]] = v
            continue
        name = PRESET_ALIASES.get(raw_name, raw_name)         # a named look, "bw", "retro", plain "sepia"
        if name in ("none", "off", "no", "original", "normal"):
            presets, adjust = [], {}
            style["_cleared"] = True
            continue
        if name == "duotone":
            style["duotone"] = style.get("duotone") or "accent"
            continue
        if name in PRESETS:
            if name not in presets:
                presets.append(name)
            continue
        if name in NUMERIC:
            problems.append(("FILTER_VALUE", f"'{tok}' needs an amount, like '{name} 120%'; ignored.", field))
            continue
        problems.append(("FILTER_UNKNOWN", f"Unknown filter '{tok}'; ignored." + _suggest(name, list(PRESETS) + list(NUMERIC) + list(PRESET_ALIASES)),
                         field))
    style["filter"] = presets
    if adjust:
        style["adjust"] = adjust


def parse_image_style(raw: Dict[str, str]) -> Tuple[Dict[str, Any], List[Problem]]:
    """Image fields (as written) -> (style dict, problems). Only fields that are present appear in
    the style; `filter: none` yields filter == [] so it can switch off a header default."""
    style: Dict[str, Any] = {}
    problems: List[Problem] = []
    for key in STYLE_FIELDS:
        v = (raw.get(key) or "").strip()
        if not v:
            continue
        k = _key(v)
        if key == "fit":
            fit = FIT_VALUES.get(k)
            if fit:
                style["fit"] = fit
            else:
                problems.append(("FIT_UNKNOWN", f"fit: '{v}' is not cover or contain; using cover.", "fit"))
        elif key == "focus":
            f = _focus(v)
            if f:
                style["focus"] = f
            else:
                problems.append(("FOCUS_UNKNOWN", f"focus: '{v}' is not a position like 'top', 'bottom left' or '30% 20%'; centred instead.", "focus"))
        elif key == "filter":
            _parse_filter(v, style, problems, "filter")
        elif key in NUMERIC:
            amount = _amount(key, v) if _number(v) is not None else None
            if amount is None and k in ("none", "off", "no"):
                amount = 0.0 if key not in ("brightness", "contrast", "saturation", "saturate") else 1.0
            if amount is None:
                problems.append(("FILTER_VALUE", f"{key}: '{v}' is not a number like 120% or 1.2; ignored.", key))
            else:
                adjust = dict(style.get("adjust") or {})
                adjust[NUMERIC[key][0]] = amount
                style["adjust"] = adjust
        elif key == "duotone":
            if k in ("none", "off", "no"):
                style["duotone"] = ""
            else:
                c = _color(v) if k != "true" and k != "yes" else "accent"
                if c:
                    style["duotone"] = c
                else:
                    problems.append(("COLOR_UNKNOWN", f"duotone: '{v}' is not a colour; use accent, a name like blue, or #RRGGBB.", "duotone"))
        elif key == "tint":
            if k in ("none", "off", "no"):
                style["tint"] = {}
                continue
            parts = v.split()
            strength = 0.35
            colour = None
            for part in parts:
                n = _number(part)
                if n is not None:
                    strength = max(0.05, min(0.9, n if "%" in part or n <= 1 else n / 100.0))
                else:
                    colour = _color(part) or colour
            if colour:
                style["tint"] = {"color": colour, "strength": strength}
            else:
                problems.append(("COLOR_UNKNOWN", f"tint: '{v}' has no colour; use accent, a name like blue, or #RRGGBB (and an optional 30%).", "tint"))
        elif key == "overlay":
            if k in ("none", "off", "no"):
                style["overlay"] = 0.0
                continue
            n = _number(v)
            if n is None:
                problems.append(("OVERLAY_VALUE", f"overlay: '{v}' is not a percentage like 40%; ignored.", "overlay"))
            else:
                style["overlay"] = max(0.0, min(0.9, n if "%" in v or n <= 1 else n / 100.0))
        elif key == "rounded":
            if k in ROUNDED:
                style["rounded"] = ROUNDED[k]
            else:
                n = _number(v)
                if n is None or "%" in v:
                    problems.append(("ROUNDED_UNKNOWN", f"rounded: '{v}' is not none, small, medium, large, circle or a size like 24px; ignored.", "rounded"))
                else:
                    style["rounded"] = int(max(0, min(200, n)))
        elif key == "border":
            b = _border(v)
            if b is None:
                problems.append(("BORDER_UNKNOWN", f"border: '{v}' is not like 'none', 'thick', '6px #ffffff' or 'thin accent'; ignored.", "border"))
            else:
                style["border"] = b
        elif key == "text_position":
            pos = TEXT_POSITIONS.get(k)
            if pos == "over":
                style["text_position"] = "below"
                problems.append(("TEXT_OVER_IMAGE", "Text is never placed on the picture; it goes below it. Use text_position: above to put it above.",
                                 "text_position"))
            elif pos:
                style["text_position"] = pos
            else:
                problems.append(("TEXT_POSITION_UNKNOWN", f"text_position: '{v}' is not below or above; below is used.", "text_position"))
        elif key == "dot_size":
            n = _number(v)
            if n is None or "%" in v:
                problems.append(("DOT_SIZE", f"dot_size: '{v}' is not a number of pixels like 18; ignored.", "dot_size"))
            else:
                style["dot_size"] = int(max(MIN_DOT, min(MAX_DOT, n)))
        elif key == "dot_angle":
            n = _number(v)
            if n is None or "%" in v:
                problems.append(("DOT_ANGLE", f"dot_angle: '{v}' is not an angle like 0 or 45; ignored.", "dot_angle"))
            else:
                style["dot_angle"] = float(n) % 90
    cleared = style.pop("_cleared", False)
    if cleared and not style.get("filter"):
        style["filter"] = []
    return style, problems


def _focus(v: str) -> Optional[str]:
    t = v.strip().lower().replace(",", " ")
    words = t.split()
    if words and all(w in FOCUS_WORDS for w in words) and len(words) <= 2:
        return " ".join("center" if w in ("centre", "middle") else w for w in words)
    m = re.match(r"^(\d{1,3}(?:\.\d+)?)\s*%?\s+(\d{1,3}(?:\.\d+)?)\s*%?$", t)
    if m and float(m.group(1)) <= 100 and float(m.group(2)) <= 100:
        return f"{m.group(1)}% {m.group(2)}%"
    return None


def _border(v: str) -> Optional[Dict[str, Any]]:
    px, colour = None, None
    for part in v.split():
        k = _key(part)
        if k in BORDER_WIDTHS:
            px = BORDER_WIDTHS[k]
            continue
        n = _number(part)
        if n is not None and "%" not in part:
            px = int(max(0, min(40, n)))
            continue
        c = _color(part)
        if c:
            colour = c
        else:
            return None
    if px is None and colour is None:
        return None
    if px == 0:
        return {"px": 0}
    return {"px": px if px is not None else 6, "color": colour or "ink"}


def merge_styles(defaults: Dict[str, Any], own: Dict[str, Any]) -> Dict[str, Any]:
    """The slide's own picture fields on top of the header defaults. `filter: none` on a slide
    switches off the defaults' filter (and its numeric adjustments); it stays as filter == [] so
    the app-wide default (brand.json image_defaults) does not come back on top of it."""
    out = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v) for k, v in defaults.items()}
    for key, val in own.items():
        if key == "filter":
            if val == []:
                out["filter"] = []          # an explicit "none": keeps the app-wide default look off too
                out.pop("adjust", None)
            else:
                out["filter"] = list(val)
        elif key == "adjust":
            out["adjust"] = {**out.get("adjust", {}), **val}
        else:
            out[key] = val
    return out


def _resolve(color: Optional[str], accent: str, ink: str) -> str:
    if color == "accent":
        return accent
    if color == "ink":
        return ink
    return color or ink


def css_for(style: Dict[str, Any], accent: str, ink: str = "#111111") -> Dict[str, Any]:
    """Everything a template needs: inline styles for the picture and its frame, overlays, text position."""
    style = style or {}
    amounts: Dict[str, float] = {}
    for name in style.get("filter") or []:
        amounts.update(PRESETS.get(name, {}))
    amounts.update(style.get("adjust") or {})
    duo = style.get("duotone") or ""
    if duo:
        amounts["grayscale"] = 1.0
        amounts.setdefault("contrast", 1.15)
    fns = []
    for name in FILTER_ORDER:
        if name not in amounts:
            continue
        v = amounts[name]
        if name == "hue":
            fns.append(f"hue-rotate({v:g}deg)")
        elif name == "blur":
            fns.append(f"blur({v:g}px)")
        else:
            fns.append(f"{name}({v:g})")
    img = [f"object-fit: {style.get('fit', 'cover')}", f"object-position: {style.get('focus', 'center')}"]
    if fns:
        img.append("filter: " + " ".join(fns))
    if amounts.get("blur"):
        img.append("transform: scale(1.08)")  # keeps the soft edges of a blurred picture outside the frame
    if duo or "halftone" in (style.get("filter") or []):
        img.append("mix-blend-mode: multiply")      # white paper of the dots lets the slide colour show through
    frame: List[str] = []
    if "rounded" in style:
        frame.append(f"border-radius: {style['rounded']}px")
    border = style.get("border")
    if isinstance(border, dict):
        frame.append("border: 0" if not border.get("px") else f"border: {border['px']}px solid {_resolve(border.get('color'), accent, ink)}")
        frame.append("box-shadow: none")
    if duo:
        frame.append(f"background: {_resolve(duo, accent, ink)}")
        frame.append("isolation: isolate")
    tint = style.get("tint") or {}
    return {
        "img_style": "; ".join(img),
        "frame_style": "; ".join(frame),
        "tint_color": _resolve(tint.get("color"), accent, ink) if tint.get("color") else "",
        "tint_strength": tint.get("strength", 0.35),
        "overlay": float(style.get("overlay") or 0.0),
        "over": False,                                   # text is never laid over the picture
        "above": style.get("text_position") == "above",
        "blurred": bool(amounts.get("blur")),
    }


def halftone_params(style: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Settings for render/halftone.py when the style asks for the dotted look, else None."""
    style = style or {}
    if "halftone" not in (style.get("filter") or []):
        return None
    return {"dot": style.get("dot_size"), "angle": style.get("dot_angle")}


def app_default_style(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """brand.json `image_defaults` (written like spec fields: filter, dot_size, text_position ...)
    as a style dict. Bad values are ignored; this never raises."""
    if not isinstance(raw, dict):
        return {}
    flat = {str(k): (", ".join(map(str, v)) if isinstance(v, (list, tuple)) else str(v)) for k, v in raw.items() if v is not None}
    try:
        return parse_image_style({k: flat[k] for k in STYLE_FIELDS if k in flat})[0]
    except Exception:
        return {}
