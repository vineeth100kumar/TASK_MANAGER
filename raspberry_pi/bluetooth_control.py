"""
bluetooth_control.py - Manage the Pi's Bluetooth from Sage: see devices, scan,
pair, connect, disconnect, forget, and open a pairing window.

phone_link.py owns the BlueZ D-Bus connection and the phone's notification and
media services. This module sits on the same connection and handles the
adapter and the device list, the way a phone's Bluetooth settings page does.

Pairing is never silent. An incoming pairing request is only accepted while a
pairing window is open (or Sage started the pairing), and the passkey shown on
the phone must be confirmed in the Sage UI. Outside a window, requests are
rejected.
"""

import asyncio
import logging
import re
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

log = logging.getLogger("bluetooth_control")

BLUEZ = "org.bluez"
ADAPTER_IFACE = "org.bluez.Adapter1"
DEVICE_IFACE = "org.bluez.Device1"
PROPS_IFACE = "org.freedesktop.DBus.Properties"
AGENT_PATH = "/sage/bluetooth/agent"
PAIRING_SECONDS = 180
SCAN_SECONDS = 30
CONFIRM_SECONDS = 60
ADDRESS = re.compile(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")
ACTIONS = {"pair", "connect", "disconnect", "forget", "trust", "untrust"}

ICON_KIND = {
    "phone": "phone", "computer": "computer", "input-keyboard": "input", "input-mouse": "input",
    "input-gaming": "input", "input-tablet": "input", "audio-card": "audio", "audio-headset": "audio",
    "audio-headphones": "audio", "multimedia-player": "audio", "video-display": "audio", "watch": "watch",
}

FRIENDLY_ERRORS = (
    ("page timeout", "The device didn't answer. Check that it is on, nearby, and not connected elsewhere."),
    ("connection attempt failed", "Couldn't connect. Check that it is on and nearby."),
    ("authentication", "Pairing was refused. Forget the Pi on the other device and try again."),
    ("already exists", "Already paired."),
    ("already connected", "Already connected."),
    ("not available", "That device doesn't offer a service Sage can use."),
    ("in progress", "Busy with another step. Wait a moment and retry."),
    ("canceled", "Pairing was cancelled."),
    ("rejected", "Pairing was declined."),
    ("timeout", "Timed out. Try again."),
)

Emit = Callable[[dict], Awaitable[None]]


def friendly(error: Exception) -> str:
    text = str(getattr(error, "text", "") or error)
    lowered = text.lower()
    for needle, message in FRIENDLY_ERRORS:
        if needle in lowered:
            return message
    return "Bluetooth said: " + (text[:120] or "something went wrong")


def prop(ifaces: dict, iface: str, name: str, default: Any = None) -> Any:
    entry = ifaces.get(iface, {}).get(name)
    return entry.value if entry is not None else default


def device_kind(icon: Optional[str], is_phone: bool) -> str:
    if is_phone:
        return "phone"
    return ICON_KIND.get(icon or "", "other")


def build_snapshot(objects: dict, now: float, state: "ControlState", phone_uuids: set) -> dict:
    """The adapter and device list as the web app shows them. Pure, so it can
    be tested without BlueZ. `objects` is BlueZ's GetManagedObjects result."""
    adapter_path, adapter = None, None
    for path, ifaces in objects.items():
        if ADAPTER_IFACE in ifaces and (adapter is None or path.endswith("hci0")):
            adapter_path, adapter = path, ifaces
    if adapter is None:
        return {"available": False, "reason": "No Bluetooth adapter found on the Pi."}

    scanning = bool(prop(adapter, ADAPTER_IFACE, "Discovering", False))
    discoverable = bool(prop(adapter, ADAPTER_IFACE, "Discoverable", False))
    pairing_left = max(0, int(state.pairing_until - now)) if discoverable else 0

    devices: List[dict] = []
    for path, ifaces in objects.items():
        dev = ifaces.get(DEVICE_IFACE)
        if not dev or not path.startswith(adapter_path + "/"):
            continue
        address = prop(ifaces, DEVICE_IFACE, "Address", "")
        name = prop(ifaces, DEVICE_IFACE, "Alias") or prop(ifaces, DEVICE_IFACE, "Name") or ""
        paired = bool(prop(ifaces, DEVICE_IFACE, "Paired", False))
        connected = bool(prop(ifaces, DEVICE_IFACE, "Connected", False))
        # Unnamed strangers seen during a scan are noise (their name is just their address).
        if not paired and not connected and (not name or name.replace("-", ":").upper() == address.upper()):
            continue
        uuids = {u.lower() for u in prop(ifaces, DEVICE_IFACE, "UUIDs", [])}
        is_phone = bool(uuids & phone_uuids)
        devices.append({
            "address": address,
            "name": name or address,
            "kind": device_kind(prop(ifaces, DEVICE_IFACE, "Icon"), is_phone),
            "paired": paired,
            "connected": connected,
            "trusted": bool(prop(ifaces, DEVICE_IFACE, "Trusted", False)),
            "rssi": prop(ifaces, DEVICE_IFACE, "RSSI"),
            "working": state.working.get(address, ""),
        })
    devices.sort(key=lambda d: (not d["connected"], not d["paired"], d["rssi"] is None, -(d["rssi"] or -200), d["name"].lower()))

    pending = state.pending
    return {
        "available": True,
        "adapter": {
            "name": prop(adapter, ADAPTER_IFACE, "Alias", "") or prop(adapter, ADAPTER_IFACE, "Name", ""),
            "address": prop(adapter, ADAPTER_IFACE, "Address", ""),
            "powered": bool(prop(adapter, ADAPTER_IFACE, "Powered", False)),
        },
        "scanning": scanning,
        "pairing": {"active": pairing_left > 0, "secondsLeft": pairing_left},
        "pending": {
            "address": pending["address"], "name": pending["name"], "passkey": pending["passkey"],
            "secondsLeft": max(0, int(pending["expires"] - now)),
        } if pending else None,
        "error": state.error if state.error and now - state.error["at"] < 30 else None,
        "devices": devices,
    }


class ControlState:
    """What Sage itself knows about: the pairing window, pairing steps in
    flight, a passkey waiting for a yes/no, and the latest failure."""

    def __init__(self) -> None:
        self.pairing_until = 0.0
        self.working: Dict[str, str] = {}
        self.pending: Optional[dict] = None
        self.error: Optional[dict] = None


class BluetoothControl:
    def __init__(self, bus: Any, emit: Emit, phone_uuids: set) -> None:
        self.bus = bus
        self.emit = emit
        self.phone_uuids = phone_uuids
        self.state = ControlState()
        self._last = ""
        self._decision: Optional[asyncio.Future] = None
        self._adapter_path = "/org/bluez/hci0"
        self._tasks: set = set()

    # --- State ---

    @property
    def busy(self) -> bool:
        """True while something is changing, so the caller polls faster."""
        s = self.state
        return bool(s.working or s.pending or s.pairing_until > time.time())

    async def objects(self) -> dict:
        intro = await self.bus.introspect(BLUEZ, "/")
        manager = self.bus.get_proxy_object(BLUEZ, "/", intro).get_interface("org.freedesktop.DBus.ObjectManager")
        return await manager.call_get_managed_objects()

    async def refresh(self, objects: Optional[dict] = None) -> dict:
        objects = objects if objects is not None else await self.objects()
        for path, ifaces in objects.items():
            if ADAPTER_IFACE in ifaces:
                self._adapter_path = path
        snapshot = build_snapshot(objects, time.time(), self.state, self.phone_uuids)
        # Countdowns change every second; compare without them so only real changes broadcast.
        key = repr({**snapshot, "pairing": snapshot.get("pairing", {}).get("active"), "pending": bool(snapshot.get("pending"))})
        if key != self._last:
            self._last = key
            await self.emit({"type": "BT_STATE", **snapshot})
        self.latest = snapshot
        return snapshot

    latest: dict = {"available": False, "reason": "Bluetooth is starting."}

    # --- D-Bus helpers ---

    async def _obj(self, path: str):
        intro = await self.bus.introspect(BLUEZ, path)
        return self.bus.get_proxy_object(BLUEZ, path, intro)

    async def _set(self, path: str, iface: str, name: str, signature: str, value: Any) -> None:
        from dbus_next import Variant
        props = (await self._obj(path)).get_interface(PROPS_IFACE)
        await props.call_set(iface, name, Variant(signature, value))

    async def _device_path(self, address: str) -> str:
        if not ADDRESS.match(address.upper()):
            raise ValueError("That isn't a Bluetooth address.")
        for path, ifaces in (await self.objects()).items():
            if DEVICE_IFACE in ifaces and prop(ifaces, DEVICE_IFACE, "Address", "").upper() == address.upper():
                return path
        raise LookupError("That device isn't known to the Pi. Scan again.")

    def _spawn(self, coro: Awaitable) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # --- Adapter ---

    async def set_power(self, on: bool) -> None:
        await self._set(self._adapter_path, ADAPTER_IFACE, "Powered", "b", on)
        if not on:
            self.state.pairing_until = 0.0
        await self.refresh()

    async def set_pairing(self, on: bool, seconds: int = PAIRING_SECONDS) -> None:
        seconds = max(10, min(600, int(seconds)))
        path = self._adapter_path
        await self._set(path, ADAPTER_IFACE, "Powered", "b", True)
        await self._set(path, ADAPTER_IFACE, "DiscoverableTimeout", "u", seconds if on else 0)
        await self._set(path, ADAPTER_IFACE, "PairableTimeout", "u", seconds if on else 0)
        await self._set(path, ADAPTER_IFACE, "Pairable", "b", True)
        await self._set(path, ADAPTER_IFACE, "Discoverable", "b", on)
        self.state.pairing_until = time.time() + seconds if on else 0.0
        if not on:
            self._decide(False)
        await self.refresh()

    async def set_scan(self, on: bool) -> None:
        adapter = (await self._obj(self._adapter_path)).get_interface(ADAPTER_IFACE)
        try:
            if on:
                await self._set(self._adapter_path, ADAPTER_IFACE, "Powered", "b", True)
                await adapter.call_start_discovery()
                self._spawn(self._stop_scan_later())
            else:
                await adapter.call_stop_discovery()
        except Exception as e:
            if "InProgress" not in str(e) and "Failed" not in str(e):
                raise
        await self.refresh()

    async def _stop_scan_later(self) -> None:
        await asyncio.sleep(SCAN_SECONDS)
        try:
            await self.set_scan(False)
        except Exception:
            pass

    async def rename(self, name: str) -> None:
        name = name.strip()[:40]
        if not name:
            raise ValueError("Give the Pi a name.")
        await self._set(self._adapter_path, ADAPTER_IFACE, "Alias", "s", name)
        await self.refresh()

    # --- Devices ---

    async def device_action(self, address: str, action: str) -> None:
        if action not in ACTIONS:
            raise ValueError("Unknown action.")
        path = await self._device_path(address)
        address = address.upper()
        device = (await self._obj(path)).get_interface(DEVICE_IFACE)
        if action in ("trust", "untrust"):
            await self._set(path, DEVICE_IFACE, "Trusted", "b", action == "trust")
        elif action == "forget":
            self._decide(False)
            adapter = (await self._obj(self._adapter_path)).get_interface(ADAPTER_IFACE)
            await adapter.call_remove_device(path)
        else:
            self._spawn(self._run(address, action, device, path))
        await self.refresh()

    async def _run(self, address: str, action: str, device: Any, path: str) -> None:
        """Pair, connect or disconnect in the background; these can take many
        seconds, and the web app shows the step as it happens."""
        verb = {"pair": "pairing", "connect": "connecting", "disconnect": "disconnecting"}[action]
        self.state.working[address] = verb
        self.state.error = None
        await self.refresh()
        try:
            if action == "pair":
                await asyncio.wait_for(device.call_pair(), timeout=90)
                await self._set(path, DEVICE_IFACE, "Trusted", "b", True)
            elif action == "connect":
                await asyncio.wait_for(device.call_connect(), timeout=30)
            else:
                await asyncio.wait_for(device.call_disconnect(), timeout=15)
        except Exception as e:
            log.info("Bluetooth %s %s failed: %s", action, address, e)
            self.state.error = {"address": address, "message": friendly(e), "at": time.time()}
        finally:
            self.state.working.pop(address, None)
            try:
                await self.refresh()
            except Exception:
                pass

    # --- Pairing agent: the passkey comparison goes to the Sage UI ---

    def _decide(self, accept: bool) -> bool:
        if self._decision and not self._decision.done():
            self._decision.set_result(accept)
            return True
        return False

    async def confirm(self, accept: bool) -> bool:
        done = self._decide(accept)
        await self.refresh()
        return done

    def window_open(self) -> bool:
        return self.state.pairing_until > time.time() or any(v == "pairing" for v in self.state.working.values())

    async def _ask(self, device_path: str, passkey: Optional[int]) -> bool:
        if not self.window_open():
            log.info("Rejected a pairing request outside the pairing window.")
            return False
        objects = await self.objects()
        ifaces = objects.get(device_path, {})
        address = prop(ifaces, DEVICE_IFACE, "Address", "")
        name = prop(ifaces, DEVICE_IFACE, "Alias") or prop(ifaces, DEVICE_IFACE, "Name") or address
        self._decide(False)
        self._decision = asyncio.get_event_loop().create_future()
        self.state.pending = {
            "address": address, "name": name,
            "passkey": f"{passkey:06d}" if passkey is not None else "",
            "expires": time.time() + CONFIRM_SECONDS,
        }
        await self.refresh()
        try:
            return await asyncio.wait_for(asyncio.shield(self._decision), timeout=CONFIRM_SECONDS)
        except asyncio.TimeoutError:
            return False
        finally:
            self.state.pending = None
            await self.refresh()

    async def register_agent(self) -> None:
        from dbus_next.service import ServiceInterface, method
        from dbus_next.errors import DBusError
        control = self

        def reject(text: str = "Pairing was declined"):
            return DBusError("org.bluez.Error.Rejected", text)

        class Agent(ServiceInterface):
            def __init__(self):
                super().__init__("org.bluez.Agent1")

            @method()
            def Release(self):  # noqa: N802 - BlueZ's names
                pass

            @method()
            async def RequestConfirmation(self, device: "o", passkey: "u"):  # noqa: F821,N802
                if not await control._ask(device, passkey):
                    raise reject()

            @method()
            async def RequestAuthorization(self, device: "o"):  # noqa: F821,N802
                if not await control._ask(device, None):
                    raise reject()

            @method()
            async def AuthorizeService(self, device: "o", uuid: "s"):  # noqa: F821,N802
                ifaces = (await control.objects()).get(device, {})
                if not prop(ifaces, DEVICE_IFACE, "Trusted", False) and not control.window_open():
                    raise reject("Service not allowed")

            @method()
            def RequestPinCode(self, device: "o") -> "s":  # noqa: F821,N802
                raise reject("PIN pairing is not supported")

            @method()
            def RequestPasskey(self, device: "o") -> "u":  # noqa: F821,N802
                raise reject("Passkey entry is not supported")

            @method()
            def DisplayPasskey(self, device: "o", passkey: "u", entered: "q"):  # noqa: F821,N802
                pass

            @method()
            def DisplayPinCode(self, device: "o", pincode: "s"):  # noqa: F821,N802
                pass

            @method()
            def Cancel(self):  # noqa: N802
                control._decide(False)

        self.bus.export(AGENT_PATH, Agent())
        manager = (await self._obj("/org/bluez")).get_interface("org.bluez.AgentManager1")
        await manager.call_register_agent(AGENT_PATH, "DisplayYesNo")
        await manager.call_request_default_agent(AGENT_PATH)
        log.info("Bluetooth pairing agent registered.")
