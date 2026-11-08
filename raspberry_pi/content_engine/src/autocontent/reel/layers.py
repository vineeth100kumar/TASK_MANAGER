"""Cut a finished slide into layers: the background, and one transparent picture per thing that appears.

The slide is drawn by the same renderer as a carousel post (same fonts, fitting and brand), in the
reel canvas. Then, in the same browser page, the things that should arrive one after another are
found (the headline, each bullet, the number, the picture...) and photographed on their own, on a
transparent background, cropped to their box. The compositor (compose.py) animates those pieces
over the base picture, which keeps the header, footer and grid.
"""

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

ISOLATE_CSS = """
html.__iso, html.__iso body { background: transparent !important; }
html.__iso * { visibility: hidden !important; }
html.__iso [data-reel-group="__K__"], html.__iso [data-reel-group="__K__"] * { visibility: visible !important; }
html.__hide [data-reel-group], html.__hide [data-reel-group] * { visibility: hidden !important; }
"""

NO_VIDEO_CSS = ", ".join(HIDDEN) + " { display: none !important; }"


@dataclass
class Layer:
    path: Path
    box: Tuple[int, int, int, int]      # x, y, width, height on the canvas
    follow: bool = False                # arrives together with the layer before it (the source line)
    classes: str = ""                   # the CSS classes of what's in it (to tell a picture from text)


@dataclass
class SceneLayers:
    n: int
    base: Path
    layers: List[Layer] = field(default_factory=list)
    theme: str = "light"


MARGIN = 28   # px kept around a group so soft edges and shadows aren't clipped
# The slide is drawn a little larger than the video so the compositor can pan a frame-sized
# window across it (compose.SceneClip.view). It is drawn at that size, not scaled up afterwards,
# so the text stays as sharp as a post's.
OVERSAMPLE = 1.06


def _clip(box, width: int, height: int) -> Tuple[int, int, int, int]:
    x0 = max(0, int(box[0]) - MARGIN)
    y0 = max(0, int(box[1]) - MARGIN)
    x1 = min(width, int(box[2]) + MARGIN)
    y1 = min(height, int(box[3]) + MARGIN)
    return x0, y0, max(2, x1 - x0), max(2, y1 - y0)


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
        scene.layers.append(Layer(path=path, box=(round(x * scale), round(y * scale), pw, ph),
                                  follow=bool(box[4]), classes=str(box[5])))
    return scene
