"""Explainer objects and diagrams on a post's slides: the same `objects:` and `diagram:` lines a reel
script uses, drawn once, in their finished state, instead of animated.

    ## point
    headline: Where the money goes
    diagram:
      layout: flow
      item: Sales
      item: Stock
      item: Cash

Nothing here is a copy of the reel code: the lines are lifted out by the reel's own reader
(reel.script._split), parsed by reel.objects / reel.diagram, and drawn from the same SVG makers. The
reel imports are made on use, so a post never loads reel code unless a slide asks for it.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from .parser import ParsedSpec, SpecIssue, parse_spec

# The lines a post accepts beyond the reel-free spec; each maps to the key the slide dict carries.
OVERLAY_KEYS = {
    "objects": "objects", "overlay": "objects", "overlays": "objects", "obj": "objects",
    "diagram": "diagram", "figure": "diagram",
}
MIN_ROOM = 340           # the least height a diagram needs under a slide's own text
MAX_ROOM = 860


def parse_post(text: str, base_dir: Optional[Path] = None, require_marker: bool = True) -> ParsedSpec:
    """parse_spec, plus `objects:` / `diagram:` lines kept on each slide as slide["objects"] / slide["diagram"]
    (the raw text; the renderer draws them). Bad lines come back as issues with their line numbers."""
    from ..reel.script import _split
    _, sections, clean = _split(text, OVERLAY_KEYS, header_too=False)
    spec = parse_spec(clean, base_dir=base_dir, require_marker=require_marker)
    if not any(sections.values()):
        return spec
    from ..reel.diagram import DiagramError, parse_diagram
    from ..reel.objects import object_problems, parse_objects
    for i, slide in enumerate(spec.slides):
        line = spec.slide_lines[i] if i < len(spec.slide_lines) else 0
        sec = sections.get(line)
        if not sec:
            continue
        n = i + 1
        if "objects" in sec:
            raw, at = sec["objects"]
            if parse_objects(raw):
                slide["objects"] = raw
            for problem in object_problems(raw):
                spec.issues.append(SpecIssue("WARN", "OBJECT_IGNORED", f"Slide {n}'s objects: {problem}.", slide=n, line=at,
                                             hint="Write each as `name @ x,y size colour`, with a built-in shape name."))
        if "diagram" in sec:
            raw, at = sec["diagram"]
            try:
                d = parse_diagram(raw)
                if not d.placed:        # it is fitted to the room under the slide's text: check it fits there too
                    parse_diagram(raw, box=(100, 0, 880, 380))
                slide["diagram"] = raw
            except DiagramError as e:
                spec.issues.append(SpecIssue("ERROR", "DIAGRAM_BAD", f"Slide {n}'s diagram: {e}", slide=n, line=at,
                                             hint=e.hint or None))
    return spec


_INK_JS = """
() => {
  const box = document.querySelector('.content-container');
  if (!box) return 0;
  let low = 0;
  for (const e of box.querySelectorAll('*')) {
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) continue;
    const tag = e.tagName.toLowerCase();
    const text = [...e.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
    if (!(text || tag === 'svg' || tag === 'img' || e.classList.contains('image-frame'))) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) low = Math.max(low, r.bottom);
  }
  return low;
}
"""


def draw(page, slide: Dict[str, Any], accent: Optional[str], width: int, height: int, footer_y: int) -> List[str]:
    """Draw the slide's objects and diagram onto the laid-out page. Returns plain-words problems
    (a diagram with no room under the text), empty when everything fit."""
    problems: List[str] = []
    theme = slide.get("theme") or "light"
    parts: List[str] = []
    n = slide.get("n", 1)

    if slide.get("diagram"):
        from ..reel.diagram import DiagramError, parse_diagram
        ink = int(page.evaluate(_INK_JS) or 0)
        top = ink + 28
        bottom = int(footer_y) - 40
        room = bottom - top
        if room < MIN_ROOM:
            problems.append(f"only {max(room, 0)}px is left for the diagram under the text; shorten the text or use fewer bullets")
            top = max(bottom - MIN_ROOM, 0)
            room = MIN_ROOM
        try:
            d = parse_diagram(slide["diagram"], width, height, box=(100, top, width - 200, int(min(room, MAX_ROOM))))
        except DiagramError as e:
            problems.append(f"the diagram doesn't fit the room under the text: {e} {e.hint or ''}".strip())
            d = None
        if d is not None:
            svg = d.svg(d.cues(), theme, accent)       # every step applied: the finished picture
            parts.append(f'<div style="position:absolute;left:{d.x}px;top:{d.y}px;width:{d.w}px;height:{d.h}px">{svg}</div>')

    if slide.get("objects"):
        from ..reel.objects import obj_position, parse_objects, render_object_svg
        for obj in parse_objects(slide["objects"]):
            svg = render_object_svg(obj, theme=theme, accent=accent)
            cx = int(obj.x_pct / 100.0 * width)
            cy = int(obj.y_pct / 100.0 * height)
            rot = f" rotate({obj.rotate}deg)" if obj.rotate else ""
            parts.append(f'<div style="position:absolute;left:{cx}px;top:{cy}px;transform:translate(-50%,-50%){rot}">{svg}</div>')

    if parts:
        markup = "".join(parts)
        page.evaluate(
            "(h) => { const o = document.createElement('div'); o.id = 'post-overlays';"
            " o.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:60;pointer-events:none';"
            " o.innerHTML = h; document.body.appendChild(o); }", markup)
    return problems
