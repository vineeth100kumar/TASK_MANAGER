"""One read-only report on whether the Pi is working: the server, its background
workers, Radar's sources, the Markets board, backups, the phone link and the
desk clock. Claude reads it through the `sage_health` tool and
GET /api/claude/health; it carries no secrets (the clock's token stays out)."""

import datetime
import os
import sqlite3
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

STARTED = time.time()
REPO = Path(__file__).resolve().parent.parent
# Workers started with db_server._background(): name -> {"startedAt", "error"}.
workers: Dict[str, Dict[str, Any]] = {}


def _git(*args: str) -> Optional[str]:
    try:
        out = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


# Read once: the running code doesn't change until the server restarts.
COMMIT = _git("rev-parse", "--short", "HEAD")
BRANCH = _git("rev-parse", "--abbrev-ref", "HEAD")


def worker_name(coro) -> str:
    frame = getattr(coro, "cr_frame", None)
    module = frame.f_globals.get("__name__", "") if frame else ""
    name = getattr(coro, "__qualname__", "") or repr(coro)
    return f"{module}.{name}" if module else name


def worker_started(name: str) -> None:
    workers[name] = {"startedAt": _iso(time.time()), "error": None, "stoppedAt": None}


def worker_stopped(name: str, error: Optional[BaseException]) -> None:
    entry = workers.setdefault(name, {"startedAt": None})
    entry["stoppedAt"] = _iso(time.time())
    entry["error"] = f"{error.__class__.__name__}: {error}"[:300] if error else None


def _iso(ts: float) -> str:
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat(timespec="seconds")


def _rows(db_path: str, sql: str) -> List[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql).fetchall()
    except sqlite3.OperationalError:
        return []  # the table isn't there (that feature is off)
    finally:
        conn.close()


def radar_part(db_path: str, enabled: bool) -> dict:
    sources = [
        {"name": r["name"], "kind": r["kind"], "ok": bool(r["ok"]), "items": r["items"], "error": r["error"] or "",
         "checkedAt": r["checked_at"], "lastOkAt": r["last_ok_at"]}
        for r in _rows(db_path, "SELECT * FROM radar_sources ORDER BY kind DESC, name")
    ]
    return {"enabled": enabled, "down": [s["name"] for s in sources if not s["ok"]], "sources": sources}


def markets_part(db_path: str) -> dict:
    rows = _rows(db_path, "SELECT symbol, updated_at, error FROM market_series")
    failed = [r for r in rows if r["error"]]
    updated = [r["updated_at"] for r in rows if r["updated_at"]]
    return {
        "symbols": len(rows),
        "withPrices": len(updated),
        "failing": len(failed),
        "lastUpdate": max(updated) if updated else None,
        "errors": [f"{r['symbol']}: {r['error']}" for r in failed[:8]],
    }


def report(
    db_path: str,
    *,
    web_app: bool,
    auth: bool,
    password_gate: bool,
    radar_enabled: bool,
    backups: Callable[[], dict],
    phone: Callable[[], dict],
    clock: Callable[[], dict],
) -> dict:
    def safe(part: Callable[[], dict]) -> dict:
        try:
            return part()
        except Exception as e:  # one broken part shouldn't hide the rest
            return {"error": f"{e.__class__.__name__}: {e}"[:300]}

    phone_state = safe(phone)
    clock_state = safe(clock)
    try:
        db_mb = round(os.path.getsize(db_path) / 1_000_000, 1)
    except OSError:
        db_mb = None
    data = {
        "checkedAt": _iso(time.time()),
        "server": {
            "startedAt": _iso(STARTED),
            "uptimeMinutes": int((time.time() - STARTED) // 60),
            "commit": COMMIT,
            "branch": BRANCH,
            "webApp": web_app,
            "auth": auth,
            "passwordGate": password_gate,
            "databaseMb": db_mb,
        },
        "workers": [{"name": name, **info} for name, info in sorted(workers.items())],
        "radar": safe(lambda: radar_part(db_path, radar_enabled)),
        "markets": safe(lambda: markets_part(db_path)) if radar_enabled else {"enabled": False},
        "backups": safe(backups),
        "phone": {k: phone_state.get(k) for k in ("available", "connected", "deviceName", "lastSeen", "error") if k in phone_state},
        "clock": {k: clock_state.get(k) for k in ("enabled", "connected", "firmware", "connectedAt", "error") if k in clock_state},
    }
    data["problems"] = problems(data)
    return data


def problems(data: dict) -> List[str]:
    """Plain lines for what looks wrong, so a quick look needs no digging."""
    out = []
    server = data["server"]
    if not server["webApp"]:
        out.append("The web app isn't built (dist/index.html is missing).")
    if not server["auth"]:
        out.append("API_SECRET isn't set.")
    for w in data["workers"]:
        if w.get("stoppedAt"):
            out.append(f"Worker {w['name']} stopped" + (f": {w['error']}" if w.get("error") else "."))
    for s in data["radar"].get("sources", []):
        if not s["ok"]:
            out.append(f"Radar source {s['name']} is down: {s['error'] or 'no reason given'}.")
    markets = data["markets"]
    if markets.get("symbols") and markets.get("failing"):
        out.append(f"Markets board: {markets['failing']} of {markets['symbols']} symbols failing.")
    last_backup = data["backups"].get("lastBackupAt")
    if "lastBackupAt" in data["backups"]:
        when = datetime.datetime.fromisoformat(last_backup) if last_backup else None
        if not when or time.time() - when.timestamp() > 48 * 3600:
            out.append(f"No nightly backup in the last 2 days (last: {last_backup or 'never'}).")
    if data["clock"].get("enabled") and not data["clock"].get("connected"):
        out.append("The desk clock is on in settings but not connected.")
    return out
