"""Live health numbers for the Pi: CPU, GPU, temperatures, memory, swap, uptime
and free space on both storage devices.

Cheap on purpose: a few /proc reads and (when present) two quick vcgencmd
calls, cached for a couple of seconds so many open Settings pages cost the same
as one. No extra dependencies; every number is None when the Pi can't give it.
"""
import os
import shutil
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional

CACHE_SECONDS = 2.0
_lock = threading.Lock()
_cache: Dict[str, Any] = {"at": 0.0, "data": None}
_prev_cpu: Optional[tuple] = None  # (busy, total) from the last call


def _read(path: str) -> Optional[str]:
    try:
        with open(path, "r") as f:
            return f.read()
    except OSError:
        return None


def _cpu_times() -> Optional[tuple]:
    text = _read("/proc/stat")
    if not text:
        return None
    first = text.splitlines()[0].split()
    if first[0] != "cpu":
        return None
    nums = [int(x) for x in first[1:9]]
    idle = nums[3] + nums[4]  # idle + iowait
    total = sum(nums)
    return total - idle, total


def _cpu_percent() -> Optional[float]:
    """Busy share since the previous call. First call has nothing to compare, so it waits a beat."""
    global _prev_cpu
    now = _cpu_times()
    if now is None:
        return None
    prev = _prev_cpu
    if prev is None:
        time.sleep(0.2)
        prev, now = now, _cpu_times() or now
    _prev_cpu = now
    busy, total = now[0] - prev[0], now[1] - prev[1]
    return round(100 * busy / total, 1) if total > 0 else None


def _vcgencmd(*args: str) -> Optional[str]:
    exe = shutil.which("vcgencmd") or ("/usr/bin/vcgencmd" if os.path.exists("/usr/bin/vcgencmd") else None)
    if not exe:
        return None
    try:
        out = subprocess.run([exe, *args], capture_output=True, text=True, timeout=1.5)
        return out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _num(text: Optional[str], suffix_strip: str = "") -> Optional[float]:
    """'temp=48.3'C' -> 48.3 ; 'frequency(46)=500000000' -> 500000000."""
    if not text or "=" not in text:
        return None
    raw = text.split("=", 1)[1].replace(suffix_strip, "").replace("'C", "").replace("M", "").strip()
    try:
        return float(raw)
    except ValueError:
        return None


def _cpu_temp() -> Optional[float]:
    text = _read("/sys/class/thermal/thermal_zone0/temp")
    try:
        return round(int(text) / 1000, 1) if text else None
    except ValueError:
        return None


def _meminfo() -> Dict[str, int]:
    out: Dict[str, int] = {}
    for line in (_read("/proc/meminfo") or "").splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            out[key] = int(parts[0]) * 1024
    return out


def _fan_rpm() -> Optional[int]:
    base = "/sys/class/hwmon"
    try:
        for d in os.listdir(base):
            text = _read(f"{base}/{d}/fan1_input")
            if text and text.strip().isdigit():
                return int(text)
    except OSError:
        pass
    return None


def _throttle_flags(code: Optional[int]) -> List[str]:
    if code is None:
        return []
    names = {0: "Under-voltage now", 1: "CPU speed capped now", 2: "Throttled now", 3: "Hot, soft limit now",
             16: "Under-voltage since boot", 17: "CPU capped since boot", 18: "Throttled since boot", 19: "Hot since boot"}
    return [label for bit, label in names.items() if code & (1 << bit)]


def _disk(label: str, path: str, device_hint: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"label": label, "path": path, "device": device_hint}
    if path != "/" and not os.path.ismount(path):
        out["mounted"] = False
        return out
    try:
        u = shutil.disk_usage(path)
        out.update(mounted=True, total=u.total, used=u.used, free=u.free,
                   usedPercent=round(100 * u.used / u.total, 1) if u.total else None)
    except OSError as e:
        out.update(mounted=False, error=f"{e.__class__.__name__}"[:60])
    return out


def _uptime() -> Optional[int]:
    text = _read("/proc/uptime")
    try:
        return int(float(text.split()[0])) if text else None
    except (ValueError, IndexError):
        return None


def _collect() -> Dict[str, Any]:
    mem = _meminfo()
    total, avail = mem.get("MemTotal", 0), mem.get("MemAvailable", 0)
    swap_total, swap_free = mem.get("SwapTotal", 0), mem.get("SwapFree", 0)
    load = os.getloadavg() if hasattr(os, "getloadavg") else (None, None, None)
    gpu_temp = _num(_vcgencmd("measure_temp"))
    cpu_temp = _cpu_temp()
    throttled_raw = _vcgencmd("get_throttled")
    try:
        throttled = int(throttled_raw.split("=", 1)[1], 16) if throttled_raw and "=" in throttled_raw else None
    except ValueError:
        throttled = None
    gpu_clock = _num(_vcgencmd("measure_clock", "v3d"))
    gpu_mem = _num(_vcgencmd("get_mem", "gpu"))
    mount = os.getenv("SAGE_DATA_MOUNT", "/mnt/sagedata")
    return {
        "at": time.time(),
        "cpu": {"percent": _cpu_percent(), "cores": os.cpu_count(), "load": [round(x, 2) for x in load] if load[0] is not None else None},
        "gpu": {"tempC": gpu_temp if gpu_temp is not None else cpu_temp,
                "clockMHz": round(gpu_clock / 1e6) if gpu_clock else None,
                "memoryMB": int(gpu_mem) if gpu_mem else None},
        "tempC": cpu_temp,
        "fanRpm": _fan_rpm(),
        "throttled": _throttle_flags(throttled),
        "memory": {"total": total, "used": max(0, total - avail), "free": avail,
                   "usedPercent": round(100 * (total - avail) / total, 1) if total else None},
        "swap": {"total": swap_total, "used": max(0, swap_total - swap_free),
                 "usedPercent": round(100 * (swap_total - swap_free) / swap_total, 1) if swap_total else None},
        "uptimeSeconds": _uptime(),
        "disks": [_disk("USB boot drive", "/", "sda"), _disk("SD card", mount, "sagedata")],
    }


def snapshot() -> Dict[str, Any]:
    with _lock:
        if _cache["data"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["data"]
        data = _collect()
        _cache.update(at=time.time(), data=data)
        return data
