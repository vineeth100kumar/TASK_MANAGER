"""Always-on, low-overhead probe that explains Sage blackouts after the fact.

Sage on the Pi is reached from the outside through a Tailscale Funnel. When the
public URL times out ("this site took too long to respond") but the server is
fine on ``localhost``, the trouble is in the path to the Pi (Funnel, Wi-Fi,
power) rather than in the app. To tell these apart after it happens, this module
keeps a small running record of how the Pi and the link are doing and turns it
into a plain "blackouts in the last 24h" story Claude can read.

Every ``SAGE_DIAG_INTERVAL`` seconds (default 30) it records, cheaply:

* **event-loop lag** — how much longer an ``asyncio.sleep`` took than asked, so a
  blocked loop (heavy sync work on the server) shows up;
* **requests in flight** and the **slowest request** seen since the last sample;
* **load, memory, swap, CPU temperature, disk I/O wait** (``/proc``);
* **under-voltage / throttling** from ``vcgencmd get_throttled`` (brown-outs);
* **network link and Wi-Fi signal** (``/sys/class/net``, ``/proc/net/wireless``);
* a **self-probe of the local server** (``127.0.0.1:8000/api/health``) and of the
  **public Funnel URL** — the pair that says "serving locally but unreachable
  from outside" vs "server itself is down";
* occasionally (every ``SAGE_DIAG_HEAVY_EVERY`` samples) **Tailscale backend/Funnel
  state** and **kernel/journal warnings** (OOM, USB resets, under-voltage).

Everything is bounded: samples live in a ring buffer in RAM (``SAGE_DIAG_KEEP_HOURS``,
default 48h) and nothing is written to disk except the occasional notable event,
which goes through :mod:`logstore` (already capped). Claude reads it with the
``sage_diagnostics`` connector tool; :mod:`system_health` folds a short summary
into ``sage_health``.

Turn it off with ``SAGE_DIAG=0``.
"""

import asyncio
import datetime
import os
import re
import subprocess
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

import httpx

import logstore

UTC = datetime.timezone.utc


# --- Knobs ------------------------------------------------------------------

def _int(name: str, default: int) -> int:
    try:
        return int(float(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def enabled() -> bool:
    return os.getenv("SAGE_DIAG", "1").strip().lower() not in ("0", "false", "off", "no")


INTERVAL = max(5, _int("SAGE_DIAG_INTERVAL", 30))          # seconds between samples
KEEP_HOURS = max(1, _int("SAGE_DIAG_KEEP_HOURS", 48))       # how long samples live
HEAVY_EVERY = max(1, _int("SAGE_DIAG_HEAVY_EVERY", 10))     # samples between heavy checks
LOCAL_URL = os.getenv("SAGE_DIAG_LOCAL_URL", "http://127.0.0.1:8000/api/health")
PUBLIC_URL = os.getenv("SAGE_PUBLIC_URL", "")              # else resolved from tailscale
PROBE_TIMEOUT = max(2, _int("SAGE_DIAG_PROBE_TIMEOUT", 10))  # seconds per self-probe
SLOW_PROBE_MS = max(500, _int("SAGE_DIAG_SLOW_MS", 4000))   # a "slow" (not down) probe
LAG_WARN_MS = max(100, _int("SAGE_DIAG_LAG_WARN_MS", 1500))  # event-loop lag worth noting

_KEEP_SAMPLES = max(10, (KEEP_HOURS * 3600) // INTERVAL)
_KEEP_EPISODES = 200
_USER_AGENT = "sage-diagnostics/1"


def _iso(ts: Optional[float] = None) -> str:
    return datetime.datetime.fromtimestamp(ts if ts is not None else time.time(), UTC).isoformat(timespec="seconds")


# --- Live request tracking (called from the HTTP middleware) ----------------

class _Live:
    """Counts requests in flight and remembers the slowest one since the last
    sample. Cheap and thread-safe; the middleware calls begin/end around every
    watched request."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.inflight = 0
        self.peak_inflight = 0          # since the last sample was taken
        self.started = 0                # requests begun since the last sample
        self.slowest_ms = 0
        self.slowest_path = ""
        self.errors = 0                 # 5xx / raised since the last sample

    def begin(self) -> None:
        with self._lock:
            self.inflight += 1
            self.started += 1
            if self.inflight > self.peak_inflight:
                self.peak_inflight = self.inflight

    def end(self, path: str, ms: int, status: int) -> None:
        with self._lock:
            if self.inflight > 0:
                self.inflight -= 1
            if ms > self.slowest_ms:
                self.slowest_ms, self.slowest_path = ms, path
            if status >= 500 or status == 0:
                self.errors += 1

    def take(self) -> dict:
        """Read the window's figures and reset them, keeping the live count."""
        with self._lock:
            out = {
                "inflight": self.inflight,
                "peakInflight": self.peak_inflight,
                "started": self.started,
                "slowestMs": self.slowest_ms,
                "slowestPath": self.slowest_path,
                "errors": self.errors,
            }
            self.peak_inflight = self.inflight
            self.started = 0
            self.slowest_ms = 0
            self.slowest_path = ""
            self.errors = 0
            return out


live = _Live()


def request_begin() -> None:
    live.begin()


def request_end(path: str, ms: int, status: int) -> None:
    live.end(path, ms, status)


# --- System readings (all best-effort, never raise) -------------------------

_prev_cpu: Optional[tuple] = None


def _read(path: str) -> str:
    try:
        with open(path, "r") as fh:
            return fh.read()
    except OSError:
        return ""


def _loadavg() -> Optional[List[float]]:
    parts = _read("/proc/loadavg").split()
    try:
        return [float(parts[0]), float(parts[1]), float(parts[2])]
    except (IndexError, ValueError):
        return None


def _memory() -> dict:
    info: Dict[str, int] = {}
    for line in _read("/proc/meminfo").splitlines():
        bits = line.split()
        if len(bits) >= 2 and bits[0].endswith(":"):
            try:
                info[bits[0][:-1]] = int(bits[1])  # kB
            except ValueError:
                pass
    total = info.get("MemTotal", 0)
    avail = info.get("MemAvailable", 0)
    swap_total = info.get("SwapTotal", 0)
    swap_free = info.get("SwapFree", 0)
    out: Dict[str, Any] = {}
    if total:
        out["freeMb"] = round(avail / 1024)
        out["usedPct"] = round((total - avail) / total * 100)
    if swap_total:
        out["swapUsedMb"] = round((swap_total - swap_free) / 1024)
    return out


def _iowait_pct() -> Optional[float]:
    """CPU time spent waiting on disk since the last sample, as a percentage.

    A slow boot drive shows up here (the USB-pen-drive stalls we chased before)."""
    global _prev_cpu
    for line in _read("/proc/stat").splitlines():
        if line.startswith("cpu "):
            try:
                vals = [int(x) for x in line.split()[1:]]
            except ValueError:
                return None
            total = sum(vals)
            iowait = vals[4] if len(vals) > 4 else 0
            prev = _prev_cpu
            _prev_cpu = (total, iowait)
            if prev and total > prev[0]:
                return round((iowait - prev[1]) / (total - prev[0]) * 100, 1)
            return None
    return None


def _temp_c() -> Optional[float]:
    raw = _read("/sys/class/thermal/thermal_zone0/temp").strip()
    try:
        return round(int(raw) / 1000, 1)
    except ValueError:
        return None


_THROTTLE_BITS = {
    0: "under-voltage now",
    1: "arm frequency capped now",
    2: "throttled now",
    3: "soft temperature limit now",
    16: "under-voltage since boot",
    17: "arm frequency capped since boot",
    18: "throttled since boot",
    19: "soft temperature limit since boot",
}


def _throttled() -> Optional[dict]:
    """``vcgencmd get_throttled`` decoded. The under-voltage bits are the Pi's
    own word that the power supply or cable dipped — a prime blackout cause."""
    try:
        out = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=4)
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"throttled=0x([0-9a-fA-F]+)", out.stdout or "")
    if not m:
        return None
    bits = int(m.group(1), 16)
    flags = [text for bit, text in _THROTTLE_BITS.items() if bits & (1 << bit)]
    return {
        "hex": f"0x{bits:x}",
        "flags": flags,
        "underVoltageNow": bool(bits & 1),
        "underVoltageEver": bool(bits & (1 << 16)),
    }


def _network() -> dict:
    """The main network link: up/down and, on Wi-Fi, the signal in dBm."""
    out: Dict[str, Any] = {}
    try:
        names = [n for n in os.listdir("/sys/class/net") if n != "lo"]
    except OSError:
        return out
    # Prefer an interface that is up; report its kind and carrier.
    chosen = None
    for name in sorted(names):
        operstate = _read(f"/sys/class/net/{name}/operstate").strip()
        carrier = _read(f"/sys/class/net/{name}/carrier").strip()
        if operstate == "up" or carrier == "1":
            chosen = name
            out["iface"] = name
            out["up"] = carrier == "1" or operstate == "up"
            out["kind"] = "wifi" if os.path.isdir(f"/sys/class/net/{name}/wireless") else "wired"
            break
    if chosen is None and names:
        out["iface"] = sorted(names)[0]
        out["up"] = False
    rssi = _wifi_rssi(out.get("iface"))
    if rssi is not None:
        out["rssiDbm"] = rssi
    return out


def _wifi_rssi(iface: Optional[str]) -> Optional[int]:
    if not iface:
        return None
    for line in _read("/proc/net/wireless").splitlines():
        line = line.strip()
        if line.startswith(iface + ":"):
            # name: status link  level  noise ...   (level is the signal in dBm)
            parts = line.split()
            try:
                return int(float(parts[3].rstrip(".")))
            except (IndexError, ValueError):
                return None
    return None


def _system_blocking() -> dict:
    """Everything that reads files or runs a subprocess, gathered off the loop."""
    return {
        "load": _loadavg(),
        "memory": _memory(),
        "iowaitPct": _iowait_pct(),
        "tempC": _temp_c(),
        "throttled": _throttled(),
        "network": _network(),
    }


# --- Heavy, occasional checks -----------------------------------------------

_public_url_cache: Optional[str] = None


def _public_url() -> Optional[str]:
    """The public Funnel URL to self-probe: ``SAGE_PUBLIC_URL`` if set, else the
    machine's MagicDNS name from ``tailscale status``."""
    global _public_url_cache
    if PUBLIC_URL:
        return PUBLIC_URL.rstrip("/") + "/api/health"
    if _public_url_cache:
        return _public_url_cache
    status = _tailscale_status()
    name = ((status or {}).get("Self") or {}).get("DNSName") or ""
    name = name.strip().rstrip(".")
    if name:
        _public_url_cache = f"https://{name}/api/health"
    return _public_url_cache


def _tailscale_status() -> Optional[dict]:
    try:
        out = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=8)
        if out.returncode != 0:
            return None
        import json
        return json.loads(out.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _tailscale_part() -> Optional[dict]:
    status = _tailscale_status()
    if not status:
        return {"ok": False, "note": "tailscale status unavailable"}
    self_node = status.get("Self") or {}
    return {
        "ok": True,
        "backendState": status.get("BackendState"),      # "Running" when healthy
        "dnsName": (self_node.get("DNSName") or "").rstrip("."),
        "online": self_node.get("Online"),
        "tailscaleIPs": self_node.get("TailscaleIPs"),
    }


_JOURNAL_PATTERNS = [
    ("underVoltage", re.compile(r"[Uu]nder-?voltage|[Vv]oltage normalised")),
    ("usbReset", re.compile(r"usb .*(reset|disconnect)|new .*USB device", re.I)),
    ("oom", re.compile(r"[Oo]ut of memory|oom-kill|killed process", re.I)),
    ("mmc", re.compile(r"mmc.*(timeout|error)|I/O error", re.I)),
    ("ethDown", re.compile(r"[Ll]ink is [Dd]own|carrier lost", re.I)),
]


def _journal_since(seconds: int) -> Optional[dict]:
    """Kernel warnings in the recent past, bucketed. Best-effort: needs the
    journal to be readable (sage runs non-root; it may be in systemd-journal)."""
    try:
        out = subprocess.run(
            ["journalctl", "-k", "--since", f"-{seconds}s", "--no-pager", "-q"],
            capture_output=True, text=True, timeout=8,
        )
        if out.returncode != 0:
            return {"ok": False, "note": "journal not readable"}
    except (OSError, subprocess.SubprocessError):
        return None
    counts: Dict[str, int] = {}
    latest: Dict[str, str] = {}
    for line in (out.stdout or "").splitlines():
        for key, pat in _JOURNAL_PATTERNS:
            if pat.search(line):
                counts[key] = counts.get(key, 0) + 1
                latest[key] = line[-200:]
    return {"ok": True, "counts": counts, "latest": latest} if counts else {"ok": True, "counts": {}}


# --- The store --------------------------------------------------------------

class _Store:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.samples: Deque[dict] = deque(maxlen=_KEEP_SAMPLES)
        self.episodes: Deque[dict] = deque(maxlen=_KEEP_EPISODES)
        self.open_episode: Optional[dict] = None
        self.started_at = time.time()
        self.last_tailscale: Optional[dict] = None
        self.last_journal: Optional[dict] = None
        self.last_under_voltage_ever = False

    def add(self, sample: dict) -> None:
        with self.lock:
            self.samples.append(sample)


store = _Store()


def _classify(episode: dict) -> str:
    if episode.get("underVoltageSeen"):
        return "power (the Pi reported under-voltage during the outage)"
    if episode.get("localOkThroughout"):
        return "network/Funnel path (Sage kept answering on localhost, so the server was up but unreachable from outside)"
    if episode.get("localFailSeen"):
        return "server/host (Sage stopped answering even on localhost)"
    return "unknown"


def _note_episode(down: bool, sample: dict) -> None:
    """Open, extend or close a blackout episode from the public self-probe."""
    ep = store.open_episode
    uv = bool((sample.get("throttled") or {}).get("underVoltageNow"))
    local_ok = sample.get("localProbe", {}).get("ok") is True
    local_fail = sample.get("localProbe", {}).get("ok") is False
    if down:
        if ep is None:
            ep = {
                "startedAt": sample["t"], "endedAt": None, "samples": 0,
                "localOkThroughout": True, "localFailSeen": False, "underVoltageSeen": False,
                "lastDetail": sample.get("publicProbe", {}).get("error") or "timed out",
            }
            store.open_episode = ep
            logstore.warn("diag", f"Blackout began: public Funnel probe failed ({ep['lastDetail']}); "
                                  f"local {'OK' if local_ok else 'also failing'}.")
        ep["samples"] += 1
        if not local_ok:
            ep["localOkThroughout"] = False
        if local_fail:
            ep["localFailSeen"] = True
        if uv:
            ep["underVoltageSeen"] = True
        ep["lastDetail"] = sample.get("publicProbe", {}).get("error") or ep["lastDetail"]
    elif ep is not None:
        ep["endedAt"] = sample["t"]
        try:
            dt = datetime.datetime.fromisoformat(ep["endedAt"]) - datetime.datetime.fromisoformat(ep["startedAt"])
            ep["durationSeconds"] = int(dt.total_seconds())
        except ValueError:
            ep["durationSeconds"] = ep["samples"] * INTERVAL
        ep["cause"] = _classify(ep)
        store.episodes.append(ep)
        store.open_episode = None
        logstore.warn("diag", f"Blackout ended after {ep['durationSeconds']}s — {ep['cause']}.")


# --- The probe loop ---------------------------------------------------------

async def _probe(client: httpx.AsyncClient, url: Optional[str]) -> dict:
    if not url:
        return {"ok": None, "note": "no url"}
    started = time.monotonic()
    try:
        resp = await client.get(url, headers={"User-Agent": _USER_AGENT})
        ms = int((time.monotonic() - started) * 1000)
        ok = resp.status_code < 500
        out = {"ok": ok, "ms": ms, "status": resp.status_code}
        if ok and ms > SLOW_PROBE_MS:
            out["slow"] = True
        if not ok:
            out["error"] = f"HTTP {resp.status_code}"
        return out
    except Exception as e:
        ms = int((time.monotonic() - started) * 1000)
        return {"ok": False, "ms": ms, "error": f"{e.__class__.__name__}: {e}"[:160]}


async def _tick(client: httpx.AsyncClient, loop_lag_ms: float, do_heavy: bool) -> dict:
    system = await asyncio.to_thread(_system_blocking)
    local_probe = await _probe(client, LOCAL_URL)
    public_probe = await _probe(client, _public_url())
    window = live.take()
    sample: dict = {
        "t": _iso(),
        "loopLagMs": round(loop_lag_ms, 1),
        "requests": window,
        "localProbe": local_probe,
        "publicProbe": public_probe,
        **system,
    }
    if do_heavy:
        store.last_tailscale = await asyncio.to_thread(_tailscale_part)
        store.last_journal = await asyncio.to_thread(_journal_since, HEAVY_EVERY * INTERVAL + INTERVAL)
    sample["tailscale"] = store.last_tailscale
    sample["journal"] = store.last_journal

    # Blackout bookkeeping (only when we actually have a public URL to judge).
    if public_probe.get("ok") is not None:
        _note_episode(public_probe.get("ok") is False, sample)

    # A few notable one-offs, deduped, into the capped log.
    throttled = system.get("throttled") or {}
    if throttled.get("underVoltageEver") and not store.last_under_voltage_ever:
        logstore.warn("diag", "Pi reports under-voltage has occurred since boot (check the power supply/cable).")
    store.last_under_voltage_ever = bool(throttled.get("underVoltageEver"))
    if loop_lag_ms >= LAG_WARN_MS:
        logstore.warn("diag", f"Event loop lagged {int(loop_lag_ms)}ms "
                              f"(busiest request: {window['slowestPath']} {window['slowestMs']}ms, "
                              f"{window['peakInflight']} in flight).")
    store.add(sample)
    return sample


async def run() -> None:
    """Background worker: one sample every INTERVAL seconds, forever."""
    if not enabled():
        logstore.info("diag", "Diagnostics probe is off (SAGE_DIAG=0).")
        return
    logstore.info("diag", f"Diagnostics probe started: every {INTERVAL}s, keeping {KEEP_HOURS}h.")
    loop = asyncio.get_event_loop()
    count = 0
    # Prime the iowait delta and let the server settle before the first sample.
    await asyncio.to_thread(_iowait_pct)
    async with httpx.AsyncClient(timeout=PROBE_TIMEOUT, follow_redirects=False) as client:
        while True:
            before = loop.time()
            await asyncio.sleep(INTERVAL)
            lag_ms = max(0.0, (loop.time() - before - INTERVAL) * 1000)
            try:
                await _tick(client, lag_ms, do_heavy=(count % HEAVY_EVERY == 0))
            except Exception as e:
                logstore.error("diag", f"Diagnostics tick failed: {e!r}")
            count += 1


# --- Reading (connector + health) -------------------------------------------

def _within(hours: float) -> List[dict]:
    cutoff = _iso(time.time() - hours * 3600)
    with store.lock:
        return [s for s in store.samples if s["t"] >= cutoff]


def _episodes_within(hours: float):
    """(closed episodes in the window, the open one if any)."""
    cutoff = _iso(time.time() - hours * 3600)
    with store.lock:
        done = [e for e in store.episodes if (e.get("endedAt") or e["startedAt"]) >= cutoff]
        openep = dict(store.open_episode) if store.open_episode else None
    return done, openep


def summary(hours: float = 24) -> dict:
    """The 'blackouts in the last N hours' story plus the current snapshot."""
    samples = _within(hours)
    done, openep = _episodes_within(hours)
    episodes = list(done)
    if openep:
        openep = dict(openep)
        openep["ongoing"] = True
        try:
            openep["durationSeconds"] = int((datetime.datetime.now(UTC)
                                             - datetime.datetime.fromisoformat(openep["startedAt"])).total_seconds())
        except ValueError:
            pass
        openep["cause"] = _classify(openep)
        episodes.append(openep)
    total_down = sum(e.get("durationSeconds") or 0 for e in episodes)
    longest = max((e.get("durationSeconds") or 0 for e in episodes), default=0)

    public_fails = sum(1 for s in samples if s.get("publicProbe", {}).get("ok") is False)
    local_fails = sum(1 for s in samples if s.get("localProbe", {}).get("ok") is False)
    slow_public = sum(1 for s in samples if s.get("publicProbe", {}).get("slow"))
    lags = [s.get("loopLagMs", 0) for s in samples]
    iowaits = [s["iowaitPct"] for s in samples if s.get("iowaitPct") is not None]
    uv_samples = sum(1 for s in samples if (s.get("throttled") or {}).get("underVoltageNow"))
    slow_reqs = sorted(
        ({"t": s["t"], "path": s["requests"]["slowestPath"], "ms": s["requests"]["slowestMs"]}
         for s in samples if s.get("requests", {}).get("slowestMs", 0) > SLOW_PROBE_MS),
        key=lambda r: r["ms"], reverse=True,
    )[:10]

    latest = samples[-1] if samples else (store.samples[-1] if store.samples else None)
    return {
        "enabled": enabled(),
        "windowHours": hours,
        "intervalSeconds": INTERVAL,
        "samples": len(samples),
        "probeStartedAt": _iso(store.started_at),
        "blackouts": {
            "count": len(episodes),
            "ongoing": bool(openep),
            "totalDownSeconds": total_down,
            "longestDownSeconds": longest,
            "episodes": episodes[-20:],
        },
        "counts": {
            "publicProbeFailures": public_fails,
            "slowPublicProbes": slow_public,
            "localProbeFailures": local_fails,
            "underVoltageSamples": uv_samples,
        },
        "loopLag": {
            "maxMs": round(max(lags), 1) if lags else 0,
            "avgMs": round(sum(lags) / len(lags), 1) if lags else 0,
            "overThresholdSamples": sum(1 for v in lags if v >= LAG_WARN_MS),
        },
        "iowait": {
            "maxPct": max(iowaits) if iowaits else None,
            "avgPct": round(sum(iowaits) / len(iowaits), 1) if iowaits else None,
        },
        "slowestRequests": slow_reqs,
        "now": _snapshot(latest),
        "verdict": _verdict(episodes, public_fails, local_fails, uv_samples, lags),
    }


def _snapshot(sample: Optional[dict]) -> Optional[dict]:
    if not sample:
        return None
    return {
        "at": sample["t"],
        "loopLagMs": sample.get("loopLagMs"),
        "load": sample.get("load"),
        "memory": sample.get("memory"),
        "iowaitPct": sample.get("iowaitPct"),
        "tempC": sample.get("tempC"),
        "throttled": sample.get("throttled"),
        "network": sample.get("network"),
        "localProbe": sample.get("localProbe"),
        "publicProbe": sample.get("publicProbe"),
        "tailscale": sample.get("tailscale"),
        "journal": sample.get("journal"),
        "requests": sample.get("requests"),
    }


def _verdict(episodes, public_fails, local_fails, uv_samples, lags) -> str:
    if not episodes and not public_fails:
        return "No blackouts recorded in this window."
    if uv_samples:
        return ("Blackouts coincide with under-voltage — most likely the Pi's power supply or cable. "
                "Try a known-good 5V/3A+ supply and short cable.")
    if local_fails:
        return ("The server itself stopped answering on localhost during outages — look at Sage/host "
                "(crashes, memory, disk I/O), not only the network.")
    if public_fails or episodes:
        return ("Sage kept answering on localhost through the outages, so the break is in the path to the Pi "
                "(Tailscale Funnel, Wi-Fi/router, or the Pi dropping off the network), not the app.")
    return "See the figures above."


def recent(limit: int = 60) -> dict:
    """The raw recent samples, newest first, for a close look."""
    limit = max(1, min(2000, int(limit or 60)))
    with store.lock:
        rows = list(store.samples)[-limit:]
    return {"count": len(rows), "intervalSeconds": INTERVAL, "samples": list(reversed(rows))}


def health_summary() -> dict:
    """A compact line for sage_health: enough to flag trouble, no detail dumps."""
    s = summary(24)
    now = s.get("now") or {}
    throttled = now.get("throttled") or {}
    return {
        "enabled": s["enabled"],
        "blackouts24h": s["blackouts"]["count"],
        "blackoutOngoing": s["blackouts"]["ongoing"],
        "longestDownSeconds": s["blackouts"]["longestDownSeconds"],
        "maxLoopLagMs": s["loopLag"]["maxMs"],
        "underVoltageNow": bool(throttled.get("underVoltageNow")),
        "underVoltageEver": bool(throttled.get("underVoltageEver")),
        "localProbe": (now.get("localProbe") or {}).get("ok"),
        "publicProbe": (now.get("publicProbe") or {}).get("ok"),
        "verdict": s["verdict"],
    }
