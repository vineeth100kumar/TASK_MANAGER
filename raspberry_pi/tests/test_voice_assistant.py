import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import voice_assistant as va  # noqa: E402

P = va.parse_device


def i(_kind, /, **args):
    return {"intent": _kind, **args}


class NormaliseTests(unittest.TestCase):
    def test_filler_numbers_and_misheard_words(self):
        self.assertEqual(va.normalise("Could you please turn the lights to forty five percent?"), "turn the lights to 45 percent")
        self.assertEqual(va.normalise("Sage, start the stop watch"), "start the stopwatch")
        self.assertEqual(va.normalise("volum up"), "volume up")
        self.assertEqual(va.normalise("lites off"), "lights off")


class Phrasings(unittest.TestCase):
    CASES = {
        # stopwatch
        "start the stopwatch": i("stopwatch", action="start"),
        "start stopwatch": i("stopwatch", action="start"),
        "can you begin the stop watch": i("stopwatch", action="start"),
        "stop the stopwatch": i("stopwatch", action="pause"),
        "pause stopwatch": i("stopwatch", action="pause"),
        "reset the stopwatch": i("stopwatch", action="reset"),
        "stopwatch lap": i("stopwatch", action="lap"),
        "lap": i("stopwatch", action="lap"),
        "resume the stopwatch": i("stopwatch", action="start"),
        # screens
        "show the stopwatch": i("screen", name="STOPWATCH"),
        "show spotify on the clock": i("screen", name="SPOTIFY"),
        "switch the clock to the system screen": i("screen", name="SYSTEM"),
        "show tasks on the clock": i("screen", name="TASKS"),
        "show me the tasks on the display": i("screen", name="TASKS"),
        "go back to the clock": i("screen", name="CLOCK"),
        "show the world clock": i("screen", name="WORLD"),
        "next screen": i("screen", name="NEXT"),
        "stopwatch": i("screen", name="STOPWATCH"),
        "kill the lights": i("lights", state="off"),
        "make it a bit brighter in here": i("lights", state="on", delta=25),
        "turn on the aurora": i("lights", mode="AURORA", state="on"),
        "lap time": i("stopwatch", action="lap"),
        "music off": i("music", action="pause"),
        "turn the music up a bit": i("volume", delta=15),
        "put on the warm light": i("lights", mode="WARM", state="on"),
        "who is singing": i("now_playing"),
        "what's this song called": i("now_playing"),
        "skip it": i("music", action="next"),
        "take me back to the clock": i("screen", name="CLOCK"),
        "volume fifty": i("volume", level=50),
        # lights
        "turn off the lights": i("lights", state="off"),
        "lights off": i("lights", state="off"),
        "switch the lights off please": i("lights", state="off"),
        "lights out": i("lights", state="off"),
        "turn on the lights": i("lights", state="on"),
        "lights on": i("lights", state="on"),
        "warm lights": i("lights", mode="WARM", state="on"),
        "set the lights to breathe": i("lights", mode="BREATHE", state="on"),
        "aurora lights": i("lights", mode="AURORA", state="on"),
        "lights to 40 percent": i("lights", state="on", brightness=40),
        "set the light brightness to forty": i("lights", state="on", brightness=40),
        "make the lights brighter": i("lights", state="on", delta=25),
        "lights down a bit": i("lights", state="on", delta=-25),
        "dim the lights": i("lights", state="on", brightness=35),
        "lights to full": i("lights", state="on", brightness=100),
        "lights auto": i("lights", mode="AUTO", state="on"),
        # music
        "pause the music": i("music", action="pause"),
        "pause": i("music", action="pause"),
        "stop the music": i("music", action="pause"),
        "resume the music": i("music", action="play"),
        "play the music": i("music", action="play"),
        "play": i("music", action="play"),
        "continue playing": i("music", action="play"),
        "next song": i("music", action="next"),
        "skip": i("music", action="next"),
        "skip this song": i("music", action="next"),
        "previous song": i("music", action="previous"),
        "go back": i("music", action="previous"),
        "shuffle on": i("music", action="shuffle_on"),
        "turn shuffle off": i("music", action="shuffle_off"),
        "play coldplay": i("music", action="unsupported"),
        # volume
        "volume up": i("volume", delta=15),
        "turn it up": i("volume", delta=15),
        "louder": i("volume", delta=15),
        "turn the volume down": i("volume", delta=-15),
        "quieter please": i("volume", delta=-15),
        "volume to 40": i("volume", level=40),
        "set the volume to forty percent": i("volume", level=40),
        "mute": i("volume", mute=True),
        "unmute": i("volume", mute=False),
        "max volume": i("volume", level=100),
        # now playing
        "what's playing": i("now_playing"),
        "what song is this": i("now_playing"),
        "who sings this": i("now_playing"),
        # modes
        "work mode": i("mode", name="work"),
        "switch to chill mode": i("mode", name="chill"),
        "chill mode on": i("mode", name="chill"),
        "auto mode": i("mode", name="auto"),
        # briefing
        "good morning": i("briefing"),
        "morning briefing": i("briefing"),
        "brief me": i("briefing"),
        "give me the briefing": i("briefing"),
        "what's my day look like": i("briefing"),
    }

    def test_each_phrasing(self):
        for text, want in self.CASES.items():
            self.assertEqual(P(text), want, text)

    def test_unrelated_speech_is_not_a_device_command(self):
        for text in ("remind me to call mom tomorrow at 5", "what is the weather", "add milk to my list", "mark gym as done", "what's on today", "show my tasks", ""):
            self.assertIsNone(P(text), text)


class CheckTests(unittest.TestCase):
    def test_good_answers_pass(self):
        self.assertEqual(va.check_intent({"intent": "lights", "brightness": 40}), {"intent": "lights", "brightness": 40})
        self.assertEqual(va.check_intent({"intent": "screen", "name": "tasks"})["name"], "TASKS")
        self.assertEqual(va.check_intent({"intent": "timer_start", "seconds": 600})["seconds"], 600)
        self.assertEqual(va.check_intent({"intent": "alarm_set", "time": "06:30", "days": [0, 1]})["days"], [0, 1])
        self.assertEqual(va.check_intent({"intent": "task"}), {"intent": "task"})

    def test_made_up_or_out_of_range_is_dropped(self):
        for bad in ({"intent": "lights", "brightness": 400}, {"intent": "screen", "name": "KITCHEN"},
                    {"intent": "timer_start", "seconds": 0}, {"intent": "alarm_set", "time": "25:00"},
                    {"intent": "alarm_set", "days": [9], "time": "06:00"}, {"intent": "music"},
                    {"intent": "volume", "level": "loud"}, "lights", None, {"intent": "lights"}):
            self.assertIsNone(va.check_intent(bad), bad)


class FrontDoor(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_speech_asks_instead_of_saving_a_task(self):
        import datetime
        res = await va.handle("flibber jabber purple", datetime.datetime(2026, 11, 15, 10, 0), use_ai=False)
        self.assertFalse(res["handled"])
        self.assertIn("sir", res["say"])

    async def test_ai_alarm_paraphrase_goes_back_to_the_app(self):
        import datetime
        from unittest import mock
        with mock.patch.object(va, "ask_groq", mock.AsyncMock(return_value={"intent": "timer_start", "seconds": 1800})):
            res = await va.handle("ping me in a bit under an hour", datetime.datetime(2026, 11, 15, 10, 0))
        self.assertEqual(res["command"], {"kind": "timer_start", "seconds": 1800})


class VolumeTests(unittest.IsolatedAsyncioTestCase):
    async def test_without_music_it_moves_the_pi_master_volume(self):
        from unittest import mock
        import speaker
        saved = {}
        fake = mock.Mock()
        fake.set_master = mock.AsyncMock()
        fake.master = {"ok": True, "why": ""}
        with mock.patch.object(va, "_spotify_in_use", return_value=False), \
             mock.patch.object(speaker, "get_settings", return_value={"masterVolume": 60}), \
             mock.patch.object(speaker, "save_settings", side_effect=lambda u: saved.update(u)), \
             mock.patch.object(speaker, "speaker", fake):
            res = await va.execute({"intent": "volume", "delta": 15})
        self.assertEqual(saved["masterVolume"], 75)
        self.assertEqual(res["say"], "Volume at 75 percent")

    async def test_reports_failure_honestly(self):
        from unittest import mock
        import speaker
        fake = mock.Mock()
        fake.set_master = mock.AsyncMock()
        fake.master = {"ok": False, "why": "Bluetooth soundbar has its own volume."}
        with mock.patch.object(va, "_spotify_in_use", return_value=False), \
             mock.patch.object(speaker, "get_settings", return_value={"masterVolume": 60}), \
             mock.patch.object(speaker, "save_settings", return_value={}), \
             mock.patch.object(speaker, "speaker", fake):
            res = await va.execute({"intent": "volume", "level": 30})
        self.assertFalse(res["ok"])
        self.assertIn("soundbar", res["say"])


if __name__ == "__main__":
    unittest.main()
