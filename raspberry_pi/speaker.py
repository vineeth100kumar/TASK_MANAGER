"""
speaker.py - Sage's voice on the soundbar.

The soundbar is wired to a USB sound card on the Pi (the default output); a
Bluetooth soundbar still works if picked as the output in Settings > Bluetooth.
Then:

- Coming home: when the phone link sees you arrive (life_mode.ArrivalWatch,
  15+ minutes away), the Pi connects to the soundbar and greets you, in the
  manner of a devoted old-school English butler (at most once every
  GREET_EVERY_HOURS): the time, the weather, what's left today. Groq writes the line when
  there is a key; a plain template is the fallback, so it never stays silent.
- Reminders: while you're home, a reminder that fires is also spoken.
- Music: the Pi is a Spotify Connect speaker (spotify.py) that plays on the
  soundbar; Sage pauses it for a moment to speak.
- Phone audio (optional, off by default): with pass-through on, the Pi is a
  Bluetooth speaker for the phone (A2DP sink) and plays what it receives on
  the soundbar. It steps aside while Spotify plays. When the
  soundbar isn't connected, or pass-through is off, the Pi drops the phone's
  audio link so the phone's sound doesn't go to a Pi with nothing to play it.
- Quiet hours: nothing is said between quietStart and quietEnd, except the
  "Say hello now" test.
- Leaving: once you've been away leaveAfterMinutes, a soundbar the Pi
  connected is disconnected again, so the TV or another device can have it.

Audio goes to a USB sound card by default (the soundbar is wired to it), or to
a Bluetooth soundbar when that's picked as the output (Settings > Bluetooth >
Output). `aplay -D plughw:CARD=<card>,DEV=0` speaks on the USB card, `aplay -D
bluealsa:DEV=<soundbar>,PROFILE=a2dp` over Bluetooth; `bluealsa-aplay` passes
the phone's stream through. With Surround on, the sound goes through a small
LADSPA plugin (audio/sage_surround.c) on either output: the `sage_surround_usb`
ALSA device on the USB card, or `sage_surround` over bluez-alsa
(deploy/alsa/60-sage-surround.conf). It widens the stereo, adds early
reflections, lifts dialogue and bass, then hands the sound on. If it can't open,
Sage plays without it rather than staying silent. The voice is Kokoro, the same
one Reels use, run in a short-lived low-priority process (speak_worker.py) so
its ~300 MB goes away once a line is spoken.

Settings live in the metadata table under "speaker".
"""

import asyncio
import datetime
import hashlib
import json
import logging
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

log = logging.getLogger("speaker")

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
HERE = Path(__file__).resolve().parent
WORKER = HERE / "speak_worker.py"
SETTINGS_KEY = "speaker"
A2DP_SOURCE = "0000110a-0000-1000-8000-00805f9b34fb"   # the phone's side of "phone plays on the Pi"
DEVICE_IFACE = "org.bluez.Device1"
TRANSPORT_IFACE = "org.bluez.MediaTransport1"
CHECK_EVERY = 4.0
SPEAK_NICE = int(os.getenv("SAGE_SPEAK_NICE", "10"))
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ADDRESS = re.compile(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")

# Kokoro's voices that suit a butler; bm_george is the default (British, male).
VOICES = ["bm_george", "bm_lewis", "bm_daniel", "am_michael", "am_adam", "bf_emma", "bf_isabella", "af_heart", "af_bella"]

DEFAULTS: Dict[str, Any] = {
    "address": "",          # the soundbar; empty means the speaker is off
    "name": "",             # its name, for the UI
    "greet": True,          # say hello when you get home
    "goodbye": True,        # say a short goodbye when you leave
    "briefAfterHours": 2.5, # away at least this long = full task briefing; shorter = a short welcome back
    "reminders": True,      # speak reminders while you're home
    "phoneSpeaker": False,  # (was "passthrough", which defaulted on) be a Bluetooth speaker for the phone (laggier than Spotify; off by default)
    "chimes": True,         # short spoken lines when things happen (soundbar on, back home, Spotify picked)
    "witty": True,          # let Groq write the greeting (falls back to the template)
    "callMe": "",           # how the greeting addresses you ("" = no name, "sir" works)
    "voice": "bm_george",
    "speed": 1.0,
    "volume": 80,           # 10..100, applied to the speech itself
    "quietStart": "22:30",
    "quietEnd": "07:00",
    "leaveAfterMinutes": 20,  # 0 = never disconnect on leaving
    "lastGreetAt": 0,       # when the welcome-home greeting was last spoken (epoch s); not user-set
    "surround": "off",      # off | music | movie | wide (SURROUND below)
    "latency": "low",       # lowest | low | steady (LATENCY below): pass-through buffer
    "output": "auto",       # auto | usb | bluetooth: where the sound goes (auto = USB sound card when one is plugged in)
    "usbCard": "",          # ALSA card id to force ("" = first USB card that can play)
}

# How much the Pi buffers the phone's audio before the soundbar (bluealsa-aplay's
# PCM buffer and period, in microseconds). bluealsa-aplay's own default is
# 500 ms, which is most of the lag you hear; less buffer is less delay but can
# crackle if the Bluetooth link hiccups (Wi-Fi off on Ethernet helps).
LATENCY: Dict[str, Dict[str, int]] = {
    "lowest": {"buffer": 120000, "period": 30000},
    "low": {"buffer": 200000, "period": 50000},
    "steady": {"buffer": 500000, "period": 100000},
}

# Virtual surround presets: the sage_surround plugin's controls.
# width 0..1 widens the side above the bass, space 0..1 adds early reflections,
# dialog and bass are dB boosts (0..9) on the centre, air a 10 kHz shelf (dB),
# punch 0..1 a gentle compressor with make-up gain (fuller and louder).
SURROUND: Dict[str, Dict[str, float]] = {
    "music": {"width": 0.55, "space": 0.3, "dialog": 1, "bass": 4, "air": 3, "punch": 0.5},
    "movie": {"width": 0.7, "space": 0.55, "dialog": 5, "bass": 4, "air": 2, "punch": 0.6},
    "wide": {"width": 1.0, "space": 0.75, "dialog": 2, "bass": 3, "air": 3, "punch": 0.4},
}
SURROUND_PLUGIN = Path(os.getenv("SAGE_SURROUND_PLUGIN", "/usr/local/lib/sage/ladspa/sage_surround.so"))
SURROUND_CONF = Path(os.getenv("SAGE_SURROUND_CONF", "/etc/alsa/conf.d/60-sage-surround.conf"))


# --- Settings ---

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
    return conn


def get_settings() -> dict:
    conn = _connect()
    try:
        row = conn.execute("SELECT value FROM metadata WHERE key = ?", (SETTINGS_KEY,)).fetchone()
    finally:
        conn.close()
    saved: Any = {}
    if row:
        try:
            saved = json.loads(row[0])
        except ValueError:
            saved = {}
    out = dict(DEFAULTS)
    if isinstance(saved, dict):
        out.update({k: v for k, v in saved.items() if k in DEFAULTS})
    return out


def clean_settings(update: dict, current: Optional[dict] = None) -> dict:
    """Merge an update into the settings, refusing values that don't fit. Pure."""
    out = dict(current or DEFAULTS)
    for key in ("greet", "goodbye", "reminders", "phoneSpeaker", "witty", "chimes"):
        if key in update:
            out[key] = bool(update[key])
    if "address" in update:
        address = str(update.get("address") or "").strip().upper()
        if address and not ADDRESS.match(address):
            raise ValueError("That isn't a Bluetooth address.")
        out["address"] = address
        if not address:
            out["name"] = ""
    if "name" in update:
        out["name"] = str(update.get("name") or "")[:60]
    if "callMe" in update:
        out["callMe"] = re.sub(r"[^\w .'-]", "", str(update.get("callMe") or ""))[:30].strip()
    if "voice" in update:
        voice = str(update.get("voice") or "")
        if not re.fullmatch(r"[a-z]{2}_[a-z]+", voice):
            raise ValueError("Pick one of the voices.")
        out["voice"] = voice
    if "speed" in update:
        out["speed"] = round(max(0.7, min(1.4, float(update["speed"]))), 2)
    if "volume" in update:
        out["volume"] = int(max(10, min(100, int(update["volume"]))))
    for key in ("quietStart", "quietEnd"):
        if key in update:
            value = str(update.get(key) or "")
            if not HHMM.match(value):
                raise ValueError("Quiet hours need times like 22:30.")
            out[key] = value
    if "briefAfterHours" in update:
        out["briefAfterHours"] = round(max(0.25, min(24.0, float(update["briefAfterHours"]))), 2)
    if "leaveAfterMinutes" in update:
        out["leaveAfterMinutes"] = int(max(0, min(240, int(update["leaveAfterMinutes"]))))
    if "surround" in update:
        mode = str(update.get("surround") or "off")
        if mode != "off" and mode not in SURROUND:
            raise ValueError("Surround is off, music, movie or wide.")
        out["surround"] = mode
    if "output" in update:
        output = str(update.get("output") or "auto")
        if output not in ("auto", "usb", "bluetooth"):
            raise ValueError("Output is auto, usb or bluetooth.")
        out["output"] = output
    if "usbCard" in update:
        out["usbCard"] = re.sub(r"[^\w.-]", "", str(update.get("usbCard") or ""))[:40]
    if "latency" in update:
        latency = str(update.get("latency") or "")
        if latency not in LATENCY:
            raise ValueError("Delay is lowest, low or steady.")
        out["latency"] = latency
    return out


def _store_greet_time(at: float) -> None:
    settings = get_settings()
    settings["lastGreetAt"] = int(at)
    conn = _connect()
    try:
        conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", (SETTINGS_KEY, json.dumps(settings)))
        conn.commit()
    finally:
        conn.close()


def save_settings(update: dict) -> dict:
    settings = clean_settings(update, get_settings())
    conn = _connect()
    try:
        conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", (SETTINGS_KEY, json.dumps(settings)))
        conn.commit()
    finally:
        conn.close()
    return settings


# --- Pure rules ---

def in_quiet(now: datetime.datetime, start: str, end: str) -> bool:
    """True inside quiet hours. A window like 22:30-07:00 runs over midnight;
    the same start and end means no quiet hours."""
    t = now.strftime("%H:%M")
    if start == end:
        return False
    if start < end:
        return start <= t < end
    return t >= start or t < end


def part_of_day(hour: int) -> str:
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "night"


WEATHER_WORDS = {"sun": "clear skies", "cloud": "cloudy", "rain": "rain about", "storm": "a storm about", "snow": "snow"}


def _clock(now: datetime.datetime) -> str:
    h = now.hour % 12 or 12
    return f"{h}:{now.minute:02d}" if now.minute else f"{h} o'clock"


def _number(n: int) -> str:
    words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
    return words[n] if 0 <= n < len(words) else str(n)


def greeting_facts(now: datetime.datetime, due: List[dict], overdue: List[dict], chill: bool,
                   weather: Optional[dict], habits_left: List[str], call_me: str) -> dict:
    """Everything the greeting may mention, as plain values. Hidden tasks never make it in."""
    def titles(items):
        return [str(i.get("title") or "").strip() for i in items if not i.get("isHidden") and str(i.get("title") or "").strip()]
    return {
        "partOfDay": part_of_day(now.hour),
        "time": _clock(now),
        "weekday": now.strftime("%A"),
        "name": call_me,
        "tempC": round(weather["temp_c"]) if weather and weather.get("temp_c") is not None else None,
        "sky": WEATHER_WORDS.get((weather or {}).get("icon", ""), ""),
        "dueToday": titles(due)[:5],
        "dueCount": len(titles(due)),
        "overdueCount": len(titles(overdue)),
        "habitsLeft": habits_left[:3],
        "chill": chill,
    }


def template_wake(f: dict) -> str:
    """The wake-up briefing without AI. Pure."""
    name = f", {f['name']}" if f.get("name") else ", sir"
    parts = [f"Good morning{name}. It's {f['time']} on {f['weekday']}."]
    if f.get("tempC") is not None:
        parts.append(f"{f['tempC']} degrees outside" + (f", {f['sky']}." if f.get("sky") else "."))
    n = f["dueCount"]
    if n == 0:
        parts.append("Nothing is asked of you today.")
    else:
        shown = f["dueToday"][:3]
        parts.append(f"You have {_number(n)} {'thing' if n == 1 else 'things'} today: " + ", ".join(shown) + ".")
    if f.get("overdueCount"):
        parts.append(f"{_number(f['overdueCount'])} overdue, when you're ready.")
    if f.get("habitsLeft"):
        parts.append(f"And don't forget {f['habitsLeft'][0]}.")
    return " ".join(parts)


def template_greeting(f: dict) -> str:
    """The greeting without AI: short, warm, and always something to say."""
    name = f", {f['name']}" if f.get("name") else ", sir"
    hello = "Welcome home" + name + "." if f["partOfDay"] == "night" else f"Good {f['partOfDay']}{name}. Welcome home."
    parts = [hello]
    weather = ""
    if f.get("tempC") is not None:
        weather = f" and {f['tempC']} degrees" + (f", {f['sky']}" if f.get("sky") else "")
    parts.append(f"It's {f['time']}{weather}.")
    n = f["dueCount"]
    if n == 0:
        parts.append("Nothing else is asked of you today.")
    else:
        first = f["dueToday"][0]
        parts.append(f"You have {_number(n)} {'thing' if n == 1 else 'things'} left today" + (f", starting with {first}." if n > 1 else f": {first}."))
    if f.get("overdueCount"):
        parts.append(f"And {_number(f['overdueCount'])} overdue, when you're ready.")
    if f.get("habitsLeft"):
        parts.append(f"Don't forget {f['habitsLeft'][0]}.")
    if f.get("chill"):
        parts.append("Work is put away for the evening." if f["partOfDay"] in ("evening", "night") else "Work is put away for now.")
    return " ".join(parts)


GREETING_PROMPT = """You are the voice of Sage, speaking as a devoted, old-school \
English butler in the manner of Alfred Pennyworth: unflappable, warm underneath, \
impeccably polite, with a dry, gently teasing wit and a quiet concern for the \
person's wellbeing (rest, food, not overworking). Write the one greeting spoken \
aloud on the soundbar as the person walks in the door.

Rules: at most 45 words. Plain spoken English only: no emojis, lists, quotes, \
markdown or stage directions. Use only the facts given; never invent tasks, \
weather or numbers. Mention the time, then the weather if given, then what is \
left today (name at most two items). One dry, affectionate aside at most, the \
kind a butler permits himself. Never mention Batman, Gotham or any film. \
Address them by the name given (as a butler would, e.g. "Master Vineeth" or \
"sir"), or as "sir" if there is none.

Facts (JSON):
"""


WAKE_PROMPT = GREETING_PROMPT.replace(
    "Write the one greeting spoken aloud on the soundbar as the person walks in the door.",
    "Write the good-morning briefing spoken aloud on the soundbar just after the person switched off their wake-up alarm.",
).replace("at most 45 words", "at most 70 words").replace(
    "(name at most two items)", "(name at most three items, and the overdue count if any)")

GREET_EVERY_HOURS = float(os.getenv("SAGE_GREET_EVERY_HOURS", "6"))


# Short, quiet lines for things that happen around the house. One is picked at
# random so it doesn't sound canned; each kind waits its cooldown before it is
# said again, and a line that can't be said within EVENT_STALE_S is dropped.
EVENT_LINES: Dict[str, List[str]] = {
    "soundbar": ["Sound's on.", "Speaker's ready.", "Connected.", "All set."],
    "home": ["Welcome back{name}.", "Good to have you back{name}.", "Welcome back."],
    "spotify": ["Spotify's here.", "Playing here.", "Over to Spotify."],
}
EVENT_COOLDOWN_S: Dict[str, float] = {"soundbar": 600, "home": 1800, "spotify": 900}
EVENT_STALE_S = 20.0


def event_line(kind: str, call_me: str = "", pick: Callable[[List[str]], str] = random.choice) -> str:
    """The line for an event, or "" for an unknown one. Pure apart from `pick`."""
    lines = EVENT_LINES.get(kind)
    if not lines:
        return ""
    return pick(lines).replace("{name}", f", {call_me}" if call_me else "")


def event_due(kind: str, last: Dict[str, float], now: float) -> bool:
    """Has this kind of line waited out its cooldown? Pure."""
    return now - last.get(kind, 0.0) >= EVENT_COOLDOWN_S.get(kind, 600)


def greet_due(last_at: float, now: float, hours: float = GREET_EVERY_HOURS) -> bool:
    """One welcome-home greeting per `hours`. Pure."""
    return not last_at or now - last_at >= hours * 3600


DAILY_LINES: Dict[str, List[str]] = {
    "welcome": ["Welcome back{name}.", "Good to have you back{name}.", "Welcome back. All is in order."],
    "goodbye": ["Goodbye{name}.", "Off you go{name}. I'll mind the house.", "See you soon{name}.", "Take care out there{name}."],
}


def brief_due(away_s: float, last_at: float, now: float, hours: float) -> bool:
    """Full task briefing only after a long absence (`away_s` known), else
    fall back to `hours` since the last briefing. Pure."""
    if away_s > 0:
        return away_s >= hours * 3600
    return not last_at or now - last_at >= hours * 3600


def daily_line(kind: str, day: str, call_me: str = "") -> str:
    """Today's welcome-back or goodbye line: one pick per day, stable all day. Pure."""
    lines = DAILY_LINES.get(kind) or []
    if not lines:
        return ""
    pick = lines[int(hashlib.sha1(f"{kind}{day}".encode()).hexdigest(), 16) % len(lines)]
    return pick.replace("{name}", f", {call_me}" if call_me else "")


def speech_cache_dir() -> Path:
    return Path(os.getenv("SAGE_SPEECH_CACHE") or (Path(DB_PATH).resolve().parent / "speech-cache"))


def speech_cache_path(kind: str, day: str, text: str, settings: dict) -> Path:
    """Where today's line is kept; the name changes with the words or the voice, so a changed setting re-renders. Pure."""
    key = hashlib.sha1(f"{text}|{settings['voice']}|{settings['speed']}|{settings['volume']}|chime2".encode()).hexdigest()[:10]
    return speech_cache_dir() / f"{day}-{kind}-{key}.wav"


def cache_ok(path: Path) -> bool:
    """A cached wav is usable when it exists, has a RIFF header and some audio."""
    try:
        if path.stat().st_size < 4000:
            return False
        with open(path, "rb") as f:
            return f.read(4) == b"RIFF"
    except OSError:
        return False


def clean_line(text: str, limit: int = 420) -> str:
    """An AI answer made safe to speak: one paragraph, no markup, no quotes around it."""
    t = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    t = re.sub(r"[*_#`>\[\]]", "", t)
    t = re.sub(r"\s+", " ", t).strip().strip('"“”\' ')
    if len(t) > limit:
        cut = t[:limit]
        t = cut[:cut.rfind(".") + 1] if "." in cut else cut
    return t


def reminder_line(message: dict) -> str:
    title = str(message.get("title") or "").strip()
    body = str(message.get("body") or "").strip()
    line = f"Pardon the interruption. A reminder: {title}."
    if body and body.lower() not in ("reminder", title.lower()) and len(body) < 120:
        line += f" {body.rstrip('.')}."
    return line


def audio_links(objects: dict, soundbar: str, phone: str) -> dict:
    """Which audio links are up, from BlueZ's GetManagedObjects. Pure.
    A MediaTransport1 under a device's path is an A2DP stream with it."""
    paths: Dict[str, dict] = {}
    for path, ifaces in objects.items():
        dev = ifaces.get(DEVICE_IFACE)
        if dev and "Address" in dev:
            addr = str(_val(dev.get("Address"))).upper()
            paths[addr] = {"path": path, "connected": bool(_val(dev.get("Connected"))), "paired": bool(_val(dev.get("Paired"))),
                           "name": _val(dev.get("Alias")) or _val(dev.get("Name")) or addr}
    transports = [p for p, ifaces in objects.items() if TRANSPORT_IFACE in ifaces]

    def streaming(addr: str) -> bool:
        d = paths.get((addr or "").upper())
        return bool(d) and any(t.startswith(d["path"] + "/") for t in transports)

    sb = paths.get((soundbar or "").upper())
    return {
        "soundbar": {
            "known": bool(sb), "paired": bool(sb and sb["paired"]), "connected": bool(sb and sb["connected"]),
            "audio": streaming(soundbar), "name": sb["name"] if sb else "",
        },
        "phoneAudio": bool(phone) and streaming(phone),
    }


def _val(v: Any) -> Any:
    return getattr(v, "value", v)


def _surround_args(preset: dict) -> str:
    return (f"WIDTH={preset['width']:g},SPACE={preset['space']:g},"
            f"DIALOG={preset['dialog']:g},BASS={preset['bass']:g},AIR={preset['air']:g},PUNCH={preset['punch']:g}")


def output_device(address: str, surround: str, ready: bool) -> str:
    """The ALSA device for a Bluetooth soundbar, through surround when it's on
    and installed. Pure."""
    preset = SURROUND.get(surround) if ready else None
    if not preset:
        return f"bluealsa:DEV={address},PROFILE=a2dp"
    return f"sage_surround:DEV={address},{_surround_args(preset)}"


def usb_output_device(card_id: str, surround: str, ready: bool) -> str:
    """The ALSA device for a USB sound card, through surround when it's on and
    installed (sage_surround_usb, from 60-sage-surround.conf). Pure."""
    preset = SURROUND.get(surround) if ready else None
    if not preset:
        return f"plughw:CARD={card_id},DEV=0"
    return f"sage_surround_usb:CARD={card_id},{_surround_args(preset)}"


def passthrough_cmd(device: str, phone: str, latency: str) -> List[str]:
    """bluealsa-aplay with the chosen buffer. Pure."""
    lat = LATENCY.get(latency, LATENCY["low"])
    return ["bluealsa-aplay", "--profile-a2dp", f"--pcm-buffer-time={lat['buffer']}",
            f"--pcm-period-time={lat['period']}", "-D", device, phone]


def parse_cards(text: str, playback: Callable[[str], bool]) -> List[dict]:
    """Sound cards from /proc/asound/cards. A card line looks like
    ` 1 [Device         ]: USB-Audio - USB Audio Device`. Pure."""
    cards = []
    for m in re.finditer(r"^\s*(\d+)\s+\[(\S+)\s*\]:\s*(\S+)\s+-\s+(.+)$", text, re.M):
        num, cid, driver, name = m.groups()
        cards.append({"num": int(num), "id": cid, "usb": driver.lower().startswith("usb"),
                      "name": name.strip(), "playback": playback(num)})
    return cards


def usb_cards() -> List[dict]:
    try:
        text = Path("/proc/asound/cards").read_text()
    except OSError:
        return []
    return parse_cards(text, lambda n: Path(f"/proc/asound/card{n}/pcm0p").exists())


def usb_card(preferred: str = "") -> Optional[dict]:
    """The USB sound card to play on: the one asked for, else the first that can play."""
    cards = [c for c in usb_cards() if c["usb"] and c["playback"]]
    for c in cards:
        if preferred and c["id"] == preferred:
            return c
    return cards[0] if cards else None


def uses_usb(settings: dict) -> bool:
    """True when sound goes to a USB card: asked for, or auto with one plugged in."""
    if settings.get("output") == "bluetooth":
        return False
    return usb_card(settings.get("usbCard", "")) is not None


def has_output(settings: dict) -> bool:
    """Somewhere to play: a USB card, or a picked Bluetooth soundbar."""
    return bool(settings.get("address")) or uses_usb(settings)


def usb_device(settings: dict) -> str:
    card = usb_card(settings.get("usbCard", ""))
    return f"plughw:CARD={card['id']},DEV=0" if card else ""


def surround_ready() -> bool:
    return SURROUND_PLUGIN.is_file() and SURROUND_CONF.is_file()


# --- Tools on the Pi ---

def tools() -> dict:
    """What's installed: bluez-alsa's player and daemon, and the voice."""
    daemon = shutil.which("bluealsad") or shutil.which("bluealsa")
    return {
        "aplay": bool(shutil.which("aplay")),
        "bluealsa": bool(daemon),
        "passthrough": bool(shutil.which("bluealsa-aplay")),
        "surround": surround_ready(),
        "voice": voice_problem() == "",
    }


def voice_problem() -> str:
    import importlib.util
    if importlib.util.find_spec("kokoro_onnx") is None:
        return "The Kokoro voice isn't installed (run deploy/install_pi.sh)."
    d = Path(os.environ.get("REEL_MODEL_DIR", "") or (Path.home() / ".cache" / "sage-reels"))
    missing = [n for n in ("kokoro-v1.0.onnx", "voices-v1.0.bin") if not (d / n).is_file()]
    return f"The voice files ({', '.join(missing)}) aren't in {d} (run deploy/install_pi.sh)." if missing else ""


def _lower() -> None:
    try:
        import lowprio
        lowprio.lower(SPEAK_NICE)
    except Exception:
        pass


# --- The Pi's Wi-Fi (off frees the radio for Bluetooth audio when on Ethernet) ---

def _run(cmd: List[str], timeout: float = 10) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def ethernet_up(root: str = "/sys/class/net") -> bool:
    """True when a wired interface has a live link."""
    try:
        for name in os.listdir(root):
            if name.startswith(("eth", "en")):
                try:
                    if Path(root, name, "carrier").read_text().strip() == "1":
                        return True
                except OSError:
                    continue
    except OSError:
        pass
    return False


def wifi_state() -> dict:
    """{available, on, ethernet}."""
    nmcli = shutil.which("nmcli")
    eth = ethernet_up()
    if not nmcli:
        return {"available": False, "on": None, "ethernet": eth}
    try:
        out = _run([nmcli, "radio", "wifi"]).stdout.strip().lower()
    except (OSError, subprocess.TimeoutExpired):
        return {"available": False, "on": None, "ethernet": eth}
    return {"available": True, "on": out == "enabled", "ethernet": eth}


def set_wifi(on: bool) -> dict:
    nmcli = shutil.which("nmcli") or "/usr/bin/nmcli"
    if not on and not ethernet_up():
        raise ValueError("Plug in Ethernet first: with Wi-Fi off and no cable, the Pi would go offline.")
    proc = _run(["sudo", "-n", nmcli, "radio", "wifi", "on" if on else "off"], timeout=20)
    if proc.returncode:
        raise RuntimeError("The Pi refused (run: sudo deploy/install_pi.sh --only audio). " + proc.stderr.strip()[-120:])
    return wifi_state()


# --- The speaker ---

Emit = Callable[[dict], Awaitable[None]]


class Speaker:
    def __init__(self) -> None:
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.emit: Optional[Emit] = None
        self.phone = None            # phone_link.link, set by run()
        self.queue: Optional[asyncio.Queue] = None  # made in run()
        self.speaking = ""
        self.last: Optional[dict] = None
        self.error: Optional[dict] = None
        self.links: dict = {"soundbar": {"known": False, "paired": False, "connected": False, "audio": False, "name": ""}, "phoneAudio": False}
        self.music = None            # spotify.connect, set by spotify.run(): paused while Sage speaks
        self.we_connected = False
        self.away_since: Optional[float] = None
        self._pass: Optional[asyncio.subprocess.Process] = None
        self._pass_next = 0.0
        self._pass_paused = 0
        self._pass_device = ""
        self._pass_started = 0.0
        self.surround_broken = False  # surround didn't open; play without it until it's switched again
        self._surround_mode = ""
        self._dropped_phone_at = 0.0
        self._asked_phone_at = 0.0
        self._last_sent = ""
        self._daily_day = ""      # the day whose welcome/goodbye lines are made
        self._daily_try = 0.0
        self._events_at: Dict[str, float] = {}   # when each event line was last queued
        self._soundbar_was: Optional[bool] = None   # None until the first check (no line on Sage's own restart)
        self._last_spoke_at = 0.0
        self.now: Callable[[], datetime.datetime] = datetime.datetime.now

    # --- State for the web app ---

    def snapshot(self) -> dict:
        settings = get_settings()
        return {
            "settings": settings,
            "tools": tools(),
            "voiceProblem": voice_problem(),
            "voices": VOICES,
            "soundbar": self.links["soundbar"],
            "phoneAudio": self.links["phoneAudio"],
            "passing": self._pass is not None and self._pass.returncode is None,
            "surroundOn": self.surround_on(settings),
            "usb": {"on": uses_usb(settings), "card": (usb_card(settings.get("usbCard", "")) or {}).get("name", ""),
                    "cards": [c for c in usb_cards() if c["usb"] and c["playback"]]},
            "speaking": self.speaking,
            "last": self.last,
            "error": self.error if self.error and time.time() - self.error["at"] < 600 else None,
            "wifi": wifi_state(),
            "quietNow": in_quiet(self.now(), settings["quietStart"], settings["quietEnd"]),
        }

    async def _publish(self, force: bool = False) -> None:
        if not self.emit:
            return
        snap = await asyncio.to_thread(self.snapshot)
        key = json.dumps({k: v for k, v in snap.items() if k != "quietNow"}, sort_keys=True, default=str)
        if force or key != self._last_sent:
            self._last_sent = key
            await self.emit({"type": "SPEAKER_STATE", **snap})

    def _fail(self, message: str) -> None:
        log.info("Speaker: %s", message)
        self.error = {"message": message, "at": time.time()}
        try:
            import logstore
            logstore.warn("speaker", message)
        except Exception:
            pass

    # --- Bluetooth ---

    def _control(self):
        return getattr(self.phone, "control", None)

    async def _objects(self) -> dict:
        control = self._control()
        return await control.objects() if control else {}

    async def refresh(self) -> dict:
        settings = get_settings()
        phone_addr = ((getattr(self.phone, "link", None) or {}).get("address") or "") if self.phone else ""
        try:
            self.links = audio_links(await self._objects(), settings["address"], phone_addr)
        except Exception as e:
            log.debug("Speaker refresh failed: %s", e)
        return self.links

    async def _device(self, address: str):
        control = self._control()
        if control is None:
            raise RuntimeError("Bluetooth isn't reachable from Sage.")
        path = await control._device_path(address)
        return (await control._obj(path)).get_interface(DEVICE_IFACE)

    async def ensure_connected(self) -> bool:
        """Connect to the soundbar and wait for its audio link. True when ready."""
        settings = get_settings()
        if uses_usb(settings):
            return True
        if not settings["address"]:
            self._fail("No sound output: plug in a USB sound card or pick a soundbar.")
            return False
        links = await self.refresh()
        if links["soundbar"]["connected"]:
            return True
        try:
            device = await self._device(settings["address"])
            await asyncio.wait_for(device.call_connect(), timeout=30)
            self.we_connected = True
        except Exception as e:
            import bluetooth_control
            self._fail(f"Couldn't connect to {settings['name'] or 'the soundbar'}: {bluetooth_control.friendly(e)} "
                       "Is it on and set to Bluetooth?")
            await self._publish()
            return False
        for _ in range(10):  # the audio link follows the connection by a moment
            links = await self.refresh()
            if links["soundbar"]["audio"]:
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(1.0)  # soundbars often switch input on connect; let that finish
        await self._publish()
        return self.links["soundbar"]["connected"]

    async def disconnect(self) -> None:
        settings = get_settings()
        if not settings["address"]:
            return
        await self._stop_passthrough()
        if self.music is not None:
            await self.music.pause_quietly()
        try:
            device = await self._device(settings["address"])
            await asyncio.wait_for(device.call_disconnect(), timeout=15)
        except Exception as e:
            log.info("Soundbar disconnect failed: %s", e)
        self.we_connected = False
        await self.refresh()
        await self._publish()

    async def _phone_profile(self, connect: bool) -> None:
        """Open or drop the phone's A2DP link to the Pi (the phone is the source)."""
        address = ((getattr(self.phone, "link", None) or {}).get("address") or "")
        if not address:
            return
        try:
            device = await self._device(address)
            if connect:
                await asyncio.wait_for(device.call_connect_profile(A2DP_SOURCE), timeout=20)
            else:
                await asyncio.wait_for(device.call_disconnect_profile(A2DP_SOURCE), timeout=10)
        except Exception as e:
            log.info("Phone audio %s failed: %s", "connect" if connect else "disconnect", e)

    # --- Surround ---

    def surround_on(self, settings: dict) -> bool:
        if settings["surround"] != self._surround_mode:
            # Switching it again is a fresh try after a failure.
            self._surround_mode = settings["surround"]
            self.surround_broken = False
        return settings["surround"] in SURROUND and not self.surround_broken and surround_ready()

    def device(self, settings: dict, address: str = "") -> str:
        """The ALSA device to play on: the USB sound card when that's the output,
        else the Bluetooth soundbar; through surround on either when it's on."""
        on = self.surround_on(settings)
        mode = settings["surround"] if on else "off"
        if uses_usb(settings):
            card = usb_card(settings.get("usbCard", ""))
            if card:
                return usb_output_device(card["id"], mode, on)
        return output_device(address or settings["address"], mode, on)

    def _surround_failed(self, why: str) -> None:
        self.surround_broken = True
        self._fail(f"Surround didn't open, so the soundbar plays without it ({why}). Switch it off and on to try again.")

    # --- Phone audio through the soundbar ---

    async def _start_passthrough(self, soundbar: str, phone: str) -> None:
        settings = get_settings()
        want = self.device(settings, soundbar) + "|" + settings["latency"]
        if self._pass is not None and self._pass.returncode is None:
            if self._pass_device == want:
                return
            await self._stop_passthrough()  # surround switched: restart on the new device
            self._pass_next = 0.0
        elif self._pass is not None and self._pass_device.startswith("sage_surround") \
                and time.time() - self._pass_started < 8:
            # It died straight away on the surround device: fall back to plain.
            self._pass = None
            self._surround_failed("the phone pass-through stopped at once")
            self._pass_next = 0.0
            want = self.device(settings, soundbar) + "|" + settings["latency"]
        if time.time() < self._pass_next or not shutil.which("bluealsa-aplay"):
            return
        self._pass_next = time.time() + 10  # don't spin if it keeps dying
        try:
            self._pass = await asyncio.create_subprocess_exec(
                *passthrough_cmd(want.split("|")[0], phone, settings["latency"]),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
            self._pass_device = want
            self._pass_started = time.time()
            log.info("Passing the phone's audio to the soundbar%s.", " with surround" if want.startswith("sage_surround") else "")
        except OSError as e:
            self._fail(f"Couldn't start the phone pass-through: {e}")

    async def _stop_passthrough(self) -> None:
        proc, self._pass = self._pass, None
        if proc is None or proc.returncode is not None:
            return
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=3)
        except asyncio.TimeoutError:
            proc.kill()

    async def wifi_guard(self) -> None:
        """Wi-Fi off and the cable gone would leave the Pi unreachable: turn it back on."""
        state = await asyncio.to_thread(wifi_state)
        if state["available"] and state["on"] is False and not state["ethernet"]:
            log.info("Ethernet is down with Wi-Fi off; turning Wi-Fi back on.")
            try:
                await asyncio.to_thread(set_wifi, True)
            except Exception as e:
                self._fail(f"Couldn't turn Wi-Fi back on: {e}")

    async def tick(self) -> None:
        """Every few seconds: keep pass-through, the phone's audio link and
        the leave-home disconnect in line with the settings."""
        settings = get_settings()
        links = await self.refresh()
        phone_addr = ((getattr(self.phone, "link", None) or {}).get("address") or "") if self.phone else ""
        home = bool(self.phone and self.phone.available and self.phone.home)
        sb = dict(links["soundbar"])
        usb = uses_usb(settings)
        if usb:
            sb["connected"] = True   # a sound card is always "connected"
        now = time.time()
        if not usb and sb["connected"] and self._soundbar_was is False:
            self.event("soundbar")
        self._soundbar_was = bool(sb["connected"])

        # Spotify has the soundbar while it plays; only one player can hold it.
        spotify_on = bool(self.music is not None and self.music.playing())
        want_pass = bool((settings["address"] or usb) and settings["phoneSpeaker"] and sb["connected"] and phone_addr and not spotify_on)
        if want_pass and links["phoneAudio"] and not self._pass_paused:
            await self._start_passthrough(settings["address"], phone_addr)
        elif not want_pass or not links["phoneAudio"]:
            if not self._pass_paused:
                await self._stop_passthrough()

        # Phone audio with nowhere to go would be silence: drop it (but not
        # just because Spotify is playing for a moment).
        if links["phoneAudio"] and not want_pass and not spotify_on and now - self._dropped_phone_at > 30:
            self._dropped_phone_at = now
            await self._phone_profile(False)
        # Soundbar up and pass-through on: invite the phone once in a while.
        if want_pass and home and not links["phoneAudio"] and now - self._asked_phone_at > 300:
            self._asked_phone_at = now
            await self._phone_profile(True)

        # Leaving home: let go of a soundbar the Pi connected.
        if home or not (self.phone and self.phone.available):
            self.away_since = None
        elif self.away_since is None:
            self.away_since = now
        leave = settings["leaveAfterMinutes"]
        if leave and self.we_connected and sb["connected"] and self.away_since and now - self.away_since > leave * 60:
            log.info("You've been away %s min; disconnecting the soundbar.", leave)
            await self.disconnect()

        await self._publish()

    # --- Speaking ---

    def say_soon(self, text: str, kind: str = "line", cache: Optional[Path] = None) -> None:
        """Queue a line from any thread."""
        if self.loop is None or self.queue is None:
            return
        self.loop.call_soon_threadsafe(self.queue.put_nowait, {"text": text, "kind": kind, "at": time.time(), "cache": cache})

    async def say(self, text: str, kind: str = "line", cache: Optional[Path] = None) -> None:
        if self.queue is not None:
            await self.queue.put({"text": text, "kind": kind, "at": time.time(), "cache": cache})

    def event(self, kind: str) -> bool:
        """A short line for something that just happened (any thread). Lines
        never overlap: they wait in the one queue, and a small line is skipped
        when Sage is already talking or about to, or when the same kind was said
        within its cooldown. True when queued."""
        settings = get_settings()
        now = time.time()
        if not (has_output(settings) and settings.get("chimes", True)) or self.queue is None:
            return False
        if self.speaking or not self.queue.empty() or now - self._last_spoke_at < 15:
            return False
        if not event_due(kind, self._events_at, now):
            return False
        line = event_line(kind, settings.get("callMe", ""))
        if not line:
            return False
        self._events_at[kind] = now
        self.say_soon(line, "event")
        return True

    async def _speak_loop(self) -> None:
        while True:
            job = await self.queue.get()
            if job["kind"] == "event" and (time.time() - job.get("at", 0) > EVENT_STALE_S or not self.queue.empty()):
                continue    # late, or something more important is waiting
            try:
                await self._speak(job["text"], job["kind"], job.get("cache"))
            except Exception as e:
                self._fail(f"Speaking failed: {e}")
            finally:
                self.speaking = ""
                self._last_spoke_at = time.time()
                await self._publish()

    async def _speak(self, text: str, kind: str, cache: Optional[Path] = None) -> None:
        settings = get_settings()
        if not has_output(settings) or not text.strip():
            return
        if kind != "test" and in_quiet(self.now(), settings["quietStart"], settings["quietEnd"]):
            log.info("Quiet hours; not saying: %s", text[:60])
            return
        problem = voice_problem()
        if problem:
            self._fail(problem)
            return
        if not shutil.which("aplay"):
            self._fail("aplay isn't installed (run deploy/install_pi.sh).")
            return
        self.speaking = text
        self.error = None
        await self._publish()
        # Make the speech while the soundbar connects; both take a few seconds.
        wav_task = asyncio.ensure_future(self._render(text, settings, chime=True, cache=cache))
        ready = await self.ensure_connected()
        wav = await wav_task
        if not ready or wav is None:
            return
        try:
            played = await self._play(wav, settings)
            self.last = {"text": text, "kind": kind, "at": int(time.time() * 1000)}
            if played and kind == "greeting":
                await asyncio.to_thread(_store_greet_time, time.time())
        finally:
            if not cache or wav != str(cache):    # a cached line stays for the rest of the day
                try:
                    os.unlink(wav)
                except OSError:
                    pass

    async def _render(self, text: str, settings: dict, chime: bool, cache: Optional[Path] = None) -> Optional[str]:
        if cache and cache_ok(cache):
            return str(cache)
        fd, out = tempfile.mkstemp(prefix="sage-say-", suffix=".wav")
        os.close(fd)
        job = json.dumps({"text": text, "voice": settings["voice"], "speed": settings["speed"],
                          "volume": settings["volume"], "chime": chime, "out": out})
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(WORKER), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, preexec_fn=_lower)
            output, _ = await asyncio.wait_for(proc.communicate(job.encode()), timeout=180)
        except asyncio.TimeoutError:
            proc.kill()
            self._fail("The voice took too long to speak.")
            return None
        if proc.returncode != 0 or not os.path.getsize(out):
            self._fail("The voice couldn't speak: " + (output.decode(errors="replace").strip().splitlines() or ["unknown error"])[-1][:200])
            try:
                os.unlink(out)
            except OSError:
                pass
            return None
        if cache:
            try:
                cache.parent.mkdir(parents=True, exist_ok=True)
                os.replace(out, cache)
                return str(cache)
            except OSError as e:
                log.info("Couldn't keep the cached line: %s", e)
        return out

    def passing(self) -> bool:
        return self._pass is not None and self._pass.returncode is None

    async def make_room(self) -> None:
        """Spotify is about to play: stop passing the phone's audio through."""
        await self._stop_passthrough()

    async def _play(self, wav: str, settings: dict) -> bool:
        """Speak over whatever is on. With Spotify's sound path up, the voice is
        mixed into it: the music fades down, Sage speaks (through the same
        surround), the music fades back. Otherwise the soundbar is free, so pause
        what's on, speak straight to it, then carry on."""
        if self.music is not None and self.music.mixable():
            ducked = await self.music.duck()
            try:
                code, err = await self.music.play_into_sink(wav)
            finally:
                if ducked:
                    await self.music.unduck()
            if not code:
                return True
            log.info("Mixing the voice into the music failed (%s); speaking directly.", err.strip()[-160:])
        self._pass_paused += 1
        media = getattr(self.phone, "media", {}) or {}
        paused_phone = bool(media.get("playing")) and self._pass is not None
        paused_music = False
        try:
            if self.music is not None:
                paused_music = await self.music.hold()
            if paused_phone:
                await self.phone.send_command("pause")
            await self._stop_passthrough()
            device = self.device(settings)
            code, err = await self._aplay(device, wav)
            if code and device.startswith("sage_surround"):
                self._surround_failed(err.strip()[-120:] or "aplay failed")
                code, err = await self._aplay(self.device(settings), wav)
            if code:
                self._fail("The soundbar didn't play it: " + err.strip()[-160:])
            return not code
        finally:
            self._pass_paused -= 1
            self._pass_next = 0.0
            if paused_music:
                await self.music.release()
            if paused_phone:
                try:
                    await self.phone.send_command("play")
                except Exception:
                    pass

    async def _aplay(self, device: str, wav: str):
        proc = await asyncio.create_subprocess_exec(
            "aplay", "-q", "-D", device, wav,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            err = b"timed out"
        return proc.returncode, err.decode(errors="replace")

    # --- What to say ---

    async def greeting(self, wake: bool = False) -> str:
        settings = get_settings()
        facts = await asyncio.to_thread(self._facts, settings)
        try:
            from desk import ambient
            weather = await ambient.fetch_weather()
        except Exception:
            weather = None
        if weather:
            facts["tempC"] = round(weather["temp_c"])
            facts["sky"] = WEATHER_WORDS.get(weather.get("icon", ""), "")
        if settings["witty"]:
            line = await self._ai_line(facts, WAKE_PROMPT if wake else GREETING_PROMPT)
            if line:
                return line
        return template_wake(facts) if wake else template_greeting(facts)

    def _facts(self, settings: dict) -> dict:
        import life_mode
        import notifier
        prefs = notifier.get_prefs()
        tz = notifier._tz(prefs)
        now = datetime.datetime.now(tz)
        chill = life_mode.current().get("mode") == "chill"
        items = [i for i in notifier.open_items() if not i.get("isHidden") and "alarm" not in (i.get("labels") or [])]
        if chill:
            items = [i for i in items if not life_mode.hidden_in_chill(i)]
        due, overdue = notifier.plan_for_today(items, now, tz)
        habits_left = []
        try:
            habits_left = [str(h.get("name") or h.get("title") or "") for h in notifier.habits() if notifier.habit_due(h, now)]
        except Exception:
            pass
        return greeting_facts(now, due, overdue, chill, None, [h for h in habits_left if h], settings["callMe"])

    async def _ai_line(self, facts: dict, prompt: str = GREETING_PROMPT) -> str:
        try:
            import canvas_thinker
            import httpx
            key = canvas_thinker.groq_key()
            if not key:
                return ""
            model = canvas_thinker._setting("GROQ_LLM_MODEL") or canvas_thinker.GROQ_DEFAULT_MODEL
            async with httpx.AsyncClient(timeout=8) as client:
                for m in dict.fromkeys([model, canvas_thinker.GROQ_FALLBACK_MODEL]):
                    res = await client.post(canvas_thinker.GROQ_URL, headers={"Authorization": f"Bearer {key}"}, json={
                        "model": m, "temperature": 0.8, "max_tokens": 500,
                        "messages": [{"role": "user", "content": prompt + json.dumps(facts)}],
                    })
                    if res.status_code == 200:
                        line = clean_line(res.json()["choices"][0]["message"].get("content") or "")
                        if 20 <= len(line):
                            return line
        except Exception as e:
            log.info("Greeting AI failed, using the template: %s", e)
        return ""

    # --- Hooks ---

    def _day(self) -> str:
        return self.now().strftime("%Y-%m-%d")

    def _daily(self, kind: str, settings: dict) -> tuple:
        """Today's (text, cache path) for "welcome" or "goodbye"."""
        day = self._day()
        text = daily_line(kind, day, settings.get("callMe", ""))
        return text, speech_cache_path(kind, day, text, settings)

    def on_arrival(self, away_s: float = 0.0) -> None:
        """life_mode calls this (from a worker thread) when you get home.
        Away for a long while (briefAfterHours): the full task briefing.
        A shorter trip: just today's cached "welcome back"."""
        settings = get_settings()
        if not (has_output(settings) and settings["greet"] and self.loop):
            return
        if brief_due(away_s, float(settings.get("lastGreetAt") or 0), time.time(), float(settings["briefAfterHours"])):
            asyncio.run_coroutine_threadsafe(self.greet(), self.loop)
        else:
            text, cache = self._daily("welcome", settings)
            self.say_soon(text, "welcome", cache)

    def on_leave(self) -> None:
        """life_mode calls this when the phone has left: today's cached goodbye."""
        settings = get_settings()
        if has_output(settings) and settings["goodbye"] and self.loop:
            text, cache = self._daily("goodbye", settings)
            self.say_soon(text, "goodbye", cache)

    async def ensure_daily(self) -> None:
        """Once a day (and again if a file went missing or the voice changed):
        make today's welcome-back and goodbye lines, and clear older days."""
        settings = get_settings()
        day = self._day()
        todo = [(k,) + self._daily(k, settings) for k in DAILY_LINES]
        if all(cache_ok(c) for _, _, c in todo):
            self._daily_day = day
            return
        if self.speaking or voice_problem() or not shutil.which("ffmpeg"):
            return
        for kind, text, cache in todo:
            if not cache_ok(cache) and text:
                await self._render(text, settings, chime=True, cache=cache)
        for old in speech_cache_dir().glob("*.wav"):
            if not old.name.startswith(day):
                try:
                    old.unlink()
                except OSError:
                    pass
        self._daily_day = day

    async def greet(self, kind: str = "greeting") -> str:
        line = await self.greeting()
        await self.say(line, kind)
        return line

    def on_wake(self) -> None:
        """An alarm marked "Wake me up" was stopped (called on the loop): speak
        the morning briefing, if there is a speaker and you're home."""
        settings = get_settings()
        home = bool(self.phone and self.phone.available and self.phone.home)
        if self.loop and has_output(settings) and home:
            async def brief() -> None:
                await self.say(await self.greeting(wake=True), "wake")
            asyncio.ensure_future(brief())

    def on_reminder(self, item: dict, message: dict) -> None:
        """notifier calls this (from its worker thread) as a reminder goes out.
        Only reminders switched to "Read aloud" are spoken (default off, so a
        private one stays silent), and only while you're home."""
        settings = get_settings()
        home = bool(self.phone and self.phone.available and self.phone.home)
        wanted = bool((item.get("customFields") or {}).get("readAloud"))
        if has_output(settings) and settings["reminders"] and home and wanted:
            self.say_soon(reminder_line(message), "reminder")

    # --- Running ---

    async def run(self, broadcast: Emit, phone: Any) -> None:
        self.loop = asyncio.get_running_loop()
        self.emit = broadcast
        self.phone = phone
        self.queue = asyncio.Queue()
        asyncio.ensure_future(self._speak_loop())
        while True:
            try:
                await self.wifi_guard()
                if has_output(get_settings()):
                    await self.tick()
                    if self._daily_day != self._day() and time.time() - self._daily_try >= 600:
                        self._daily_try = time.time()
                        await self.ensure_daily()
            except Exception as e:
                log.debug("Speaker check failed: %s", e)
            await asyncio.sleep(CHECK_EVERY)


speaker = Speaker()
