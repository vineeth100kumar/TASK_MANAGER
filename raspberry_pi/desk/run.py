"""Starting the desk clock from Sage's server (see db_server.py's startup)."""

import asyncio
import datetime
import logging
from typing import Callable, Optional

from desk.controller import DeskController
from desk.link import ClockLink, load_token

log = logging.getLogger("desk")

link: Optional[ClockLink] = None
controller: Optional[DeskController] = None


async def run(now: Callable[[], datetime.datetime]) -> None:
    global link, controller
    link = ClockLink(load_token())
    controller = DeskController(link, now)
    ticker = asyncio.create_task(controller.tick_forever())
    try:
        await link.serve()
    except OSError as e:
        # Most likely LUMO's old server still holds the port.
        log.error("Desk clock link could not start: %s", e)
    finally:
        ticker.cancel()


def status(enabled: bool) -> dict:
    """What Sage's settings show about the clock. The token is only ever
    served behind Sage's key or login, like every other /api route."""
    from desk.link import PORT
    base = {"enabled": enabled, "port": PORT}
    if link is None:
        return {**base, "connected": False, "token": load_token() if enabled else None}
    return {**base, **link.status(), "token": link.token}
