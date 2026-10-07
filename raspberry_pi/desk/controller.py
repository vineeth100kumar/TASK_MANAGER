"""
controller.py - what the desk clock shows, and what each button means.

The clock has one five-way button (UP, DOWN, LEFT, OK, RIGHT) and no idea what
it is showing beyond the last command it got. So the meaning of a press is
decided here, from what the Pi last put on the screen:

- A card with actions (a reminder, say) is showing: LEFT, OK and RIGHT do what
  the labels under the card say, for example Tomorrow, Done and Snooze.
- Otherwise the press becomes an action: `action_for` names it (the desk
  reads it from the button map in desk/settings.py) and stepping between
  screens is done here, anything else by `other_action`. Without a map, UP
  and DOWN step through the screens.

The desk (desk/desk.py) can claim a press before any of that with
`before_button` (a ringing alarm takes every button, and a locked clock
ignores its own). Presses sent from Sage arrive with remote=True.

The clock free-runs its seconds between CLOCK messages, so one a minute, on
the minute, keeps it exact.
"""

import asyncio
import datetime
import logging
import time
import unicodedata
from typing import Awaitable, Callable, Dict, List, Optional, Tuple

log = logging.getLogger("desk.controller")

Action = Callable[[], Awaitable[None]]
# The firmware's buffer sizes for a NOTIF card in bytes, less the terminating 0.
APP_LEN, TITLE_LEN, BODY_LEN = 19, 27, 63
# An unanswered card stops claiming the buttons after this long.
CARD_SECONDS = 120
ACTION_BUTTONS = ("LEFT", "OK", "RIGHT")
# Every screen the firmware can be told to show, in or out of the UP/DOWN loop.
KNOWN_SCREENS = ("FACE", "CLOCK", "TASKS", "SPOTIFY", "SYSTEM")


# The clock's font only has ASCII, so the usual typographic marks are swapped
# for plain ones and accents are dropped ("café" shows as "cafe").
_PLAIN = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
                        "\u2013": "-", "\u2014": "-", "\u2026": "...", "\u00b7": "-"})


def fit(text: str, limit: int) -> str:
    """Plain ASCII on one line, cut to the firmware's buffer of `limit` bytes."""
    text = unicodedata.normalize("NFKD", (text or "").translate(_PLAIN))
    text = " ".join(text.encode("ascii", "ignore").decode().split())
    return text[:limit].rstrip()


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
        self.lights = {"mode": "AUTO", "brightness": 40}
        self.card: Optional[Card] = None
        self._clock = clock
        # Hooks the desk fills in; see the module docstring.
        self.before_button: Optional[Callable[[str, bool], Awaitable[bool]]] = None
        self.action_for: Optional[Callable[[str], str]] = None
        self.other_action: Optional[Callable[[str], Awaitable[None]]] = None
        self.clock_extra: Optional[Callable[[], dict]] = None
        self.after_redraw: Optional[Callable[[], Awaitable[None]]] = None
        self.on_screen: Optional[Callable[[str], Awaitable[None]]] = None
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
        if self.clock_extra:
            command.update(self.clock_extra())
        await self.link.send(command)

    async def redraw(self) -> None:
        """Everything the clock needs after it (re)connects."""
        await self.send_clock()
        await self.link.send({"cmd": "SCREEN", "mode": self.screen})
        await self.send_lights()
        self.card = None
        if self.after_redraw:
            await self.after_redraw()

    async def send_lights(self) -> None:
        await self.link.send({"cmd": "LIGHTS", "mode": self.lights["mode"], "brightness": self.lights["brightness"], "hue": 0})

    async def show_screen(self, screen: str) -> None:
        if screen not in KNOWN_SCREENS:
            raise ValueError(f"Unknown screen {screen!r}")
        self.screen = screen
        await self.link.send({"cmd": "SCREEN", "mode": screen})
        if self.on_screen:
            await self.on_screen(screen)

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

    async def on_button(self, button: str, remote: bool = False) -> None:
        button = button.upper()
        if self.before_button and await self.before_button(button, remote):
            return
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
        if self.action_for:
            action = self.action_for(button)
        else:
            action = {"UP": "prev_screen", "DOWN": "next_screen"}.get(button, "none")
        await self.run_action(action)

    async def run_action(self, action: str) -> None:
        if action in ("next_screen", "prev_screen"):
            step = 1 if action == "next_screen" else -1
            if self.screen in self.screens:
                i = (self.screens.index(self.screen) + step) % len(self.screens)
            else:
                i = 0  # off the loop (a card on the face): back to its start
            await self.show_screen(self.screens[i])
        elif action.startswith("screen:"):
            await self.show_screen(action.split(":", 1)[1])
        elif action != "none" and self.other_action:
            await self.other_action(action)

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
