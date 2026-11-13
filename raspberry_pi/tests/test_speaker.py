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
                         f"sage_surround:DEV={a},WIDTH=0.7,SPACE=0.55,DIALOG=5,BASS=4,AIR=2,PUNCH=0.6")

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

    def process(self, left, right, width, space, dialog, bass, air=0, punch=0):
        ct, d = self.ctypes, self.desc.contents
        n = len(left)
        controls = [ct.c_float(v) for v in (width, space, dialog, bass, air, punch)]
        ins = [(ct.c_float * n)(*left), (ct.c_float * n)(*right)]
        outs = [(ct.c_float * n)(), (ct.c_float * n)()]
        h = d.instantiate(ct.addressof(d), 48000)
        for i, c in enumerate(controls):
            d.connect(h, i, ct.pointer(c))
        for i, buf in enumerate(ins + outs):
            d.connect(h, 6 + i, ct.cast(buf, ct.POINTER(ct.c_float)))
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
        ol, orr = self.process(left, right, 0.7, 0.55, 5, 4, 2, 0.6)
        tail = slice(2400, None)
        def ratio(l, r):
            mid = sum(((a + b) / 2) ** 2 for a, b in zip(l[tail], r[tail]))
            side = sum(((a - b) / 2) ** 2 for a, b in zip(l[tail], r[tail]))
            return side / mid
        self.assertGreater(ratio(ol, orr), 1.5 * ratio(left, right))
        self.assertLessEqual(max(abs(v) for v in ol + orr), 1.0)
        # full-scale input still stays inside the limit
        ol, orr = self.process([1.0] * 4800, [-1.0] * 4800, 1, 0.7, 9, 9, 9, 1)
        self.assertLessEqual(max(abs(v) for v in ol + orr), 1.0)

    def test_music_is_fuller_brighter_and_louder(self):
        import math
        n = 48000
        def tone(f, a):
            return [a * math.sin(2 * math.pi * f * i / 48000) for i in range(n)]
        def level(sig):
            tail = sig[12000:]
            return math.sqrt(sum(v * v for v in tail) / len(tail))
        for f in (100, 12000):  # bass and air both come up
            x = tone(f, 0.1)
            ol, _ = self.process(x, x, 0.55, 0.3, 1, 4, 3, 0.5)
            self.assertGreater(level(ol), 1.3 * level(x), f)
        # a quiet passage gets louder overall (punch), a loud one stays under the ceiling
        x = tone(1000, 0.05)
        ol, _ = self.process(x, x, 0.55, 0.3, 1, 4, 3, 0.5)
        self.assertGreater(level(ol), 1.3 * level(x))
        x = tone(100, 0.9)
        ol, orr = self.process(x, x, 0.55, 0.3, 1, 4, 3, 0.5)
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


class PassThroughOptionTests(unittest.TestCase):
    def test_off_by_default(self):
        self.assertFalse(speaker.DEFAULTS["phoneSpeaker"])
        # an old saved "passthrough: true" no longer turns it on
        self.assertNotIn("passthrough", speaker.DEFAULTS)
        self.assertTrue(speaker.clean_settings({"phoneSpeaker": True})["phoneSpeaker"])


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


class EventTests(unittest.TestCase):
    def test_event_line(self):
        first = lambda lines: lines[0]   # noqa: E731
        self.assertEqual(speaker.event_line("home", "sir", first), "Welcome back, sir.")
        self.assertEqual(speaker.event_line("home", "", first), "Welcome back.")
        self.assertEqual(speaker.event_line("nope"), "")
        for kind in speaker.EVENT_LINES:
            for line in speaker.EVENT_LINES[kind]:
                self.assertLessEqual(len(line.split()), 7, "event lines stay short")

    def test_event_due(self):
        self.assertTrue(speaker.event_due("soundbar", {}, 1000.0))
        self.assertFalse(speaker.event_due("soundbar", {"soundbar": 900.0}, 1000.0))
        self.assertTrue(speaker.event_due("soundbar", {"soundbar": 0.0}, 1000.0))

    def test_chimes_setting(self):
        self.assertTrue(speaker.DEFAULTS["chimes"])
        self.assertFalse(speaker.clean_settings({"chimes": False})["chimes"])


class PhoneBackoffTests(unittest.TestCase):
    def test_gap(self):
        import phone_link
        self.assertEqual(phone_link.ble_retry_gap(1), 30)
        self.assertEqual(phone_link.ble_retry_gap(3), 120)
        self.assertEqual(phone_link.ble_retry_gap(20), 600)
        self.assertEqual(phone_link.ble_retry_gap(1, busy=True), 600)
        self.assertEqual(phone_link.ble_retry_gap(0, busy=True), 30)


class MixTests(unittest.TestCase):
    def test_voice_mixed_and_music_ducked(self):
        import asyncio
        calls = []

        class Music:
            def mixable(self): return True
            async def duck(self): calls.append("duck"); return True
            async def play_into_sink(self, wav): calls.append("play"); return 0, ""
            async def unduck(self): calls.append("unduck")
            async def hold(self): calls.append("hold"); return False

        sp = speaker.Speaker()
        sp.music = Music()
        ok = asyncio.run(sp._play("/tmp/x.wav", dict(speaker.DEFAULTS)))
        self.assertTrue(ok)
        self.assertEqual(calls, ["duck", "play", "unduck"])


class SplitSpeakerTests(unittest.TestCase):
    HCI0 = "/org/bluez/hci0"
    HCI1 = "/org/bluez/hci1"

    def _objs(self, adapters, phone_path=None, phone_addr="", connected=False, paired=False, transport=False):
        class V:
            def __init__(self, v): self.value = v
        objs = {a: {"org.bluez.Adapter1": {"Address": V("00:00:00:00:00:0%d" % i)}} for i, a in enumerate(adapters)}
        if phone_path:
            objs[phone_path] = {"org.bluez.Device1": {
                "Address": V(phone_addr), "Paired": V(paired), "Connected": V(connected)}}
            if transport:
                objs[phone_path + "/fd0"] = {"org.bluez.MediaTransport1": {}}
        return objs

    def test_list_adapters(self):
        objs = self._objs([self.HCI1, self.HCI0])
        self.assertEqual(speaker.list_adapters(objs), [self.HCI0, self.HCI1])

    def test_pick_needs_a_second_adapter(self):
        self.assertEqual(speaker.pick_speaker_adapter([self.HCI0], self.HCI0), "")
        self.assertEqual(speaker.pick_speaker_adapter([self.HCI0, self.HCI1], self.HCI0), self.HCI1)

    def test_pick_honours_preferred(self):
        hci2 = "/org/bluez/hci2"
        self.assertEqual(speaker.pick_speaker_adapter([self.HCI0, self.HCI1, hci2], self.HCI0, "hci2"), hci2)
        # Preferred that isn't there falls back to the first non-companion.
        self.assertEqual(speaker.pick_speaker_adapter([self.HCI0, self.HCI1], self.HCI0, "hci9"), self.HCI1)

    def test_phone_on_adapter_audio(self):
        p = self.HCI1 + "/dev_AA"
        objs = self._objs([self.HCI0, self.HCI1], p, "AA:BB:CC:DD:EE:FF",
                          connected=True, paired=True, transport=True)
        got = speaker.phone_on_adapter(objs, self.HCI1, "aa:bb:cc:dd:ee:ff")
        self.assertTrue(got["paired"] and got["connected"] and got["audio"])
        # Looking on the companion adapter finds nothing.
        self.assertFalse(speaker.phone_on_adapter(objs, self.HCI0, "aa:bb:cc:dd:ee:ff")["connected"])

    def test_phone_on_adapter_no_phone(self):
        got = speaker.phone_on_adapter({}, "", "AA:BB:CC:DD:EE:FF")
        self.assertEqual(got, {"path": "", "paired": False, "connected": False, "audio": False})
