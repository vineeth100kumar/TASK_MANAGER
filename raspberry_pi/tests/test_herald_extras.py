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


class JournalTests(unittest.TestCase):
    def setUp(self):
        import datetime as dt
        import herald_journal as hj
        self.dt, self.hj = dt, hj
        self.tz = dt.timezone.utc
        self.base = dt.datetime(2026, 11, 16, 0, 0, tzinfo=self.tz).timestamp()

    def at(self, hour, minute=0, day=0):
        return self.base + day * 86400 + hour * 3600 + minute * 60

    def test_trip_and_report(self):
        j = self.hj.leave({}, self.at(9))
        j = self.hj.leave(j, self.at(9, 1))                  # the Leave button, then Bluetooth: one trip
        self.assertEqual(len(j["trips"]), 1)
        j = self.hj.arrive(j, self.at(12))
        r = self.hj.day_report(j, self.dt.date(2026, 11, 16), self.tz, self.at(18))
        self.assertEqual(r["out"], [[540, 720]])
        self.assertEqual(r["awayMin"], 180)
        self.assertEqual(r["homeMin"], 360)   # known 09:00 to 18:00 (540 min), less the 180 min trip
        self.assertFalse(self.hj.day_report(j, self.dt.date(2026, 11, 15), self.tz, self.at(18))["known"])

    def test_blip_is_dropped(self):
        j = self.hj.leave({}, self.at(9))
        j = self.hj.arrive(j, self.at(9, 1))
        self.assertEqual(j["trips"], [])

    def test_open_trip_reaches_now(self):
        j = self.hj.leave({}, self.at(20))
        self.assertTrue(self.hj.is_out(j))
        r = self.hj.day_report(j, self.dt.date(2026, 11, 16), self.tz, self.at(22))
        self.assertEqual(r["out"], [[1200, 1320]])

    def test_late_returns_and_remarks(self):
        j = {}
        for d in range(3):
            j = self.hj.leave(j, self.at(20, day=d))
            j = self.hj.arrive(j, self.at(23, 30, day=d))
        self.assertEqual(self.hj.late_returns(j, self.tz, self.at(23, 45, day=2)), 3)
        self.assertEqual(self.hj.memory_remark(3, 0, "sir"), "That is the third late return this week, sir.")
        self.assertEqual(self.hj.memory_remark(1, 3), "Three days running with something closed. Rather good.")
        self.assertEqual(self.hj.memory_remark(1, 2), "")

    def test_streak(self):
        today = self.dt.date(2026, 11, 16)
        self.assertEqual(self.hj.closed_streak({"2026-11-16", "2026-11-15", "2026-11-14", "2026-11-12"}, today), 3)
        self.assertEqual(self.hj.closed_streak({"2026-11-15", "2026-11-14"}, today), 2)    # today still open
        self.assertEqual(self.hj.closed_streak(set(), today), 0)


class HeadsUpTests(unittest.TestCase):
    def test_lines(self):
        self.assertEqual(h.heads_up_line("rain", "sir"), "Rain about, sir. Do take an umbrella.")
        self.assertEqual(h.heads_up_line("sun"), "")
        self.assertIn("Snow", h.heads_up_line("snow"))
