"""Tests for spotify.py's pure parts: settings, go-librespot's config, now playing, sign-out.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import json
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
        s = spotify.clean_settings({"name": "  Living room <3 ", "quality": "160", "normalise": 0})
        self.assertEqual(s["name"], "Living room 3")
        self.assertEqual(s["quality"], 160)
        self.assertFalse(s["normalise"])
        with self.assertRaises(ValueError):
            spotify.clean_settings({"quality": 128})
        with self.assertRaises(ValueError):
            spotify.clean_settings({"name": "<>"})

    def test_saved(self):
        spotify.save_settings({"name": "Sage Bar", "foo": 1})
        self.assertEqual(spotify.get_settings()["name"], "Sage Bar")
        self.assertNotIn("foo", spotify.get_settings())

    def test_restart_keys(self):
        a = dict(spotify.DEFAULTS)
        self.assertFalse(spotify.restart_keys(a, dict(a, enabled=False)))
        self.assertTrue(spotify.restart_keys(a, dict(a, quality=96)))


class ConfigTests(unittest.TestCase):
    def test_no_developer_keys(self):
        c = spotify.daemon_config(dict(spotify.DEFAULTS), "bluealsa:DEV=AA:BB:CC:DD:EE:FF,PROFILE=a2dp")
        self.assertEqual(c["credentials"], {"type": "device_auth"})
        self.assertEqual(c["audio_device"], "bluealsa:DEV=AA:BB:CC:DD:EE:FF,PROFILE=a2dp")
        self.assertEqual(c["server"]["address"], "127.0.0.1")
        self.assertEqual(c["bitrate"], 320)
        self.assertFalse(c["normalisation_disabled"])
        self.assertEqual(spotify.daemon_config(dict(spotify.DEFAULTS), "")["audio_device"], "default")
        # every key is one go-librespot knows (its schema refuses others)
        known = {"log_level", "log_disable_timestamp", "device_name", "device_type", "audio_backend", "audio_device",
                 "audio_buffer_time", "bitrate", "normalisation_disabled", "disable_autoplay", "zeroconf_enabled",
                 "credentials", "server"}
        self.assertEqual(set(c), known)


class NowPlayingTests(unittest.TestCase):
    def test_status(self):
        st = {"stopped": False, "paused": False, "volume": 32, "volume_steps": 64, "context_name": "Chill",
              "track": {"name": "Song", "artist_names": ["A", "B"], "album_name": "LP", "album_cover_url": "https://i/x",
                        "duration": 1000, "position": 10, "uri": "spotify:track:1"}}
        p = spotify.now_playing(st)
        self.assertTrue(p["playing"])
        self.assertEqual(p["volume"], 50)
        self.assertEqual(p["track"]["artists"], "A, B")
        self.assertFalse(spotify.now_playing(dict(st, paused=True))["playing"])
        self.assertIsNone(spotify.now_playing(None))
        self.assertIsNone(spotify.now_playing({"stopped": True, "track": None})["track"])


class SignInTests(unittest.TestCase):
    def test_saved_and_forgotten(self):
        d = Path(tempfile.mkdtemp())
        self.assertEqual(spotify.saved_user(d), "")
        (d / "state.json").write_text(json.dumps({"device_id": "x", "credentials": {"username": "vk", "data": "QUJD"}, "last_volume": 30}))
        self.assertEqual(spotify.saved_user(d), "vk")
        spotify.forget_user(d)
        self.assertEqual(spotify.saved_user(d), "")
        kept = json.loads((d / "state.json").read_text())
        self.assertEqual(kept["device_id"], "x")
        self.assertEqual(kept["last_volume"], 30)

    def test_legacy_credentials_file(self):
        d = Path(tempfile.mkdtemp())
        (d / "credentials.json").write_text(json.dumps({"username": "vk", "data": "QUJD"}))
        self.assertEqual(spotify.saved_user(d), "vk")
        spotify.forget_user(d)
        self.assertFalse((d / "credentials.json").exists())

    def test_log_line(self):
        line = 'level=error msg="failed loading \\"x\\"" error="ALSA error at snd_pcm_open: No such device"'
        self.assertEqual(spotify.friendly_log(line), 'failed loading "x": ALSA error at snd_pcm_open: No such device')


if __name__ == "__main__":
    unittest.main()


class OutputErrorTests(unittest.TestCase):
    def test_spotify_errors_dont_blame_surround(self):
        import spotify
        self.assertFalse(spotify.output_error("failed creating stream for spotify:track:x: failed retrieving audio key: failed retrieving aes key with code 1"))
        self.assertTrue(spotify.output_error("failed opening alsa device sage_surround:DEV=AA"))
