"""Tests for the sync endpoints in db_server.py: deletes reach other devices,
stale edits don't overwrite newer ones, and bad requests are refused cleanly.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "sync.db")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402

client = TestClient(db_server.app)


def op(entity_id, operation="save", payload=None, table="workItems", op_id=None):
    return {
        "operationId": op_id or str(uuid.uuid4()),
        "clientId": "test",
        "entityType": table,
        "entityId": entity_id,
        "operation": operation,
        "revision": 1,
        "payload": payload if payload is not None else {"id": entity_id},
    }


def send(*ops):
    resp = client.post("/api/sync/operations", json={"action": "processOperations", "operations": list(ops)})
    resp.raise_for_status()
    return resp.json()


def revision():
    return client.get("/api/sync/changes", params={"sinceRevision": 10**9}).json()["serverRevision"]


class SyncTests(unittest.TestCase):
    def setUp(self):
        client.post("/api/sync/clear")

    def test_delete_reaches_other_devices(self):
        send(op("a", payload={"id": "a", "title": "A"}), op("b", payload={"id": "b", "title": "B"}))
        seen = revision()
        send(op("a", "delete"))
        changes = client.get("/api/sync/changes", params={"sinceRevision": seen}).json()
        self.assertEqual(changes["deleted"], {"workItems": ["a"]})
        self.assertEqual(changes["changes"], {})
        everything = client.get("/api/sync/all").json()
        self.assertEqual([r["id"] for r in everything["data"]["workItems"]], ["b"])
        self.assertIn("a", everything["deleted"]["workItems"])

    def test_edit_after_delete_does_not_bring_it_back(self):
        send(op("a", payload={"id": "a", "title": "A"}))
        send(op("a", "delete"))
        result = send(op("a", "patch", {"title": "edited offline"}))["results"][0]
        self.assertEqual(result["status"], "deleted")
        self.assertNotIn("workItems", client.get("/api/sync/all").json()["data"])

    def test_older_copy_does_not_overwrite_newer(self):
        send(op("a", payload={"id": "a", "title": "new", "updatedAt": "2026-10-02T10:05:00.000Z"}))
        result = send(op("a", payload={"id": "a", "title": "old", "updatedAt": "2026-10-02T10:00:00.000Z"}))["results"][0]
        self.assertEqual(result["status"], "stale")
        self.assertEqual(result["currentRecord"]["title"], "new")
        result = send(op("a", payload={"id": "a", "title": "newer", "updatedAt": "2026-10-02T10:06:00Z"}))["results"][0]
        self.assertEqual(result["status"], "applied")

    def test_ops_apply_in_the_order_sent(self):
        send(
            op("a", payload={"id": "a", "title": "first"}),
            op("a", payload={"id": "a", "title": "second"}),
        )
        self.assertEqual(client.get("/api/sync/all").json()["data"]["workItems"][0]["title"], "second")

    def test_patch_on_missing_record_keeps_its_id(self):
        send(op("x", "patch", {"title": "no id in payload"}))
        row = client.get("/api/sync/all").json()["data"]["workItems"][0]
        self.assertEqual(row["id"], "x")

    def test_retry_is_idempotent_and_does_not_move_revision(self):
        first = op("a", payload={"id": "a"})
        send(first)
        before = revision()
        result = send(first)["results"][0]
        self.assertTrue(result.get("idempotent"))
        self.assertEqual(revision(), before)

    def test_repeated_op_id_in_one_batch(self):
        same = op("a", payload={"id": "a"})
        results = send(same, same)["results"]
        self.assertEqual([r["status"] for r in results], ["applied", "applied"])
        self.assertTrue(results[1].get("idempotent"))

    def test_unknown_table_and_operation_are_rejected(self):
        results = send(op("a", table="push_subscriptions"), op("b", "upsert"))["results"]
        self.assertEqual([r["status"] for r in results], ["rejected", "rejected"])
        self.assertEqual(client.get("/api/sync/all").json()["data"], {})

    def test_bad_request_is_400(self):
        resp = client.post("/api/sync/operations", content=b"not json")
        self.assertEqual(resp.status_code, 400)
        resp = client.post("/api/sync/operations", json={"operations": [{"entityType": "workItems"}]})
        self.assertEqual(resp.status_code, 400)

    def test_clear_keeps_revision_counting_up(self):
        send(op("a"))
        before = revision()
        client.post("/api/sync/clear")
        self.assertGreater(revision(), before)
        send(op("b"))
        changes = client.get("/api/sync/changes", params={"sinceRevision": before}).json()
        self.assertEqual([r["id"] for r in changes["changes"]["workItems"]], ["b"])


if __name__ == "__main__":
    unittest.main()
