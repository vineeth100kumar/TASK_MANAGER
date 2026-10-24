"""
settings.py - the desk clock's settings, changed from Sage.

Which screens UP and DOWN step through, what every button does on each screen,
the alarm's snooze and ring length, the lights, how strong the haptics are,
what the case window shows and the Even Frame,
how the clock shows the time, the welcome back message and firmware updates. They live in Sage's metadata table (key `deskSettings`) next to the
notification preferences, and reach the clock the moment they are saved.

A button map is a set of layers. While an alarm rings the `alarm` layer
decides; otherwise a layer named after the current screen (SPOTIFY, say) wins
over `default`. A card with actions (a reminder) still owns LEFT, OK and RIGHT
while it is up, and `locked` ignores the clock's own buttons (never a ringing
alarm's, and never presses sent from Sage).
"""

import copy
import json
import re
from typing import Any, Dict

import notifier
from desk.alarms import TONES

KEY = "deskSettings"
# HOLD_OK is OK held for about a second (firmware 2.0 and later).
BUTTONS = ("UP", "DOWN", "LEFT", "OK", "RIGHT", "HOLD_OK")
# The screens UP and DOWN can step through. (Firmware 1.6 also has a face,
# kept only as the place it draws cards; see controller.py.) The timer,
# stopwatch and world clock screens need firmware 2.8.
SCREENS = ("CLOCK", "TASKS", "SPOTIFY", "SYSTEM", "TIMER", "STOPWATCH", "WORLD")
LAYERS = ("default", "alarm") + SCREENS
ACTIONS = (
    "none",
    "next_screen", "prev_screen",
    "media_previous", "media_toggle", "media_next",
    "snooze_alarm", "stop_alarm",
    "lights_toggle",
    "timer_toggle", "timer_cancel", "timer_add_minute",
    "stopwatch_toggle", "stopwatch_lap", "stopwatch_reset",
) + tuple(f"screen:{s}" for s in SCREENS)
# The first three are LUMO's classic styles; the rest are the smooth faces
# added in firmware 2.1, and the depth face (a photo, see depth.py) in 2.9.
# An older clock keeps its style if sent one it doesn't know.
CLOCK_STYLES = ("digital", "minimal", "analog", "monolith", "stacked", "nightstand", "dial", "depth")
# PHOTO: the main colour of the depth photo (see depth.ring_hue); LUMO gets it
# as COLOR with a hue, so any firmware with COLOR mode shows it.
LIGHT_MODES = ("AUTO", "WARM", "BREATHE", "AURORA", "PHOTO", "OFF")
# The buzzer's alarm patterns (firmware 2.8; older firmware always pulses).
ALARM_TONES = TONES   # desk/alarms.py
MAX_WORLD_CLOCKS = 3
# The welcome message is a card's title, which shows about this many letters.
WELCOME_LEN = 27

DEFAULTS: Dict[str, Any] = {
    # The timer, stopwatch and world screens are added from the LUMO page, as
    # older firmware can't show them.
    "screens": ["CLOCK", "TASKS", "SPOTIFY", "SYSTEM"],
    "homeScreen": "CLOCK",
    "clock": {"style": "digital", "hour24": True, "seconds": True, "secondZone": ""},
    "alarm": {"snoozeMinutes": 5, "ringMinutes": 10, "tone": "pulse", "volume": 80},
    "lights": {"mode": "AUTO", "brightness": 100},
    # Up to three places for the World screen, as time zone names.
    "world": {"zones": []},
    # Between start and end the ring dims, the clock shows `face` ("" keeps
    # the usual one) and knocks are softer.
    "night": {"enabled": False, "start": "22:30", "end": "07:00", "face": "nightstand",
              "lightsMode": "WARM", "brightness": 12},
    # The silent knocks: how hard the motor knocks, 0-100 (0 = off; firmware
    # 2.7+), and whether to knock on each button press and twice for a
    # notification or reminder (firmware 2.8+). The alarm always rings.
    "haptics": {"strength": 70, "buttons": True, "notifications": True},
    # What the case window shows, as the columns and rows it hides on each
    # side (firmware 2.15+; the Fit test shows them), and the Even Frame: the
    # clock faces on a square card inside a black frame, with an island on its
    # right edge for the alarm, music and timers.
    "screen": {"left": 6, "right": 0, "top": 0, "bottom": 4, "frame": False, "island": True},
    # When the phone comes home after at least `awayMinutes` out, the clock
    # shows `message` with what's on today.
    "welcome": {"enabled": True, "message": "Welcome back to your room", "awayMinutes": 15},
    # Install firmware GitHub built from a merged change as soon as the clock
    # isn't busy (desk/ota.py; firmware 2.13+), only inside `window`
    # ("HH:MM-HH:MM", may cross midnight; "" any time) and not while `hold`
    # names a version (set by installing an older build, or by a USB flash).
    "updates": {"auto": True, "hold": "", "window": "03:00-05:00"},
    "gallery": {"enabled": True, "intervalSeconds": 30, "sources": ["quotes", "memories", "photos"]},
    "buttons": {
        "locked": False,
        "map": {
            "default": {"UP": "prev_screen", "DOWN": "next_screen", "LEFT": "none", "OK": "none", "RIGHT": "none", "HOLD_OK": "none"},
            "SPOTIFY": {"LEFT": "media_previous", "OK": "media_toggle", "RIGHT": "media_next"},
            "TIMER": {"LEFT": "timer_cancel", "OK": "timer_toggle", "RIGHT": "timer_add_minute"},
            "STOPWATCH": {"LEFT": "stopwatch_reset", "OK": "stopwatch_toggle", "RIGHT": "stopwatch_lap"},
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


def _hhmm(value: Any, name: str) -> str:
    text = str(value or "")
    parts = text.split(":")
    if len(parts) != 2 or not all(p.isdigit() for p in parts) or not (0 <= int(parts[0]) <= 23 and 0 <= int(parts[1]) <= 59):
        raise ValueError(f"{name} must look like 22:30.")
    return f"{int(parts[0]):02d}:{int(parts[1]):02d}"


def _zone(value: Any) -> str:
    if value in ("", None):
        return ""
    from zoneinfo import ZoneInfo
    try:
        ZoneInfo(str(value))
    except Exception:
        raise ValueError(f"{value!r} is not a time zone (try Europe/London).")
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
        if "tone" in alarm:
            out["alarm"]["tone"] = _choice(alarm["tone"], "alarm.tone", ALARM_TONES)
        if "volume" in alarm:
            out["alarm"]["volume"] = _int(alarm["volume"], "alarm.volume", 0, 100)

    if "world" in update:
        world = _section(update["world"], "world")
        if "zones" in world:
            zones = world["zones"]
            if not isinstance(zones, list) or len(zones) > MAX_WORLD_CLOCKS:
                raise ValueError(f"world.zones must be a list of up to {MAX_WORLD_CLOCKS} time zones.")
            checked = [_zone(z) for z in zones]
            if "" in checked or len(set(checked)) != len(checked):
                raise ValueError("world.zones has an empty or repeated time zone.")
            out["world"]["zones"] = checked

    if "night" in update:
        night = _section(update["night"], "night")
        if "enabled" in night:
            out["night"]["enabled"] = _bool(night["enabled"], "night.enabled")
        for name in ("start", "end"):
            if name in night:
                out["night"][name] = _hhmm(night[name], f"night.{name}")
        if "face" in night:
            out["night"]["face"] = "" if night["face"] in ("", None) else _choice(night["face"], "night.face", CLOCK_STYLES)
        if "lightsMode" in night:
            out["night"]["lightsMode"] = _choice(night["lightsMode"], "night.lightsMode", LIGHT_MODES)
        if "brightness" in night:
            out["night"]["brightness"] = _int(night["brightness"], "night.brightness", 0, 255)

    if "lights" in update:
        lights = _section(update["lights"], "lights")
        if "mode" in lights:
            out["lights"]["mode"] = _choice(lights["mode"], "lights.mode", LIGHT_MODES)
        if "brightness" in lights:
            out["lights"]["brightness"] = _int(lights["brightness"], "lights.brightness", 0, 255)

    if "haptics" in update:
        haptics = _section(update["haptics"], "haptics")
        if "strength" in haptics:
            out["haptics"]["strength"] = _int(haptics["strength"], "haptics.strength", 0, 100)
        for name in ("buttons", "notifications"):
            if name in haptics:
                out["haptics"][name] = _bool(haptics[name], f"haptics.{name}")

    if "screen" in update:
        screen = _section(update["screen"], "screen")
        for name in ("left", "right", "top", "bottom"):
            if name in screen:
                out["screen"][name] = _int(screen[name], f"screen.{name}", 0, 40)
        for name in ("frame", "island"):
            if name in screen:
                out["screen"][name] = _bool(screen[name], f"screen.{name}")

    if "welcome" in update:
        welcome = _section(update["welcome"], "welcome")
        if "enabled" in welcome:
            out["welcome"]["enabled"] = _bool(welcome["enabled"], "welcome.enabled")
        if "message" in welcome:
            message = welcome["message"]
            if not isinstance(message, str) or not message.strip() or len(message.strip()) > WELCOME_LEN:
                raise ValueError(f"welcome.message must be 1 to {WELCOME_LEN} characters.")
            out["welcome"]["message"] = message.strip()
        if "awayMinutes" in welcome:
            out["welcome"]["awayMinutes"] = _int(welcome["awayMinutes"], "welcome.awayMinutes", 5, 720)

    if "updates" in update:
        updates = _section(update["updates"], "updates")
        if "auto" in updates:
            out["updates"]["auto"] = _bool(updates["auto"], "updates.auto")
        if "hold" in updates:
            hold = updates["hold"] or ""
            if not isinstance(hold, str) or (hold and not re.fullmatch(r"\d+\.\d+\.\d+", hold)):
                raise ValueError("updates.hold must be a firmware version like 2.18.0, or empty.")
            out["updates"]["hold"] = hold
        if "window" in updates:
            window = updates["window"] or ""
            if not isinstance(window, str):
                raise ValueError("updates.window must be HH:MM-HH:MM, or empty for any time.")
            if window:
                parts = window.split("-")
                if len(parts) != 2:
                    raise ValueError("updates.window must be HH:MM-HH:MM, or empty for any time.")
                start, end = _hhmm(parts[0], "updates.window start"), _hhmm(parts[1], "updates.window end")
                if start == end:
                    raise ValueError("updates.window can't start and end at the same time.")
                window = f"{start}-{end}"
            out["updates"]["window"] = window

    if "gallery" in update:
        gallery = _section(update["gallery"], "gallery")
        if "enabled" in gallery:
            out["gallery"]["enabled"] = _bool(gallery["enabled"], "gallery.enabled")
        if "intervalSeconds" in gallery:
            out["gallery"]["intervalSeconds"] = _int(gallery["intervalSeconds"], "gallery.intervalSeconds", 10, 300)
        if "sources" in gallery:
            sources = gallery["sources"]
            valid = ("quotes", "memories", "photos", "notes")
            if not isinstance(sources, list) or not sources:
                raise ValueError("gallery.sources must be a list with at least one source.")
            for s in sources:
                _choice(s, "gallery.sources", valid)
            out["gallery"]["sources"] = list(sources)

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


def in_night(current: dict, hour: int, minute: int) -> bool:
    """Whether hour:minute falls in the night window (which may cross midnight)."""
    night = current["night"]
    if not night["enabled"]:
        return False
    now = hour * 60 + minute
    start = int(night["start"][:2]) * 60 + int(night["start"][3:])
    end = int(night["end"][:2]) * 60 + int(night["end"][3:])
    if start == end:
        return False
    return start <= now < end if start < end else now >= start or now < end


def in_window(window: str, hour: int, minute: int) -> bool:
    """Whether hour:minute falls in an "HH:MM-HH:MM" window (which may cross
    midnight). An empty window is always open."""
    if not window:
        return True
    start, end = window.split("-")
    now = hour * 60 + minute
    a = int(start[:2]) * 60 + int(start[3:])
    b = int(end[:2]) * 60 + int(end[3:])
    return a <= now < b if a < b else now >= a or now < b


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


def _without_face(saved: dict) -> dict:
    """Settings saved before the face was retired, minus the face."""
    saved = copy.deepcopy(saved) if isinstance(saved, dict) else {}
    if isinstance(saved.get("screens"), list):
        saved["screens"] = [s for s in saved["screens"] if s != "FACE"]
        if not saved["screens"]:
            del saved["screens"]
    if saved.get("homeScreen") == "FACE":
        del saved["homeScreen"]
    layers = (saved.get("buttons") or {}).get("map")
    if isinstance(layers, dict):
        layers.pop("FACE", None)
        for keys in layers.values():
            if isinstance(keys, dict):
                for button, action in list(keys.items()):
                    if action == "screen:FACE":
                        keys[button] = "none"
    return saved


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
        # 40 was the old default, saved along with any other change; the
        # light now runs at full brightness unless you choose otherwise.
        if (saved.get("lights") or {}).get("brightness") == 40:
            saved["lights"]["brightness"] = 100
        return merge(defaults(), _without_face(saved))
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
