"""The health report Claude reads to check the Pi."""
import asyncio
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import system_health  # noqa: E402

RECENT = system_health._iso(system_health.time.time() - 3600)


def db_with(rows_sql: str) -> str:
    path = str(Path(tempfile.mkdtemp()) / "health.db")
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE radar_sources (name TEXT PRIMARY KEY, kind TEXT, ok INTEGER, items INTEGER, error TEXT, checked_at TEXT, last_ok_at TEXT);"
        "CREATE TABLE market_series (symbol TEXT PRIMARY KEY, closes TEXT, updated_at TEXT, history_at TEXT, error TEXT);" + rows_sql
    )
    conn.commit()
    conn.close()
    return path


def report(path, clock=None, backups=None, radar=True):
    return system_health.report(
        path, web_app=True, auth=True, password_gate=True, radar_enabled=radar,
        backups=lambda: backups or {"lastBackupAt": RECENT, "count": 3},
        phone=lambda: {"available": True, "connected": False, "notifications": ["private"]},
        clock=lambda: clock or {"enabled": True, "connected": True, "token": "secret", "firmware": "2.8.0"},
    )


class Report(unittest.TestCase):
    def setUp(self):
        system_health.workers.clear()

    def test_all_well_has_no_problems(self):
        data = report(db_with("INSERT INTO radar_sources VALUES ('TechCrunch', 'feed', 1, 5, '', 'x', 'x');"
                              "INSERT INTO market_series VALUES ('XLK', '[]', 'x', 'x', NULL);"))
        self.assertEqual(data["problems"], [])
        self.assertEqual(data["markets"]["withPrices"], 1)
        self.assertNotIn("token", data["clock"])
        self.assertNotIn("notifications", data["phone"])

    def test_problems_name_what_is_wrong(self):
        path = db_with("INSERT INTO radar_sources VALUES ('Yahoo markets', 'markets', 0, 0, 'Nifty 50: HTTP 429', 'x', NULL);"
                       "INSERT INTO market_series VALUES ('XLK', '[]', NULL, NULL, 'HTTP 429');")
        data = report(path, clock={"enabled": True, "connected": False}, backups={"lastBackupAt": None})
        text = "\n".join(data["problems"])
        self.assertIn("Yahoo markets is down: Nifty 50: HTTP 429", text)
        self.assertIn("1 of 1 symbols failing", text)
        self.assertIn("desk clock", text)
        self.assertIn("No nightly backup", text)
        self.assertEqual(data["radar"]["down"], ["Yahoo markets"])

    def test_missing_tables_and_broken_parts(self):
        path = str(Path(tempfile.mkdtemp()) / "empty.db")
        data = system_health.report(
            path, web_app=False, auth=False, password_gate=False, radar_enabled=False,
            backups=lambda: 1 / 0, phone=lambda: {}, clock=lambda: {"enabled": False},
        )
        self.assertEqual(data["radar"]["sources"], [])
        self.assertIn("ZeroDivisionError", data["backups"]["error"])
        self.assertIn("API_SECRET isn't set.", data["problems"])

    def test_stopped_worker_is_a_problem(self):
        async def collector():
            raise RuntimeError("boom")

        coro = collector()
        name = system_health.worker_name(coro)
        system_health.worker_started(name)
        try:
            asyncio.run(coro)
        except RuntimeError as e:
            system_health.worker_stopped(name, e)
        data = report(db_with(""))
        self.assertTrue(name.endswith("collector"))
        self.assertTrue(any("RuntimeError: boom" in p for p in data["problems"]))


if __name__ == "__main__":
    unittest.main()
