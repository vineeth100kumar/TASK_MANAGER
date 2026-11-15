"""Tests for room_music.py: fades, call ducking, and the arrival session with a fake Spotify.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import os
import sys
import tempfile
import unittest
from collections import deque
from pathlib import Path

os.environ.setdefault("SAGE_DB_PATH", str(Path(tempfile.mkdtemp()) / "test.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import room_music  # noqa: E402
import spotify  # noqa: E402
import phone_link  # noqa: E402


class FakeMusic:
    def __init__(self, volume=60, status="idle"):
        self.state = {"status": status, "volume": volume, "context": {"uri": ""}}
        self.ready = self.logged_in = True
        self.is_active = False
        self.sent = []
        self.volumes = []

    def playing(self):
        return self.state["status"] == "playing"

    async def set_volume(self, v):
        self.volumes.append(v)
        self.state["volume"] = v

    async def shuffle(self, on):
        self.sent.append(("shuffle", on))

    async def _send(self, m):
        self.sent.append(m)
        if m.get("command") == "play":
            self.state["status"] = "playing"
            self.state["context"] = {"uri": m.get("uri", "")}
        if m.get("command") == "activate":
            self.is_active = True

    async def pause_quietly(self):
        self.state["status"] = "paused"


class FakeSpeaker:
    def __init__(self):
        self.speaking = ""
        self.queue = asyncio.Queue()
        self._herald = deque()
        self._last_spoke_at = 0.0


def fast():
    room_music.TICK_S = 0.01
    room_music.FADE_IN_S = 0.1
    room_music.FADE_OUT_S = 0.1
    room_music.MISSED_WAIT_S = 0.05
    room_music.MIN_TOTAL_S = 0.3
    room_music.SETTLE_S = 0.03


async def no_wait(*_a, **_k):
    return None


class PureTests(unittest.TestCase):
    def test_eased(self):
        steps = room_music.eased(0, 40, 10, 1)
        self.assertEqual(len(steps), 10)
        self.assertEqual(steps[-1], 40)
        self.assertEqual(steps, sorted(steps))
        self.assertLess(steps[0], 4)                 # starts very softly
        self.assertEqual(room_music.eased(40, 0, 5, 1)[-1], 0)

    def test_duck_target(self):
        self.assertEqual(room_music.duck_target(60, 30), 30)
        self.assertIsNone(room_music.duck_target(30, 30))
        self.assertIsNone(room_music.duck_target(20, 30))

    def test_call_events_from_ancs(self):
        f = phone_link.call_event_for
        self.assertEqual(f({"category": "incoming call", "event": "added"}), "ringing")
        self.assertEqual(f({"category": "incoming call", "event": "removed"}), "ringing_stopped")
        self.assertEqual(f({"category": "missed call", "event": "added"}), "missed")
        self.assertIsNone(f({"category": "incoming call", "event": "added", "preExisting": True}))
        self.assertIsNone(f({"category": "social", "event": "added"}))

    def test_settings(self):
        d = spotify.clean_settings({})
        self.assertFalse(d["arrivalMusic"])
        self.assertEqual((d["arrivalVolume"], d["callVolume"]), (40, 30))
        s = spotify.clean_settings({"arrivalMusic": True, "arrivalVolume": 500,
                                    "arrivalPlaylist": "https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ?si=x"})
        self.assertTrue(s["arrivalMusic"])
        self.assertEqual(s["arrivalVolume"], 80)
        self.assertEqual(s["arrivalPlaylist"], "spotify:playlist:37i9dQZF1DWZeKCadgRdKQ")
        with self.assertRaises(ValueError):
            spotify.clean_settings({"arrivalPlaylist": "lofi please"})


class ArrivalTests(unittest.TestCase):
    def setUp(self):
        fast()

    def run_arrival(self, music, during=None):
        async def go():
            r = room_music.RoomMusic()
            r.music, r.speaker = music, FakeSpeaker()
            r._wait_for_herald = no_wait
            r._quiet_now = lambda: False
            s = {**spotify.DEFAULTS, "arrivalMinutes": 0.01}
            task = asyncio.ensure_future(r._arrival(s))
            if during:
                await asyncio.sleep(0.3)
                await during(r, music)
            await task
            return r
        return asyncio.run(go())

    def test_fades_in_to_40_out_and_restores(self):
        m = FakeMusic(volume=65)
        self.run_arrival(m)
        self.assertIn({"type": "command", "command": "activate"}, m.sent)
        self.assertIn({"type": "command", "command": "play", "uri": spotify.DEFAULTS["arrivalPlaylist"]}, m.sent)
        self.assertEqual(m.volumes[0], 0)
        self.assertEqual(max(m.volumes[:-1]), 40)
        self.assertIn(0, m.volumes[1:])                # faded back out
        self.assertEqual(m.volumes[-1], 65)            # your volume back for next time
        self.assertEqual(m.state["status"], "paused")

    def test_skips_when_already_playing(self):
        m = FakeMusic(status="playing")
        self.run_arrival(m)
        self.assertEqual(m.volumes, [])

    def test_steps_aside_when_you_change_volume(self):
        m = FakeMusic(volume=50)

        async def you(r, music):
            music.state["volume"] = 70

        self.run_arrival(m, you)
        self.assertEqual(m.state["status"], "playing")   # left playing for you
        self.assertEqual(m.state["volume"], 70)


class CallTests(unittest.TestCase):
    def setUp(self):
        fast()

    def room(self, music):
        r = room_music.RoomMusic()
        r.music = music
        r.settings = lambda: dict(spotify.DEFAULTS)
        return r

    def test_missed_call_restores(self):
        m = FakeMusic(volume=70, status="playing")

        async def go():
            r = self.room(m)
            await r._call_event("ringing", "1")
            self.assertEqual(m.state["volume"], 30)
            self.assertTrue(r.on_call)
            await r._call_event("ringing_stopped", "1")
            await r._call_event("missed", "2")
            await asyncio.sleep(0.2)
            self.assertFalse(r.on_call)
            self.assertEqual(m.state["volume"], 70)
        asyncio.run(go())

    def test_low_volume_left_alone(self):
        m = FakeMusic(volume=20, status="playing")

        async def go():
            r = self.room(m)
            await r._call_event("ringing", "1")
            self.assertEqual(m.volumes, [])
            await r.call_over()
            self.assertEqual(m.volumes, [])
        asyncio.run(go())

    def test_answered_call_waits_then_button(self):
        m = FakeMusic(volume=70, status="playing")

        async def go():
            r = self.room(m)
            await r._call_event("ringing", "1")
            await r._call_event("ringing_stopped", "1")
            await asyncio.sleep(0.15)                 # no missed call: answered
            self.assertTrue(r.on_call)
            self.assertEqual(m.state["volume"], 30)
            await r.call_over()
            self.assertEqual(m.state["volume"], 70)
        asyncio.run(go())

    def test_nothing_playing(self):
        m = FakeMusic(volume=70, status="paused")

        async def go():
            r = self.room(m)
            await r._call_event("ringing", "1")
            self.assertFalse(r.on_call)
        asyncio.run(go())


if __name__ == "__main__":
    unittest.main()
