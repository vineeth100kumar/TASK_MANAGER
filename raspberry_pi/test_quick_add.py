"""Tests for the server-side quick-add parser."""

import datetime
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from quick_add import parse_quick_add


# Pin "now" so date-relative tests are deterministic.
NOW = datetime.datetime(2026, 10, 3, 10, 0, 0)  # Saturday
TODAY = "2026-10-03"


class TestBasicParsing(unittest.TestCase):
    def test_plain_title(self):
        r = parse_quick_add("Buy milk", NOW)
        self.assertEqual(r.title, "Buy milk")
        self.assertEqual(r.entity_type, "task")
        self.assertIsNone(r.date)

    def test_tags(self):
        r = parse_quick_add("Buy milk #errands #home", NOW)
        self.assertEqual(r.title, "Buy milk")
        self.assertIn("errands", r.tags)
        self.assertIn("home", r.tags)

    def test_priority_bang(self):
        r = parse_quick_add("Fix leak !urgent", NOW)
        self.assertEqual(r.priority, "urgent")
        self.assertEqual(r.title, "Fix leak")

    def test_priority_bare(self):
        r = parse_quick_add("Submit report asap", NOW)
        self.assertEqual(r.priority, "urgent")

    def test_duration(self):
        r = parse_quick_add("Run ~30m", NOW)
        self.assertEqual(r.duration_minutes, 30)
        r2 = parse_quick_add("Deep work ~2h", NOW)
        self.assertEqual(r2.duration_minutes, 120)
        r3 = parse_quick_add("Study ~1h30m", NOW)
        self.assertEqual(r3.duration_minutes, 90)

    def test_location(self):
        r = parse_quick_add("Pickup dry cleaning @downtown", NOW)
        self.assertEqual(r.location, "downtown")


class TestDates(unittest.TestCase):
    def test_today(self):
        r = parse_quick_add("Call mom today", NOW)
        self.assertEqual(r.date, TODAY)

    def test_tomorrow(self):
        r = parse_quick_add("Dentist tomorrow", NOW)
        self.assertEqual(r.date, "2026-10-04")

    def test_tonight(self):
        r = parse_quick_add("Pack bags tonight", NOW)
        self.assertEqual(r.date, TODAY)
        self.assertEqual(r.time, "21:00")

    def test_next_week(self):
        r = parse_quick_add("Review docs next week", NOW)
        # Saturday Oct 3 → next Monday Oct 5
        self.assertEqual(r.date, "2026-10-05")

    def test_weekday_name(self):
        r = parse_quick_add("Meeting on Wednesday", NOW)
        self.assertEqual(r.date, "2026-10-07")  # next Wednesday

    def test_in_n_days(self):
        r = parse_quick_add("Follow up in 3 days", NOW)
        self.assertEqual(r.date, "2026-10-06")

    def test_iso_date(self):
        r = parse_quick_add("Launch on 2026-11-01", NOW)
        self.assertEqual(r.date, "2026-11-01")

    def test_month_day(self):
        r = parse_quick_add("Birthday party oct 15", NOW)
        self.assertEqual(r.date, "2026-10-15")

    def test_slash_date(self):
        r = parse_quick_add("File taxes by 4/15", NOW)
        self.assertEqual(r.date, "2027-04-15")  # past this year, rolls to next


class TestTimes(unittest.TestCase):
    def test_12h(self):
        r = parse_quick_add("Call at 3pm", NOW)
        self.assertEqual(r.time, "15:00")

    def test_24h(self):
        r = parse_quick_add("Standup 09:30", NOW)
        self.assertEqual(r.time, "09:30")

    def test_noon(self):
        r = parse_quick_add("Lunch at noon", NOW)
        self.assertEqual(r.time, "12:00")

    def test_this_morning(self):
        r = parse_quick_add("Yoga this morning", NOW)
        self.assertEqual(r.time, "09:00")
        self.assertEqual(r.date, TODAY)


class TestRecurrence(unittest.TestCase):
    def test_daily(self):
        r = parse_quick_add("Take vitamins daily", NOW)
        self.assertEqual(r.repeat_rule, "daily")

    def test_every_week(self):
        r = parse_quick_add("Team sync every week", NOW)
        self.assertEqual(r.repeat_rule, "weekly")

    def test_every_monday(self):
        r = parse_quick_add("Standup every monday", NOW)
        self.assertEqual(r.repeat_rule, "weekly:1")

    def test_every_other_week(self):
        r = parse_quick_add("Groceries every other week", NOW)
        self.assertEqual(r.repeat_rule, "every:2:weeks")


class TestEntityType(unittest.TestCase):
    def test_reminder_prefix(self):
        r = parse_quick_add("Remind me to call the vet tomorrow", NOW)
        self.assertEqual(r.entity_type, "reminder")
        self.assertEqual(r.title, "call the vet")
        self.assertEqual(r.date, "2026-10-04")

    def test_event_detection(self):
        r = parse_quick_add("Meeting with Bob at 3pm @office", NOW)
        self.assertEqual(r.entity_type, "event")


class TestCombined(unittest.TestCase):
    def test_full_parse(self):
        r = parse_quick_add("Buy groceries tomorrow 3pm #errands !high ~45m @store", NOW)
        self.assertEqual(r.title, "Buy groceries")
        self.assertEqual(r.date, "2026-10-04")
        self.assertEqual(r.time, "15:00")
        self.assertIn("errands", r.tags)
        self.assertEqual(r.priority, "high")
        self.assertEqual(r.duration_minutes, 45)
        self.assertEqual(r.location, "store")

    def test_to_dict(self):
        r = parse_quick_add("Test task", NOW)
        d = r.to_dict()
        self.assertIn("title", d)
        self.assertEqual(d["title"], "Test task")


if __name__ == "__main__":
    unittest.main()
