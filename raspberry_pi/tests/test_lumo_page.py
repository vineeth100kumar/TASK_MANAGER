"""Tests for the LUMO page's side of the desk: alarms with repeat days,
tones and their own snooze, made and changed from Sage (alarm_store), the
timer and stopwatch (tools.py), night mode, the World screen and the clock's
status.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import datetime
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import item_actions  # noqa: E402
from desk import alarm_store, run as desk_run, settings  # noqa: E402
from desk.alarms import Alarm, Alarms, next_occurrence  # noqa: E402
from desk.desk import Desk  # noqa: E402
from desk.tools import Stopwatch, Timer  # noqa: E402
from test_desk_features import TZ, FakeActions, FakeLink, FakePhone, alarm, at  # noqa: E402

# at() is Wednesday 7 October 2026.


def with_days(item, days, **extra):
    item = dict(item)
    item["customFields"] = {"alarm": {"days": days, **extra}}
    return item


class Ticks:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


class RepeatDays(unittest.TestCase):
    def test_next_occurrence_skips_to_an_allowed_day(self):
        weekdays = [0, 1, 2, 3, 4]
        self.assertEqual(next_occurrence(7, 0, at(6, 0), weekdays), at(7, 0))
        friday_late = at(8, 0) + datetime.timedelta(days=2)  # Friday 08:00
        self.assertEqual(next_occurrence(7, 0, friday_late, weekdays).strftime("%a %d %H:%M"), "Mon 12 07:00")
        self.assertEqual(next_occurrence(7, 0, at(8, 0), [5]).strftime("%a %d"), "Sat 10")

    def test_older_alarms_repeat_every_day(self):
        a = Alarm(alarm(), TZ)
        self.assertEqual((a.days, a.once), ([0, 1, 2, 3, 4, 5, 6], False))

    def test_weekday_alarm_rolls_past_the_weekend(self):
        friday = alarm(day=9)
        a = Alarm(with_days(friday, [0, 1, 2, 3, 4]), TZ)
        self.assertEqual(Alarms.rolled(a, at(7, 1) + datetime.timedelta(days=2))["remindAt"], "2026-10-12T07:00")

    def test_one_off_alarm_switches_itself_off(self):
        a = Alarm(with_days(alarm(), []), TZ)
        self.assertTrue(a.once)
        self.assertEqual(Alarms.rolled(a, at(7, 1)), {"remindAt": None})

    def test_the_clock_list_carries_each_alarms_days(self):
        alarms = Alarms(TZ)
        alarms.load([with_days(alarm("work", 7, 0), [0, 1, 2, 3, 4]), with_days(alarm("once", 9, 30), []),
                     alarm("far", 6, 0, day=10), with_days(alarm("off", 8, 0, remind=""), [2])])
        self.assertEqual(alarms.for_clock(at(6, 0)), [
            {"h": 7, "m": 0, "w": 2, "d": 0b0011111},   # weekdays
            {"h": 9, "m": 30, "w": 2, "d": 0},          # once: rung, then dropped
            {"h": 6, "m": 0, "w": 5, "d": 127},         # three days out: still sent
        ])

    def test_alarm_sound_cycles_match_the_firmware(self):
        # src/components/lumo/alarmSounds.ts is made from tones.h by lumo/tools/alarm_sounds.py.
        shapes = (Path(__file__).resolve().parents[2] / "src" / "components" / "lumo" / "alarmSounds.ts").read_text()
        from desk.alarms import TONE_CYCLE_MS, TONES
        for tone in TONES:
            self.assertIn(f"  {tone}: {{ cycleMs: {TONE_CYCLE_MS[tone]},", shapes)
        self.assertIn("chime", settings.ALARM_TONES)

    def test_tone_volume_and_snooze_are_checked(self):
        a = Alarm(with_days(alarm(), [2], tone="rising", volume=40, snoozeMinutes=9), TZ)
        self.assertEqual((a.tone, a.volume, a.snooze), ("rising", 40, 9))
        b = Alarm(with_days(alarm(), [2], tone="siren", volume=400, snoozeMinutes=True), TZ)
        self.assertEqual((b.tone, b.volume, b.snooze), (None, None, None))


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = str(Path(self.tmp.name) / "sage.db")
        conn = sqlite3.connect(path)
        conn.executescript("""
            CREATE TABLE entities (table_name TEXT, entity_id TEXT, revision INTEGER, payload TEXT,
                                   deleted INTEGER DEFAULT 0, server_revision INTEGER DEFAULT 0,
                                   PRIMARY KEY (table_name, entity_id));
            CREATE TABLE sync_operations (operation_id TEXT PRIMARY KEY, client_id TEXT, entity_type TEXT,
                                          entity_id TEXT, operation TEXT);
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO metadata VALUES ('serverRevision', '1');
        """)
        conn.close()
        self.patch = mock.patch.object(item_actions, "DB_PATH", path)
        self.patch.start()
        self.path = path

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def saved(self, item_id):
        conn = sqlite3.connect(self.path)
        raw = conn.execute("SELECT payload FROM entities WHERE entity_id = ?", (item_id,)).fetchone()[0]
        conn.close()
        return json.loads(raw)

    def test_create_change_and_remove(self):
        item, rev = alarm_store.create({"label": "  Gym  ", "time": "6:30", "days": [0, 2, 4], "tone": "chirp"}, at(9, 0))
        self.assertEqual(rev, 2)
        self.assertEqual((item["title"], item["labels"], item["key"]), ("Gym", ["alarm"], "TASK-1"))
        self.assertEqual(item["remindAt"], "2026-10-09T06:30")  # Wednesday 09:00, so Friday
        shown = alarm_store.describe(self.saved(item["id"]), TZ)
        self.assertEqual((shown["time"], shown["days"], shown["enabled"], shown["tone"]), ("06:30", [0, 2, 4], True, "chirp"))

        off, _ = alarm_store.update(item["id"], {"enabled": False}, at(9, 0), TZ)
        self.assertIsNone(off["remindAt"])
        self.assertEqual(alarm_store.describe(off, TZ)["time"], "06:30")  # keeps its time

        on, _ = alarm_store.update(item["id"], {"enabled": True, "days": [], "label": "Flight"}, at(9, 0), TZ)
        self.assertEqual((on["remindAt"], on["title"]), ("2026-10-08T06:30", "Flight"))
        self.assertEqual(on["customFields"]["alarm"]["tone"], "chirp")

        self.assertIsNotNone(alarm_store.remove(item["id"]))
        self.assertTrue(self.saved(item["id"])["deletedAt"])

    def test_an_alarm_sent_back_as_read_saves(self):
        item, _ = alarm_store.create({"label": "Gym", "time": "06:30", "days": [0, 2, 4]}, at(9, 0))
        shown = alarm_store.describe(item, TZ)
        saved, _ = alarm_store.update(item["id"], {**shown, "tone": "chime"}, at(9, 0), TZ)
        self.assertEqual(alarm_store.describe(saved, TZ)["tone"], "chime")
        with self.assertRaises(ValueError):
            alarm_store.update(item["id"], {"colour": "red"}, at(9, 0), TZ)

    def test_a_label_change_leaves_a_snooze_alone(self):
        item, _ = alarm_store.create({"time": "07:00"}, at(6, 0))
        item_actions.set_fields(item["id"], {"remindAt": "2026-10-07T07:05"}, "desk")
        renamed, _ = alarm_store.update(item["id"], {"label": "Up"}, at(7, 1), TZ)
        self.assertEqual(renamed["remindAt"], "2026-10-07T07:05")
        self.assertTrue(alarm_store.describe(renamed, TZ)["snoozed"])

    def test_bad_requests_are_refused(self):
        for spec in ({}, {"time": "25:00"}, {"time": "07:00", "days": [7]}, {"time": "07:00", "tone": "siren"},
                     {"time": "07:00", "volume": 101}, {"time": "07:00", "colour": "red"}):
            with self.assertRaises(ValueError):
                alarm_store.create(spec, at(6, 0))

    def test_only_alarms_can_be_changed_here(self):
        item, _ = item_actions.create_item({"id": "task", "title": "Not an alarm"}, "test", "t")
        self.assertIsNone(alarm_store.update("task", {"label": "x"}, at(6, 0), TZ))
        self.assertIsNone(alarm_store.remove("task"))
        self.assertIsNone(alarm_store.update("missing", {"label": "x"}, at(6, 0), TZ))


class Tools(unittest.TestCase):
    def test_timer_counts_pauses_and_rings(self):
        ticks = Ticks()
        timer = Timer(clock=ticks, wall=lambda: 1000.0)
        timer.start(90, "Tea")
        ticks.t += 30
        self.assertEqual(timer.remaining(), 60)
        timer.pause()
        ticks.t += 100
        self.assertEqual(timer.command(), {"cmd": "TIMER", "state": "paused", "left_ms": 60000, "total_ms": 90000, "label": "Tea"})
        timer.resume()
        timer.add(60)
        ticks.t += 119
        self.assertIsNone(timer.tick())
        ticks.t += 1
        self.assertEqual(timer.tick(), "done")
        ticks.t += 60
        self.assertEqual(timer.tick(), "idle")  # nobody answered

    def test_timer_toggle_starts_the_last_one_again(self):
        timer = Timer(clock=Ticks())
        timer.start(120)
        timer.cancel()
        timer.toggle()
        self.assertEqual((timer.state, timer.total), ("running", 120))
        with self.assertRaises(ValueError):
            timer.start(0)

    def test_stopwatch_laps(self):
        ticks = Ticks()
        watch = Stopwatch(clock=ticks)
        watch.start()
        ticks.t += 10
        watch.lap()
        ticks.t += 15
        watch.lap()
        watch.pause()
        ticks.t += 50
        self.assertEqual(watch.describe()["laps"], [10, 15])
        self.assertEqual(watch.command()["elapsed_ms"], 25000)
        watch.reset()
        self.assertEqual((watch.elapsed(), watch.laps), (0, []))


class NightWindow(unittest.TestCase):
    def test_across_midnight(self):
        s = settings.merge(settings.defaults(), {"night": {"enabled": True, "start": "22:30", "end": "7:00"}})
        self.assertEqual(s["night"]["end"], "07:00")
        self.assertEqual([settings.in_night(s, h, m) for h, m in ((22, 29), (22, 30), (3, 0), (7, 0))], [False, True, True, False])

    def test_off_unless_enabled(self):
        self.assertFalse(settings.in_night(settings.defaults(), 23, 0))

    def test_world_zones_are_checked(self):
        s = settings.merge(settings.defaults(), {"world": {"zones": ["Europe/London", "America/New_York"]}})
        self.assertEqual(len(s["world"]["zones"]), 2)
        for zones in (["Mars/Base"], ["UTC", "UTC"], ["UTC", "Asia/Tokyo", "Europe/Paris", "Asia/Dubai"]):
            with self.assertRaises(ValueError):
                settings.merge(settings.defaults(), {"world": {"zones": zones}})


class DeskPage(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = at(6, 0)
        self.items = [with_days(alarm(), [2], tone="rising", volume=40, snoozeMinutes=9)]
        self.link = FakeLink()
        self.link.fw = "2.8.0"
        self.events = []

        async def broadcast(event):
            self.events.append(event)

        async def none(*a, **k):
            return None

        self.desk = Desk(self.link, lambda: self.clock, FakePhone(), broadcast,
                         items=lambda: list(self.items), actions=FakeActions(self.items),
                         weather=none, cover=none, song_about=none, song_lyrics=none)

    async def test_alarm_rings_with_its_tone_and_snoozes_its_own_length(self):
        await self.desk.refresh()
        self.clock = at(7, 0)
        await self.desk.ring()
        self.assertEqual(self.link.last("ALARM_RING"),
                         {"cmd": "ALARM_RING", "label": "Wake up", "tone": "rising", "volume": 40, "snooze": 9})
        self.assertEqual(self.events[-1]["state"]["ringing"]["label"], "Wake up")
        self.assertTrue(await self.desk.ringing_do("snooze"))
        self.assertEqual(self.items[0]["remindAt"], "2026-10-07T07:09")
        self.assertFalse(await self.desk.ringing_do("stop"))

    async def test_timer_from_sage_shows_on_the_clock(self):
        await self.desk.timer_do("start", 300, "Pasta")
        self.assertEqual(self.link.last("TIMER")["state"], "running")
        self.assertEqual(self.link.last("SCREEN"), {"cmd": "SCREEN", "mode": "TIMER"})
        self.assertEqual(self.events[-1]["state"]["timer"]["label"], "Pasta")
        await self.desk.controller.on_button("OK")  # the TIMER layer: pause
        self.assertEqual(self.desk.timer.state, "paused")

    async def test_a_finished_timer_takes_the_next_press(self):
        self.desk.timer.state = "done"
        await self.desk.controller.on_button("DOWN")
        self.assertEqual(self.desk.timer.state, "idle")
        self.assertEqual(self.desk.controller.screen, "CLOCK")  # the press did nothing else

    async def test_old_firmware_gets_no_new_commands(self):
        self.link.fw = "2.6.4"
        await self.desk.timer_do("start", 60)
        await self.desk.stopwatch_do("start")
        await self.desk.send_tool_settings(force=True)
        self.assertEqual(self.link.sent, [])
        self.assertEqual(self.desk.timer.state, "running")  # still kept for the page

    async def test_night_dims_lights_and_changes_face(self):
        self.clock = at(12, 0)
        await self.desk.apply_settings(settings.merge(settings.defaults(), {
            "night": {"enabled": True, "start": "22:00", "end": "06:30", "brightness": 8}}))
        self.assertFalse(self.desk.night)
        self.clock = at(23, 0)
        await self.desk.night_tick()
        self.assertEqual(self.link.last("LIGHTS")["brightness"], 8)
        self.assertEqual(self.link.last("CLOCK")["style"], "nightstand")
        self.assertEqual(self.link.last("NIGHT"), {"cmd": "NIGHT", "on": True})
        self.clock = at(6, 30)
        await self.desk.night_tick()
        self.assertEqual(self.link.last("LIGHTS")["brightness"], 100)

    async def test_world_clocks_and_haptics(self):
        await self.desk.apply_settings(settings.merge(settings.defaults(), {
            "world": {"zones": ["Europe/London", "Asia/Tokyo"]}, "haptics": {"buttons": False}}))
        self.assertEqual(self.link.last("WORLD")["zones"], [{"name": "London", "offset": -270}, {"name": "Tokyo", "offset": 210}])
        self.assertEqual(self.link.last("HAPTICS"), {"cmd": "HAPTICS", "strength": 70, "buttons": False, "notify": True})

    async def test_device_actions(self):
        self.assertTrue(await self.desk.device_do("identify"))
        self.assertTrue(await self.desk.device_do("tone", "chirp", 30))
        # One cycle, then quiet; older firmware plays it for the cycle's length, rounded up.
        self.assertEqual(self.link.last("TONE"), {"cmd": "TONE", "tone": "chirp", "volume": 30, "cycles": 1, "seconds": 2})
        self.assertTrue(await self.desk.device_do("tone", "dawn", 50))
        self.assertEqual(self.link.last("TONE")["seconds"], 5)
        with self.assertRaises(ValueError):
            await self.desk.device_do("explode")


class Status(unittest.TestCase):
    def test_latest_firmware_comes_from_the_checkout(self):
        self.assertRegex(desk_run.latest_firmware() or "", r"^\d+\.\d+\.\d+$")
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "config.h"
            config.write_text('#define FW_VERSION "9.1.0"\n')
            self.assertEqual(desk_run.latest_firmware(config), "9.1.0")
            self.assertIsNone(desk_run.latest_firmware(Path(tmp) / "missing.h"))
        self.assertGreater(desk_run._version("2.10.0"), desk_run._version("2.9.1"))


if __name__ == "__main__":
    unittest.main()
