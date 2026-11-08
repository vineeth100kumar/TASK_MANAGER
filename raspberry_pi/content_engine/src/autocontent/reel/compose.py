"""Turn layers and a timeline into video frames, and pipe them into ffmpeg.

Every frame is built from pictures drawn earlier (layers.py, captions.py): the slide's base, the
pieces that have appeared so far (each moving in on its own curve), the caption for the word being
said. Nothing is re-laid-out per frame, so it is just copying and blending pixels with numpy, which
the Pi does at a few frames a second, and then ffmpeg's x264 encodes (the Pi 5 has no hardware
H.264 encoder). The finished picture is identical on any machine.
"""

import math
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

W, H = 1080, 1920

# How each kind of thing arrives: (how long it takes, how far it travels). The author's `motion:`
# names (rise, pop, stagger, wipe, kenburns, fade) are here too, so a script that asks for one
# still gets exactly that on every piece of the slide.
MOTIONS = {
    # per-piece motions, picked from what the piece is (see piece_motion)
    "sweep":    (0.52, 10),    # a headline: wiped on from the left, like it is being written
    "slide":    (0.44, 56),    # a bullet or a column: in from its own side, with a little overshoot
    "punch":    (0.42, 0),     # a big number: scales up past its size and settles
    "stamp":    (0.40, 0),     # a pill: pressed on along its own slant
    "reveal":   (0.58, 0),     # a picture: uncovered upwards, then keeps pushing in
    "grow":     (0.54, 8),     # a table or chart: builds downwards, row by row
    "fade":     (0.36, 10),    # body text, a caption, a source line
    # the author's own names
    "rise":     (0.55, 64),
    "stagger":  (0.50, 48),
    "pop":      (0.50, 0),
    "wipe":     (0.60, 18),
    "kenburns": (0.70, 30),
}
ENTER = {k: v[0] for k, v in MOTIONS.items()}        # kept for older callers and the tests
EXIT = 0.30            # seconds a slide takes to leave (its pieces fade up and away)
EXIT_PX = 44           # and how far up they go
SETTLE = 1.3           # after it has arrived, a piece drifts this long...
SETTLE_PX = 3          # ...by this much, so the picture is never quite still
SOFT = 90              # how soft a wiping edge is, in pixels
PAN = 30               # px the camera drifts across a slide (see SceneClip.view)

# What a piece is, from the classes the renderer gave it, and so how it should arrive.
# The first match wins, so the more particular classes come first.
KINDS = (
    ("stat-number", "punch", 0),
    ("accent-pill", "stamp", 0),
    ("cta-pill", "stamp", 0),
    ("image-frame", "reveal", 0),
    ("data-table", "grow", 0),
    ("chart-wrap", "grow", 0),
    ("compare-col left", "slide", -1),
    ("compare-col right", "slide", 1),
    ("list-item", "slide", -1),
    ("bullet-row", "slide", -1),
    ("headline", "sweep", 0),
    ("quote-body", "sweep", 0),
    ("statement-body", "sweep", 0),
    ("author-wrapper", "fade", 0),
)


def piece_motion(classes: str, fallback: str = "fade") -> Tuple[str, int]:
    """(motion, which side it comes from) for a piece, from its CSS classes."""
    for mark, motion, side in KINDS:
        if all(word in classes for word in mark.split()):
            return motion, side
    return fallback, 0


def pan_for(n: int, base_size: Tuple[int, int]) -> Tuple[int, int, int, int]:
    """Where slide n's camera starts and ends inside its (larger) base picture: down, right, up,
    left, slide by slide, so no two in a row drift the same way."""
    room_x, room_y = max(0, base_size[0] - W), max(0, base_size[1] - H)
    mid_x, mid_y = room_x // 2, room_y // 2
    if not room_x and not room_y:
        return (0, 0, 0, 0)
    dx, dy = ((0, 1), (1, 0), (0, -1), (-1, 0))[n % 4]
    half_x, half_y = min(PAN, room_x) // 2, min(PAN, room_y) // 2
    return (mid_x - dx * half_x, mid_y - dy * half_y, mid_x + dx * half_x, mid_y + dy * half_y)


def ease_out_cubic(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def ease_out_back(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    c1, c3 = 1.35, 2.35
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2


def ease_in_out(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def _wiped(arr: np.ndarray, done: float, side: str) -> np.ndarray:
    """A copy of arr whose alpha is faded in from one side: done is 0 (hidden) to 1 (all there)."""
    h, w = arr.shape[:2]
    arr = arr.copy()
    if side in ("left", "right"):
        edge = (np.arange(w) if side == "left" else (w - 1 - np.arange(w)))
        length = w
    else:
        edge = (np.arange(h) if side == "top" else (h - 1 - np.arange(h)))
        length = h
    soft = max(12, min(SOFT, length // 2))
    mask = np.clip((done * (length + soft) - edge) / soft, 0, 1)
    mask = mask[None, :] if side in ("left", "right") else mask[:, None]
    arr[..., 3] = (arr[..., 3] * mask).astype(np.uint8)
    return arr


def _scaled(image: Image.Image, box: Tuple[int, int, int, int], scale: float) -> Tuple[np.ndarray, int, int]:
    """arr, x, y for the piece drawn at `scale`, still centred on its box."""
    x, y, w, h = box
    im = image.resize((max(2, int(w * scale)), max(2, int(h * scale))), Image.BICUBIC)
    arr = np.asarray(im, dtype=np.uint8)
    return arr, x + (w - arr.shape[1]) // 2, y + (h - arr.shape[0]) // 2


@dataclass
class Piece:
    """One thing that appears: its pixels, where it sits and when it arrives."""
    image: Image.Image                   # RGBA
    box: Tuple[int, int, int, int]       # x, y, w, h
    at: float                            # seconds on the reel's clock when it starts arriving
    follow: bool = False
    zoom: bool = False                   # a slow push-in for as long as the slide is up (pictures)
    motion: str = ""                     # its own motion; empty means the slide's
    side: int = 0                        # -1 in from the left, 1 from the right
    drift: int = 0                       # which way it drifts once it has arrived
    _rgba: Optional[np.ndarray] = None

    def how(self, slide_motion: str) -> str:
        return self.motion or slide_motion

    def takes(self, slide_motion: str) -> float:
        return MOTIONS.get(self.how(slide_motion), MOTIONS["fade"])[0]

    @property
    def array(self) -> np.ndarray:
        if self._rgba is None:
            self._rgba = np.asarray(self.image, dtype=np.uint8)
        return self._rgba


@dataclass
class SceneClip:
    """One slide's time on screen. The base picture is drawn a little larger than the video, and
    the frame is cut out of it at a point that creeps across the slide: a slow camera move that
    keeps the picture alive between the pieces arriving, and costs nothing but a different crop.
    A base that is exactly the video's size simply doesn't move."""
    t0: float
    t1: float
    base: Image.Image
    pieces: List[Piece] = field(default_factory=list)
    motion: str = "rise"
    pan: Tuple[int, int, int, int] = (0, 0, 0, 0)    # the crop's top-left, from the start to the end
    _base_arr: Optional[np.ndarray] = None

    def view(self, t: float) -> Tuple[int, int]:
        """Where the frame is cut out of the base picture at time t."""
        bh, bw = self.base_array.shape[:2]
        x0, y0, x1, y1 = self.pan
        u = ease_in_out((t - self.t0) / max(self.t1 - self.t0, 0.1))
        x = int(round(x0 + (x1 - x0) * u))
        y = int(round(y0 + (y1 - y0) * u))
        return max(0, min(x, bw - W)), max(0, min(y, bh - H))

    @property
    def base_array(self) -> np.ndarray:
        if self._base_arr is None:
            self._base_arr = np.asarray(self.base.convert("RGB"), dtype=np.uint8)
        return self._base_arr

    @property
    def settles_at(self) -> float:
        """From this moment until the exit begins, the picture doesn't change (unless a piece zooms)."""
        done = [p.at + p.takes(self.motion) + (SETTLE if p.drift else 0) for p in self.pieces]
        return max(done or [self.t0]) + 0.05

    @property
    def moving(self) -> bool:
        return any(p.zoom for p in self.pieces)


@dataclass
class CaptionClip:
    t0: float
    t1: float
    image: Image.Image
    box: Tuple[int, int]
    first: bool = False                  # the phrase's first word: it pops in
    _rgba: Optional[np.ndarray] = None

    @property
    def array(self) -> np.ndarray:
        if self._rgba is None:
            self._rgba = np.asarray(self.image, dtype=np.uint8)
        return self._rgba


def _blend(frame: np.ndarray, rgba: np.ndarray, x: int, y: int, opacity: float = 1.0) -> None:
    """Draw rgba (h,w,4) onto frame (H,W,3) at (x,y), clipped to the frame, with extra opacity."""
    h, w = rgba.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0 or opacity <= 0:
        return
    src = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
    a = src[..., 3:4].astype(np.float32) * (opacity / 255.0)
    region = frame[y0:y1, x0:x1].astype(np.float32)
    region += (src[..., :3].astype(np.float32) - region) * a
    frame[y0:y1, x0:x1] = region.astype(np.uint8)


def _piece_state(p: Piece, t: float, motion: str, clip: SceneClip) -> Optional[Tuple[np.ndarray, int, int, float]]:
    """(pixels, x, y, opacity) for a piece at time t, or None if it isn't showing."""
    if t < p.at:
        return None
    m = p.how(motion)
    dur, travel = MOTIONS.get(m, MOTIONS["fade"])
    u = (t - p.at) / dur
    arr = p.array
    x, y, w, h = p.box
    opacity, dx, dy = 1.0, 0.0, 0.0
    if u < 1.0:
        e = ease_out_cubic(u)
        if m in ("punch", "pop"):
            small = 0.74 if m == "punch" else 0.86
            arr, x, y = _scaled(p.image, p.box, small + (1 - small) * ease_out_back(u))
            opacity = min(1.0, u * 4.0)
        elif m == "stamp":
            arr, x, y = _scaled(p.image, p.box, 0.94 + 0.06 * ease_out_back(u))
            arr = _wiped(arr, e, "left")
            opacity = min(1.0, u * 4.0)
        elif m in ("sweep", "wipe"):
            arr = _wiped(arr, e, "left")
            dy = (1 - e) * travel
            opacity = min(1.0, u * 3.0)
        elif m == "reveal":
            arr = _wiped(arr, e, "bottom")
            opacity = min(1.0, u * 3.0)
        elif m == "grow":
            arr = _wiped(arr, e, "top")
            dy = (1 - e) * travel
            opacity = min(1.0, u * 3.0)
        elif m in ("slide", "stagger"):
            dx = (1 - ease_out_back(u)) * travel * (p.side or -1)
            opacity = min(1.0, u * 3.5)
        else:                                   # fade, rise, kenburns
            dy = (1 - e) * travel
            opacity = e
    elif p.drift:
        # it has arrived: a slow few pixels, so the picture is never quite still
        dy = p.drift * SETTLE_PX * ease_in_out(min(1.0, (t - p.at - dur) / SETTLE))
    # leaving: the last EXIT seconds of the slide
    leave = (t - (clip.t1 - EXIT)) / EXIT
    if leave > 0:
        gone = ease_in_out(leave)
        opacity *= max(0.0, 1.0 - gone)
        dy -= gone * EXIT_PX
    if p.zoom:
        k = 1.0 + 0.075 * min(1.0, max(0.0, (t - p.at) / max(clip.t1 - p.at, 0.5)))
        if k > 1.001:
            im = Image.fromarray(arr)
            nw, nh = int(w * k), int(h * k)
            im = im.resize((nw, nh), Image.BICUBIC).crop(((nw - w) // 2, (nh - h) // 2, (nw - w) // 2 + w, (nh - h) // 2 + h))
            arr = np.asarray(im, dtype=np.uint8)
    return arr, int(x + dx), int(y + dy), opacity


def _rows(done: float, up: bool) -> np.ndarray:
    """A top-to-bottom (or bottom-to-top) alpha ramp for the whole frame: the slide change."""
    edge = np.arange(H) if not up else (H - 1 - np.arange(H))
    soft = 160
    return np.clip((done * (H + soft) - edge) / soft, 0, 1).astype(np.float32)[:, None, None]


class Timeline:
    def __init__(self, clips: List[SceneClip], captions: List[CaptionClip], total: float):
        self.clips = clips
        self.captions = captions
        self.total = total
        self._last_key = None
        self._last_frame: Optional[np.ndarray] = None

    def _clip_at(self, t: float) -> Tuple[int, SceneClip]:
        for i, c in enumerate(self.clips):
            if t < c.t1:
                return i, c
        return len(self.clips) - 1, self.clips[-1]

    def frame(self, t: float) -> np.ndarray:
        i, clip = self._clip_at(t)
        cap = next((c for c in self.captions if c.t0 <= t < c.t1), None)
        ox, oy = clip.view(t)
        settled = (not clip.moving and clip.settles_at <= t < clip.t1 - EXIT)
        # while the camera sits on the same pixel and nothing is arriving, the frame is the one before
        key = (i, ox, oy, cap.t0 if cap else None, cap.first and t < (cap.t0 + 0.12) if cap else None) if settled else None
        if key is not None and key == self._last_key and self._last_frame is not None:
            return self._last_frame
        frame = clip.base_array[oy:oy + H, ox:ox + W].copy()
        for p in clip.pieces:
            state = _piece_state(p, t, clip.motion, clip)
            if state:
                arr, x, y, op = state
                _blend(frame, arr, x - ox, y - oy, op)
        # the slide change: the next slide's backdrop is wiped over this one as it leaves,
        # alternating direction, so one slide becomes the next instead of simply cutting
        if i + 1 < len(self.clips) and t > clip.t1 - EXIT:
            a = ease_in_out((t - (clip.t1 - EXIT)) / EXIT)
            if a > 0.001:
                after = self.clips[i + 1]
                nx, ny = after.view(after.t0)
                ramp = _rows(a, up=bool(i % 2))
                nxt = after.base_array[ny:ny + H, nx:nx + W].astype(np.float32)
                frame = (frame.astype(np.float32) * (1 - ramp) + nxt * ramp).astype(np.uint8)
        if cap:
            arr = cap.array
            x, y = cap.box
            op = 1.0
            if cap.first:
                u = (t - cap.t0) / 0.12
                if u < 1.0:
                    op = max(0.0, u)
                    y += int((1 - ease_out_cubic(u)) * 14)
            leave = (t - (clip.t1 - EXIT)) / EXIT
            if leave > 0 and i + 1 >= len(self.clips):
                op *= max(0.0, 1 - leave)
            _blend(frame, arr, x, y, op)
        self._last_key, self._last_frame = key, frame
        return frame


def encode(timeline: Timeline, audio: Optional[Path], out: Path, fps: int = 30,
           progress: Callable[[float], None] = lambda f: None, preset: str = "veryfast", crf: int = 19,
           threads: int = 0) -> None:
    """Write the reel: H.264 High + AAC in an mp4 that starts playing before it has downloaded."""
    total = timeline.total
    frames = int(math.ceil(total * fps))
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.stem + ".partial.mp4")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(fps), "-i", "-"]
    if audio:
        cmd += ["-i", str(audio)]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    cmd += ["-map", "0:v", "-map", "1:a",
            "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
            "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-profile:v", "high", "-level", "4.2",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-g", str(fps * 2),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-af", "apad",
            "-t", f"{total:.3f}", "-movflags", "+faststart", str(tmp)]
    if threads:
        cmd[cmd.index("-c:v"):cmd.index("-c:v")] = ["-threads", str(threads)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for n in range(frames):
            proc.stdin.write(timeline.frame(n / fps).tobytes())
            if n % 15 == 0:
                progress(n / frames)
        proc.stdin.close()
        err = proc.stderr.read().decode("utf-8", errors="replace")
        if proc.wait() != 0:
            raise RuntimeError("ffmpeg couldn't encode the video: " + err.strip()[-300:])
    except BrokenPipeError:
        err = proc.stderr.read().decode("utf-8", errors="replace")
        raise RuntimeError("ffmpeg stopped while the video was being written: " + err.strip()[-300:])
    finally:
        if proc.poll() is None:
            proc.kill()
        for stream in (proc.stdin, proc.stderr):
            try:
                stream.close()
            except Exception:
                pass
    tmp.replace(out)
    progress(1.0)


def poster(timeline: Timeline, t: float, out: Path) -> None:
    """A still from the reel (the cover once its headline is up), as a JPEG for previews and email."""
    Image.fromarray(timeline.frame(t)).save(out, "JPEG", quality=90, optimize=True)
