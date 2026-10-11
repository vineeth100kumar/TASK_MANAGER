"""Tests for phone_link.py: decoding Apple's ANCS and AMS packets, and the
notification, presence and media state the web app shows.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import struct
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import phone_link  # noqa: E402


def attrs_packet(uid, app, title, message):
    out = bytes([0]) + struct.pack("<I", uid)
    for attr, text in ((0, app), (1, title), (3, message)):
        raw = text.encode()
        out += bytes([attr]) + struct.pack("<H", len(raw)) + raw
    return out


class Decoding(unittest.TestCase):
    def test_notification_source(self):
        note = phone_link.parse_notification_source(bytes([0, 0, 4, 1]) + struct.pack("<I", 77))
        self.assertEqual(note, {"event": "added", "silent": False, "preExisting": False, "category": "social", "uid": 77})
        self.assertTrue(phone_link.parse_notification_source(bytes([2, 4, 0, 0, 1, 0, 0, 0]))["preExisting"])
        self.assertIsNone(phone_link.parse_notification_source(b"\x00\x01"))

    def test_attributes_whole_and_split(self):
        packet = attrs_packet(9, "com.apple.MobileSMS", "Asha", "Dinner at 8? 🍜")
        self.assertEqual(phone_link.parse_attributes(packet), {"uid": 9, "appId": "com.apple.MobileSMS", "title": "Asha", "message": "Dinner at 8? 🍜"})
        self.assertIsNone(phone_link.parse_attributes(packet[:20]))

    def test_entity_update(self):
        self.assertEqual(phone_link.parse_entity_update(bytes([2, 2, 0]) + b"Yellow"), (2, 2, "Yellow"))

    def test_app_label(self):
        self.assertEqual(phone_link.app_label("com.apple.MobileSMS"), "Messages")
        self.assertEqual(phone_link.app_label("com.example.slack"), "Slack")


class State(unittest.TestCase):
    def setUp(self):
        self.link = phone_link.PhoneLink()
        self.sent = []

        async def broadcast(event):
            self.sent.append(event)
        self.link.broadcast = broadcast

    def run_async(self, coro):
        return asyncio.run(coro)

    def test_data_source_reply_becomes_a_notification(self):
        async def go():
            self.link._pending[5] = {"category": "social", "uid": 5}
            packet = attrs_packet(5, "net.whatsapp.WhatsApp", "Ravi", "On my way")
            await self.link._on_value(phone_link.ANCS_DATA_SOURCE, packet[:12])
            await self.link._on_value(phone_link.ANCS_DATA_SOURCE, packet[12:])
        self.run_async(go())
        self.assertEqual(self.sent[-1]["type"], "PHONE_NOTIFICATION")
        note = self.sent[-1]["notification"]
        self.assertEqual((note["id"], note["app"], note["title"], note["message"]), ("5", "WhatsApp", "Ravi", "On my way"))

    def test_keeps_newest_twenty_and_removes(self):
        async def go():
            for i in range(25):
                await self.link.add_notification({"uid": i + 1, "title": f"n{i}"})
            await self.link.remove_notification("25")
        self.run_async(go())
        shown = self.link.snapshot()["notifications"]
        self.assertEqual(len(shown), 19)
        self.assertEqual(shown[0]["title"], "n23")
        self.assertEqual(self.sent[-1], {"type": "PHONE_NOTIFICATION_REMOVED", "id": "25"})

    def test_allowlist(self):
        with mock.patch.object(phone_link, "ALLOWED_APPS", {"com.apple.MobileSMS"}):
            self.run_async(self.link.add_notification({"uid": 1, "appId": "com.foo.game", "title": "Play!"}))
        self.assertEqual(self.sent, [])

    def test_presence_waits_before_away(self):
        async def go():
            with mock.patch.object(phone_link.time, "time", return_value=1000):
                await self.link.set_presence(True, "iPhone")
            with mock.patch.object(phone_link.time, "time", return_value=1100):
                await self.link.set_presence(False)
            self.assertTrue(self.link.home)
            with mock.patch.object(phone_link.time, "time", return_value=1000 + phone_link.AWAY_AFTER + 1):
                await self.link.set_presence(False)
        self.run_async(go())
        self.assertFalse(self.link.home)
        self.assertEqual(self.sent[-1]["type"], "PHONE_STATUS")
        self.assertFalse(self.sent[-1]["home"])

    def test_media_updates(self):
        async def go():
            await self.link._on_value(phone_link.AMS_ENTITY_UPDATE, bytes([2, 2, 0]) + b"Yellow")
            await self.link._on_value(phone_link.AMS_ENTITY_UPDATE, bytes([2, 0, 0]) + b"Coldplay")
            await self.link._on_value(phone_link.AMS_ENTITY_UPDATE, bytes([0, 1, 0]) + b"1,1.0,12.5")
        self.run_async(go())
        media = self.sent[-1]["media"]
        self.assertEqual((media["title"], media["artist"], media["playing"]), ("Yellow", "Coldplay", True))


if __name__ == "__main__":
    unittest.main()


class V:
    def __init__(self, value):
        self.value = value


class FakeChar:
    def __init__(self, fail_notify=None, fail_write=None):
        self.fail_notify, self.fail_write = fail_notify, fail_write
        self.notified, self.writes = 0, []

    async def call_start_notify(self):
        self.notified += 1
        if self.fail_notify:
            raise Exception(self.fail_notify)

    async def call_write_value(self, value, options):
        self.writes.append(value)
        if self.fail_write:
            raise Exception(self.fail_write)


class FakeProps:
    def __init__(self):
        self.handlers = []

    def on_properties_changed(self, handler):
        self.handlers.append(handler)

    def off_properties_changed(self, handler):
        self.handlers.remove(handler)


class FakeObj:
    def __init__(self, char, props):
        self.char, self.props = char, props

    def get_interface(self, name):
        return self.char if name.endswith("GattCharacteristic1") else self.props


class Subscribing(unittest.TestCase):
    """After Sage restarts, BlueZ can still be starting the last run's notify
    ("In Progress") and the phone can refuse a step (ATT 0x0e). Neither may stop
    the rest, or the clock stops getting songs."""

    def test_refused_steps_dont_stop_now_playing(self):
        dev = "/org/bluez/hci0/dev_X"
        chars = {
            phone_link.ANCS_DATA_SOURCE: FakeChar(fail_notify="Operation failed with ATT error: 0x0e"),
            phone_link.ANCS_NOTIFICATION_SOURCE: FakeChar(fail_notify="In Progress"),
            phone_link.AMS_ENTITY_UPDATE: FakeChar(),
        }
        objects, props = {}, {}
        for i, uuid in enumerate(chars):
            path = f"{dev}/service1/char{i}"
            objects[path] = {"org.bluez.GattCharacteristic1": {"UUID": V(uuid), "Notifying": V(False)}}
            props[path] = FakeProps()
        link = phone_link.PhoneLink()

        async def char(path):
            uuid = objects[path]["org.bluez.GattCharacteristic1"]["UUID"].value
            return FakeObj(chars[uuid], props[path])
        link._char = char

        asyncio.run(link._subscribe(objects, dev))
        self.assertEqual(len(chars[phone_link.AMS_ENTITY_UPDATE].writes), 2)  # player and track asked for
        asyncio.run(link._subscribe(objects, dev))  # a retry adds no second watcher
        self.assertTrue(all(len(p.handlers) == 1 for p in props.values()))
        link._unwatch()
        self.assertTrue(all(not p.handlers for p in props.values()))

        # The phone wasn't ready for the now-playing request: ask again next tick.
        ams = chars[phone_link.AMS_ENTITY_UPDATE]
        ams.fail_write = "Not connected"
        asyncio.run(link._subscribe(objects, dev))
        self.assertEqual(link._chars, {})
        ams.fail_write = None
        asyncio.run(link._subscribe(objects, dev))
        self.assertIn(phone_link.AMS_ENTITY_UPDATE, link._chars)


class Logging(unittest.TestCase):
    def test_lines_say_what_failed_and_repeat_once_a_minute(self):
        link = phone_link.PhoneLink()
        self.assertIn("BLE", phone_link.hint_for("Not connected"))
        with self.assertLogs("phone_link", "WARNING") as logs, mock.patch.object(phone_link.time, "time", return_value=1000):
            for _ in range(5):
                link.say("x", "same thing")
        self.assertEqual(len(logs.output), 1)
        with self.assertLogs("phone_link", "WARNING") as logs, mock.patch.object(phone_link.time, "time", return_value=1061):
            link.say("x", "same thing")
        self.assertIn("repeated 5 times", logs.output[0])
