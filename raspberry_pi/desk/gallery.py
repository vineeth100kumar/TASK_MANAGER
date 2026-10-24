"""
gallery.py - the away-mode gallery for LUMO.

When the phone leaves home the clock switches from its usual face to a
gallery that cycles through quotes, completed-task memories and uploaded
photos.  Each slide is rendered as a 320×240 RGB565 image and streamed to
the MEMORY screen in strips the clock already knows how to draw (the same
protocol the old LUMO memories used: 0xAA 0xCC header).

Content sources, all read through Sage:
- Built-in quotes  – a curated set shipped with the module.
- Completed items  – titles of recently finished tasks ("You finished …").
- Notes snippets   – short extracts from the user's notes.
- Photos           – images uploaded to Sage's static/memories/library/.

The gallery is controlled by the `gallery` key in desk settings (see
settings.py): enabled, intervalSeconds, sources list.
"""

import logging
import os
import random
import struct
from pathlib import Path
from typing import Any, Awaitable, Callable, List, Optional

log = logging.getLogger("desk.gallery")

DATA_DIR = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent
PHOTOS_DIR = Path(os.getenv("SAGE_GALLERY_DIR", str(DATA_DIR / "gallery_photos")))

MAX_GALLERY_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB cap for the photo directory

# --- Image encoding for the clock's MEMORY screen ---

WIDTH, HEIGHT = 320, 240
STRIP_H = 20  # rows per strip (matches the firmware's stripBuf)


def _rgb565(r: int, g: int, b: int) -> int:
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def encode_strip(y_off: int, strip_h: int, pixels: bytes) -> bytes:
    """One strip for the clock: header [0xAA, 0xCC, y_off_lo, y_off_hi,
    strip_h_lo, strip_h_hi, w_lo, w_hi] then RGB565 little-endian pixels."""
    header = bytes([0xAA, 0xCC]) + struct.pack("<HHH", y_off, strip_h, WIDTH)
    return header + pixels


def image_to_strips(image) -> list:
    """A Pillow Image (any size) → list of binary strips for the clock."""
    from PIL import Image
    img = image.convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    raw = img.tobytes()
    strips = []
    for y in range(0, HEIGHT, STRIP_H):
        h = min(STRIP_H, HEIGHT - y)
        body = bytearray()
        for row in range(y, y + h):
            for x in range(WIDTH):
                idx = (row * WIDTH + x) * 3
                r, g, b = raw[idx], raw[idx + 1], raw[idx + 2]
                body += struct.pack("<H", _rgb565(r, g, b))
        strips.append(encode_strip(y, h, bytes(body)))
    return strips


def enforce_cap(photos_dir: Path = PHOTOS_DIR, cap: int = MAX_GALLERY_BYTES) -> int:
    """Delete oldest photos until the directory is under *cap* bytes. Returns bytes freed."""
    if not photos_dir.is_dir():
        return 0
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    files = sorted(
        (f for f in photos_dir.iterdir() if f.suffix.lower() in exts),
        key=lambda f: f.stat().st_mtime,
    )
    total = sum(f.stat().st_size for f in files)
    freed = 0
    while total > cap and files:
        oldest = files.pop(0)
        sz = oldest.stat().st_size
        oldest.unlink()
        total -= sz
        freed += sz
        log.info("Gallery cap: removed %s (%d KB)", oldest.name, sz // 1024)
    return freed


def save_photo(raw: bytes, name: str, photos_dir: Path = PHOTOS_DIR) -> Path:
    """Resize to display size, save as JPEG, and enforce the 1 GB cap."""
    from PIL import Image
    import io

    photos_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    ratio = max(WIDTH / img.width, HEIGHT / img.height)
    img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.Resampling.LANCZOS)
    left = (img.width - WIDTH) // 2
    top = (img.height - HEIGHT) // 2
    img = img.crop((left, top, left + WIDTH, top + HEIGHT))

    stem = Path(name).stem
    dest = photos_dir / f"{stem}.jpg"
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    dest.write_bytes(buf.getvalue())

    enforce_cap(photos_dir)
    return dest


# --- Built-in quotes ---

QUOTES = [
    ("The best time to plant a tree was 20 years ago.\nThe second best time is now.", "Chinese Proverb"),
    ("Do what you can, with what you have,\nwhere you are.", "Theodore Roosevelt"),
    ("It does not matter how slowly you go\nas long as you do not stop.", "Confucius"),
    ("The only way to do great work\nis to love what you do.", "Steve Jobs"),
    ("In the middle of difficulty\nlies opportunity.", "Albert Einstein"),
    ("Simplicity is the ultimate\nsophistication.", "Leonardo da Vinci"),
    ("Everything you've ever wanted\nis on the other side of fear.", "George Addair"),
    ("What we think, we become.", "Buddha"),
    ("The future belongs to those\nwho believe in the beauty of their dreams.", "Eleanor Roosevelt"),
    ("Stay hungry. Stay foolish.", "Steve Jobs"),
    ("Not all those who wander\nare lost.", "J.R.R. Tolkien"),
    ("Be yourself; everyone else\nis already taken.", "Oscar Wilde"),
    ("The journey of a thousand miles\nbegins with a single step.", "Lao Tzu"),
    ("Act as if what you do\nmakes a difference. It does.", "William James"),
    ("Happiness is not something\nready-made. It comes from\nyour own actions.", "Dalai Lama"),
    ("Life is what happens\nwhen you're busy making\nother plans.", "John Lennon"),
    ("Turn your wounds into wisdom.", "Oprah Winfrey"),
    ("The mind is everything.\nWhat you think, you become.", "Buddha"),
    ("The only impossible journey\nis the one you never begin.", "Tony Robbins"),
    ("If you want to lift yourself up,\nlift up someone else.", "Booker T. Washington"),
]


# --- Text-to-image rendering ---

def _render_text_slide(
    text: str,
    attribution: str = "",
    bg: tuple = (18, 22, 36),
    text_color: tuple = (224, 247, 250),
    accent_color: tuple = (0, 180, 216),
    muted_color: tuple = (120, 140, 160),
) -> "Image":
    """Render a text slide as a 320×240 Pillow image with word-wrapped text."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (WIDTH, HEIGHT), bg)
    draw = ImageDraw.Draw(img)

    # Decorative top accent line
    draw.line([(20, 20), (WIDTH - 20, 20)], fill=accent_color, width=1)

    # Try to load a nice font; fall back to default
    font_main = ImageFont.load_default()
    font_attr = ImageFont.load_default()
    try:
        for path in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                     "/usr/share/fonts/TTF/DejaVuSans.ttf",
                     "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf"]:
            if os.path.exists(path):
                font_main = ImageFont.truetype(path, 18)
                font_attr = ImageFont.truetype(path, 14)
                break
    except Exception:
        pass

    # Word-wrap the text
    lines = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            test = current + " " + word
            bbox = draw.textbbox((0, 0), test, font=font_main)
            if bbox[2] - bbox[0] > WIDTH - 50:
                lines.append(current)
                current = word
            else:
                current = test
        lines.append(current)

    # Center the block vertically
    line_height = 26
    total_h = len(lines) * line_height + (30 if attribution else 0)
    y_start = max(35, (HEIGHT - total_h) // 2)

    # Draw opening quote mark
    draw.text((20, y_start - 8), "“", fill=accent_color, font=font_main)

    for i, line in enumerate(lines):
        y = y_start + i * line_height
        # Center each line
        bbox = draw.textbbox((0, 0), line, font=font_main)
        w = bbox[2] - bbox[0]
        x = (WIDTH - w) // 2
        draw.text((x, y), line, fill=text_color, font=font_main)

    if attribution:
        attr_text = f"— {attribution}"
        bbox = draw.textbbox((0, 0), attr_text, font=font_attr)
        w = bbox[2] - bbox[0]
        y = y_start + len(lines) * line_height + 12
        draw.text(((WIDTH - w) // 2, y), attr_text, fill=muted_color, font=font_attr)

    # Decorative bottom accent line
    draw.line([(20, HEIGHT - 20), (WIDTH - 20, HEIGHT - 20)], fill=accent_color, width=1)

    return img


def _render_memory_slide(
    title: str,
    subtitle: str = "",
    bg: tuple = (18, 22, 36),
    text_color: tuple = (224, 247, 250),
    accent_color: tuple = (0, 180, 216),
    muted_color: tuple = (120, 140, 160),
) -> "Image":
    """A completed-task or note memory as a slide."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (WIDTH, HEIGHT), bg)
    draw = ImageDraw.Draw(img)

    font_main = ImageFont.load_default()
    font_sub = ImageFont.load_default()
    font_label = ImageFont.load_default()
    try:
        for path in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                     "/usr/share/fonts/TTF/DejaVuSans.ttf",
                     "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf"]:
            if os.path.exists(path):
                font_main = ImageFont.truetype(path, 16)
                font_sub = ImageFont.truetype(path, 13)
                font_label = ImageFont.truetype(path, 11)
                break
    except Exception:
        pass

    # Checkmark icon area
    draw.ellipse([(WIDTH // 2 - 20, 50), (WIDTH // 2 + 20, 90)], outline=accent_color, width=2)
    draw.text((WIDTH // 2 - 5, 58), "✓", fill=accent_color, font=font_main)

    # Label
    label = "COMPLETED"
    bbox = draw.textbbox((0, 0), label, font=font_label)
    w = bbox[2] - bbox[0]
    draw.text(((WIDTH - w) // 2, 100), label, fill=muted_color, font=font_label)

    # Word-wrap the title
    lines = []
    words = title.split()
    if words:
        current = words[0]
        for word in words[1:]:
            test = current + " " + word
            bbox = draw.textbbox((0, 0), test, font=font_main)
            if bbox[2] - bbox[0] > WIDTH - 60:
                lines.append(current)
                current = word
            else:
                current = test
        lines.append(current)

    line_h = 24
    y = 125
    for line in lines[:5]:
        bbox = draw.textbbox((0, 0), line, font=font_main)
        w = bbox[2] - bbox[0]
        draw.text(((WIDTH - w) // 2, y), line, fill=text_color, font=font_main)
        y += line_h

    if subtitle:
        bbox = draw.textbbox((0, 0), subtitle, font=font_sub)
        w = bbox[2] - bbox[0]
        draw.text(((WIDTH - w) // 2, y + 8), subtitle, fill=muted_color, font=font_sub)

    # Bottom accent
    draw.line([(20, HEIGHT - 20), (WIDTH - 20, HEIGHT - 20)], fill=accent_color, width=1)

    return img


def _render_photo_slide(image_path: str) -> Optional["Image"]:
    """Load and resize a photo to fill the screen."""
    try:
        from PIL import Image, ImageEnhance
        img = Image.open(image_path).convert("RGB")
        # Cover crop: resize to fill 320×240 and centre-crop
        ratio = max(WIDTH / img.width, HEIGHT / img.height)
        new_w = int(img.width * ratio)
        new_h = int(img.height * ratio)
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        left = (new_w - WIDTH) // 2
        top = (new_h - HEIGHT) // 2
        img = img.crop((left, top, left + WIDTH, top + HEIGHT))
        # Slight warmth for the small TFT
        try:
            img = ImageEnhance.Color(img).enhance(1.1)
        except Exception:
            pass
        return img
    except Exception as e:
        log.debug("Could not load photo %s: %s", image_path, e)
        return None


# --- Gallery engine ---

class Gallery:
    """Cycles through slides while you're away. The desk calls `start` when
    the phone leaves and `stop` when it comes back; `tick` advances the
    slide on the interval."""

    def __init__(
        self,
        send_binary: Callable[[bytes], Awaitable[bool]],
        send_json: Callable[[dict], Awaitable[bool]],
        items: Callable[[], List[dict]],
        notes: Callable[[], List[dict]] = lambda: [],
        photos_dir: str = "",
    ) -> None:
        self.send_binary = send_binary
        self.send_json = send_json
        self.items = items
        self.notes = notes
        self.photos_dir = photos_dir
        self.active = False
        self.slides: List[dict] = []  # {"type": "quote"|"memory"|"photo", ...}
        self.index = 0
        self.interval = 30  # seconds between slides
        self.sources = ["quotes", "memories", "photos"]

    def configure(self, settings: dict) -> None:
        """Apply the gallery section from desk settings."""
        self.interval = max(10, settings.get("intervalSeconds", 30))
        self.sources = settings.get("sources", ["quotes", "memories", "photos"])

    def _build_slides(self) -> List[dict]:
        """Collect all available content into a shuffled slide list."""
        slides: List[dict] = []

        if "quotes" in self.sources:
            for text, author in QUOTES:
                slides.append({"type": "quote", "text": text, "author": author})

        if "memories" in self.sources:
            try:
                items = self.items()
                done = [it for it in items if it.get("status") == "done" and it.get("title")]
                # Pick up to 15 recently completed tasks
                for it in done[-15:]:
                    date_str = ""
                    if it.get("completedAt"):
                        date_str = str(it["completedAt"])[:10]
                    elif it.get("dueDate"):
                        date_str = str(it["dueDate"])
                    slides.append({"type": "memory", "title": it["title"], "date": date_str})
            except Exception as e:
                log.debug("Could not load completed items for gallery: %s", e)

        if "photos" in self.sources and self.photos_dir:
            try:
                lib_dir = self.photos_dir
                if os.path.isdir(lib_dir):
                    for fname in os.listdir(lib_dir):
                        if fname.lower().endswith((".jpg", ".jpeg", ".png", ".bmp")):
                            slides.append({"type": "photo", "path": os.path.join(lib_dir, fname)})
            except Exception as e:
                log.debug("Could not scan photos for gallery: %s", e)

        if "notes" in self.sources:
            try:
                for note in self.notes():
                    content = (note.get("content") or "").strip()
                    title = note.get("title") or ""
                    if content and len(content) < 200 and title:
                        slides.append({"type": "note", "title": title, "text": content[:150]})
            except Exception:
                pass

        random.shuffle(slides)
        return slides or [{"type": "quote", "text": "Your room is waiting\nfor you to come back.", "author": "Sage"}]

    def start(self) -> None:
        """Begin gallery mode: build the slide list and mark active."""
        self.slides = self._build_slides()
        self.index = 0
        self.active = True
        log.info("Gallery started with %d slides (sources: %s)", len(self.slides), ", ".join(self.sources))

    def stop(self) -> None:
        """Stop gallery mode."""
        self.active = False
        self.slides = []
        log.info("Gallery stopped")

    async def show_current(self) -> None:
        """Render and send the current slide to the clock."""
        if not self.slides:
            return
        slide = self.slides[self.index % len(self.slides)]
        try:
            img = await self._render(slide)
            if img is None:
                return
            # Send caption
            caption = self._caption(slide)
            await self.send_json({"cmd": "MEMORY_META", "caption": caption})
            # Send image strips
            strips = image_to_strips(img)
            for strip in strips:
                if not await self.send_binary(strip):
                    return
        except Exception:
            log.exception("Gallery: failed to render slide %d", self.index)

    async def advance(self) -> None:
        """Move to the next slide and show it."""
        if not self.slides:
            return
        self.index = (self.index + 1) % len(self.slides)
        # Rebuild every full cycle to pick up new content
        if self.index == 0:
            self.slides = self._build_slides()
        await self.show_current()

    async def _render(self, slide: dict) -> Optional[Any]:
        """Render a slide dict to a Pillow Image, off the event loop."""
        import asyncio
        stype = slide["type"]
        if stype == "quote":
            return await asyncio.to_thread(_render_text_slide, slide["text"], slide.get("author", ""))
        elif stype == "memory":
            title = f"You finished: {slide['title']}"
            return await asyncio.to_thread(_render_memory_slide, title, slide.get("date", ""))
        elif stype == "note":
            return await asyncio.to_thread(_render_text_slide, slide["text"], slide.get("title", ""))
        elif stype == "photo":
            return await asyncio.to_thread(_render_photo_slide, slide["path"])
        return None

    def _caption(self, slide: dict) -> str:
        stype = slide["type"]
        if stype == "quote":
            return slide.get("author", "")[:23]
        elif stype == "memory":
            return slide.get("date", "")[:23]
        elif stype == "note":
            return (slide.get("title") or "")[:23]
        elif stype == "photo":
            name = os.path.splitext(os.path.basename(slide["path"]))[0]
            return name[:23]
        return ""
