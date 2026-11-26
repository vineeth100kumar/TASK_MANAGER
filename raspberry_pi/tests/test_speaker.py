"""Tests for speaker.py's pure rules: quiet hours, the greeting, settings, audio links.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import datetime
import os
import sys
import tempfile
import unittest
from unittest import mock
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


class ReactionTests(unittest.TestCase):
    def test_reaction_line_and_regex(self):
        self.assertTrue(speaker._REACTION_RE.match("Reacted \u2764 to \u201cok\u201d"))
        self.assertFalse(speaker._REACTION_RE.match("Fuck yeah"))
        self.assertIn("Supreet", speaker.notice_line("reaction", "Supreet Yadav"))
        self.assertEqual(speaker.clean_settings({"callHoldMinutes": 999})["callHoldMinutes"], 60)


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


class WakeAndReadAloudTests(unittest.TestCase):
    def test_wake_briefing_names_the_day(self):
        f = speaker.greeting_facts(datetime.datetime(2026, 11, 14, 7, 0), [{"title": "Gym"}, {"title": "Report"}], [{"title": "Tax"}], False, None, [], "Vineeth")
        line = speaker.template_wake(f)
        self.assertIn("Good morning, Vineeth", line)
        self.assertIn("Gym, Report", line)
        self.assertIn("overdue", line)

    def test_reminders_read_aloud_by_default_unless_off_or_hidden(self):
        sp = speaker.Speaker()
        spoken = []
        sp.say_soon = lambda text, kind="line", **kw: spoken.append(text)
        sp.phone = type("P", (), {"available": True, "home": True})()
        orig = speaker.has_output
        speaker.has_output = lambda s: True
        try:
            sp.on_reminder({"customFields": {"readAloud": False}}, {"title": "Quiet"})
            sp.on_reminder({"customFields": {}, "isHidden": True}, {"title": "Secret"})
            sp.on_reminder({"customFields": {}}, {"title": "Pills"})
        finally:
            speaker.has_output = orig
        self.assertEqual(len(spoken), 1)
        self.assertIn("Pills", spoken[0])



class HonestHeraldTests(unittest.TestCase):
    def test_standing_verdict_follows_the_facts(self):
        self.assertEqual(speaker.standing_facts(0, 2, 4, 0)["verdict"], "good")
        self.assertEqual(speaker.standing_facts(0, 2, 1, 0)["verdict"], "fine")
        self.assertEqual(speaker.standing_facts(2, 2, 5, 0)["verdict"], "slipping")
        self.assertEqual(speaker.standing_facts(5, 2, 0, 1)["verdict"], "behind")

    def test_names_must_survive(self):
        self.assertTrue(speaker.names_ok("Sansa sent you a message.", ["Sansa Stark"]))
        self.assertFalse(speaker.names_ok("Someone sent you a message.", ["Sansa Stark"]))
        self.assertTrue(speaker.names_ok("anything", []))

    def test_prompts_are_honest_not_gushing(self):
        for prompt in (speaker.DAILY_PROMPTS["welcome"], speaker.DAILY_PROMPTS["goodbye"], speaker.WIND_PROMPT, speaker.NOTICE_PROMPT):
            self.assertIn("honest", prompt)
            self.assertIn("do not flatter", prompt.replace("You do not flatter", "do not flatter"))
        self.assertIn("never guess", speaker.NOTICE_PROMPT)

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
        # The Pi is only the phone's notification companion unless SAGE_PHONE_SPEAKER=1.
        self.assertFalse(speaker.clean_settings({"phoneSpeaker": True})["phoneSpeaker"])
        with mock.patch.object(speaker, "PHONE_SPEAKER_ALLOWED", True):
            self.assertTrue(speaker.clean_settings({"phoneSpeaker": True})["phoneSpeaker"])


class GreetGapTests(unittest.TestCase):
    def test_once_every_six_hours(self):
        self.assertTrue(speaker.greet_due(0, 1_000_000))
        self.assertFalse(speaker.greet_due(1_000_000, 1_000_000 + 5.9 * 3600, 6))
        self.assertTrue(speaker.greet_due(1_000_000, 1_000_000 + 6 * 3600, 6))

    def test_briefing_key_ignores_time_and_weather(self):
        f = speaker.greeting_facts(at(9), [{"title": "Gym"}], [], False, {"temp_c": 20, "icon": "sun"}, [], "")
        g = speaker.greeting_facts(at(15), [{"title": "Gym"}], [], False, {"temp_c": 31, "icon": "rain"}, [], "")
        h = speaker.greeting_facts(at(15), [{"title": "Gym"}, {"title": "Tax"}], [], False, None, [], "")
        self.assertEqual(speaker.briefing_key(f, "d"), speaker.briefing_key(g, "d"))
        self.assertNotEqual(speaker.briefing_key(f, "d"), speaker.briefing_key(h, "d"))
        self.assertNotEqual(speaker.briefing_key(f, "d"), speaker.briefing_key(f, "e"))

    def test_welcome_is_new_each_time(self):
        import asyncio
        sp = speaker.Speaker()
        settings = {**speaker.get_settings(), "witty": False, "callMe": "sir"}
        seen = [asyncio.run(sp._fresh("welcome", settings)) for _ in range(len(speaker.DAILY_LINES["welcome"]))]
        self.assertEqual(len(set(seen)), len(seen))      # nothing repeats until the list is used up

    def test_groq_line_that_repeats_is_dropped(self):
        import asyncio
        sp = speaker.Speaker()
        settings = {**speaker.get_settings(), "witty": True, "callMe": ""}
        sp._recent["goodbye"].append("Same old line, sir.")
        with mock.patch.object(sp, "_ai_line", mock.AsyncMock(return_value="Same old line, sir.")):
            text = asyncio.run(sp._fresh("goodbye", settings))
        self.assertNotEqual(text, "Same old line, sir.")

    def test_mixer_control_choice_and_master_clamp(self):
        text = "Simple mixer control 'Mic',0\nSimple mixer control 'PCM',0\nSimple mixer control 'Speaker',0"
        self.assertEqual(speaker.pick_mixer_control(text), "PCM")
        self.assertEqual(speaker.pick_mixer_control("Simple mixer control 'Weird',0"), "Weird")
        self.assertEqual(speaker.pick_mixer_control(""), "")
        self.assertEqual(speaker.clean_settings({"masterVolume": 1})["masterVolume"], 5)
        self.assertEqual(speaker.clean_settings({"masterVolume": 500})["masterVolume"], 100)

    def test_herald_explains_a_silent_arrival(self):
        sp = speaker.Speaker()
        sp.loop = object()
        speaker.save_settings({"greet": False})
        sp.on_arrival(3600)
        self.assertEqual(sp._herald[-1]["action"], "silent")
        self.assertIn("off", sp._herald[-1]["why"])
        speaker.save_settings({"greet": True, "goodbye": False})
        sp.on_leave()
        self.assertEqual(sp._herald[-1]["action"], "silent")
        speaker.save_settings({"goodbye": True})

    def test_leave_instantly_default_and_toggle(self):
        self.assertTrue(speaker.get_settings()["leaveInstantly"])
        self.assertFalse(speaker.clean_settings({"leaveInstantly": False})["leaveInstantly"])

    def test_brief_only_after_a_long_absence(self):
        self.assertFalse(speaker.brief_due(20 * 60, 0, 1_000_000, 2.5))
        self.assertTrue(speaker.brief_due(3 * 3600, 1_000_000, 1_000_100, 2.5))
        self.assertTrue(speaker.brief_due(0, 0, 1_000_000, 2.5))   # unknown away time, never briefed
        self.assertFalse(speaker.brief_due(0, 1_000_000, 1_000_100, 2.5))

    def test_made_ahead_line_expires_when_the_part_of_day_changes(self):
        import pathlib, tempfile, time
        sp = speaker.Speaker()
        wav = pathlib.Path(tempfile.mkdtemp()) / "r.wav"
        wav.write_bytes(b"RIFF" + b"\0" * 5000)
        now = sp.now()
        sp._ready["welcome"] = ("Good evening, sir.", wav, time.time(), speaker.part_of_day(now.hour))
        self.assertTrue(sp._ready_ok("welcome"))
        other = "night" if speaker.part_of_day(now.hour) != "night" else "morning"
        sp._ready["welcome"] = ("Good evening, sir.", wav, time.time(), other)
        self.assertFalse(sp._ready_ok("welcome"))

    def test_made_ahead_line_is_kept_with_age_but_not_across_voice_changes(self):
        import pathlib, tempfile, time
        sp = speaker.Speaker()
        wav = pathlib.Path(tempfile.mkdtemp()) / "r.wav"
        wav.write_bytes(b"RIFF" + b"\0" * 5000)
        part = speaker.part_of_day(sp.now().hour)
        fp = speaker.settings_fp(speaker.get_settings())
        sp._ready["welcome"] = ("Hello.", wav, time.time() - 20 * 3600, part, fp)
        self.assertTrue(sp._ready_ok("welcome"))
        sp._ready["welcome"] = ("Hello.", wav, time.time(), part, "other")
        self.assertFalse(sp._ready_ok("welcome"))

    def test_weather_counts_as_changed_from_a_degree_or_a_new_sky(self):
        made = {"temp_c": 24.0, "icon": "sun"}
        self.assertFalse(speaker.weather_changed(made, {"temp_c": 24.5, "icon": "sun"}))
        self.assertFalse(speaker.weather_changed(made, {"temp_c": 23.1, "icon": "sun"}))
        self.assertTrue(speaker.weather_changed(made, {"temp_c": 25.0, "icon": "sun"}))
        self.assertTrue(speaker.weather_changed(made, {"temp_c": 24.0, "icon": "rain"}))
        self.assertFalse(speaker.weather_changed(made, None))
        self.assertTrue(speaker.weather_changed(None, made))

    def test_daily_prompts_forbid_times_and_ask_for_butler_voice(self):
        for kind in speaker.DAILY_PROMPTS:
            p = speaker.DAILY_PROMPTS[kind]
            self.assertIn("Alfred", p)
            self.assertIn("Never state a clock time", p)
            self.assertIn("avoid", p)

    def test_chime_only_for_coming_and_going(self):
        self.assertEqual(speaker.chime_for("welcome"), "up")
        self.assertEqual(speaker.chime_for("greeting"), "up")
        self.assertEqual(speaker.chime_for("goodbye"), "down")
        for kind in ("notice", "reminder", "command", "event", "line", "test", "brief"):
            self.assertEqual(speaker.chime_for(kind), "", kind)

    def test_fresh_fallback_skips_recent(self):
        lines = speaker.DAILY_LINES["goodbye"]
        recent = [l.replace("{name}", "") for l in lines[:-1]]
        self.assertEqual(speaker.fresh_fallback("goodbye", "", recent), lines[-1].replace("{name}", ""))

    def test_daily_line_is_stable_per_day(self):
        a = speaker.daily_line("goodbye", "2026-11-14", "sir")
        self.assertEqual(a, speaker.daily_line("goodbye", "2026-11-14", "sir"))
        self.assertTrue(a)

    def test_cache_path_changes_with_voice_and_ok_check(self):
        s = speaker.get_settings()
        p1 = speaker.speech_cache_path("welcome", "2026-11-14", "Hi.", s)
        p2 = speaker.speech_cache_path("welcome", "2026-11-14", "Hi.", {**s, "voice": "am_adam"})
        self.assertNotEqual(p1, p2)
        import tempfile, pathlib
        d = pathlib.Path(tempfile.mkdtemp())
        good = d / "a.wav"; good.write_bytes(b"RIFF" + b"\0" * 5000)
        bad = d / "b.wav"; bad.write_bytes(b"junk")
        self.assertTrue(speaker.cache_ok(good))
        self.assertFalse(speaker.cache_ok(bad))
        self.assertFalse(speaker.cache_ok(d / "none.wav"))

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
        self.assertEqual(phone_link.ble_retry_gap(1), 5)
        self.assertEqual(phone_link.ble_retry_gap(3), 20)
        self.assertEqual(phone_link.ble_retry_gap(20), 60)
        self.assertEqual(phone_link.ble_retry_gap(1, busy=True), 600)
        self.assertEqual(phone_link.ble_retry_gap(0, busy=True), 5)


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


class HeraldNoticeTest(unittest.TestCase):

    def test_notice_kind_and_fallback_line(self):
        assert speaker.notice_kind("net.whatsapp.WhatsApp") == "whatsapp"
        assert speaker.notice_kind("com.google.Gmail") == "email"
        assert speaker.notice_kind("com.apple.MobileSMS") == "message"
        assert speaker.notice_kind("com.burbn.instagram") == "message"
        assert speaker.notice_kind("in.swiggy.ios") == "ignored"
        assert speaker.notice_kind("com.unknown.app") == ""
        line = speaker.notice_line("whatsapp", "Shreyansh")
        assert "Shreyansh" in line and "WhatsApp" in line
        assert "email" in speaker.notice_line("email", "Asha").lower() and "Asha" in speaker.notice_line("email", "Asha")
        assert "battery" in speaker.notice_line("battery", "")
        assert "message" in speaker.notice_line("message", "Sansa").lower() and "Sansa" in speaker.notice_line("message", "Sansa")


    def test_notice_only_when_home_and_once_per_sender(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=False)
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Shreyansh"})
            assert not run.called
            s.phone.home = True
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Shreyansh"})
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Shreyansh"})
            assert run.call_count == 1
            s.on_phone_battery(15); s.on_phone_battery(12)
            assert run.call_count == 2
            s.on_phone_battery(40); s.on_phone_battery(18)
            assert run.call_count == 3
            for c in run.call_args_list:
                c.args[0].close()

    def test_notice_window_is_five_minutes_then_fresh(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=True)
        n = {"appId": "net.whatsapp.WhatsApp", "title": "Shreyansh"}
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.time, "time") as clock, \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            clock.return_value = 1000.0
            s.on_phone_notification(n)
            clock.return_value = 1000.0 + 299
            s.on_phone_notification(n)
            assert run.call_count == 1
            clock.return_value = 1000.0 + 301
            s.on_phone_notification(n)
            assert run.call_count == 2
            for c in run.call_args_list:
                c.args[0].close()

    def _herald(self, **settings):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=True)
        s._stats = {}
        return s, speaker.get_settings() | settings

    def test_one_line_per_sender_message_then_reaction(self):
        s, st = self._herald()
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker, "get_settings", return_value=st), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Arya", "message": "hi"})
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Arya", "message": "Liked \u201chi\u201d"})
            assert run.call_count == 1
            for c in run.call_args_list:
                c.args[0].close()

    def test_old_senders_are_forgotten(self):
        s, st = self._herald()
        s._notice_at = {f"p{i}": 1.0 for i in range(50)}
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker, "get_settings", return_value=st), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Arya"})
            assert len(s._notice_at) == 1
            for c in run.call_args_list:
                c.args[0].close()

    def test_regulars_only_and_stranger_window(self):
        s, st = self._herald(announceRegularsOnly=True)
        n = {"appId": "net.whatsapp.WhatsApp", "title": "Bran"}
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker, "get_settings", return_value=st), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_phone_notification(n)                    # a stranger: counted, not spoken
            assert run.call_count == 0
            for _ in range(4):
                s.on_phone_notification(n)                # now regular
            assert run.call_count == 1
            for c in run.call_args_list:
                c.args[0].close()
        s2, st2 = self._herald()
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker, "get_settings", return_value=st2), \
             mock.patch.object(speaker.time, "time") as clock, \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            clock.return_value = 1000.0
            s2.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Rickon"})
            clock.return_value = 1000.0 + 400             # past 5 min, inside 15: a stranger waits
            s2.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Rickon"})
            assert run.call_count == 1
            clock.return_value = 1000.0 + 901
            s2.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Rickon"})
            assert run.call_count == 2
            for c in run.call_args_list:
                c.args[0].close()

    def test_missed_call_makes_one_task(self):
        s, st = self._herald()
        call = {"appId": "com.apple.mobilephone", "category": "missed call", "title": "Sansa"}
        with mock.patch.object(speaker, "get_settings", return_value=st), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_phone_notification(call)
            s.on_phone_notification(call)
            s.on_phone_notification({**call, "title": "+91 98765 43210"})
            assert run.call_count == 1
            for c in run.call_args_list:
                c.args[0].close()
        s3, st3 = self._herald(callBackTasks=False)
        with mock.patch.object(speaker, "get_settings", return_value=st3), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s3.on_phone_notification(call)
            assert run.call_count == 0

    def test_battery_stages_and_away_delay(self):
        w = ""
        seen = []
        for level in (25, 18, 12, 8, 7, 40, 18):
            stage, w = speaker.battery_next(level, w)
            seen.append(stage)
        assert seen == ["", "low", "", "critical", "", "", "low"]
        assert speaker.away_delay(80, True, 30, 300) == 30
        assert speaker.away_delay(4, True, 30, 300) == 300
        assert speaker.away_delay(12, True, 30, 300) == 30
        assert speaker.away_delay(None, True, 30, 300) == 30
        assert speaker.away_delay(80, False, 30, 300) == 300

    def test_no_goodbye_when_phone_nearly_dead(self):
        s, st = self._herald()
        s.phone = mock.Mock(home=True, battery=4)
        with mock.patch.object(speaker, "get_settings", return_value=st), \
             mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_leave()
            assert not run.called

    def test_back_online_picks_strongest_reason(self):
        outage = {"reasons": [{"kind": "restart"}, {"kind": "update"}, {"kind": "reboot"}]}
        self.assertEqual(speaker._back_online_kind(outage), "update")
        self.assertEqual(speaker._back_online_kind({"reasons": [{"kind": "crash"}]}), "crash")
        self.assertEqual(speaker._back_online_kind({"reasons": [{"kind": "power"}, {"kind": "update"}]}), "power")
        self.assertEqual(speaker._back_online_kind({}), "restart")

    def test_whats_new_fallback(self):
        self.assertEqual(speaker._whats_new_fallback([]), "")
        self.assertEqual(speaker._whats_new_fallback(["Fix: Herald tells news", "B"]), "New since last time: Herald tells news; B.")
        self.assertEqual(speaker._update_changes({"reasons": [{"kind": "update"}]}), [])

    def test_back_online_only_when_home(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=False)
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_back_online({"reasons": [{"kind": "update"}]})
            self.assertFalse(run.called)
            self.assertEqual(s._herald[-1]["action"], "silent")
            s.phone = mock.Mock(home=True)
            s.on_back_online({"reasons": [{"kind": "update"}]})
            self.assertEqual(run.call_count, 1)
            for c in run.call_args_list:
                c.args[0].close()

    def test_back_online_blocks_welcome_right_after(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=True, available=True)
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_back_online({"reasons": [{"kind": "restart"}]})
            s.on_arrival(60)   # phone link settles seconds later
            self.assertEqual(run.call_count, 1)
            self.assertEqual(s._herald[-1]["action"], "silent")
            for c in run.call_args_list:
                c.args[0].close()

    def test_briefing_arrival_blocks_a_second_greeting(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=True, available=True)
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_arrival(3 * 3600)
            self.assertEqual(s._herald[-1]["action"], "briefing")
            self.assertGreater(s._last_welcome_at, 0)
            before = run.call_count
            s.on_arrival(10)   # Bluetooth flap moments later
            self.assertEqual(run.call_count, before)
            self.assertEqual(s._herald[-1]["action"], "silent")
            self.assertIn("greeting was said", s._herald[-1]["why"])
            for c in run.call_args_list:
                c.args[0].close()

    def test_recap_not_refired_by_a_flap(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=True, available=True)
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_arrival(3 * 3600)
            first = run.call_count
            s.on_arrival(3 * 3600)
            self.assertEqual(run.call_count, first)
            for c in run.call_args_list:
                c.args[0].close()

    def test_back_online_blocks_briefing_right_after(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=True, available=True)
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            self.assertTrue(s.on_back_online({"reasons": [{"kind": "update"}]}))
            before = run.call_count
            s.on_arrival(3 * 3600)   # would be a briefing
            self.assertEqual(s._herald[-1]["action"], "silent")
            # no greeting scheduled (only a recap may be)
            self.assertLessEqual(run.call_count - before, 1)
            self.assertNotEqual(s._herald[-1]["action"], "briefing")
            for c in run.call_args_list:
                c.args[0].close()

    def test_spam_filter_skips_phone_numbers(self):
        s = speaker.Speaker()
        s.loop = mock.Mock()
        s.phone = mock.Mock(home=True)
        with mock.patch.object(speaker, "has_output", return_value=True), \
             mock.patch.object(speaker, "in_quiet", return_value=False), \
             mock.patch.object(speaker.asyncio, "run_coroutine_threadsafe") as run:
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "+91 98765 43210"})
            assert not run.called
            s.on_phone_notification({"appId": "net.whatsapp.WhatsApp", "title": "Sansa"})
            assert run.call_count == 1
            s.on_phone_notification({"appId": "in.swiggy.ios", "title": "Your order"})
            assert run.call_count == 1
            s.on_phone_notification({"appId": "com.burbn.instagram", "title": "Arya"})
            assert run.call_count == 2
            for c in run.call_args_list:
                c.args[0].close()


class CommandLineTests(unittest.TestCase):
    def test_fallback_line_keeps_the_fact(self):
        line = speaker.command_line("alarm set for 6:30 AM", "sir")
        self.assertIn("Alarm set for 6:30 AM", line)
        self.assertIn("sir", line)

    def test_ai_line_must_keep_numbers(self):
        self.assertTrue(speaker.command_line_ok("Your 6:30 alarm is set, sir.", "alarm set for 6:30 AM"))
        self.assertFalse(speaker.command_line_ok("Your alarm is set, sir.", "alarm set for 6:30 AM"))
