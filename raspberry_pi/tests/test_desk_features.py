"""Tests for desk/desk.py and its helpers: the Today list, alarms, reminder
cards, the phone's notifications and music, and the ambient bits.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import datetime
import os
import sys
import tempfile
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ.setdefault("SAGE_DB_PATH", str(Path(tempfile.mkdtemp()) / "desk.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from desk import ambient, art, today  # noqa: E402
from desk.alarms import Alarms  # noqa: E402
from desk.desk import Desk  # noqa: E402

TZ = ZoneInfo("Asia/Kolkata")


def at(h, m, s=0, day=7):
    return datetime.datetime(2026, 10, day, h, m, s, tzinfo=TZ)


class FakeLink:
    def __init__(self):
        self.sent = []
        self.binary = []
        self.connected = True
        self.on_ready = self.on_button = None

    async def send(self, command):
        self.sent.append(command)
        return True

    async def send_binary(self, data):
        self.binary.append(data)
        return True

    def cmds(self):
        return [c["cmd"] for c in self.sent]

    def last(self, cmd):
        return next(c for c in reversed(self.sent) if c["cmd"] == cmd)


class FakePhone:
    def __init__(self, available=True, home=True):
        self.available = available
        self.home = home
        self.media = {"title": "", "artist": "", "playing": False}
        self.commands = []

    async def send_command(self, command):
        self.commands.append(command)
        return True


class FakeActions:
    """item_actions on a dict of items, recording each call."""

    def __init__(self, items):
        self.items = {i["id"]: i for i in items}
        self.calls = []
        self.rev = 100

    def _save(self, name, item_id, change):
        self.calls.append((name, item_id))
        if item_id not in self.items:
            return None
        change(self.items[item_id])
        self.rev += 1
        return self.items[item_id], self.rev

    def set_fields(self, item_id, fields, source):
        return self._save("set_fields", item_id, lambda i: i.update(fields))

    def mark_done(self, item_id, source):
        return self._save("done", item_id, lambda i: i.update(status="done"))

    def snooze(self, item_id, source, minutes=60):
        return self._save("snooze", item_id, lambda i: i.update(snoozedUntil=f"+{minutes}"))

    def move_to_tomorrow(self, item_id, source, day):
        return self._save("tomorrow", item_id, lambda i: i.update(dueDate=str(day + datetime.timedelta(days=1))))


def alarm(item_id="wake", h=7, m=0, day=7, remind=None):
    when = f"2026-10-{day:02d}T{h:02d}:{m:02d}"
    return {"id": item_id, "title": "Wake up", "labels": ["Alarm"], "entityType": "reminder",
            "startAt": when, "remindAt": remind if remind is not None else when, "dueDate": when[:10]}


class Helpers(unittest.TestCase):
    def test_today_lines(self):
        items = [
            {"id": "1", "title": "Gym", "dueDate": "2026-10-07", "dueTime": "07:30"},
            {"id": "2", "title": "Write the report", "dueDate": "2026-10-07"},
            {"id": "3", "title": "Taxes", "dueDate": "2026-10-01"},
            {"id": "4", "title": "Later", "dueDate": "2026-10-09"},
            alarm(),
        ]
        self.assertEqual(today.lines(items, at(6, 0), TZ), ["07:30 Gym", "Write the report", "Taxes (overdue)"])

    def test_today_keeps_five(self):
        items = [{"id": str(n), "title": f"Thing {n}", "dueDate": "2026-10-07"} for n in range(8)]
        self.assertEqual(len(today.lines(items, at(6, 0), TZ)), 5)

    def test_alarm_rings_once_and_again_after_snooze(self):
        alarms = Alarms(TZ)
        alarms.load([alarm(), {"id": "plain", "remindAt": "2026-10-07T07:00"}])
        self.assertEqual([a.id for a in alarms.alarms], ["wake"])
        self.assertIsNone(alarms.due(at(6, 59, 59)))
        self.assertEqual(alarms.due(at(7, 0, 0)).id, "wake")
        alarms.ringing = None
        self.assertIsNone(alarms.due(at(7, 0, 1)))  # not twice
        snoozed = alarm(remind=Alarms.snoozed(at(7, 0, 5))["remindAt"])
        self.assertEqual(snoozed["remindAt"], "2026-10-07T07:05")
        alarms.load([snoozed])
        self.assertEqual(alarms.next(at(7, 1)).h, 7)  # still shows as set for 07:00
        self.assertEqual(alarms.due(at(7, 5)).id, "wake")

    def test_missed_alarm_rolls_to_the_next_day(self):
        alarms = Alarms(TZ)
        alarms.load([alarm(h=6, m=30)])
        self.assertEqual([a.id for a in alarms.missed(at(9, 0))], ["wake"])
        self.assertEqual(Alarms.rolled(alarms.alarms[0], at(9, 0)),
                         {"remindAt": "2026-10-08T06:30", "startAt": "2026-10-08T06:30", "dueDate": "2026-10-08"})
        self.assertEqual(alarms.missed(at(6, 33)), [])  # still within the ringing window

    def test_switched_off_alarm_does_not_ring(self):
        alarms = Alarms(TZ)
        alarms.load([alarm(remind="")])
        self.assertIsNone(alarms.due(at(7, 0)))
        self.assertIsNone(alarms.next(at(6, 0)))

    def test_weather_icons(self):
        self.assertEqual([ambient.weather_icon(c) for c in (0, 2, 61, 73, 95)], ["clear", "cloudy", "rain", "snow", "storm"])

    def test_vitals_read_proc_and_sys(self):
        root = Path(tempfile.mkdtemp())
        (root / "proc").mkdir()
        (root / "sys/class/thermal/thermal_zone0").mkdir(parents=True)
        (root / "sys/class/thermal/thermal_zone0/temp").write_text("52300\n")
        (root / "proc/meminfo").write_text("MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 250 kB\n")
        (root / "proc/stat").write_text("cpu  100 0 100 700 100 0 0 0\n")
        vitals = ambient.Vitals(str(root))
        vitals.cpu_pct()
        (root / "proc/stat").write_text("cpu  150 0 150 800 100 0 0 0\n")
        stats = vitals.command()
        self.assertEqual((stats["cpu_temp"], stats["cpu_pct"], stats["ram_pct"]), (52.3, 50, 75))

    def test_upcoming_alarms_are_the_next_day_soonest_first(self):
        alarms = Alarms(TZ)
        alarms.load([alarm("late", 22, 0), alarm("wake", 7, 0), alarm("old", 5, 0), alarm("far", 7, 0, day=9)])
        self.assertEqual([a.id for a in alarms.upcoming(at(6, 0))], ["wake", "late"])

    @unittest.skipIf(art.Image is None, "Pillow not installed")
    def test_art_frame(self):
        frame = art.encode(art.Image.new("RGB", (300, 300), (255, 0, 0)))
        self.assertEqual(len(frame), art.FRAME_LEN)
        self.assertEqual(frame[:6], bytes([0xAA, 0xBB, 100, 100, 0x00, 0xF8]))  # red, little-endian
        self.assertEqual(len(art.placeholder("Song", "Artist")), 20004)


class DeskTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = at(6, 0)
        self.items = [
            {"id": "gym", "title": "Gym", "dueDate": "2026-10-07", "dueTime": "07:30", "status": "todo"},
            alarm(),
        ]
        self.link = FakeLink()
        self.phone = FakePhone()
        self.actions = FakeActions(self.items)
        self.events = []
        self.covers = []

        async def broadcast(event):
            self.events.append(event)

        async def cover(title, artist):
            self.covers.append((title, artist))
            return b"art"

        async def weather():
            return {"cmd": "WEATHER", "temp_c": 24.5, "icon": "rain"}

        self.desk = Desk(
            self.link, lambda: self.clock, self.phone, broadcast,
            items=lambda: [i for i in self.items if i.get("status") != "done"],
            actions=self.actions, weather=weather, cover=cover,
        )
        self.desk.loop = asyncio.get_running_loop()

    async def test_refresh_sends_today_and_the_next_alarm(self):
        await self.desk.refresh()
        self.assertEqual(self.link.last("SHOW_TASKS")["items"], ["07:30 Gym"])
        clock = self.link.last("CLOCK")
        self.assertEqual((clock["alarm_h"], clock["alarm_m"]), (7, 0))
        self.link.sent.clear()
        await self.desk.refresh()
        self.assertEqual(self.link.sent, [])  # nothing changed, nothing sent

    async def test_sync_events_refresh_the_list(self):
        await self.desk.refresh()
        self.items[0]["status"] = "done"
        self.desk.on_event({"type": "SYNC_APPLIED", "changes": []})
        self.desk.on_event({"type": "SYNC_APPLIED", "changes": []})  # one refresh for a burst
        await asyncio.sleep(0.7)
        self.assertEqual(self.link.last("SHOW_TASKS")["items"], [])
        self.assertEqual(self.link.cmds().count("SHOW_TASKS"), 2)

    async def test_missed_alarm_is_set_for_tomorrow(self):
        self.clock = at(9, 0)
        await self.desk.refresh()
        self.assertEqual(self.actions.calls, [("set_fields", "wake")])
        self.assertEqual(self.items[1]["remindAt"], "2026-10-08T07:00")
        self.assertEqual(self.events[0]["changes"][0]["entityId"], "wake")

    async def test_alarm_rings_then_snoozes_then_stops(self):
        await self.desk.refresh()
        self.clock = at(7, 0, 0)
        await self.desk.ring()
        self.assertEqual(self.link.sent[-1], {"cmd": "ALARM_RING"})
        await self.desk.controller.on_button("RIGHT")
        self.assertEqual(self.link.sent[-1], {"cmd": "ALARM_OFF"})
        self.assertEqual(self.items[1]["remindAt"], "2026-10-07T07:05")
        self.assertEqual(self.items[1]["startAt"], "2026-10-07T07:00")

        await self.desk.refresh()
        self.clock = at(7, 5, 0)
        await self.desk.ring()
        self.assertEqual(self.link.sent[-1], {"cmd": "ALARM_RING"})
        await self.desk.controller.on_button("OK")
        self.assertIn({"cmd": "ALARM_OFF"}, self.link.sent[-3:])
        self.assertEqual(self.items[1]["remindAt"], "2026-10-08T07:00")
        self.assertNotIn("EMOTION", self.link.cmds())  # no face any more

    async def test_unanswered_alarm_stops(self):
        await self.desk.refresh()
        self.clock = at(7, 0)
        await self.desk.ring()
        self.clock = at(7, 11)
        await self.desk.ring()
        self.assertEqual(self.link.last("ALARM_OFF"), {"cmd": "ALARM_OFF"})
        self.assertEqual(self.items[1]["remindAt"], "2026-10-08T07:00")

    async def test_reminder_at_home_is_a_card_with_actions(self):
        message = {"title": "Gym", "body": "Due today at 7:30 AM"}
        took = await asyncio.to_thread(self.desk.clock_reminder, self.items[0], message)
        self.assertTrue(took)
        await asyncio.sleep(0.05)
        self.assertNotIn("SCREEN", self.link.cmds())  # firmware 2 shows cards over any screen
        self.assertEqual(self.link.last("NOTIF"), {"cmd": "NOTIF", "app": "Reminder", "title": "Gym", "body": "Due today at 7:30 AM"})
        self.assertEqual(self.link.last("ACTIONS"), {"cmd": "ACTIONS", "left": "Tomorrow", "ok": "Done", "right": "Snooze"})
        await self.desk.controller.on_button("OK")
        self.assertEqual(self.actions.calls, [("done", "gym")])
        self.assertEqual(self.events[-1]["type"], "SYNC_APPLIED")
        self.assertEqual(self.events[-1]["changes"][0]["clientId"], "desk")

    async def test_reminder_buttons_snooze_and_tomorrow(self):
        for button, call in (("RIGHT", "snooze"), ("LEFT", "tomorrow")):
            await self.desk.show_reminder(self.items[0], {"title": "Gym", "body": ""})
            await self.desk.controller.on_button(button)
            self.assertEqual(self.actions.calls[-1], (call, "gym"))
        self.assertEqual(self.items[0]["dueDate"], "2026-10-08")

    async def test_reminder_routing(self):
        message = {"title": "Gym", "body": ""}
        self.phone.home = False
        self.assertFalse(await asyncio.to_thread(self.desk.clock_reminder, self.items[0], message))
        self.phone.available = False  # can't tell: both get it
        self.assertFalse(await asyncio.to_thread(self.desk.clock_reminder, self.items[0], message))
        await asyncio.sleep(0.05)
        self.assertEqual(self.link.cmds().count("NOTIF"), 1)
        self.assertTrue(await asyncio.to_thread(self.desk.clock_reminder, self.items[1], message))  # alarms ring themselves
        self.link.connected = False
        self.phone.available = self.phone.home = True
        self.assertFalse(await asyncio.to_thread(self.desk.clock_reminder, self.items[0], message))

    async def test_phone_notification_is_shown_unless_a_reminder_waits(self):
        await self.desk.controller.show_screen("CLOCK")
        await self.desk.show_notification({"app": "WhatsApp", "title": "Mum", "message": "Call me"})
        self.assertEqual(self.link.last("SCREEN")["mode"], "CLOCK")
        self.assertEqual(self.link.last("NOTIF"), {"cmd": "NOTIF", "app": "WhatsApp", "title": "Mum", "body": "Call me"})
        await self.desk.show_reminder(self.items[0], {"title": "Gym", "body": ""})
        await self.desk.show_notification({"app": "WhatsApp", "title": "Mum", "message": "Again"})
        self.assertEqual(self.link.last("NOTIF")["title"], "Gym")

    async def test_music_shows_with_cover_and_buttons_control_it(self):
        media = {"title": "Clocks", "artist": "Coldplay", "playing": True}
        await self.desk.show_media(media)
        self.assertEqual(self.link.last("SPOTIFY")["title"], "Clocks")
        self.assertEqual(self.link.binary, [b"art"])
        await self.desk.show_media({**media, "playing": False})
        self.assertEqual(self.covers, [("Clocks", "Coldplay")])  # same song: no second lookup

        await self.desk.controller.on_button("OK")  # not on the music screen: nothing
        self.assertEqual(self.phone.commands, [])
        await self.desk.controller.show_screen("SPOTIFY")
        for button in ("LEFT", "OK", "RIGHT"):
            await self.desk.controller.on_button(button)
        self.assertEqual(self.phone.commands, ["previous", "toggle", "next"])

    async def test_reconnected_clock_gets_everything_back(self):
        await self.desk.refresh()
        await self.desk.update_weather()
        await self.desk.show_media({"title": "Clocks", "artist": "Coldplay", "playing": True})
        self.link.sent.clear()
        self.link.binary.clear()
        await self.desk.controller.redraw()
        for cmd in ("CLOCK", "SCREEN", "LIGHTS", "SHOW_TASKS", "ALARMS", "WEATHER", "SPOTIFY"):
            self.assertIn(cmd, self.link.cmds())
        for cmd in ("EYE_COLOR", "EMOTION", "ANIM"):
            self.assertNotIn(cmd, self.link.cmds())
        self.assertEqual(self.link.binary[-1], b"art")

    async def test_firmware_1_gets_its_cards_on_the_face(self):
        self.link.fw = "1.6.0"
        await self.desk.controller.show_screen("CLOCK")
        await self.desk.show_notification({"app": "WhatsApp", "title": "Mum", "message": "Call me"})
        self.assertEqual(self.link.last("SCREEN")["mode"], "FACE")
        await self.desk.controller.on_button("DOWN")  # off the face, back into the loop
        self.assertEqual(self.link.last("SCREEN")["mode"], "CLOCK")

    async def test_alarms_for_the_next_day_go_to_the_clock_when_they_change(self):
        await self.desk.refresh()
        self.assertEqual(self.link.last("ALARMS"), {"cmd": "ALARMS", "list": [{"h": 7, "m": 0}], "snooze": 5})
        await self.desk.refresh()
        self.assertEqual(self.link.cmds().count("ALARMS"), 1)  # unchanged: not sent again
        self.clock = at(7, 0)
        await self.desk.ring()
        await self.desk.controller.on_button("RIGHT")  # snooze to 7:05
        await self.desk.refresh()
        self.assertEqual(self.link.last("ALARMS")["list"], [{"h": 7, "m": 5}])

    async def test_system_screen_gets_vitals(self):
        await self.desk.controller.show_screen("SYSTEM")
        self.assertEqual(self.link.sent[-1]["cmd"], "SYSTEM_STATS")


if __name__ == "__main__":
    unittest.main()
