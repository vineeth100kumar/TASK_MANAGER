import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ["SAGE_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import location  # noqa: E402


class PureTest(unittest.TestCase):
    def test_arrive_adds_unknown_place(self):
        places, here, changed = location.apply_event(location.default_places(), None, "  Gym ", "arrive", 100)
        self.assertTrue(changed)
        self.assertEqual(here, {"place": "Gym", "since": 100})
        self.assertEqual(places[-1], {"name": "Gym", "kind": "other"})

    def test_names_ignore_case(self):
        _, here, _ = location.apply_event(location.default_places(), None, "home", "arrive", 1)
        self.assertEqual(here["place"], "Home")
        _, here2, changed = location.apply_event(location.default_places(), here, "HOME", "arrive", 2)
        self.assertFalse(changed)
        self.assertEqual(here2, here)

    def test_leave_only_counts_for_current_place(self):
        here = {"place": "Home", "since": 1}
        _, still, changed = location.apply_event(location.default_places(), here, "Work", "leave", 5)
        self.assertFalse(changed)
        self.assertEqual(still, here)
        _, out, changed = location.apply_event(location.default_places(), here, "home", "leave", 5)
        self.assertTrue(changed)
        self.assertIsNone(out)

    def test_bad_input(self):
        with self.assertRaises(ValueError):
            location.apply_event([], None, "", "arrive", 1)
        with self.assertRaises(ValueError):
            location.apply_event([], None, "Home", "wave", 1)

    def test_wants_uses_at_labels(self):
        self.assertTrue(location.wants({"labels": ["x", "@Grocery"]}, "grocery"))
        self.assertFalse(location.wants({"labels": ["grocery"]}, "grocery"))
        self.assertFalse(location.wants({}, "grocery"))

    def test_nudge_message_trims(self):
        items = [{"title": f"t{i}"} for i in range(8)]
        m = location.nudge_message("Work", items)
        self.assertIn("and 3 more", m["body"])
        self.assertIn("Work", m["title"])


class StoredTest(unittest.TestCase):
    def test_round_trip(self):
        s = location.state()
        self.assertEqual(s["label"], "Out")
        r = location.record("Home", "arrive", 10)
        self.assertEqual((r["label"], r["kind"], r["changed"]), ("Home", "home", True))
        r = location.record("Cafe", "arrive", 20)
        self.assertEqual(r["label"], "Cafe")
        r = location.record("Cafe", "leave", 30)
        self.assertEqual(r["label"], "Out")
        self.assertEqual(location.set_kind("Cafe", "work")["places"][-1]["kind"], "work")
        location.remove_place("Cafe")
        self.assertIsNone(location.find(location.get_places(), "Cafe"))


if __name__ == "__main__":
    unittest.main()
