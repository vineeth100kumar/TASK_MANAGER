"""Black-and-white halftone ("dotted") picture filter.

A photo becomes round black dots of varying size on a white grid: big dots where the picture is
dark, tiny ones where it is light. It is the look of the reference images in inspiration/.

halftone_image() works on a Pillow image; halftone_png() reads a file and returns PNG bytes
(cached, so the editor's live preview does not redo the work on every keystroke).
"""

import io
import math
from collections import OrderedDict
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
from PIL import Image, ImageOps

# The picture is processed at a fixed size so that "dot size" means the same thing for a phone
# snapshot and a 6000 px stock photo; the slide frame then scales it to fit.
WORK_LONG_SIDE = 1800
DEFAULT_DOT = 24          # distance between dot centres, in pixels of the 1800 px working size
MIN_DOT, MAX_DOT = 6, 60
DEFAULT_ANGLE = 0.0       # the reference has dots in straight rows; 45 gives the classic print screen
DEFAULT_CONTRAST = 1.15
_CACHE: "OrderedDict[tuple, bytes]" = OrderedDict()
_CACHE_MAX = 24


def clamp_dot(dot: Optional[float]) -> int:
    return int(max(MIN_DOT, min(MAX_DOT, dot if dot else DEFAULT_DOT)))


def _screen(gray: np.ndarray, dot: int) -> np.ndarray:
    """Ink coverage (0..1) of a dot screen laid over a grey picture (0 = black .. 255 = white)."""
    h, w = gray.shape
    rows, cols = math.ceil(h / dot), math.ceil(w / dot)
    padded = Image.fromarray(gray).resize((cols * dot, rows * dot), Image.BILINEAR)
    # one average brightness per cell, then a dot whose area follows how dark the cell is
    cells = np.asarray(padded.resize((cols, rows), Image.BOX), dtype=np.float32) / 255.0
    darkness = np.clip(1.0 - cells, 0.0, 1.0)
    radius = dot * 0.5 * np.sqrt(darkness) * 1.12            # a little over half a cell so the darkest dots merge
    radius_px = np.repeat(np.repeat(radius, dot, axis=0), dot, axis=1)
    yy, xx = np.mgrid[0:rows * dot, 0:cols * dot].astype(np.float32)
    dist = np.hypot((xx % dot) - (dot - 1) / 2.0, (yy % dot) - (dot - 1) / 2.0)
    coverage = np.clip(radius_px - dist + 0.5, 0.0, 1.0)       # one pixel of anti-aliasing at the dot edge
    return coverage[:h, :w]


def halftone_image(img: Image.Image, dot: Optional[float] = None, angle: Optional[float] = None,
                   contrast: float = DEFAULT_CONTRAST, ink: Tuple[int, int, int] = (0, 0, 0),
                   paper: Tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    """The picture as ink dots on paper. Transparent pixels become paper."""
    dot = clamp_dot(dot)
    angle = DEFAULT_ANGLE if angle is None else float(angle) % 90
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        flat = Image.new("RGB", img.size, paper)
        rgba = img.convert("RGBA")
        flat.paste(rgba, mask=rgba.split()[3])
        img = flat
    gray = ImageOps.autocontrast(img.convert("L"), cutoff=1)
    if contrast != 1.0:
        lut = [int(max(0, min(255, (v - 128) * contrast + 128))) for v in range(256)]
        gray = gray.point(lut)
    scale = WORK_LONG_SIDE / max(gray.size)
    if scale < 1.0:
        gray = gray.resize((max(1, round(gray.width * scale)), max(1, round(gray.height * scale))), Image.LANCZOS)
    size = gray.size
    if angle:
        gray = gray.rotate(angle, resample=Image.BILINEAR, expand=True, fillcolor=255)
    cov = _screen(np.asarray(gray, dtype=np.uint8), dot)
    mask = Image.fromarray((cov * 255).astype(np.uint8), "L")
    if angle:
        mask = mask.rotate(-angle, resample=Image.BILINEAR, expand=True, fillcolor=0)
        left, top = (mask.width - size[0]) // 2, (mask.height - size[1]) // 2
        mask = mask.crop((left, top, left + size[0], top + size[1]))
    out = Image.new("RGB", size, paper)
    out.paste(Image.new("RGB", size, ink), mask=mask)
    return out


def halftone_png(path: Path, dot: Optional[float] = None, angle: Optional[float] = None,
                 contrast: float = DEFAULT_CONTRAST) -> bytes:
    """PNG bytes of the file as a halftone (cached on file, size, time and settings)."""
    st = Path(path).stat()
    key = (str(path), st.st_mtime_ns, st.st_size, clamp_dot(dot), angle, contrast)
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
        return hit
    with Image.open(path) as im:
        im.load()
        out = halftone_image(im, dot, angle, contrast)
    buf = io.BytesIO()
    out.convert("L").save(buf, "PNG", optimize=True)         # black and white only, so one channel is enough
    data = buf.getvalue()
    _CACHE[key] = data
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return data
