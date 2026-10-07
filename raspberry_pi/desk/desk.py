"""
desk.py - everything the desk clock does, run inside Sage's server.

The clock only draws and reports button presses; this decides what it shows:

- The time and the next alarm, and the Today list on its Tasks screen, kept
  current as items change anywhere (every /ws event reaches on_event).
- Alarms (Sage reminders labelled "alarm", see alarms.py) ring on the second.
  While one rings, RIGHT snoozes it five minutes and any other button stops it.
- Reminders you get while you're home appear as a card on the face with
  Tomorrow, Done and Snooze under LEFT, OK and RIGHT. Away from home they go
  to the phone as before (Sage's notifier asks clock_reminder first).
- The phone's notifications appear as cards, and what it's playing shows on
  the now-playing screen with its cover, where LEFT, OK and RIGHT are
  previous, play/pause and next.
- Weather, the Pi's vitals, and a face whose mood follows the hour and the music.
"""

import asyncio
import datetime
import logging
import random
from typing import Any, Awaitable, Callable, List, Optional, Set

import item_actions
import notifier
from desk import ambient, art, today
from desk.alarms import Alarms, is_alarm
from desk.controller import DeskController

log = logging.getLogger("desk")

SCREENS = ["FACE", "CLOCK", "TASKS", "SPOTIFY", "SYSTEM"]
SOURCE = "desk"
EYE_COLOR = {"cmd": "EYE_COLOR", "name": "cyan", "rgb565": 0x073F}
WEATHER_EVERY = 30 * 60
REFRESH_EVERY = 60
# An alarm nobody answers stops after this long and is set for tomorrow.
RING_SECONDS = 10 * 60
REMINDER_SNOOZE_MINUTES = 60
MEDIA_BUTTONS = {"LEFT": "previous", "OK": "toggle", "RIGHT": "next"}


class Desk:
    def __init__(
        self,
        link,
        now: Callable[[], datetime.datetime],
        phone,
        broadcast: Callable[[dict], Awaitable[None]],
        items: Callable[[], List[dict]] = notifier.open_items,
        actions=item_actions,
        weather: Callable[[], Awaitable[Optional[dict]]] = ambient.fetch_weather,
        cover: Callable[[str, str], Awaitable[Optional[bytes]]] = art.cover,
        vitals: Optional[ambient.Vitals] = None,
        rng: Optional[random.Random] = None,
    ) -> None:
        self.link = link
        self.now = now
        self.phone = phone
        self.broadcast = broadcast
        self.items = items
        self.actions = actions
        self.fetch_weather = weather
        self.fetch_cover = cover
        self.vitals = vitals or ambient.Vitals()
        self.rng = rng or random.Random()

        self.controller = DeskController(link, now, next_alarm=self.next_alarm, screens=SCREENS)
        self.controller.before_button = self.before_button
        self.controller.other_button = self.other_button
        self.controller.after_redraw = self.after_redraw
        self.controller.on_screen = self.on_screen

        self.alarms = Alarms(now().tzinfo)
        self.ringing_since = 0.0
        self.today: List[str] = []
        self.weather: Optional[dict] = None
        self.mood = "NORMAL"
        self.schedule = ""
        self.track: Optional[tuple] = None
        self.cover: Optional[bytes] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._refresh_soon = False
        self._tasks: Set[asyncio.Task] = set()

    # --- Sage's items ---

    def next_alarm(self):
        alarm = self.alarms.next(self.now())
        return (alarm.h, alarm.m) if alarm else None

    async def refresh(self) -> None:
        """Re-read the items: the Today list, the alarms, and the alarm on the face."""
        items = await asyncio.to_thread(self.items)
        now = self.now()
        self.alarms.tz = now.tzinfo
        before = self.next_alarm()
        self.alarms.load(items)
        missed = self.alarms.missed(now)
        for alarm in missed:
            log.info("Alarm %s was missed; setting it for next time", alarm.id)
            await self.change(self.actions.set_fields, alarm.id, Alarms.rolled(alarm, now), SOURCE)
        if missed:
            self.alarms.load(await asyncio.to_thread(self.items))
        lines = today.lines(items, now, now.tzinfo)
        if lines != self.today:
            self.today = lines
            await self.link.send({"cmd": "SHOW_TASKS", "items": lines})
        if self.next_alarm() != before:
            await self.controller.send_clock()

    async def change(self, action, item_id: str, *args) -> bool:
        """Run an item_actions change off the event loop and announce it."""
        result = await asyncio.to_thread(action, item_id, *args)
        if not result:
            return False
        await self.broadcast(item_actions.change_event(result[1], item_id, SOURCE))
        return True

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def on_event(self, event: dict) -> None:
        """Every event Sage sends its web clients (EventHub.listeners)."""
        kind = event.get("type")
        if kind in ("SYNC_APPLIED", "SYNC_CLEARED"):
            if not self._refresh_soon:
                self._refresh_soon = True
                self._spawn(self._refresh_after_burst())
        elif kind == "PHONE_NOTIFICATION":
            self._spawn(self.show_notification(event.get("notification") or {}))
        elif kind == "PHONE_MEDIA":
            self._spawn(self.show_media(event.get("media") or {}))

    async def _refresh_after_burst(self) -> None:
        await asyncio.sleep(0.5)  # a sync batch can send several events at once
        self._refresh_soon = False
        await self._guard(self.refresh())

    # --- Reminders and notifications ---

    def clock_reminder(self, item: dict, message: dict) -> bool:
        """notifier.clock_reminder, called from the notifier's worker thread.
        True means the clock has it and the phone needn't be told."""
        if self.loop is None or not self.link.connected:
            return False
        if is_alarm(item):
            return True  # rung by alarm_loop, on the second
        if self.phone.available and not self.phone.home:
            return False  # you're out: the phone gets it
        asyncio.run_coroutine_threadsafe(self._guard(self.show_reminder(item, message)), self.loop)
        # Without the phone link there's no telling if you're home, so the
        # phone gets it too.
        return bool(self.phone.available)

    async def show_reminder(self, item: dict, message: dict) -> None:
        item_id = item.get("id", "")
        today_date = self.now().date()

        def act(*args):
            return lambda: self._guard(self.change(*args))

        await self.controller.show_screen("FACE")
        await self.link.send({"cmd": "HAPTIC", "ms": 300})
        await self.controller.show_card("Reminder", message.get("title") or item.get("title") or "", message.get("body") or "", {
            "LEFT": ("Tomorrow", act(self.actions.move_to_tomorrow, item_id, SOURCE, today_date)),
            "OK": ("Done", act(self.actions.mark_done, item_id, SOURCE)),
            "RIGHT": ("Snooze", act(self.actions.snooze, item_id, SOURCE, REMINDER_SNOOZE_MINUTES)),
        })

    async def show_notification(self, note: dict) -> None:
        # A reminder waiting for an answer, or a ringing alarm, comes first.
        if self.controller.card or self.alarms.ringing or not self.link.connected:
            return
        if self.controller.screen != "FACE":
            await self.controller.show_screen("FACE")
        await self.controller.show_card(note.get("app") or "iPhone", note.get("title") or "", note.get("message") or "")

    async def show_media(self, media: dict) -> None:
        track = (media.get("title") or "", media.get("artist") or "")
        await self.link.send({
            "cmd": "SPOTIFY", "title": track[0], "artist": track[1],
            "progress_ms": 0, "duration_ms": 0, "playing": bool(media.get("playing")),
        })
        if track != self.track and track[0]:
            self.track = track
            self.cover = await self.fetch_cover(*track)
            if self.cover and self.track == track:
                await self.link.send_binary(self.cover)
        await self.set_mood("HAPPY" if media.get("playing") else "NORMAL")

    # --- Alarms ---

    async def ring(self) -> None:
        now = self.now()
        alarm = self.alarms.ringing
        if alarm is None:
            alarm = self.alarms.due(now)
            if alarm is None:
                return
            log.info("Alarm ringing: %02d:%02d %s", alarm.h, alarm.m, alarm.title)
            self.ringing_since = now.timestamp()
            await self.controller.clear_card()
            await self.link.send({"cmd": "ALARM_RING"})
        elif now.timestamp() - self.ringing_since > RING_SECONDS:
            await self.stop_alarm(snooze=False)

    async def stop_alarm(self, snooze: bool) -> None:
        alarm, self.alarms.ringing = self.alarms.ringing, None
        await self.link.send({"cmd": "ALARM_OFF"})
        if alarm is None:
            return
        now = self.now()
        fields = Alarms.snoozed(now) if snooze else Alarms.rolled(alarm, now)
        await self.change(self.actions.set_fields, alarm.id, fields, SOURCE)
        if not snooze:
            await self.set_mood("HAPPY")

    # --- Buttons and screens ---

    async def before_button(self, button: str) -> bool:
        if not self.alarms.ringing:
            return False
        await self.stop_alarm(snooze=button == "RIGHT")
        return True

    async def other_button(self, button: str) -> None:
        if self.controller.screen == "SPOTIFY" and button in MEDIA_BUTTONS:
            await self.phone.send_command(MEDIA_BUTTONS[button])

    async def on_screen(self, screen: str) -> None:
        if screen == "SYSTEM":
            await self.link.send(self.vitals.command())

    async def after_redraw(self) -> None:
        """The rest of what a freshly connected clock needs."""
        await self.link.send(EYE_COLOR)
        await self.link.send({"cmd": "SHOW_TASKS", "items": self.today})
        self.schedule = ""
        await self.set_mood(self.mood)
        if self.weather:
            await self.link.send(self.weather)
        if self.track:
            await self.show_media(self.phone.media)
            if self.cover:
                await self.link.send_binary(self.cover)
        if self.alarms.ringing:
            await self.link.send({"cmd": "ALARM_RING"})

    async def set_mood(self, mood: str) -> None:
        schedule = ambient.schedule_for(self.now().hour)
        if (mood, schedule) != (self.mood, self.schedule):
            self.mood, self.schedule = mood, schedule
            await self.link.send({"cmd": "EMOTION", "mood": mood, "schedule": schedule})

    # --- Running ---

    async def _guard(self, coro) -> Any:
        try:
            return await coro
        except Exception:
            log.exception("Desk clock job failed")

    async def _every(self, seconds: float, job: Callable[[], Awaitable[None]]) -> None:
        while True:
            await self._guard(job())
            await asyncio.sleep(seconds)

    async def update_weather(self) -> None:
        weather = await self.fetch_weather()
        if weather and weather != self.weather:
            self.weather = weather
            await self.link.send(weather)

    async def ambient(self) -> None:
        """Every two seconds: the face's mood for the hour, the vitals while
        they're on screen, and a small movement while the face is idle."""
        if not self.link.connected:
            return
        await self.set_mood(self.mood)
        screen = self.controller.screen
        if screen == "SYSTEM":
            await self.link.send(self.vitals.command())
        elif screen == "FACE" and not self.controller.card and not self.alarms.ringing:
            move = ambient.idle_animation(self.rng, bool(self.phone.media.get("playing")))
            if move:
                await self.link.send(move)

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        await asyncio.gather(
            self.controller.tick_forever(),
            self._every(1, self.ring),
            self._every(REFRESH_EVERY, self.refresh),
            self._every(WEATHER_EVERY, self.update_weather),
            self._every(2, self.ambient),
        )
