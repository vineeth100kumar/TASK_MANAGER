"""
art.py - album art for the clock's now-playing screen.

The phone's media service sends the title and artist but no picture, so the
cover is looked up on iTunes. The clock takes a 100x100 RGB565 frame with a
four-byte header (0xAA 0xBB 100 100), little-endian, 20004 bytes in all. When
there's no cover (or Pillow isn't installed) a plain card with the initials
is drawn instead, so the screen never shows the last song's art.
"""

import io
import struct
from typing import Optional

import httpx

SIZE = 100
HEADER = bytes([0xAA, 0xBB, SIZE, SIZE])
FRAME_LEN = len(HEADER) + SIZE * SIZE * 2

try:
    from PIL import Image, ImageDraw
except ImportError:  # the desk still works, just without pictures
    Image = None


def encode(image) -> bytes:
    """A Pillow image as the clock's frame."""
    rgb = image.convert("RGB").resize((SIZE, SIZE)).tobytes()
    body = bytearray()
    for i in range(0, len(rgb), 3):
        r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
        body += struct.pack("<H", ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))
    return HEADER + bytes(body)


def placeholder(title: str, artist: str) -> Optional[bytes]:
    if Image is None:
        return None
    image = Image.new("RGB", (SIZE, SIZE), (15, 20, 30))
    draw = ImageDraw.Draw(image)
    draw.rectangle((4, 4, SIZE - 5, SIZE - 5), outline=(0, 229, 255), width=2)
    initials = "".join(w[0] for w in f"{title} {artist}".split()[:2] if w[:1].isascii()).upper() or "?"
    draw.text((SIZE // 2, SIZE // 2), initials, fill=(224, 247, 250), anchor="mm")
    return encode(image)


async def cover(title: str, artist: str) -> Optional[bytes]:
    """The cover from iTunes, else the placeholder; None without Pillow."""
    if Image is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(
                "https://itunes.apple.com/search",
                params={"term": f"{title} {artist}".strip(), "entity": "song", "limit": 1},
            )
            res.raise_for_status()
            results = res.json().get("results") or []
            if results and results[0].get("artworkUrl100"):
                pic = await client.get(results[0]["artworkUrl100"])
                pic.raise_for_status()
                return encode(Image.open(io.BytesIO(pic.content)))
    except Exception:
        pass
    return placeholder(title, artist)
