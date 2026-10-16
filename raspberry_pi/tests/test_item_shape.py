"""Tests for item_shape.py: the Pi reads old and new work items the same way
the web app does (src/services/items.ts), so both agree on what is open.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import item_shape  # noqa: E402


class ItemShapeTests(unittest.TestCase):
    def test_kind_from_old_type(self):
        self.assertEqual(item_shape.kind_of({"type": "meeting"}), "event")
        self.assertEqual(item_shape.kind_of({"type": "milestone"}), "milestone")
        self.assertEqual(item_shape.kind_of({"type": "bug"}), "task")
        self.assertEqual(item_shape.kind_of({"entityType": "Reminder"}), "reminder")

    def test_status_words(self):
        s = lambda raw, t=None: item_shape.status_of(raw, t)
        self.assertEqual(s({"status": "in_review"}), ("in_progress", None))
        self.assertEqual(s({"status": "Achieved"})[0], "done")
        self.assertEqual(s({"status": "shipped"}, "technical"), ("done", "shipped"))
        self.assertEqual(s({"status": "editing"}, "content"), ("in_progress", "editing"))
        self.assertEqual(s({"status": "???", "completedAt": "2026-10-01"})[0], "done")
        self.assertEqual(s({})[0], "todo")

    def test_normalize_keeps_unknown_fields_and_fills_the_rest(self):
        item = item_shape.normalize_item({"id": "a", "title": "", "lifeContext": "life", "labels": "x, y",
                                          "isFocus": "TRUE", "priority": "Critical", "extra": 1})
        self.assertEqual((item["title"], item["lifeContext"], item["labels"], item["isFocus"], item["priority"], item["extra"]),
                         ("Untitled", "personal", ["x", "y"], True, "urgent", 1))
        self.assertEqual((item["entityType"], item["status"], item["branchId"]), ("task", "todo", None))

    def test_open_is_decided_by_status(self):
        reopened = item_shape.normalize_item({"status": "todo", "completedAt": "2026-10-01"})
        self.assertTrue(item_shape.is_open(reopened))
        self.assertFalse(item_shape.is_open(item_shape.normalize_item({"status": "done"})))
        self.assertFalse(item_shape.is_open(item_shape.normalize_item({"status": "todo", "deletedAt": "x"})))

    def test_next_key(self):
        self.assertEqual(item_shape.next_key([{"key": "S-1"}, {"key": "S-50"}, {}, {"key": "SAGE-9"}], "S"), "S-51")
        self.assertEqual(item_shape.next_key([], "TASK"), "TASK-1")

    def test_project_types(self):
        self.assertEqual(item_shape.project_types([{"id": "a", "type": "standard"}, {"id": "b", "type": "technical"}]),
                         {"a": "other", "b": "technical"})


if __name__ == "__main__":
    unittest.main()
