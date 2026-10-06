"""
controller.py - what the desk clock shows, and what each button means.

The clock has one five-way button (UP, DOWN, LEFT, OK, RIGHT) and no idea what
it is showing beyond the last command it got. So the meaning of a press is
decided here, from what the Pi last put on the screen:

- A card with actions (a reminder, say) is showing: LEFT, OK and RIGHT do what
  the labels under the card say, for example Tomorrow, Done and Snooze.
- Otherwise UP and DOWN step through the screens.

The clock free-runs its seconds between CLOCK messages, so one a minute, on
the minute, keeps it exact.
"""

import asyncio
import datetime
import logging
import time
from typing import Awaitable, Callable, Dict, List, Optional, Tuple

log = logging.getLogger("desk.controller")

Action = Callable[[], Awaitable[None]]
# The firmware's buffer sizes for a NOTIF card in bytes, less the terminating 0.
APP_LEN, TITLE_LEN, BODY_LEN = 19, 27, 63
# An unanswered card stops claiming the buttons after this long.
CARD_SECONDS = 120
ACTION_BUTTONS = ("LEFT", "OK", "RIGHT")


def fit(text: str, limit: int) -> str:
    """Cut to the firmware's buffer, counted in bytes as the ESP32 counts
    them, without splitting a character in two."""
    return (text or "").encode()[:limit].decode(errors="ignore").rstrip()


class Card:
    def __init__(self, actions: Dict[str, Tuple[str, Action]], expires_at: float) -> None:
        self.actions = actions
        self.expires_at = expires_at


class DeskController:
    def __init__(
        self,
        link,
        now: Callable[[], datetime.datetime],
        next_alarm: Callable[[], Optional[Tuple[int, int]]] = lambda: None,
        screens: Optional[List[str]] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.link = link
        self.now = now
        self.next_alarm = next_alarm
        self.screens = screens or ["FACE", "CLOCK"]
        self.screen = self.screens[0]
        self.card: Optional[Card] = None
        self._clock = clock
        link.on_ready = self.redraw
        link.on_button = self.on_button

    # --- Drawing ---

    async def send_clock(self) -> None:
        now = self.now()
        command = {
            "cmd": "CLOCK",
            "h": now.hour,
            "m": now.minute,
            "s": now.second,
            "ms": now.microsecond // 1000,
            "weekday": now.strftime("%a"),
            "date": now.strftime("%d %b"),
        }
        alarm = self.next_alarm()
        if alarm:
            command["alarm_h"], command["alarm_m"] = alarm
        await self.link.send(command)

    async def redraw(self) -> None:
        """Everything the clock needs after it (re)connects."""
        await self.send_clock()
        await self.link.send({"cmd": "SCREEN", "mode": self.screen})
        await self.link.send({"cmd": "LIGHTS", "mode": "AUTO", "brightness": 40, "hue": 0})

    async def show_screen(self, screen: str) -> None:
        if screen not in self.screens:
            raise ValueError(f"Unknown screen {screen!r}")
        self.screen = screen
        await self.link.send({"cmd": "SCREEN", "mode": screen})

    async def show_card(
        self,
        app: str,
        title: str,
        body: str = "",
        actions: Optional[Dict[str, Tuple[str, Action]]] = None,
        seconds: int = CARD_SECONDS,
    ) -> None:
        """A notification card. With actions, LEFT/OK/RIGHT run them until one
        is pressed or the card times out; their labels show under the card."""
        actions = {b: a for b, a in (actions or {}).items() if b in ACTION_BUTTONS}
        await self.link.send({
            "cmd": "NOTIF",
            "app": fit(app or "Sage", APP_LEN),
            "title": fit(title, TITLE_LEN),
            "body": fit(body, BODY_LEN),
        })
        if actions:
            self.card = Card(actions, self._clock() + seconds)
            await self.link.send({"cmd": "ACTIONS", **{b.lower(): label for b, (label, _) in actions.items()}})
        elif self.card:
            await self.clear_card()

    async def clear_card(self) -> None:
        self.card = None
        await self.link.send({"cmd": "ACTIONS"})

    # --- Buttons ---

    async def on_button(self, button: str) -> None:
        button = button.upper()
        if self.card and self._clock() >= self.card.expires_at:
            await self.clear_card()
        if self.card:
            chosen = self.card.actions.get(button)
            if chosen:
                await self.clear_card()
                await chosen[1]()
                return
            if button in ACTION_BUTTONS:
                return  # a button with no action on this card does nothing
        if button in ("UP", "DOWN"):
            step = 1 if button == "DOWN" else -1
            i = self.screens.index(self.screen) if self.screen in self.screens else 0
            await self.show_screen(self.screens[(i + step) % len(self.screens)])

    # --- Running ---

    async def tick_forever(self) -> None:
        """A CLOCK message on every minute boundary."""
        while True:
            now = self.now()
            await asyncio.sleep(60 - now.second - now.microsecond / 1_000_000 + 0.05)
            try:
                await self.send_clock()
            except Exception:
                log.exception("Desk clock tick failed")
