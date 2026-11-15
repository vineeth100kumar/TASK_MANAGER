"""
room_music.py - soft music when you walk in, and quieter music while you're on a call.

Arrival music: when the phone comes home (the same arrival Herald uses), and
"Music when I arrive" is on in Settings > Bluetooth > Spotify, Sage waits for
Herald's welcome to finish, then starts a calm Spotify playlist on the soundbar
at 0 % and lets it rise slowly to 40 %. After a minute or two it sinks back to
nothing, pauses, and puts Spotify's volume back where it was. The aim is
background sound you barely notice starting or ending.

It steps aside the moment you take over: if you pause, skip to something else,
start another playlist or move the volume yourself, the session ends and the
music is left alone (still playing, if you chose that). It never starts when
Spotify is already playing, in Herald's quiet hours, or more than once in
ARRIVAL_GAP_S.

Call ducking: the iPhone tells Sage (ANCS, phone_link.py) when a call rings.
While a call rings, Spotify drops to 30 % (left alone when already at or below
30 %). If the call is missed or declined, the volume goes back at once. If you
answer it, the iPhone doesn't tell accessories when the call ends, so the
volume comes back after `callHoldMinutes`, or straight away when you move the
volume yourself or press "Call's over" in Settings.

Settings live with Spotify's in the metadata table ("spotify"): arrivalMusic,
arrivalPlaylist, arrivalVolume, arrivalMinutes, callDuck, callVolume,
callHoldMinutes (see spotify.DEFAULTS).
"""

import asyncio
import logging
import math
import os
import time
from typing import Any, Callable, Optional

log = logging.getLogger("room_music")

ARRIVAL_GAP_S = float(os.getenv("SAGE_ARRIVAL_MUSIC_GAP", str(20 * 60)))   # not again sooner than this
ARRIVAL_MIN_AWAY_S = float(os.getenv("SAGE_ARRIVAL_MUSIC_AWAY", "180"))   # a short drop-out isn't "coming in"
FADE_IN_S = 25.0
FADE_OUT_S = 30.0
TICK_S = 1.0
MIN_TOTAL_S = 30.0
SETTLE_S = 1.5          # after asking Spotify to make the Pi the active device
TOOK_OVER_SLACK = 3        # volume % difference that means you moved it yourself
MISSED_WAIT_S = 4.0        # after ringing stops: a "missed call" this soon means it wasn't answered


def eased(start: float, end: float, seconds: float, tick: Optional[float] = None) -> list:
    """Volume steps (whole %) for a gentle fade, slow at both ends. Pure."""
    tick = tick or TICK_S
    n = max(1, int(round(seconds / tick)))
    out = []
    for i in range(1, n + 1):
        t = i / n
        k = (1 - math.cos(math.pi * t)) / 2
        out.append(int(round(start + (end - start) * k)))
    return out


def duck_target(current: int, call_level: int) -> Optional[int]:
    """Where the volume goes for a call, or None to leave it. Pure."""
    if current <= call_level:
        return None
    return call_level


class RoomMusic:
    def __init__(self) -> None:
        self.music = None              # spotify.connect
        self.speaker = None            # speaker.speaker
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.settings: Callable[[], dict] = lambda: {}
        self.session: Optional[asyncio.Task] = None
        self.session_level = 0          # the volume the arrival session last set
        self.last_arrival_at = 0.0
        # Calls
        self.calls: set = set()         # ANCS uids of calls ringing now
        self.on_call = False            # ducked for a ringing or answered call
        self.call_restore: Optional[int] = None   # volume to go back to (None: we didn't move it)
        self.call_level = 0             # the volume we ducked to
        self.call_until = 0.0           # answered call: give the volume back by then
        self._missed_at = 0.0
        self._ring_end: Optional[asyncio.Task] = None
        self.last: dict = {}            # what happened last, for the web app

    # --- Wiring ---

    def attach(self, loop: asyncio.AbstractEventLoop, music: Any, speaker: Any, settings: Callable[[], dict]) -> None:
        self.loop, self.music, self.speaker, self.settings = loop, music, speaker, settings

    def _note(self, what: str, why: str = "") -> None:
        self.last = {"at": int(time.time() * 1000), "what": what, "why": why}
        log.info("Room music: %s%s", what, f" ({why})" if why else "")

    def snapshot(self) -> dict:
        return {
            "playing": bool(self.session and not self.session.done()),
            "onCall": self.on_call,
            "last": self.last or None,
        }

    def _volume(self) -> int:
        state = getattr(self.music, "state", None) or {}
        try:
            return int(state.get("volume") or 0)
        except (TypeError, ValueError):
            return 0

    def _context(self) -> str:
        state = getattr(self.music, "state", None) or {}
        ctx = state.get("context") or {}
        return str(ctx.get("uri") or "") if isinstance(ctx, dict) else ""

    async def _set(self, percent: int) -> None:
        await self.music.set_volume(percent)

    # --- Arrival ---

    def on_arrival(self, away_s: float = 0.0) -> None:
        """From any thread (speaker.on_arrival calls it)."""
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self._start_arrival, away_s)

    def _start_arrival(self, away_s: float) -> None:
        s = self.settings()
        if not s.get("arrivalMusic"):
            return
        if away_s and away_s < ARRIVAL_MIN_AWAY_S:
            return self._note("no arrival music", f"away only {int(away_s)} s")
        if time.time() - self.last_arrival_at < ARRIVAL_GAP_S:
            return self._note("no arrival music", "played it a little while ago")
        if self.session and not self.session.done():
            return
        self.last_arrival_at = time.time()
        self.session = asyncio.ensure_future(self._arrival(s))

    def on_leave(self) -> None:
        """You left: fade out an arrival session that is still going."""
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self._leave)

    def _leave(self) -> None:
        if self.session and not self.session.done():
            self.session.cancel()

    async def _wait_for_herald(self, since: float, limit: float = 90.0) -> None:
        """Herald first: when it chose to speak for this arrival, wait for its
        chime and line to finish, then a short breath before the music."""
        await asyncio.sleep(2.0)
        sp = self.speaker
        notes = list(getattr(sp, "_herald", []) or [])
        spoke = any(n.get("at", 0) / 1000 >= since - 5 and n.get("action") not in ("silent",)
                    and "back after" in str(n.get("event", "")) for n in notes)
        end = time.time() + limit
        while spoke and time.time() < end:
            busy = bool(getattr(sp, "speaking", "") or (sp.queue is not None and not sp.queue.empty()))
            if not busy and float(getattr(sp, "_last_spoke_at", 0) or 0) > since:
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(3.0)

    def _quiet_now(self) -> bool:
        try:
            import speaker as speaker_mod
            st = speaker_mod.get_settings()
            if not speaker_mod.has_output(st):
                return True
            return speaker_mod.in_quiet(self.speaker.now(), st["quietStart"], st["quietEnd"])
        except Exception:
            return False

    async def _arrival(self, s: dict) -> None:
        m = self.music
        arrived = time.time()
        if self._quiet_now():
            return self._note("no arrival music", "quiet hours or no soundbar")
        # Spotify may still be starting up after a reboot.
        for _ in range(40):
            if m.ready and m.logged_in:
                break
            await asyncio.sleep(1.0)
        if not (m.ready and m.logged_in):
            return self._note("no arrival music", "Spotify isn't signed in on the Pi")
        await self._wait_for_herald(arrived)
        if m.playing():
            return self._note("no arrival music", "something is already playing")
        before = self._volume() or 50
        target = int(s.get("arrivalVolume") or 40)
        total = max(MIN_TOTAL_S, float(s.get("arrivalMinutes") or 2) * 60)
        uri = str(s.get("arrivalPlaylist") or "")
        took_over = False
        started = False
        try:
            if not m.is_active:
                await m._send({"type": "command", "command": "activate"})
                await asyncio.sleep(SETTLE_S)
            await self._set(0)
            self.session_level = 0
            await m.shuffle(True)
            await m._send({"type": "command", "command": "play", "uri": uri})
            for _ in range(20):
                await asyncio.sleep(SETTLE_S / 3)
                if m.playing():
                    break
            if not m.playing():
                await self._set(before)
                return self._note("no arrival music", "the playlist didn't start")
            started = True
            self._note("arrival music", "fading in")
            ctx = self._context()
            plan = eased(0, target, FADE_IN_S)
            hold = max(0.0, total - FADE_IN_S - FADE_OUT_S)
            plan += [target] * int(hold / TICK_S)
            plan += eased(target, 0, FADE_OUT_S)
            for level in plan:
                if self._you_took_over(ctx):
                    took_over = True
                    return self._note("arrival music handed to you", "you changed it")
                level = min(level, self.call_level) if self.on_call else level
                if level != self.session_level:
                    await self._set(level)
                    self.session_level = level
                await asyncio.sleep(TICK_S)
            await m.pause_quietly()
            await asyncio.sleep(0.6)
            self._note("arrival music", "faded out")
        except asyncio.CancelledError:
            # You left mid-way: a quick, still gentle fade.
            if started and not took_over and m.playing():
                for level in eased(self.session_level, 0, 6.0, 0.5):
                    await self._set(level)
                    await asyncio.sleep(0.5)
                await m.pause_quietly()
                await asyncio.sleep(0.6)
            self._note("arrival music", "stopped, you left")
        except Exception as e:
            self._note("arrival music failed", str(e)[:120])
        finally:
            if started and not took_over:
                try:
                    if self.on_call and self.call_restore is not None:
                        self.call_restore = before   # the call ends; volume goes back to yours then
                    else:
                        await self._set(before)
                except Exception:
                    pass

    def _you_took_over(self, ctx: str) -> bool:
        m = self.music
        p = m.state or {}
        if p.get("status") in ("paused", "idle"):
            return True
        if ctx and self._context() and self._context() != ctx:
            return True
        if not self.on_call and abs(self._volume() - self.session_level) > TOOK_OVER_SLACK:
            return True
        return False

    # --- Calls ---

    def on_call_event(self, event: str, uid: str = "") -> None:
        """From phone_link (any thread): ringing / ringing_stopped / missed."""
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self._call_event(event, uid)))

    async def _call_event(self, event: str, uid: str) -> None:
        s = self.settings()
        if event == "missed":
            self._missed_at = time.time()
            if self.on_call and not self.calls:
                await self.call_over("missed")
            return
        if event == "ringing":
            self.calls.add(uid)
            if self._ring_end and not self._ring_end.done():
                self._ring_end.cancel()
            if s.get("callDuck", True) and not self.on_call:
                await self._duck(s)
            return
        if event == "ringing_stopped":
            self.calls.discard(uid)
            if self.on_call and not self.calls:
                self._ring_end = asyncio.ensure_future(self._after_ring(s))

    async def _duck(self, s: dict) -> None:
        m = self.music
        if not (m and m.playing()):
            return self._note("call", "nothing playing to turn down")
        current = self._volume()
        level = int(s.get("callVolume") or 30)
        target = duck_target(current, level)
        self.on_call = True
        self.call_level = level
        self.call_until = 0.0
        if target is None:
            self.call_restore = None
            return self._note("call", f"volume already {current} %, left it")
        self.call_restore = current
        self._note("call", f"turned down to {target} %")
        for v in eased(current, target, 1.5, 0.15):
            await self._set(v)
            await asyncio.sleep(0.15)

    async def _after_ring(self, s: dict) -> None:
        await asyncio.sleep(MISSED_WAIT_S)
        if time.time() - self._missed_at < MISSED_WAIT_S + 2:
            return await self.call_over("missed")
        # Answered (or declined without a missed-call notice): keep it down
        # until the hold runs out, or you move the volume / press Call's over.
        minutes = float(s.get("callHoldMinutes") or 15)
        self.call_until = time.time() + minutes * 60
        self._note("call answered", f"music stays down up to {int(minutes)} min")
        while self.on_call and time.time() < self.call_until:
            if self.call_restore is not None and abs(self._volume() - self.call_level) > TOOK_OVER_SLACK \
                    and not (self.session and not self.session.done()):
                self.on_call, self.call_restore = False, None
                return self._note("call", "you set the volume yourself")
            await asyncio.sleep(2.0)
        if self.on_call:
            await self.call_over("time")

    async def call_over(self, why: str = "asked") -> None:
        """Give the volume back (also the "Call's over" button)."""
        if self._ring_end and not self._ring_end.done() and asyncio.current_task() is not self._ring_end:
            self._ring_end.cancel()
        was, restore = self.on_call, self.call_restore
        self.on_call, self.call_restore, self.calls = False, None, set()
        if not was:
            return
        if self.session and not self.session.done():
            return self._note("call over", "arrival music carries on")
        if restore is not None and self.music and self.music.playing() \
                and abs(self._volume() - self.call_level) <= TOOK_OVER_SLACK:
            for v in eased(self._volume(), restore, 3.0, 0.2):
                await self._set(v)
                await asyncio.sleep(0.2)
            return self._note("call over", f"volume back to {restore} % ({why})")
        self._note("call over", f"volume left as it is ({why})")


room = RoomMusic()
