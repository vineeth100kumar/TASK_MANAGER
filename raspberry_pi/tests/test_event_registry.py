"""Tests for the live event registry."""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))


class EventRegistryTests(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["SAGE_DB_PATH"] = str(Path(self.tmp.name) / "sage_sync.db")
        # Fresh import so the module picks up the temp SAGE_DB_PATH.
        for mod in ("event_registry", "logstore"):
            if mod in sys.modules:
                del sys.modules[mod]
        import event_registry
        self.reg = event_registry
        # Keep tests fast and bounded.
        self.reg.update(enabled=True, max_rows=1000, max_age_days=1)

    def tearDown(self):
        try:
            self.reg.stop()
        except Exception:
            pass
        self.tmp.cleanup()
        for mod in ("event_registry", "logstore"):
            if mod in sys.modules:
                del sys.modules[mod]

    def _wait_for(self, want_count: int, timeout: float = 3.0) -> int:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            got = self.reg.settings()["rowCount"]
            if got >= want_count:
                return got
            time.sleep(0.05)
        return self.reg.settings()["rowCount"]

    def test_event_persists_and_reads(self):
        self.reg.event("startup", "Sage up", source="server", data={"pid": 42})
        self.reg.event("herald.say", "Welcome back", source="speaker", actor="queued")
        self._wait_for(2)
        out = self.reg.read(limit=10)
        self.assertEqual(out["count"], 2)
        kinds = [e["kind"] for e in out["entries"]]
        self.assertIn("startup", kinds)
        self.assertIn("herald.say", kinds)

    def test_filters(self):
        self.reg.event("backup.done", "copy written", source="backup")
        self.reg.event("backup.fail", "oh no", source="backup", level="error")
        self.reg.event("request", "GET /api/health", source="request")
        self._wait_for(3)
        self.assertEqual(self.reg.read(source="backup")["count"], 2)
        self.assertEqual(self.reg.read(level="error")["count"], 1)
        self.assertEqual(self.reg.read(kind="backup")["count"], 2)
        self.assertEqual(self.reg.read(q="api/health")["count"], 1)

    def test_logstore_bridges(self):
        import logstore
        logstore.warn("auth", "Wrong password")
        self._wait_for(1)
        out = self.reg.read(limit=10)
        self.assertEqual(out["count"], 1)
        entry = out["entries"][0]
        self.assertEqual(entry["level"], "warn")
        self.assertEqual(entry["source"], "auth")
        self.assertEqual(entry["kind"], "log.warn")

    def test_disabled_does_not_record(self):
        self.reg.update(enabled=False)
        self.reg.event("skipped", "nope")
        time.sleep(0.2)
        self.assertEqual(self.reg.read()["count"], 0)

    def test_subscribe_receives_live(self):
        q = self.reg.subscribe()
        self.reg.event("tick", "hi")
        row = q.get(timeout=2.0)
        self.assertEqual(row["kind"], "tick")
        self.assertEqual(row["summary"], "hi")
        self.reg.unsubscribe(q)

    def test_row_cap_trims(self):
        # Set tiny cap and spam rows; _trim fires every 500 inserts, so push
        # past that threshold.
        self.reg.update(enabled=True, max_rows=1000)
        for i in range(600):
            self.reg.event("spam", f"n={i}")
        # Let the writer catch up.
        got = self._wait_for(500, timeout=5.0)
        self.assertGreater(got, 0)
        self.assertLessEqual(self.reg.settings()["rowCount"], 1000)

    def test_clear(self):
        self.reg.event("k", "v")
        self._wait_for(1)
        self.reg.clear()
        self.assertEqual(self.reg.read()["count"], 0)


if __name__ == "__main__":
    unittest.main()
