"""
ambient.py - the clock's quieter jobs: the weather and the Pi's vitals.
"""

import os
import shutil
from typing import Optional, Tuple

import httpx

# Bengaluru, where LUMO has always lived, unless the Pi's environment says otherwise.
LAT = float(os.getenv("SAGE_DESK_LAT", "13.003648"))
LON = float(os.getenv("SAGE_DESK_LON", "77.628993"))


def weather_icon(code: int) -> str:
    """An open-meteo weather code as one of the clock's five icons."""
    if 1 <= code <= 3 or code in (45, 48):
        return "cloudy"
    if 51 <= code <= 67 or 80 <= code <= 82:
        return "rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "snow"
    if 95 <= code <= 99:
        return "storm"
    return "clear"


async def fetch_weather(lat: float = LAT, lon: float = LON) -> Optional[dict]:
    """The WEATHER command for right now, or None if open-meteo can't be reached."""
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(url)
        res.raise_for_status()
        current = res.json().get("current_weather", {})
        return {
            "cmd": "WEATHER",
            "temp_c": round(float(current.get("temperature", 0.0)), 1),
            "icon": weather_icon(int(current.get("weathercode", 0))),
        }
    except Exception:
        return None


class Vitals:
    """CPU temperature and load, memory and disk use, read from /proc and /sys."""

    def __init__(self, root: str = "/") -> None:
        self.root = root
        self._prev: Tuple[float, float] = (0.0, 0.0)

    def _read(self, path: str) -> str:
        with open(os.path.join(self.root, path.lstrip("/"))) as f:
            return f.read()

    def cpu_temp(self) -> float:
        try:
            return round(int(self._read("/sys/class/thermal/thermal_zone0/temp").strip()) / 1000, 1)
        except (OSError, ValueError):
            return 0.0

    def cpu_pct(self) -> int:
        """Busy share since the last call."""
        try:
            parts = [float(x) for x in self._read("/proc/stat").splitlines()[0].split()[1:8]]
        except (OSError, ValueError, IndexError):
            return 0
        idle, total = parts[3] + parts[4], sum(parts)
        d_idle, d_total = idle - self._prev[0], total - self._prev[1]
        self._prev = (idle, total)
        return max(0, min(100, int((1 - d_idle / d_total) * 100))) if d_total > 0 else 0

    def ram_pct(self) -> int:
        try:
            mem = {}
            for line in self._read("/proc/meminfo").splitlines():
                name, _, rest = line.partition(":")
                if rest.split():
                    mem[name.strip()] = int(rest.split()[0])
            return int((1 - mem.get("MemAvailable", mem.get("MemFree", 0)) / mem["MemTotal"]) * 100)
        except (OSError, ValueError, KeyError, ZeroDivisionError):
            return 0

    def disk_pct(self) -> int:
        try:
            usage = shutil.disk_usage(self.root)
            return int(usage.used / usage.total * 100)
        except OSError:
            return 0

    def command(self) -> dict:
        return {
            "cmd": "SYSTEM_STATS",
            "cpu_temp": self.cpu_temp(),
            "cpu_pct": self.cpu_pct(),
            "ram_pct": self.ram_pct(),
            "disk_pct": self.disk_pct(),
        }
