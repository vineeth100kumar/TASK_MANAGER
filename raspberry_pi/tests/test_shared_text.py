"""Tests for turning shared or forwarded text (a WhatsApp message, a long
note) into a Quick-Add item.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import datetime
import os
import sys
import tempfile
import unittest
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "shared.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
from quick_add import parse_quick_add, split_shared_text  # noqa: E402

client = TestClient(db_server.app)
NOW = datetime.datetime(2026, 10, 3, 10, 0, 0)  # Saturday


class TestSplitSharedText(unittest.TestCase):
    def test_short_line_is_untouched(self):
        self.assertEqual(split_shared_text("Call mum tomorrow 3pm"), ("Call mum tomorrow 3pm", ""))

    def test_iphone_header_is_removed(self):
        text = "[03/10/2026, 10:12:33 AM] Rahul: Dinner at ours friday 8pm?"
        title, notes = split_shared_text(text)
        self.assertEqual(title, "Dinner at ours friday 8pm?")
        self.assertEqual(notes, text)
        r = parse_quick_add(title, NOW)
        self.assertEqual(r.date, "2026-10-09")
        self.assertEqual(r.time, "20:00")

    def test_android_header_is_removed(self):
        title, _ = split_shared_text("03/10/2026, 10:12 - Priya: Send the deck by monday")
        self.assertEqual(title, "Send the deck by monday")

    def test_several_messages_use_the_first_as_title(self):
        text = (
            "‎[03/10/26, 09:01:02] Boss: Need the Q3 numbers before the review\n"
            "[03/10/26, 09:01:40] Boss: Also book room 4"
        )
        title, notes = split_shared_text(text)
        self.assertEqual(title, "Need the Q3 numbers before the review")
        self.assertIn("Also book room 4", notes)

    def test_long_text_is_cut_at_a_word(self):
        text = "word " * 40
        title, notes = split_shared_text(text)
        self.assertTrue(title.endswith("…"))
        self.assertLessEqual(len(title), 101)
        self.assertEqual(notes, text.strip())


class TestQuickAddEndpoint(unittest.TestCase):
    def test_whatsapp_message_becomes_inbox_item_with_notes(self):
        text = "[03/10/2026, 10:12:33 AM] Rahul: Can you fix the login bug?\nIt crashes on iPhone"
        res = client.post("/api/quick-add", json={"text": text, "source": "whatsapp"})
        self.assertEqual(res.status_code, 200)
        item = res.json()["item"]
        self.assertEqual(item["title"], "Can you fix the login bug?")
        self.assertEqual(item["description"], text)
        self.assertIn("whatsapp", item["labels"])
        self.assertTrue(item["isInbox"])
        self.assertNotIn("dueDate", item)

    def test_siri_one_liner_has_no_notes(self):
        res = client.post("/api/quick-add", json={"text": "Buy milk #errands", "source": "siri"})
        item = res.json()["item"]
        self.assertEqual(item["title"], "Buy milk")
        self.assertNotIn("description", item)
        self.assertEqual(item["labels"], ["errands"])


if __name__ == "__main__":
    unittest.main()
