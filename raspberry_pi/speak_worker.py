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


def _bell(rate, f, dur, idx=1.2, ratio=2.0, decay=2.0, att=0.004):
    import numpy as np
    t = np.arange(int(rate * dur)) / rate
    env = np.minimum(1, t / att) * np.exp(-t * decay)
    mod = np.sin(2 * math.pi * f * ratio * t) * idx * np.exp(-t * decay * 1.6)
    return env * np.sin(2 * math.pi * f * t + mod)


def _pad(rate, f, dur, att, decay):
    import numpy as np
    t = np.arange(int(rate * dur)) / rate
    env = np.minimum(1, t / att) * np.exp(-np.maximum(t - att, 0) * decay)
    s = 0
    for d in (0.996, 1.0, 1.004):       # three slightly detuned voices: a warm chorus
        s = s + np.sin(2 * math.pi * f * d * t) + 0.25 * np.sin(2 * math.pi * 2 * f * d * t)
    return env * s / 3


def chime(rate: int, direction: str = "up"):
    """The "bloom" chime: a warm C major 9 chord swells in (hello) or drops and
    fades (goodbye), with one soft glass bell on top, and a hall tail. About 3 s;
    the voice starts over its tail (see main)."""
    import numpy as np
    up = direction != "down"
    freqs = [130.81, 196.0, 261.63, 329.63, 392.0, 587.33]      # C3 G3 C4 E4 G4 D5
    total = 3.2
    out = np.zeros(int(rate * total), dtype="float64")
    for f in freqs:
        sig = _pad(rate, f, 3.0, 0.5 if up else 0.12, 1.1 if up else 1.6)
        out[:len(sig)] += 0.5 * sig
    bell = _bell(rate, 1046.5 if up else 783.99, 2.6)
    start = int(rate * (0.55 if up else 0.0))
    out[start:start + len(bell)] += 0.55 * bell[:len(out) - start]
    # a soft hall: quickly fading noise tail, mixed in quietly
    rng = np.random.default_rng(3)
    n = int(rate * 1.8)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (rate * 1.8 / 4.5))
    ir[:int(rate * 0.015)] *= np.linspace(0, 1, int(rate * 0.015))
    size = 1 << (len(out) + n).bit_length()
    wet = np.fft.irfft(np.fft.rfft(out, size) * np.fft.rfft(ir, size), size)[:len(out)]
    wet *= np.abs(out).max() / max(np.abs(wet).max(), 1e-9)
    mix = out * 0.65 + wet * 0.35
    mix *= 0.5 / max(np.abs(mix).max(), 1e-9)
    fade = int(rate * 0.4)
    mix[-fade:] *= np.linspace(1, 0, fade)
    return mix.astype("float32")


def main() -> int:
    import numpy as np
    from autocontent.reel import voice as v

    job = json.loads(sys.stdin.read())
    rate = v.SAMPLE_RATE
    parts = []
    for text, gap in v.pieces(job["text"]):
        if text:
            parts.append(np.asarray(v.synthesize(v.speakable(text), job.get("voice") or "bm_george",
                                                 float(job.get("speed") or 1.0)), dtype="float32"))
        if gap:
            parts.append(v.silence(gap))
    parts.append(v.silence(0.4))
    speech = np.concatenate(parts)
    lead = v.silence(0.8)   # soundbars clip the first moment of a new stream
    if job.get("chime"):
        # the voice starts while the chime's tail is still ringing
        tone = chime(rate, "down" if job.get("chime") == "down" else "up")
        at = int(rate * 1.4)
        mixed = np.zeros(max(len(tone), at + len(speech)), dtype="float32")
        mixed[:len(tone)] += tone
        mixed[at:at + len(speech)] += speech
        speech = mixed
    raw = Path(job["out"]).with_suffix(".raw.wav")
    v.write_wav(raw, np.concatenate([lead, speech]))
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
