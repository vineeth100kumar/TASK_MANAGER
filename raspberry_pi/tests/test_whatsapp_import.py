"""Tests for reading an exported WhatsApp chat into suggested items.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import base64
import datetime
import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "chat.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import chat_import  # noqa: E402
import db_server  # noqa: E402

client = TestClient(db_server.app)
TODAY = datetime.date(2026, 10, 3)

IPHONE = (
    "‎[25/09/2026, 9:58:01 AM] Work: ‎Messages and calls are end-to-end encrypted.\n"
    "[01/10/2026, 10:12:33 AM] Rahul: Can you send the deck by monday?\n"
    "It needs the Q3 numbers\n"
    "[01/10/2026, 10:13:02 AM] Vineeth: Sure\n"
    "[01/10/2026, 10:14:10 PM] Priya: ‎image omitted\n"
)
ANDROID = (
    "10/1/26, 22:05 - Priya: Launch is on the 20th\n"
    "10/1/26, 22:06 - Priya added Rahul\n"
    "10/2/26, 9:00 am - Rahul: <Media omitted>\n"
)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class TestParseExport(unittest.TestCase):
    def test_iphone_export(self):
        msgs = chat_import.parse_export(IPHONE)
        self.assertEqual([m.sender for m in msgs], ["Rahul", "Vineeth"])
        self.assertEqual(msgs[0].date, datetime.date(2026, 10, 1))
        self.assertEqual(msgs[0].time, "10:12")
        self.assertEqual(msgs[0].text, "Can you send the deck by monday?\nIt needs the Q3 numbers")

    def test_android_month_first_and_system_lines(self):
        msgs = chat_import.parse_export(ANDROID)
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0].date, datetime.date(2026, 10, 1))
        self.assertEqual(msgs[0].time, "22:05")

    def test_pm_time(self):
        msgs = chat_import.parse_export("[02/10/2026, 8:30:00 PM] A: dinner?")
        self.assertEqual(msgs[0].time, "20:30")

    def test_recent_keeps_window_and_newest(self):
        msgs = chat_import.parse_export(IPHONE)
        self.assertEqual(len(chat_import.recent(msgs, 1, TODAY)), 0)
        self.assertEqual(len(chat_import.recent(msgs, 30, TODAY)), 2)
        with mock.patch.object(chat_import, "MAX_TRANSCRIPT_CHARS", 80):
            kept = chat_import.recent(msgs, 0, TODAY)
        self.assertEqual([m.sender for m in kept], ["Vineeth"])


class TestUpload(unittest.TestCase):
    def test_zip_from_iphone(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("_chat.txt", IPHONE)
        text, name = chat_import.decode_upload("WhatsApp Chat - Work.zip", b64(buf.getvalue()))
        self.assertEqual(name, "Work")
        self.assertIn("Rahul", text)

    def test_txt_from_android(self):
        text, name = chat_import.decode_upload("WhatsApp Chat with Priya.txt", b64(ANDROID.encode()))
        self.assertEqual(name, "Priya")


class TestParseItems(unittest.TestCase):
    def test_forgiving_and_validated(self):
        answer = (
            "<think>hmm {\"items\": []}</think>Here you go:\n```json\n"
            '{"items": [{"title": "Send the deck", "kind": "task", "date": "2026-10-05", "time": null, "who": "Rahul"},'
            ' {"title": "send the deck", "kind": "task"},'
            ' {"title": "Launch", "kind": "goal", "date": "20th", "time": "25:00"},'
            ' "junk", {"title": ""}]}\n```'
        )
        items = chat_import.parse_items(answer)
        self.assertEqual([i["title"] for i in items], ["Send the deck", "Launch"])
        self.assertEqual(items[0]["date"], "2026-10-05")
        self.assertEqual(items[1]["kind"], "task")
        self.assertIsNone(items[1]["date"])
        self.assertIsNone(items[1]["time"])

    def test_no_json(self):
        self.assertEqual(chat_import.parse_items("Nothing here"), [])


class TestEndpoint(unittest.TestCase):
    def test_reads_chat_with_ai(self):
        answer = '{"items": [{"title": "Send the deck", "kind": "task", "date": "2026-10-05", "who": "Rahul", "quote": "Can you send the deck by monday?", "sent": "2026-10-01"}]}'
        with mock.patch.object(chat_import, "ask_ai", return_value=(answer, "groq")) as ask, \
                mock.patch.object(chat_import.datetime, "date", wraps=datetime.date) as fake_date:
            fake_date.today.return_value = TODAY
            res = client.post("/api/chat-import", json={"fileName": "WhatsApp Chat - Work.txt", "dataBase64": b64(IPHONE.encode())})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["chatName"], "Work")
        self.assertEqual(body["messageCount"], 2)
        self.assertEqual(body["items"][0]["title"], "Send the deck")
        self.assertIn("2026-10-01 10:12 Rahul: Can you send the deck", ask.call_args[0][0])

    def test_not_a_chat(self):
        res = client.post("/api/chat-import", json={"fileName": "notes.txt", "dataBase64": b64(b"just some notes")})
        self.assertEqual(res.status_code, 400)

    def test_bad_zip(self):
        res = client.post("/api/chat-import", json={"fileName": "x.zip", "dataBase64": b64(b"PK\x03\x04broken")})
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
