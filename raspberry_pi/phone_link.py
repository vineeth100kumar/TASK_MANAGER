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
import os
import struct
import time
from collections import deque
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional

log = logging.getLogger("phone_link")

ENABLED = os.getenv("SAGE_PHONE_LINK", "1").strip().lower() not in {"0", "false", "no", "off"}
DEVICE_NAME = os.getenv("SAGE_PHONE_LINK_NAME", "Sage Companion")
AWAY_AFTER = int(os.getenv("SAGE_PHONE_AWAY_AFTER", "300"))
# Bundle ids whose notifications are passed on. Empty means every app.
ALLOWED_APPS = {a.strip() for a in os.getenv("SAGE_PHONE_APPS", "").split(",") if a.strip()}
KEEP = 20

BLUEZ = "org.bluez"
ANCS_SERVICE = "7905f431-b5ce-4e99-a40f-4b1e122d00d0"
ANCS_NOTIFICATION_SOURCE = "9fbf120d-6301-42d9-8c58-25e699a21dbd"
ANCS_CONTROL_POINT = "69d1d8f3-45e1-49a8-9821-9bbdfdaad9d9"
ANCS_DATA_SOURCE = "22eac6e9-24d6-4bb5-be44-b36ace7c7bfb"
AMS_SERVICE = "89d3502b-0f36-433a-8ef4-c502ad55f8dc"
AMS_REMOTE_COMMAND = "9b3c81d8-57b1-4a8a-b8df-0e56f7ca51c2"
AMS_ENTITY_UPDATE = "2f7cabce-808d-411f-9a0c-bb92ba96c102"

CATEGORIES = [
    "other", "incoming call", "missed call", "voicemail", "social", "schedule",
    "email", "news", "health", "business", "location", "entertainment",
]
# ANCS attribute ids: 0 app id, 1 title, 3 message (each with a max length).
ATTR_REQUEST = bytes([0]) + bytes([1]) + struct.pack("<H", 64) + bytes([3]) + struct.pack("<H", 256)

# AMS entities and attributes.
AMS_PLAYER, AMS_TRACK = 0, 2
COMMANDS = {"play": 0, "pause": 1, "toggle": 2, "next": 3, "previous": 4}

Broadcast = Callable[[dict], Awaitable[None]]


# --- Pure decoding, kept free of D-Bus so it can be tested anywhere ---

def parse_notification_source(data: bytes) -> Optional[dict]:
    """8 bytes: event id, flags, category, count, notification uid (uint32)."""
    if len(data) < 8:
        return None
    event, flags, category, _count, uid = struct.unpack("<BBBBI", data[:8])
    return {
        "event": ("added", "modified", "removed")[event] if event < 3 else "unknown",
        "silent": bool(flags & 1),
        "preExisting": bool(flags & 4),
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
        self.media: Dict[str, Any] = {"title": "", "artist": "", "album": "", "playing": False, "app": ""}
        self._pending: Dict[int, dict] = {}
        self._data_buffer = b""
        self._bus = None
        self._chars: Dict[str, Any] = {}

    # --- State shared with the web app ---

    def snapshot(self) -> dict:
        return {
            "available": self.available,
            "connected": self.connected,
            "deviceName": self.device_name,
            "home": self.home,
            "lastSeen": int(self.last_seen * 1000) if self.last_seen else None,
            "media": self.media,
            "notifications": list(reversed(self.notifications)),
        }

    async def _emit(self, event: dict) -> None:
        if self.broadcast:
            await self.broadcast(event)

    async def _emit_status(self) -> None:
        state = self.snapshot()
        state.pop("notifications")
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
            "at": int(time.time() * 1000),
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
        home = connected or (self.last_seen and now - self.last_seen < AWAY_AFTER)
        if changed or bool(home) != self.home:
            self.home = bool(home)
            await self._emit_status()

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
        await self._advertise()
        while True:
            try:
                await self._tick()
            except Exception as e:
                log.warning("Phone link error: %s", e)
                self._chars.clear()
            await asyncio.sleep(5)

    async def _objects(self) -> dict:
        intro = await self._bus.introspect(BLUEZ, "/")
        manager = self._bus.get_proxy_object(BLUEZ, "/", intro).get_interface("org.freedesktop.DBus.ObjectManager")
        return await manager.call_get_managed_objects()

    async def _tick(self) -> None:
        objects = await self._objects()
        phone_path, phone_name = None, ""
        for path, ifaces in objects.items():
            dev = ifaces.get("org.bluez.Device1")
            if dev and dev["Paired"].value and dev["Connected"].value:
                uuids = {u.lower() for u in dev.get("UUIDs").value} if dev.get("UUIDs") else set()
                services = self._services_under(objects, path)
                if ANCS_SERVICE in services or AMS_SERVICE in services or ANCS_SERVICE in uuids:
                    phone_path, phone_name = path, dev.get("Alias").value if dev.get("Alias") else ""
                    break
        await self.set_presence(phone_path is not None, phone_name)
        if phone_path is None:
            self._chars.clear()
            return
        if not self._chars:
            await self._subscribe(objects, phone_path)

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
        for path, ifaces in objects.items():
            char = ifaces.get("org.bluez.GattCharacteristic1")
            if not char or not path.startswith(device_path + "/"):
                continue
            uuid = char["UUID"].value.lower()
            if uuid not in {ANCS_NOTIFICATION_SOURCE, ANCS_CONTROL_POINT, ANCS_DATA_SOURCE, AMS_REMOTE_COMMAND, AMS_ENTITY_UPDATE}:
                continue
            obj = await self._char(path)
            self._chars[uuid] = obj.get_interface("org.bluez.GattCharacteristic1")
            if uuid in {ANCS_NOTIFICATION_SOURCE, ANCS_DATA_SOURCE, AMS_ENTITY_UPDATE}:
                props = obj.get_interface("org.freedesktop.DBus.Properties")
                props.on_properties_changed(self._value_handler(uuid))
        # Data Source must be listening before Notification Source starts.
        for uuid in (ANCS_DATA_SOURCE, ANCS_NOTIFICATION_SOURCE, AMS_ENTITY_UPDATE):
            if uuid in self._chars:
                await self._chars[uuid].call_start_notify()
        if AMS_ENTITY_UPDATE in self._chars:
            await self._chars[AMS_ENTITY_UPDATE].call_write_value(bytes([AMS_PLAYER, 0, 1, 2]), {})
            await self._chars[AMS_ENTITY_UPDATE].call_write_value(bytes([AMS_TRACK, 0, 1, 2]), {})
        log.info("Phone link subscribed: %s", ", ".join(sorted(self._chars)))

    def _value_handler(self, uuid: str):
        def handler(_iface, changed, _invalidated):
            if "Value" in changed:
                asyncio.ensure_future(self._on_value(uuid, bytes(changed["Value"].value)))
        return handler

    async def _on_value(self, uuid: str, data: bytes) -> None:
        if uuid == ANCS_NOTIFICATION_SOURCE:
            note = parse_notification_source(data)
            if not note:
                return
            if note["event"] == "removed":
                await self.remove_notification(str(note["uid"]), from_phone=True)
            elif not note["preExisting"] and ANCS_CONTROL_POINT in self._chars:
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
            await self.add_notification({**note, **attrs})
        elif uuid == AMS_ENTITY_UPDATE:
            update = parse_entity_update(data)
            if not update:
                return
            entity, attr, value = update
            if entity == AMS_PLAYER and attr == 0:
                self.media["app"] = value
            elif entity == AMS_PLAYER and attr == 1:
                self.media["playing"] = value.split(",")[0] == "1"
            elif entity == AMS_TRACK and attr in (0, 1, 2):
                self.media[("artist", "album", "title")[attr]] = value
            await self._emit({"type": "PHONE_MEDIA", "media": self.media})

    async def _advertise(self) -> None:
        """Advertise as a connectable BLE device that asks for ANCS, which is
        what makes it show up in the iPhone's Bluetooth settings."""
        try:
            from dbus_next.service import ServiceInterface, method, dbus_property
            from dbus_next import PropertyAccess, Variant
        except Exception:
            return

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
                return DEVICE_NAME

            @dbus_property(access=PropertyAccess.READ)
            def SolicitUUIDs(self) -> "as":  # noqa: F821,N802
                return [ANCS_SERVICE, AMS_SERVICE]

            @dbus_property(access=PropertyAccess.READ)
            def Includes(self) -> "as":  # noqa: F821,N802
                return []

        try:
            path = "/sage/phone/advertisement0"
            self._bus.export(path, Advertisement())
            adapter = await self._char("/org/bluez/hci0")
            await adapter.get_interface("org.bluez.LEAdvertisingManager1").call_register_advertisement(path, {})
            log.info("Advertising as %s", DEVICE_NAME)
        except Exception as e:
            log.warning("Could not advertise (pairing from the iPhone may not find the Pi): %s", e)


link = PhoneLink()
