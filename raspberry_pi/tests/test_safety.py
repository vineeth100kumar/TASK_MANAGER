"""Tests for backups, the confirmed clear, per-device PIN limits, the time zone
setting and the Sheet backup request.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import datetime
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "safety.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import access_gate  # noqa: E402
import backup  # noqa: E402
import db_server  # noqa: E402
import notifier  # noqa: E402

client = TestClient(db_server.app)
UTC = datetime.timezone.utc
CLEAR = {"content": '{"confirm": "DELETE"}', "headers": {"Content-Type": "text/plain;charset=utf-8"}}


def point_backups_at_this_db(case):
    """Other test files may have loaded backup.py first with their own paths."""
    for name, value in (("DB_PATH", db_server.DB_PATH), ("BACKUP_DIR", Path(TMP) / "backups")):
        patcher = mock.patch.object(backup, name, value)
        patcher.start()
        case.addCleanup(patcher.stop)


def add_item(entity_id="a"):
    resp = client.post("/api/sync/operations", json={"action": "processOperations", "operations": [{
        "operationId": f"op-{entity_id}", "clientId": "t", "entityType": "workItems", "entityId": entity_id,
        "operation": "save", "revision": 1, "payload": {"id": entity_id, "title": "Keep me", "updatedAt": "2026-10-02T00:00:00Z"},
    }]})
    resp.raise_for_status()


def titles(path):
    conn = sqlite3.connect(path)
    rows = conn.execute("SELECT payload FROM entities WHERE table_name = 'workItems' AND deleted = 0").fetchall()
    conn.close()
    return len(rows)


class BackupTests(unittest.TestCase):
    def setUp(self):
        point_backups_at_this_db(self)
        for f in backup.list_backups():
            f.unlink()

    def test_backup_copies_the_data_and_keeps_only_the_newest(self):
        add_item()
        with mock.patch.object(backup, "KEEP", 3):
            for minute in range(5):
                backup.make_backup(now=datetime.datetime(2026, 10, 2, 3, minute, tzinfo=UTC))
            kept = backup.list_backups()
        self.assertEqual(len(kept), 3)
        self.assertTrue(kept[0].name.startswith("sage-20261002-030400"))
        self.assertEqual(titles(kept[0]), 1)
        self.assertEqual(backup.status()["count"], 3)

    def test_due_once_per_night_after_the_set_time(self):
        tz = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
        at = lambda h, m: datetime.datetime(2026, 10, 2, h, m, tzinfo=tz)
        last_night = at(3, 0).astimezone(UTC) - datetime.timedelta(days=1)
        self.assertFalse(backup.due(at(2, 59), last_night))
        self.assertTrue(backup.due(at(3, 0), last_night))
        self.assertTrue(backup.due(at(14, 0), None))
        self.assertFalse(backup.due(at(14, 0), at(3, 1).astimezone(UTC)))

    def test_run_endpoint_and_status(self):
        add_item()
        self.assertEqual(client.post("/api/backup/run").status_code, 200)
        status = client.get("/api/backup/status").json()
        self.assertEqual(status["count"], 1)
        self.assertTrue(status["lastBackupAt"])


class ClearTests(unittest.TestCase):
    def setUp(self):
        point_backups_at_this_db(self)

    def test_clear_needs_the_word_and_saves_a_backup_first(self):
        add_item("c1")
        for body in (None, {}, {"confirm": "yes"}):
            resp = client.post("/api/sync/clear", content=None if body is None else __import__("json").dumps(body), headers={"Content-Type": "text/plain;charset=utf-8"})
            self.assertEqual(resp.status_code, 400)
        self.assertIn("c1", [r["id"] for r in client.get("/api/sync/all").json()["data"]["workItems"]])
        resp = client.post("/api/sync/clear", **CLEAR)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(client.get("/api/sync/all").json()["data"], {})
        saved = backup.BACKUP_DIR / resp.json()["backup"]
        self.assertTrue(saved.name.endswith("-before-clear.db"))
        self.assertGreaterEqual(titles(saved), 1)


class PinLimitTests(unittest.TestCase):
    def setUp(self):
        access_gate._failures.clear()
        access_gate._all_failures.clear()

    def test_one_devices_wrong_tries_do_not_lock_another_device(self):
        for _ in range(access_gate.PER_IP_LIMIT):
            access_gate.record_failure("1.1.1.1", "phone")
        self.assertGreater(access_gate.locked_for("1.1.1.1", "phone"), 0)
        # Same address, other browser: still the address's streak, so locked.
        self.assertGreater(access_gate.locked_for("1.1.1.1", "laptop"), 0)
        # A different address and device is free to try.
        self.assertEqual(access_gate.locked_for("2.2.2.2", "tablet"), 0)

    def test_device_streak_follows_the_device_across_addresses(self):
        for _ in range(access_gate.PER_IP_LIMIT):
            access_gate.record_failure("1.1.1.1", "phone")
        self.assertGreater(access_gate.locked_for("9.9.9.9", "phone"), 0)

    def test_global_limit_is_high_enough_for_ordinary_typos(self):
        for i in range(10):
            access_gate.record_failure(f"10.0.0.{i}", f"dev{i}")
        self.assertEqual(access_gate.locked_for("8.8.8.8", "mine"), 0)
        for i in range(10, access_gate.GLOBAL_LIMIT):
            access_gate.record_failure(f"10.0.0.{i}", f"dev{i}")
        self.assertGreater(access_gate.locked_for("8.8.8.8", "mine"), 0)


class PasswordEveryVisitTests(unittest.TestCase):
    def setUp(self):
        access_gate._failures.clear()
        access_gate._all_failures.clear()
        stored = access_gate.hash_password("1234", iterations=1000)
        for name, value in (("enabled", True), ("PASSWORD_HASH", stored)):
            patcher = mock.patch.object(access_gate, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.browser = TestClient(db_server.app, follow_redirects=False)

    def log_in(self):
        resp = self.browser.post("/login", data={"password": "1234", "next": "/"})
        self.assertEqual(resp.status_code, 303)
        return resp

    def test_each_page_load_needs_the_password(self):
        self.assertEqual(self.browser.get("/").status_code, 303)
        self.log_in()
        self.assertNotEqual(self.browser.get("/").status_code, 303)
        # A reload, or a second tab, goes back to the login page.
        reload = self.browser.get("/")
        self.assertEqual(reload.status_code, 303)
        self.assertTrue(reload.headers["location"].startswith("/login"))

    def test_open_app_keeps_working_after_the_page_loaded(self):
        self.log_in()
        self.browser.get("/")
        self.assertEqual(self.browser.get("/api/sync/all").status_code, 200)
        # Scripts and images of the open page are not page loads.
        self.assertNotEqual(self.browser.get("/assets/app.js", headers={"Sec-Fetch-Dest": "script"}).status_code, 303)
        self.assertEqual(self.browser.get("/notes", headers={"Sec-Fetch-Dest": "document"}).status_code, 303)

    def test_a_ticket_works_once_even_if_copied(self):
        ticket = self.log_in().cookies[access_gate.OPEN_COOKIE]
        self.assertTrue(access_gate.spend_open_ticket(ticket))
        self.assertFalse(access_gate.spend_open_ticket(ticket))
        self.assertFalse(access_gate.spend_open_ticket(ticket[:-1] + "0"))

    def test_notes_unlock_checks_the_password(self):
        self.log_in()
        self.assertEqual(self.browser.post("/api/unlock", json={"password": "0000"}).status_code, 401)
        self.assertEqual(self.browser.post("/api/unlock", json={"password": "1234"}).status_code, 200)
        self.assertEqual(TestClient(db_server.app).post("/api/unlock", json={"password": "1234"}).status_code, 401)


class TimeZoneTests(unittest.TestCase):
    def setUp(self):
        notifier.init_tables()
        conn = sqlite3.connect(notifier.DB_PATH)
        conn.execute("DELETE FROM metadata WHERE key = 'notifyPrefs'")
        conn.commit()
        conn.close()
        self.sub = {"endpoint": "https://push.example/z", "keys": {"p256dh": "k", "auth": "a"}}

    def subscribe(self, tz):
        resp = client.post("/api/notifications/subscribe", json={"subscription": self.sub, "label": "Device", "timezone": tz})
        resp.raise_for_status()
        return resp.json()["prefs"]["timezone"]

    def test_first_device_sets_the_zone_and_later_devices_do_not_move_it(self):
        self.assertEqual(self.subscribe("Asia/Kolkata"), "Asia/Kolkata")
        self.assertEqual(self.subscribe("UTC"), "Asia/Kolkata")

    def test_choosing_a_zone_in_settings_sticks(self):
        self.subscribe("Asia/Kolkata")
        notifier.save_prefs({"timezone": "Europe/London"})
        self.assertEqual(self.subscribe("Asia/Kolkata"), "Europe/London")

    def test_installs_from_before_keep_the_zone_they_had(self):
        conn = sqlite3.connect(notifier.DB_PATH)
        conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('notifyPrefs', '{\"timezone\": \"Asia/Kolkata\"}')")
        conn.commit()
        conn.close()
        self.assertEqual(self.subscribe("UTC"), "Asia/Kolkata")


class SheetBackupTests(unittest.TestCase):
    def test_backup_sends_the_auth_key_and_tolerates_rejected_changes(self):
        import asyncio
        conn = sqlite3.connect(db_server.DB_PATH)
        conn.execute("DELETE FROM unsynced_batches")
        conn.execute("INSERT INTO unsynced_batches (payload) VALUES ('{\"action\": \"processOperations\", \"operations\": []}')")
        conn.commit()
        conn.close()
        seen = {}

        class FakeResponse:
            status_code = 200
            text = ""
            def json(self):
                return {"success": True, "results": [{"operationId": "x", "status": "rejected", "reason": "bad table"}]}

        class FakeClient:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, url, params=None, **k):
                seen["params"] = params
                return FakeResponse()

        async def one_pass():
            # Stop after one loop iteration.
            real_sleep = asyncio.sleep
            async def stop(_):
                raise asyncio.CancelledError
            with mock.patch.object(db_server, "GAS_AUTH_KEY", "secret-key"), \
                 mock.patch.object(db_server.httpx, "AsyncClient", FakeClient), \
                 mock.patch.object(db_server.asyncio, "sleep", stop):
                try:
                    await db_server.google_sheets_backup_worker()
                except asyncio.CancelledError:
                    pass

        with mock.patch("builtins.print") as printed:
            asyncio.run(one_pass())
        self.assertEqual(seen["params"], {"authKey": "secret-key"})
        self.assertTrue(any("rejected" in str(c) for c in printed.call_args_list))


if __name__ == "__main__":
    unittest.main()
