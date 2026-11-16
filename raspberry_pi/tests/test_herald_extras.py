"""Tests for herald_extras.py (recap, call replay, wind-down) and the speaker rules that use it.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("SAGE_DB_PATH", str(Path(tempfile.mkdtemp()) / "test.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import herald_extras as h  # noqa: E402
import speaker  # noqa: E402


class NamesTests(unittest.TestCase):
    def test_join(self):
        self.assertEqual(h.join_names(["Sansa"]), "Sansa")
        self.assertEqual(h.join_names(["Sansa", "Arya"]), "Sansa and Arya")
        self.assertEqual(h.join_names(["A", "B", "C", "A"]), "A, B and C")
        self.assertEqual(h.join_names(["A", "B", "C", "D", "E", "F"]), "A, B, C and three others")

    def test_named_only(self):
        self.assertTrue(h.is_named("Sansa"))
        self.assertFalse(h.is_named("+91 98765 43210"))
        self.assertFalse(h.is_named(""))


class RecapTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(h.recap_line([], [], [], []), "")

    def test_names_only(self):
        line = h.recap_line(["Sansa", "Arya"], ["Bruce"], ["Ned"], ["Pay rent"], "sir")
        self.assertEqual(line, "While you were out, sir, Sansa and Arya messaged you. Bruce emailed you. Ned tried to ring you. A reminder slipped by: Pay rent.")

    def test_openers_cycle_and_plural_reminders(self):
        line = h.recap_line([], [], [], ["A", "B"], "", idx=1)
        self.assertTrue(line.startswith("In your absence,"))
        self.assertIn("two reminders slipped by, starting with A.", line)

    def test_missed_reminders(self):
        items = [
            {"title": "Pay rent", "dueDate": "2026-11-16", "dueTime": "11:30"},
            {"title": "Too early", "dueDate": "2026-11-16", "dueTime": "08:00"},
            {"title": "Secret", "dueDate": "2026-11-16", "dueTime": "11:00", "isHidden": True},
            {"title": "Alarm", "dueDate": "2026-11-16", "dueTime": "11:00", "labels": ["alarm"]},
            {"title": "Tomorrow", "dueDate": "2026-11-17", "dueTime": "11:00"},
            {"title": "No time", "dueDate": "2026-11-16"},
        ]
        self.assertEqual(h.missed_reminders(items, "10:00", "13:00", "2026-11-16"), ["Pay rent"])


class ReplayAndWindTests(unittest.TestCase):
    def test_replay(self):
        held = [{"kind": "whatsapp", "who": "Sansa"}, {"kind": "reminder", "title": "Pay rent"}, {"kind": "message", "who": "+911234567890"}]
        self.assertEqual(h.replay_line(held, "sir"), "While you were on the call, sir, Sansa messaged you. A reminder came up: Pay rent.")
        self.assertEqual(h.replay_line([], "sir"), "")

    def test_wind_down(self):
        self.assertEqual(h.wind_down_line(3, "Call mum", "sir"),
                         "That's the day, sir. You closed three things today. First up tomorrow: Call mum. Rest well.")
        self.assertIn("Nothing was ticked off today", h.wind_down_line(0, None))
        self.assertIn("Tomorrow is clear so far.", h.wind_down_line(1, None, remark="Third late night."))


class SpeakerRuleTests(unittest.TestCase):
    def test_wind_down_setting(self):
        self.assertEqual(speaker.clean_settings({"windDown": ""})["windDown"], "")
        self.assertEqual(speaker.clean_settings({"windDown": "21:15"})["windDown"], "21:15")
        with self.assertRaises(ValueError):
            speaker.clean_settings({"windDown": "9pm"})

    def test_window(self):
        self.assertEqual(speaker.herald_extras_later("21:45"), "23:15")
        self.assertEqual(speaker.herald_extras_later("23:00"), "23:59")

    def test_hold_and_collect(self):
        sp = speaker.Speaker()
        sp._call_until = 9e12
        self.assertTrue(sp.holding())
        sp._hold({"kind": "notice", "meta": {"kind": "whatsapp", "who": "Sansa"}})
        sp._hold({"kind": "notice", "meta": {"kind": "battery"}})
        self.assertEqual(sp._held, [{"kind": "whatsapp", "who": "Sansa", "title": ""}])
        sp._recap_until = 9e12
        sp._collect_recap({"appId": "net.whatsapp.WhatsApp", "title": "Sansa", "preExisting": True})
        sp._collect_recap({"appId": "net.whatsapp.WhatsApp", "title": "+91 99999 99999"})
        sp._collect_recap({"appId": "in.swiggy.ios", "title": "Swiggy"})
        sp._collect_recap({"appId": "com.apple.mobilephone", "title": "Ned", "category": "missed call"})
        self.assertEqual(sp._recap, [{"kind": "whatsapp", "who": "Sansa"}, {"kind": "call", "who": "Ned"}])


if __name__ == "__main__":
    unittest.main()
