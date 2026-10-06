"""
link.py - the desk clock's websocket.

Sage itself only listens on the Pi's loopback address, so the clock gets a
port of its own on the Wi-Fi (8765, the one LUMO always used). That port
serves the clock and nothing else: the first frame has to be

    {"evt": "HELLO", "token": "<6 digits>", "fw": "1.6.0"}

and anything else closes the connection. After that the clock sends READY
when it wants a full redraw and BTN for each press; the Pi sends the JSON
commands the firmware already draws (CLOCK, SCREEN, NOTIF, ...).

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

Ready = Callable[[], Awaitable[None]]
Button = Callable[[str], Awaitable[None]]


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
        self.on_ready: Optional[Ready] = None
        self.on_button: Optional[Button] = None
        self._send_lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        return self.socket is not None

    def status(self) -> dict:
        return {
            "connected": self.connected,
            "firmware": self.fw or None,
            "address": self.address or None,
            "connectedAt": int(self.connected_at * 1000) if self.connected else None,
        }

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
            log.info("Lost the desk clock while sending: %s", e)
            if self.socket is socket:
                self.socket = None
            return False

    async def send_binary(self, data: bytes) -> bool:
        socket = self.socket
        if socket is None:
            return False
        try:
            async with self._send_lock:
                await socket.send(data)
            return True
        except Exception:
            if self.socket is socket:
                self.socket = None
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
        remote = getattr(socket, "remote_address", None)
        self.address = str(remote[0]) if isinstance(remote, tuple) and remote else ""
        self.connected_at = time.time()
        if previous is not None and previous is not socket:
            try:
                await previous.close(1000, "replaced")
            except Exception:
                pass
        log.info("Desk clock paired (firmware %s, %s)", self.fw or "unknown", self.address or "unknown address")
        await self.send({"cmd": "PAIRED", "ok": True})
        if self.on_ready:
            await self._call(self.on_ready)

        try:
            async for raw in socket:
                msg = _parse(raw)
                if not msg:
                    continue
                evt = msg.get("evt")
                if evt == "READY":
                    self.fw = str(msg.get("fw") or self.fw)
                    if self.on_ready:
                        await self._call(self.on_ready)
                elif evt == "BTN" and self.on_button:
                    await self._call(self.on_button, str(msg.get("btn") or ""))
        except Exception as e:
            log.info("Desk clock connection ended: %s", e)
        finally:
            if self.socket is socket:
                self.socket = None
                log.info("Desk clock disconnected")

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
        async with serve(self.handle, host, port, ping_interval=20, ping_timeout=20):
            log.info("Desk clock link listening on %s:%s", host, port)
            await asyncio.Future()
