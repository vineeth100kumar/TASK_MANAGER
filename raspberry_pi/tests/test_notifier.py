"""Tests for notifier.py: when notifications fire, what they say, and that a
real push is encrypted and signed the way push services expect.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import base64
import datetime
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import notifier  # noqa: E402

UTC = datetime.timezone.utc


def utc(*args) -> datetime.datetime:
    return datetime.datetime(*args, tzinfo=UTC)


def put_items(*items) -> None:
    conn = sqlite3.connect(notifier.DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS entities (table_name TEXT, entity_id TEXT, revision INTEGER, payload TEXT, deleted INTEGER DEFAULT 0, server_revision INTEGER, PRIMARY KEY (table_name, entity_id))")
    conn.execute("DELETE FROM entities")
    for item in items:
        item = {"status": "todo", "entityType": "task", "priority": "medium", **item}
        conn.execute("INSERT INTO entities VALUES ('workItems', ?, 1, ?, 0, 1)", (item["id"], json.dumps(item)))
    conn.commit()
    conn.close()


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        notifier.init_tables()
        conn = sqlite3.connect(notifier.DB_PATH)
        conn.execute("DELETE FROM notification_log")
        conn.execute("DELETE FROM metadata WHERE key = 'notifyPrefs'")
        conn.execute("DELETE FROM push_subscriptions")
        conn.execute("INSERT INTO push_subscriptions VALUES ('https://push.example/1', '{}', 'iPhone', '', NULL)")
        conn.commit()
        conn.close()
        # India is UTC+5:30, so a wrong timezone shows up as a wrong hour.
        notifier.save_prefs({"timezone": "Asia/Kolkata"})
        self.pushed = []
        patcher = mock.patch.object(notifier, "send_push", side_effect=lambda message, *a, **k: self.pushed.append(message) or [{"ok": True}])
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_reminder_fires_at_local_wall_time_once(self):
        put_items({"id": "a", "title": "Call the bank", "remindAt": "2026-10-01T09:00", "dueDate": "2026-10-01"})
        notifier.save_prefs({"morningPlan": False})
        self.assertEqual(notifier.run_once(utc(2026, 10, 1, 3, 29)), [])  # 08:59 in Kolkata
        self.assertEqual(notifier.run_once(utc(2026, 10, 1, 3, 30)), ["remind:a:2026-10-01T09:00"])
        self.assertEqual(notifier.run_once(utc(2026, 10, 1, 3, 31)), [])  # not twice
        self.assertEqual(self.pushed[0]["title"], "Call the bank")
        self.assertEqual(self.pushed[0]["body"], "Due today")
        self.assertEqual(self.pushed[0]["url"], "/?open=a")

    def test_utc_reminder_and_stale_reminder(self):
        put_items(
            {"id": "z", "title": "UTC one", "remindAt": "2026-10-01T03:30:00Z"},
            {"id": "old", "title": "Long gone", "remindAt": "2026-10-01T06:00"},
        )
        notifier.save_prefs({"morningPlan": False})
        sent = notifier.run_once(utc(2026, 10, 1, 3, 30))
        self.assertEqual(sent, ["remind:z:2026-10-01T03:30:00Z"])  # 06:00 local was 3h ago: skipped

    def test_finished_and_deleted_items_stay_quiet(self):
        put_items(
            {"id": "d", "title": "Done", "remindAt": "2026-10-01T09:00", "status": "done"},
            {"id": "x", "title": "Deleted", "remindAt": "2026-10-01T09:00", "deletedAt": "2026-09-30T00:00:00Z"},
        )
        notifier.save_prefs({"morningPlan": False})
        self.assertEqual(notifier.run_once(utc(2026, 10, 1, 3, 30)), [])

    def test_event_reminder_says_when_it_starts(self):
        put_items({"id": "e", "title": "Standup", "entityType": "event", "startAt": "2026-10-01T10:00", "remindAt": "2026-10-01T09:50", "location": "Zoom"})
        notifier.run_once(utc(2026, 10, 1, 4, 20))
        self.assertEqual(self.pushed[0]["body"], "Starts in 10 min · Zoom")

    def test_morning_plan(self):
        put_items(
            {"id": "1", "title": "Ship report", "dueDate": "2026-10-01", "priority": "high"},
            {"id": "2", "title": "Gym", "dueDate": "2026-10-01"},
            {"id": "3", "title": "Taxes", "dueDate": "2026-09-20"},
            {"id": "4", "title": "Snoozed", "dueDate": "2026-10-01", "snoozedUntil": "2026-10-02T09:00"},
            {"id": "5", "title": "Later", "dueDate": "2026-10-05"},
        )
        self.assertEqual(notifier.run_once(utc(2026, 10, 1, 2, 29)), [])  # 07:59
        self.assertIn("morning:2026-10-01", notifier.run_once(utc(2026, 10, 1, 2, 30)))
        message = self.pushed[-1]
        self.assertEqual(message["title"], "Today: 2 things planned")
        self.assertEqual(message["body"], "Ship report and Gym. Plus 1 overdue.")
        self.assertNotIn("morning:2026-10-01", notifier.run_once(utc(2026, 10, 1, 2, 40)))

    def test_morning_plan_skips_an_empty_day(self):
        put_items({"id": "5", "title": "Later", "dueDate": "2026-10-05"})
        self.assertEqual(notifier.run_once(utc(2026, 10, 1, 2, 30)), [])
        self.assertEqual(self.pushed, [])

    def test_evening_check_in_only_when_something_is_open(self):
        put_items({"id": "1", "title": "Ship report", "dueDate": "2026-10-01"})
        sent = notifier.run_once(utc(2026, 10, 1, 12, 30))  # 18:00
        self.assertIn("evening:2026-10-01", sent)
        self.assertEqual(self.pushed[-1]["title"], "1 thing still open from today")
        put_items({"id": "1", "title": "Ship report", "dueDate": "2026-10-02", "status": "done"})
        self.assertEqual(notifier.run_once(utc(2026, 10, 2, 12, 30)), [])

    def test_turned_off_means_off(self):
        notifier.save_prefs({"reminders": False, "morningPlan": False, "eveningCheckIn": False})
        put_items({"id": "a", "title": "x", "remindAt": "2026-10-01T09:00", "dueDate": "2026-10-01"})
        for minute in (2 * 60 + 30, 3 * 60 + 30, 12 * 60 + 30):
            self.assertEqual(notifier.run_once(utc(2026, 10, 1) + datetime.timedelta(minutes=minute)), [])

    def test_email_morning_plan(self):
        notifier.save_smtp_password("abcd efgh ijkl mnop")
        notifier.save_prefs({"email": {"enabled": True, "to": "me@example.com"}})
        put_items({"id": "1", "title": "Ship <report>", "dueDate": "2026-10-01"})
        with mock.patch("smtplib.SMTP") as smtp:
            notifier.run_once(utc(2026, 10, 1, 2, 30))
        session = smtp.return_value.__enter__.return_value
        session.starttls.assert_called_once()
        session.login.assert_called_once_with("me@example.com", "abcdefghijklmnop")
        msg = session.send_message.call_args[0][0]
        self.assertEqual(msg["To"], "me@example.com")
        self.assertIn("1 thing planned", msg["Subject"])
        html_part = msg.get_body(("html",)).get_content()
        self.assertIn("Ship &lt;report&gt;", html_part)

    def test_prefs_are_validated(self):
        with self.assertRaises(ValueError):
            notifier.save_prefs({"timezone": "Mars/Base"})
        with self.assertRaises(ValueError):
            notifier.save_prefs({"morningTime": "8am"})
        with self.assertRaises(ValueError):
            notifier.save_prefs({"email": {"enabled": True, "to": ""}})


@unittest.skipUnless(notifier.push_available(), "pywebpush is not installed")
class RealPushTests(unittest.TestCase):
    """Sends a real push to a local server and decrypts it like a browser would."""

    def test_push_is_signed_and_decryptable(self):
        mock.patch.object(notifier, "_app_link", return_value="").start()
        self.addCleanup(mock.patch.stopall)
        import http_ece
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        received = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received["headers"] = {k.lower(): v for k, v in self.headers.items()}
                received["body"] = self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(201)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.handle_request, daemon=True).start()
        endpoint = f"http://127.0.0.1:{server.server_port}/push/abc"

        browser_key = ec.generate_private_key(ec.SECP256R1())
        browser_public = browser_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        auth = os.urandom(16)
        b64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")  # noqa: E731

        notifier.init_tables()
        conn = sqlite3.connect(notifier.DB_PATH)
        conn.execute("DELETE FROM push_subscriptions")
        conn.execute(
            "INSERT INTO push_subscriptions VALUES (?, ?, 'Test', '', NULL)",
            (endpoint, json.dumps({"endpoint": endpoint, "keys": {"p256dh": b64(browser_public), "auth": b64(auth)}})),
        )
        conn.commit()
        conn.close()

        results = notifier.send_push({"title": "Hello", "body": "World"})
        self.assertEqual(results, [{"label": "Test", "ok": True}])
        self.assertTrue(received["headers"]["authorization"].startswith("vapid t="))
        self.assertIn(f"k={notifier.vapid_public_key()}", received["headers"]["authorization"])
        self.assertEqual(received["headers"]["content-encoding"], "aes128gcm")
        plain = http_ece.decrypt(received["body"], private_key=browser_key, auth_secret=auth, version="aes128gcm")
        self.assertEqual(json.loads(plain), {"title": "Hello", "body": "World"})

    def test_subscriptions_must_be_https(self):
        with self.assertRaises(ValueError):
            notifier.save_subscription({"endpoint": "http://evil.example/", "keys": {"p256dh": "a", "auth": "b"}}, "x")


if __name__ == "__main__":
    unittest.main()
