"""Starting the desk clock from Sage's server (see db_server.py's startup)."""

import asyncio
import datetime
import logging
import re
from pathlib import Path
from typing import Callable, Optional

import notifier
from desk import settings as desk_settings
from desk.desk import Desk
from desk.link import ClockLink, load_token

log = logging.getLogger("desk")

BIND_RETRY = 5   # seconds between tries to open the clock's port

link: Optional[ClockLink] = None
desk: Optional[Desk] = None


async def run(now: Callable[[], datetime.datetime], events, phone) -> None:
    """events is Sage's EventHub (its listeners and broadcast), phone the
    phone_link.link that knows whether you're home and what's playing."""
    global link, desk
    link = ClockLink(load_token())
    desk = Desk(link, now, phone, events.broadcast, settings=await asyncio.to_thread(desk_settings.load), morning_line=_radar_line)
    events.listeners.append(desk.on_event)
    notifier.clock_reminder = desk.clock_reminder
    jobs = asyncio.create_task(desk.run())
    try:
        while True:
            try:
                await link.serve()
                break
            except OSError as e:
                # The port is still held (Sage restarting while the old one
                # lets go, or LUMO's old server): keep trying, so the clock
                # can always get back in.
                log.error("Desk clock link could not start: %s; trying again in %ss", e, BIND_RETRY)
                await asyncio.sleep(BIND_RETRY)
    finally:
        notifier.clock_reminder = None
        jobs.cancel()


def _radar_line():
    import radar
    try:
        return radar.lumo_line()
    except Exception as e:  # the clock's tasks matter more than Radar's line
        log.warning("Radar line skipped: %s", e)
        return None


# The firmware in this checkout: what the clock could be running after a flash.
FIRMWARE_CONFIG = Path(__file__).resolve().parents[2] / "lumo" / "esp32_client" / "config.h"


def latest_firmware(path: Path = FIRMWARE_CONFIG) -> Optional[str]:
    try:
        match = re.search(r'#define\s+FW_VERSION\s+"([^"]+)"', path.read_text(encoding="utf-8"))
    except OSError:
        return None
    return match.group(1) if match else None


def _version(text) -> tuple:
    try:
        return tuple(int(x) for x in str(text or "").split("."))
    except ValueError:
        return ()


def status(enabled: bool) -> dict:
    """What Sage's settings show about the clock. The token is only ever
    served behind Sage's key or login, like every other /api route."""
    from desk.link import PORT
    latest = latest_firmware()
    base = {"enabled": enabled, "port": PORT, "latestFirmware": latest}
    if link is None:
        return {**base, "connected": False, "token": load_token() if enabled else None, "updateAvailable": False, "state": None}
    running = link.fw
    return {
        **base, **link.status(), "token": link.token,
        "updateAvailable": bool(latest and running and _version(latest) > _version(running)),
        "state": desk.state() if desk is not None else None,
    }


async def save_settings(update: dict) -> dict:
    """Save a change from Sage's settings and apply it to a running clock.
    Raises ValueError, with a message for the person, if it doesn't check out."""
    saved = await asyncio.to_thread(desk_settings.save, update)
    if desk is not None:
        await desk.apply_settings(saved)
    return saved


async def reset_settings() -> dict:
    saved = await asyncio.to_thread(desk_settings.reset)
    if desk is not None:
        await desk.apply_settings(saved)
    return saved


async def depth_changed() -> None:
    """A new depth photo or setting from Sage: show it if the face is up."""
    if desk is not None:
        await desk.photo_changed()


def running() -> bool:
    return desk is not None


async def timer(action: str, seconds: int = 0, label: str = "") -> None:
    await desk.timer_do(action, seconds, label)


async def stopwatch(action: str) -> None:
    await desk.stopwatch_do(action)


async def ringing(action: str) -> bool:
    return await desk.ringing_do(action)


async def device(action: str, tone: str = "", volume: int = 0) -> bool:
    return await desk.device_do(action, tone, volume)


async def firmware(action: str) -> str:
    """check: look on GitHub for a newer build now. install: send the newest
    build to the clock now (even after failures). Returns "" or why not."""
    if action == "check":
        await desk.ota.check()
        await desk.announce()
        return desk.ota.check_error
    if action == "install":
        return await desk.ota.start(force=True)
    raise ValueError(f"Unknown firmware action {action!r}.")


async def press(button: str) -> bool:
    """Press one of the clock's buttons from Sage. False when the desk isn't running."""
    if desk is None:
        return False
    await desk.press(button)
    return True
