#!/usr/bin/env python3
"""alarm_sounds.py - LUMO's alarm sounds (esp32_client/tones.h), for Sage.

Builds tones.h with the host's g++ and reads the sounds back out of it, so
nothing is copied by hand:

    python3 lumo/tools/alarm_sounds.py            # writes src/components/lumo/alarmSounds.ts
    python3 lumo/tools/alarm_sounds.py --wav DIR  # also one cycle of each as a WAV

The .ts file is what the LUMO page draws each sound's notes from. The WAVs
are a rough idea of the sound (a square wave at the same pitch and duty); the
real buzzer, behind its 1 nF capacitor, sounds thinner and louder near 2.7 kHz.
Run it again after changing tones.h.
"""

import argparse
import json
import math
import re
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FW = ROOT / "lumo" / "esp32_client"
OUT_TS = ROOT / "src" / "components" / "lumo" / "alarmSounds.ts"

HARNESS = r"""
#include <cstdint>
#include <cstdio>
%(defines)s
%(enum)s
#include "tones.h"
int main() {
  printf("[");
  for (unsigned t = 0; t < TONE_COUNT; t++) {
    const ToneDef& d = TONE_LIB[t];
    printf("%%s{\"id\":\"%%s\",\"buildMs\":%%u,\"frames\":[", t ? "," : "", d.name, (unsigned)d.buildMs);
    for (unsigned i = 0; i < d.n; i++)
      printf("%%s[%%u,%%u,%%u]", i ? "," : "", d.f[i].level, d.f[i].ms, d.f[i].hz);
    printf("]}");
  }
  printf("]\n");
}
"""


def read_sounds() -> list:
    config = (FW / "config.h").read_text(encoding="utf-8")
    defines = "\n".join(re.findall(r"^#define\s+ALARM_\w+\s+\d+.*$", config, re.M))
    enum = re.search(r"enum AlarmTone\s*\{[^}]*\};", config).group(0)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "tones_dump.cpp"
        exe = Path(tmp) / "tones_dump"
        src.write_text(HARNESS % {"defines": defines, "enum": enum}, encoding="utf-8")
        subprocess.run(["g++", "-std=c++17", "-I", str(FW), str(src), "-o", str(exe)], check=True)
        return json.loads(subprocess.run([str(exe)], check=True, capture_output=True, text=True).stdout)


def notes(frames: list) -> list:
    """The notes of one cycle: [start ms, length ms, hz, peak level]. Every
    frame of a note names its pitch; a rest names none."""
    out, t, current = [], 0, None
    for level, ms, hz in frames:
        if not hz:
            current = None
        else:
            if current is None or current[2] != hz:
                current = [t, 0, hz, 0]
                out.append(current)
            current[1] = t + ms - current[0]
            current[3] = max(current[3], level)
        t += ms
    return out


def write_ts(sounds: list) -> None:
    lines = [
        "// Made by lumo/tools/alarm_sounds.py from lumo/esp32_client/tones.h. Don't edit by hand.",
        "// Each sound's notes over one cycle: [start ms, length ms, pitch Hz, peak 0-255].",
        "export interface AlarmSoundShape { cycleMs: number; buildMs: number; notes: [number, number, number, number][] }",
        "",
        "export const ALARM_SOUND_SHAPES: Record<string, AlarmSoundShape> = {",
    ]
    for s in sounds:
        cycle = sum(f[1] for f in s["frames"])
        lines.append(f"  {s['id']}: {{ cycleMs: {cycle}, buildMs: {s['buildMs']}, notes: {json.dumps(notes(s['frames']))} }},")
    lines.append("};")
    OUT_TS.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_wav(sound: dict, path: Path, volume: int = 80, rate: int = 44100) -> None:
    """One cycle as the engine plays it: S-curve glides between frame levels,
    duty = level/255 * the volume's duty (peripherals.cpp toneDuty)."""
    top = 0.5 * 10 ** ((volume - 100) / 50)
    samples, phase, hz, prev = [], 0.0, 2700, 0.0
    for level, ms, f_hz in sound["frames"]:
        if f_hz:
            hz = f_hz
        n = max(1, int(rate * ms / 1000))
        for i in range(n):
            t = i / n
            t = t * t * (3 - 2 * t)
            duty = (prev + (level - prev) * t) / 255 * top
            phase = (phase + hz / rate) % 1.0
            samples.append(0.9 * ((1 if phase < duty else 0) - duty))   # no DC, as through C1
        prev = level
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 32000)) for x in samples))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wav", type=Path, help="also write one cycle of each sound here")
    ap.add_argument("--json", action="store_true", help="print the sounds as JSON")
    args = ap.parse_args()
    sounds = read_sounds()
    write_ts(sounds)
    if args.wav:
        args.wav.mkdir(parents=True, exist_ok=True)
        for s in sounds:
            write_wav(s, args.wav / f"{s['id']}.wav")
    if args.json:
        json.dump(sounds, sys.stdout)
    for s in sounds:
        print(f"{s['id']:8s} one cycle {sum(f[1] for f in s['frames']):5d} ms, builds over {s['buildMs'] / 1000:g} s", file=sys.stderr)


if __name__ == "__main__":
    main()
