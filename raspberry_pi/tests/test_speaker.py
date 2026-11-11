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
