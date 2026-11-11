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


def chime(rate: int):
    """A soft two-note rise, like an assistant waking up."""
    import numpy as np
    out = []
    for freq, secs in ((660.0, 0.16), (990.0, 0.30)):
        t = np.arange(int(rate * secs)) / rate
        env = np.minimum(1, t / 0.02) * np.exp(-t * 6)
        out.append(0.22 * env * np.sin(2 * math.pi * freq * t))
    return np.concatenate(out).astype("float32")


def main() -> int:
    import numpy as np
    from autocontent.reel import voice as v

    job = json.loads(sys.stdin.read())
    rate = v.SAMPLE_RATE
    parts = [v.silence(0.8)]  # soundbars clip the first moment of a new stream
    if job.get("chime"):
        parts += [chime(rate), v.silence(0.25)]
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
