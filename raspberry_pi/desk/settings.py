"""
settings.py - the desk clock's settings, changed from Sage.

Which screens UP and DOWN step through, what every button does on each screen,
the alarm's snooze and ring length, the lights, and how the clock shows the
time. They live in Sage's metadata table (key `deskSettings`) next to the
notification preferences, and reach the clock the moment they are saved.

A button map is a set of layers. While an alarm rings the `alarm` layer
decides; otherwise a layer named after the current screen (SPOTIFY, say) wins
over `default`. A card with actions (a reminder) still owns LEFT, OK and RIGHT
while it is up, and `locked` ignores the clock's own buttons (never a ringing
alarm's, and never presses sent from Sage).
"""

import copy
import json
from typing import Any, Dict

import notifier

KEY = "deskSettings"
BUTTONS = ("UP", "DOWN", "LEFT", "OK", "RIGHT")
# The screens firmware 1.6 can draw that make sense to step through.
SCREENS = ("FACE", "CLOCK", "TASKS", "SPOTIFY", "SYSTEM")
LAYERS = ("default", "alarm") + SCREENS
ACTIONS = (
    "none",
    "next_screen", "prev_screen",
    "media_previous", "media_toggle", "media_next",
    "snooze_alarm", "stop_alarm",
    "lights_toggle",
) + tuple(f"screen:{s}" for s in SCREENS)
CLOCK_STYLES = ("digital", "minimal", "analog")
LIGHT_MODES = ("AUTO", "WARM", "BREATHE", "AURORA", "OFF")

DEFAULTS: Dict[str, Any] = {
    "screens": list(SCREENS),
    "homeScreen": "FACE",
    "clock": {"style": "digital", "hour24": True, "seconds": True, "secondZone": ""},
    "alarm": {"snoozeMinutes": 5, "ringMinutes": 10},
    "lights": {"mode": "AUTO", "brightness": 40},
    "buttons": {
        "locked": False,
        "map": {
            "default": {"UP": "prev_screen", "DOWN": "next_screen", "LEFT": "none", "OK": "none", "RIGHT": "none"},
            "SPOTIFY": {"LEFT": "media_previous", "OK": "media_toggle", "RIGHT": "media_next"},
            "alarm": {"UP": "stop_alarm", "DOWN": "stop_alarm", "LEFT": "stop_alarm", "OK": "stop_alarm", "RIGHT": "snooze_alarm"},
        },
    },
}


def defaults() -> dict:
    return copy.deepcopy(DEFAULTS)


def _int(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be a whole number from {low} to {high}.")
    return value


def _bool(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be true or false.")
    return value


def _choice(value: Any, name: str, allowed) -> str:
    if value not in allowed:
        raise ValueError(f"{name} must be one of: {', '.join(allowed)}.")
    return value


def _section(update: Any, name: str) -> dict:
    if not isinstance(update, dict):
        raise ValueError(f"{name} must be an object.")
    return update


def _zone(value: Any) -> str:
    if value in ("", None):
        return ""
    from zoneinfo import ZoneInfo
    try:
        ZoneInfo(str(value))
    except Exception:
        raise ValueError(f"clock.secondZone {value!r} is not a time zone (try Europe/London).")
    return str(value)


def merge(current: dict, update: dict) -> dict:
    """`current` with the fields in `update` applied and checked. Fields not
    named in `update` keep their value; a button layer replaces only the
    buttons it names, and a layer set to null goes back to having none."""
    out = copy.deepcopy(current)
    update = _section(update, "settings")
    unknown = set(update) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"Unknown setting: {', '.join(sorted(unknown))}.")

    if "screens" in update:
        screens = update["screens"]
        if not isinstance(screens, list) or not screens:
            raise ValueError("screens must be a list with at least one screen.")
        for s in screens:
            _choice(s, "screens", SCREENS)
        if len(set(screens)) != len(screens):
            raise ValueError("screens lists a screen twice.")
        out["screens"] = list(screens)
    if "homeScreen" in update:
        out["homeScreen"] = _choice(update["homeScreen"], "homeScreen", SCREENS)
    if out["homeScreen"] not in out["screens"]:
        out["homeScreen"] = out["screens"][0]

    if "clock" in update:
        clock = _section(update["clock"], "clock")
        if "style" in clock:
            out["clock"]["style"] = _choice(clock["style"], "clock.style", CLOCK_STYLES)
        if "hour24" in clock:
            out["clock"]["hour24"] = _bool(clock["hour24"], "clock.hour24")
        if "seconds" in clock:
            out["clock"]["seconds"] = _bool(clock["seconds"], "clock.seconds")
        if "secondZone" in clock:
            out["clock"]["secondZone"] = _zone(clock["secondZone"])

    if "alarm" in update:
        alarm = _section(update["alarm"], "alarm")
        if "snoozeMinutes" in alarm:
            out["alarm"]["snoozeMinutes"] = _int(alarm["snoozeMinutes"], "alarm.snoozeMinutes", 1, 60)
        if "ringMinutes" in alarm:
            out["alarm"]["ringMinutes"] = _int(alarm["ringMinutes"], "alarm.ringMinutes", 1, 60)

    if "lights" in update:
        lights = _section(update["lights"], "lights")
        if "mode" in lights:
            out["lights"]["mode"] = _choice(lights["mode"], "lights.mode", LIGHT_MODES)
        if "brightness" in lights:
            out["lights"]["brightness"] = _int(lights["brightness"], "lights.brightness", 0, 255)

    if "buttons" in update:
        buttons = _section(update["buttons"], "buttons")
        if "locked" in buttons:
            out["buttons"]["locked"] = _bool(buttons["locked"], "buttons.locked")
        if "map" in buttons:
            for layer, keys in _section(buttons["map"], "buttons.map").items():
                _choice(layer, "buttons.map layer", LAYERS)
                if keys is None:
                    if layer == "default":
                        raise ValueError("The default button layer can't be removed.")
                    out["buttons"]["map"].pop(layer, None)
                    continue
                target = out["buttons"]["map"].setdefault(layer, {})
                for button, action in _section(keys, f"buttons.map.{layer}").items():
                    _choice(button, f"buttons.map.{layer} button", BUTTONS)
                    target[button] = _choice(action, f"buttons.map.{layer}.{button}", ACTIONS)
    return out


def action_for(current: dict, button: str, screen: str, ringing: bool) -> str:
    """What `button` does right now, by the layers in the module docstring."""
    layers = current["buttons"]["map"]
    if ringing:
        return layers.get("alarm", {}).get(button, "stop_alarm")
    for name in (screen, "default"):
        action = layers.get(name, {}).get(button)
        if action:
            return action
    return "none"


# --- Storage ---

def load() -> dict:
    notifier.init_tables()
    conn = notifier._connect()
    try:
        row = conn.execute("SELECT value FROM metadata WHERE key = ?", (KEY,)).fetchone()
    finally:
        conn.close()
    try:
        saved = json.loads(row[0]) if row else {}
        return merge(defaults(), saved)
    except ValueError:
        return defaults()  # a hand-edited row that no longer checks out


def save(update: dict) -> dict:
    """Apply `update` to the saved settings and store the result."""
    result = merge(load(), update)
    notifier.init_tables()
    conn = notifier._connect()
    try:
        conn.execute(
            "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (KEY, json.dumps(result)),
        )
        conn.commit()
    finally:
        conn.close()
    return result


def reset() -> dict:
    notifier.init_tables()
    conn = notifier._connect()
    try:
        conn.execute("DELETE FROM metadata WHERE key = ?", (KEY,))
        conn.commit()
    finally:
        conn.close()
    return defaults()
