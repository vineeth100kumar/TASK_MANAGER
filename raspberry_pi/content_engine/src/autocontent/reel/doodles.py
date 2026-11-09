"""The background lines of a reel: dashed doodles in the brand colour that draw themselves on and
then keep flowing along their own path for as long as the slide is up.

A post's doodle is a fixed drawing at a fixed spot. In a reel the slide is taller and its text
lands in a different place every time, so the reel places its own: a few shapes (a curl, a wave,
a corner sweep, a margin squiggle) are tried at many sizes and spots, and only the ones that
stay clear of every word, rule, picture and the caption band are kept. On a cover or a closing
slide the curl is put beside the pill, like the post's own; elsewhere the line sits quietly in
the free space, a little lighter.

A dashed line is something drawn, so it is drawn on (the pen moves along it); once drawn, its
dashes run along it slowly, the way a dashed path shows a route. Both are photographed in the
browser, frame by frame, so the compositor only has to pick the right picture.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DRAW_FRAMES = 30       # pictures of the line being drawn on
FLOW_FRAMES = 16       # pictures of one dash period flowing along it (they loop)
DASH = (16, 16)        # the brand's dashed line: dash, gap
STROKE = 7.0
MARGIN = 56            # how far a line keeps from anything else on the slide
CAPTION_BAND = (1480, 1710)   # where the captions are drawn (captions.CENTER_Y = 1590)
TOP_BAND = 240         # the brand row and the progress bar: lines stay below it
MAX_LINES = 2

# Shapes in their own coordinates, every number an (x, y) pair after M / C / S.
SHAPES: Dict[str, str] = {
    # the post's curl: comes in, loops once, carries on
    "curl": "M 0 300 C 60 305, 120 305, 190 275 C 255 250, 300 190, 290 110 C 280 30, 235 -10, 180 0 "
            "C 125 10, 85 70, 90 140 C 95 200, 135 225, 180 230 C 225 235, 270 250, 340 255",
    # a calm wave across a gap
    "wave": "M 0 40 C 60 0, 120 0, 180 40 S 300 80, 360 40 S 480 0, 540 40",
    # a sweep round a corner
    "arc": "M 0 0 C 0 170, 130 300, 310 310",
    # a squiggle down a margin
    "squiggle": "M 30 0 C 0 60, 0 120, 30 180 S 60 300, 30 360 S 0 480, 30 540",
}
SCALES = (1.0, 0.82, 0.66)


@dataclass
class Doodle:
    draw: List[Path]                     # the line being drawn on, from the first stroke to complete
    flow: List[Path]                     # one dash period flowing along it; loops
    box: Tuple[int, int, int, int]       # x, y, w, h on the canvas
    length: float                        # px along the line
    featured: bool = False               # the curl beside a cover or closing pill
    opacity: float = 1.0
    shape: str = ""
    period: float = float(sum(DASH))


def _numbers(d: str) -> List[float]:
    return [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", d)]


def transform(d: str, scale: float, mirror: bool, flip: bool = False) -> Tuple[str, float, float]:
    """The shape scaled, optionally mirrored left-right / top-bottom, moved to start at 0,0 of its
    own box. Returns (d, width, height)."""
    nums = _numbers(d)
    xs, ys = nums[0::2], nums[1::2]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = (x1 - x0) * scale, (y1 - y0) * scale

    def pair(m: "re.Match[str]") -> str:
        x, y = float(m.group(1)), float(m.group(2))
        x, y = (x - x0) * scale, (y - y0) * scale
        if mirror:
            x = w - x
        if flip:
            y = h - y
        return f"{x:.1f} {y:.1f}"

    out = re.sub(r"(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)", pair, d)
    return out, w, h


# Runs in the page: where each candidate fits. Everything on the slide that shows is an obstacle,
# measured tightly (the words themselves, not the boxes they sit in).
FIT_JS = r"""
(a) => {
  const W = a.W, H = a.H, M = a.margin;
  const obs = [];
  const add = (r) => { if (r.width > 0.5 && r.height > 0.5) obs.push([r.left - M, r.top - M, r.right + M, r.bottom + M]); };
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walk.nextNode())) {
    if (!node.nodeValue.trim()) continue;
    const st = window.getComputedStyle(node.parentElement);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    [...range.getClientRects()].forEach(add);
  }
  for (const e of document.body.querySelectorAll('*')) {
    const st = window.getComputedStyle(e);
    if (st.display === 'none' || st.visibility === 'hidden' || e.closest('#__doodles')) continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height > W * H * 0.4 || r.width < 1 || r.height < 1) continue;
    const tag = e.tagName.toLowerCase();
    const bg = st.backgroundColor || '';
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const alpha = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0;
    if (alpha > 0.05 || ['img', 'svg', 'canvas', 'video'].includes(tag) || (st.backgroundImage && st.backgroundImage !== 'none')) add(r);
  }
  for (const b of a.reserved) obs.push(b);
  // an occupancy grid of 8px cells, so testing a point is one look-up
  const C = 8, GW = Math.ceil(W / C), GH = Math.ceil(H / C);
  const grid = new Uint8Array(GW * GH);
  for (const o of obs) {
    const gx0 = Math.max(0, Math.floor(o[0] / C)), gx1 = Math.min(GW - 1, Math.floor(o[2] / C));
    const gy0 = Math.max(0, Math.floor(o[1] / C)), gy1 = Math.min(GH - 1, Math.floor(o[3] / C));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) grid[gy * GW + gx] = 1;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:1px;height:1px;visibility:hidden');
  document.body.appendChild(svg);
  const out = [];
  a.shapes.forEach((sh, si) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', sh.d);
    svg.appendChild(p);
    const L = p.getTotalLength();
    const pts = [];
    for (let s = 0; s <= L; s += 9) { const q = p.getPointAtLength(s); pts.push([q.x, q.y]); }
    for (const [tx, ty] of a.spots) {
      let inside = 0, bad = false;
      for (const [px, py] of pts) {
        const x = px + tx, y = py + ty;
        if (x >= 0 && x < W && y >= 0 && y < H) {
          inside++;
          if (grid[Math.floor(y / C) * GW + Math.floor(x / C)]) { bad = true; break; }
        }
      }
      if (bad) continue;
      const shown = inside / pts.length;
      if (shown < 0.8) continue;
      out.push([si, tx, ty, L * shown]);
    }
  });
  svg.remove();
  return out;
}
"""

COLOUR_JS = """
() => {
  for (const sel of ['.accent-bar', '.accent-pill', '.cta-pill', '.bullet-mark', '.item-bullet']) {
    const e = document.querySelector(sel);
    if (!e) continue;
    const c = window.getComputedStyle(e).backgroundColor;
    if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c;
  }
  const h = document.querySelector('.hlw, .kicker');
  return h ? window.getComputedStyle(h).color : '#EE4425';
}
"""


def _candidates(width: int, height: int) -> Tuple[List[Dict[str, Any]], List[Tuple[int, int]]]:
    shapes = []
    for name, d in SHAPES.items():
        for scale in SCALES:
            for mirror in (False, True):
                td, w, h = transform(d, scale, mirror)
                shapes.append({"name": name, "d": td, "w": w, "h": h, "scale": scale, "mirror": mirror})
    spots = [(x, y) for y in range(-120, height, 40) for x in range(-160, width, 40)]
    return shapes, spots


def _overlaps(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float], pad: float) -> bool:
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def choose(found: List[list], shapes: List[Dict[str, Any]], n: int, featured_near: Optional[Tuple[float, float, float, float]],
           width: int, height: int) -> List[Tuple[Dict[str, Any], float, float, float, bool]]:
    """Pick the lines for one slide from every spot that fits: (shape, x, y, length, featured)."""
    if not found:
        return []
    picks: List[Tuple[Dict[str, Any], float, float, float, bool]] = []
    boxes: List[Tuple[float, float, float, float]] = []
    order = list(SHAPES)
    order = order[n % len(order):] + order[:n % len(order)]       # a different shape leads on each slide

    def box_of(c: list) -> Tuple[float, float, float, float]:
        sh = shapes[c[0]]
        return (c[1], c[2], c[1] + sh["w"], c[2] + sh["h"])

    if featured_near is not None:
        curls = [c for c in found if shapes[c[0]]["name"] == "curl"]
        if curls:
            px, py = featured_near[2], (featured_near[1] + featured_near[3]) / 2

            def gap(c: list) -> float:
                b = box_of(c)
                # the curl's start beside the pill's right end, about level with it
                sx, sy = b[0] + (0 if not shapes[c[0]]["mirror"] else shapes[c[0]]["w"]), b[3] - 10
                return abs(sx - px) + abs(sy - py) * 1.4 - shapes[c[0]]["scale"] * 60
            best = min(curls, key=gap)
            if gap(best) < 360:
                picks.append((shapes[best[0]], best[1], best[2], best[3], True))
                boxes.append(box_of(best))
    for name in order:
        if len(picks) >= MAX_LINES:
            break
        if any(sh["name"] == name for sh, *_ in picks):
            continue                                  # two of the same shape on one slide reads as a pattern
        pool = [c for c in found if shapes[c[0]]["name"] == name and not any(_overlaps(box_of(c), b, 140) for b in boxes)]
        if not pool:
            continue
        # the longest that fits, then the one nearest the frame's edge (a line coming in from outside)
        def score(c: list) -> float:
            b = box_of(c)
            edge = min(max(0.0, b[0]), max(0.0, width - b[2]))
            return c[3] - edge * 0.35
        best = max(pool, key=score)
        if best[3] < 260:
            continue
        picks.append((shapes[best[0]], best[1], best[2], best[3], False))
        boxes.append(box_of(best))
        if not featured_near and len(picks) == 1 and best[3] < 520:
            break                                    # one modest line is plenty on a busy slide
    return picks


SVG_JS = r"""
(a) => {
  const ns = 'http://www.w3.org/2000/svg';
  let svg = document.getElementById('__doodles');
  if (!svg) {
    svg = document.createElementNS(ns, 'svg');
    svg.id = '__doodles';
    svg.setAttribute('viewBox', `0 0 ${a.W} ${a.H}`);
    svg.setAttribute('style', `position:absolute;left:0;top:0;width:${a.W}px;height:${a.H}px;pointer-events:none;z-index:1`);
    document.body.appendChild(svg);
  }
  svg.setAttribute('data-reel-group', 'doodle');
  svg.innerHTML = `<defs><mask id="__dm" maskUnits="userSpaceOnUse" x="0" y="0" width="${a.W}" height="${a.H}">
      <path id="__dmp" d="${a.d}" fill="none" stroke="#fff" stroke-width="${a.sw + 10}" stroke-linecap="butt"/></mask></defs>
    <path id="__dp" d="${a.d}" transform="translate(${a.tx} ${a.ty})" fill="none" stroke="${a.colour}" stroke-width="${a.sw}"
      stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${a.dash}"/>`;
  svg.querySelector('#__dmp').setAttribute('transform', `translate(${a.tx} ${a.ty})`);
  return svg.querySelector('#__dp').getTotalLength();
}
"""

STEP_JS = r"""
(a) => {
  const p = document.getElementById('__dp');
  const m = document.getElementById('__dmp');
  if (a.draw !== null) {
    p.setAttribute('mask', 'url(#__dm)');
    m.setAttribute('stroke-dasharray', `${a.draw} ${a.L + 100}`);
    p.setAttribute('stroke-dashoffset', '0');
  } else {
    p.removeAttribute('mask');
    p.setAttribute('stroke-dashoffset', String(-a.flow));
  }
}
"""


def make(page, slide: Dict[str, Any], theme: str, out_dir: Path, n: int, width: int, height: int) -> List[Doodle]:
    """Place, draw and photograph this slide's background lines. Never fails the reel: a slide with
    no free space simply has none."""
    try:
        return _make(page, slide, theme, out_dir, n, width, height)
    except Exception:
        try:
            page.evaluate("() => { const s = document.getElementById('__doodles'); if (s) s.remove(); }")
        except Exception:
            pass
        return []


def _make(page, slide: Dict[str, Any], theme: str, out_dir: Path, n: int, width: int, height: int) -> List[Doodle]:
    shapes, spots = _candidates(width, height)
    # the brand row at the top, and everything from the captions down (they and the handle)
    reserved = [[-200, -200, width + 200, TOP_BAND], [-200, CAPTION_BAND[0], width + 200, height + 200]]
    found = page.evaluate(FIT_JS, {"W": width, "H": height, "margin": MARGIN, "reserved": reserved,
                                   "shapes": [{"d": s["d"]} for s in shapes], "spots": spots})
    pill = None
    if slide.get("type") in ("cover", "cta"):
        pill = page.evaluate("""() => { const e = document.querySelector('.accent-pill, .cta-pill');
            if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }""")
    picks = choose(found, shapes, n, tuple(pill) if pill else None, width, height)
    colour = "rgb(255, 255, 255)" if theme == "accent" else page.evaluate(COLOUR_JS)
    out: List[Doodle] = []
    for j, (sh, tx, ty, _, featured) in enumerate(picks):
        L = page.evaluate(SVG_JS, {"W": width, "H": height, "d": sh["d"], "tx": tx, "ty": ty, "colour": colour,
                                   "sw": STROKE, "dash": f"{DASH[0]} {DASH[1]}"})
        pad = STROKE + 6
        x0, y0 = max(0, int(tx - pad)), max(0, int(ty - pad))
        x1, y1 = min(width, int(tx + sh["w"] + pad)), min(height, int(ty + sh["h"] + pad))
        clip = (x0, y0, max(2, x1 - x0), max(2, y1 - y0))
        draw, flow = [], []
        for i in range(1, DRAW_FRAMES + 1):
            page.evaluate(STEP_JS, {"draw": L * i / DRAW_FRAMES, "flow": 0, "L": L})
            path = out_dir / f"s{n:02d}_d{j}_draw{i:02d}.png"
            _shot(page, path, clip)
            draw.append(path)
        for i in range(FLOW_FRAMES):
            page.evaluate(STEP_JS, {"draw": None, "flow": sum(DASH) * i / FLOW_FRAMES, "L": L})
            path = out_dir / f"s{n:02d}_d{j}_flow{i:02d}.png"
            _shot(page, path, clip)
            flow.append(path)
        out.append(Doodle(draw=draw, flow=flow, box=clip, length=float(L), featured=featured,
                          opacity=1.0 if featured else 0.6, shape=sh["name"]))
    page.evaluate("() => { const s = document.getElementById('__doodles'); if (s) s.remove(); }")
    return out


def _shot(page, path: Path, clip: Tuple[int, int, int, int]) -> None:
    page.evaluate("() => { const s = document.getElementById('__reel_iso') || document.head.appendChild(Object.assign(document.createElement('style'), {id: '__reel_iso'}));"
                  " document.documentElement.classList.add('__iso');"
                  " s.textContent = `html.__iso, html.__iso body { background: transparent !important; }"
                  " html.__iso * { visibility: hidden !important; }"
                  " html.__iso #__doodles, html.__iso #__doodles * { visibility: visible !important; }`; }")
    x, y, w, h = clip
    page.screenshot(path=str(path), clip={"x": x, "y": y, "width": w, "height": h}, omit_background=True, full_page=False)
    page.evaluate("document.documentElement.classList.remove('__iso'); document.getElementById('__reel_iso').textContent = ''")
