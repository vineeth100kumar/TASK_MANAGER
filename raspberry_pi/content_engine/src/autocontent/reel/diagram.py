"""Universal explainer diagrams for reels.

A diagram is a short recipe in a slide's `diagram:` block. Six layout engines place the parts
(`grid`, `line`, `space`, `ring`, `tree`, `nest`), every part can be in one of four states (`base`,
`on`, `warn`, `ghost`) and any change of state or any appearance can be tied to a spoken word with
`@ "word"`. Presets in `content_engine/diagrams/*.yml` are recipes too: a preset sets the engine and
some sample data, and the slide's own lines override it.

    diagram: seatmap
      rows: 8 x 16
      stage: SCREEN
      on: 1-32 "sold" @ "thirty-two"
      mark: rows 1-2 "cheap seats" @ "cheap"
      legend: auto

This module draws SVG only and is pure Python (no browser), so it can be tested without a Chromium:
`Diagram.svg(applied_cues, theme, accent)` is one picture, the pipeline turns one picture per spoken
cue into a transparent layer and lets them replace each other as the voice reaches each word.
"""

import html
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Set, Tuple

MAX_PARTS = 600
MAX_CUES = 14
ENGINES = ("grid", "line", "space", "ring", "tree", "nest")
STATES = ("base", "on", "warn", "ghost")
# keys that may be given more than once (each line adds one); every other key keeps its last value
LIST_KEYS = {"item", "row", "point", "box", "dot", "circle", "text", "arrow", "line", "leader", "set", "layer",
             "on", "warn", "ghost", "base", "appear", "mark"}
DIRECTIVE_KEYS = ("on", "warn", "ghost", "base", "appear")
FONT = "Inter Display, Inter, Helvetica, Arial, sans-serif"
PRESET_DIR = Path(__file__).resolve().parents[3] / "diagrams"


class DiagramError(Exception):
    def __init__(self, message: str, hint: str = ""):
        super().__init__(message)
        self.hint = hint


# ----------------------------------------------------------------------------- small helpers

def _hex(c: str) -> Tuple[int, int, int]:
    c = c.lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def mix(a: str, b: str, t: float) -> str:
    """Colour a blended toward b by t (0..1), as an opaque hex."""
    ra, rb = _hex(a), _hex(b)
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(ra, rb))


def num(text: str, default: Optional[float] = None) -> Optional[float]:
    m = re.search(r"-?\d+(?:\.\d+)?", (text or "").replace(",", ""))
    return float(m.group(0)) if m else default


def fmt(n: float) -> str:
    return str(int(round(n))) if abs(n - round(n)) < 0.05 else f"{n:.1f}"


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def palette(theme: str = "light", accent: Optional[str] = None) -> Dict[str, str]:
    dark = theme == "dark"
    acc = accent if accent and re.fullmatch(r"#[0-9A-Fa-f]{6}", accent) else "#EE4425"
    bg = "#15161A" if dark else "#FFFFFF"
    return {"ink": "#F4F4F6" if dark else "#111214", "bg": bg, "soft": "#26272C" if dark else "#F0F0F2",
            "mut": "#52535A" if dark else "#C8C9CE", "grey": "#A3A4AB" if dark else "#6B6C72", "acc": acc,
            "tint": mix(acc, bg, 0.84), "white": "#FFFFFF"}


def T(x: float, y: float, s: str, size: float = 28, w: int = 800, fill: str = "#111", anchor: str = "start",
      ls: float = 0, op: float = 1.0) -> str:
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size:.1f}" font-weight="{w}" fill="{fill}" '
            f'text-anchor="{anchor}" letter-spacing="{ls}" font-family="{FONT}"'
            + (f' opacity="{op}"' if op != 1 else "") + f'>{esc(s)}</text>')


def fit_size(text: str, width: float, size: float, lo: float = 13) -> float:
    """Largest font size up to `size` at which `text` (bold capitals) is about `width` wide."""
    return max(lo, min(size, width / max(1, len(text)) / 0.62))


def split_fields(v: str) -> List[str]:
    return [f.strip() for f in v.split("|")]


# ----------------------------------------------------------------------------- parts

@dataclass
class Part:
    id: int
    kind: str
    x: float
    y: float
    w: float
    h: float
    label: str = ""
    sub: str = ""
    value: str = ""
    sel: bool = True                 # can a state directive point at it?
    row: int = 0
    col: int = 0
    idx: int = 0
    extra: Dict = field(default_factory=dict)

    def bbox(self) -> Tuple[float, float, float, float]:
        return self.extra.get("bbox") or (self.x, self.y, self.w, self.h)


@dataclass
class Directive:
    kind: str                        # base, on, warn, ghost, appear
    ids: Set[int]
    label: str = ""
    cue: str = ""
    rest: bool = False               # means "the parts no other live line names" at each moment


@dataclass
class Mark:
    ids: Set[int]
    label: str = ""
    cue: str = ""


@dataclass
class Connector:
    a: int
    b: int
    x1: float
    y1: float
    x2: float
    y2: float
    kind: str = "arrow"              # arrow, line, elbow, arc
    extra: Dict = field(default_factory=dict)


# ----------------------------------------------------------------------------- reading a recipe

def _entries(text: str, source: str) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for raw in text.replace("\r", "").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if not m:
            raise DiagramError(f"Can't read the line '{line[:50]}' in {source}.",
                               "Each line is `key: value`, for example `rows: 8 x 16`.")
        out.append((m.group(1).lower().replace("-", "_"), m.group(2).strip()))
    return out


def preset_dirs() -> List[Path]:
    extra = os.environ.get("SAGE_DIAGRAMS_DIR")
    return ([Path(extra)] if extra else []) + [PRESET_DIR]


def list_presets() -> List[str]:
    names = set()
    for d in preset_dirs():
        if d.is_dir():
            names |= {p.stem for p in d.glob("*.yml")}
    return sorted(names)


def _preset_text(name: str) -> Optional[str]:
    if not re.fullmatch(r"[a-z][a-z0-9_-]*", name):
        return None
    for d in preset_dirs():
        f = d / f"{name}.yml"
        if f.is_file():
            return f.read_text(encoding="utf-8")
    return None


def split_directive(v: str) -> Tuple[str, str, str]:
    """`<selector> "legend label" @ "cue words"` -> (selector, label, cue)."""
    cue = ""
    padded = " " + v
    m = re.search(r'\s@\s*(?:"([^"]*)"|(.+?))\s*$', padded)
    if m:
        cue = (m.group(1) if m.group(1) is not None else m.group(2) or "").strip()
        padded = padded[:m.start()]
    v = padded.strip()
    label = ""
    m = re.search(r'"([^"]*)"', v)
    if m:
        label = m.group(1).strip()
        v = (v[:m.start()] + v[m.end():]).strip()
    if not v and label:                 # `warn: "Fab"` names the part, there is no legend label
        v, label = label, ""
    return v, label, cue


def select(spec: str, parts: List[Part], used: Set[int], what: str) -> Set[int]:
    """The parts a selector names: numbers and ranges, `rows 1-2`, `cols 3`, `r2c5`, `all`, `rest`, or names."""
    pool = [p for p in parts if p.sel]
    ids: Set[int] = set()
    if not spec.strip():
        raise DiagramError(f"`{what}:` needs to say which parts.", "For example `on: 1-32` or `warn: Fab`.")
    for tok in re.split(r"\s*,\s*", spec.strip()):
        low = tok.strip().strip('"').lower()
        if not low:
            continue
        m_axis = re.fullmatch(r"(rows?|cols?|columns?)\s+(\d+)(?:\s*-\s*(\d+))?", low)
        m_cell = re.fullmatch(r"r(\d+)c(\d+)", low)
        m_num = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", low)
        if low == "all":
            ids |= {p.id for p in pool}
        elif low == "rest":
            ids |= {p.id for p in pool} - used
        elif m_axis:
            a, b = int(m_axis.group(2)), int(m_axis.group(3) or m_axis.group(2))
            key = "row" if m_axis.group(1).startswith("row") else "col"
            ids |= {p.id for p in pool if a <= getattr(p, key) <= max(a, b)}
        elif m_cell:
            ids |= {p.id for p in pool if p.row == int(m_cell.group(1)) and p.col == int(m_cell.group(2))}
        elif m_num:
            a, b = int(m_num.group(1)), int(m_num.group(2) or m_num.group(1))
            ids |= {p.id for p in pool if a <= p.idx <= max(a, b)}
        else:
            hit = [p for p in pool if p.label.lower() == low] or [p for p in pool if low in p.label.lower()]
            if not hit:
                raise DiagramError(f"`{what}:` found no part called '{tok.strip()}'.",
                                   "Use a number like 3, a range like 1-5, `rows 2`, `all`, `rest` or a part's name.")
            ids |= {p.id for p in hit}
    if not ids:
        raise DiagramError(f"`{what}: {spec}` matches no parts.", "Check the numbers against the diagram's size.")
    return ids


# ----------------------------------------------------------------------------- the diagram

class Diagram:
    def __init__(self, engine: str, layout: str, w: int, h: int, x: int, y: int):
        self.engine, self.layout, self.w, self.h = engine, layout, w, h
        self.x, self.y = x, y                  # top left on the canvas
        self.source = ""                       # the recipe text, so the pipeline can lay it out again to fit
        self.placed = False                    # the author gave `at:` or `size:`; leave the box where they put it
        self.parts: List[Part] = []
        self.connectors: List[Connector] = []
        self.furniture: List[Callable[[Dict[str, str]], str]] = []
        self.directives: List[Directive] = []
        self.marks: List[Mark] = []
        self.legend = False
        self.legend_h = 0.0
        self.fs = w / 880.0

    def add(self, kind: str, x: float, y: float, w: float, h: float, **kw) -> Part:
        if len(self.parts) >= MAX_PARTS:
            raise DiagramError(f"This diagram has more than {MAX_PARTS} parts.",
                               "Use fewer cells or rows; a reel is too small to read more anyway.")
        p = Part(len(self.parts) + 1, kind, x, y, w, h, **kw)
        self.parts.append(p)
        return p

    # ---- cues
    def cues(self) -> List[str]:
        seen: List[str] = []
        for d in list(self.directives) + list(self.marks):
            if d.cue and d.cue not in seen:
                seen.append(d.cue)
        return seen

    # ---- states at one moment
    def _states(self, applied: Set[str]) -> Tuple[Dict[int, str], Set[int], List[Set[int]]]:
        """Each part's state, which parts are not shown yet, and the parts each line names right now."""
        state = {p.id: "base" for p in self.parts}
        hidden: Set[int] = set()
        pool = {p.id for p in self.parts if p.sel}
        live = [(not d.cue) or d.cue in applied for d in self.directives]
        named: Set[int] = set()
        for d, on in zip(self.directives, live):
            if on and not d.rest and d.kind in STATES:
                named |= d.ids
        eff = [(pool - named) if d.rest else d.ids for d in self.directives]
        for d, ids, on in zip(self.directives, eff, live):
            if d.kind == "appear":
                if not on:
                    hidden |= ids
            elif on:
                for i in ids:
                    state[i] = d.kind
        return state, hidden, eff

    def svg(self, applied: Sequence[str] = (), theme: str = "light", accent: Optional[str] = None) -> str:
        pal = palette(theme, accent)
        have = set(applied)
        state, hidden, eff = self._states(have)
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
               f'viewBox="0 0 {self.w} {self.h}">']
        for f in self.furniture:
            out.append(f(pal))
        by_id = {p.id: p for p in self.parts}
        for c in self.connectors:
            if c.a in hidden or c.b in hidden:
                continue
            on = state.get(c.b) in ("on", "warn") and state.get(c.a) in ("on", "warn")
            out.append(_draw_connector(c, pal, on, self.fs))
        for p in self.parts:
            if p.id not in hidden:
                out.append(_draw_part(p, state[p.id], pal, self.fs))
        for m in self.marks:
            if (not m.cue or m.cue in have) and not (m.ids & hidden):
                out.append(_draw_mark(m, by_id, pal, self.fs, self.w, self.h))
        if self.legend:
            out.append(self._legend(pal, state, hidden, eff))
        out.append("</svg>")
        return "".join(out)

    def _legend(self, pal: Dict[str, str], state: Dict[int, str], hidden: Set[int], eff: List[Set[int]]) -> str:
        # one entry per labelled line, counting the parts that are in that state right now
        items = []
        for d, ids in zip(self.directives, eff):
            if d.label and d.kind in STATES:
                n = sum(1 for i in ids if state[i] == d.kind and i not in hidden)
                if n:
                    items.append((d, n))
        if not items:
            return ""
        fs = self.fs
        y = self.h - 10 * fs
        sz = 26 * fs
        sw = 28 * fs
        x = 4 * fs
        out = []
        for d, n in items:
            text = f"{d.label.upper()} · {n}"
            style = _style(d.kind, pal)
            out.append(f'<rect x="{x:.1f}" y="{y - sw + 4 * fs:.1f}" width="{sw:.1f}" height="{sw:.1f}" rx="{4 * fs:.1f}" '
                       f'fill="{style["fill"]}" stroke="{style["stroke"]}" stroke-width="{style["sw"]}"'
                       + (' stroke-dasharray="5 4"' if d.kind == "ghost" else "") + '/>')
            out.append(T(x + sw + 10 * fs, y, text, sz, 800, pal["ink"] if d.kind != "base" else pal["grey"]))
            x += sw + 10 * fs + len(text) * sz * 0.62 + 34 * fs
        return "".join(out)


# ----------------------------------------------------------------------------- how parts look

def _style(state: str, pal: Dict[str, str]) -> Dict:
    if state == "on":
        return {"fill": pal["acc"], "stroke": pal["acc"], "sw": 2, "text": pal["white"], "sub": mix(pal["acc"], "#FFFFFF", .72), "op": 1}
    if state == "warn":
        return {"fill": pal["tint"], "stroke": pal["acc"], "sw": 4, "text": pal["acc"], "sub": pal["grey"], "op": 1}
    if state == "ghost":
        return {"fill": "none", "stroke": pal["mut"], "sw": 2, "text": pal["grey"], "sub": pal["grey"], "op": .6}
    return {"fill": pal["soft"], "stroke": pal["mut"], "sw": 2, "text": pal["ink"], "sub": pal["grey"], "op": 1}


def _rect(x, y, w, h, st, r, dash=False, fill=None) -> str:
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(w, 1):.1f}" height="{max(h, 1):.1f}" rx="{r:.1f}" '
            f'fill="{fill or st["fill"]}" stroke="{st["stroke"]}" stroke-width="{st["sw"]}"'
            + (' stroke-dasharray="7 6"' if dash else "") + (f' opacity="{st["op"]}"' if st["op"] != 1 else "") + '/>')


def _badge(cx: float, cy: float, r: float, pal: Dict[str, str]) -> str:
    d = r * 0.4
    return (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{pal["acc"]}"/>'
            f'<path d="M{cx - d:.1f} {cy - d:.1f} l{2 * d:.1f} {2 * d:.1f} M{cx + d:.1f} {cy - d:.1f} l{-2 * d:.1f} {2 * d:.1f}" '
            f'stroke="#fff" stroke-width="{r * 0.28:.1f}" stroke-linecap="round"/>')


def _draw_part(p: Part, state: str, pal: Dict[str, str], fs: float) -> str:
    st = _style(state, pal)
    ghost = state == "ghost"
    k = p.kind
    x, y, w, h = p.x, p.y, p.w, p.h
    ex = p.extra
    if k == "cell":
        fill = None
        if "heat" in ex and state == "base":
            fill = mix(pal["soft"], pal["acc"], 0.12 + 0.88 * ex["heat"])
        return _rect(x, y, w, h, st, max(2, w * 0.14), ghost, fill)
    if k == "dot":
        return (f'<circle cx="{x + w / 2:.1f}" cy="{y + h / 2:.1f}" r="{w / 2:.1f}" fill="{st["fill"]}" '
                f'stroke="{st["stroke"]}" stroke-width="{st["sw"]}"'
                + (' stroke-dasharray="5 4"' if ghost else "") + (f' opacity="{st["op"]}"' if st["op"] != 1 else "") + '/>')
    if k == "person":
        head = (f'<circle cx="{x + w / 2:.1f}" cy="{y + h * 0.26:.1f}" r="{w * 0.22:.1f}" fill="{st["fill"]}" '
                f'stroke="{st["stroke"]}" stroke-width="{st["sw"] * .7:.1f}"')
        body = _rect(x + w * 0.1, y + h * 0.54, w * 0.8, h * 0.46, st, w * 0.3, ghost)
        return head + (f' opacity="{st["op"]}"' if st["op"] != 1 else "") + "/>" + body
    if k == "tcell":
        size = fit_size(p.label, w - 12 * fs, 34 * fs)
        return _rect(x, y, w, h, st, 8 * fs, ghost) + T(x + w / 2, y + h / 2 + size * 0.36, p.label, size, 900, st["text"], "middle", op=st["op"])
    if k == "box":
        out = _rect(x, y, w, h, st, 12 * fs, ghost)
        two = bool(p.sub) and h >= 70 * fs
        size = fit_size(p.label.upper(), w * (0.55 if p.value else 0.9), min(40 * fs, h * 0.36) if two else 40 * fs)
        base_y = y + (h * 0.45 if two else h / 2 + size * 0.36)
        out += T(x + 24 * fs, base_y, p.label.upper(), size, 900, st["text"], ls=0.4, op=st["op"])
        if p.sub and two:
            out += T(x + 24 * fs, y + h * 0.82, p.sub, min(26 * fs, h * 0.22), 600, st["sub"], op=st["op"])
        if p.value:
            vs = fit_size(p.value, w * 0.38, 34 * fs)
            out += T(x + w - 20 * fs, y + h / 2 + vs * 0.36, p.value, vs, 900, st["text"], "end", op=st["op"])
        if state == "warn" and ex.get("badge", True):
            r = min(h * 0.32, 26 * fs)
            cx = x + w + r + 10 * fs
            if cx + r > ex.get("limit", 1e9):
                cx = x + w - r - (150 * fs if p.value else 14 * fs)
            out += _badge(cx, y + h / 2, r, pal)
        return out
    if k in ("bar", "lane"):
        lane_base = k == "lane" and state == "base"
        out = _rect(x, y, w, h, st, 10 * fs, ghost, pal["ink"] if lane_base else None)
        lx = ex.get("lx", x - 14 * fs)
        anchor = "start" if k == "lane" else "end"
        size = fit_size(p.label.upper(), ex.get("lw", 260 * fs), 32 * fs)
        out += T(lx, y + h / 2 + size * 0.36, p.label.upper(), size, 900,
                 pal["acc"] if state in ("on", "warn") else pal["ink"], anchor, op=st["op"])
        if p.value:
            vs = 30 * fs
            inside = k == "lane" and w > len(p.value) * vs * 0.7 + 20 * fs
            tw = len(p.value) * vs * 0.62 + 12 * fs
            left = not inside and x + w + tw > ex.get("W", 1e9)
            vx = x + 14 * fs if inside else (x - 12 * fs if left else x + w + 12 * fs)
            col = (pal["bg"] if lane_base else st["text"]) if inside else (pal["acc"] if state in ("on", "warn") else pal["grey"])
            out += T(vx, y + h / 2 + vs * 0.36, p.value, vs, 900, col, "end" if left else "start", op=st["op"])
        if state == "warn" and ex.get("badge", True):
            r = min(h * 0.34, 22 * fs)
            out += _badge(min(x + w + 40 * fs + len(p.value) * 30 * fs * 0.62, ex.get("W", 1e9) - r - 4 * fs), y + h / 2, r, pal)
        return out
    if k == "tick":
        cx, cy = x + w / 2, y + h / 2
        r = 14 * fs if state in ("on", "warn") else 10 * fs
        out = ""
        if state in ("on", "warn"):
            out += f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * 2.1:.1f}" fill="{pal["acc"]}" opacity=".18"/>'
        col = pal["acc"] if state in ("on", "warn") else (pal["mut"] if ghost else pal["ink"])
        out += f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{col}"/>'
        up = ex.get("up", True)
        big = 36 * fs if state in ("on", "warn") else 30 * fs
        yy = cy - 44 * fs if up else cy + 64 * fs
        out += T(cx, yy, p.label, big, 900, col if state != "base" else pal["ink"], "middle", op=st["op"])
        if p.sub:
            out += T(cx, yy + (28 * fs if up else 30 * fs), p.sub, 24 * fs, 600, pal["grey"], "middle", op=st["op"])
        return out
    if k == "marker":
        cx, cy = x + w / 2, y + h / 2
        r = 15 * fs if state in ("on", "warn") else 10 * fs
        col = pal["acc"] if state in ("on", "warn") else (pal["mut"] if ghost else pal["ink"])
        out = f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{col}"/>'
        size = fit_size(p.label.upper(), ex.get("lw", 200 * fs), 24 * fs, 12)
        return out + T(cx, cy + r + size + 6 * fs, p.label.upper(), size, 900, col if state != "base" else pal["grey"], "middle", op=st["op"])
    if k == "node":
        cx, cy, r = x + w / 2, y + h / 2, w / 2
        out = (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{st["fill"] if state != "base" else pal["bg"]}" '
               f'stroke="{st["stroke"] if state != "base" else pal["ink"]}" stroke-width="{st["sw"] + (.5 if state == "base" else 0)}"'
               + (' stroke-dasharray="6 5"' if ghost else "") + (f' opacity="{st["op"]}"' if st["op"] != 1 else "") + '/>')
        size = fit_size(p.label.upper(), r * 1.7, 28 * fs, 11)
        out += T(cx, cy + size * 0.36 - (8 * fs if p.sub else 0), p.label.upper(), size, 900, st["text"] if state != "base" else pal["ink"], "middle", op=st["op"])
        if p.sub:
            out += T(cx, cy + size * 0.36 + 16 * fs, p.sub, 20 * fs, 600, st["sub"], "middle", op=st["op"])
        return out
    if k == "disc":
        cx, cy, r = x + w / 2, y + h / 2, w / 2
        fill = {"on": mix(pal["acc"], pal["bg"], .55), "warn": pal["tint"], "ghost": "none"}.get(state, mix(pal["ink"], pal["bg"], .90))
        stroke = pal["acc"] if state in ("on", "warn") else (pal["mut"] if ghost else pal["ink"])
        out = (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="3"'
               + (' stroke-dasharray="7 6"' if ghost else "") + '/>')
        lx, ly = ex.get("lx", cx), ex.get("ly", cy)
        size = fit_size(p.label.upper(), ex.get("lw", r * 1.1), 34 * fs, 13)
        out += T(lx, ly, p.label.upper(), size, 900, pal["acc"] if state in ("on", "warn") else pal["ink"], "middle", op=st["op"])
        if p.sub:
            out += T(lx, ly + 28 * fs, p.sub, 22 * fs, 600, pal["grey"], "middle", op=st["op"])
        return out
    if k == "lens":
        ids = ex["clip"]
        col = pal["acc"] if state in ("on", "warn") else mix(pal["ink"], pal["bg"], .72)
        inner = f'<circle cx="{ex["circles"][-1][0]:.1f}" cy="{ex["circles"][-1][1]:.1f}" r="{ex["circles"][-1][2]:.1f}" fill="{col}"/>'
        for n, (cx, cy, r) in enumerate(reversed(ex["circles"][:-1])):
            cid = f"lens{ids}_{n}"
            inner = (f'<clipPath id="{cid}"><circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}"/></clipPath>'
                     f'<g clip-path="url(#{cid})">{inner}</g>')
        size = fit_size(p.label.upper(), w, 24 * fs, 12)
        tcol = pal["white"] if state in ("on", "warn") else pal["ink"]
        out = inner + T(x + w / 2, y + h / 2 - 2 * fs, p.label.upper(), size, 900, tcol, "middle")
        if p.value:
            out += T(x + w / 2, y + h / 2 + 34 * fs, p.value, 38 * fs, 900, tcol, "middle")
        return out
    if k == "slab":
        out = _rect(x, y, w, h, st, 10 * fs, ghost)
        two = bool(p.sub) and h >= 70 * fs
        size = fit_size(p.label.upper(), w * 0.62, min(36 * fs, h * 0.36) if two else 36 * fs)
        out += T(x + 24 * fs, y + (h * 0.45 if two else h / 2 + size * 0.36), p.label.upper(), size, 900, st["text"], op=st["op"])
        if two:
            out += T(x + 24 * fs, y + h * 0.82, p.sub, min(24 * fs, h * 0.22), 600, st["sub"], op=st["op"])
        if p.value:
            vs = min(52 * fs, h * 0.7)
            out += T(x + w - 18 * fs, y + h / 2 + vs * 0.36, p.value, vs, 900,
                     st["text"] if state in ("on", "warn") else pal["grey"], "end", op=st["op"])
        return out
    if k == "square":
        col = {"on": pal["acc"], "warn": pal["acc"], "ghost": "none"}.get(state, pal["mut"])
        out = (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{6 * fs:.1f}" fill="{col}"'
               + (f' stroke="{pal["mut"]}" stroke-width="2" stroke-dasharray="7 6"' if ghost else "") + '/>')
        size = fit_size(p.label.upper(), ex.get("lw", w + 40 * fs), 24 * fs, 12)
        return out + T(x + w / 2, y + h + size + 8 * fs, p.label.upper(), size, 900,
                       pal["acc"] if state in ("on", "warn") else pal["grey"], "middle", op=st["op"])
    if k == "meter":
        col = pal["ink"] if state == "base" and ex.get("calm") else pal["acc"]
        out = (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{12 * fs:.1f}" fill="{col}"/>')
        return out + T(x + 22 * fs, y + h / 2 + 12 * fs, p.label, 36 * fs, 900, pal["white"])
    if k == "text":
        col = pal["acc"] if state in ("on", "warn") else (pal["grey"] if state in ("ghost", "base") and ex.get("quiet") else pal["ink"])
        return T(x, y, p.label, ex.get("size", 30 * fs), ex.get("weight", 800), col, ex.get("anchor", "middle"), op=st["op"])
    if k in ("arrow", "line"):
        x2, y2 = ex["x2"], ex["y2"]
        col = pal["acc"] if state in ("on", "warn") else (pal["mut"] if ghost else pal["ink"])
        out = _arrow_svg(x, y, x2, y2, col, 4 * fs, k == "arrow", fs)
        if p.label:
            out += T((x + x2) / 2, (y + y2) / 2 - 14 * fs, p.label, 26 * fs, 800, col, "middle")
        return out
    if k == "leader":
        x2, y2 = ex["x2"], ex["y2"]
        col = pal["acc"] if state != "ghost" else pal["mut"]
        out = (f'<path d="M{x:.1f} {y:.1f} L{x2:.1f} {y2:.1f}" stroke="{col}" stroke-width="{3 * fs:.1f}"/>'
               f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{6 * fs:.1f}" fill="{col}"/>')
        size = fit_size(p.label.upper(), ex.get("lw", 220 * fs), 28 * fs, 14)
        return out + T(x2, y2 - 12 * fs, p.label.upper(), size, 900, pal["acc"] if state == "on" else pal["ink"],
                       "end" if x2 > x else "start")
    return ""


def _arrow_svg(x1, y1, x2, y2, col, sw, head, fs) -> str:
    out = f'<path d="M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}" stroke="{col}" stroke-width="{sw:.1f}" stroke-linecap="round"/>'
    if head:
        ang = math.atan2(y2 - y1, x2 - x1)
        L = 18 * fs
        a, b = ang + 2.6, ang - 2.6
        out += (f'<path d="M{x2 + L * math.cos(a):.1f} {y2 + L * math.sin(a):.1f} L{x2:.1f} {y2:.1f} '
                f'L{x2 + L * math.cos(b):.1f} {y2 + L * math.sin(b):.1f}" stroke="{col}" stroke-width="{sw:.1f}" '
                f'stroke-linecap="round" stroke-linejoin="round" fill="none"/>')
    return out


def _draw_connector(c: Connector, pal: Dict[str, str], on: bool, fs: float) -> str:
    col = pal["acc"] if on else pal["ink"]
    if c.kind == "elbow":
        my = (c.y1 + c.y2) / 2
        return (f'<path d="M{c.x1:.1f} {c.y1:.1f} V{my:.1f} H{c.x2:.1f} V{c.y2:.1f}" stroke="{pal["mut"] if not on else col}" '
                f'stroke-width="{3 * fs:.1f}" fill="none" stroke-linejoin="round"/>')
    if c.kind == "arc":
        cx, cy, r = c.extra["cx"], c.extra["cy"], c.extra["r"]
        out = (f'<path d="M{c.x1:.1f} {c.y1:.1f} A{r:.1f} {r:.1f} 0 0 1 {c.x2:.1f} {c.y2:.1f}" '
               f'stroke="{pal["mut"] if not on else col}" stroke-width="{4 * fs:.1f}" fill="none" stroke-linecap="round"/>')
        ang = c.extra["end_angle"] + math.pi / 2
        L = 16 * fs
        out += (f'<path d="M{c.x2 + L * math.cos(ang + 0.5 + math.pi):.1f} {c.y2 + L * math.sin(ang + 0.5 + math.pi):.1f} '
                f'L{c.x2:.1f} {c.y2:.1f} L{c.x2 + L * math.cos(ang - 0.5 + math.pi):.1f} {c.y2 + L * math.sin(ang - 0.5 + math.pi):.1f}" '
                f'stroke="{pal["mut"] if not on else col}" stroke-width="{4 * fs:.1f}" fill="none" stroke-linecap="round"/>')
        return out
    return _arrow_svg(c.x1, c.y1, c.x2, c.y2, col, 4 * fs, c.kind == "arrow", fs)


def _draw_mark(m: Mark, by_id: Dict[int, Part], pal: Dict[str, str], fs: float, width: float, height: float) -> str:
    boxes = [by_id[i].bbox() for i in m.ids if i in by_id]
    if not boxes:
        return ""
    x0 = min(b[0] for b in boxes) - 8 * fs
    y0 = min(b[1] for b in boxes) - 8 * fs
    x1 = max(b[0] + b[2] for b in boxes) + 8 * fs
    y1 = max(b[1] + b[3] for b in boxes) + 8 * fs
    out = (f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" rx="{10 * fs:.1f}" fill="none" '
           f'stroke="{pal["ink"]}" stroke-width="{4 * fs:.1f}" stroke-dasharray="14 10"/>')
    if m.label:
        size = min(28 * fs, max(14, (width - 8) / max(1, len(m.label)) / 0.62))
        ty = y1 + size + 8 * fs                  # under the outline, or over it when there is no room below
        if ty > height:
            ty = y0 - 12 * fs
        out += T(max(x0, 4), ty, m.label.upper(), size, 900, pal["ink"])
    return out


# ----------------------------------------------------------------------------- the six layout engines
# Each takes the Diagram (sized, empty) and the recipe's options and fills in parts, connectors and
# furniture. `o` holds each scalar key's last value; `lists` holds every line of the repeated keys.

def _two(v: str, what: str) -> Tuple[int, int]:
    m = re.fullmatch(r"\s*(\d+)\s*[xX×*]\s*(\d+)\s*", v or "")
    if not m:
        raise DiagramError(f"`{what}` should look like `8 x 16`.", "Rows first, then columns.")
    return int(m.group(1)), int(m.group(2))


def _xy(v: str, n: int, what: str) -> List[float]:
    nums = re.findall(r"-?\d+(?:\.\d+)?", v)
    if len(nums) < n:
        raise DiagramError(f"`{what}` needs {n} numbers, like `20,30`.", "Positions are percentages of the diagram's box.")
    return [float(x) for x in nums[:n]]


def build_grid(d: Diagram, o: Dict[str, str], lists: Dict[str, List[str]]) -> None:
    fs = d.fs
    if d.layout == "table":
        return _table(d, o, lists)
    shape = o.get("shape", "square").lower()
    if shape not in ("square", "seat", "dot", "person", "cell"):
        raise DiagramError(f"Unknown grid shape '{shape}'.", "Use square, seat, dot or person.")
    if "rows" in o:
        R, C = _two(o["rows"], "rows")
        N = R * C
    else:
        N = int(num(o.get("count", "100"), 100))
        C = int(num(o.get("cols", ""), 10) or 10)
        C = max(1, min(C, N))
        R = -(-N // C)
    if N > MAX_PARTS or N < 1:
        raise DiagramError(f"A grid of {N} cells is too many.", f"Keep it under {MAX_PARTS}.")
    top = 92 * fs if o.get("stage") else 6 * fs
    bottom = d.legend_h
    avail_h = d.h - top - bottom
    gap = max(3.0, min(d.w / C, avail_h / R) * 0.16)
    cell = min((d.w - (C - 1) * gap) / C, (avail_h - (R - 1) * gap) / R)
    if cell < 8:
        raise DiagramError(f"A {R} x {C} grid is too dense to read on a reel.", "Use fewer rows or columns.")
    x0 = (d.w - (C * cell + (C - 1) * gap)) / 2
    heat = [int(v) for v in re.findall(r"\d+", o.get("heat", ""))]
    hmax = max(heat) if heat else 0
    kind = {"dot": "dot", "person": "person"}.get(shape, "cell")
    for i in range(N):
        r, c = divmod(i, C)
        p = d.add(kind, x0 + c * (cell + gap), top + r * (cell + gap), cell, cell, row=r + 1, col=c + 1, idx=i + 1)
        if heat and hmax:
            p.extra["heat"] = (heat[i] if i < len(heat) else 0) / hmax
    if o.get("stage"):
        label = o["stage"]
        gw0, gw1 = x0, x0 + C * cell + (C - 1) * gap
        d.furniture.append(lambda pal, a=gw0, b=gw1, t=label, top=top: (
            f'<path d="M{a:.1f} {top - 22 * fs:.1f} Q {(a + b) / 2:.1f} {top - 64 * fs:.1f} {b:.1f} {top - 22 * fs:.1f}" '
            f'stroke="{pal["ink"]}" stroke-width="{9 * fs:.1f}" fill="none" stroke-linecap="round"/>'
            + T((a + b) / 2, top - 62 * fs if top > 70 * fs else 24 * fs, t.upper(), 26 * fs, 900, pal["ink"], "middle", 5 * fs)))


def _table(d: Diagram, o: Dict[str, str], lists: Dict[str, List[str]]) -> None:
    fs = d.fs
    head = split_fields(o.get("head", ""))
    rows = [split_fields(r) for r in lists.get("row", [])]
    if not rows:
        raise DiagramError("A table needs `row:` lines.", "For example `row: Plants | 23 | 15 | 9`.")
    ncols = max(len(r) for r in rows)
    head = (head + [""] * ncols)[:ncols]
    label_w = d.w * 0.27
    cw = (d.w - label_w) / max(1, ncols - 1)
    avail = d.h - d.legend_h - 4 * fs
    rh = min(84 * fs, avail / (len(rows) + 1) - 8 * fs)
    y = 4 * fs
    for j in range(1, ncols):
        d.add("text", label_w + (j - 1) * cw + cw / 2 - 6 * fs, y + rh * 0.72, 0, 0, label=head[j], sel=False,
              extra={"size": 28 * fs, "quiet": True})
    y += rh + 4 * fs
    idx = 0
    for r, row in enumerate(rows, 1):
        row = (row + [""] * ncols)[:ncols]
        d.add("text", 0, y + rh * 0.62, 0, 0, label=row[0], sel=False,
              extra={"size": 32 * fs, "anchor": "start", "weight": 900})
        for j in range(1, ncols):
            idx += 1
            d.add("tcell", label_w + (j - 1) * cw, y, cw - 12 * fs, rh, label=row[j], row=r, col=j, idx=idx)
        y += rh + 8 * fs


def _items(lists: Dict[str, List[str]], key: str = "item") -> List[List[str]]:
    return [split_fields(v) for v in lists.get(key, [])]


def build_line(d: Diagram, o: Dict[str, str], lists: Dict[str, List[str]]) -> None:
    fs = d.fs
    items = _items(lists)
    if len(items) < 2:
        raise DiagramError("This diagram needs at least two `item:` lines.", "For example `item: Design | 2 days | 2`.")
    n = len(items)
    avail_h = d.h - d.legend_h - 4 * fs
    lay = d.layout
    if lay == "timeline":
        ys = d.h * 0.46
        vals = [num(it[0]) for it in items]
        numeric = all(v is not None for v in vals) and len(set(vals)) == n
        pad = 70 * fs
        d.furniture.append(lambda pal: f'<path d="M{pad / 2:.1f} {ys:.1f} H{d.w - pad / 2:.1f}" stroke="{pal["mut"]}" '
                                       f'stroke-width="{6 * fs:.1f}" stroke-linecap="round"/>')
        for i, it in enumerate(items):
            f = (vals[i] - vals[0]) / (vals[-1] - vals[0]) if numeric and vals[-1] != vals[0] else i / (n - 1)
            cx = pad + f * (d.w - 2 * pad)
            d.add("tick", cx - 20 * fs, ys - 20 * fs, 40 * fs, 40 * fs, label=it[0], sub=it[1] if len(it) > 1 else "",
                  idx=i + 1, extra={"up": i % 2 == 0})
        return
    if lay in ("swimlane", "gantt"):
        starts, t = [], 0.0
        rows = []
        for it in items:
            dur = num(it[1], 1) if len(it) > 1 else 1
            st = num(it[2]) if len(it) > 2 and it[2] else t
            rows.append((it[0], dur, st, it[1] if len(it) > 1 else ""))
            t = st + dur
        total = max(s + du for _, du, s, _ in rows) or 1
        lane_w = d.w * 0.2
        tx0, tw = lane_w + 10 * fs, d.w - lane_w - 10 * fs
        rh = min(84 * fs, (avail_h - (n - 1) * 16 * fs) / n)
        y0 = max(4 * fs, (avail_h - (n * rh + (n - 1) * 16 * fs)) / 2)
        for i, (lab, dur, st, raw) in enumerate(rows):
            y = y0 + i * (rh + 16 * fs)
            d.furniture.append(lambda pal, y=y: (f'<rect x="{tx0:.1f}" y="{y:.1f}" width="{tw:.1f}" height="{rh:.1f}" '
                                                 f'rx="{rh / 2:.1f}" fill="{pal["soft"]}"/>'))
            d.add("lane", tx0 + tw * st / total, y, max(30 * fs, tw * dur / total), rh, label=lab, value=raw, idx=i + 1,
                  extra={"lx": 0, "lw": lane_w - 8 * fs, "badge": False, "W": d.w})
        return
    vals = [num(it[1]) if len(it) > 1 else None for it in items]
    numeric = all(v is not None and v > 0 for v in vals)
    vmax = max(v for v in vals if v) if numeric else 1
    if lay == "bars":
        lw = d.w * 0.3
        bx = lw + 18 * fs
        rh = min(80 * fs, (avail_h - (n - 1) * 14 * fs) / n)
        room = d.w - bx - 130 * fs
        y0 = max(4 * fs, (avail_h - (n * rh + (n - 1) * 14 * fs)) / 2)
        for i, it in enumerate(items):
            y = y0 + i * (rh + 14 * fs)
            v = vals[i] or 0
            d.add("bar", bx, y, max(8 * fs, room * v / vmax), rh, label=it[0], value=it[1] if len(it) > 1 else "",
                  idx=i + 1, extra={"lx": bx - 14 * fs, "lw": lw, "W": d.w})
        return
    if lay == "funnel":
        bh = min(96 * fs, (avail_h - (n - 1) * 36 * fs) / n)
        y0 = max(4 * fs, (avail_h - (n * bh + (n - 1) * 36 * fs)) / 2)
        for i, it in enumerate(items):
            f = (vals[i] / vmax) if numeric else 1 - i * 0.6 / max(1, n - 1)
            w = max(d.w * 0.34, d.w * 0.92 * f)
            y = y0 + i * (bh + 36 * fs)
            p = d.add("box", (d.w - w) / 2, y, w, bh, label=it[0], value=it[1] if len(it) > 1 else "", idx=i + 1,
                      extra={"badge": False})
            if i and numeric:
                drop = vals[i - 1] - vals[i]
                d.add("text", d.w - 4 * fs, y - 10 * fs, 0, 0, label=f"−{fmt(drop)}", sel=False,
                      extra={"size": 26 * fs, "anchor": "end", "quiet": True})
        return
    # flow (default): a vertical run of steps, widths by value when there are values
    gap = 46 * fs
    bh = min(120 * fs, (avail_h - (n - 1) * gap) / n)
    y0 = max(4 * fs, (avail_h - (n * bh + (n - 1) * gap)) / 2)
    prev = None
    for i, it in enumerate(items):
        f = (0.36 + 0.64 * vals[i] / vmax) if numeric else 1.0
        w = d.w * min(f, 0.86 if numeric else 1.0)
        y = y0 + i * (bh + gap)
        p = d.add("box", 0, y, w, bh, label=it[0], value=it[1] if len(it) > 1 else "",
                  sub=it[2] if len(it) > 2 else "", idx=i + 1, extra={"limit": d.w})
        if prev:
            d.connectors.append(Connector(prev.id, p.id, 46 * fs, prev.y + prev.h + 4 * fs, 46 * fs, y - 4 * fs))
        prev = p


def build_space(d: Diagram, o: Dict[str, str], lists: Dict[str, List[str]]) -> None:
    fs = d.fs
    W, H = d.w, d.h - d.legend_h
    lay = d.layout
    if lay == "matrix":
        S = min(W * 0.8, H * 0.84)
        x0, y0 = (W - S) / 2 + 30 * fs, 40 * fs
        d.furniture.append(lambda pal: (
            f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{S:.1f}" height="{S:.1f}" rx="{10 * fs:.1f}" fill="none" stroke="{pal["mut"]}" stroke-width="{3 * fs:.1f}"/>'
            f'<path d="M{x0 + S / 2:.1f} {y0:.1f} V{y0 + S:.1f} M{x0:.1f} {y0 + S / 2:.1f} H{x0 + S:.1f}" stroke="{pal["mut"]}" stroke-width="{3 * fs:.1f}"/>'
            + (T(x0 + S / 2, y0 + S + 40 * fs, o["x"].upper() + " →", 26 * fs, 900, pal["grey"], "middle", 2) if o.get("x") else "")
            + (T(x0 - 18 * fs, y0 + S / 2, "↑ " + o["y"].upper(), 26 * fs, 900, pal["grey"], "end", 2) if o.get("y") else "")))
        for i, v in enumerate(lists.get("point", [])):
            f = split_fields(v)
            px, py = _xy(f[0], 2, "point")
            d.add("marker", x0 + px / 100 * S - 15 * fs, y0 + (1 - py / 100) * S - 15 * fs, 30 * fs, 30 * fs,
                  label=f[1] if len(f) > 1 else "", idx=i + 1, extra={"lw": S / 2.2})
        return
    if lay == "meter":
        val = num(o.get("value", ""), None)
        if val is None:
            raise DiagramError("A meter needs `value:`.", "For example `value: 72` and `limit: 55`.")
        mx = num(o.get("max", "100"), 100) or 100
        unit = o.get("unit", "%")
        bh = 110 * fs
        y = H * 0.36
        d.furniture.append(lambda pal: f'<rect x="0" y="{y:.1f}" width="{W:.1f}" height="{bh:.1f}" rx="{14 * fs:.1f}" fill="{pal["soft"]}" stroke="{pal["mut"]}" stroke-width="{2 * fs:.1f}"/>')
        d.add("meter", 0, y, max(10 * fs, W * min(val, mx) / mx), bh, label=o.get("label", f"{fmt(val)}{unit}").upper(),
              idx=1, extra={"calm": False})
        lim = num(o.get("limit", ""), None)
        if lim is not None:
            lx = W * lim / mx
            ltxt = o.get("limit_label", f"LIMIT {fmt(lim)}{unit}")
            d.furniture.append(lambda pal: (
                f'<path d="M{lx:.1f} {y - 36 * fs:.1f} V{y + bh + 36 * fs:.1f}" stroke="{pal["ink"]}" stroke-width="{5 * fs:.1f}" stroke-dasharray="12 9"/>'
                + T(min(lx + 14 * fs, W), y - 46 * fs, ltxt.upper(), 26 * fs, 900, pal["ink"], "end" if lx > W * 0.7 else "start")))
        if o.get("note"):
            d.add("text", 0, y + bh + 100 * fs, 0, 0, label=o["note"].upper(), idx=2,
                  extra={"size": 32 * fs, "anchor": "start", "weight": 900})
        return
    if lay == "scale":
        items = _items(lists)
        if not items:
            raise DiagramError("A scale diagram needs `item:` lines.", "For example `item: A village | 1`.")
        vals = [max(num(it[1], 1) or 1, 1e-9) for it in items]
        gap = 26 * fs
        k = min((W - gap * (len(items) - 1)) / sum(math.sqrt(v) for v in vals), (H * 0.8) / math.sqrt(max(vals)))
        sides = [k * math.sqrt(v) for v in vals]
        x = (W - sum(sides) - gap * (len(items) - 1)) / 2
        base = H * 0.86
        for i, (it, s) in enumerate(zip(items, sides)):
            d.add("square", x, base - s, s, s, label=it[0], idx=i + 1, extra={"lw": max(s + gap, 150 * fs)})
            x += s + gap
        return
    # free layout: parts placed in percentages of the box
    def px(v): return v / 100 * W
    def py(v): return v / 100 * H
    for v in lists.get("box", []):
        f = split_fields(v)
        x, y, w, h = _xy(f[0], 4, "box")
        d.add("box", px(x), py(y), px(w), py(h), label=f[1] if len(f) > 1 else "", sub=f[2] if len(f) > 2 else "",
              extra={"badge": False})
    for v in lists.get("circle", []):
        f = split_fields(v)
        x, y, r = _xy(f[0], 3, "circle")
        rr = px(r)
        d.add("disc", px(x) - rr, py(y) - rr, 2 * rr, 2 * rr, label=f[1] if len(f) > 1 else "")
    for v in lists.get("dot", []):
        f = split_fields(v)
        x, y = _xy(f[0], 2, "dot")
        d.add("marker", px(x) - 15 * fs, py(y) - 15 * fs, 30 * fs, 30 * fs, label=f[1] if len(f) > 1 else "")
    for v in lists.get("text", []):
        f = split_fields(v)
        x, y = _xy(f[0], 2, "text")
        d.add("text", px(x), py(y), 0, 0, label=f[1] if len(f) > 1 else "",
              extra={"size": (num(f[2], 30) or 30) * fs if len(f) > 2 else 30 * fs})
    for key in ("arrow", "line"):
        for v in lists.get(key, []):
            f = split_fields(v)
            a, _, b = f[0].partition(">")
            x1, y1 = _xy(a, 2, key)
            x2, y2 = _xy(b, 2, key)
            d.add(key, px(x1), py(y1), 0, 0, label=f[1] if len(f) > 1 else "", extra={"x2": px(x2), "y2": py(y2)})
    for v in lists.get("leader", []):
        f = split_fields(v)
        a, _, b = f[0].partition(">")
        x1, y1 = _xy(a, 2, "leader")
        x2, y2 = _xy(b, 2, "leader")
        d.add("leader", px(x1), py(y1), 0, 0, label=f[1] if len(f) > 1 else "", extra={"x2": px(x2), "y2": py(y2)})
    if not d.parts:
        raise DiagramError("An empty `space` diagram.", "Add `box:`, `dot:`, `text:`, `arrow:` or `leader:` lines, or use a layout like matrix, meter or scale.")
    for i, p in enumerate(d.parts):
        p.idx = i + 1
        if p.kind in ("arrow", "line", "leader"):       # the box a `mark:` outlines
            p.extra["bbox"] = (min(p.x, p.extra["x2"]), min(p.y, p.extra["y2"]),
                               abs(p.extra["x2"] - p.x), abs(p.extra["y2"] - p.y))


def build_ring(d: Diagram, o: Dict[str, str], lists: Dict[str, List[str]]) -> None:
    fs = d.fs
    items = _items(lists)
    n = len(items)
    if not 3 <= n <= 10:
        raise DiagramError("A cycle needs between 3 and 10 `item:` lines.", "For example `item: Research` ... `item: Learn`.")
    W, H = d.w, d.h - d.legend_h
    box = min(W, H)
    rn = min(box * 0.5 * math.sin(math.pi / n) / (1 + math.sin(math.pi / n)) * 0.92, box * 0.2)
    R = box / 2 - rn - 6 * fs
    cx, cy = W / 2, H / 2
    parts = []
    for i, it in enumerate(items):
        a = -math.pi / 2 + i * 2 * math.pi / n
        x, y = cx + R * math.cos(a), cy + R * math.sin(a)
        parts.append(d.add("node", x - rn, y - rn, 2 * rn, 2 * rn, label=it[0], sub=it[1] if len(it) > 1 else "", idx=i + 1))
    gap = (rn + 8 * fs) / R
    for i in range(n):
        a0 = -math.pi / 2 + i * 2 * math.pi / n + gap
        a1 = -math.pi / 2 + (i + 1) * 2 * math.pi / n - gap
        d.connectors.append(Connector(parts[i].id, parts[(i + 1) % n].id, cx + R * math.cos(a0), cy + R * math.sin(a0),
                                      cx + R * math.cos(a1), cy + R * math.sin(a1), "arc",
                                      {"cx": cx, "cy": cy, "r": R, "end_angle": a1}))


def build_tree(d: Diagram, o: Dict[str, str], lists: Dict[str, List[str]]) -> None:
    fs = d.fs
    root = split_fields(o.get("root", ""))
    if not root or not root[0]:
        raise DiagramError("A tree needs a `root:` line.", "For example `root: Revenue` then `item: Auto | 56%`.")
    nodes = [{"label": root[0], "value": root[1] if len(root) > 1 else "", "parent": None, "kids": []}]
    for it in _items(lists):
        nodes.append({"label": it[0], "value": it[1] if len(it) > 1 else "", "parent": it[2] if len(it) > 2 and it[2] else root[0], "kids": []})
    if len(nodes) < 2:
        raise DiagramError("A tree needs `item:` lines under the root.", "")
    by_label = {n["label"].lower(): n for n in nodes}
    for n in nodes[1:]:
        par = by_label.get((n["parent"] or "").lower())
        if par is None or par is n:
            raise DiagramError(f"'{n['label']}' names a parent '{n['parent']}' that isn't in the tree.", "The parent is the third field: `item: Mobile | 20% | Phones`.")
        par["kids"].append(n)

    def depth(n, seen=()):
        if id(n) in seen:
            raise DiagramError("The tree has a loop.", "")
        return 1 + max((depth(k, seen + (id(n),)) for k in n["kids"]), default=0)

    L = depth(nodes[0])
    leaves = [0]

    def place(n, lvl):
        if not n["kids"]:
            n["xi"] = leaves[0]
            leaves[0] += 1
        else:
            for k in n["kids"]:
                place(k, lvl + 1)
            n["xi"] = (n["kids"][0]["xi"] + n["kids"][-1]["xi"]) / 2
        n["lvl"] = lvl

    place(nodes[0], 0)
    avail_h = d.h - d.legend_h
    col = d.w / max(leaves[0], 1)
    bw = min(230 * fs, col - 14 * fs)
    bh = min(96 * fs, avail_h / L * 0.56)
    row_h = (avail_h - bh - 8 * fs) / max(L - 1, 1) if L > 1 else 0
    made = {}
    for i, n in enumerate(nodes):
        x = col * (n["xi"] + 0.5) - bw / 2
        y = 4 * fs + n["lvl"] * row_h
        made[id(n)] = d.add("box", x, y, bw, bh, label=n["label"], sub=n["value"], idx=i + 1, extra={"badge": False})
    for n in nodes:
        for k in n["kids"]:
            a, b = made[id(n)], made[id(k)]
            d.connectors.append(Connector(a.id, b.id, a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, "elbow"))


def build_nest(d: Diagram, o: Dict[str, str], lists: Dict[str, List[str]]) -> None:
    fs = d.fs
    W, H = d.w, d.h - d.legend_h
    lay = d.layout
    if lay in ("overlap", "venn"):
        sets = [split_fields(v) for v in lists.get("set", [])]
        if not 2 <= len(sets) <= 3:
            raise DiagramError("An overlap needs 2 or 3 `set:` lines.", "For example `set: Cheap` and `set: Fast`, then `overlap: Only | 9%`.")
        r = min(H * (0.29 if len(sets) == 3 else 0.46), W * (0.29 if len(sets) == 3 else 0.30))
        if len(sets) == 2:
            centers = [(W / 2 - 0.58 * r, H / 2), (W / 2 + 0.58 * r, H / 2)]
            labs = [(W / 2 - 1.02 * r, H / 2), (W / 2 + 1.02 * r, H / 2)]
        else:
            centers = [(W / 2 - 0.55 * r, H / 2 - 0.40 * r + 0.18 * r), (W / 2 + 0.55 * r, H / 2 - 0.40 * r + 0.18 * r), (W / 2, H / 2 + 0.58 * r + 0.18 * r - 0.1 * r)]
            labs = [(centers[0][0] - 0.45 * r, centers[0][1] - 0.35 * r), (centers[1][0] + 0.45 * r, centers[1][1] - 0.35 * r), (centers[2][0], centers[2][1] + 0.62 * r)]
        circles = []
        for i, (s, (cx, cy), (lx, ly)) in enumerate(zip(sets, centers, labs)):
            d.add("disc", cx - r, cy - r, 2 * r, 2 * r, label=s[0], sub=s[1] if len(s) > 1 else "", idx=i + 1,
                  extra={"lx": lx, "ly": ly, "lw": r * 0.9})
            circles.append((cx, cy, r))
        ov = split_fields(o.get("overlap", "")) if o.get("overlap") else None
        if ov:
            d.add("lens", W / 2 - r * 0.4, H / 2 - r * 0.4 + (0.1 * r if len(sets) == 3 else 0), 0.8 * r, 0.8 * r,
                  label=ov[0], value=ov[1] if len(ov) > 1 else "", idx=len(sets) + 1,
                  extra={"circles": circles, "clip": len(d.parts)})
        return
    if lay == "concentric":
        items = _items(lists, "layer")
        if len(items) < 2:
            raise DiagramError("Concentric rings need 2 or more `layer:` lines, biggest first.", "For example `layer: Everyone | 100`.")
        vals = [max(num(it[1], 0) or 0, 1e-9) if len(it) > 1 else None for it in items]
        if any(v is None for v in vals):
            vals = [len(items) - i for i in range(len(items))]
        R = min(W / 2, H / 2 - 6 * fs)
        vmax = max(vals)
        for i, it in enumerate(items):
            r = max(R * math.sqrt(vals[i] / vmax), 20 * fs)
            above = 2 * r - (2 * (R * math.sqrt(vals[i + 1] / vmax)) if i + 1 < len(items) else 0)
            d.add("disc", W / 2 - r, 4 * fs + (2 * R - 2 * r), 2 * r, 2 * r, label=it[0], sub=it[1] if len(it) > 1 else "", idx=i + 1,
                  extra={"lx": W / 2, "ly": 4 * fs + (2 * R - 2 * r) + 44 * fs, "lw": r * 1.2})
        return
    # section: stacked slabs, heights by value when given
    items = _items(lists, "layer")
    if len(items) < 2:
        raise DiagramError("A section needs 2 or more `layer:` lines, top first.", "For example `layer: Package | 44`.")
    vals = [num(it[1]) if len(it) > 1 else None for it in items]
    weights = [max(v, 1) if v else 1 for v in vals]
    gap = 8 * fs
    note_h = 54 * fs if o.get("note") else 0
    total_h = H - note_h - gap * (len(items) - 1) - 40 * fs
    y = 40 * fs
    if o.get("title"):
        d.furniture.append(lambda pal: T(0, 24 * fs, o["title"].upper(), 26 * fs, 900, pal["grey"]))
    for i, it in enumerate(items):
        h = max(48 * fs, total_h * weights[i] / sum(weights))
        d.add("slab", W * 0.04, y, W * 0.92, h, label=it[0], value=it[1] if len(it) > 1 else "",
              sub=it[2] if len(it) > 2 else "", idx=i + 1)
        y += h + gap
    if o.get("note"):
        d.add("text", W * 0.04, y + 34 * fs, 0, 0, label=o["note"].upper(), idx=len(items) + 1,
              extra={"size": 30 * fs, "anchor": "start", "weight": 900})


BUILDERS = {"grid": build_grid, "line": build_line, "space": build_space, "ring": build_ring,
            "tree": build_tree, "nest": build_nest}
DEFAULT_LAYOUT = {"grid": "seat", "line": "flow", "space": "free", "ring": "cycle", "tree": "tree", "nest": "section"}


# ----------------------------------------------------------------------------- parse a whole recipe

def _merge(base: List[Tuple[str, str]], over: List[Tuple[str, str]]) -> List[Tuple[str, str]]:
    """A preset's lines under a slide's own. For a repeated key the slide's lines take the place of the
    preset's (same position, so the order the preset set up still reads right); other keys add on."""
    mine: Dict[str, List[Tuple[str, str]]] = {}
    for k, v in over:
        if k in LIST_KEYS:
            mine.setdefault(k, []).append((k, v))
    out: List[Tuple[str, str]] = []
    placed: Set[str] = set()
    for k, v in base:
        if k in mine:
            if k not in placed:
                out += mine[k]
                placed.add(k)
        else:
            out.append((k, v))
    return out + [(k, v) for k, v in over if not (k in LIST_KEYS and k in placed)]


def parse_diagram(text: str, canvas_w: int = 1080, canvas_h: int = 1920,
                  box: Optional[Tuple[int, int, int, int]] = None) -> Diagram:
    """The `diagram:` block of a slide (first line is the engine or preset name, the rest are its lines).
    `box` (x, y, width, height in canvas pixels) overrides where and how big it is drawn: the pipeline
    uses it to fit the diagram into the room the slide's own text leaves."""
    text = (text or "").strip("\n")
    first, _, rest = text.partition("\n")
    head = first.strip().lower().replace(" ", "")
    entries = _entries(rest, "the diagram block")
    for _ in range(3):                  # a recipe may name a preset, a preset may name another
        if head in ENGINES:
            break
        body = _preset_text(head)
        if body is None:
            names = ", ".join(list_presets()) or "none found"
            raise DiagramError(f"I don't know a diagram called '{head}'.",
                               f"Use an engine ({', '.join(ENGINES)}) or a preset: {names}.")
        pre = _entries(body, f"the '{head}' preset")
        eng = [v for k, v in pre if k == "engine"]
        entries = _merge([(k, v) for k, v in pre if k != "engine"], entries)
        head = (eng[-1] if eng else "").lower()
    if head not in ENGINES:
        raise DiagramError("A diagram needs an engine.", f"Use one of: {', '.join(ENGINES)}.")
    o: Dict[str, str] = {}
    lists: Dict[str, List[str]] = {}
    for k, v in entries:
        (lists.setdefault(k, []).append(v)) if k in LIST_KEYS else o.__setitem__(k, v)
    layout = o.get("layout", DEFAULT_LAYOUT[head]).lower()
    # size and place the box (centre, percent of the canvas)
    w, h = 880, 640
    if "size" in o:
        a, b = _two(o["size"], "size")
        w, h = a, b
    w, h = int(max(200, min(w, canvas_w))), int(max(150, min(h, canvas_h)))
    ax, ay = (_xy(o["at"], 2, "at") if "at" in o else [50.0, 57.0])
    x = int(min(max(ax / 100 * canvas_w - w / 2, 0), canvas_w - w))
    y = int(min(max(ay / 100 * canvas_h - h / 2, 0), canvas_h - h))
    if box:
        x, y, w, h = box
    d = Diagram(head, layout, w, h, x, y)
    d.source = text
    d.placed = "size" in o or "at" in o
    labelled = any('"' in v and not re.match(r'^\s*"[^"]*"\s*$', v) for k in DIRECTIVE_KEYS for v in lists.get(k, []))
    mode = o.get("legend", "auto" if labelled else "off").lower()
    d.legend = mode not in ("off", "no", "none") and labelled
    d.legend_h = 56 * d.fs if d.legend else 0
    BUILDERS[head](d, o, lists)
    if not d.parts:
        raise DiagramError("The diagram came out empty.", "")
    # `rest` means the parts no other line named, wherever it is written, so selectors that don't use
    # it are resolved first
    pending = []
    for k, v in entries:
        if k in DIRECTIVE_KEYS or k == "mark":
            sel, label, cue = split_directive(v)
            pending.append((k, sel, label, cue, bool(re.search(r"\brest\b", sel.lower()))))
    used: Set[int] = set()
    resolved: Dict[int, Set[int]] = {}
    for n, (k, sel, label, cue, has_rest) in enumerate(pending):
        if not has_rest:
            resolved[n] = select(sel, d.parts, set(), k)
            if k in STATES:
                used |= resolved[n]
    for n, (k, sel, label, cue, has_rest) in enumerate(pending):
        if has_rest:
            resolved[n] = select(sel, d.parts, used, k)
    for n, (k, sel, label, cue, _) in enumerate(pending):
        if k == "mark":
            d.marks.append(Mark(resolved[n], label, cue))
        else:
            d.directives.append(Directive(k, resolved[n], label, cue, rest=pending[n][4]))
    if len(d.cues()) > MAX_CUES:
        raise DiagramError(f"Too many `@ \"word\"` cues ({len(d.cues())}).", f"Use at most {MAX_CUES} per diagram.")
    return d


# ----------------------------------------------------------------------------- when the cues happen

def plan_steps(cues: Sequence[str], words, t0: float, t1: float, exit_s: float, find_cue, lead: float = 0.18,
               gap: float = 0.4) -> Tuple[List[Tuple[float, List[str]]], List[str]]:
    """The moments the picture changes, as [(time, cues applied by then)], plus cues never heard.

    The first picture (everything without a cue) arrives just after the slide starts; each cue brings the
    next one `lead` seconds before its word. Cues keep the order of the recipe when they can; a cue not
    heard in the narration is spread across what is left of the slide and reported."""
    latest = max(t0 + 0.6, t1 - exit_s - 0.5)
    first = t0 + 0.3
    times: List[Optional[float]] = []
    missed: List[str] = []
    after = 0
    for cue in cues:
        idx = find_cue(cue, words, after)
        if idx is None:
            idx = find_cue(cue, words, 0)
        if idx is None:
            missed.append(cue)
            times.append(None)
        else:
            times.append(words[idx].start - lead)
            after = idx + 1
    n = len(cues)
    for i, t in enumerate(times):
        if t is None:
            times[i] = first + (latest - first) * (i + 1) / (n + 1)
    order = sorted(range(n), key=lambda i: times[i])
    out: List[Tuple[float, List[str]]] = [(first, [])]
    prev = first
    applied: List[str] = []
    for i in order:
        t = min(max(times[i], prev + gap), latest)
        t = max(t, prev + 0.12)
        applied = applied + [cues[i]]
        out.append((t, list(applied)))
        prev = t
    return out, missed
