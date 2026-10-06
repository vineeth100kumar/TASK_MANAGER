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
