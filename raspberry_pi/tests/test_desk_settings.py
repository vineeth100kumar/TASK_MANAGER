"""Tests for desk/settings.py and how the desk uses it: the button map, the
lock, presses sent from Sage, and settings applied to a running clock.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("SAGE_DB_PATH", str(Path(tempfile.mkdtemp()) / "desk.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import notifier  # noqa: E402
from desk import run as desk_run  # noqa: E402
from desk import settings  # noqa: E402
from desk.desk import Desk  # noqa: E402
from test_desk_features import FakeActions, FakeLink, FakePhone, alarm, at  # noqa: E402


class Merge(unittest.TestCase):
    def test_defaults_keep_todays_buttons(self):
        s = settings.defaults()
        self.assertEqual(settings.action_for(s, "DOWN", "CLOCK", False), "next_screen")
        self.assertEqual(settings.action_for(s, "UP", "TASKS", False), "prev_screen")
        self.assertEqual(settings.action_for(s, "HOLD_OK", "CLOCK", False), "none")
        self.assertEqual(settings.action_for(s, "OK", "CLOCK", False), "none")
        self.assertEqual(settings.action_for(s, "OK", "SPOTIFY", False), "media_toggle")
        self.assertEqual(settings.action_for(s, "RIGHT", "CLOCK", True), "snooze_alarm")
        self.assertEqual(settings.action_for(s, "OK", "CLOCK", True), "stop_alarm")

    def test_a_layer_changes_only_the_buttons_it_names(self):
        s = settings.merge(settings.defaults(), {"buttons": {"map": {"CLOCK": {"OK": "screen:TASKS"}}}})
        self.assertEqual(settings.action_for(s, "OK", "CLOCK", False), "screen:TASKS")
        self.assertEqual(settings.action_for(s, "DOWN", "CLOCK", False), "next_screen")  # from default
        s = settings.merge(s, {"buttons": {"map": {"CLOCK": None}}})
        self.assertEqual(settings.action_for(s, "OK", "CLOCK", False), "none")

    def test_untouched_fields_stay(self):
        s = settings.merge(settings.defaults(), {"alarm": {"snoozeMinutes": 9}})
        self.assertEqual(s["alarm"], {"snoozeMinutes": 9, "ringMinutes": 10, "tone": "pulse", "volume": 80})
        self.assertEqual(s["screens"], ["CLOCK", "TASKS", "SPOTIFY", "SYSTEM"])

    def test_home_screen_follows_the_screens(self):
        s = settings.merge(settings.defaults(), {"screens": ["TASKS", "SPOTIFY"]})
        self.assertEqual(s["homeScreen"], "TASKS")  # CLOCK was dropped

    def test_every_clock_face_can_be_chosen(self):
        for style in ("monolith", "stacked", "nightstand", "dial", "digital"):
            s = settings.merge(settings.defaults(), {"clock": {"style": style}})
            self.assertEqual(s["clock"]["style"], style)

    def test_gallery_mode_is_away_or_always(self):
        self.assertEqual(settings.defaults()["gallery"]["mode"], "away")
        s = settings.merge(settings.defaults(), {"gallery": {"mode": "always"}})
        self.assertEqual(s["gallery"]["mode"], "always")
        self.assertTrue(s["gallery"]["enabled"])
        with self.assertRaises(ValueError):
            settings.merge(settings.defaults(), {"gallery": {"mode": "sometimes"}})

    def test_screen_fit_defaults_and_limits(self):
        s = settings.defaults()["screen"]
        self.assertEqual(s, {"left": 6, "right": 0, "top": 0, "bottom": 4, "frame": False, "island": True})
        s = settings.merge(settings.defaults(), {"screen": {"left": 9, "frame": True}})["screen"]
        self.assertEqual((s["left"], s["right"], s["frame"], s["island"]), (9, 0, True, True))
        for bad, why in (({"left": 41}, "0 to 40"), ({"top": -1}, "0 to 40"), ({"bottom": True}, "whole number"),
                         ({"frame": "yes"}, "true or false")):
            with self.assertRaises(ValueError) as caught:
                settings.merge(settings.defaults(), {"screen": bad})
            self.assertIn(why, str(caught.exception))

    def test_update_hold_and_window(self):
        u = settings.defaults()["updates"]
        self.assertEqual(u, {"auto": True, "hold": "", "window": "03:00-05:00"})
        u = settings.merge(settings.defaults(), {"updates": {"hold": "2.17.0", "window": "23:30-1:00"}})["updates"]
        self.assertEqual((u["hold"], u["window"]), ("2.17.0", "23:30-01:00"))
        self.assertEqual(settings.merge(settings.defaults(), {"updates": {"window": ""}})["updates"]["window"], "")
        for bad in ({"hold": "latest"}, {"window": "3-5"}, {"window": "03:00-03:00"}, {"window": 5}):
            with self.assertRaises(ValueError):
                settings.merge(settings.defaults(), {"updates": bad})
        self.assertTrue(settings.in_window("03:00-05:00", 4, 59))
        self.assertFalse(settings.in_window("03:00-05:00", 5, 0))
        self.assertTrue(settings.in_window("23:30-01:00", 0, 15))
        self.assertFalse(settings.in_window("23:30-01:00", 12, 0))
        self.assertTrue(settings.in_window("", 12, 0))

    def test_the_face_is_refused_now(self):
        with self.assertRaises(ValueError):
            settings.merge(settings.defaults(), {"screens": ["FACE", "CLOCK"]})

    def test_bad_values_are_refused_with_a_reason(self):
        bad = [
            ({"wifi": "x"}, "Unknown setting"),
            ({"screens": []}, "at least one"),
            ({"screens": ["CLOCK", "CLOCK"]}, "twice"),
            ({"screens": ["SPACESHIP"]}, "screens must be one of"),
            ({"alarm": {"snoozeMinutes": 0}}, "1 to 60"),
            ({"alarm": {"ringMinutes": True}}, "whole number"),
            ({"lights": {"brightness": 300}}, "0 to 255"),
            ({"haptics": {"strength": 101}}, "0 to 100"),
            ({"welcome": {"message": "  "}}, "1 to 27"),
            ({"welcome": {"message": "x" * 28}}, "1 to 27"),
            ({"welcome": {"awayMinutes": 2}}, "5 to 720"),
            ({"clock": {"secondZone": "Mars/Olympus"}}, "not a time zone"),
            ({"buttons": {"map": {"default": None}}}, "can't be removed"),
            ({"buttons": {"map": {"CLOCK": {"HOLD": "none"}}}}, "button must be one of"),
            ({"buttons": {"map": {"FACE": {"OK": "none"}}}}, "layer must be one of"),
            ({"buttons": {"map": {"CLOCK": {"OK": "launch"}}}}, "must be one of"),
            ({"buttons": {"locked": "yes"}}, "true or false"),
        ]
        for update, message in bad:
            with self.subTest(update=update), self.assertRaises(ValueError) as caught:
                settings.merge(settings.defaults(), update)
            self.assertIn(message, str(caught.exception))


class Storage(unittest.TestCase):
    def test_saved_and_loaded_and_reset(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(notifier, "DB_PATH", str(Path(tmp) / "s.db")):
            self.assertEqual(settings.load(), settings.defaults())
            settings.save({"clock": {"hour24": False}})
            settings.save({"alarm": {"snoozeMinutes": 7}})
            loaded = settings.load()
            self.assertFalse(loaded["clock"]["hour24"])
            self.assertEqual(loaded["alarm"]["snoozeMinutes"], 7)
            with self.assertRaises(ValueError):
                settings.save({"alarm": {"snoozeMinutes": 99}})
            self.assertEqual(settings.load()["clock"]["hour24"], False)
            self.assertEqual(settings.load()["alarm"]["snoozeMinutes"], 7)  # a refused change saves nothing
            self.assertEqual(settings.reset(), settings.defaults())
            self.assertEqual(settings.load(), settings.defaults())

    def test_settings_saved_with_the_face_load_without_it(self):
        old = {"screens": ["FACE", "CLOCK", "TASKS"], "homeScreen": "FACE", "alarm": {"snoozeMinutes": 8},
               "buttons": {"map": {"FACE": {"OK": "none"}, "default": {"OK": "screen:FACE"}}}}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(notifier, "DB_PATH", str(Path(tmp) / "s.db")):
            notifier.init_tables()
            conn = notifier._connect()
            conn.execute("INSERT INTO metadata (key, value) VALUES (?, ?)", (settings.KEY, json.dumps(old)))
            conn.commit()
            conn.close()
            loaded = settings.load()
        self.assertEqual((loaded["screens"], loaded["homeScreen"]), (["CLOCK", "TASKS"], "CLOCK"))
        self.assertEqual(loaded["alarm"]["snoozeMinutes"], 8)  # the rest is kept
        self.assertNotIn("FACE", loaded["buttons"]["map"])
        self.assertEqual(loaded["buttons"]["map"]["default"]["OK"], "none")


class DeskWithSettings(unittest.IsolatedAsyncioTestCase):
    def make(self, update=None, items=()):
        self.clock = at(6, 0)
        self.items = list(items)
        self.link = FakeLink()
        self.phone = FakePhone()
        self.actions = FakeActions(self.items)

        async def broadcast(event):
            pass

        async def weather():
            return None

        async def cover(title, artist):
            return None

        async def about(title, artist, **details):
            return None

        async def lyrics(title, artist, duration=0):
            return []

        self.desk = Desk(
            self.link, lambda: self.clock, self.phone, broadcast,
            items=lambda: list(self.items), actions=self.actions, weather=weather, cover=cover,
            song_about=about, song_lyrics=lyrics,
            settings=settings.merge(settings.defaults(), update or {}),
        )
        return self.desk

    async def test_starts_on_the_home_screen_with_the_saved_lights(self):
        desk = self.make({"homeScreen": "CLOCK", "lights": {"mode": "WARM", "brightness": 12}})
        await desk.controller.redraw()
        self.assertEqual(self.link.last("SCREEN")["mode"], "CLOCK")
        self.assertEqual((self.link.last("LIGHTS")["mode"], self.link.last("LIGHTS")["brightness"]), ("WARM", 12))

    async def test_mapped_buttons(self):
        desk = self.make({"buttons": {"map": {"default": {"OK": "screen:SYSTEM", "LEFT": "lights_toggle"}}}})
        await desk.controller.on_button("OK")
        self.assertEqual(desk.controller.screen, "SYSTEM")
        await desk.controller.on_button("LEFT")
        self.assertEqual(self.link.last("LIGHTS")["mode"], "OFF")
        await desk.controller.on_button("LEFT")
        self.assertEqual(self.link.last("LIGHTS")["mode"], "AUTO")

    async def test_up_and_down_skip_screens_that_are_switched_off(self):
        desk = self.make({"screens": ["CLOCK", "SPOTIFY"]})
        self.assertEqual(desk.controller.screen, "CLOCK")
        await desk.controller.on_button("DOWN")
        await desk.controller.on_button("DOWN")
        self.assertEqual([c["mode"] for c in self.link.sent if c["cmd"] == "SCREEN"], ["SPOTIFY", "CLOCK"])

    async def test_a_card_on_the_face_steps_back_into_the_loop(self):
        desk = self.make({"screens": ["CLOCK", "TASKS"]})
        await desk.controller.show_screen("FACE")  # firmware 1.x draws cards there
        await desk.controller.on_button("DOWN")
        self.assertEqual(desk.controller.screen, "CLOCK")

    async def test_hold_ok_can_be_mapped(self):
        desk = self.make({"buttons": {"map": {"default": {"HOLD_OK": "screen:SYSTEM"}}}})
        await desk.controller.on_button("HOLD_OK")
        self.assertEqual(desk.controller.screen, "SYSTEM")

    async def test_lock_ignores_the_clock_but_not_sage(self):
        desk = self.make({"buttons": {"locked": True}})
        await desk.controller.on_button("DOWN")
        self.assertEqual(self.link.sent, [])
        await desk.press("down")
        self.assertEqual(self.link.last("SCREEN")["mode"], "TASKS")

    async def test_a_ringing_alarm_still_answers_a_locked_clock(self):
        desk = self.make({"buttons": {"locked": True}, "alarm": {"snoozeMinutes": 9}}, items=[alarm(h=6, m=0)])
        await desk.refresh()
        await desk.ring()
        self.assertTrue(desk.alarms.ringing)
        await desk.controller.on_button("RIGHT")
        self.assertIsNone(desk.alarms.ringing)
        self.assertEqual(self.items[0]["remindAt"], "2026-10-07T06:09")  # nine minutes, from settings

    async def test_alarm_buttons_can_be_remapped(self):
        desk = self.make({"buttons": {"map": {"alarm": {"RIGHT": "stop_alarm", "OK": "snooze_alarm", "UP": "none"}}}},
                         items=[alarm(h=6, m=0)])
        await desk.refresh()
        await desk.ring()
        await desk.controller.on_button("UP")  # mapped to nothing: keeps ringing
        self.assertTrue(desk.alarms.ringing)
        await desk.controller.on_button("OK")
        self.assertEqual(self.items[0]["remindAt"], "2026-10-07T06:05")

    async def test_ring_length_comes_from_settings(self):
        desk = self.make({"alarm": {"ringMinutes": 2}}, items=[alarm(h=6, m=0)])
        await desk.refresh()
        await desk.ring()
        self.clock = at(6, 2, 1)
        await desk.ring()
        self.assertIsNone(desk.alarms.ringing)

    async def test_media_buttons_follow_the_map(self):
        desk = self.make({"buttons": {"map": {"default": {"RIGHT": "media_next"}}}})
        await desk.controller.on_button("RIGHT")
        self.assertEqual(self.phone.commands, ["next"])

    async def test_clock_carries_how_to_show_the_time(self):
        desk = self.make({"clock": {"style": "minimal", "hour24": False, "seconds": False, "secondZone": "Europe/London"}})
        await desk.controller.send_clock()
        clock = self.link.last("CLOCK")
        self.assertEqual((clock["style"], clock["hour24"], clock["show_seconds"]), ("minimal", False, False))
        self.assertEqual((clock["zone2"], clock["zone2_h"], clock["zone2_m"]), ("London", 1, 30))

    async def test_apply_settings_moves_off_a_screen_that_was_switched_off(self):
        desk = self.make()
        await desk.controller.show_screen("SYSTEM")
        await desk.apply_settings(settings.merge(settings.defaults(), {"screens": ["CLOCK", "TASKS"], "lights": {"brightness": 5}}))
        self.assertEqual(desk.controller.screen, "CLOCK")
        self.assertEqual(self.link.last("LIGHTS")["brightness"], 5)
        self.assertEqual(desk.controller.screens, ["CLOCK", "TASKS"])

    async def test_haptic_strength_reaches_the_clock(self):
        desk = self.make({"haptics": {"strength": 35}})
        await desk.after_redraw()
        self.assertEqual(self.link.last("HAPTICS"), {"cmd": "HAPTICS", "strength": 35, "buttons": True, "notify": True})
        await desk.apply_settings(settings.merge(desk.settings, {"haptics": {"strength": 0}}))
        self.assertEqual(self.link.last("HAPTICS")["strength"], 0)


class ScreenFit(unittest.IsolatedAsyncioTestCase):
    """The case window and the Even Frame reach firmware 2.15 and later as FIT."""

    def make(self, fw="2.15.0"):
        self.link = FakeLink()
        self.link.fw = fw

        async def broadcast(event):
            pass

        return Desk(self.link, lambda: at(9, 0), FakePhone(), broadcast, items=lambda: [], actions=FakeActions([]))

    async def test_fit_reaches_the_clock(self):
        desk = self.make()
        await desk.after_redraw()
        self.assertEqual(self.link.last("FIT"), {"cmd": "FIT", "l": 6, "r": 0, "t": 0, "b": 4, "frame": False, "island": True, "test": False})
        await desk.apply_settings(settings.merge(desk.settings, {"screen": {"left": 8, "frame": True}}))
        fit = self.link.last("FIT")
        self.assertEqual((fit["l"], fit["frame"], fit["test"]), (8, True, False))

    async def test_older_firmware_is_not_sent_it(self):
        desk = self.make("2.14.1")
        await desk.after_redraw()
        self.assertNotIn("FIT", self.link.cmds())
        with self.assertRaises(ValueError):
            await desk.device_do("fit_test")

    async def test_fit_test_goes_on_and_off(self):
        desk = self.make()
        self.assertTrue(await desk.device_do("fit_test"))
        self.assertTrue(self.link.last("FIT")["test"])
        self.assertTrue(desk.state()["fitTest"])
        # Saving a setting while the pattern is up keeps it up.
        await desk.apply_settings(settings.merge(desk.settings, {"screen": {"top": 2}}))
        self.assertEqual((self.link.last("FIT")["t"], self.link.last("FIT")["test"]), (2, True))
        self.assertTrue(await desk.device_do("fit_test_off"))
        self.assertFalse(self.link.last("FIT")["test"])
        self.assertFalse(desk.state()["fitTest"])
        for task in list(desk._tasks):
            task.cancel()


class RunHelpers(unittest.IsolatedAsyncioTestCase):
    async def test_press_and_save_reach_the_running_desk(self):
        link = FakeLink()

        async def broadcast(event):
            pass

        desk = Desk(link, lambda: at(9, 0), FakePhone(), broadcast, items=lambda: [], actions=FakeActions([]))
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(notifier, "DB_PATH", str(Path(tmp) / "s.db")), \
                mock.patch.object(desk_run, "desk", desk):
            self.assertTrue(await desk_run.press("DOWN"))
            self.assertEqual(link.last("SCREEN")["mode"], "TASKS")
            saved = await desk_run.save_settings({"lights": {"mode": "OFF"}})
            self.assertEqual(saved["lights"]["mode"], "OFF")
            self.assertEqual(link.last("LIGHTS")["mode"], "OFF")
            with self.assertRaises(ValueError):
                await desk_run.save_settings({"lights": {"mode": "DISCO"}})
            self.assertEqual((await desk_run.reset_settings())["lights"]["mode"], "AUTO")
        with mock.patch.object(desk_run, "desk", None):
            self.assertFalse(await desk_run.press("OK"))


if __name__ == "__main__":
    unittest.main()
