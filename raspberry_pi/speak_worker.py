"""speak_worker.py - one line of speech as a wav, for speaker.py.

Runs as its own short-lived low-priority process so Kokoro's memory goes away
afterwards. Reads JSON on stdin: {text, voice, speed, volume, chime, out}.
Writes a 48 kHz stereo 16-bit wav (what A2DP soundbars take) to `out`.
"""

import json
import math
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "content_engine" / "src"))


def chime(rate: int, direction: str = "up"):
    """The grand, gracious sound of a soundbar powering on (up) or off (down):
    a warm five-note arpeggio of a C major chord with a shimmering pad and a soft hall tail."""
    import numpy as np
    notes = [261.63, 392.00, 523.25, 659.25, 783.99]       # C4 G4 C5 E5 G5
    if direction == "down":
        notes = notes[::-1]
    step, ring = 0.13, 1.5
    total = step * (len(notes) - 1) + ring
    out = np.zeros(int(rate * total), dtype="float64")
    t = np.arange(int(rate * ring)) / rate
    for i, freq in enumerate(notes):
        env = np.minimum(1, t / 0.025) * np.exp(-t * (2.6 + 0.2 * i))
        tone = np.zeros_like(t)
        for detune in (0.997, 1.003):          # two slightly detuned voices: a warm chorus
            f = freq * detune
            tone += np.sin(2 * math.pi * f * t) + 0.3 * np.sin(2 * math.pi * 2 * f * t) + 0.1 * np.sin(2 * math.pi * 3 * f * t)
        start = int(rate * step * i)
        out[start:start + len(t)] += 0.05 * env * tone
    # a soft hall: the same sound through a quickly fading noise tail, mixed in quietly
    rng = np.random.default_rng(7)
    n = int(rate * 0.9)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (rate * 0.22))
    size = 1 << (len(out) + n).bit_length()
    wet = np.fft.irfft(np.fft.rfft(out, size) * np.fft.rfft(ir, size), size)[:len(out)]
    wet *= 0.25 * np.abs(out).max() / max(np.abs(wet).max(), 1e-9)
    mix = out + wet
    mix *= 0.5 / max(np.abs(mix).max(), 1e-9)
    fade = int(rate * 0.25)
    mix[-fade:] *= np.linspace(1, 0, fade)
    return mix.astype("float32")


def main() -> int:
    import numpy as np
    from autocontent.reel import voice as v

    job = json.loads(sys.stdin.read())
    rate = v.SAMPLE_RATE
    parts = [v.silence(0.8)]  # soundbars clip the first moment of a new stream
    if job.get("chime"):
        parts += [chime(rate, "down" if job.get("chime") == "down" else "up"), v.silence(0.1)]
    for text, gap in v.pieces(job["text"]):
        if text:
            parts.append(np.asarray(v.synthesize(v.speakable(text), job.get("voice") or "bm_george",
                                                 float(job.get("speed") or 1.0)), dtype="float32"))
        if gap:
            parts.append(v.silence(gap))
    parts.append(v.silence(0.4))
    raw = Path(job["out"]).with_suffix(".raw.wav")
    v.write_wav(raw, np.concatenate(parts))
    gain = max(0.1, min(1.0, int(job.get("volume") or 80) / 100))
    af = v.POLISH_CHAINS["natural"] + f",loudnorm=I=-16:TP=-1.5:LRA=11,volume={gain:.2f}"
    proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), "-af", af,
                           "-ac", "2", "-ar", "48000", "-sample_fmt", "s16", job["out"]],
                          capture_output=True, text=True, timeout=120)
    raw.unlink(missing_ok=True)
    if proc.returncode:
        print("ffmpeg: " + proc.stderr.strip()[-200:])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
