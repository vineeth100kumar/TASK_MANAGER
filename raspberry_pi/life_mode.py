"""
life_mode.py - Work mode and Chill mode.

Work mode shows everything. Chill mode shows only personal items; work items
stay saved and one tap away, they are just out of sight, and their reminders
wait until you are back in Work mode.

The mode follows the phone link (phone_link.py) when Auto is on: the phone at
home means Chill, away means Work. Choosing a mode by hand lasts until the
next time you arrive or leave, then Auto takes over again. With Auto off, the
mode you pick stays until you pick the other one.

Without a phone link (no Bluetooth, or the phone hasn't been seen since the
Pi started) Auto stays on Work, so nothing is hidden because of a guess.

Settings live in the metadata table under "lifeMode". Reminders held back in
Chill live under "lifeModeHeld" and go out as one push when Work mode returns.
"""

import asyncio
import json
import os
import sqlite3
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
MODES = ("work", "chill")
HELD_KEEP = 50

DEFAULTS: Dict[str, Any] = {
    "auto": True,          # follow home/away
    "mode": "work",        # the mode when Auto is off
    "override": None,      # {"mode": ..., "home": bool}: a hand-picked mode until home/away changes
    "urgentThrough": False,  # in Chill, still send reminders for urgent or overdue work
}

# Set by db_server: returns (known, home). known is False when there is no
# phone link or the phone hasn't been seen since the Pi started.
presence: Callable[[], Tuple[bool, bool]] = lambda: (False, False)


# --- Storage ---

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
    return conn


def _read(key: str, default: Any) -> Any:
    conn = _connect()
    try:
        row = conn.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
    finally:
        conn.close()
    if not row:
        return default
    try:
        return json.loads(row[0])
    except ValueError:
        return default


def _write(key: str, value: Any) -> None:
    conn = _connect()
    try:
        conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", (key, json.dumps(value)))
        conn.commit()
    finally:
        conn.close()


def get_settings() -> dict:
    saved = _read("lifeMode", {})
    out = dict(DEFAULTS)
    if isinstance(saved, dict):
        out.update({k: v for k, v in saved.items() if k in DEFAULTS})
    if out["mode"] not in MODES:
        out["mode"] = "work"
    ov = out.get("override")
    if not (isinstance(ov, dict) and ov.get("mode") in MODES):
        out["override"] = None
    return out


def _save_settings(settings: dict) -> None:
    _write("lifeMode", {k: settings.get(k, v) for k, v in DEFAULTS.items()})


# --- Deciding the mode ---

def resolve(settings: dict, known: bool, home: bool) -> Tuple[dict, dict]:
    """The mode right now, and the settings to keep (a hand-picked mode is
    dropped once you arrive or leave). Pure, so it is easy to test."""
    settings = dict(settings)
    at_home = bool(known and home)
    if not settings["auto"]:
        mode, source = settings["mode"], "manual"
    else:
        ov = settings.get("override")
        if ov and bool(ov.get("home")) == at_home:
            mode, source = ov["mode"], "override"
        else:
            settings["override"] = None
            mode = "chill" if at_home else "work"
            source = "presence" if known else "no-phone"
    state = {
        "mode": mode,
        "source": source,
        "auto": settings["auto"],
        "known": bool(known),
        "home": at_home,
        "urgentThrough": settings["urgentThrough"],
    }
    return state, settings


def choose(settings: dict, mode: str, known: bool, home: bool) -> dict:
    """Settings after picking a mode by hand."""
    if mode not in MODES:
        raise ValueError("mode must be work or chill")
    settings = dict(settings)
    if settings["auto"]:
        at_home = bool(known and home)
        auto_mode = "chill" if at_home else "work"
        # Picking what Auto would pick anyway just clears the override.
        settings["override"] = None if mode == auto_mode else {"mode": mode, "home": at_home}
    else:
        settings["mode"] = mode
    return settings


def current() -> dict:
    known, home = presence()
    settings = get_settings()
    state, kept = resolve(settings, known, home)
    if kept != settings:
        _save_settings(kept)
    return state


def set_mode(mode: str) -> dict:
    known, home = presence()
    _save_settings(choose(get_settings(), mode, known, home))
    return current()


def update_settings(update: dict) -> dict:
    settings = get_settings()
    if "auto" in update:
        auto = bool(update["auto"])
        if auto != settings["auto"]:
            # Turning Auto off keeps whatever mode is showing now.
            if not auto:
                settings["mode"] = current()["mode"]
            settings["auto"] = auto
            settings["override"] = None
    if "urgentThrough" in update:
        settings["urgentThrough"] = bool(update["urgentThrough"])
    if "mode" in update:
        known, home = presence()
        settings = choose(settings, update["mode"], known, home)
    _save_settings(settings)
    return current()


# --- Which items Chill hides ---

def is_personal(item: dict) -> bool:
    # Same rule as the web app (src/utils/taskLists.ts contextOf).
    return str(item.get("lifeContext") or "").lower() in ("personal", "life")


def is_alarm(item: dict) -> bool:
    return "alarm" in (item.get("labels") or [])


def hidden_in_chill(item: dict) -> bool:
    """Work items are out of sight in Chill. LUMO alarms always ring."""
    return not is_personal(item) and not is_alarm(item)


def lets_through(item: dict, today: str) -> bool:
    """With urgentThrough on: urgent or overdue work still reminds in Chill."""
    due = (item.get("dueDate") or "")[:10]
    return item.get("priority") == "urgent" or bool(due and due < today)


# --- Reminders held back in Chill ---

def held() -> List[dict]:
    value = _read("lifeModeHeld", [])
    return value if isinstance(value, list) else []


def hold(item: dict) -> None:
    entries = [h for h in held() if h.get("id") != item.get("id")]
    entries.append({"id": item.get("id"), "title": item.get("title") or "Untitled", "heldAt": int(time.time())})
    _write("lifeModeHeld", entries[-HELD_KEEP:])


def clear_held() -> None:
    _write("lifeModeHeld", [])


# --- Live updates ---

Broadcast = Callable[[dict], Awaitable[None]]


async def run(broadcast: Broadcast, every: float = 3.0) -> None:
    """Tells the web app whenever the mode changes (arriving, leaving, or a
    pick on another device)."""
    last: Optional[dict] = None
    while True:
        try:
            state = await asyncio.to_thread(current)
            if state != last:
                last = state
                await broadcast({"type": "LIFE_MODE", **state})
        except Exception as e:
            print(f"Life mode check failed: {e}")
        await asyncio.sleep(every)
