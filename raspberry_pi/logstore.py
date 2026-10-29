"""A small, capped log store for the Sage server.

Sage writes its own running record here: errors, HTTP requests, sync and
backup, the notifier, and the background workers. The store keeps a fixed
amount on disk — once it is full the oldest lines are dropped, so it never
grows without bound (a ring buffer by size, not by count).

Two knobs, both saved next to the database in ``sage_settings.json``:

* ``enabled`` — whether Sage records anything at all (default on).
* ``maxBytes`` — how much to keep before the oldest lines go (default 20 MB).

Each entry is one JSON object per line (JSONL):
``{"t": ISO-8601, "level": "info|warn|error", "source": "...", "msg": "..."}``.

Claude reads the store through the ``sage_logs`` connector tool; the web app
turns it on or off and sets the size in Settings > Server & Reset.
"""

import json
import os
import threading
import datetime
from pathlib import Path
from typing import List, Optional

LEVELS = ("debug", "info", "warn", "error")

_DEFAULTS = {"enabled": True, "maxBytes": 20 * 1024 * 1024}
_MIN_BYTES = 256 * 1024          # 256 KB floor, so the cap can't be set to nothing.
_MAX_BYTES = 500 * 1024 * 1024   # 500 MB ceiling, to protect a small SD card.

_dir = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent
_LOG_FILE = _dir / "sage.log"
_SETTINGS_FILE = _dir / "sage_settings.json"

_lock = threading.Lock()
_settings: Optional[dict] = None


# --- Settings ---------------------------------------------------------------

def _all_settings() -> dict:
    try:
        return json.loads(_SETTINGS_FILE.read_text())
    except (OSError, ValueError):
        return {}


def _load() -> dict:
    global _settings
    if _settings is None:
        saved = _all_settings().get("logs") or {}
        _settings = {
            "enabled": bool(saved.get("enabled", _DEFAULTS["enabled"])),
            "maxBytes": _clamp_bytes(saved.get("maxBytes", _DEFAULTS["maxBytes"])),
        }
    return _settings


def _clamp_bytes(value) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = _DEFAULTS["maxBytes"]
    return max(_MIN_BYTES, min(_MAX_BYTES, n))


def settings() -> dict:
    """The current knobs, plus the bounds and how much room is in use."""
    with _lock:
        cfg = dict(_load())
    try:
        used = _LOG_FILE.stat().st_size
    except OSError:
        used = 0
    cfg["usedBytes"] = used
    cfg["minBytes"] = _MIN_BYTES
    cfg["maxBytesLimit"] = _MAX_BYTES
    return cfg


def update(enabled: Optional[bool] = None, max_bytes=None) -> dict:
    """Change the knobs and save them next to the database."""
    with _lock:
        cfg = dict(_load())
        if enabled is not None:
            cfg["enabled"] = bool(enabled)
        if max_bytes is not None:
            cfg["maxBytes"] = _clamp_bytes(max_bytes)
        global _settings
        _settings = cfg
        whole = _all_settings()
        whole["logs"] = cfg
        try:
            _SETTINGS_FILE.write_text(json.dumps(whole, ensure_ascii=False))
        except OSError:
            pass
        # If the cap shrank below what's on disk, trim right away.
        _trim_locked(cfg["maxBytes"])
    return settings()


# --- Writing ----------------------------------------------------------------

def log(level: str, source: str, msg: str) -> None:
    """Record one line. Never raises: logging must not break a request."""
    try:
        with _lock:
            cfg = _load()
            if not cfg["enabled"]:
                return
            entry = {
                "t": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "level": level if level in LEVELS else "info",
                "source": str(source)[:60],
                "msg": str(msg)[:2000],
            }
            line = json.dumps(entry, ensure_ascii=False) + "\n"
            with open(_LOG_FILE, "a", encoding="utf-8") as fh:
                fh.write(line)
            # Trim roughly every time we cross the cap; cheap stat each write.
            if _LOG_FILE.stat().st_size > cfg["maxBytes"]:
                _trim_locked(cfg["maxBytes"])
    except Exception:
        pass


def info(source: str, msg: str) -> None:
    log("info", source, msg)


def warn(source: str, msg: str) -> None:
    log("warn", source, msg)


def error(source: str, msg: str) -> None:
    log("error", source, msg)


def _trim_locked(max_bytes: int) -> None:
    """Drop the oldest lines until the file is within ``max_bytes``.

    Keeps the newest ~90% of the cap so trimming doesn't run on every write
    once full. Called while holding ``_lock``.
    """
    try:
        size = _LOG_FILE.stat().st_size
    except OSError:
        return
    if size <= max_bytes:
        return
    keep = int(max_bytes * 0.9)
    try:
        with open(_LOG_FILE, "rb") as fh:
            fh.seek(max(0, size - keep))
            tail = fh.read()
        # Drop the partial first line so we start on a clean entry.
        nl = tail.find(b"\n")
        if nl != -1:
            tail = tail[nl + 1:]
        with open(_LOG_FILE, "wb") as fh:
            fh.write(tail)
    except OSError:
        pass


# --- Reading ----------------------------------------------------------------

def read(since: str = "", level: str = "", source: str = "",
         q: str = "", limit: int = 100) -> dict:
    """Recent entries, newest first, after filtering.

    * ``since`` — only entries at or after this ISO-8601 time.
    * ``level`` — only entries at this level or louder (debug<info<warn<error).
    * ``source`` — only entries whose source contains this text.
    * ``q`` — only entries whose message contains this text.
    * ``limit`` — at most this many (default 100, max 1000).
    """
    limit = max(1, min(1000, int(limit or 100)))
    want_from = LEVELS.index(level) if level in LEVELS else 0
    source = source.lower()
    q = q.lower()
    out: List[dict] = []
    try:
        with _lock, open(_LOG_FILE, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        lines = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if since and entry.get("t", "") < since:
            continue
        lvl = entry.get("level", "info")
        if want_from and (lvl not in LEVELS or LEVELS.index(lvl) < want_from):
            continue
        if source and source not in entry.get("source", "").lower():
            continue
        if q and q not in entry.get("msg", "").lower():
            continue
        out.append(entry)
        if len(out) >= limit:
            break
    cfg = settings()
    return {
        "entries": out,
        "count": len(out),
        "enabled": cfg["enabled"],
        "maxBytes": cfg["maxBytes"],
        "usedBytes": cfg["usedBytes"],
    }


def clear() -> None:
    with _lock:
        try:
            _LOG_FILE.write_text("")
        except OSError:
            pass
