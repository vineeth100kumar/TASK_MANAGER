"""The cold open: a short card of the reel's boldest number, before the cover builds.

It is one plain picture held for COLD_OPEN_SECONDS, then wiped away like any slide change. The voice
is pushed back by the same amount so every cue still lands on its word.
"""

import subprocess
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
INK = (21, 19, 15)
HERO = (255, 255, 255)
FONT = Path(__file__).resolve().parents[3] / "assets" / "fonts" / "LeagueSpartan-Variable.ttf"
MAX_W = 920


def _font(size: int) -> ImageFont.FreeTypeFont:
    try:
        f = ImageFont.truetype(str(FONT), size)
        try:
            f.set_variation_by_axes([900])
        except Exception:
            pass
        return f
    except OSError:
        return ImageFont.load_default()


def make_card(text: str, accent: Tuple[int, int, int] = (238, 68, 37)) -> Image.Image:
    """Dark card, the text as big as 920px of width allows (up to 330px type), a short accent bar under it."""
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    text = text.strip()
    size = 330
    while size > 60:
        font = _font(size)
        box = d.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= MAX_W:
            break
        size -= 10
    box = d.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    x, y = (W - tw) // 2 - box[0], (H - th) // 2 - box[1] - 40
    d.text((x, y), text, font=font, fill=HERO)
    bar_y = (H + th) // 2 + 20
    d.rounded_rectangle(((W - 160) // 2, bar_y, (W + 160) // 2, bar_y + 14), radius=7, fill=accent)
    return img


def pad_audio(src: Path, dst: Path, seconds: float) -> Path:
    """The voice, delayed by `seconds` of silence at the front."""
    ms = int(round(seconds * 1000))
    proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
                           "-af", f"adelay={ms}:all=1", str(dst)], capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg couldn't delay the voice for the cold open: " + proc.stderr.decode("utf-8", "replace")[-200:])
    return dst
