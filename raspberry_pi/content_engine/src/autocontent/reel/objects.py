"""Reusable overlay objects for explainer reels: shapes, arrows, icons, callouts, labels, and badges.

Each object is an SVG drawn at any position on the slide, rendered as a transparent PNG layer, and
animated relative to its own anchor point.  The script names them in an `objects:` line on any slide;
the pipeline renders them after the slide is drawn and before the layers are composed.

Object syntax in a reel script:

    objects: arrow-right @ 50,80 120px accent | circle @ 30,40 80px muted | icon:lightbulb @ 70,20 64px

Position is `x%,y%` of the canvas.  Size is in px.  Colour is a token resolved from the slide's
palette (accent, muted, dark, light, brand) or a hex (#FF5733).
"""

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Built-in shapes: each returns an SVG string at the requested size and colour
# ---------------------------------------------------------------------------

def _svg_wrap(inner: str, size: int, colour: str, vb: str = "0 0 24 24") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
            f'viewBox="{vb}" fill="none" stroke="{colour}" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')


def _svg_filled(inner: str, size: int, colour: str, vb: str = "0 0 24 24") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
            f'viewBox="{vb}" fill="{colour}" stroke="none">{inner}</svg>')


# ----- arrows -----

SHAPES: Dict[str, Any] = {}


def _register(name: str, aliases: List[str], fn, anim: str = "fly", filled: bool = False):
    entry = {"fn": fn, "anim": anim, "filled": filled}
    SHAPES[name] = entry
    for a in aliases:
        SHAPES[a] = entry


def _arrow_right(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', sz, c)

def _arrow_left(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>', sz, c)

def _arrow_up(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', sz, c)

def _arrow_down(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', sz, c)

def _arrow_up_right(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M7 17 17 7"/><path d="M7 7h10v10"/>', sz, c)

def _arrow_curve(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M7 17 17 7"/><path d="M7 7h10v10"/>', sz, c)

_register("arrow-right", ["arrow", "→", "right-arrow"], _arrow_right, "fly")
_register("arrow-left", ["←", "left-arrow"], _arrow_left, "fly")
_register("arrow-up", ["↑", "up-arrow"], _arrow_up, "fly")
_register("arrow-down", ["↓", "down-arrow"], _arrow_down, "fly")
_register("arrow-up-right", ["↗", "growth-arrow"], _arrow_up_right, "fly")

# ----- basic shapes -----

def _circle(sz: int, c: str) -> str:
    return _svg_wrap(f'<circle cx="12" cy="12" r="10"/>', sz, c)

def _circle_filled(sz: int, c: str) -> str:
    return _svg_filled(f'<circle cx="12" cy="12" r="11"/>', sz, c)

def _square(sz: int, c: str) -> str:
    return _svg_wrap('<rect x="3" y="3" width="18" height="18" rx="2"/>', sz, c)

def _square_filled(sz: int, c: str) -> str:
    return _svg_filled('<rect x="2" y="2" width="20" height="20" rx="2"/>', sz, c)

def _triangle(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M12 2 L22 20 L2 20 Z"/>', sz, c)

def _diamond(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M12 2 L22 12 L12 22 L2 12 Z"/>', sz, c)

def _star(sz: int, c: str) -> str:
    return _svg_wrap(
        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>',
        sz, c)

def _hexagon(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
        sz, c)

_register("circle", ["ring", "o"], _circle, "scale")
_register("circle-filled", ["dot", "disc", "bullet"], _circle_filled, "scale", filled=True)
_register("square", ["box", "rect"], _square, "scale")
_register("square-filled", ["block"], _square_filled, "scale", filled=True)
_register("triangle", ["tri"], _triangle, "scale")
_register("diamond", [], _diamond, "spin")
_register("star", ["★"], _star, "spin")
_register("hexagon", ["hex"], _hexagon, "scale")

# ----- connectors & lines -----

def _line_h(sz: int, c: str) -> str:
    return _svg_wrap('<line x1="2" y1="12" x2="22" y2="12"/>', sz, c)

def _line_v(sz: int, c: str) -> str:
    return _svg_wrap('<line x1="12" y1="2" x2="12" y2="22"/>', sz, c)

def _plus(sz: int, c: str) -> str:
    return _svg_wrap('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', sz, c)

def _minus(sz: int, c: str) -> str:
    return _svg_wrap('<line x1="5" y1="12" x2="19" y2="12"/>', sz, c)

def _x_mark(sz: int, c: str) -> str:
    return _svg_wrap('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', sz, c)

def _check(sz: int, c: str) -> str:
    return _svg_wrap('<polyline points="20 6 9 17 4 12"/>', sz, c)

_register("line", ["line-h", "horizontal-line", "divider"], _line_h, "draw")
_register("line-v", ["vertical-line"], _line_v, "draw")
_register("plus", ["+", "add"], _plus, "scale")
_register("minus", ["-", "subtract"], _minus, "draw")
_register("x", ["cross", "×", "close"], _x_mark, "spin")
_register("check", ["tick", "✓", "checkmark"], _check, "draw")

# ----- callouts & badges -----

def _badge_circle(sz: int, c: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{sz}" height="{sz}" viewBox="0 0 24 24">'
            f'<circle cx="12" cy="12" r="11" fill="{c}"/></svg>')

def _callout_box(sz: int, c: str) -> str:
    return _svg_wrap(
        '<rect x="2" y="2" width="20" height="16" rx="3"/><path d="M8 18 L12 22 L16 18"/>',
        sz, c)

def _speech_bubble(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        sz, c)

def _underline(sz: int, c: str) -> str:
    w = max(sz, 60)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{max(8, sz // 8)}" '
            f'viewBox="0 0 {w} 8" fill="none" stroke="{c}" stroke-width="3" stroke-linecap="round">'
            f'<path d="M2 4 Q{w // 4} 2 {w // 2} 4 T{w - 2} 4"/></svg>')

def _bracket_left(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M8 2 C4 2 2 4 2 8 L2 16 C2 20 4 22 8 22"/>', sz, c)

def _bracket_right(sz: int, c: str) -> str:
    return _svg_wrap('<path d="M16 2 C20 2 22 4 22 8 L22 16 C22 20 20 22 16 22"/>', sz, c)

def _highlight(sz: int, c: str) -> str:
    w = max(sz, 100)
    h = max(24, sz // 3)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}"><rect x="0" y="0" width="{w}" height="{h}" rx="4" '
            f'fill="{c}" opacity="0.3"/></svg>')

_register("badge", ["number-badge", "counter"], _badge_circle, "pop", filled=True)
_register("callout", ["callout-box", "tooltip"], _callout_box, "pop")
_register("speech", ["speech-bubble", "chat", "message"], _speech_bubble, "pop")
_register("underline", ["underline-wave", "wave"], _underline, "draw")
_register("bracket-left", ["bracket-l", "["], _bracket_left, "draw")
_register("bracket-right", ["bracket-r", "]"], _bracket_right, "draw")
_register("highlight", ["marker", "highlighter"], _highlight, "wipe")

# ----- emphasis -----

def _sparkle(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21'
        'l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>'
        '<path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
        sz, c)

def _zap(sz: int, c: str) -> str:
    return _svg_wrap('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', sz, c)

def _flame(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 '
        '.5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
        sz, c)

def _target(sz: int, c: str) -> str:
    return _svg_wrap(
        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
        sz, c)

def _eye(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        sz, c)

_register("sparkle", ["✨", "spark", "magic"], _sparkle, "spin")
_register("zap", ["⚡", "lightning", "bolt", "energy"], _zap, "flash")
_register("flame", ["🔥", "fire", "hot"], _flame, "pulse")
_register("target", ["🎯", "bullseye", "goal"], _target, "scale")
_register("eye", ["👁", "view", "watch", "focus"], _eye, "blink")

# ----- concept icons: common explainer symbols -----

def _money(sz: int, c: str) -> str:
    return _svg_wrap(
        '<line x1="12" y1="1" x2="12" y2="23"/>'
        '<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
        sz, c)

def _chart_up(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
        sz, c)

def _clock(sz: int, c: str) -> str:
    return _svg_wrap(
        '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        sz, c)

def _lock(sz: int, c: str) -> str:
    return _svg_wrap(
        '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>'
        '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        sz, c)

def _globe(sz: int, c: str) -> str:
    return _svg_wrap(
        '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>'
        '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        sz, c)

def _users(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>'
        '<circle cx="9" cy="7" r="4"/>'
        '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>'
        '<path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        sz, c)

def _lightbulb(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>'
        '<path d="M9 18h6"/><path d="M10 22h4"/>',
        sz, c)

def _shield(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        sz, c)

def _gear(sz: int, c: str) -> str:
    return _svg_wrap(
        '<circle cx="12" cy="12" r="3"/>'
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        sz, c)

def _heart(sz: int, c: str) -> str:
    return _svg_wrap(
        '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
        sz, c)

_register("money", ["$", "dollar", "currency", "cost"], _money, "fly")
_register("chart-up", ["trending", "growth", "trend", "📈"], _chart_up, "draw")
_register("clock", ["time", "⏰", "timer", "duration"], _clock, "spin")
_register("lock", ["🔒", "security", "secure", "private"], _lock, "scale")
_register("globe", ["🌍", "world", "global", "internet"], _globe, "spin")
_register("users", ["👥", "people", "team", "group"], _users, "fly")
_register("lightbulb", ["💡", "idea", "insight", "tip"], _lightbulb, "flash")
_register("shield", ["🛡", "protect", "safe", "defend"], _shield, "scale")
_register("gear", ["⚙", "settings", "config", "process"], _gear, "spin")
_register("heart", ["❤", "love", "like", "favourite"], _heart, "pulse")


# ---------------------------------------------------------------------------
# Lucide icon loader: `icon:<name>` pulls from the installed lucide-static set
# ---------------------------------------------------------------------------

LUCIDE_DIR: Optional[Path] = None

def _find_lucide() -> Optional[Path]:
    global LUCIDE_DIR
    if LUCIDE_DIR is not None:
        return LUCIDE_DIR
    for candidate in [
        Path("/tmp/luc/package/icons"),
        Path(__file__).resolve().parent.parent.parent.parent.parent / "node_modules" / "lucide-static" / "icons",
    ]:
        if candidate.is_dir():
            LUCIDE_DIR = candidate
            return candidate
    return None


def lucide_svg(name: str, size: int, colour: str) -> Optional[str]:
    d = _find_lucide()
    if d is None:
        return None
    path = d / f"{name}.svg"
    if not path.exists():
        return None
    svg = path.read_text(encoding="utf-8")
    svg = re.sub(r'width="\d+"', f'width="{size}"', svg)
    svg = re.sub(r'height="\d+"', f'height="{size}"', svg)
    svg = svg.replace('stroke="currentColor"', f'stroke="{colour}"')
    svg = svg.replace("currentColor", colour)
    return svg


# ---------------------------------------------------------------------------
# Object-relative animations — each one operates around the object's anchor
# ---------------------------------------------------------------------------

# (duration_s, travel_px) — travel is relative to the object's own size
OBJ_ANIMS: Dict[str, Tuple[float, float]] = {
    "fly":      (0.48, 0.6),    # slides in from outside (arrow direction or side)
    "scale":    (0.44, 0.0),    # grows from centre
    "pop":      (0.38, 0.0),    # pops in with overshoot
    "spin":     (0.52, 0.0),    # rotates in from 0 scale+rotation
    "draw":     (0.50, 0.0),    # stroke draws itself (wipe from left)
    "flash":    (0.36, 0.0),    # bright flash then settles
    "pulse":    (0.46, 0.0),    # scale bounce (1→1.2→1)
    "blink":    (0.40, 0.0),    # quick scale pinch (1→0.8→1.1→1)
    "wipe":     (0.44, 0.0),    # revealed left to right
    "fade":     (0.32, 0.0),    # simple fade in
}

# Exit animation durations (all are 60% of entrance speed for snappier exits)
OBJ_EXIT_DUR = 0.24


# ---------------------------------------------------------------------------
# Parsed object from script
# ---------------------------------------------------------------------------

@dataclass
class SceneObject:
    """One overlay object placed on a slide."""
    kind: str               # shape name or "icon:<lucide-name>"
    x_pct: float            # 0-100, percent of canvas width
    y_pct: float            # 0-100, percent of canvas height
    size: int = 80          # px
    colour: str = "accent"  # palette token or hex
    anim: str = ""          # override animation; empty = use the shape's default
    label: str = ""         # optional text inside/beside the object
    rotate: float = 0.0     # degrees


# ---------------------------------------------------------------------------
# Parsing: "arrow-right @ 50,80 120px accent" → SceneObject
# ---------------------------------------------------------------------------

_OBJ_RE = re.compile(
    r"(?P<kind>[\w:.←→↑↓↗✓✨⚡🔥🎯👁💡🛡⚙❤🌍👥🔒📈★×+-]+)"
    r"\s*@\s*(?P<x>\d+(?:\.\d+)?)\s*,\s*(?P<y>\d+(?:\.\d+)?)"
    r"(?:\s+(?P<size>\d+)(?:px)?)?"
    r"(?:\s+(?P<colour>#[0-9A-Fa-f]{3,8}|[a-zA-Z]\w*))?"
    r"(?:\s+(?P<anim>[a-z]+))?"
    r"(?:\s+r(?P<rotate>-?\d+(?:\.\d+)?))?"
)


def parse_objects(text: str) -> List[SceneObject]:
    """Parse an `objects:` value into a list of SceneObject."""
    if not text or not text.strip():
        return []
    out: List[SceneObject] = []
    for part in re.split(r"\s*\|\s*", text.strip()):
        part = part.strip()
        if not part:
            continue
        m = _OBJ_RE.match(part)
        if not m:
            continue
        kind = m.group("kind").lower().strip()
        x = float(m.group("x"))
        y = float(m.group("y"))
        size = int(m.group("size") or 80)
        colour = (m.group("colour") or "accent").lower()
        anim = (m.group("anim") or "").lower()
        rotate = float(m.group("rotate") or 0)
        out.append(SceneObject(kind=kind, x_pct=min(100, max(0, x)), y_pct=min(100, max(0, y)),
                               size=max(16, min(400, size)), colour=colour, anim=anim, rotate=rotate))
    return out


# ---------------------------------------------------------------------------
# Colour resolution from slide palette
# ---------------------------------------------------------------------------

COLOUR_TOKENS: Dict[str, str] = {
    "accent": "#EE4425",
    "brand": "#EE4425",
    "dark": "#1A1A2E",
    "light": "#FFFFFF",
    "muted": "#8B8FA3",
    "success": "#22C55E",
    "warning": "#F59E0B",
    "danger": "#EF4444",
    "info": "#3B82F6",
}

def resolve_colour(token: str, theme: str = "light", accent: Optional[str] = None) -> str:
    if token.startswith("#") and len(token) in (4, 7, 9):
        return token
    if accent and token in ("accent", "brand"):
        return accent
    if token in COLOUR_TOKENS:
        c = COLOUR_TOKENS[token]
        if token == "dark" and theme == "dark":
            return "#E8E8F0"
        if token == "light" and theme == "dark":
            return "#1A1A2E"
        return c
    return token if token.startswith("#") else "#EE4425"


# ---------------------------------------------------------------------------
# SVG → PNG rendering (Playwright or cairosvg fallback)
# ---------------------------------------------------------------------------

def render_object_svg(obj: SceneObject, theme: str = "light", accent: Optional[str] = None) -> str:
    """Return the SVG string for this object."""
    colour = resolve_colour(obj.colour, theme, accent)
    kind = obj.kind

    # icon:<name> → lucide
    if kind.startswith("icon:"):
        icon_name = kind[5:]
        svg = lucide_svg(icon_name, obj.size, colour)
        if svg:
            return svg
        # fall through to shapes if lucide not found

    if kind in SHAPES:
        return SHAPES[kind]["fn"](obj.size, colour)

    # try lucide by bare name
    svg = lucide_svg(kind, obj.size, colour)
    if svg:
        return svg

    # fallback: a coloured circle
    return _circle_filled(obj.size, colour)


def get_default_anim(kind: str) -> str:
    """The animation a shape uses when the script doesn't name one."""
    if kind.startswith("icon:"):
        return "scale"
    if kind in SHAPES:
        return SHAPES[kind]["anim"]
    return "scale"


def obj_position(obj: SceneObject, canvas_w: int, canvas_h: int) -> Tuple[int, int]:
    """Top-left (x, y) of the object on the canvas, centred on its percentage position."""
    cx = int(obj.x_pct / 100.0 * canvas_w)
    cy = int(obj.y_pct / 100.0 * canvas_h)
    return cx - obj.size // 2, cy - obj.size // 2
