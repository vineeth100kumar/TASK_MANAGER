"""
depth.py - the depth clock face: a photo with the time tucked behind the person.

The iPhone lock screen trick, done for LUMO. When a photo is uploaded the Pi
cuts out the person once (rembg, a small neural network that runs on the CPU)
and keeps the photo and its mask. Every render then stacks three layers:

    1. the photo
    2. the time
    3. the person again, cut out, so they stand in front of the digits
    4. the date, small, in front of everything

The clock itself can't do any of this (the ESP32-C3 has no room for a whole
frame), so the Pi draws the finished picture and sends it to the clock in
strips (firmware 2.9's depth face), then each minute only the rows that
changed. The same picture is the preview in Sage's LUMO page.

A head over the digits makes the time hard to read, so every render measures
how much of the digits the person covers. On `auto` the crop puts the head a
little below the top and the time goes at the top, behind it, unless that
hides too much of it; then it goes where it is covered least.

rembg is optional (requirements-depth.txt). Without it a photo can still be
saved, and the preview shows it with no cutout and says why.
"""

import array
import base64
import datetime
import io
import json
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Optional, Tuple

log = logging.getLogger("desk")

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:  # the desk still works, just without pictures
    Image = None

# The clock is 320x240 but its case hides the bottom 24 rows (SCREEN_HIDDEN_BOTTOM).
WIDTH, HEIGHT = 320, 216
# Uploads are kept no bigger than this, which is plenty for a 320-pixel screen
# and keeps the cutout quick.
KEEP_SIDE = 1280
PLACEMENTS = ("auto", "top", "middle", "bottom")
PHOTO_POSITIONS = ("auto", "top", "center", "bottom")
# On `auto` the crop puts the top of the person's head this far down the
# screen, so the time at the top tucks behind it as on an iPhone.
HEAD_TOP = 0.2
# Above this share of the digits hidden, Sage warns that the time is hard to read.
COVERAGE_WARN = 0.30
MODEL = os.getenv("SAGE_DEPTH_MODEL", "u2net_human_seg")

DATA_DIR = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent
DEPTH_DIR = Path(os.getenv("SAGE_DEPTH_DIR", str(DATA_DIR / "depth_face")))
FONT_FILE = Path(__file__).resolve().parent / "fonts" / "InterDisplay-SemiBold-subset.otf"

DEFAULTS = {"placement": "auto", "photoPosition": "auto", "hasPhoto": False, "cutout": False,
            "cutoutError": None, "updatedAt": None}

# Where the time's top edge sits for each placement, and the date above it.
TIME_SIZE = 104
DATE_SIZE = 14
_TIME_TOP = {"top": 14, "middle": 58, "bottom": 104}

_session = None
_session_lock = threading.Lock()


# --- the cutout ---------------------------------------------------------

def cutout_problem() -> Optional[str]:
    """Why the cutout can't run on this Pi, or None when it can."""
    import importlib
    importlib.invalidate_caches()  # rembg may have been installed since Sage started
    try:
        import onnxruntime  # noqa: F401  rembg's runtime; without it rembg calls sys.exit
        from rembg import new_session, remove  # noqa: F401  the names make_mask needs
    except (Exception, SystemExit) as e:
        return f"the cutout tool won't load: {_why(e)}"
    return None


def _why(e: BaseException) -> str:
    """An error as one line, with the error that caused it when there is one."""
    text = f"{e.__class__.__name__}: {e}"
    cause = e.__cause__ or e.__context__
    if cause is not None:
        text += f" (caused by {cause.__class__.__name__}: {cause})"
    return text[:400]


def cutout_available() -> bool:
    return cutout_problem() is None


def make_mask(photo) -> Optional["Image.Image"]:
    """The person in `photo` as a greyscale mask (white = person). Raises
    when rembg can't load or run. The first call loads the model (and the very
    first one downloads it, about 170 MB), so it can take a while."""
    global _session
    from rembg import new_session, remove
    with _session_lock:
        if _session is None:
            _session = new_session(MODEL)
        mask = remove(photo.convert("RGB"), session=_session, only_mask=True, post_process_mask=True)
    return mask.convert("L")


def cut_out(photo) -> Tuple[Optional["Image.Image"], Optional[str]]:
    """make_mask that never raises: (mask, None) or (None, why it failed),
    so the photo is kept either way and Sage can say what went wrong."""
    problem = cutout_problem()
    if problem:
        return None, problem
    try:
        mask = make_mask(photo)
    except (Exception, SystemExit) as e:  # a failed model download, too little memory, a broken install
        log.exception("depth cutout failed")
        return None, _why(e)
    if mask.getextrema()[1] < 128:
        return None, "no person found in this photo"
    return mask, None


# --- storage ------------------------------------------------------------

def _meta_file() -> Path:
    return DEPTH_DIR / "depth.json"


def load() -> dict:
    out = dict(DEFAULTS)
    try:
        out.update(json.loads(_meta_file().read_text()))
    except (OSError, ValueError):
        pass
    out["hasPhoto"] = (DEPTH_DIR / "photo.png").exists()
    out["cutout"] = out["hasPhoto"] and (DEPTH_DIR / "mask.png").exists()
    return out


def _save_meta(meta: dict) -> dict:
    DEPTH_DIR.mkdir(parents=True, exist_ok=True)
    keep = {k: meta.get(k, DEFAULTS[k]) for k in ("placement", "photoPosition", "cutoutError", "updatedAt")}
    _meta_file().write_text(json.dumps(keep))
    return load()


def decode_upload(data: str) -> "Image.Image":
    """A photo sent as a data URL (or bare base64), checked and shrunk."""
    if Image is None:
        raise ValueError("Pillow isn't installed on the Pi.")
    if "," in data[:100]:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=False)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        raise ValueError("That file isn't a photo Sage can read (try a JPEG or PNG).")
    try:
        from PIL import ImageOps
        image = ImageOps.exif_transpose(image)  # phone photos come sideways otherwise
    except Exception:
        pass
    image = image.convert("RGB")
    image.thumbnail((KEEP_SIDE, KEEP_SIDE))
    if min(image.size) < 64:
        raise ValueError("That photo is too small.")
    return image


def set_photo(photo: "Image.Image", mask: Optional["Image.Image"], now: datetime.datetime,
              error: Optional[str] = None) -> dict:
    """Keep a new photo and its cutout. A new photo starts on auto again."""
    DEPTH_DIR.mkdir(parents=True, exist_ok=True)
    photo.save(DEPTH_DIR / "photo.png")
    mask_file = DEPTH_DIR / "mask.png"
    if mask is not None:
        mask.resize(photo.size).save(mask_file)
    elif mask_file.exists():
        mask_file.unlink()
    meta = load()
    meta.update(placement="auto", photoPosition="auto", cutoutError=None if mask is not None else error,
                updatedAt=now.isoformat(timespec="seconds"))
    return _save_meta(meta)


def retry_cutout(now: datetime.datetime) -> dict:
    """Run the cutout again on the kept photo (after installing rembg, say)."""
    try:
        photo = Image.open(DEPTH_DIR / "photo.png").convert("RGB")
    except (OSError, AttributeError):
        raise ValueError("There's no photo to cut out yet.")
    mask, error = cut_out(photo)
    keep = load()
    meta = set_photo(photo, mask, now, error)
    if mask is None:  # keep the user's choices when nothing changed
        meta = _save_meta({**meta, "placement": keep["placement"], "photoPosition": keep["photoPosition"]})
    return meta


def update(change: dict) -> dict:
    meta = load()
    if "placement" in change:
        if change["placement"] not in PLACEMENTS:
            raise ValueError(f"placement must be one of: {', '.join(PLACEMENTS)}.")
        meta["placement"] = change["placement"]
    if "photoPosition" in change:
        if change["photoPosition"] not in PHOTO_POSITIONS:
            raise ValueError(f"photoPosition must be one of: {', '.join(PHOTO_POSITIONS)}.")
        meta["photoPosition"] = change["photoPosition"]
    return _save_meta(meta)


def clear() -> dict:
    for name in ("photo.png", "mask.png", "depth.json"):
        try:
            (DEPTH_DIR / name).unlink()
        except FileNotFoundError:
            pass
    return load()


# --- drawing ------------------------------------------------------------

def _font(size: int):
    for path in (FONT_FILE, Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")):
        try:
            return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    return ImageFont.load_default()


def _crop_box(size: Tuple[int, int], position: str, person=None) -> Tuple[int, int, int, int]:
    """The part of a w x h photo that fills the clock's window, without stretching.
    On `auto` with a person (their bounding box in the photo), the crop centres
    on them and puts the top of their head HEAD_TOP down the screen; without
    one, `auto` keeps the top, where heads usually are."""
    w, h = size
    target = WIDTH / HEIGHT
    if w / h > target:  # wider than the screen: keep the middle, or the person
        cw = round(h * target)
        x = (w - cw) // 2
        if position == "auto" and person:
            x = min(max((person[0] + person[2]) // 2 - cw // 2, 0), w - cw)
        return (x, 0, x + cw, h)
    ch = round(w / target)
    if position == "auto":
        y = person[1] - round(ch * HEAD_TOP) if person else 0
    else:
        y = {"top": 0, "center": (h - ch) // 2, "bottom": h - ch}[position]
    y = min(max(y, 0), h - ch)
    return (0, y, w, y + ch)


def _fit(photo, mask, position: str):
    person = mask.point(lambda v: 255 if v > 128 else 0).getbbox() if mask is not None else None
    box = _crop_box(photo.size, position, person)
    pic = photo.crop(box).resize((WIDTH, HEIGHT), Image.LANCZOS)
    cut = mask.crop(box).resize((WIDTH, HEIGHT), Image.LANCZOS) if mask is not None else None
    return pic, cut


def time_text(now: datetime.datetime, hour24: bool) -> str:
    if hour24:
        return now.strftime("%H:%M")
    return f"{now.hour % 12 or 12}:{now.minute:02d}"


def date_text(now: datetime.datetime) -> str:
    return now.strftime("%a %d %b").upper()


def _text_layer(time_str: str, date_str: str, placement: str):
    """The time and the date, each on a clear layer. The date goes in front of
    the person (as on the iPhone), so only the time can be covered."""
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    date_layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    big, small = _font(TIME_SIZE), _font(DATE_SIZE)
    top = _TIME_TOP[placement]
    l, t, r, b = draw.textbbox((0, 0), time_str, font=big)
    x = (WIDTH - (r - l)) // 2 - l
    draw.text((x, top - t), time_str, font=big, fill=(240, 245, 255, 235))
    draw = ImageDraw.Draw(date_layer)
    l2, t2, r2, b2 = draw.textbbox((0, 0), date_str, font=small)
    date_y = max(2, top - (b2 - t2) - 8)
    draw.text(((WIDTH - (r2 - l2)) // 2 - l2, date_y - t2), date_str, font=small, fill=(255, 255, 255, 240))
    return layer, date_layer


def coverage(digits, cut) -> float:
    """The share of the time's pixels the person hides (0 to 1)."""
    if cut is None:
        return 0.0
    from PIL import ImageChops
    d = digits.point(lambda v: 255 if v > 96 else 0)
    total = d.histogram()[255]
    if not total:
        return 0.0
    both = ImageChops.multiply(d, cut.point(lambda v: 255 if v > 128 else 0))
    return both.histogram()[255] / total


def _to565(image):
    r, g, b = image.split()
    return Image.merge("RGB", (r.point(lambda v: v & 0xF8), g.point(lambda v: v & 0xFC), b.point(lambda v: v & 0xF8)))


def render(now: datetime.datetime, hour24: bool, meta: Optional[dict] = None,
           photo=None, mask=None) -> Optional[dict]:
    """The face for `now`: {depth, flat, mask} pictures (320x216) and where the
    time went and how much of it is covered. None when there is no photo."""
    if Image is None:
        return None
    meta = meta or load()
    if photo is None:
        try:
            photo = Image.open(DEPTH_DIR / "photo.png").convert("RGB")
        except OSError:
            return None
        try:
            mask = Image.open(DEPTH_DIR / "mask.png").convert("L")
        except OSError:
            mask = None
    pic, cut = _fit(photo, mask, meta.get("photoPosition", "auto"))
    hard = cut.point(lambda v: 255 if v > 128 else 0) if cut is not None else None

    t, d = time_text(now, hour24), date_text(now)
    choices = {p: _text_layer(t, d, p) for p in ("top", "middle", "bottom")}
    covered = {p: coverage(time_layer.getchannel("A"), hard) for p, (time_layer, _) in choices.items()}
    placement = meta.get("placement", "auto")
    if placement != "auto":
        chosen = placement
    elif covered["top"] <= COVERAGE_WARN:  # the iPhone look: time at the top, behind the head
        chosen = "top"
    else:
        chosen = min(("top", "middle", "bottom"), key=lambda p: (round(covered[p], 2), p != "top"))
    time_layer, date_layer = choices[chosen]

    def on(base, layer):  # a layer with a soft shadow, so white reads on a bright photo
        shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
        shadow.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(4)).point(lambda v: int(v * 0.45)))
        return Image.alpha_composite(Image.alpha_composite(base, shadow), layer)

    behind = on(pic.convert("RGBA"), time_layer)
    flat = on(behind, date_layer).convert("RGB")
    if hard is not None:
        behind.paste(pic.convert("RGBA"), (0, 0), hard)
    depth = on(behind, date_layer).convert("RGB")
    return {
        "depth": _to565(depth),
        "flat": _to565(flat),
        "mask": hard,
        "placement": chosen,
        "coverage": round(covered[chosen], 3),
        "time": t,
    }


# --- sending it to the clock (firmware 2.9) -------------------------------
# The clock takes the picture in strips: 0xAA 0xDE, the first row (two bytes,
# little-endian), the row count, then 320 RGB565 pixels a row, little-endian.
# Two rows a message (1285 bytes) keep each one inside a network packet; a
# bigger message can arrive in pieces and restart the clock (see art.py).
STRIP_ROWS = 2


def frame_rows(image) -> list:
    """The picture as the clock's rows: 640 bytes (320 RGB565 pixels) each."""
    rgb = image.convert("RGB").tobytes()
    px = array.array("H", (((rgb[i] & 0xF8) << 8) | ((rgb[i + 1] & 0xFC) << 3) | (rgb[i + 2] >> 3)
                           for i in range(0, len(rgb), 3)))
    if sys.byteorder != "little":
        px.byteswap()
    data = px.tobytes()
    row = WIDTH * 2
    return [data[y * row:(y + 1) * row] for y in range(len(data) // row)]


def strips(rows: list, previous: Optional[list] = None) -> list:
    """Messages for the rows that differ from `previous` (all of them without one)."""
    changed = [y for y, r in enumerate(rows)
               if previous is None or y >= len(previous) or previous[y] != r]
    out = []
    i = 0
    while i < len(changed):
        y = changed[i]
        n = 1
        while n < STRIP_ROWS and i + n < len(changed) and changed[i + n] == y + n:
            n += 1
        out.append(bytes([0xAA, 0xDE, y & 0xFF, y >> 8, n]) + b"".join(rows[y:y + n]))
        i += n
    return out


def clock_frame(now: datetime.datetime, hour24: bool) -> Optional[list]:
    """The face as the clock's rows, or None with no photo."""
    frame = render(now, hour24)
    return frame_rows(frame["depth"]) if frame else None


def _data_url(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def describe(now: datetime.datetime, hour24: bool) -> dict:
    """Everything the LUMO page shows about the depth face."""
    meta = load()
    problem = cutout_problem()
    out = {**meta, "cutoutAvailable": problem is None, "cutoutProblem": problem, "model": MODEL,
           "placements": list(PLACEMENTS), "photoPositions": list(PHOTO_POSITIONS),
           "coverageWarn": COVERAGE_WARN, "preview": None}
    if meta["hasPhoto"]:
        frame = render(now, hour24, meta)
        if frame:
            out["preview"] = {
                "depth": _data_url(frame["depth"]),
                "flat": _data_url(frame["flat"]),
                "mask": _data_url(frame["mask"]) if frame["mask"] is not None else None,
                "placement": frame["placement"],
                "coverage": frame["coverage"],
                "time": frame["time"],
                "width": WIDTH,
                "height": HEIGHT,
            }
    return out
