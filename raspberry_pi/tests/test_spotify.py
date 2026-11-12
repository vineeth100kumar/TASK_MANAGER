"""Tests for spotify.py's pure parts: settings, Soloist's command, the PipeWire
sink, now playing, and the control socket.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("SAGE_DB_PATH", str(Path(tempfile.mkdtemp()) / "test.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import spotify  # noqa: E402


class SettingsTests(unittest.TestCase):
    def test_defaults_and_cleaning(self):
        s = spotify.clean_settings({"name": "  Living room <3 ", "apiKey": "spak_ABCdef123456"})
        self.assertEqual(s["name"], "Living room 3")
        self.assertEqual(s["apiKey"], "spak_ABCdef123456")
        with self.assertRaises(ValueError):
            spotify.clean_settings({"name": "<>"})
        with self.assertRaises(ValueError):
            spotify.clean_settings({"apiKey": "has spaces in it"})
        # an empty key is allowed (clears it)
        self.assertEqual(spotify.clean_settings({"apiKey": ""})["apiKey"], "")

    def test_saved(self):
        spotify.save_settings({"name": "Sage Bar", "foo": 1})
        self.assertEqual(spotify.get_settings()["name"], "Sage Bar")
        self.assertNotIn("foo", spotify.get_settings())

    def test_key_never_leaves(self):
        pub = spotify.public_settings({"enabled": True, "name": "Sage", "apiKey": "secret-key-123"})
        self.assertNotIn("apiKey", pub)
        self.assertTrue(pub["hasKey"])
        self.assertFalse(spotify.public_settings({"apiKey": ""})["hasKey"])


class CommandTests(unittest.TestCase):
    def test_soloist_cmd(self):
        s = {"name": "Sage", "apiKey": "KEY", "enabled": True}
        cmd = spotify.soloist_cmd(s, "sage-spotify")
        self.assertEqual(cmd[0], "soloist")
        self.assertIn("--device-name", cmd)
        self.assertEqual(cmd[cmd.index("--device-name") + 1], "Sage")
        self.assertEqual(cmd[cmd.index("--api-key") + 1], "KEY")
        self.assertIn("127.0.0.1:" + str(spotify.WS_PORT), cmd)
        self.assertEqual(cmd[cmd.index("-d") + 1], "sage-spotify")
        # no soundbar: no -d, so Soloist uses the default output
        self.assertNotIn("-d", spotify.soloist_cmd(s, ""))

    def test_pipewire_sink(self):
        conf = spotify.pipewire_sink_conf("sage-spotify")
        self.assertIn("support.null-audio-sink", conf)
        self.assertIn("sage-spotify", conf)

    def test_bridge_cmd(self):
        cmd = spotify.bridge_cmd("sage-spotify", "bluealsa:DEV=AA:BB:CC:DD:EE:FF,PROFILE=a2dp")
        self.assertIn("parec -d sage-spotify.monitor", cmd)
        self.assertIn("aplay", cmd)
        self.assertIn("bluealsa:DEV=AA:BB:CC:DD:EE:FF,PROFILE=a2dp", cmd)

    def test_audio_env(self):
        env = spotify.audio_env({"PATH": "/usr/bin"})
        self.assertTrue(env["XDG_RUNTIME_DIR"].startswith("/run/user/"))
        self.assertEqual(env["PULSE_SERVER"], "unix:" + env["XDG_RUNTIME_DIR"] + "/pulse/native")
        self.assertEqual(spotify.audio_env({"XDG_RUNTIME_DIR": "/x"})["PULSE_SERVER"], "unix:/x/pulse/native")

    def test_expired(self):
        self.assertTrue(spotify.expired(10))
        self.assertFalse(spotify.expired(0))
        self.assertFalse(spotify.expired(None))


class NowPlayingTests(unittest.TestCase):
    def test_playback_state(self):
        st = {"status": "playing", "volume": 65, "is_active": True,
              "options": {"shuffle": True, "repeat": "off"},
              "context": {"decorations": {"identity": {"name": "Today's Top Hits"}}},
              "position": {"position_ms": 45000, "timestamp_ms": 1, "speed": 1.0},
              "item": {"uri": "spotify:track:2JRo", "decorations": {
                  "identity": {"name": "My Song", "artists": [{"name": "A"}, {"name": "B"}]},
                  "playback": {"duration_ms": 210000}}}}
        p = spotify.now_playing(st)
        self.assertTrue(p["playing"])
        self.assertTrue(p["active"])
        self.assertEqual(p["volume"], 65)
        self.assertTrue(p["shuffle"])
        self.assertEqual(p["context"], "Today's Top Hits")
        self.assertEqual(p["track"]["name"], "My Song")
        self.assertEqual(p["track"]["artists"], "A, B")
        self.assertEqual(p["track"]["duration"], 210000)
        self.assertEqual(p["track"]["position"], 45000)

    def test_idle_and_none(self):
        self.assertIsNone(spotify.now_playing(None))
        idle = spotify.now_playing({"status": "idle", "item": None})
        self.assertTrue(idle["stopped"])
        self.assertIsNone(idle["track"])


class ControlTests(unittest.TestCase):
    def test_commands_sent(self):
        sent = []
        c = spotify.SpotifyConnect()

        async def fake_send(message):
            sent.append(message)
        c._send = fake_send

        async def go():
            c.state = {"status": "playing", "item": {"uri": "x"}}
            await c.control("playpause")
            self.assertEqual(sent[-1], {"type": "command", "command": "pause"})
            c.state = {"status": "paused", "item": {"uri": "x"}}
            await c.control("playpause")
            self.assertEqual(sent[-1], {"type": "command", "command": "play"})
            await c.control("next")
            self.assertEqual(sent[-1], {"type": "command", "command": "skip_next"})
            await c.set_volume(150)
            self.assertEqual(sent[-1], {"type": "command", "command": "set_volume", "volume": 100})
            await c.shuffle(True)
            self.assertEqual(sent[-1], {"type": "command", "command": "set_shuffle", "enabled": True})
            with self.assertRaises(ValueError):
                await c.control("backflip")

        asyncio.run(go())

    def test_hold_releases_only_when_playing(self):
        sent = []
        c = spotify.SpotifyConnect()
        c.ready = True

        async def fake_send(message):
            sent.append(message)
        c._send = fake_send

        async def go():
            c.state = {"status": "paused", "item": {"uri": "x"}}
            self.assertFalse(await c.hold())   # nothing playing: don't touch it
            self.assertEqual(sent, [])
            c.state = {"status": "playing", "item": {"uri": "x"}}
            self.assertTrue(await c.hold())
            self.assertEqual(sent[-1], {"type": "command", "command": "pause"})
            await c.release()
            self.assertEqual(sent[-1], {"type": "command", "command": "play"})

        asyncio.run(go())

    def test_surround_change_moves_bridge_only(self):
        c = spotify.SpotifyConnect()
        calls = []

        async def bridge():
            calls.append("bridge")

        async def restart():
            calls.append("restart")
        c._start_bridge, c.restart = bridge, restart
        c.used_node, c.device = True, "sage_surround:DEV=A,WIDTH=0.7"
        asyncio.run(c.rewire("sage_surround:DEV=A,WIDTH=0.55"))
        self.assertEqual(calls, ["bridge"])          # Soloist keeps playing
        self.assertEqual(c.device, "sage_surround:DEV=A,WIDTH=0.55")

    def test_auth_state_event(self):
        c = spotify.SpotifyConnect()

        async def go():
            await c.on_event({"type": "auth_state", "logged_in": True, "is_active": False, "device_name": "Sage"})
            self.assertTrue(c.logged_in)

        asyncio.run(go())


class ProbeTests(unittest.TestCase):
    def test_tidy_and_grep(self):
        import audio_probe
        self.assertEqual(audio_probe.tidy("a   b\n\n  c"), "a b | c")
        self.assertEqual(len(audio_probe.tidy("x" * 5000)) <= audio_probe.MAX_LINE, True)
        self.assertEqual(audio_probe.grep_lines("one\nBlueAlsa x\nthree", "bluealsa"), "BlueAlsa x")
        self.assertEqual(audio_probe.grep_lines("one", "zzz"), "(none)")

    def test_progress_tracking(self):
        c = spotify.SpotifyConnect()
        c._track_progress('t: playing spotify:track:x "S" by "A" [2:38 / 4:53]')
        first = c._progress_at
        self.assertEqual((c._line_status, c._progress_pos), ("playing", 158))
        c._track_progress('t: playing spotify:track:x "S" by "A" [2:38 / 4:53]')
        self.assertEqual(c._progress_at, first)       # same position: no progress
        c._track_progress('t: playing spotify:track:x "S" by "A" [2:40 / 4:53]')
        self.assertEqual(c._progress_pos, 160)

    def test_summary_runs(self):
        import audio_probe
        self.assertIn("running=False", audio_probe.soloist_summary(spotify.SpotifyConnect()))


if __name__ == "__main__":
    unittest.main()
