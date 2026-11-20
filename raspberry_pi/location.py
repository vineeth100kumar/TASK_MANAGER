"""
location.py - Where are you? Home, Work, or out, from iPhone Shortcuts.

A web app can't read location in the background on iOS, so the phone tells
Sage instead: an iPhone Shortcuts "When I arrive / leave <place>" automation
calls POST /api/presence/location with the place name and arrive or leave.
iOS uses geofencing for that (cell towers and Wi-Fi it already sees), so the
battery cost is close to nothing. One tiny message per crossing.

Places are just names. The phone owns the map circle; Sage owns the name, so
an unknown name on "arrive" is added as a new place. Home and Work are
created first.

A task is tied to a place with a label that starts with @, like "@Home" or
"@Grocery". When you arrive there, Sage sends one push per task per day.

This does not change Work/Chill; Bluetooth still drives that (life_mode.py).
Location only says where you are and nudges.

State lives in the metadata table: "places" (the list) and "whereNow".
"""

import json
import os
import re
import sqlite3
import time
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
KINDS = ("home", "work", "other")
ACTIONS = ("arrive", "leave")
MAX_PLACES = 30
NUDGE_MAX = 5          # most tasks named in one push
OUT = "Out"


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


# --- Pure helpers ---

def clean_name(name: Any) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip()[:40]


def same(a: str, b: str) -> bool:
    return clean_name(a).casefold() == clean_name(b).casefold()


def default_places() -> List[dict]:
    return [{"name": "Home", "kind": "home"}, {"name": "Work", "kind": "work"}]


def find(places: List[dict], name: str) -> Optional[dict]:
    return next((p for p in places if same(p["name"], name)), None)


def apply_event(places: List[dict], here: Optional[dict], name: str, action: str, now: float):
    """(places, here, changed) after one arrive or leave. here is
    {"place", "since"} or None for out. A leave from a place you aren't at
    (a late message, a second phone) changes nothing."""
    name = clean_name(name)
    if not name:
        raise ValueError("place is required")
    if action not in ACTIONS:
        raise ValueError("action must be arrive or leave")
    places = [dict(p) for p in places]
    known = find(places, name)
    if action == "arrive":
        if not known:
            if len(places) >= MAX_PLACES:
                raise ValueError(f"at most {MAX_PLACES} places")
            known = {"name": name, "kind": "other"}
            places.append(known)
        if here and same(here.get("place", ""), known["name"]):
            return places, here, False
        return places, {"place": known["name"], "since": int(now)}, True
    if here and same(here.get("place", ""), name):
        return places, None, True
    return places, here, False


def wants(item: dict, place: str) -> bool:
    """The task is tied to this place: a label like @Grocery."""
    want = clean_name(place).casefold()
    for label in item.get("labels") or []:
        label = str(label).strip()
        if label.startswith("@") and clean_name(label[1:]).casefold() == want:
            return True
    return False


# --- Storage ---

def get_places() -> List[dict]:
    saved = _read("places", None)
    if isinstance(saved, list) and saved:
        return [p for p in saved if isinstance(p, dict) and clean_name(p.get("name"))]
    return default_places()


def get_here() -> Optional[dict]:
    value = _read("whereNow", None)
    return value if isinstance(value, dict) and value.get("place") else None


def state(now: Optional[float] = None) -> dict:
    here = get_here()
    places = get_places()
    place = find(places, here["place"]) if here else None
    return {
        "places": places,
        "here": here,
        "label": here["place"] if here else OUT,
        "kind": place["kind"] if place else None,
    }


def record(name: str, action: str, now: Optional[float] = None) -> dict:
    """Saves one arrive or leave; returns state plus "changed"."""
    now = time.time() if now is None else now
    places, here, changed = apply_event(get_places(), get_here(), name, action, now)
    _write("places", places)
    _write("whereNow", here)
    return {**state(now), "changed": changed}


def remove_place(name: str) -> dict:
    places = [p for p in get_places() if not same(p["name"], name)]
    here = get_here()
    _write("places", places or default_places())
    if here and same(here["place"], name):
        _write("whereNow", None)
    return state()


def set_kind(name: str, kind: str) -> dict:
    if kind not in KINDS:
        raise ValueError("kind must be home, work or other")
    places = get_places()
    found = find(places, name)
    if not found:
        raise ValueError("no such place")
    found["kind"] = kind
    _write("places", places)
    return state()


# --- Nudges: "you're here, might as well..." ---

def nudge_message(place: str, items: List[dict], title_of=lambda i: i.get("title") or "Untitled") -> dict:
    titles = [title_of(i) for i in items[:NUDGE_MAX]]
    more = len(items) - len(titles)
    body = ", ".join(titles) + (f" and {more} more" if more > 0 else "")
    return {
        "title": f"You're at {place}. Might as well do this",
        "body": body,
        "tag": f"place-{clean_name(place).casefold()}",
        "url": "/?view=dashboard",
        "ttl": 2 * 3600,
    }
