"""Tests for speaker.py's pure rules: quiet hours, the greeting, settings, audio links.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import datetime
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("SAGE_DB_PATH", str(Path(tempfile.mkdtemp()) / "test.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import speaker  # noqa: E402


def at(h, m=0):
    return datetime.datetime(2026, 11, 11, h, m)


class QuietTests(unittest.TestCase):
    def test_over_midnight(self):
        self.assertTrue(speaker.in_quiet(at(23), "22:30", "07:00"))
        self.assertTrue(speaker.in_quiet(at(6, 59), "22:30", "07:00"))
        self.assertFalse(speaker.in_quiet(at(7), "22:30", "07:00"))
        self.assertFalse(speaker.in_quiet(at(18), "22:30", "07:00"))

    def test_same_day_and_off(self):
        self.assertTrue(speaker.in_quiet(at(14), "13:00", "15:00"))
        self.assertFalse(speaker.in_quiet(at(14), "08:00", "08:00"))


class GreetingTests(unittest.TestCase):
    def facts(self, **kw):
        due = [{"title": "Buy milk"}, {"title": "Secret", "isHidden": True}, {"title": "Call mum"}]
        f = speaker.greeting_facts(at(18, 40), due, [], True, {"temp_c": 24.4, "icon": "sun"}, ["Walk"], "Vineeth")
        f.update(kw)
        return f

    def test_template(self):
        line = speaker.template_greeting(self.facts())
        self.assertIn("Good evening, Vineeth", line)
        self.assertIn("6:40 and 24 degrees, clear skies", line)
        self.assertIn("two things left today, starting with Buy milk", line)
        self.assertIn("Work is put away", line)
        self.assertNotIn("Secret", line)

    def test_nothing_due(self):
        line = speaker.template_greeting(self.facts(dueCount=0, dueToday=[], tempC=None, habitsLeft=[], chill=False))
        self.assertIn("Nothing else is asked of you today.", line)

    def test_clean_line(self):
        self.assertEqual(speaker.clean_line('<think>x</think> "**Welcome** home, sir."'), "Welcome home, sir.")

    def test_reminder_line(self):
        self.assertEqual(speaker.reminder_line({"title": "Pay rent", "body": "Reminder"}),
                         "Pardon the interruption. A reminder: Pay rent.")


class SettingsTests(unittest.TestCase):
    def test_clean(self):
        s = speaker.clean_settings({"address": "aa:bb:cc:dd:ee:ff", "volume": 500, "speed": 3})
        self.assertEqual(s["address"], "AA:BB:CC:DD:EE:FF")
        self.assertEqual(s["volume"], 100)
        self.assertEqual(s["speed"], 1.4)
        with self.assertRaises(ValueError):
            speaker.clean_settings({"quietStart": "25:00"})
        with self.assertRaises(ValueError):
            speaker.clean_settings({"address": "nope"})

    def test_save_roundtrip(self):
        speaker.save_settings({"callMe": "sir", "greet": False})
        s = speaker.get_settings()
        self.assertEqual(s["callMe"], "sir")
        self.assertFalse(s["greet"])


class LinkTests(unittest.TestCase):
    def test_audio_links(self):
        objects = {
            "/org/bluez/hci0/dev_AA": {"org.bluez.Device1": {"Address": "AA:AA:AA:AA:AA:AA", "Connected": True, "Paired": True, "Alias": "Soundbar"}},
            "/org/bluez/hci0/dev_AA/fd0": {"org.bluez.MediaTransport1": {}},
            "/org/bluez/hci0/dev_BB": {"org.bluez.Device1": {"Address": "BB:BB:BB:BB:BB:BB", "Connected": True, "Paired": True}},
        }
        links = speaker.audio_links(objects, "aa:aa:aa:aa:aa:aa", "BB:BB:BB:BB:BB:BB")
        self.assertTrue(links["soundbar"]["connected"])
        self.assertTrue(links["soundbar"]["audio"])
        self.assertEqual(links["soundbar"]["name"], "Soundbar")
        self.assertFalse(links["phoneAudio"])


class WifiTests(unittest.TestCase):
    def test_ethernet_up(self):
        root = Path(tempfile.mkdtemp())
        (root / "eth0").mkdir()
        (root / "eth0" / "carrier").write_text("0\n")
        (root / "wlan0").mkdir()
        self.assertFalse(speaker.ethernet_up(str(root)))
        (root / "eth0" / "carrier").write_text("1\n")
        self.assertTrue(speaker.ethernet_up(str(root)))

    def test_refuses_off_without_cable(self):
        from unittest import mock
        with mock.patch.object(speaker, "ethernet_up", return_value=False):
            with self.assertRaises(ValueError):
                speaker.set_wifi(False)


if __name__ == "__main__":
    unittest.main()


class SurroundTests(unittest.TestCase):
    def test_settings(self):
        self.assertEqual(speaker.clean_settings({"surround": "movie"})["surround"], "movie")
        self.assertEqual(speaker.clean_settings({"surround": ""})["surround"], "off")
        with self.assertRaises(ValueError):
            speaker.clean_settings({"surround": "atmos"})

    def test_device(self):
        a = "AA:BB:CC:DD:EE:FF"
        self.assertEqual(speaker.output_device(a, "off", True), f"bluealsa:DEV={a},PROFILE=a2dp")
        self.assertEqual(speaker.output_device(a, "movie", False), f"bluealsa:DEV={a},PROFILE=a2dp")
        self.assertEqual(speaker.output_device(a, "movie", True),
                         f"sage_surround:DEV={a},WIDTH=0.7,SPACE=0.5,DIALOG=4,BASS=3")

    def test_failure_falls_back_until_switched(self):
        sp = speaker.Speaker()
        settings = dict(speaker.DEFAULTS, address="AA:BB:CC:DD:EE:FF", surround="music")
        old = speaker.surround_ready
        speaker.surround_ready = lambda: True
        try:
            self.assertTrue(sp.device(settings).startswith("sage_surround"))
            sp._surround_failed("test")
            self.assertTrue(sp.device(settings).startswith("bluealsa"))
            sp.device(dict(settings, surround="off"))
            self.assertTrue(sp.device(settings).startswith("sage_surround"))
        finally:
            speaker.surround_ready = old


@unittest.skipUnless(__import__("shutil").which("gcc"), "needs gcc to build the plugin")
class SurroundPluginTests(unittest.TestCase):
    """Builds audio/sage_surround.c and runs it through the LADSPA API directly."""

    @classmethod
    def setUpClass(cls):
        import ctypes
        import subprocess
        src = Path(__file__).resolve().parent.parent / "audio" / "sage_surround.c"
        cls.so = Path(tempfile.mkdtemp()) / "sage_surround.so"
        subprocess.run(["gcc", "-O2", "-fPIC", "-shared", "-o", str(cls.so), str(src), "-lm"], check=True)
        lib = ctypes.CDLL(str(cls.so))
        H = ctypes.c_void_p
        F = ctypes.POINTER(ctypes.c_float)

        class Desc(ctypes.Structure):
            _fields_ = [("id", ctypes.c_ulong), ("label", ctypes.c_char_p), ("props", ctypes.c_int),
                        ("name", ctypes.c_char_p), ("maker", ctypes.c_char_p), ("copy", ctypes.c_char_p),
                        ("count", ctypes.c_ulong), ("pd", H), ("pn", H), ("ph", H), ("impl", H),
                        ("instantiate", ctypes.CFUNCTYPE(H, H, ctypes.c_ulong)),
                        ("connect", ctypes.CFUNCTYPE(None, H, ctypes.c_ulong, F)),
                        ("activate", ctypes.CFUNCTYPE(None, H)),
                        ("run", ctypes.CFUNCTYPE(None, H, ctypes.c_ulong)),
                        ("run_adding", H), ("set_gain", H), ("deactivate", H),
                        ("cleanup", ctypes.CFUNCTYPE(None, H))]
        lib.ladspa_descriptor.restype = ctypes.POINTER(Desc)
        cls.desc = lib.ladspa_descriptor(0)
        cls.ctypes = ctypes

    def process(self, left, right, width, space, dialog, bass):
        ct, d = self.ctypes, self.desc.contents
        n = len(left)
        controls = [ct.c_float(v) for v in (width, space, dialog, bass)]
        ins = [(ct.c_float * n)(*left), (ct.c_float * n)(*right)]
        outs = [(ct.c_float * n)(), (ct.c_float * n)()]
        h = d.instantiate(ct.addressof(d), 48000)
        for i, c in enumerate(controls):
            d.connect(h, i, ct.pointer(c))
        for i, buf in enumerate(ins + outs):
            d.connect(h, 4 + i, ct.cast(buf, ct.POINTER(ct.c_float)))
        d.activate(h)
        d.run(h, n)
        d.cleanup(h)
        return list(outs[0]), list(outs[1])

    def signal(self):
        import math
        n = 9600
        left = [0.4 * math.sin(2 * math.pi * 1000 * i / 48000) + 0.4 * math.sin(2 * math.pi * 80 * i / 48000) for i in range(n)]
        right = [0.4 * math.sin(2 * math.pi * 440 * i / 48000) + 0.4 * math.sin(2 * math.pi * 80 * i / 48000) for i in range(n)]
        return left, right

    def test_neutral_is_untouched(self):
        left, right = self.signal()
        ol, orr = self.process(left, right, 0, 0, 0, 0)
        self.assertLess(max(abs(a - b) for a, b in zip(ol + orr, left + right)), 1e-5)

    def test_movie_is_wider_and_never_clips(self):
        left, right = self.signal()
        ol, orr = self.process(left, right, 0.7, 0.5, 4, 3)
        tail = slice(2400, None)
        def ratio(l, r):
            mid = sum(((a + b) / 2) ** 2 for a, b in zip(l[tail], r[tail]))
            side = sum(((a - b) / 2) ** 2 for a, b in zip(l[tail], r[tail]))
            return side / mid
        self.assertGreater(ratio(ol, orr), 1.5 * ratio(left, right))
        self.assertLessEqual(max(abs(v) for v in ol + orr), 1.0)
        # full-scale input still stays inside the limit
        ol, orr = self.process([1.0] * 4800, [-1.0] * 4800, 1, 0.7, 9, 9)
        self.assertLessEqual(max(abs(v) for v in ol + orr), 1.0)


class LatencyTests(unittest.TestCase):
    def test_settings(self):
        self.assertEqual(speaker.DEFAULTS["latency"], "low")
        self.assertEqual(speaker.clean_settings({"latency": "lowest"})["latency"], "lowest")
        with self.assertRaises(ValueError):
            speaker.clean_settings({"latency": "zero"})

    def test_command(self):
        cmd = speaker.passthrough_cmd("bluealsa:DEV=AA:BB:CC:DD:EE:FF,PROFILE=a2dp", "11:22:33:44:55:66", "low")
        self.assertIn("--pcm-buffer-time=200000", cmd)
        self.assertIn("--pcm-period-time=50000", cmd)
        self.assertEqual(cmd[-1], "11:22:33:44:55:66")
        self.assertIn("--pcm-buffer-time=500000", speaker.passthrough_cmd("x", "y", "steady"))


class GreetGapTests(unittest.TestCase):
    def test_once_every_six_hours(self):
        self.assertTrue(speaker.greet_due(0, 1_000_000))
        self.assertFalse(speaker.greet_due(1_000_000, 1_000_000 + 5.9 * 3600, 6))
        self.assertTrue(speaker.greet_due(1_000_000, 1_000_000 + 6 * 3600, 6))

    def test_stored(self):
        speaker._store_greet_time(1234)
        self.assertEqual(speaker.get_settings()["lastGreetAt"], 1234)
        # a settings save from the app keeps it
        speaker.save_settings({"greet": True})
        self.assertEqual(speaker.get_settings()["lastGreetAt"], 1234)

    def test_template_says_sir_without_a_name(self):
        f = speaker.greeting_facts(at(19), [], [], False, None, [], "")
        self.assertIn("Good evening, sir.", speaker.template_greeting(f))
