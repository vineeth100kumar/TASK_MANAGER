"""Starting the desk clock from Sage's server (see db_server.py's startup)."""

import asyncio
import datetime
import logging
from typing import Callable, Optional

import notifier
from desk import settings as desk_settings
from desk.desk import Desk
from desk.link import ClockLink, load_token

log = logging.getLogger("desk")

link: Optional[ClockLink] = None
desk: Optional[Desk] = None


async def run(now: Callable[[], datetime.datetime], events, phone) -> None:
    """events is Sage's EventHub (its listeners and broadcast), phone the
    phone_link.link that knows whether you're home and what's playing."""
    global link, desk
    link = ClockLink(load_token())
    desk = Desk(link, now, phone, events.broadcast, settings=await asyncio.to_thread(desk_settings.load))
    events.listeners.append(desk.on_event)
    notifier.clock_reminder = desk.clock_reminder
    jobs = asyncio.create_task(desk.run())
    try:
        await link.serve()
    except OSError as e:
        # Most likely LUMO's old server still holds the port.
        log.error("Desk clock link could not start: %s", e)
    finally:
        notifier.clock_reminder = None
        jobs.cancel()


def status(enabled: bool) -> dict:
    """What Sage's settings show about the clock. The token is only ever
    served behind Sage's key or login, like every other /api route."""
    from desk.link import PORT
    base = {"enabled": enabled, "port": PORT}
    if link is None:
        return {**base, "connected": False, "token": load_token() if enabled else None}
    return {**base, **link.status(), "token": link.token}


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


async def press(button: str) -> bool:
    """Press one of the clock's buttons from Sage. False when the desk isn't running."""
    if desk is None:
        return False
    await desk.press(button)
    return True
