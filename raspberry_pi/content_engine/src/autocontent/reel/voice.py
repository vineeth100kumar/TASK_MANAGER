"""The voice: the author's own recording, or Kokoro-82M speaking the `say:` lines on the Pi.

Kokoro (kokoro-onnx, Apache-2.0) runs on the Pi's CPU, offline, with no account or cost. Its model
files are downloaded once by deploy/install_pi.sh into REEL_MODEL_DIR (default ~/.cache/sage-reels).
The Pi has no speaker and doesn't need one: the speech is written to a file and muxed into the mp4.
"""

import os
import re
import shutil
import subprocess
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from .script import Scene

SAMPLE_RATE = 24000
MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"
MODEL_URLS = {
    MODEL_FILE: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    VOICES_FILE: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}
# American (a) and British (b) English, female (f) and male (m). The first is the default.
VOICES = ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael", "am_puck",
          "bf_emma", "bf_isabella", "bf_lily", "bm_george", "bm_lewis", "bm_daniel"]
GAP = 0.38            # seconds of quiet between one slide's narration and the next


def model_dir() -> Path:
    return Path(os.environ.get("REEL_MODEL_DIR", "") or (Path.home() / ".cache" / "sage-reels"))


def model_files() -> Tuple[Path, Path]:
    d = model_dir()
    return d / MODEL_FILE, d / VOICES_FILE


def kokoro_ready() -> Tuple[bool, str]:
    """(ready, what's missing), for Sage's health check and for plain messages."""
    try:
        import kokoro_onnx  # noqa: F401
    except ImportError:
        return False, "the kokoro-onnx package isn't installed (run deploy/install_pi.sh)"
    missing = [p.name for p in model_files() if not p.is_file()]
    if missing:
        return False, f"the voice files {', '.join(missing)} aren't in {model_dir()} (run deploy/install_pi.sh)"
    return True, ""


def check_voice(name: str) -> Optional[str]:
    """A plain message when the voice name isn't one Kokoro has; None when fine."""
    if name in VOICES:
        return None
    if re.fullmatch(r"[abjzefhip][fm]_[a-z]+", name):
        return None   # another Kokoro voice, such as a non-English one; passed through
    return f"'{name}' isn't a voice I know. Use one of: {', '.join(VOICES)} (or `voice: mine` with your own recording)."


# --- what a voice should be given to read ---

_UNITS = {"cr": "crore", "k": "thousand", "m": "million", "mn": "million", "bn": "billion", "b": "billion", "l": "lakh"}


def speakable(text: str) -> str:
    """The narration as it is to be spoken: symbols and money turned into words, so the voice
    says "five lakh rupees" rather than skipping or spelling the symbols."""
    t = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = re.sub(r"[–—]", ", ", t)

    def money(sym: str, word: str):
        def sub(m):
            unit = (m.group(2) or "").strip().lower()
            unit = _UNITS.get(unit, unit)
            return f"{m.group(1)} {unit + ' ' if unit else ''}{word}"
        return sub

    t = re.sub(r"(?:₹|Rs\.?\s?)\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(crore|lakhs?|cr|k|mn|m|bn|b|l)\b)?", money("₹", "rupees"), t, flags=re.I)
    t = re.sub(r"\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(k|mn|m|bn|b)\b)?", money("$", "dollars"), t, flags=re.I)
    t = re.sub(r"(\d)\s*%", r"\1 percent", t)
    t = re.sub(r"(\d)\s*[x×]\b", r"\1 times", t)
    t = t.replace("&", " and ").replace("+", " plus ").replace("=", " equals ")
    t = re.sub(r"(?<=\d),(?=\d{2,3}\b)", "", t)   # 5,20,000 and 1,500 are read as one number
    t = re.sub(r"\s+", " ", t).strip()
    return t


# --- writing and reading wave files without extra packages ---

def write_wav(path: Path, samples, rate: int = SAMPLE_RATE) -> None:
    import numpy as np
    pcm = (np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0) * 32767.0).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(pcm.tobytes())


def silence(seconds: float, rate: int = SAMPLE_RATE):
    import numpy as np
    return np.zeros(int(round(seconds * rate)), dtype="float32")


def to_wav(src: Path, dest: Path, rate: int = 48000, normalise: bool = True) -> Path:
    """Any audio or video file → mono 48 kHz wav, loudness-levelled for phones (-16 LUFS)."""
    af = "loudnorm=I=-16:TP=-1.5:LRA=11" if normalise else "anull"
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "1",
                           "-ar", str(rate), "-af", af, str(dest)], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0 or not dest.is_file():
        raise RuntimeError("That file couldn't be read as audio: " + (proc.stderr.strip()[-200:] or "unknown format"))
    return dest


@dataclass
class Track:
    """The finished audio and where each slide's narration sits in it."""
    path: Path
    seconds: float
    windows: List[Tuple[float, float]] = field(default_factory=list)   # per scene (start, end) of its own sound; (0, 0) when silent
    kind: str = "tts"                                                  # "tts" | "recording"


_kokoro = None


def _engine():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        model, voices = model_files()
        _kokoro = Kokoro(str(model), str(voices))
    return _kokoro


def synthesize(text: str, voice: str, speed: float):
    """Speech for the text as float samples at SAMPLE_RATE."""
    lang = "en-gb" if voice.startswith("b") else "en-us"
    samples, rate = _engine().create(speakable(text), voice=voice, speed=speed, lang=lang)
    if int(rate) != SAMPLE_RATE:
        import numpy as np
        n = int(len(samples) * SAMPLE_RATE / rate)
        samples = np.interp(np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples).astype("float32")
    return samples


def render_tts(scenes: List[Scene], voice: str, speed: float, work: Path,
               say: Callable[[str], None] = lambda s: None,
               engine: Optional[Callable] = None) -> Track:
    """Speak every slide's `say:` line and join them, with a short breath between slides.
    `engine(text, voice, speed)` can replace Kokoro (used by the tests)."""
    import numpy as np
    speak = engine or synthesize
    parts, windows, cursor = [], [], 0.0
    for sc in scenes:
        if not sc.say:
            hold = sc.duration or 3.0
            parts.append(silence(hold))
            windows.append((0.0, 0.0))
            cursor += hold
            continue
        say(f"Speaking slide {sc.n} of {len(scenes)}...")
        audio = np.asarray(speak(sc.say, voice, speed), dtype="float32")
        # a hair of breath at the front so a slide's first word doesn't clip
        lead = 0.08
        parts += [silence(lead), audio]
        windows.append((cursor + lead, cursor + lead + len(audio) / SAMPLE_RATE))
        tail = GAP + sc.pause
        parts.append(silence(tail))
        cursor += lead + len(audio) / SAMPLE_RATE + tail
    work.mkdir(parents=True, exist_ok=True)
    raw = work / "voice_raw.wav"
    write_wav(raw, np.concatenate(parts))
    leveled = to_wav(raw, work / "voice.wav", rate=48000)
    from .align import duration
    seconds = duration(leveled)
    # loudnorm changes length by a few ms at most; rescale the windows to match exactly
    ratio = seconds / cursor if cursor else 1.0
    return Track(leveled, seconds, [(a * ratio, b * ratio) for a, b in windows], "tts")


def render_recording(src: Path, work: Path) -> Track:
    """The author's own recording, made into the same kind of file. Where each slide sits in it is
    found afterwards by listening for the script's words (align.py)."""
    from .align import duration
    out = to_wav(src, work / "voice.wav", rate=48000)
    return Track(out, duration(out), [], "recording")
