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
ENTER = {"rise": 0.55, "stagger": 0.5, "pop": 0.5, "wipe": 0.6, "kenburns": 0.7, "fade": 0.45}
EXIT = 0.30            # seconds a slide takes to leave (its pieces fade up and away)
RISE_PX = {"rise": 64, "stagger": 48, "pop": 0, "wipe": 18, "kenburns": 30, "fade": 0}


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


@dataclass
class Piece:
    """One thing that appears: its pixels, where it sits and when it arrives."""
    image: Image.Image                   # RGBA
    box: Tuple[int, int, int, int]       # x, y, w, h
    at: float                            # seconds on the reel's clock when it starts arriving
    follow: bool = False
    zoom: bool = False                   # a slow push-in for as long as the slide is up (pictures)
    _rgba: Optional[np.ndarray] = None

    @property
    def array(self) -> np.ndarray:
        if self._rgba is None:
            self._rgba = np.asarray(self.image, dtype=np.uint8)
        return self._rgba


@dataclass
class SceneClip:
    t0: float
    t1: float
    base: Image.Image
    pieces: List[Piece] = field(default_factory=list)
    motion: str = "rise"
    _base_arr: Optional[np.ndarray] = None

    @property
    def base_array(self) -> np.ndarray:
        if self._base_arr is None:
            self._base_arr = np.asarray(self.base.convert("RGB"), dtype=np.uint8)
        return self._base_arr

    @property
    def settles_at(self) -> float:
        """From this moment until the exit begins, the picture doesn't change (unless a piece zooms)."""
        last = max([p.at for p in self.pieces] or [self.t0])
        return last + ENTER.get(self.motion, 0.5) + 0.05

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
    m = motion
    dur = ENTER.get(m, 0.5)
    u = (t - p.at) / dur
    arr = p.array
    x, y, w, h = p.box
    opacity = 1.0
    dy = 0.0
    if u < 1.0:
        if m == "pop":
            s = 0.86 + 0.14 * ease_out_back(u)
            opacity = min(1.0, u * 4.0)
            im = p.image.resize((max(2, int(w * s)), max(2, int(h * s))), Image.BICUBIC)
            arr = np.asarray(im, dtype=np.uint8)
            x += (w - arr.shape[1]) // 2
            y += (h - arr.shape[0]) // 2
        elif m == "wipe":
            e = ease_out_cubic(u)
            keep = int(w * e)
            arr = arr.copy()
            soft = 70
            cols = np.arange(w)
            edge = np.clip((keep - cols) / soft, 0, 1)[None, :]
            arr[..., 3] = (arr[..., 3] * edge).astype(np.uint8)
            dy = (1 - e) * RISE_PX["wipe"]
            opacity = min(1.0, u * 3.0)
        else:
            e = ease_out_cubic(u)
            dy = (1 - e) * RISE_PX.get(m, 48)
            opacity = e
    # leaving: the last EXIT seconds of the slide
    leave = (t - (clip.t1 - EXIT)) / EXIT
    if leave > 0:
        opacity *= max(0.0, 1.0 - ease_in_out(leave))
        dy -= ease_in_out(leave) * 26
    if p.zoom:
        k = 1.0 + 0.075 * min(1.0, max(0.0, (t - p.at) / max(clip.t1 - p.at, 0.5)))
        if k > 1.001:
            im = Image.fromarray(arr)
            nw, nh = int(w * k), int(h * k)
            im = im.resize((nw, nh), Image.BICUBIC).crop(((nw - w) // 2, (nh - h) // 2, (nw - w) // 2 + w, (nh - h) // 2 + h))
            arr = np.asarray(im, dtype=np.uint8)
    return arr, int(x), int(y + dy), opacity


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
        settled = (not clip.moving and clip.settles_at <= t < clip.t1 - EXIT)
        key = (i, cap.t0 if cap else None, cap.first and t < (cap.t0 + 0.12) if cap else None) if settled else None
        if key is not None and key == self._last_key and self._last_frame is not None:
            return self._last_frame
        frame = clip.base_array.copy()
        # the next slide's backdrop fades in under the leaving one when they differ (light -> dark)
        if i + 1 < len(self.clips) and t > clip.t1 - EXIT:
            nxt = self.clips[i + 1].base_array
            a = ease_in_out((t - (clip.t1 - EXIT)) / EXIT)
            if a > 0 and not np.array_equal(nxt[::97, ::97], frame[::97, ::97]):
                frame = (frame.astype(np.float32) * (1 - a) + nxt.astype(np.float32) * a).astype(np.uint8)
        for p in clip.pieces:
            state = _piece_state(p, t, clip.motion, clip)
            if state:
                arr, x, y, op = state
                _blend(frame, arr, x, y, op)
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
