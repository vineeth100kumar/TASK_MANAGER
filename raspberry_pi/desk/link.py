"""
link.py - the desk clock's websocket.

Sage itself only listens on the Pi's loopback address, so the clock gets a
port of its own on the Wi-Fi (8765, the one LUMO always used). That port
serves the clock and nothing else: the first frame has to be

    {"evt": "HELLO", "token": "<6 digits>", "fw": "1.6.0"}

and anything else closes the connection. After that the clock sends READY
when it wants a full redraw and BTN for each press; the Pi sends the JSON
commands the firmware already draws (CLOCK, SCREEN, NOTIF, ...). Firmware 2.7
also reports how it is doing every 30 seconds:

    {"evt": "STATUS", "ip": "192.168.1.40", "rssi": -58, "uptime": 3600, "heap": 81234, "ssid": "Home"}

Keeping the link up (firmware 2.10): both ends ping every 10 seconds and give
up on a link that stays quiet, so a Pi restart or a Wi-Fi drop is noticed in
seconds rather than never. The clock's HELLO then says why it last lost the
Pi ("drop"), how often it has reconnected since it started ("reconnects"),
why it last restarted ("boot") and what it did on its own while it was cut
off ("offline": alarms it stopped or snoozed, a timer it stopped), which is
settled before the clock is redrawn so nothing rings twice. Each connect and
drop is kept in a short history (`history`) for the LUMO page and the health
check.

The token is made on first start and kept in Sage's data folder. It is shown
in Sage's settings and typed into the clock's secrets.h once.
"""

import asyncio
import hmac
import json
import logging
import os
import secrets
import time
from collections import deque
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger("desk.link")

BIND = os.getenv("SAGE_DESK_BIND", "0.0.0.0")
PORT = int(os.getenv("SAGE_DESK_PORT", "8765"))
DATA_DIR = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent
TOKEN_FILE = Path(os.getenv("SAGE_DESK_TOKEN_FILE", str(DATA_DIR / "desk_token.txt")))
HELLO_TIMEOUT = 10
# Close code for a clock that did not say hello with the right token.
NOT_PAIRED = 4401
# Pings: a clock that doesn't answer one within PING_TIMEOUT is gone.
PING_INTERVAL = 10
PING_TIMEOUT = 10
# How many connects and drops are kept, and how many drops in a day make a
# link "flaky" on the LUMO page.
HISTORY = 40
FLAKY_DROPS = 3
DAY = 24 * 3600

Ready = Callable[[], Awaitable[None]]
Button = Callable[[str], Awaitable[None]]
Offline = Callable[[list], Awaitable[None]]


def load_token(path: Optional[Path] = None) -> str:
    """The clock's pairing token, made on first use. Six digits, because it
    is typed into secrets.h by hand."""
    path = path or TOKEN_FILE
    try:
        token = path.read_text(encoding="utf-8").strip()
        if token:
            return token
    except OSError:
        pass
    token = f"{secrets.randbelow(1_000_000):06d}"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token + "\n", encoding="utf-8")
        os.chmod(path, 0o600)
    except OSError as e:
        log.warning("Could not save the desk clock token to %s: %s", path, e)
    return token


def _parse(raw: Any) -> Optional[dict]:
    if not isinstance(raw, str):
        return None  # the clock sends nothing binary
    try:
        msg = json.loads(raw)
    except ValueError:
        return None
    return msg if isinstance(msg, dict) else None


class ClockLink:
    """One clock at a time. A new clock that pairs replaces the old one."""

    def __init__(self, token: str) -> None:
        self.token = token
        self.socket: Any = None
        self.fw = ""
        self.address = ""
        self.connected_at = 0.0
        self.info: dict = {}          # the clock's last STATUS
        self.last_seen = 0.0
        self.on_ready: Optional[Ready] = None
        self.on_button: Optional[Button] = None
        self.on_depth_need: Optional[Ready] = None   # the clock opened the depth face (2.9)
        self.on_offline: Optional[Offline] = None    # what the clock did while cut off (2.10)
        self.on_connect: Optional[Ready] = None      # just paired, before the redraw (desk/ota.py)
        # Firmware 2.13 takes updates over Wi-Fi; its HELLO says so ("ota"), and
        # why the last one failed ("otaError"). local_ip is the Pi's address as
        # the clock reached it, which the clock can fetch the update from.
        self.can_ota = False
        self.ota_error = ""
        self.local_ip = ""
        # The link's story: connects and drops, newest last, and when it went down.
        self.history: deque = deque(maxlen=HISTORY)
        self.drop_times: deque = deque(maxlen=200)
        self.down_since = time.time()
        self.clock_said: dict = {}    # the clock's own view from its HELLO: drop, reconnects, boot
        self._send_lock = asyncio.Lock()
        self._serving: Optional[asyncio.Future] = None

    @property
    def connected(self) -> bool:
        return self.socket is not None

    def status(self) -> dict:
        return {
            "connected": self.connected,
            "firmware": self.fw or None,
            "address": self.address or None,
            "connectedAt": int(self.connected_at * 1000) if self.connected else None,
            "lastSeen": int(self.last_seen * 1000) if self.last_seen else None,
            "wifi": dict(self.info) if self.info else None,
            "link": self.health(),
        }

    def _note(self, event: str, detail: str = "") -> None:
        self.history.append({"at": int(time.time() * 1000), "event": event, "detail": detail})

    def health(self, now: Optional[float] = None) -> dict:
        """How steady the link is: for the LUMO page and the health check."""
        now = now or time.time()
        drops = sum(1 for t in self.drop_times if now - t < DAY)
        last_drop = next((h for h in reversed(self.history) if h["event"] == "dropped"), None)
        state = "down" if not self.connected else "flaky" if drops >= FLAKY_DROPS else "steady"
        return {
            "state": state,
            "since": int((self.connected_at if self.connected else self.down_since) * 1000),
            "drops24h": drops,
            "lastDrop": last_drop,
            "quietSeconds": int(now - self.last_seen) if self.connected and self.last_seen else None,
            "rtt": self.info.get("rtt"),
            "clockReconnects": self.clock_said.get("reconnects"),
            "clockLastDrop": self.clock_said.get("drop") or None,
            "lastBoot": self.clock_said.get("boot") or None,
            "history": list(reversed(self.history))[:12],
        }

    def _dropped(self, socket: Any, error: Optional[BaseException]) -> None:
        reason = self._why(socket, error)
        self.drop_times.append(time.time())
        self.down_since = time.time()
        self._note("dropped", reason)
        log.info("Desk clock disconnected: %s", reason)

    @staticmethod
    def _why(socket: Any, error: Optional[BaseException]) -> str:
        code = getattr(socket, "close_code", None)
        reason = getattr(socket, "close_reason", "") or ""
        text = f"{error or ''} {reason}".lower()
        if "keepalive" in text or "ping timeout" in text:
            return "the clock stopped answering pings"
        if code == 1002:
            # Firmware before 2.12: its websocket library lost its place when
            # Wi-Fi split a frame, which a burst after connecting always did.
            return "the clock's firmware misread the data (protocol error; update to 2.12)"
        if code in (None, 1006):
            return "the connection broke without a goodbye (Wi-Fi or power)"
        if code in (1000, 1001):
            return "the clock closed it" + (f" ({reason})" if reason else "")
        return f"closed with code {code}" + (f" ({reason})" if reason else "")

    def token_matches(self, candidate: Any) -> bool:
        return isinstance(candidate, str) and hmac.compare_digest(candidate.encode(), self.token.encode())

    async def send(self, command: dict) -> bool:
        """Send one command to the clock. False when no clock is there."""
        socket = self.socket
        if socket is None:
            return False
        try:
            async with self._send_lock:
                await socket.send(json.dumps(command))
            return True
        except Exception as e:
            if self.socket is socket:
                self.socket = None
                self._dropped(socket, e)
            return False

    async def send_binary(self, data: bytes) -> bool:
        socket = self.socket
        if socket is None:
            return False
        try:
            async with self._send_lock:
                await socket.send(data)
            return True
        except Exception as e:
            if self.socket is socket:
                self.socket = None
                self._dropped(socket, e)
            return False

    async def handle(self, socket: Any, *_legacy_path: Any) -> None:
        """One clock connection, from hello to hang-up."""
        try:
            first = _parse(await asyncio.wait_for(socket.recv(), timeout=HELLO_TIMEOUT))
        except Exception:
            first = None
        if not (first and first.get("evt") == "HELLO" and self.token_matches(first.get("token"))):
            log.warning("Refused a desk clock that did not pair (wrong or missing token)")
            try:
                await socket.send(json.dumps({"cmd": "PAIRED", "ok": False}))
                await socket.close(NOT_PAIRED, "not paired")
            except Exception:
                pass
            return

        previous = self.socket
        self.socket = socket
        self.fw = str(first.get("fw") or "")
        self.clock_said = {k: first[k] for k in ("drop", "reconnects", "boot")
                           if isinstance(first.get(k), (int, str)) and not isinstance(first.get(k), bool)}
        self.can_ota = bool(first.get("ota"))
        self.ota_error = str(first.get("otaError") or "")[:80]
        remote = getattr(socket, "remote_address", None)
        self.address = str(remote[0]) if isinstance(remote, tuple) and remote else ""
        local = getattr(socket, "local_address", None)
        self.local_ip = str(local[0]) if isinstance(local, tuple) and local else ""
        self.connected_at = self.last_seen = time.time()
        self.info = {}
        if previous is not None and previous is not socket:
            # The Pi still held the old connection: it had died quietly.
            self.drop_times.append(time.time())
            self._note("dropped", "the clock came back on a new connection before the old one timed out")
            try:
                await previous.close(1000, "replaced")
            except Exception:
                pass
        detail = f"firmware {self.fw or 'unknown'}"
        if self.clock_said.get("drop"):
            detail += f"; the clock says it lost the Pi: {self.clock_said['drop']}"
        if self.clock_said.get("boot"):
            detail += f"; last restart: {self.clock_said['boot']}"
        self._note("connected", detail)
        log.info("Desk clock paired (%s, %s)", detail, self.address or "unknown address")
        await self.send({"cmd": "PAIRED", "ok": True})
        # What it did on its own comes first, so the redraw doesn't ring a
        # stopped alarm again.
        offline = first.get("offline")
        if isinstance(offline, list) and offline and self.on_offline:
            await self._call(self.on_offline, [r for r in offline if isinstance(r, dict)][:8])
        if self.on_connect:
            await self._call(self.on_connect)
        if self.on_ready:
            await self._call(self.on_ready)

        error: Optional[BaseException] = None
        try:
            async for raw in socket:
                msg = _parse(raw)
                if not msg:
                    continue
                self.last_seen = time.time()
                evt = msg.get("evt")
                if evt == "READY":
                    self.fw = str(msg.get("fw") or self.fw)
                    if self.on_ready:
                        await self._call(self.on_ready)
                elif evt == "STATUS":
                    self.info = {k: msg[k] for k in ("ip", "rssi", "uptime", "heap", "ssid", "rtt", "wifiDrops")
                                 if isinstance(msg.get(k), (int, float, str)) and not isinstance(msg.get(k), bool)}
                elif evt == "OFFLINE" and self.on_offline:
                    # Something it did alone while it still thought it was cut off.
                    await self._call(self.on_offline, [msg])
                elif evt == "BTN" and self.on_button:
                    await self._call(self.on_button, str(msg.get("btn") or ""))
                elif evt == "DEPTH_NEED" and self.on_depth_need:
                    await self._call(self.on_depth_need)
        except Exception as e:
            error = e
        finally:
            if self.socket is socket:
                self.socket = None
                self._dropped(socket, error)

    @staticmethod
    async def _call(callback: Callable[..., Awaitable[None]], *args: Any) -> None:
        # A bug in one screen must not drop the clock's connection.
        try:
            await callback(*args)
        except Exception:
            log.exception("Desk clock handler failed")

    async def serve(self, host: str = BIND, port: int = PORT) -> None:
        """Listen for the clock until cancelled."""
        try:
            from websockets.asyncio.server import serve
        except ImportError:  # websockets older than 13
            from websockets import serve  # type: ignore
        async with serve(self.handle, host, port, ping_interval=PING_INTERVAL, ping_timeout=PING_TIMEOUT):
            log.info("Desk clock link listening on %s:%s", host, port)
            # Held on self: a future only this coroutine knows about lets the
            # garbage collector destroy the whole task, closing the port.
            self._serving = asyncio.get_running_loop().create_future()
            await self._serving
