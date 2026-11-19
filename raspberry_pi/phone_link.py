"""
phone_link.py - The iPhone as a Bluetooth Low Energy companion of the Pi.

The Pi pairs with the iPhone the way a smartwatch does, never as a speaker:
it only asks for Apple's two accessory services, which iOS offers to any
bonded BLE device without an app.

- ANCS (Apple Notification Center Service): the phone's notifications.
- AMS (Apple Media Service): what the phone is playing, plus play/pause/skip.
- Presence: the bonded phone being connected means you are home. It is marked
  away only after AWAY_AFTER seconds without a connection, so leaving the room
  for a minute does not flip it.

Everything runs through BlueZ over D-Bus (dbus-next). Without BlueZ, or off
Linux, the link stays off and the rest of Sage works as before. State lives in
memory only: notification text never touches the database or the log.

Spec references: Apple's "ANCS Specification" and "AMS Specification".
"""

import asyncio
import logging
import json
import os
import struct
import time
from collections import deque
from pathlib import Path
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional

import presence

log = logging.getLogger("phone_link")

ENABLED = os.getenv("SAGE_PHONE_LINK", "1").strip().lower() not in {"0", "false", "no", "off"}
DEVICE_NAME = os.getenv("SAGE_PHONE_LINK_NAME", "Sage Companion")
AWAY_AFTER = int(os.getenv("SAGE_PHONE_AWAY_AFTER", "300"))
# The quick setting: a Bluetooth blip shorter than this is not "you left".
QUICK_AWAY_AFTER = int(os.getenv("SAGE_PHONE_QUICK_AWAY", "30"))
# Seconds the phone may stay disconnected before you count as away. db_server
# swaps this for the speaker card's "count me as away quickly" switch (QUICK_AWAY_AFTER or AWAY_AFTER).
away_after: Callable[[], float] = lambda: AWAY_AFTER
# Bundle ids whose notifications are passed on. Empty means every app.
# Set by db_server: Herald announces some phone notifications and a low battery.
on_phone_notification = None   # fn(entry dict)
fetch_existing = lambda: False   # fn() -> True while the phone's older notifications are wanted (Herald's recap, just after you get back)
on_phone_call = None           # fn(event: ringing|ringing_stopped|missed, uid) (room_music.py)
on_phone_battery = None        # fn(level 0..100)
BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"  # the iPhone shares it with bonded accessories
BATTERY_EVERY_S = 300
# How long after the phone last proved its BLE link is really alive (real
# ANCS/AMS data arrived, a subscription finished, or a battery read succeeded)
# it still counts as present, even while BlueZ keeps claiming it is connected.
# A phone that has left leaves a "connected" Device1 behind in BlueZ: a
# half-open, zombie link where no notify session starts and no data ever comes.
# Trusting BlueZ's Connected flag alone showed "phone connected / Home" forever.
# Must stay above BATTERY_EVERY_S so a present but silent phone, kept fresh only
# by the 5-minute battery heartbeat, is never dropped between reads.
DATA_LIVE = int(os.getenv("SAGE_PHONE_DATA_LIVE", str(presence.DATA_LIVE)))
PRESENCE_LIVENESS = int(os.getenv("SAGE_PHONE_LIVENESS", str(presence.FLAG_LIVE)))
# Self-healing a wedged BLE link. BlueZ can report the phone connected with its
# services resolved while the link is actually dead: notify sessions won't start
# and nothing arrives. Healing it (disconnect so the phone reconnects with a
# fresh GATT link) is gated on *positive evidence* the link is broken, never on
# silence alone, so a quiet but present phone is never dropped by mistake:
#   - a probe read of the battery that fails, or
#   - the ANCS/AMS subscription failing several ticks running.
# DEAD_AFTER: the link must also have shown no life at all for this long first.
DEAD_AFTER = int(os.getenv("SAGE_PHONE_DEAD_AFTER", "150"))
# When the link looks suspect (no data for this long) the Pi actively reads the
# battery to test it, rather than waiting for the next heartbeat: a real drop is
# caught in seconds and a quiet-but-present phone is confirmed alive.
PROBE_AFTER = int(os.getenv("SAGE_PHONE_PROBE_AFTER", "60"))
PROBE_EVERY = int(os.getenv("SAGE_PHONE_PROBE_EVERY", "30"))
# Failed probe reads / failed subscriptions that count as "the link is broken".
PROBE_FAILS = int(os.getenv("SAGE_PHONE_PROBE_FAILS", "1"))
SUBSCRIBE_FAILS = int(os.getenv("SAGE_PHONE_SUBSCRIBE_FAILS", "3"))
# Shortest gap between two forced reconnects, so a phone that keeps coming back
# wedged is retried at a steady pace, not in a tight loop.
FORCE_MIN_GAP = int(os.getenv("SAGE_PHONE_FORCE_GAP", "3600"))
# The healing ladder never drops the phone more than this many times a day.
# Past that, Sage says the iPhone needs a re-pair rather than looping.
FORCE_MAX_PER_DAY = int(os.getenv("SAGE_PHONE_FORCE_MAX_DAY", "3"))
# ConnectProfile nudges back off 60 s, 120 s ... up to this many seconds.
PROFILE_MAX_GAP = int(os.getenv("SAGE_PHONE_PROFILE_MAX_GAP", "600"))
# Where the iPhone's address is remembered, so it is found on any kind of link.
PINNED_FILE = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent / "phone_pinned.json"
JOURNAL_KEEP = 200

ALLOWED_APPS = {a.strip() for a in os.getenv("SAGE_PHONE_APPS", "").split(",") if a.strip()}
KEEP = 20
# Seconds a phone may stay connected without a BLE link before the Pi drops it
# so it reconnects fresh. The old 25 s was a flap: iPhone opened a classic ACL,
# the Pi dropped it before iOS got round to opening BLE, and iOS reconnected on
# classic again. The Pi now tries ConnectProfile(ANCS) first and only drops as a
# last resort, after a long quiet.
STUCK_DROP_AFTER = int(os.getenv("SAGE_PHONE_STUCK_DROP", "900"))
# How often (seconds) the Pi actively asks for the ANCS profile when the phone
# is on a classic-only link, so iOS opens the BLE GATT session itself.
PROFILE_RETRY = int(os.getenv("SAGE_PHONE_PROFILE_RETRY", "60"))

BLUEZ = "org.bluez"
ANCS_SERVICE = "7905f431-b5ce-4e99-a40f-4b1e122d00d0"
ANCS_NOTIFICATION_SOURCE = "9fbf120d-6301-42d9-8c58-25e699a21dbd"
ANCS_CONTROL_POINT = "69d1d8f3-45e1-49a8-9821-9bbdfdaad9d9"
ANCS_DATA_SOURCE = "22eac6e9-24d6-4bb5-be44-b36ace7c7bfb"
AMS_SERVICE = "89d3502b-0f36-433a-8ef4-c502ad55f8dc"
AMS_REMOTE_COMMAND = "9b3c81d8-57b1-4a8a-b8df-0e56f7ca51c2"
AMS_ENTITY_UPDATE = "2f7cabce-808d-411f-9a0c-bb92ba96c102"
AMS_ENTITY_ATTRIBUTE = "c6b2f38c-23ab-46d8-a6ab-a3a870bbd5d7"

CATEGORIES = [
    "other", "incoming call", "missed call", "voicemail", "social", "schedule",
    "email", "news", "health", "business", "location", "entertainment",
]
# ANCS attribute ids: 0 app id, 1 title, 3 message (each with a max length).
ATTR_REQUEST = bytes([0]) + bytes([1]) + struct.pack("<H", 64) + bytes([3]) + struct.pack("<H", 256)

# AMS entities and attributes.
AMS_PLAYER, AMS_TRACK = 0, 2
# Seconds to let the phone take a fresh notify before asking it for songs.
AMS_SETTLE = 1.0
# The phone sends a song's details only when they change, so a Pi that
# subscribes mid-song hears "playing" but no title. After this many seconds
# of that it reads the details itself, then tries again after each wait.
TITLE_WAIT = 3.0
TITLE_RETRY = (15.0, 60.0, 300.0)
TRACK_ATTRS = ((2, "title"), (0, "artist"), (1, "album"), (3, "duration"))
COMMANDS = {"play": 0, "pause": 1, "toggle": 2, "next": 3, "previous": 4}

Broadcast = Callable[[dict], Awaitable[None]]

# Names for the log, so a line says what failed rather than a UUID.
CHAR_NAMES = {
    ANCS_NOTIFICATION_SOURCE: "notifications (ANCS Notification Source)",
    ANCS_CONTROL_POINT: "notification details request (ANCS Control Point)",
    ANCS_DATA_SOURCE: "notification details (ANCS Data Source)",
    AMS_REMOTE_COMMAND: "media buttons (AMS Remote Command)",
    AMS_ENTITY_UPDATE: "now playing (AMS Entity Update)",
    AMS_ENTITY_ATTRIBUTE: "song details (AMS Entity Attribute)",
}
# What a BlueZ or ATT error usually means here, for the log.
HINTS = {
    "not connected": "the phone's Bluetooth Low Energy link to the Pi is down (classic Bluetooth audio can still be up); "
                     "the phone has to reconnect to the Pi's 'Sage Companion' over BLE",
    "0x0e": "the phone refused the request (ATT 'Unlikely Error'); usually the phone is still setting up "
            "encryption or hasn't allowed the Pi to see notifications and media",
    "0xa0": "the phone doesn't think the Pi is listening for songs yet (AMS 'Invalid State'); "
            "the Pi turns the songs subscription off and on and asks again",
    "0x05": "the phone wants the Pi paired again (insufficient authentication)",
    "0x0f": "the link isn't encrypted yet (insufficient encryption)",
    "in progress": "BlueZ is still starting this from an earlier try",
    "not permitted": "BlueZ refused it for this characteristic",
}


# Set by db_server: True while music streams to the soundbar. The Pi has one
# radio; reconnect attempts to the phone then cost audible stutters.
audio_busy: Callable[[], bool] = lambda: False


def ble_retry_gap(tries: int, busy: bool = False) -> float:
    """Seconds before the next BLE connect try: 5 s doubling to 60 s, so the
    phone shows up in Sage within seconds; never more often than every 10 min
    while music streams over Bluetooth. Pure."""
    gap = min(60.0, 5.0 * (2 ** max(0, tries - 1)))
    return max(gap, 600.0) if busy and tries >= 1 else gap


def hint_for(error: str) -> str:
    low = error.lower()
    return next((h for key, h in HINTS.items() if key in low), "")


# --- Pure decoding, kept free of D-Bus so it can be tested anywhere ---

def parse_notification_source(data: bytes) -> Optional[dict]:
    """8 bytes: event id, flags, category, count, notification uid (uint32)."""
    if len(data) < 8:
        return None
    event, flags, category, _count, uid = struct.unpack("<BBBBI", data[:8])
    return {
        "event": ("added", "modified", "removed")[event] if event < 3 else "unknown",
        "silent": bool(flags & 1),
        "important": bool(flags & 2),
        "preExisting": bool(flags & 4),
        # What the phone lets an accessory do with it: for a call, positive
        # answers and negative declines; for most others negative clears it.
        "positive": bool(flags & 8),
        "negative": bool(flags & 16),
        "category": CATEGORIES[category] if category < len(CATEGORIES) else "other",
        "uid": uid,
    }


def parse_attributes(data: bytes) -> Optional[dict]:
    """Data Source reply: command 0, uid, then (attr id, uint16 length, utf-8)."""
    if len(data) < 5 or data[0] != 0:
        return None
    uid = struct.unpack("<I", data[1:5])[0]
    names = {0: "appId", 1: "title", 3: "message"}
    out: Dict[str, Any] = {"uid": uid}
    i = 5
    while i + 3 <= len(data):
        attr, length = data[i], struct.unpack("<H", data[i + 1:i + 3])[0]
        if i + 3 + length > len(data):
            return None  # incomplete; the caller waits for more bytes
        if attr in names:
            out[names[attr]] = data[i + 3:i + 3 + length].decode("utf-8", errors="replace")
        i += 3 + length
    return out if all(k in out for k in names.values()) else None


def parse_entity_update(data: bytes) -> Optional[tuple]:
    """AMS: entity, attribute, flags, then the utf-8 value."""
    if len(data) < 3:
        return None
    return data[0], data[1], data[3:].decode("utf-8", errors="replace")


# Each app's own colour, for its card and the light on the clock. Apps not
# listed get one picked from APP_PALETTE by their bundle id, so an app is
# always the same colour; with no bundle id the category decides.
APP_COLORS = {
    "net.whatsapp.WhatsApp": "#25D366", "com.apple.MobileSMS": "#34C759",
    "com.apple.mobilephone": "#34C759", "com.apple.facetime": "#34C759",
    "com.apple.mobilemail": "#0A84FF", "com.google.Gmail": "#EA4335",
    "com.microsoft.Office.Outlook": "#0A84FF", "com.apple.mobilecal": "#FF453A",
    "com.apple.reminders": "#FF9F0A", "com.tinyspeck.chatlyio": "#A05AC8",
    "com.microsoft.skype.teams": "#6264A7", "ph.telegra.Telegraph": "#2AABEE",
    "com.burbn.instagram": "#E1306C", "com.facebook.Messenger": "#0084FF",
    "com.atebits.Tweetie2": "#1D9BF0", "com.google.ios.youtube": "#FF0000",
    "com.spotify.client": "#1DB954", "com.linkedin.LinkedIn": "#0A66C2",
    "com.toyopagroup.picaboo": "#FFFC00", "com.amazon.Amazon": "#FF9900",
}
CATEGORY_COLORS = {
    "incoming call": "#34C759", "missed call": "#FF453A", "voicemail": "#34C759",
    "social": "#5AC8FA", "schedule": "#FF453A", "email": "#0A84FF", "news": "#FF375F",
    "health": "#FF2D55", "business": "#A05AC8", "location": "#30D158", "entertainment": "#BF5AF2",
}
APP_PALETTE = ["#5AC8FA", "#FF9F0A", "#BF5AF2", "#30D158", "#FF375F", "#64D2FF", "#FFD60A", "#FF6482"]
DEFAULT_COLOR = "#5AC8FA"


def call_event_for(note: dict) -> Optional[str]:
    """What an ANCS event means for a call: ringing, ringing_stopped, missed, or None. Pure."""
    cat, ev = note.get("category"), note.get("event")
    if cat == "incoming call":
        if ev == "added" and not note.get("preExisting"):
            return "ringing"
        if ev == "removed":
            return "ringing_stopped"
    if cat == "missed call" and ev == "added" and not note.get("preExisting"):
        return "missed"
    return None


def app_color(app_id: str, category: str = "other") -> str:
    if app_id in APP_COLORS:
        return APP_COLORS[app_id]
    if app_id:
        return APP_PALETTE[sum(app_id.encode()) % len(APP_PALETTE)]
    return CATEGORY_COLORS.get(category, DEFAULT_COLOR)


def app_label(app_id: str) -> str:
    known = {
        "com.apple.MobileSMS": "Messages", "com.apple.mobilephone": "Phone",
        "com.apple.mobilecal": "Calendar", "com.apple.mobilemail": "Mail",
        "com.apple.reminders": "Reminders", "net.whatsapp.WhatsApp": "WhatsApp",
        "com.apple.facetime": "FaceTime",
    }
    if app_id in known:
        return known[app_id]
    tail = app_id.rsplit(".", 1)[-1]
    return tail[:1].upper() + tail[1:] if tail else "Phone"


class PhoneLink:
    def __init__(self) -> None:
        self.broadcast: Optional[Broadcast] = None
        self.available = False
        self.connected = False
        self.device_name = ""
        self.last_seen = 0.0
        self.home = False
        self.notifications: Deque[dict] = deque(maxlen=KEEP)
        self.media: Dict[str, Any] = {"title": "", "artist": "", "album": "", "playing": False, "app": "",
                                      # where the song was (s), at what rate, and when we heard (epoch s)
                                      "duration": 0.0, "elapsed": None, "rate": 1.0, "elapsedAt": 0.0}
        self._pending: Dict[int, dict] = {}
        self._data_buffer = b""
        self._bus = None
        self._chars: Dict[str, Any] = {}
        # Value watchers by characteristic path. They outlive a failed
        # subscribe so a retry doesn't add a second one, and go when the
        # phone does.
        self._watching: Dict[str, tuple] = {}
        # What the log last said, so a line repeated every few seconds is
        # written once and then summarised once a minute.
        self._said: Dict[str, list] = {}
        # The link's state as the Pi sees it, for the log and /api/phone.
        self._ble_last_try = 0.0
        self._ble_tries = 0
        self._classic_only = False
        self._ble_stuck_since = 0.0  # when ServicesResolved first stayed false
        self._profile_last_try = 0.0  # when the Pi last asked for the ANCS profile
        self.pinned = self._load_pin()        # the iPhone's address, remembered
        self.presence_reason = ""             # why Sage thinks you are home or away
        self.journal: Deque[dict] = deque(maxlen=JOURNAL_KEEP)  # what the link did and why
        self._bluez_owner = ""                # bluetoothd's bus name, to notice a restart
        self._advert_checked = 0.0
        self._profile_tries = 0
        self._forces: List[float] = []        # when the phone was last dropped on purpose
        self.needs_repair = False
        self._advertising = False
        self._adv_exported = False
        self._adv_last_try = 0.0
        self._subscribed_at = 0.0
        self._ams_not_listening = False  # the phone answered AMS 0xA0 last time
        self.media_at = 0.0  # when the phone last sent a song detail (epoch s)
        self._title_since = 0.0  # since when the phone has been playing with no title (epoch s)
        self._title_tries = 0
        self._title_next = 0.0
        self.link: Dict[str, Any] = {"phone": None, "address": None, "classic": False, "ble": False,
                                     "subscribed": [], "nowPlaying": "not asked", "lastError": None}
        self.battery: Optional[int] = None
        self._battery_at = 0.0
        # When the phone last proved its BLE link is really alive (real
        # ANCS/AMS data, a finished subscription, or a battery read). Presence
        # trusts this over BlueZ's Connected flag, which stays true on a dead
        # link after the phone has left (see PRESENCE_LIVENESS).
        self._alive_at = 0.0
        self._ble_dead_since = 0.0   # when the BLE link first looked dead (no life)
        self._probe_at = 0.0         # last active liveness probe
        self._probe_fails = 0        # consecutive failed liveness probes
        self._subscribe_fails = 0    # consecutive failed subscriptions (broken link)
        self._force_at = 0.0         # last forced reconnect, to pace retries
        self.control: Optional[Any] = None  # BluetoothControl, once BlueZ is reachable

    # --- State shared with the web app ---

    def snapshot(self) -> dict:
        return {
            "available": self.available,
            "connected": self.connected,
            "deviceName": self.device_name,
            "home": self.home,
            "lastSeen": int(self.last_seen * 1000) if self.last_seen else None,
            "media": self.media,
            "mediaAt": int(self.media_at * 1000) if self.media_at else None,
            "notifications": list(reversed(self.notifications)),
            "link": self.link,
            "battery": self.battery,
            "presenceReason": self.presence_reason,
            "needsRepair": self.needs_repair,
            "journal": list(self.journal)[-40:],
        }

    async def _emit(self, event: dict) -> None:
        if self.broadcast:
            await self.broadcast(event)

    async def _emit_status(self) -> None:
        state = self.snapshot()
        state.pop("notifications")
        state.pop("journal", None)
        await self._emit({"type": "PHONE_STATUS", **state})

    async def add_notification(self, item: dict) -> None:
        """Store one notification and tell the web app. Also used by the
        /api/phone/notifications route, so it can be tried without a phone."""
        app_id = item.get("appId", "")
        if ALLOWED_APPS and app_id and app_id not in ALLOWED_APPS:
            return
        entry = {
            "id": str(item.get("uid") or f"local-{int(time.time() * 1000)}"),
            "app": item.get("app") or app_label(app_id),
            "title": (item.get("title") or "").strip()[:120],
            "message": (item.get("message") or "").strip()[:300],
            "category": item.get("category", "other"),
            "appId": app_id,
            "color": item.get("color") or app_color(app_id, item.get("category", "other")),
            "important": bool(item.get("important")),
            # Which of the phone's actions it offers (see perform_action).
            "actions": {"positive": bool(item.get("positive")), "negative": bool(item.get("negative"))},
            "at": int(time.time() * 1000),
            "preExisting": bool(item.get("preExisting")),
        }
        self.notifications = deque((n for n in self.notifications if n["id"] != entry["id"]), maxlen=KEEP)
        self.notifications.append(entry)
        await self._emit({"type": "PHONE_NOTIFICATION", "notification": entry})

    async def remove_notification(self, notification_id: str, from_phone: bool = False) -> None:
        before = len(self.notifications)
        self.notifications = deque((n for n in self.notifications if n["id"] != notification_id), maxlen=KEEP)
        if len(self.notifications) != before or from_phone:
            await self._emit({"type": "PHONE_NOTIFICATION_REMOVED", "id": notification_id})

    async def clear_notifications(self) -> None:
        self.notifications.clear()
        await self._emit({"type": "PHONE_NOTIFICATION_REMOVED", "id": "*"})

    async def set_presence(self, connected: bool, name: str = "") -> None:
        now = time.time()
        changed = connected != self.connected
        self.connected = connected
        if connected:
            self.last_seen = now
            self.device_name = name or self.device_name
        home = connected or (self.last_seen and now - self.last_seen < away_after())
        if changed or bool(home) != self.home:
            if bool(home) != self.home:
                log.info("Presence: you are now %s (phone %s)", "home" if home else "away", "connected" if connected else "not connected")
            self.home = bool(home)
            if not self.home:
                await self._forget_live_data()
            await self._emit_status()

    async def _forget_live_data(self) -> None:
        """You are away: what the phone last said is old. Don't show it as live."""
        self.media.update({"title": "", "artist": "", "album": "", "playing": False, "app": "",
                           "duration": 0.0, "elapsed": None})
        self.media_at = 0.0
        await self._emit({"type": "PHONE_MEDIA", "media": self.media})
        await self.clear_notifications()

    # --- The remembered phone, the journal, the kernel's link list ---

    @staticmethod
    def _load_pin() -> str:
        try:
            return str(json.loads(PINNED_FILE.read_text()).get("address", "")).upper()
        except Exception:
            return ""

    def _pin(self, address: str, why: str) -> None:
        address = (address or "").upper()
        if not address or address == self.pinned:
            return
        self.pinned = address
        self.note("pin", f"remembered the iPhone's address {address} ({why})")
        try:
            PINNED_FILE.write_text(json.dumps({"address": address}))
        except Exception as e:
            log.info("Could not save the iPhone's address: %s", e)

    def note(self, event: str, detail: str) -> None:
        """One line in the link journal (last JOURNAL_KEEP, shown in Settings)."""
        self.journal.append({"at": int(time.time() * 1000), "event": event, "detail": detail})

    async def _kernel_links(self) -> Optional[set]:
        """Addresses the kernel holds a radio link to right now, or None when
        the Pi can't read the list (no hcitool, or not allowed)."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "hcitool", "con", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
            if proc.returncode != 0:
                return None
            return presence.parse_hcitool_con(out.decode(errors="replace"))
        except Exception:
            return None

    async def _watch_bluez(self) -> None:
        """Notice bluetoothd restarting or the adapter being reset: both wipe
        the Pi's BLE advertisement and pairing agent, and nothing told Sage, so
        the iPhone could not find the Pi over BLE until Sage restarted."""
        try:
            intro = await self._bus.introspect("org.freedesktop.DBus", "/org/freedesktop/DBus")
            bus = self._bus.get_proxy_object("org.freedesktop.DBus", "/org/freedesktop/DBus", intro).get_interface("org.freedesktop.DBus")
            owner = await bus.call_get_name_owner(BLUEZ)
        except Exception:
            return
        restarted = bool(self._bluez_owner and owner != self._bluez_owner)
        self._bluez_owner = owner
        lost_advert = False
        now = time.time()
        if self._advertising and now - self._advert_checked >= 30:
            self._advert_checked = now
            try:
                manager = (await self._char("/org/bluez/hci0")).get_interface("org.bluez.LEAdvertisingManager1")
                lost_advert = (await manager.get_active_instances()) == 0
            except Exception:
                pass
        if restarted or lost_advert:
            self.note("bluez", "bluetoothd restarted" if restarted else "the Pi's BLE advertisement was lost")
            self.say("bluez", "Bluetooth was restarted or reset; advertising and the pairing agent again so the iPhone can find the Pi.")
            self._advertising = False
            self._adv_last_try = 0.0
            self._chars.clear()
            self._unwatch()
            if self.control:
                try:
                    await self.control.register_agent()
                except Exception as e:
                    self.say("agent", f"could not register the pairing agent again: {e}")

    def _may_force(self, now: float) -> bool:
        """The last rung of the healing ladder: at most once an hour and
        FORCE_MAX_PER_DAY times a day. Past that, stop and ask for a re-pair."""
        self._forces = [t for t in self._forces if now - t < 86400]
        if len(self._forces) >= FORCE_MAX_PER_DAY:
            if not self.needs_repair:
                self.needs_repair = True
                self.note("repair", f"dropped the phone {len(self._forces)} times today and it is still not "
                                    f"answering; stopping. Forget the Pi on the iPhone and pair again.")
            return False
        return not self._forces or now - self._forces[-1] >= FORCE_MIN_GAP

    async def send_command(self, command: str) -> bool:
        char = self._chars.get(AMS_REMOTE_COMMAND)
        if command not in COMMANDS or char is None:
            return False
        try:
            await char.call_write_value(bytes([COMMANDS[command]]), {})
            return True
        except Exception as e:
            log.warning("Media command failed: %s", e)
            return False

    async def perform_action(self, notification_id: str, positive: bool) -> bool:
        """Ask the phone to act on one of its notifications (ANCS Perform
        Notification Action): positive answers a call, negative declines a
        call or clears anything else. False when it can't be asked: no link,
        a notification that didn't come from the phone, or one that doesn't
        offer that action."""
        char = self._chars.get(ANCS_CONTROL_POINT)
        note = next((n for n in self.notifications if n["id"] == notification_id), None)
        if char is None or note is None or not notification_id.isdigit():
            return False
        if not note.get("actions", {}).get("positive" if positive else "negative"):
            return False
        try:
            await char.call_write_value(bytes([2]) + struct.pack("<I", int(notification_id)) + bytes([0 if positive else 1]), {})
            return True
        except Exception as e:
            log.warning("Notification action failed: %s", e)
            return False

    # --- Bluetooth ---

    async def run(self, broadcast: Broadcast) -> None:
        self.broadcast = broadcast
        if not ENABLED:
            return
        try:
            from dbus_next.aio import MessageBus
            from dbus_next import BusType
            self._bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        except Exception as e:
            log.info("Phone link off (no BlueZ on the system bus): %s", e)
            return
        self.available = True
        from bluetooth_control import BluetoothControl
        self.control = BluetoothControl(self._bus, self._emit, {ANCS_SERVICE, AMS_SERVICE})
        try:
            await self.control.register_agent()
        except Exception as e:
            log.warning("Could not register the pairing agent (pairing from Sage may not work): %s", e)
        while True:
            try:
                await self._tick()
            except Exception as e:
                self.say("tick", f"unexpected error ({type(e).__name__}): {e}. Trying again in 5 s.")
                self._chars.clear()  # subscribe again on the next tick
            # Poll faster while scanning, pairing or connecting so the page keeps up.
            # Also fast while waiting for the phone's BLE link, which can be up
            # for only a few seconds before the phone drops it again.
            # Only for the first few tries: after that the phone is refusing, and
            # polling BlueZ every 1.5 s just keeps the radio busy.
            waiting_for_ble = self.link["classic"] and not self.link["ble"] and self._ble_tries < 6
            await asyncio.sleep(1.5 if self.control.busy or self.control.latest.get("scanning") or waiting_for_ble else 5)

    async def _objects(self) -> dict:
        intro = await self._bus.introspect(BLUEZ, "/")
        manager = self._bus.get_proxy_object(BLUEZ, "/", intro).get_interface("org.freedesktop.DBus.ObjectManager")
        return await manager.call_get_managed_objects()

    async def _tick(self) -> None:
        if not self._advertising and time.time() - self._adv_last_try >= 30:
            await self._advertise()
        objects = await self._objects()
        if self.control:
            await self.control.refresh(objects)
        await self._watch_bluez()
        phone_path, phone_name, dev = None, "", None
        for path, ifaces in objects.items():
            d = ifaces.get("org.bluez.Device1")
            if d and d["Paired"].value and d["Connected"].value:
                address = (d["Address"].value if d.get("Address") else "").upper()
                uuids = {u.lower() for u in d.get("UUIDs").value} if d.get("UUIDs") else set()
                services = self._services_under(objects, path)
                by_service = ANCS_SERVICE in services or AMS_SERVICE in services or ANCS_SERVICE in uuids
                by_pin = bool(self.pinned and address == self.pinned)
                icon = d.get("Icon").value if d.get("Icon") else ""
                by_icon = not self.pinned and icon == "phone"
                if by_service or by_pin or by_icon:
                    phone_path, phone_name, dev = path, d.get("Alias").value if d.get("Alias") else "", d
                    self._pin(address, "found on its Apple notification service" if by_service else "a paired phone")
                    break
        # Home needs real evidence (presence.py): the kernel holds a radio link
        # to the remembered iPhone, or the phone is sending data. BlueZ's own
        # "Connected" flag alone is not trusted: it stays true on a dead zombie
        # link after the phone has left. The kernel list is only trusted when
        # it shows the phone (an iPhone's BLE address can change), never to say
        # the phone is gone.
        now_t = time.time()
        links = await self._kernel_links()
        radio = True if (links is not None and self.pinned and self.pinned in links) else None
        data_age = now_t - self._alive_at if self._alive_at else None
        verdict = presence.decide(radio, data_age, phone_path is not None, DATA_LIVE, PRESENCE_LIVENESS)
        if verdict.reason != self.presence_reason:
            self.note("presence", f"{'home' if verdict.present else 'away'}: {verdict.reason}")
        self.presence_reason = verdict.reason
        await self.set_presence(verdict.present, phone_name or self.device_name)
        if phone_path is None:
            self._set_link(phone=None, address=None, classic=False, ble=False, subscribed=[])
            self.say("state", "no paired phone is connected to the Pi; waiting")
            self._chars.clear()
            self._unwatch()
            return
        # ServicesResolved is BlueZ's word for "the BLE (GATT) link is up and
        # its services are read". Connected alone can be just classic audio.
        ble = bool(dev.get("ServicesResolved") and dev["ServicesResolved"].value)
        address = dev["Address"].value if dev.get("Address") else phone_path.rsplit("dev_", 1)[-1].replace("_", ":")
        self._set_link(phone=phone_name, address=address, classic=True, ble=ble)
        if not ble:
            now = time.time()
            if not self._ble_stuck_since:
                self._ble_stuck_since = now
            stuck_for = now - self._ble_stuck_since
            # Industrial-grade: don't fight the iPhone. If it is holding a
            # classic-only link, ask BlueZ for the ANCS profile (which pushes
            # the phone to open its BLE GATT), paced so we never thrash. Only
            # drop as a very last resort after STUCK_DROP_AFTER (15 min) and
            # never more often than FORCE_MIN_GAP.
            self._chars.clear()
            if now - self._profile_last_try >= min(PROFILE_MAX_GAP, PROFILE_RETRY * 2 ** self._profile_tries):
                self._profile_last_try = now
                self._profile_tries += 1
                await self._connect_profile(phone_path, phone_name, address)
            if stuck_for >= STUCK_DROP_AFTER and self._may_force(now):
                await self._force_fresh_link(phone_path,
                    f"{phone_name} ({address}) has been connected without BLE for "
                    f"{int(stuck_for)} s; disconnecting as a last resort.")
                return
            self.say("state", f"{phone_name} ({address}) is connected on classic; waiting for the iPhone "
                              f"to open its BLE link (asking for the ANCS profile every {PROFILE_RETRY} s).")
            return
        self._ble_tries = 0
        self._ble_stuck_since = 0.0
        self._profile_tries = 0
        stale = self._stale_reason(objects, phone_path) if self._chars else ""
        if stale:
            self.say("state", f"now playing from {phone_name} went quiet ({stale}); subscribing again.")
            self._set_link(nowPlaying="resubscribing")
            self._chars.clear()
        if not self._chars:
            await self._subscribe(objects, phone_path)
        if self._chars:
            await self._check_title()
        await self._check_battery(objects, phone_path)
        await self._heal_if_dead(objects, phone_path, phone_name, address)

    async def _check_battery(self, objects: dict, device_path: str, probe: bool = False) -> Optional[bool]:
        """Read the phone's battery level (Battery Service). Every few minutes as
        a heartbeat; with probe=True, read now to test a link that looks dead.
        Returns True on a good read, False when the read failed (the link is not
        answering), None when it wasn't time or the phone exposes no battery."""
        if not probe and time.time() - self._battery_at < BATTERY_EVERY_S:
            return None
        self._battery_at = time.time()
        for path, ifaces in objects.items():
            char = ifaces.get("org.bluez.GattCharacteristic1")
            if char and path.startswith(device_path + "/") and char["UUID"].value.lower() == BATTERY_LEVEL:
                try:
                    value = await asyncio.wait_for(
                        (await self._char(path)).get_interface("org.bluez.GattCharacteristic1").call_read_value({}),
                        timeout=10)
                    self.battery = int(bytes(value)[0])
                    self._alive_at = time.time()  # a read that works proves the link is live
                except Exception as e:
                    self.say("battery", f"could not read the phone's battery: {e}")
                    return False
                if on_phone_battery:
                    try:
                        on_phone_battery(self.battery)
                    except Exception as e:
                        log.info("Herald battery hook failed: %s", e)
                return True
        return None

    async def _heal_if_dead(self, objects: dict, device_path: str, name: str, address: str) -> None:
        """Keep the BLE link honest, so Herald and notifications can rely on it.

        BlueZ can hold the phone "connected" with its services resolved while
        the link is dead: no notify session starts and nothing arrives. When the
        link looks suspect, actively read the battery to test it. A quiet but
        present phone answers and is cleared; a dead link fails, and once there
        is positive evidence it is broken (a failed probe read, or the
        subscription failing several ticks running) and it has shown no life for
        DEAD_AFTER, the phone is disconnected so it reconnects with a fresh GATT
        link. Paced by FORCE_MIN_GAP so a phone that keeps coming back wedged is
        retried steadily, not in a tight loop."""
        now = time.time()
        if self._alive_at and now - self._alive_at < PROBE_AFTER:
            self._ble_dead_since = 0.0
            self._probe_fails = 0
            return
        if not self._ble_dead_since:
            self._ble_dead_since = now
        if now - self._probe_at >= PROBE_EVERY:
            self._probe_at = now
            ok = await self._check_battery(objects, device_path, probe=True)
            if ok is True:
                self._ble_dead_since = 0.0
                self._probe_fails = 0
                return
            if ok is False:
                self._probe_fails += 1
        broken = self._probe_fails >= PROBE_FAILS or self._subscribe_fails >= SUBSCRIBE_FAILS
        if broken and now - self._ble_dead_since >= DEAD_AFTER and self._may_force(now):
            await self._force_fresh_link(device_path,
                f"{name} ({address}) shows a BLE link but it is not answering "
                f"(no data for {int(now - self._ble_dead_since)} s; "
                f"{self._probe_fails} failed probe read(s), {self._subscribe_fails} failed subscribe(s)); "
                f"reconnecting to heal it.")

    async def _force_fresh_link(self, device_path: str, why: str) -> None:
        """Disconnect the phone so it reconnects with a clean GATT link. Used
        when the link is wedged: classic-only with no BLE, or a BLE link BlueZ
        calls up that is actually dead. The phone, still bonded and hearing the
        Pi's ANCS advertisement, reconnects on its own within a few seconds."""
        self.say("state", why)
        self._ble_stuck_since = 0.0
        self._ble_dead_since = 0.0
        self._ble_tries = 0
        self._probe_fails = 0
        self._subscribe_fails = 0
        self._classic_only = False
        self._force_at = time.time()
        self._forces.append(self._force_at)
        self.note("heal", why)
        self._chars.clear()
        self._unwatch()
        try:
            dev_obj = (await self._char(device_path)).get_interface("org.bluez.Device1")
            await asyncio.wait_for(dev_obj.call_disconnect(), timeout=10)
        except Exception as e:
            self.say("disconnect", f"disconnect failed: {e}")

    def _stale_reason(self, objects: dict, device_path: str) -> str:
        """Why the songs subscription is no longer live, or "" when it is.

        When the phone's BLE link drops and comes back between two ticks, the
        Pi never sees ServicesResolved go false, so it kept its old
        subscription. But BlueZ stops notifying on a disconnect, and the phone
        forgets which song details the Pi asked for, so nothing new ever came:
        the phone stayed connected while now playing froze. BlueZ's Notifying
        flag shows it, so an Entity Update that is gone or no longer notifying
        means subscribe again. A short grace after subscribing lets BlueZ set
        the flag, and keeps a phone that refuses from being asked every tick."""
        if AMS_ENTITY_UPDATE not in self._chars or time.time() - self._subscribed_at < 30:
            return ""
        for path, ifaces in objects.items():
            char = ifaces.get("org.bluez.GattCharacteristic1")
            if char and path.startswith(device_path + "/") and char["UUID"].value.lower() == AMS_ENTITY_UPDATE:
                if char.get("Notifying") and char["Notifying"].value:
                    return ""
                return "BlueZ says it is no longer notifying; the BLE link likely dropped and came back"
        return "the phone's media service is gone from BlueZ; the BLE link likely dropped and came back"

    async def _connect_profile(self, path: str, name: str, address: str) -> None:
        """Ask BlueZ to connect the ANCS GATT profile on a device already up on
        classic. This is the non-destructive way to coax the iPhone into
        opening its BLE GATT session: no disconnect, no flap. If BlueZ doesn't
        have the call (older versions) or the phone refuses, we just wait for
        iOS to open BLE on its own schedule. A classic-only ACL is fine; we
        now show the phone as present from the classic link alone."""
        try:
            dev = (await self._char(path)).get_interface("org.bluez.Device1")
            await asyncio.wait_for(dev.call_connect_profile(ANCS_SERVICE), timeout=10)
            self.say("profile", f"asked BlueZ for the ANCS profile on {name} ({address}); "
                                f"iOS should open BLE shortly.")
        except Exception as e:
            error = f"{getattr(e, 'type', None) or type(e).__name__}: {e}"
            # Any error is fine: the Pi keeps advertising ANCS, iOS reconnects
            # over BLE in its own time. Log quietly so repeated tries don't
            # fill the running record.
            self.say("profile", f"ConnectProfile(ANCS) on {name} not accepted ({error}); waiting for the iPhone.")

    async def _open_ble(self, path: str, name: str, address: str) -> None:
        """Ask BlueZ to connect to the phone over BLE. A phone that is already
        connected for classic audio doesn't open its BLE link on its own after
        Sage restarts, and without it there are no songs or notifications.
        BlueZ 5.78+ takes PreferredBearer=le for this; older BlueZ connects
        whatever is missing. Each failed try waits longer (ble_retry_gap):
        a Connect on the one radio stalls the soundbar's music for a moment,
        and trying every 30 s was the stutter you heard mid-song."""
        now = time.time()
        if now - self._ble_last_try < ble_retry_gap(self._ble_tries, audio_busy()):
            return
        self._ble_last_try = now
        self._ble_tries += 1
        try:
            dev = (await self._char(path)).get_interface("org.bluez.Device1")
            bearer = ""
            if hasattr(dev, "set_preferred_bearer"):
                await dev.set_preferred_bearer("le")
                bearer = " (PreferredBearer=le)"
            await asyncio.wait_for(dev.call_connect(), timeout=20)
            self.say("open-ble", f"asked BlueZ to connect {name} ({address}) over BLE{bearer}, try {self._ble_tries}: "
                                 f"BlueZ accepted; waiting for ServicesResolved.")
        except Exception as e:
            error = f"{getattr(e, 'type', None) or type(e).__name__}: {e}"
            if "profile-unavailable" in error.lower() or "profile_unavailable" in error.lower():
                # The Pi offers the phone no classic profile (it is notifications-only,
                # no speaker), so a bare Connect fails. The caller (_tick) will
                # fall through to ConnectProfile(ANCS) next tick, which coaxes
                # iOS into opening its BLE GATT without a disconnect/flap.
                self.say("open-ble", f"{name} has no classic profile the Pi offers; waiting on "
                                     f"ConnectProfile(ANCS) instead of dropping the link.")
                return
            if "already in progress" in error.lower():
                # BlueZ is already connecting it: not a refusal, look again soon.
                self._ble_tries = max(0, self._ble_tries - 1)
                self.say("open-ble", f"{name} is already connecting; waiting for it to finish.")
                return
            advice = ("If this keeps failing: on the iPhone open Settings > Bluetooth, tap (i) next to the Pi and "
                      "check 'Share System Notifications' is on; if it still fails, forget the Pi there and pair "
                      "again from Sage Settings > Bluetooth.") if self._ble_tries >= 3 else ""
            self.say("open-ble", f"could not open the BLE link to {name} ({address}), try {self._ble_tries}: {error}. "
                                 + advice)

    @staticmethod
    def _services_under(objects: dict, device_path: str) -> set:
        return {
            ifaces["org.bluez.GattService1"]["UUID"].value.lower()
            for path, ifaces in objects.items()
            if path.startswith(device_path + "/") and "org.bluez.GattService1" in ifaces
        }

    async def _char(self, path: str):
        intro = await self._bus.introspect(BLUEZ, path)
        return self._bus.get_proxy_object(BLUEZ, path, intro)

    async def _subscribe(self, objects: dict, device_path: str) -> None:
        notifying: Dict[str, bool] = {}
        for path, ifaces in objects.items():
            char = ifaces.get("org.bluez.GattCharacteristic1")
            if not char or not path.startswith(device_path + "/"):
                continue
            uuid = char["UUID"].value.lower()
            if uuid not in CHAR_NAMES:
                continue
            obj = await self._char(path)
            self._chars[uuid] = obj.get_interface("org.bluez.GattCharacteristic1")
            notifying[uuid] = bool(char.get("Notifying") and char["Notifying"].value)
            if uuid in {ANCS_NOTIFICATION_SOURCE, ANCS_DATA_SOURCE, AMS_ENTITY_UPDATE} and path not in self._watching:
                props = obj.get_interface("org.freedesktop.DBus.Properties")
                handler = self._value_handler(uuid)
                props.on_properties_changed(handler)
                self._watching[path] = (props, handler)
        # Each step is tried on its own: a phone that refuses one (an ANCS
        # error, say) still gets the others, and a notify BlueZ already has
        # running or starting ("In Progress") counts as on. Before this, the
        # first failure after a restart made every retry fail the same way and
        # the clock stopped getting songs.
        # Data Source must be listening before Notification Source starts.
        if AMS_ENTITY_UPDATE in self._chars and self._ams_not_listening:
            # The phone said the Pi isn't listening for songs (AMS 0xA0) while
            # BlueZ says it is: BlueZ kept an old subscription and didn't tell
            # the phone again. Stopping and starting makes BlueZ write it anew.
            await self._try(f"turning off {CHAR_NAMES[AMS_ENTITY_UPDATE]}", self._chars[AMS_ENTITY_UPDATE].call_stop_notify())
            notifying[AMS_ENTITY_UPDATE] = False
        # Same for ANCS: BlueZ can report Notifying from an earlier link while
        # the iPhone dropped the subscription (it forgets on reconnect), so no
        # notification ever arrives. Always turn both off and on so BlueZ
        # writes the subscription to the phone afresh (Data Source first).
        for uuid in (ANCS_NOTIFICATION_SOURCE, ANCS_DATA_SOURCE):
            if uuid in self._chars and notifying.get(uuid):
                await self._try(f"turning off {CHAR_NAMES[uuid]}", self._chars[uuid].call_stop_notify())
                notifying[uuid] = False
        started_ams = False
        for uuid in (ANCS_DATA_SOURCE, ANCS_NOTIFICATION_SOURCE, AMS_ENTITY_UPDATE):
            if uuid in self._chars and not notifying.get(uuid):
                await self._try(f"turning on {CHAR_NAMES.get(uuid, uuid)}", self._chars[uuid].call_start_notify())
                started_ams = started_ams or uuid == AMS_ENTITY_UPDATE
        if AMS_ENTITY_UPDATE in self._chars:
            if started_ams:
                await asyncio.sleep(AMS_SETTLE)  # the phone answers 0xA0 to a request sent straight after
            for entity in (bytes([AMS_PLAYER, 0, 1, 2]), bytes([AMS_TRACK, 0, 1, 2, 3])):
                what = "asking for the player" if entity[0] == AMS_PLAYER else "asking for the track"
                if not await self._try(f"{what} on {CHAR_NAMES[AMS_ENTITY_UPDATE]}",
                                       self._chars[AMS_ENTITY_UPDATE].call_write_value(entity, {})):
                    self._ams_not_listening = "0xa0" in str((self.link.get("lastError") or {}).get("error", "")).lower()
                    self._set_link(nowPlaying="failed, retrying in 5 s")
                    # Without this request the phone never sends songs, so
                    # forget the subscription and ask again on the next tick
                    # (the watchers stay, so nothing is added twice).
                    self._chars.clear()
                    self._subscribe_fails += 1  # evidence the link may be dead (_heal_if_dead)
                    return
        self._subscribed_at = time.time()
        self._alive_at = self._subscribed_at  # a finished subscription proves the link is live
        self._subscribe_fails = 0
        self._ams_not_listening = False
        self._set_link(subscribed=sorted(CHAR_NAMES.get(u, u) for u in self._chars), nowPlaying="asked")
        self.say("state", f"subscribed to {self.link['phone']} ({self.link['address']}): "
                          + ", ".join(self.link["subscribed"]) + ". Now playing will update on the next song change.")

    async def _check_title(self) -> None:
        """Playing with no title: read the song from the phone, or the clock
        says "Nothing playing" until the next song. Seen after a Pi restart
        mid-song: the player details came, the track's never did."""
        if not (self.media.get("playing") and not self.media.get("title")):
            self._title_since, self._title_tries = 0.0, 0
            return
        now = time.time()
        if not self._title_since:
            self._title_since, self._title_next = now, now + TITLE_WAIT
        if now < self._title_next:
            return
        self._title_next = now + TITLE_RETRY[min(self._title_tries, len(TITLE_RETRY) - 1)]
        self._title_tries += 1
        self._set_link(nowPlaying="playing with no song title; reading it from the phone")
        if await self._read_track():
            return
        # No Entity Attribute (or it refused): asking for the track again
        # makes some phones send its details.
        update = self._chars.get(AMS_ENTITY_UPDATE)
        if update:
            await self._try(f"asking for the track again on {CHAR_NAMES[AMS_ENTITY_UPDATE]}",
                            update.call_write_value(bytes([AMS_TRACK, 0, 1, 2, 3]), {}))

    async def _read_track(self) -> bool:
        """AMS Entity Attribute: write the entity and attribute, then read
        the value back. True when a title came back."""
        char = self._chars.get(AMS_ENTITY_ATTRIBUTE)
        if not char:
            return False
        got: Dict[str, bytes] = {}
        for attr, name in TRACK_ATTRS:
            step = f"reading the song's {name} from {CHAR_NAMES[AMS_ENTITY_ATTRIBUTE]}"

            async def read(attr=attr, name=name):
                await char.call_write_value(bytes([AMS_TRACK, attr]), {})
                got[name] = bytes(await char.call_read_value({}))
            if not await self._try(step, read()):
                break
        title = got.get("title", b"").decode("utf-8", errors="replace")
        if not title:
            self.say("title", f"{self.link.get('phone')} says it is playing but gave no song title; "
                              f"trying again in {int(self._title_next - time.time())} s")
            return False
        for attr, name in TRACK_ATTRS:
            if name in got:
                self._set_track(attr, got[name].decode("utf-8", errors="replace"))
        self.media_at = time.time()
        self._set_link(nowPlaying="asked")
        self.say("title", f"read the song from {self.link.get('phone')}: {title}")
        await self._emit({"type": "PHONE_MEDIA", "media": self.media})
        return True

    def _set_track(self, attr: int, value: str) -> None:
        if attr in (0, 1, 2):
            self.media[("artist", "album", "title")[attr]] = value
        elif attr == 3:
            try:
                self.media["duration"] = float(value or 0)
            except ValueError:
                self.media["duration"] = 0.0

    async def _try(self, step: str, call) -> bool:
        try:
            await call
            return True
        except Exception as e:
            error = f"{getattr(e, 'type', None) or type(e).__name__}: {e}"  # D-Bus errors carry a name
            if "progress" in str(e).lower() or "already" in str(e).lower():
                return True
            hint = hint_for(str(e))
            self._set_link(lastError={"step": step, "error": error, "at": int(time.time())})
            self.say(step, f"{step} failed on {self.link['phone']} ({self.link['address']}, "
                           f"BLE {'up' if self.link['ble'] else 'down'}): {error}" + (f". Likely: {hint}" if hint else ""))
            return False

    def _set_link(self, **fields) -> None:
        self.link.update(fields)

    def say(self, key: str, message: str) -> None:
        """Log a phone-link line. The same line for the same key is written
        once, then at most once a minute with how often it happened."""
        now = time.time()
        if key in ("state", "profile", "open-ble", "disconnect", "advertise"):
            self.note(key, message[:200])
        last = self._said.get(key)
        if last and last[0] == message:
            last[2] += 1
            if now - last[1] >= 60:
                log.warning("Phone link: %s (repeated %d times in the last minute)", message, last[2])
                last[1], last[2] = now, 0
            return
        self._said[key] = [message, now, 0]
        log.warning("Phone link: %s", message)

    def _unwatch(self) -> None:
        for props, handler in self._watching.values():
            try:
                props.off_properties_changed(handler)
            except Exception:
                pass
        self._watching.clear()

    def _value_handler(self, uuid: str):
        def handler(_iface, changed, _invalidated):
            if "Value" in changed:
                asyncio.ensure_future(self._on_value(uuid, bytes(changed["Value"].value)))
        return handler

    async def _on_value(self, uuid: str, data: bytes) -> None:
        # Real bytes from the phone: the clearest proof the BLE link is alive.
        self._alive_at = time.time()
        if uuid == ANCS_NOTIFICATION_SOURCE:
            self.say("ancs-raw", f"ANCS Notification Source sent {len(data)} bytes")
            note = parse_notification_source(data)
            if not note:
                return
            self.say("ancs-event", f"ANCS event from the phone: {note['event']} uid={note['uid']} cat={note.get('category')} "
                                   f"pre={note.get('preExisting')}")
            call_event = call_event_for(note)
            if call_event and on_phone_call:
                try:
                    on_phone_call(call_event, str(note["uid"]))
                except Exception as e:
                    log.info("Call hook failed: %s", e)
            if note["event"] == "removed":
                await self.remove_notification(str(note["uid"]), from_phone=True)
            elif (not note["preExisting"] or fetch_existing()) and ANCS_CONTROL_POINT in self._chars:
                self._pending[note["uid"]] = note
                request = bytes([0]) + struct.pack("<I", note["uid"]) + ATTR_REQUEST
                await self._chars[ANCS_CONTROL_POINT].call_write_value(request, {})
        elif uuid == ANCS_DATA_SOURCE:
            # Replies can span several packets; join until one parses.
            self._data_buffer = data if data[:1] == b"\x00" and not self._data_buffer else self._data_buffer + data
            attrs = parse_attributes(self._data_buffer)
            if attrs is None:
                if len(self._data_buffer) > 2048:
                    self._data_buffer = b""
                return
            self._data_buffer = b""
            note = self._pending.pop(attrs["uid"], {})
            self.say("ancs-detail", f"ANCS details: uid={attrs.get('uid')} app={attrs.get('appId', '')[:40]}")
            await self.add_notification({**note, **attrs})
            if on_phone_notification and self.notifications:
                try:
                    on_phone_notification(dict(self.notifications[-1]))
                except Exception as e:
                    log.info("Herald notification hook failed: %s", e)
        elif uuid == AMS_ENTITY_UPDATE:
            update = parse_entity_update(data)
            if not update:
                return
            entity, attr, value = update
            self.media_at = time.time()
            if entity == AMS_PLAYER and attr == 0:
                self.media["app"] = value
            elif entity == AMS_PLAYER and attr == 1:
                # PlaybackInfo: "state,rate,elapsed seconds", sent on play,
                # pause and seek; the desk carries the position on from there.
                parts = value.split(",")
                self.media["playing"] = parts[0] == "1"
                try:
                    self.media["rate"] = float(parts[1]) if len(parts) > 1 and parts[1] else 1.0
                    self.media["elapsed"] = float(parts[2]) if len(parts) > 2 and parts[2] else None
                except ValueError:
                    self.media["elapsed"] = None
                self.media["elapsedAt"] = time.time()
            elif entity == AMS_TRACK:
                self._set_track(attr, value)
            await self._emit({"type": "PHONE_MEDIA", "media": self.media})

    @staticmethod
    def advert_fields(name: str) -> dict:
        """What goes in the advertisement. A legacy BLE advertisement holds 31
        bytes: flags (3) and the ANCS solicitation (2 + 16) leave 10 for the
        name (2 + 8), so a longer name is cut to its first word. AMS is not
        solicited: ANCS alone makes the iPhone connect, and AMS comes with the
        same link. Both UUIDs and the full name came to 53 bytes, which BlueZ
        refuses ("Failed to register advertisement") on most Pi adapters."""
        short = name if len(name) <= 8 else (name.split()[0][:8] if name.split() else name[:8])
        return {"LocalName": short, "SolicitUUIDs": [ANCS_SERVICE]}

    async def _advertise(self) -> None:
        """Advertise as a connectable BLE device that asks for ANCS. This is
        what makes the iPhone find the Pi, and reconnect over BLE after the
        link drops. Retried from the tick every 30 s until BlueZ takes it."""
        self._adv_last_try = time.time()
        try:
            from dbus_next.service import ServiceInterface, method, dbus_property
            from dbus_next import PropertyAccess
        except Exception:
            return
        fields = self.advert_fields(DEVICE_NAME)

        class Advertisement(ServiceInterface):
            def __init__(self):
                super().__init__("org.bluez.LEAdvertisement1")

            @method()
            def Release(self):  # noqa: N802 - BlueZ's name
                pass

            @dbus_property(access=PropertyAccess.READ)
            def Type(self) -> "s":  # noqa: F821,N802
                return "peripheral"

            @dbus_property(access=PropertyAccess.READ)
            def LocalName(self) -> "s":  # noqa: F821,N802
                return fields["LocalName"]

            @dbus_property(access=PropertyAccess.READ)
            def SolicitUUIDs(self) -> "as":  # noqa: F821,N802
                return fields["SolicitUUIDs"]

            @dbus_property(access=PropertyAccess.READ)
            def Includes(self) -> "as":  # noqa: F821,N802
                return []

        path = "/sage/phone/advertisement0"
        slots = ""
        try:
            if not self._adv_exported:
                self._bus.export(path, Advertisement())
                self._adv_exported = True
            adapter = await self._char("/org/bluez/hci0")
            manager = adapter.get_interface("org.bluez.LEAdvertisingManager1")
            try:
                active = await manager.get_active_instances()
                free = await manager.get_supported_instances()
                slots = f" (advertising slots in use: {active} of {active + free})"
            except Exception:
                pass
            await manager.call_register_advertisement(path, {})
            self._advertising = True
            self.say("advertise", f"advertising as {fields['LocalName']}{slots}, so the iPhone can find and "
                                  f"reconnect to the Pi over BLE")
        except Exception as e:
            self.say("advertise", f"could not advertise as {fields['LocalName']}{slots}, so the iPhone can't "
                                  f"reconnect to the Pi over BLE: {getattr(e, 'type', None) or type(e).__name__}: "
                                  f"{e}. Trying again every 30 s. If it keeps failing, run "
                                  f"'sudo systemctl restart bluetooth'.")

link = PhoneLink()
