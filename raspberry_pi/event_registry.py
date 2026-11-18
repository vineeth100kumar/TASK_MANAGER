"""Sage's live event registry — one timestamped line for everything Sage does.

Unlike ``logstore.py`` (which keeps a plain running log the connector can grep),
the registry is a structured event stream: every action, reaction, check,
Herald line, backup, sync, notifier push, BLE event, worker tick, HTTP request
and startup/shutdown. It is what the standalone ``/events`` page watches live
and what the ``sage_registry`` MCP tool reads.

Design
------
* One SQLite table ``events`` next to the database (on the fast SD card when
  ``data_dir`` picked one). WAL mode, synchronous NORMAL via ``sqlite_tuning``.
* Each row: ``ts`` (ISO-8601 UTC), ``seq`` (monotonic), ``source`` (module),
  ``level`` (debug|info|warn|error), ``kind`` (short slug, e.g. "startup",
  "request", "herald.say", "backup.done"), ``actor`` (who/what, optional),
  ``summary`` (one short line), ``data`` (JSON of extras, optional).
* Rotation by row count and age, trimmed every 500 inserts. Cap defaults to
  200 000 rows (about 40-60 MB on disk) and 14 days. Settings live in the same
  ``sage_settings.json`` as ``logstore`` so one place changes both.
* A tiny in-process pub/sub (``subscribe``/``_broadcast``) feeds the live SSE
  stream the ``/events`` page watches. New rows are also kept in a ring buffer
  so a late subscriber can replay the last few.
* The write path is bounded and non-blocking from the caller's view: writes go
  on a daemon thread's queue and are batched. A failed write never raises into
  the caller.

Call sites hook in through ``logstore.log`` (which forwards to ``simple``) and
through direct ``event()`` calls at structured points (startup, Herald, backup,
notifier, BLE, workers).
"""

from __future__ import annotations

import datetime
import json
import os
import queue
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

LEVELS = ("debug", "info", "warn", "error")

_DEFAULTS = {"enabled": True, "maxRows": 200_000, "maxAgeDays": 14}
_MIN_ROWS = 1_000
_MAX_ROWS = 2_000_000
_MIN_AGE = 1
_MAX_AGE = 90

_dir = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent
_DB_FILE = _dir / "sage_events.db"
_SETTINGS_FILE = _dir / "sage_settings.json"

_write_queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(maxsize=10_000)
_subscribers: List["queue.Queue[Dict[str, Any]]"] = []
_sub_lock = threading.Lock()
_recent: List[Dict[str, Any]] = []  # tail ring buffer for late subscribers
_RECENT_MAX = 200
_recent_lock = threading.Lock()

_seq_lock = threading.Lock()
_seq = 0
_writer_started = False
_writer_lock = threading.Lock()
_settings_cache: Optional[Dict[str, Any]] = None


# --- Settings ---------------------------------------------------------------

def _all_settings() -> Dict[str, Any]:
    try:
        return json.loads(_SETTINGS_FILE.read_text())
    except (OSError, ValueError):
        return {}


def _load_settings() -> Dict[str, Any]:
    global _settings_cache
    if _settings_cache is None:
        saved = _all_settings().get("registry") or {}
        _settings_cache = {
            "enabled": bool(saved.get("enabled", _DEFAULTS["enabled"])),
            "maxRows": _clamp(saved.get("maxRows", _DEFAULTS["maxRows"]), _MIN_ROWS, _MAX_ROWS),
            "maxAgeDays": _clamp(saved.get("maxAgeDays", _DEFAULTS["maxAgeDays"]), _MIN_AGE, _MAX_AGE),
        }
    return _settings_cache


def _clamp(value: Any, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return lo
    return max(lo, min(hi, n))


def settings() -> Dict[str, Any]:
    cfg = dict(_load_settings())
    cfg["rowCount"] = _count_rows()
    cfg["dbPath"] = str(_DB_FILE)
    cfg["minRows"] = _MIN_ROWS
    cfg["maxRowsLimit"] = _MAX_ROWS
    return cfg


def update(enabled: Optional[bool] = None,
           max_rows: Optional[int] = None,
           max_age_days: Optional[int] = None) -> Dict[str, Any]:
    cfg = dict(_load_settings())
    if enabled is not None:
        cfg["enabled"] = bool(enabled)
    if max_rows is not None:
        cfg["maxRows"] = _clamp(max_rows, _MIN_ROWS, _MAX_ROWS)
    if max_age_days is not None:
        cfg["maxAgeDays"] = _clamp(max_age_days, _MIN_AGE, _MAX_AGE)
    global _settings_cache
    _settings_cache = cfg
    whole = _all_settings()
    whole["registry"] = cfg
    try:
        _SETTINGS_FILE.write_text(json.dumps(whole, ensure_ascii=False))
    except OSError:
        pass
    _trim_now()
    return settings()


# --- Schema -----------------------------------------------------------------

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_FILE), timeout=5.0)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.Error:
        pass
    conn.execute(
        """CREATE TABLE IF NOT EXISTS events (
              id       INTEGER PRIMARY KEY AUTOINCREMENT,
              ts       TEXT    NOT NULL,
              seq      INTEGER NOT NULL,
              source   TEXT    NOT NULL,
              level    TEXT    NOT NULL,
              kind     TEXT    NOT NULL,
              actor    TEXT,
              summary  TEXT    NOT NULL,
              data     TEXT
           )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_source ON events(source)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)")
    return conn


def _count_rows() -> int:
    try:
        with _connect() as c:
            return c.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    except sqlite3.Error:
        return 0


# --- Writer thread ----------------------------------------------------------

def _writer_loop() -> None:
    conn = _connect()
    inserts_since_trim = 0
    try:
        while True:
            try:
                first = _write_queue.get(timeout=60)
            except queue.Empty:
                continue
            if first is None:
                break
            batch = [first]
            # Drain up to ~200 at a time to amortise commits.
            while len(batch) < 200:
                try:
                    item = _write_queue.get_nowait()
                except queue.Empty:
                    break
                if item is None:
                    batch.append(None)
                    break
                batch.append(item)
            done = False
            if batch and batch[-1] is None:
                done = True
                batch = [b for b in batch if b is not None]
            if batch:
                try:
                    conn.executemany(
                        "INSERT INTO events (ts, seq, source, level, kind, actor, summary, data)"
                        " VALUES (:ts, :seq, :source, :level, :kind, :actor, :summary, :data)",
                        batch,
                    )
                    conn.commit()
                    inserts_since_trim += len(batch)
                except sqlite3.Error:
                    pass
            if inserts_since_trim >= 500:
                try:
                    _trim(conn)
                except sqlite3.Error:
                    pass
                inserts_since_trim = 0
            if done:
                break
    finally:
        try:
            conn.close()
        except sqlite3.Error:
            pass


def _ensure_writer() -> None:
    global _writer_started
    if _writer_started:
        return
    with _writer_lock:
        if _writer_started:
            return
        t = threading.Thread(target=_writer_loop, name="event-registry-writer", daemon=True)
        t.start()
        _writer_started = True


def _trim(conn: sqlite3.Connection) -> None:
    cfg = _load_settings()
    max_rows = cfg["maxRows"]
    cutoff = (datetime.datetime.now(datetime.timezone.utc)
              - datetime.timedelta(days=cfg["maxAgeDays"]))
    cutoff_iso = cutoff.isoformat(timespec="seconds")
    conn.execute("DELETE FROM events WHERE ts < ?", (cutoff_iso,))
    row = conn.execute("SELECT COUNT(*) FROM events").fetchone()
    count = row[0] if row else 0
    if count > max_rows:
        drop = count - int(max_rows * 0.9)
        conn.execute(
            "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT ?)",
            (drop,),
        )
    conn.commit()


def _trim_now() -> None:
    try:
        with _connect() as c:
            _trim(c)
    except sqlite3.Error:
        pass


# --- Writing ----------------------------------------------------------------

def event(kind: str, summary: str = "",
          source: str = "sage", level: str = "info",
          actor: Optional[str] = None,
          data: Optional[Dict[str, Any]] = None) -> None:
    """Record one structured event. Never raises."""
    try:
        cfg = _load_settings()
        if not cfg["enabled"]:
            return
        global _seq
        with _seq_lock:
            _seq += 1
            seq = _seq
        row = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds"),
            "seq": seq,
            "source": str(source)[:60] or "sage",
            "level": level if level in LEVELS else "info",
            "kind": str(kind)[:60] or "event",
            "actor": (str(actor)[:80] if actor else None),
            "summary": str(summary)[:2000],
            "data": json.dumps(data, ensure_ascii=False, default=str)[:4000] if data else None,
        }
        _ensure_writer()
        try:
            _write_queue.put_nowait(row)
        except queue.Full:
            # Drop oldest queue entry to keep going.
            try:
                _write_queue.get_nowait()
                _write_queue.put_nowait(row)
            except (queue.Empty, queue.Full):
                return
        _push_live(row)
    except Exception:
        pass


def simple(level: str, source: str, msg: str) -> None:
    """Bridge used by ``logstore.log``: every logstore line becomes a registry event too."""
    event(
        kind=f"log.{level}" if level in LEVELS else "log.info",
        summary=msg,
        source=source or "log",
        level=level if level in LEVELS else "info",
    )


# --- Live stream pub/sub ----------------------------------------------------

def _push_live(row: Dict[str, Any]) -> None:
    with _recent_lock:
        _recent.append(row)
        if len(_recent) > _RECENT_MAX:
            del _recent[: len(_recent) - _RECENT_MAX]
    with _sub_lock:
        subs = list(_subscribers)
    for q in subs:
        try:
            q.put_nowait(row)
        except queue.Full:
            pass


def subscribe() -> "queue.Queue[Dict[str, Any]]":
    q: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=500)
    with _sub_lock:
        _subscribers.append(q)
    with _recent_lock:
        for row in list(_recent):
            try:
                q.put_nowait(row)
            except queue.Full:
                break
    return q


def unsubscribe(q: "queue.Queue[Dict[str, Any]]") -> None:
    with _sub_lock:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


def recent() -> List[Dict[str, Any]]:
    with _recent_lock:
        return list(_recent)


# --- Reading ----------------------------------------------------------------

def read(since: str = "", level: str = "", source: str = "",
         kind: str = "", q: str = "", limit: int = 200) -> Dict[str, Any]:
    limit = max(1, min(2000, int(limit or 200)))
    want_from = LEVELS.index(level) if level in LEVELS else 0
    where: List[str] = []
    args: List[Any] = []
    if since:
        where.append("ts >= ?")
        args.append(str(since))
    if want_from:
        placeholders = ",".join("?" for _ in LEVELS[want_from:])
        where.append(f"level IN ({placeholders})")
        args.extend(LEVELS[want_from:])
    if source:
        where.append("source LIKE ?")
        args.append(f"%{source.lower()}%")
    if kind:
        where.append("kind LIKE ?")
        args.append(f"%{kind.lower()}%")
    if q:
        where.append("(LOWER(summary) LIKE ? OR LOWER(actor) LIKE ?)")
        args.extend([f"%{q.lower()}%", f"%{q.lower()}%"])
    sql = "SELECT ts, seq, source, level, kind, actor, summary, data FROM events"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    rows: List[Dict[str, Any]] = []
    try:
        with _connect() as conn:
            conn.row_factory = sqlite3.Row
            for row in conn.execute(sql, args):
                entry = {
                    "ts": row["ts"],
                    "seq": row["seq"],
                    "source": row["source"],
                    "level": row["level"],
                    "kind": row["kind"],
                    "actor": row["actor"],
                    "summary": row["summary"],
                }
                raw = row["data"]
                if raw:
                    try:
                        entry["data"] = json.loads(raw)
                    except ValueError:
                        entry["data"] = raw
                rows.append(entry)
    except sqlite3.Error:
        pass
    cfg = settings()
    return {
        "entries": rows,
        "count": len(rows),
        "enabled": cfg["enabled"],
        "rowCount": cfg["rowCount"],
        "maxRows": cfg["maxRows"],
        "maxAgeDays": cfg["maxAgeDays"],
    }


def clear() -> None:
    try:
        with _connect() as conn:
            conn.execute("DELETE FROM events")
            conn.commit()
    except sqlite3.Error:
        pass
    with _recent_lock:
        _recent.clear()


def stop() -> None:
    try:
        _write_queue.put_nowait(None)
    except queue.Full:
        pass
