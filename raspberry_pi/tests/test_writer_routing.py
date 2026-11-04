"""The hot writes (sync batches, item done/snooze/tomorrow, the backup queue)
go through the single database writer thread, not inline on the event loop."""

import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "routing.db")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import db_writer  # noqa: E402

client = TestClient(db_server.app)


def save_op(item_id, payload=None):
    return {
        "operationId": str(uuid.uuid4()), "clientId": "test", "entityType": "workItems",
        "entityId": item_id, "operation": "save", "revision": 1, "payload": payload or {"id": item_id, "title": "x"},
    }


def send(*ops):
    resp = client.post("/api/sync/operations", json={"action": "processOperations", "operations": list(ops)})
    assert resp.status_code == 200, resp.text
    return resp.json()


def payload(item_id):
    conn = sqlite3.connect(db_server.DB_PATH)
    try:
        row = conn.execute("SELECT payload FROM entities WHERE table_name='workItems' AND entity_id=?", (item_id,)).fetchone()
        return json.loads(row[0])
    finally:
        conn.close()


class Spy:
    """Records which threads run write functions on the writer."""
    def __init__(self):
        self.threads = []

    def __enter__(self):
        writer = db_writer.get(db_server.DB_PATH)
        self.orig = writer.submit

        def submit(fn):
            def run(conn):
                self.threads.append(threading.current_thread().name)
                return fn(conn)
            return self.orig(run)

        self.patch = mock.patch.object(writer, "submit", submit)
        self.patch.start()
        return self

    def __exit__(self, *a):
        self.patch.stop()


class WriterRoutingTests(unittest.TestCase):
    def test_sync_batch_is_written_on_the_writer_thread(self):
        with Spy() as spy:
            body = send(save_op("route-1"))
        self.assertEqual(body["results"][0]["status"], "applied")
        self.assertEqual(spy.threads, ["sage-db-writer"])
        self.assertEqual(payload("route-1")["title"], "x")

    def test_retried_batch_is_still_idempotent(self):
        op = save_op("route-2")
        first = send(op)
        again = send(op)
        self.assertEqual(again["results"][0].get("idempotent"), True)
        self.assertEqual(first["serverRevision"], again["serverRevision"])

    def test_done_snooze_tomorrow_use_the_writer(self):
        send(save_op("route-3", {"id": "route-3", "title": "t", "status": "todo"}))
        with Spy() as spy:
            self.assertEqual(client.post("/api/items/route-3/snooze", json={}).status_code, 200)
            self.assertEqual(client.post("/api/items/route-3/tomorrow", json={}).status_code, 200)
            self.assertEqual(client.post("/api/items/route-3/done", json={}).status_code, 200)
        self.assertEqual(spy.threads, ["sage-db-writer"] * 3)
        item = payload("route-3")
        self.assertEqual(item["status"], "done")
        self.assertEqual(item["snoozeCount"], 1)

    def test_missing_item_is_404(self):
        self.assertEqual(client.post("/api/items/nope/done", json={}).status_code, 404)

    def test_backup_queue_delete_uses_the_writer(self):
        send(save_op("route-4"))

        def queued():
            conn = sqlite3.connect(db_server.DB_PATH)
            try:
                return conn.execute("SELECT COUNT(*) FROM unsynced_batches").fetchone()[0]
            finally:
                conn.close()

        self.assertGreater(queued(), 0)

        class FakeResp:
            status_code = 200
            text = "{}"
            def json(self): return {"success": True}

        class FakeClient:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, *a, **k): return FakeResp()

        async def run():
            with mock.patch.object(db_server.httpx, "AsyncClient", FakeClient):
                task = asyncio.create_task(db_server.google_sheets_backup_worker())
                for _ in range(100):
                    await asyncio.sleep(0.05)
                    if queued() == 0:
                        break
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        with Spy() as spy:
            asyncio.run(run())
        self.assertEqual(queued(), 0)
        self.assertTrue(spy.threads and set(spy.threads) == {"sage-db-writer"})


if __name__ == "__main__":
    unittest.main()
