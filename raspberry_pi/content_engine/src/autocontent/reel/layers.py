"""Cut a finished slide into layers: the background, and one transparent picture per thing that appears.

The slide is drawn by the same renderer as a carousel post (same fonts, fitting and brand), in the
reel canvas. Then, in the same browser page, the things that should arrive one after another are
found (the headline, each bullet, the number, the picture...) and photographed on their own, on a
transparent background, cropped to their box. The compositor (compose.py) animates those pieces
over the base picture, which keeps the header, footer and grid.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image
from typing import Any, Dict, List, Optional, Tuple

# What appears, in order, for each slide type. A group is a list of CSS selectors; every element
# any of them matches belongs to it. Whatever is not listed stays in the base picture.
# A `*` after a selector's name means "each match is its own group" (the list items, the bullets).
GROUPS: Dict[str, List[Any]] = {
    "cover": [[".cover-headline"], [".accent-pill-wrapper", ".grid-dashed-loop"]],
    "point": [[".point-headline", ".accent-bar"], [".point-body:not(.point-bullets)", ".point-bullets > div:not(.bullet-row)"], ("each", ".bullet-row")],
    "list": [[".list-headline", ".accent-bar"], ("each", ".list-item")],
    "stat": [[".stat-headline"], [".stat-number"], [".accent-bar", ".stat-body"]],
    "quote": [[".quote-mark", ".quote-body"], [".author-wrapper"]],
    "table": [[".table-headline", ".accent-bar", ".table-body"], [".data-table"]],
    "chart": [[".chart-headline", ".accent-bar", ".chart-body"], [".chart-wrap"]],
    "image": [[".image-headline", ".accent-bar", ".image-text-above"], [".image-frame"], [".image-caption", ".image-bullets"]],
    "statement": [[".statement-headline", ".accent-bar"], [".statement-body"]],
    "compare": [[".compare-headline", ".accent-bar", ".compare-body"], [".compare-col.left"], [".compare-col.right"]],
    "cta": [[".cta-headline"], [".cta-pill"], [".cta-subtext"]],
}
# Shown together with the last group (they must not be on screen before what they refer to)
TRAILING = [".slide-source", ".chart-source", ".table-source"]
# Not wanted in a video: page numbers and the "swipe" arrow
HIDDEN = [".slide-counter", ".footer-right"]

# Runs in the page: mark each group's elements with data-reel-group="<k>" and return their boxes
FIND_JS = """
(spec) => {
  const out = [];
  const seen = new Set();
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const inside = (e) => [...seen].some((p) => p.contains(e));
  const take = (els) => els.filter((e) => visible(e) && !seen.has(e) && !inside(e)).map((e) => { seen.add(e); return e; });
  for (const g of spec.groups) {
    if (g[0] === 'each') {
      for (const e of take([...document.querySelectorAll(g[1])])) out.push([e]);
    } else {
      const els = take(g.flatMap((sel) => [...document.querySelectorAll(sel)]));
      if (els.length) out.push(els);
    }
  }
  const follow = out.map(() => false);
  const tail = take(spec.trailing.flatMap((sel) => [...document.querySelectorAll(sel)]));
  if (out.length && tail.length) { out.push(tail); follow.push(true); }   // the source line arrives with the last thing
  const boxes = [];
  out.forEach((els, k) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    els.forEach((e) => {
      e.setAttribute('data-reel-group', String(k));
      // the element and everything inside it: a skewed pill or a child can stick out of its wrapper
      [e, ...e.querySelectorAll('*')].forEach((d) => {
        const r = d.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      });
    });
    boxes.push([x0, y0, x1, y1, follow[k] ? 1 : 0, els.map((e) => String(e.className || '')).join(' ')]);
  });
  return boxes;
}
"""

# Runs in the page: every word of a group's text, as a box, in reading order
WORDS_JS = r"""
(k) => {
  const root = [...document.querySelectorAll(`[data-reel-group="${k}"]`)];
  if (!root.length) return [];
  const out = [];
  for (const el of root) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const text = node.nodeValue;
      if (!text || !text.trim()) continue;
      const style = window.getComputedStyle(node.parentElement);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const re = /\S+/g;
      let m;
      while ((m = re.exec(text))) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
        if (!rects.length) continue;
        const colour = window.getComputedStyle(node.parentElement).color;
        const x0 = Math.min(...rects.map((r) => r.left)), y0 = Math.min(...rects.map((r) => r.top));
        const x1 = Math.max(...rects.map((r) => r.right)), y1 = Math.max(...rects.map((r) => r.bottom));
        out.push([x0, y0, x1, y1, colour]);
      }
    }
  }
  // reading order: line by line, then left to right
  out.sort((a, b) => (Math.abs(a[1] - b[1]) > 12 ? a[1] - b[1] : a[0] - b[0]));
  return out;
}
"""

ISOLATE_CSS = """
html.__iso, html.__iso body { background: transparent !important; }
html.__iso * { visibility: hidden !important; }
html.__iso [data-reel-group="__K__"], html.__iso [data-reel-group="__K__"] * { visibility: visible !important; }
html.__hide [data-reel-group], html.__hide [data-reel-group] * { visibility: hidden !important; }
"""

NO_VIDEO_CSS = ", ".join(HIDDEN) + " { display: none !important; }"


COUNT_FRAMES = 15      # how many in-between values a counting number is photographed at


def count_steps(text: str) -> List[str]:
    """A big number counting up to itself: "65%" -> "0%", "9%", ... "65%".
    Returns [] when there is no number to count, or it is too small to be worth it."""
    m = re.search(r"\d[\d,]*(?:\.\d+)?", text or "")
    if not m:
        return []
    raw = m.group(0)
    try:
        value = float(raw.replace(",", ""))
    except ValueError:
        return []
    if value < 4:
        return []
    decimals = len(raw.split(".")[1]) if "." in raw else 0
    grouped = "," in raw
    out = []
    for i in range(COUNT_FRAMES):
        u = (i + 1) / COUNT_FRAMES
        v = value * (1 - (1 - u) ** 3)          # fast, then easing into the real number
        shown = f"{v:,.{decimals}f}" if grouped else f"{v:.{decimals}f}"
        out.append(text[:m.start()] + shown + text[m.end():])
    out[-1] = text
    return out


@dataclass
class Layer:
    path: Path
    box: Tuple[int, int, int, int]      # x, y, width, height on the canvas
    follow: bool = False                # arrives together with the layer before it (the source line)
    classes: str = ""                   # the CSS classes of what's in it (to tell a picture from text)
    words: List[Tuple[int, int, int, int]] = field(default_factory=list)
    """Each word of this layer's text, as a box inside the layer's own picture, in reading order,
    so the compositor can land the words one after another instead of the block in one go."""
    accents: List[int] = field(default_factory=list)
    """Which of those words are in the brand colour rather than the text colour: the ones the
    design is pointing at, so they land harder and get a line drawn under them."""
    accent_rgb: Tuple[int, int, int] = (248, 96, 54)
    count: List[Path] = field(default_factory=list)
    """A big number photographed counting up to itself, if this layer is one."""


@dataclass
class SceneLayers:
    n: int
    base: Path
    layers: List[Layer] = field(default_factory=list)
    theme: str = "light"


MARGIN = 28   # px kept around a group so soft edges and shadows aren't clipped
OVERSAMPLE = 1.0   # the slide is drawn at the video's own size: nothing pans, nothing is scaled


def _clip(box, width: int, height: int) -> Tuple[int, int, int, int]:
    x0 = max(0, int(box[0]) - MARGIN)
    y0 = max(0, int(box[1]) - MARGIN)
    x1 = min(width, int(box[2]) + MARGIN)
    y1 = min(height, int(box[3]) + MARGIN)
    return x0, y0, max(2, x1 - x0), max(2, y1 - y0)


def _accent_words(colours: List[str]) -> Tuple[List[int], Tuple[int, int, int]]:
    """Which words are not in the colour most of the text uses, and what that other colour is.
    That is how a highlighted word (==like this==) is found without knowing the style pack."""
    if len(colours) < 2:
        return [], (248, 96, 54)
    common = Counter(colours).most_common(1)[0][0]
    odd = [i for i, c in enumerate(colours) if c != common]
    if not odd or len(odd) > len(colours) // 2:
        return [], (248, 96, 54)
    found = re.findall(r"\d+", colours[odd[0]])
    rgb = tuple(int(v) for v in found[:3]) if len(found) >= 3 else (248, 96, 54)
    return odd, rgb  # type: ignore[return-value]


def extract_scene(renderer, page, slide: Dict[str, Any], brand: Dict[str, Any], total: int, seed: int,
                  out_dir: Path, scale: float = 1.0) -> SceneLayers:
    """Draw one slide and write its base picture and layer pictures into out_dir.
    Returns the layers in the order they are listed for the slide type."""
    n = int(slide.get("n", 1))
    width, height = renderer.style_config.canvas.width, renderer.style_config.canvas.height
    html = renderer.build_slide_html(slide, brand, total, seed)
    renderer.lay_out(page, slide, html)
    page.add_style_tag(content=NO_VIDEO_CSS)
    groups = GROUPS.get(slide.get("type", "point"), [[".content-container"]])
    boxes = page.evaluate(FIND_JS, {"groups": [list(g) if isinstance(g, list) else list(g) for g in groups], "trailing": TRAILING})
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = SceneLayers(n=n, base=out_dir / f"s{n:02d}_base.png", theme=slide.get("theme") or "light")

    # Base: everything except the groups
    page.evaluate("document.documentElement.classList.add('__hide')")
    page.add_style_tag(content=ISOLATE_CSS.replace("__K__", "-1"))
    page.screenshot(path=str(scene.base), full_page=False)
    page.evaluate("document.documentElement.classList.remove('__hide')")

    # Each group alone, on a transparent background
    for k, box in enumerate(boxes):
        x, y, w, h = _clip(box, width, height)
        path = out_dir / f"s{n:02d}_g{k + 1:02d}.png"
        page.evaluate("(k) => { const s = document.getElementById('__reel_iso') || document.head.appendChild(Object.assign(document.createElement('style'), {id: '__reel_iso'}));"
                      " s.textContent = ''; document.documentElement.classList.add('__iso');"
                      " s.textContent = `html.__iso, html.__iso body { background: transparent !important; }"
                      " html.__iso * { visibility: hidden !important; }"
                      " html.__iso [data-reel-group=\"${k}\"], html.__iso [data-reel-group=\"${k}\"] * { visibility: visible !important; }`; }", k)
        page.screenshot(path=str(path), clip={"x": x, "y": y, "width": w, "height": h}, omit_background=True, full_page=False)
        page.evaluate("document.documentElement.classList.remove('__iso'); document.getElementById('__reel_iso').textContent = ''")
        # the clip is in page pixels; the picture comes out `scale` times bigger, so the box the
        # compositor works in is the picture's own size at the scaled-up position
        with Image.open(path) as im:
            pw, ph = im.size
        # where each word sits inside this picture, so text can land word by word
        words, colours = [], []
        for wx0, wy0, wx1, wy1, colour in page.evaluate(WORDS_JS, k):
            a, b = round(wx0 * scale) - round(x * scale), round(wy0 * scale) - round(y * scale)
            c, d = round(wx1 * scale) - round(x * scale), round(wy1 * scale) - round(y * scale)
            a, b = max(0, a - 2), max(0, b - 2)
            c, d = min(pw, c + 2), min(ph, d + 2)
            if c - a > 1 and d - b > 1:
                words.append((a, b, c - a, d - b))
                colours.append(str(colour))
        accents, accent_rgb = _accent_words(colours)
        count = _count_frames(page, k, str(box[5]), out_dir, n, k, (x, y, w, h))
        scene.layers.append(Layer(path=path, box=(round(x * scale), round(y * scale), pw, ph),
                                  follow=bool(box[4]), classes=str(box[5]), words=words,
                                  accents=accents, accent_rgb=accent_rgb, count=count))
    return scene


SET_TEXT_JS = """
(a) => {
  const el = document.querySelector(`[data-reel-group="${a.k}"]`);
  if (!el) return '';
  if (el.__reelText === undefined) el.__reelText = el.textContent;
  el.textContent = a.text === null ? el.__reelText : a.text;
  return el.__reelText;
}
"""


def _count_frames(page, k: int, classes: str, out_dir: Path, n: int, gi: int,
                  clip: Tuple[int, int, int, int]) -> List[Path]:
    """Photograph a big number at each value on its way up to the real one, in the same spot,
    so the compositor can run it like a counter instead of switching it on."""
    if "stat-number" not in classes:
        return []
    text = page.evaluate(SET_TEXT_JS, {"k": k, "text": None})
    steps = count_steps(str(text or ""))
    if not steps:
        return []
    x, y, w, h = clip
    out: List[Path] = []
    for i, value in enumerate(steps[:-1]):
        page.evaluate(SET_TEXT_JS, {"k": k, "text": value})
        shot = out_dir / f"s{n:02d}_g{gi + 1:02d}_c{i:02d}.png"
        page.evaluate("(k) => { const s = document.getElementById('__reel_iso') || document.head.appendChild(Object.assign(document.createElement('style'), {id: '__reel_iso'}));"
                      " document.documentElement.classList.add('__iso');"
                      " s.textContent = `html.__iso, html.__iso body { background: transparent !important; }"
                      " html.__iso * { visibility: hidden !important; }"
                      " html.__iso [data-reel-group=\"${k}\"], html.__iso [data-reel-group=\"${k}\"] * { visibility: visible !important; }`; }", k)
        page.screenshot(path=str(shot), clip={"x": x, "y": y, "width": w, "height": h}, omit_background=True, full_page=False)
        page.evaluate("document.documentElement.classList.remove('__iso'); document.getElementById('__reel_iso').textContent = ''")
        out.append(shot)
    page.evaluate(SET_TEXT_JS, {"k": k, "text": None})
    return out
