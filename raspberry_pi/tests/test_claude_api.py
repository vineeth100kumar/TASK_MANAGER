"""Tests for claude_api.py: Claude's token reaches the data and nothing else,
its changes go through sync like any device's, and the MCP endpoint works.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

TOKEN = "c" * 40
SECRET = "s" * 40
client = claude_api = db_server = None
CLAUDE = {"Authorization": f"Bearer {TOKEN}"}
OWNER = {"Authorization": f"Bearer {SECRET}"}


class ClaudeApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Imported here, not at load time: the other test files point the
        # database and notifier at their own files before importing them,
        # and the first import wins.
        global client, claude_api, db_server
        if "db_server" not in sys.modules:
            os.environ["SAGE_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "claude.db")
            os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
        import claude_api as _claude_api
        import db_server as _db_server
        claude_api, db_server = _claude_api, _db_server
        client = TestClient(db_server.app)

    def setUp(self):
        patches = [
            mock.patch.object(claude_api, "TOKEN", TOKEN),
            mock.patch.object(claude_api, "enabled", True),
            mock.patch.object(db_server, "API_SECRET", SECRET),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        clear = lambda: client.post("/api/sync/clear", content='{"confirm": "DELETE"}', headers=OWNER)
        clear()
        # Other test files share this database, so leave it empty.
        self.addCleanup(clear)

    def test_token_reaches_data_but_not_settings(self):
        self.assertEqual(client.get("/api/claude/overview", headers=CLAUDE).status_code, 200)
        self.assertEqual(client.get("/api/sync/all", headers=CLAUDE).status_code, 200)
        for method, path in [("get", "/api/settings/groq-key"), ("post", "/api/sync/clear"),
                             ("get", "/api/bluetooth"), ("post", "/api/backup/run"), ("get", "/api/phone")]:
            self.assertEqual(getattr(client, method)(path, headers=CLAUDE).status_code, 401, path)

    def test_claude_routes_need_claude_token(self):
        self.assertEqual(client.get("/api/claude/overview").status_code, 401)
        # The owner's key is for the app, not for Claude's routes.
        self.assertEqual(client.get("/api/claude/overview", headers=OWNER).status_code, 401)
        self.assertEqual(client.get("/api/claude/overview", headers={"Authorization": "Bearer " + "x" * 40}).status_code, 401)

    def test_off_without_token(self):
        with mock.patch.object(claude_api, "enabled", False):
            self.assertEqual(client.get("/api/claude/overview", headers=CLAUDE).status_code, 401)
            self.assertEqual(client.get("/api/sync/all", headers=CLAUDE).status_code, 401)
            self.assertEqual(client.post(f"/mcp/{TOKEN}", json={"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code, 404)

    def test_create_update_delete_sync_to_devices(self):
        seen = client.get("/api/sync/changes", params={"sinceRevision": 10**9}, headers=OWNER).json()["serverRevision"]
        made = client.post("/api/claude/workItems", json={"title": "Plan trip", "dueDate": "2026-10-11"}, headers=CLAUDE).json()
        self.assertTrue(made["success"])
        item = made["record"]
        self.assertEqual((item["status"], item["entityType"], item["isInbox"]), ("todo", "task", False))

        changes = client.get("/api/sync/changes", params={"sinceRevision": seen}, headers=OWNER).json()
        self.assertEqual([r["title"] for r in changes["changes"]["workItems"]], ["Plan trip"])

        done = client.patch(f"/api/claude/workItems/{item['id']}", json={"status": "done"}, headers=CLAUDE).json()["record"]
        self.assertEqual(done["status"], "done")
        self.assertTrue(done["completedAt"])
        self.assertEqual(done["title"], "Plan trip")

        self.assertEqual(client.delete(f"/api/claude/workItems/{item['id']}", headers=CLAUDE).status_code, 200)
        self.assertEqual(client.get(f"/api/claude/workItems/{item['id']}", headers=CLAUDE).status_code, 404)
        everything = client.get("/api/sync/all", headers=OWNER).json()
        self.assertIn(item["id"], everything["deleted"]["workItems"])

        ops = [c["operation"] for c in client.get("/api/claude/history", headers=CLAUDE).json()["changes"]]
        self.assertEqual(sorted(ops), ["delete", "patch", "save"])

    def test_list_filters_and_shortens(self):
        client.post("/api/claude/workItems", json={"title": "Buy milk", "status": "todo"}, headers=CLAUDE)
        client.post("/api/claude/workItems", json={"title": "Old thing", "status": "done"}, headers=CLAUDE)
        client.post("/api/claude/notes", json={"title": "Long", "content": "x" * 5000}, headers=CLAUDE)
        listed = client.get("/api/claude/workItems", params={"status": "todo"}, headers=CLAUDE).json()
        self.assertEqual([r["title"] for r in listed["records"]], ["Buy milk"])
        self.assertEqual(client.get("/api/claude/workItems", params={"q": "milk"}, headers=CLAUDE).json()["total"], 1)
        note = client.get("/api/claude/notes", headers=CLAUDE).json()["records"][0]
        self.assertLess(len(note["content"]), 400)
        full = client.get(f"/api/claude/notes/{note['id']}", headers=CLAUDE).json()["record"]
        self.assertEqual(len(full["content"]), 5000)
        self.assertTrue(full["bodyHtml"].startswith("<div>xxx"))

    def test_bad_requests(self):
        self.assertEqual(client.get("/api/claude/secrets", headers=CLAUDE).status_code, 404)
        self.assertEqual(client.post("/api/claude/workItems", json={"status": "todo"}, headers=CLAUDE).status_code, 400)
        self.assertEqual(client.patch("/api/claude/workItems/nope", json={"title": "x"}, headers=CLAUDE).status_code, 404)

    def test_web_app_files_open_with_token_behind_password_gate(self):
        with mock.patch.object(db_server.access_gate, "enabled", True):
            self.assertEqual(client.get("/api/sync/all", headers=CLAUDE).status_code, 200)
            self.assertEqual(client.get("/api/claude/overview", headers=CLAUDE).status_code, 200)
            self.assertEqual(client.get("/api/sync/all").status_code, 401)
            self.assertEqual(client.get("/api/settings/groq-key", headers=CLAUDE).status_code, 401)
            self.assertEqual(client.get("/", headers=CLAUDE, follow_redirects=False).status_code != 303, True)

    def test_mcp(self):
        def rpc(method, params=None, msg_id=1, token=TOKEN):
            return client.post(f"/mcp/{token}", json={"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params or {}})

        init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}).json()
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.assertEqual(client.post(f"/mcp/{TOKEN}", json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code, 202)
        names = {t["name"] for t in rpc("tools/list").json()["result"]["tools"]}
        self.assertIn("sage_create", names)

        made = rpc("tools/call", {"name": "sage_create", "arguments": {"table": "workItems", "fields": {"title": "From MCP"}}}).json()
        self.assertFalse(made["result"]["isError"])
        listed = rpc("tools/call", {"name": "sage_list", "arguments": {"table": "workItems", "q": "From MCP"}}).json()
        self.assertIn("From MCP", listed["result"]["content"][0]["text"])
        bad = rpc("tools/call", {"name": "sage_get", "arguments": {"table": "workItems", "id": "missing"}}).json()
        self.assertTrue(bad["result"]["isError"])

        self.assertEqual(rpc("ping", token="w" * 40).status_code, 404)
        self.assertEqual(client.get(f"/mcp/{TOKEN}").status_code, 405)


if __name__ == "__main__":
    unittest.main()
