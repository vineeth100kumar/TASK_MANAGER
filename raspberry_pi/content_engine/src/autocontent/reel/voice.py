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


def parse_blend(spec: str) -> List[Tuple[str, float]]:
    """`af_heart` → [("af_heart", 1.0)]; `af_heart*0.7 + af_bella*0.3`, `af_heart 70% + af_bella 30%`
    or `af_heart, af_bella` (equal parts) → the voices and their weights, which add up to 1."""
    parts = [p for p in re.split(r"\s*[+,&]\s*", (spec or "").strip()) if p]
    out = []
    for p in parts:
        m = re.match(r"^([a-z]{2}_[a-z]+)\s*(?:[*x:@]\s*|\s+)?(\d+(?:\.\d+)?)?\s*(%)?$", p.strip().lower())
        if not m:
            out.append((p.strip(), 1.0))
            continue
        w = float(m.group(2)) if m.group(2) else 1.0
        if m.group(3) or w > 1.0:
            w /= 100.0
        out.append((m.group(1), w))
    total = sum(w for _, w in out) or 1.0
    return [(n, w / total) for n, w in out]


def _known(name: str) -> bool:
    return name in VOICES or bool(re.fullmatch(r"[abjzefhip][fm]_[a-z]+", name))


def check_voice(name: str) -> Optional[str]:
    """A plain message when the voice (or any voice in a blend) isn't one Kokoro has; None when fine."""
    blend = parse_blend(name)
    bad = [n for n, _ in blend if not _known(n)]
    if blend and not bad:
        return None
    return (f"'{bad[0] if bad else name}' isn't a voice I know. Use one of: {', '.join(VOICES)}, a blend such as "
            f"`af_heart*0.7 + af_bella*0.3`, or `voice: mine` with your own recording.")


# --- what a voice should be given to read ---

_UNITS = {"cr": "crore", "k": "thousand", "m": "million", "mn": "million", "bn": "billion", "b": "billion", "l": "lakh"}


# Words Kokoro tends to say wrongly, respelled the way they sound. A script's `pronounce:` adds to these.
PRONOUNCE = {"UPI": "U P I",
             "GST": "G S T", "EV": "E V", "IPO": "I P O", "SaaS": "sass", "Pi": "pie"}


def apply_pronounce(text: str, extra: Optional[dict] = None) -> str:
    table = dict(PRONOUNCE)
    table.update(extra or {})
    for word in sorted(table, key=len, reverse=True):
        flags = 0 if any(c.isupper() for c in word) else re.I
        text = re.sub(rf"(?<![\w]){re.escape(word)}(?![\w])", table[word], text, flags=flags)
    return text


def speakable(text: str, pronounce: Optional[dict] = None) -> str:
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
    return apply_pronounce(t, pronounce)


# --- speaking a slide sentence by sentence, with pauses that follow the punctuation ---

# seconds of quiet after a piece that ends with this mark (before the `pauses:` scale)
END_PAUSE = {".": 0.30, "!": 0.34, "?": 0.42, "…": 0.48, ":": 0.24, ";": 0.22}
MARK_PAUSE = {"pause": 0.5, "breath": 0.28, "beat": 0.7}


def pieces(text: str) -> List[Tuple[str, float]]:
    """Split one `say:` line into (sentence, seconds of quiet after it). `[pause 0.6]`, `[breath]` and
    `[beat]` marks become quiet of their own; a sentence's end mark sets how long it lets go."""
    from .script import PAUSE_MARK
    out: List[Tuple[str, float]] = []
    pos = 0
    chunks: List[Tuple[str, Optional[float]]] = []
    for m in PAUSE_MARK.finditer(text):
        chunks.append((text[pos:m.start()], None))
        chunks.append(("", float(m.group(2)) if m.group(2) else MARK_PAUSE[m.group(1).lower()]))
        pos = m.end()
    chunks.append((text[pos:], None))
    for chunk, mark in chunks:
        if mark is not None:
            if out:
                out[-1] = (out[-1][0], max(out[-1][1], mark))
            else:
                out.append(("", mark))
            continue
        t = chunk.replace("...", "…")
        # a mark only ends a piece when a space follows it, so 2.5, 3:30 and e.g. stay whole
        for sent in re.split(r"(?<=[.!?…;:])\s+", t):
            sent = sent.strip()
            if not sent:
                continue
            out.append((sent, END_PAUSE.get(sent[-1], 0.0)))
    # join tiny fragments ("Why?" is fine; "So." alone sounds clipped) onto the next piece
    merged: List[Tuple[str, float]] = []
    for sent, gap in out:
        if merged and merged[-1][0] and len(merged[-1][0].split()) <= 1 and merged[-1][1] < 0.4 and sent:
            merged[-1] = (merged[-1][0] + " " + sent, gap)
        else:
            merged.append((sent, gap))
    return merged


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


# The finishing chain: rumble cut, tone, de-essing, gentle compression, then loudness for phones.
POLISH_CHAINS = {
    "natural": "highpass=f=70,equalizer=f=180:t=q:w=1.0:g=1.5,equalizer=f=3200:t=q:w=1.2:g=1.5,"
               "deesser=i=0.4,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2",
    "warm": "highpass=f=60,equalizer=f=160:t=q:w=0.9:g=3,equalizer=f=6500:t=q:w=1.5:g=-1.5,"
            "deesser=i=0.5,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2",
    "bright": "highpass=f=90,equalizer=f=250:t=q:w=1.0:g=-1,equalizer=f=4000:t=q:w=1.2:g=3,"
              "deesser=i=0.5,acompressor=threshold=-20dB:ratio=3:attack=6:release=100:makeup=2",
    "clean": "highpass=f=70,acompressor=threshold=-22dB:ratio=2:attack=10:release=150:makeup=1.5",
    "off": "",
}


def to_wav(src: Path, dest: Path, rate: int = 48000, normalise: bool = True,
           polish: str = "off", loudness: float = -16.0) -> Path:
    """Any audio or video file → mono 48 kHz wav, finished with the `polish` chain and
    loudness-levelled for phones (-14 LUFS is Instagram's level)."""
    chain = [c for c in (POLISH_CHAINS.get(polish, ""),) if c]
    if normalise:
        chain.append(f"loudnorm=I={loudness:g}:TP=-1.5:LRA=11")
    af = ",".join(chain) or "anull"
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


_styles: dict = {}


def _style(spec: str):
    """A voice name, or a blend of several mixed into one new voice."""
    blend = parse_blend(spec)
    if len(blend) == 1:
        return blend[0][0]
    if spec not in _styles:
        eng = _engine()
        _styles[spec] = sum(eng.get_voice_style(n) * w for n, w in blend)
    return _styles[spec]


def synthesize(text: str, voice: str, speed: float):
    """Speech for the text (already made speakable) as float samples at SAMPLE_RATE."""
    first = parse_blend(voice)[0][0]
    lang = "en-gb" if first.startswith("b") else "en-us"
    samples, rate = _engine().create(text, voice=_style(voice), speed=max(0.5, min(2.0, speed)), lang=lang)
    if int(rate) != SAMPLE_RATE:
        import numpy as np
        n = int(len(samples) * SAMPLE_RATE / rate)
        samples = np.interp(np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples).astype("float32")
    return samples


def render_tts(scenes: List[Scene], voice: str, speed: float, work: Path,
               say: Callable[[str], None] = lambda s: None,
               engine: Optional[Callable] = None, *, pauses: float = 1.0, polish: str = "natural",
               loudness: float = -14.0, pronounce: Optional[dict] = None) -> Track:
    """Speak every slide's `say:` line sentence by sentence and join them, with pauses that follow the
    punctuation, each slide at its own pace and voice, then finish the sound.
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
        v = sc.voice or voice
        pace = speed * (sc.speed or 1.0)
        chunks = []
        segs = pieces(sc.say_raw or sc.say)
        for k, (text, gap) in enumerate(segs):
            if text:
                chunks.append(np.asarray(speak(speakable(text, pronounce), v, pace), dtype="float32"))
            if k < len(segs) - 1 and gap:
                chunks.append(silence(gap * pauses))
        audio = np.concatenate(chunks) if chunks else silence(0.2)
        # a hair of breath at the front so a slide's first word doesn't clip
        lead = 0.08
        parts += [silence(lead), audio]
        windows.append((cursor + lead, cursor + lead + len(audio) / SAMPLE_RATE))
        tail = GAP * pauses + sc.pause
        parts.append(silence(tail))
        cursor += lead + len(audio) / SAMPLE_RATE + tail
    work.mkdir(parents=True, exist_ok=True)
    raw = work / "voice_raw.wav"
    write_wav(raw, np.concatenate(parts))
    leveled = to_wav(raw, work / "voice.wav", rate=48000, polish=polish, loudness=loudness)
    from .align import duration
    seconds = duration(leveled)
    # loudnorm changes length by a few ms at most; rescale the windows to match exactly
    ratio = seconds / cursor if cursor else 1.0
    return Track(leveled, seconds, [(a * ratio, b * ratio) for a, b in windows], "tts")


def render_recording(src: Path, work: Path, polish: str = "natural", loudness: float = -14.0) -> Track:
    """The author's own recording, made into the same kind of file. Where each slide sits in it is
    found afterwards by listening for the script's words (align.py)."""
    from .align import duration
    out = to_wav(src, work / "voice.wav", rate=48000, polish=polish, loudness=loudness)
    return Track(out, duration(out), [], "recording")
