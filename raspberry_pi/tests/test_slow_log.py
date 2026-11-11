"""Request ids and the slow-request log: every watched request gets an
X-Request-Id, and one slower than SAGE_SLOW_MS shows up in /api/logs/slow."""

import asyncio
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "slow.db")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import logstore  # noqa: E402


@db_server.app.get("/api/test-pause")
async def _pause(ms: int = 0):
    await asyncio.sleep(ms / 1000)
    return {"ok": True}


client = TestClient(db_server.app)


class SlowLogTests(unittest.TestCase):
    def setUp(self):
        logstore.clear()

    def test_every_watched_request_gets_an_id_header(self):
        a = client.get("/api/test-pause")
        b = client.get("/api/test-pause")
        self.assertRegex(a.headers["x-request-id"], r"^[0-9a-f]{8}$")
        self.assertNotEqual(a.headers["x-request-id"], b.headers["x-request-id"])

    def test_the_id_is_in_the_log_line(self):
        rid = client.get("/api/test-pause").headers["x-request-id"]
        lines = [e["msg"] for e in logstore.read(source="request")["entries"]]
        self.assertTrue(any(rid in m and "/api/test-pause" in m for m in lines), lines)

    def test_a_slow_request_is_listed_with_its_id(self):
        with mock.patch.object(db_server, "SLOW_MS", 20):
            rid = client.get("/api/test-pause?ms=60").headers["x-request-id"]
        body = client.get("/api/logs/slow").json()
        self.assertTrue(body["success"])
        self.assertEqual(body["count"], 1)
        entry = body["entries"][0]
        self.assertEqual(entry["source"], "slow")
        self.assertEqual(entry["level"], "warn")
        self.assertIn(rid, entry["msg"])
        self.assertRegex(entry["msg"], r"took \d+ms")

    def test_a_fast_request_is_not_listed(self):
        with mock.patch.object(db_server, "SLOW_MS", 5000):
            client.get("/api/test-pause")
        self.assertEqual(client.get("/api/logs/slow").json()["count"], 0)

    def test_slow_endpoint_reports_the_limit_and_respects_limit(self):
        with mock.patch.object(db_server, "SLOW_MS", 10):
            for _ in range(3):
                client.get("/api/test-pause?ms=30")
        body = client.get("/api/logs/slow?limit=2").json()
        self.assertEqual(body["count"], 2)
        self.assertIn("slowMs", body)

    def test_health_ping_is_not_logged_as_slow(self):
        with mock.patch.object(db_server, "SLOW_MS", 1):
            client.get("/api/health")
        self.assertEqual(client.get("/api/logs/slow").json()["count"], 0)


if __name__ == "__main__":
    unittest.main()
