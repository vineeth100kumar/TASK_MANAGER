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
    rows = _rows(db_path, "SELECT * FROM market_series")
    failed = [r for r in rows if r["error"]]
    updated = [r["updated_at"] for r in rows if r["updated_at"]]
    return {
        "symbols": len(rows),
        "withPrices": len(updated),
        "failing": len(failed),
        "lastUpdate": max(updated) if updated else None,
        "errors": [f"{r['symbol']}: {r['error']}" for r in failed[:8]],
        "bySource": _count(r["source"] if "source" in r.keys() else None for r in rows if r["updated_at"]),
        "twelveData": _twelve(),
    }


def _count(values) -> dict:
    out: Dict[str, int] = {}
    for v in values:
        out[v or "unknown"] = out.get(v or "unknown", 0) + 1
    return out


def _twelve() -> Optional[dict]:
    try:
        import prices
        status = prices.twelve_status()
        return {"keySet": status["set"], "usedToday": status["usedToday"], "perDay": status["perDay"]}
    except Exception:
        return None


def phone_part(state: dict) -> dict:
    """The phone link without notification text: is the BLE link up, what it
    subscribed to, the last error, and the song with when it last changed."""
    out = {k: state.get(k) for k in ("available", "connected", "deviceName", "lastSeen", "error") if k in state}
    link = state.get("link") or {}
    if link:
        out["ble"] = link.get("ble")
        out["nowPlaying"] = link.get("nowPlaying")
        out["subscribed"] = link.get("subscribed")
        out["lastError"] = link.get("lastError")
    media = state.get("media") or {}
    if media:
        out["song"] = {k: media.get(k) for k in ("title", "artist", "app", "playing")}
        out["songUpdatedAt"] = state.get("mediaAt")
    return out


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
    depth_face: Optional[Callable[[], dict]] = None,
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
        "phone": phone_part(phone_state),
        "clock": clock_part(clock_state),
    }
    if depth_face:
        data["depthFace"] = safe(depth_face)
    data["problems"] = problems(data)
    return data


def clock_part(state: dict) -> dict:
    """The desk clock: connected or not, its firmware, and how steady its
    link has been (desk/link.py's health, with the last few events)."""
    out = {k: state.get(k) for k in ("enabled", "connected", "firmware", "connectedAt", "error") if k in state}
    link = state.get("link")
    if isinstance(link, dict):
        out["link"] = {**link, "history": (link.get("history") or [])[:5]}
    wifi = state.get("wifi")
    if isinstance(wifi, dict) and wifi.get("rssi") is not None:
        out["rssi"] = wifi["rssi"]
    updates = (state.get("state") or {}).get("updates")
    if isinstance(updates, dict):
        # Firmware updates over Wi-Fi (desk/ota.py): the newest GitHub build and how the last install went.
        out["updates"] = {k: updates.get(k) for k in ("latest", "latestSha", "ready", "newer", "canUpdate", "state",
                                                      "target", "error", "waiting", "checkError")}
    return out


# A clock that's been quiet this long while "connected" has likely gone.
CLOCK_QUIET_SECONDS = 75


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
    phone = data["phone"]
    if phone.get("connected") and phone.get("ble") is False:
        out.append(f"The phone ({phone.get('deviceName') or 'unnamed'}) is connected but its BLE link to the Pi is not, "
                   "so now playing and notifications can't be read.")
    elif phone.get("connected") and phone.get("ble") and phone.get("nowPlaying") not in (None, "asked"):
        out.append(f"Now playing from the phone isn't subscribed ({phone.get('nowPlaying')}).")
    clock = data["clock"]
    link = clock.get("link") or {}
    if clock.get("enabled") and not clock.get("connected"):
        last = (link.get("lastDrop") or {}).get("detail")
        out.append("The desk clock is on in settings but not connected" + (f" (last drop: {last})." if last else "."))
    elif clock.get("connected"):
        if link.get("state") == "flaky":
            last = (link.get("lastDrop") or {}).get("detail") or "no reason kept"
            out.append(f"The desk clock's link dropped {link.get('drops24h')} times in the last day (last: {last}).")
        if (link.get("quietSeconds") or 0) > CLOCK_QUIET_SECONDS:
            out.append(f"The desk clock hasn't been heard from for {link['quietSeconds']} s although it counts as connected.")
        updates = clock.get("updates") or {}
        if updates.get("state") == "failed":
            out.append(f"The desk clock's update to {updates.get('target')} failed: {updates.get('error')}.")
        if updates.get("checkError"):
            out.append(f"Checking for LUMO firmware: {updates['checkError']}.")
        if isinstance(clock.get("rssi"), (int, float)) and clock["rssi"] < -78:
            out.append(f"The desk clock's Wi-Fi signal is weak ({clock['rssi']} dBm), which can drop the link.")
    face = data.get("depthFace", {})
    if face.get("hasPhoto") and not face.get("cutout"):
        out.append(f"The depth face's photo has no cutout: {face.get('cutoutError') or face.get('cutoutProblem') or 'no reason kept'}.")
    return out
