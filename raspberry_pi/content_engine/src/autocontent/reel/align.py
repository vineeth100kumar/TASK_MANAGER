"""When is each word spoken? Given the voice-over audio and the words of the script, give every
script word a start and end time.

Backends, tried in order (the one used is reported, and shown in Sage's health check):

  whisper    faster-whisper listens to the audio and gives word times. Best; needs its model
             downloaded once (install_pi.sh does it) and about 400 MB of RAM for the base model.
  spread     no model needed. ffmpeg finds where speech is and where the pauses are, and the
             words are spread over the speech by their length (and their punctuation pauses).
             Good to a few tenths of a second for a steady voice such as Kokoro's.

Whatever the recognised words are, they are matched back to the script's own words, so the
captions always show the script's spelling, never what the recogniser thought it heard.
"""

import difflib
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

# A word shorter than this is never assumed to be spoken
MIN_WORD = 0.07


@dataclass
class Timed:
    text: str
    start: float
    end: float


_NUMBERS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
_NUMBERS.update({"thirty": "30", "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80", "ninety": "90",
                 "hundred": "100", "percent": "%"})


def norm(word: str) -> str:
    """A word as compared between the script and what was heard: lower case, no punctuation, and
    small numbers as digits (a recogniser writes "10" where the script says "ten", and the reverse)."""
    w = re.sub(r"[^a-z0-9₹%$]+", "", word.lower())
    return _NUMBERS.get(w, w)


def duration(path: Path) -> float:
    """Length of an audio file in seconds (ffprobe)."""
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                         capture_output=True, text=True, timeout=60)
    try:
        return float(out.stdout.strip())
    except ValueError:
        raise RuntimeError(f"Couldn't read the length of {path.name}: {out.stderr.strip()[-200:] or 'not an audio file'}")


def speech_segments(path: Path, noise_db: float = -38.0, min_silence: float = 0.16) -> List[Tuple[float, float]]:
    """Where there is sound: [(start, end), ...] in seconds, from ffmpeg's silencedetect."""
    total = duration(path)
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
                           f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"],
                          capture_output=True, text=True, timeout=600)
    starts = [float(x) for x in re.findall(r"silence_start: (-?[0-9.]+)", proc.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: (-?[0-9.]+)", proc.stderr)]
    segments: List[Tuple[float, float]] = []
    cursor = 0.0
    for i, s in enumerate(starts):
        s = max(0.0, s)
        if s - cursor > 0.05:
            segments.append((cursor, s))
        cursor = ends[i] if i < len(ends) else total
    if total - cursor > 0.05:
        segments.append((cursor, total))
    return segments or [(0.0, total)]


def _weight(word: str) -> float:
    core = re.sub(r"[^A-Za-z0-9₹%$]", "", word)
    syllables = len(re.findall(r"[aeiouyAEIOUY]+", core)) or 1
    digits = sum(c.isdigit() for c in core)
    return syllables * 1.0 + len(core) * 0.18 + digits * 0.5


def _pause_after(word: str) -> float:
    """How long a speaker rests after this word, in word-weights."""
    if re.search(r"[.!?…]['\")”]*$", word):
        return 1.6
    if re.search(r"[,;:—–]['\")”]*$", word):
        return 0.7
    return 0.0


def spread(words: Sequence[str], segments: List[Tuple[float, float]]) -> List[Timed]:
    """Spread the words over the stretches of speech by weight. Pauses written in the script
    (full stops, commas) take a share of the speech timeline too, so a sentence break lands on the
    silence ffmpeg found rather than in the middle of the next sentence."""
    if not words:
        return []
    units: List[Tuple[float, float, float]] = []   # (word weight, pause weight)
    total = 0.0
    for w in words:
        wt, ps = _weight(w), _pause_after(w)
        units.append((wt, ps, 0.0))
        total += wt + ps
    # Real time of a position along the speech-only timeline (0..S)
    speech_len = sum(e - s for s, e in segments)

    def real(pos: float) -> float:
        pos = min(max(pos, 0.0), speech_len)
        for s, e in segments:
            span = e - s
            if pos <= span + 1e-9:
                return s + pos
            pos -= span
        return segments[-1][1]

    out: List[Timed] = []
    cursor = 0.0
    for w, (wt, ps, _) in zip(words, units):
        a = cursor / total * speech_len
        b = (cursor + wt) / total * speech_len
        out.append(Timed(w, real(a), max(real(b), real(a) + MIN_WORD)))
        cursor += wt + ps
    return out


def match(script_words: Sequence[str], heard: Sequence[Timed], segments: Optional[List[Tuple[float, float]]] = None) -> List[Timed]:
    """Times for the script's words from the recogniser's words. Words both agree on take the
    recogniser's times; the others are spread between their matched neighbours."""
    n = len(script_words)
    if not heard:
        return spread(script_words, segments or [(0.0, 1.0)])
    a = [norm(w) for w in script_words]
    b = [norm(h.text) for h in heard]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    times: List[Optional[Tuple[float, float]]] = [None] * n
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            times[blk.a + k] = (heard[blk.b + k].start, heard[blk.b + k].end)
    lo_edge, hi_edge = heard[0].start, heard[-1].end
    out: List[Timed] = []
    i = 0
    while i < n:
        if times[i] is not None:
            out.append(Timed(script_words[i], *times[i]))
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        left = times[i - 1][1] if i > 0 else lo_edge
        right = times[j][0] if j < n else hi_edge
        right = max(right, left + MIN_WORD * (j - i))
        out += spread(script_words[i:j], [(left, right)])
        i = j
    return _monotonic(out)


def _monotonic(items: List[Timed]) -> List[Timed]:
    """Make the times never run backwards and every word at least MIN_WORD long."""
    last = 0.0
    for t in items:
        t.start = max(t.start, last)
        t.end = max(t.end, t.start + MIN_WORD)
        last = t.end
    return items


_model = None
_model_name = None


def whisper_model():
    """The faster-whisper model, or None when it isn't installed or its files aren't downloaded."""
    global _model, _model_name
    if _model is not None:
        return _model
    name = os.environ.get("REEL_WHISPER_MODEL", "base.en").strip() or "base.en"
    try:
        from faster_whisper import WhisperModel
        _model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=2,
                              local_files_only=os.environ.get("REEL_WHISPER_ONLINE", "") == "")
        _model_name = name
    except Exception:
        _model = False
    return _model or None


def recognise(path: Path) -> Optional[List[Timed]]:
    model = whisper_model()
    if not model:
        return None
    try:
        segments, _info = model.transcribe(str(path), language="en", word_timestamps=True, vad_filter=True,
                                           condition_on_previous_text=False, beam_size=1)
        words = [Timed(w.word.strip(), float(w.start), float(w.end)) for seg in segments for w in (seg.words or []) if w.word.strip()]
        return words or None
    except Exception:
        return None


def available() -> str:
    """Which backend align() will use, for the health check."""
    return f"whisper ({_model_name or os.environ.get('REEL_WHISPER_MODEL', 'base.en')})" if whisper_model() else "spread (no model)"


def align(path: Path, script_words: Sequence[str], backend: str = "auto") -> Tuple[List[Timed], str]:
    """Word times for script_words spoken in the audio file. Returns (times, backend used)."""
    words = list(script_words)
    segments = speech_segments(path)
    if backend in ("auto", "whisper"):
        heard = recognise(path)
        if heard:
            return match(words, heard, segments), f"whisper ({_model_name})"
    return _monotonic(spread(words, segments)), "spread"
