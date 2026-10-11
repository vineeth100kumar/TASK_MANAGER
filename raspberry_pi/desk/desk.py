"""
desk.py - everything the desk clock does, run inside Sage's server.

The clock only draws and reports button presses; this decides what it shows:

- The time and the next alarm, and the Today list on its Tasks screen, kept
  current as items change anywhere (every /ws event reaches on_event).
- Alarms (Sage reminders labelled "alarm", see alarms.py) ring on the second.
  While one rings, RIGHT snoozes it and any other button stops it (both can
  be changed in Sage, like every button: see desk/settings.py).
- Reminders you get while you're home appear as a card with Tomorrow, Done
  and Snooze under LEFT, OK and RIGHT. Away from home they go
  to the phone as before (Sage's notifier asks clock_reminder first).
- The phone's notifications appear as cards, and what it's playing shows on
  the now-playing screen with its cover, where LEFT, OK and RIGHT are
  previous, play/pause and next. Each song is looked up once (song.py): its
  genre, tempo and a few facts (SONG_INFO), and its lyrics, sent a line at
  a time as the song reaches them (LYRIC).
- Weather and the Pi's vitals.
- The next day's alarms go to the clock too (ALARMS), so firmware 2.0 can
  ring them itself while it can't reach the Pi.
- Settings changed in Sage (desk/settings.py) apply at once, and Sage can
  press the clock's buttons itself (press).
- The LUMO page in Sage runs a timer and a stopwatch here (tools.py) and
  shows them on the clock (firmware 2.7), keeps the World screen's places,
  dims everything at night, and can ring a tone, flash the clock to find it
  or restart it. Whatever it changes is announced as DESK_STATE, so an open
  page follows along.
"""

import asyncio
import datetime
import logging
import time
from typing import Any, Awaitable, Callable, List, Optional, Set

import item_actions
import notifier
from desk import ambient, art, settings as desk_settings, song, today
from desk.alarms import Alarms, is_alarm
from desk.tools import Stopwatch, Timer
from desk.controller import DeskController, fit

log = logging.getLogger("desk")

SOURCE = "desk"
WEATHER_EVERY = 30 * 60
REFRESH_EVERY = 60
REMINDER_SNOOZE_MINUTES = 60
MEDIA_ACTIONS = {"media_previous": "previous", "media_toggle": "toggle", "media_next": "next"}
NIGHT_EVERY = 20
WORLD_EVERY = 15 * 60
# Firmware that draws the timer, stopwatch and world screens, plays the alarm
# tones and takes the haptics and night settings.
TOOLS_FIRMWARE = (2, 7)


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
        song_about: Callable[[str, str], Awaitable[Optional[dict]]] = song.about,
        song_lyrics: Callable[..., Awaitable[list]] = song.lyrics,
        vitals: Optional[ambient.Vitals] = None,
        settings: Optional[dict] = None,
        morning_line: Callable[[], Optional[str]] = lambda: None,
    ) -> None:
        self.link = link
        self.now = now
        self.phone = phone
        self.broadcast = broadcast
        self.items = items
        self.actions = actions
        self.fetch_weather = weather
        self.fetch_cover = cover
        self.song_about = song_about
        self.song_lyrics = song_lyrics
        self.vitals = vitals or ambient.Vitals()
        self.morning_line = morning_line

        self.settings = settings or desk_settings.defaults()
        self.lights_off = False
        self.night = False
        self.timer = Timer()
        self.stopwatch = Stopwatch()
        self.sent_world: Optional[dict] = None
        self.controller = DeskController(link, now, next_alarm=self.next_alarm, screens=self.settings["screens"])
        self.controller.screen = self.settings["homeScreen"]
        self.controller.lights = self.lights()
        self.controller.before_button = self.before_button
        self.controller.action_for = self.action_for
        self.controller.other_action = self.other_action
        self.controller.clock_extra = self.clock_extra
        self.controller.after_redraw = self.after_redraw
        self.controller.on_screen = self.on_screen

        self.alarms = Alarms(now().tzinfo)
        self.ringing_since = 0.0
        self.today: List[str] = []
        self.weather: Optional[dict] = None
        self.sent_alarms: Optional[dict] = None
        self.track: Optional[tuple] = None
        self.cover: Optional[bytes] = None
        self.song_info: Optional[dict] = None   # the last SONG_INFO, for a clock that reconnects
        self.lyric_lines: list = []
        self.lyric: str = ""
        self.track_started = 0.0
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._refresh_soon = False
        self._tasks: Set[asyncio.Task] = set()

    # --- Sage's items ---

    @property
    def legacy(self) -> bool:
        """Firmware 1.x, which draws cards only on its face screen."""
        return str(getattr(self.link, "fw", "") or "").startswith("1.")

    def firmware_at_least(self, version: tuple) -> bool:
        try:
            major, minor = (int(x) for x in str(getattr(self.link, "fw", "") or "").split(".")[:2])
        except ValueError:
            return False
        return (major, minor) >= version

    def takes_cover_strips(self) -> bool:
        """Firmware 2.2 and later take the cover in strips. Older firmware
        restarts on a whole cover (see art.py), so it gets none."""
        return self.firmware_at_least((2, 2))

    @property
    def has_tools(self) -> bool:
        return self.firmware_at_least(TOOLS_FIRMWARE)

    async def send_cover(self) -> None:
        if not self.cover or len(self.cover) != art.FRAME_LEN or not self.takes_cover_strips():
            return
        for strip in art.strips(self.cover):
            if not await self.link.send_binary(strip):
                return

    async def _card_surface(self) -> None:
        if self.legacy and self.controller.screen != "FACE":
            await self.controller.show_screen("FACE")

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
        # Radar's line (one trend, one market move) in the morning, when it's
        # switched on in Settings > Radar and there's room under the tasks.
        if now.hour < 12 and len(lines) < today.MAX_ITEMS:
            extra = await asyncio.to_thread(self.morning_line)
            if extra:
                lines.append(fit(extra, today.LINE_LEN))
        if lines != self.today:
            self.today = lines
            await self.link.send({"cmd": "SHOW_TASKS", "items": lines})
        if self.next_alarm() != before:
            await self.controller.send_clock()
        await self.send_alarms()

    async def send_alarms(self, force: bool = False) -> None:
        """The alarms due in the next day, for the clock to ring on its own
        if it loses the Pi. Sent when they change."""
        upcoming = [{"h": a.rings_at.hour, "m": a.rings_at.minute} for a in self.alarms.upcoming(self.now())]
        command = {"cmd": "ALARMS", "list": upcoming, "snooze": self.settings["alarm"]["snoozeMinutes"]}
        if force or command != self.sent_alarms:
            if await self.link.send(command):
                self.sent_alarms = command

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
        if kind == "DESK_STATE":
            return  # our own news, for the web page
        if kind in ("SYNC_APPLIED", "SYNC_CLEARED", "RADAR_UPDATED"):
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

        await self._card_surface()
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
        await self._card_surface()
        await self.controller.show_card(note.get("app") or "iPhone", note.get("title") or "", note.get("message") or "")

    async def show_media(self, media: dict) -> None:
        track = (media.get("title") or "", media.get("artist") or "")
        await self.link.send({
            "cmd": "SPOTIFY", "title": track[0], "artist": track[1],
            "progress_ms": 0, "duration_ms": 0, "playing": bool(media.get("playing")),
        })
        if track != self.track and track[0]:
            self.track = track
            self.track_started = time.time()
            self.song_info, self.lyric_lines, self.lyric = None, [], ""
            self._spawn(self._guard(self.learn_song(track, media)))
            self.cover = await self.fetch_cover(*track)
            if self.track == track:
                await self.send_cover()

    async def learn_song(self, track: tuple, media: dict) -> None:
        """Look the song up (genre, tempo, facts, lyrics) and, while it's
        still playing, tell the clock and follow the lyrics."""
        # The phone sends the length a moment after the title, so wait a beat for it.
        await asyncio.sleep(1.0)
        if self.track != track:
            return
        media = {**media, **(self.phone.media or {})} if (self.phone.media or {}).get("title") == track[0] else media
        duration = media.get("duration") or 0
        about, lines = await asyncio.gather(
            self._guard(self.song_about(*track, album=media.get("album") or "", duration=duration, app=media.get("app") or "")),
            self._guard(self.song_lyrics(*track, duration)))
        if self.track != track:
            return
        about = about or {}
        self.lyric_lines = lines or []
        self.song_info = {
            "cmd": "SONG_INFO", "title": track[0], "genre": about.get("genre", ""),
            "bpm": about.get("bpm", 0), "energy": about.get("energy", 0.5),
            "facts": about.get("facts", []), "lyrics": bool(self.lyric_lines),
        }
        await self.link.send(self.song_info)
        while self.lyric_lines and self.track == track:
            await self._guard(self.follow_lyrics(track))
            await asyncio.sleep(0.2)

    def song_position(self) -> Optional[float]:
        """Seconds into the song, from the phone's last report, or None when
        it hasn't said since this song started."""
        media = self.phone.media
        elapsed, heard = media.get("elapsed"), media.get("elapsedAt") or 0
        if elapsed is None or heard < self.track_started - 2:
            return None
        moving = (time.time() - heard) * (media.get("rate") or 0) if media.get("playing") else 0
        return elapsed + moving

    async def follow_lyrics(self, track: tuple) -> None:
        position = self.song_position()
        # A touch early, so the line lands on the clock as it's sung.
        index = song.line_at(self.lyric_lines, position + 0.25) if position is not None else -1
        line = self.lyric_lines[index][1] if index >= 0 else ""
        if line != self.lyric and self.track == track:
            self.lyric = line
            await self.link.send({"cmd": "LYRIC", "title": track[0], "line": line})

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
            await self.link.send(self.ring_command())
            await self.announce()
        elif now.timestamp() - self.ringing_since > self.settings["alarm"]["ringMinutes"] * 60:
            await self.stop_alarm(snooze=False)

    def ring_command(self) -> dict:
        """ALARM_RING with the alarm's name and sound (firmware 2.6 rings its
        one pattern and ignores the rest)."""
        alarm = self.alarms.ringing
        defaults = self.settings["alarm"]
        return {
            "cmd": "ALARM_RING",
            "label": fit(alarm.title if alarm else "Alarm", 27),
            "tone": (alarm and alarm.tone) or defaults["tone"],
            "volume": alarm.volume if alarm and alarm.volume is not None else defaults["volume"],
            "snooze": self.snooze_minutes(alarm),
        }

    def snooze_minutes(self, alarm) -> int:
        return (alarm and alarm.snooze) or self.settings["alarm"]["snoozeMinutes"]

    async def stop_alarm(self, snooze: bool) -> None:
        alarm, self.alarms.ringing = self.alarms.ringing, None
        await self.link.send({"cmd": "ALARM_OFF"})
        if alarm is None:
            return
        now = self.now()
        fields = Alarms.snoozed(now, self.snooze_minutes(alarm)) if snooze else Alarms.rolled(alarm, now)
        await self.change(self.actions.set_fields, alarm.id, fields, SOURCE)
        await self.announce()

    # --- Buttons and screens ---

    async def before_button(self, button: str, remote: bool = False) -> bool:
        if self.alarms.ringing:
            action = desk_settings.action_for(self.settings, button, self.controller.screen, ringing=True)
            if action in ("snooze_alarm", "stop_alarm"):
                await self.stop_alarm(snooze=action == "snooze_alarm")
            return True  # a ringing alarm takes every button, even a locked clock's
        if self.timer.state == "done":
            await self.timer_do("cancel")
            return True  # any button stops a finished timer
        return self.settings["buttons"]["locked"] and not remote

    def action_for(self, button: str) -> str:
        return desk_settings.action_for(self.settings, button, self.controller.screen, ringing=False)

    async def other_action(self, action: str) -> None:
        if action in MEDIA_ACTIONS:
            await self.phone.send_command(MEDIA_ACTIONS[action])
        elif action == "lights_toggle":
            self.lights_off = not self.lights_off
            self.controller.lights = self.lights()
            await self.controller.send_lights()
        elif action in ("snooze_alarm", "stop_alarm") and self.alarms.ringing:
            await self.stop_alarm(snooze=action == "snooze_alarm")
        elif action.startswith("timer_"):
            await self.timer_do({"timer_toggle": "toggle", "timer_cancel": "cancel", "timer_add_minute": "add"}[action], seconds=60)
        elif action.startswith("stopwatch_"):
            await self.stopwatch_do(action.split("_", 1)[1])

    async def press(self, button: str) -> None:
        """A press sent from Sage: the same as the clock's own button, but
        never refused by the lock."""
        await self.controller.on_button(button, remote=True)

    # --- Settings ---

    def lights(self) -> dict:
        if self.lights_off:
            return {"mode": "OFF", "brightness": 0}
        if self.night:
            night = self.settings["night"]
            return {"mode": night["lightsMode"], "brightness": night["brightness"]}
        return dict(self.settings["lights"])

    def clock_extra(self) -> dict:
        """How to show the time, sent with every CLOCK (firmware 1.6 ignores
        these; LUMO 2 draws the clock styles from them)."""
        clock = self.settings["clock"]
        style = self.settings["night"]["face"] if self.night and self.settings["night"]["face"] else clock["style"]
        extra = {"style": style, "hour24": clock["hour24"], "show_seconds": clock["seconds"]}
        if clock["secondZone"]:
            from zoneinfo import ZoneInfo
            there = self.now().astimezone(ZoneInfo(clock["secondZone"]))
            extra.update({"zone2": clock["secondZone"].rsplit("/", 1)[-1].replace("_", " "),
                          "zone2_h": there.hour, "zone2_m": there.minute})
        return extra

    async def apply_settings(self, new: dict) -> None:
        """Use settings just saved in Sage, and show them on the clock now."""
        self.settings = new
        self.night = desk_settings.in_night(new, self.now().hour, self.now().minute)
        self.controller.screens = new["screens"]
        self.controller.lights = self.lights()
        if not self.link.connected:
            if self.controller.screen not in new["screens"]:
                self.controller.screen = new["homeScreen"]
            return
        await self.controller.send_lights()
        await self.controller.send_clock()
        await self.send_alarms()
        await self.send_tool_settings(force=True)
        if self.controller.screen not in new["screens"] and not self.controller.card:
            await self.controller.show_screen(new["homeScreen"])

    async def on_screen(self, screen: str) -> None:
        if screen == "SYSTEM":
            await self.link.send(self.vitals.command())

    async def after_redraw(self) -> None:
        """The rest of what a freshly connected clock needs."""
        await self.link.send({"cmd": "SHOW_TASKS", "items": self.today})
        await self.send_alarms(force=True)
        if self.weather:
            await self.link.send(self.weather)
        if self.track:
            await self.show_media(self.phone.media)
            await self.send_cover()
            if self.song_info:
                await self.link.send(self.song_info)
                if self.lyric:
                    await self.link.send({"cmd": "LYRIC", "title": self.track[0], "line": self.lyric})
        if self.alarms.ringing:
            await self.link.send(self.ring_command())
        await self.send_tool_settings(force=True)
        if self.has_tools:
            await self.link.send(self.timer.command())
            await self.link.send(self.stopwatch.command())

    # --- The LUMO page: timer, stopwatch, world, night, haptics, device ---

    def world_command(self) -> dict:
        """The World screen's places, each as minutes ahead of the time here."""
        now = self.now()
        here = now.utcoffset() or datetime.timedelta(0)
        zones = []
        from zoneinfo import ZoneInfo
        for name in self.settings["world"]["zones"]:
            there = now.astimezone(ZoneInfo(name)).utcoffset() or datetime.timedelta(0)
            zones.append({"name": fit(name.rsplit("/", 1)[-1].replace("_", " "), 15),
                          "offset": int((there - here).total_seconds() // 60)})
        return {"cmd": "WORLD", "zones": zones}

    async def send_tool_settings(self, force: bool = False) -> None:
        """World places, haptics and night, for firmware 2.7 and later. The
        places are re-sent when an offset changes (summer time)."""
        if not self.has_tools:
            return
        world = self.world_command()
        if force or world != self.sent_world:
            if await self.link.send(world):
                self.sent_world = world
        if force:
            haptics = self.settings["haptics"]
            await self.link.send({"cmd": "HAPTICS", "buttons": haptics["buttons"], "notify": haptics["notifications"]})
            await self.link.send({"cmd": "NIGHT", "on": self.night})

    async def night_tick(self) -> None:
        now = self.now()
        night = desk_settings.in_night(self.settings, now.hour, now.minute)
        if night == self.night:
            return
        self.night = night
        log.info("Night mode %s", "on" if night else "off")
        self.controller.lights = self.lights()
        if self.link.connected:
            await self.controller.send_lights()
            await self.controller.send_clock()
            if self.has_tools:
                await self.link.send({"cmd": "NIGHT", "on": night})
        await self.announce()

    async def timer_do(self, action: str, seconds: int = 0, label: str = "") -> None:
        """start, pause, resume, toggle, add or cancel. Raises ValueError for
        a timer that can't be set."""
        timer = self.timer
        if action == "start":
            timer.start(seconds, label)
        elif action == "add":
            timer.add(seconds or 60)
        elif action in ("pause", "resume", "toggle", "cancel"):
            getattr(timer, action)()
        else:
            raise ValueError(f"Unknown timer action {action!r}.")
        if self.has_tools:
            await self.link.send(timer.command())
            if action == "start" and self.controller.screen != "TIMER" and not self.controller.card:
                await self.controller.show_screen("TIMER")
        await self.announce()

    async def stopwatch_do(self, action: str) -> None:
        """start, pause, toggle, lap or reset."""
        if action not in ("start", "pause", "toggle", "lap", "reset"):
            raise ValueError(f"Unknown stopwatch action {action!r}.")
        getattr(self.stopwatch, action)()
        if self.has_tools:
            await self.link.send(self.stopwatch.command())
            if action == "start" and self.controller.screen != "STOPWATCH" and not self.controller.card:
                await self.controller.show_screen("STOPWATCH")
        await self.announce()

    async def tools_tick(self) -> None:
        change = self.timer.tick()
        if change:
            if change == "done":
                log.info("Timer done: %s", self.timer.label or "timer")
            if self.has_tools:
                await self.link.send(self.timer.command())
            await self.announce()

    async def ringing_do(self, action: str) -> bool:
        """Snooze or stop a ringing alarm from Sage. False when none rings."""
        if not self.alarms.ringing:
            return False
        await self.stop_alarm(snooze=action == "snooze")
        return True

    async def device_do(self, action: str, tone: str = "", volume: int = 0) -> bool:
        """identify (flash and knock), restart, or tone (play an alarm sound
        for a few seconds). False when no clock is there to do it."""
        if not self.link.connected:
            return False
        if action == "identify":
            return await self.link.send({"cmd": "IDENTIFY"})
        if action == "restart":
            return await self.link.send({"cmd": "REBOOT"})
        if action == "tone":
            return await self.link.send({"cmd": "TONE", "tone": tone or self.settings["alarm"]["tone"],
                                         "volume": volume if volume else self.settings["alarm"]["volume"], "seconds": 4})
        raise ValueError(f"Unknown device action {action!r}.")

    def state(self) -> dict:
        """What the LUMO page shows live."""
        ringing = self.alarms.ringing
        return {
            "screen": self.controller.screen,
            "night": self.night,
            "lightsOff": self.lights_off,
            "toolsSupported": self.has_tools,
            "ringing": {"id": ringing.id, "label": ringing.title, "since": int(self.ringing_since * 1000)} if ringing else None,
            "timer": self.timer.describe(),
            "stopwatch": self.stopwatch.describe(),
        }

    async def announce(self) -> None:
        await self.broadcast({"type": "DESK_STATE", "state": self.state()})

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
        """Every two seconds: the vitals while they're on screen."""
        if self.link.connected and self.controller.screen == "SYSTEM":
            await self.link.send(self.vitals.command())

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        await asyncio.gather(
            self.controller.tick_forever(),
            self._every(1, self.ring),
            self._every(1, self.tools_tick),
            self._every(NIGHT_EVERY, self.night_tick),
            self._every(WORLD_EVERY, self.send_tool_settings),
            self._every(REFRESH_EVERY, self.refresh),
            self._every(WEATHER_EVERY, self.update_weather),
            self._every(2, self.ambient),
        )
