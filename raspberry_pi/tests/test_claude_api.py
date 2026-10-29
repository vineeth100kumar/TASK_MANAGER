"""Tests for claude_api.py: Claude's token reaches the data and nothing else,
its changes go through sync like any device's, and the MCP endpoint works.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import json
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

    def test_milestone_is_always_done(self):
        logged = client.post("/api/claude/workItems", json={"title": "Shipped it", "entityType": "milestone", "dueDate": "2026-01-02"}, headers=CLAUDE).json()["record"]
        self.assertEqual(logged["status"], "done")
        self.assertTrue(logged["completedAt"])
        asked_open = client.post("/api/claude/workItems", json={"title": "Seen on the clock", "entityType": "milestone", "dueDate": "2099-01-01", "status": "todo", "stage": "idea"}, headers=CLAUDE).json()["record"]
        self.assertEqual((asked_open["status"], asked_open.get("stage")), ("done", None))
        reopened = client.patch(f"/api/claude/workItems/{logged['id']}", json={"status": "todo"}, headers=CLAUDE).json()["record"]
        self.assertEqual(reopened["status"], "done")
        task = client.post("/api/claude/workItems", json={"title": "Plain task", "dueDate": "2026-01-02", "status": "todo"}, headers=CLAUDE).json()["record"]
        self.assertEqual(task["status"], "todo")

    def test_create_update_delete_sync_to_devices(self):
        seen = client.get("/api/sync/changes", params={"sinceRevision": 10**9}, headers=OWNER).json()["serverRevision"]
        made = client.post("/api/claude/workItems", json={"title": "Plan trip", "dueDate": "2026-10-11"}, headers=CLAUDE).json()
        self.assertTrue(made["success"])
        item = made["record"]
        self.assertEqual((item["status"], item["entityType"], item["isInbox"]), ("todo", "task", False))
        # The web app needs a key on every item (it crashed without one).
        self.assertTrue(item["key"].startswith("INBOX-"))  # no project named: it lands in the Inbox project

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
        self.assertEqual(sorted(ops), ["delete", "patch", "save", "save"])  # + the Inbox project made on first use

    def test_habits_projects_goals_get_the_shape_the_app_reads(self):
        # Claude once sent habits with "title": the app showed three blank rows.
        habit = client.post("/api/claude/habits", json={"title": "Walk 4,000 steps", "frequency": "daily", "projectId": "p1"}, headers=CLAUDE).json()["record"]
        self.assertEqual((habit["name"], habit["targetCount"], habit["frequency"], habit["history"], habit["streak"]),
                         ("Walk 4,000 steps", 7, "daily", [], 0))
        self.assertNotIn("title", habit)
        weekly = client.post("/api/claude/habits", json={"name": "Gym", "frequency": "3/week"}, headers=CLAUDE).json()["record"]
        self.assertEqual((weekly["targetCount"], weekly["frequency"]), (3, "3/week"))
        self.assertEqual(client.post("/api/claude/habits", json={"frequency": "daily"}, headers=CLAUDE).status_code, 400)
        renamed = client.patch(f"/api/claude/habits/{habit['id']}", json={"title": "Steps"}, headers=CLAUDE).json()["record"]
        self.assertEqual(renamed["name"], "Steps")
        self.assertNotIn("title", renamed)

    def test_new_habits_remind_by_default(self):
        habit = client.post("/api/claude/habits", json={"name": "Read"}, headers=CLAUDE).json()["record"]
        self.assertEqual((habit["remindTime"], habit["remindPush"], habit["remindEmail"]), ("20:00", True, False))
        own = client.post("/api/claude/habits", json={"name": "Run", "remindTime": "06:30"}, headers=CLAUDE).json()["record"]
        self.assertEqual(own["remindTime"], "06:30")
        off = client.post("/api/claude/habits", json={"name": "Nap", "remindTime": None}, headers=CLAUDE).json()["record"]
        self.assertIsNone(off["remindTime"])
        # Turning it off later sticks, and existing habits aren't touched by updates.
        turned_off = client.patch(f"/api/claude/habits/{habit['id']}", json={"remindTime": None}, headers=CLAUDE).json()["record"]
        self.assertIsNone(turned_off["remindTime"])
        renamed = client.patch(f"/api/claude/habits/{habit['id']}", json={"name": "Read more"}, headers=CLAUDE).json()["record"]
        self.assertIsNone(renamed["remindTime"])

        project = client.post("/api/claude/projects", json={"name": "Health & Fitness", "type": "other"}, headers=CLAUDE).json()["record"]
        self.assertEqual((project["key"], project["color"]), ("HF", "bg-indigo-500"))
        again = client.post("/api/claude/projects", json={"title": "Home Food"}, headers=CLAUDE).json()["record"]
        self.assertEqual((again["name"], again["key"]), ("Home Food", "HF2"))
        item = client.post("/api/claude/workItems", json={"title": "Walk", "projectId": project["id"]}, headers=CLAUDE).json()["record"]
        self.assertEqual(item["key"], "HF-1")

        goal = client.post("/api/claude/goals", json={"name": "Get fit", "targetDate": "2027-04-25"}, headers=CLAUDE).json()["record"]
        self.assertEqual((goal["title"], goal["progress"], goal["category"]), ("Get fit", 0, "personal"))

    def test_new_item_gets_project_key(self):
        project = client.post("/api/claude/projects", json={"name": "Keys", "key": "KEYS"}, headers=CLAUDE).json()["record"]
        first = client.post("/api/claude/workItems", json={"title": "One", "projectId": project["id"]}, headers=CLAUDE).json()["record"]
        second = client.post("/api/claude/workItems", json={"title": "Two", "projectId": project["id"]}, headers=CLAUDE).json()["record"]
        self.assertEqual((first["key"], second["key"]), ("KEYS-1", "KEYS-2"))
        kept = client.post("/api/claude/workItems", json={"title": "Mine", "key": "OWN-7"}, headers=CLAUDE).json()["record"]
        self.assertEqual(kept["key"], "OWN-7")

    def test_new_items_are_written_in_the_one_shape(self):
        # A milestone sent the way Claude logs Sage progress: no type, labels or context.
        m = client.post("/api/claude/workItems", json={"title": "Shipped", "entityType": "milestone", "status": "done"}, headers=CLAUDE).json()["record"]
        self.assertEqual((m["entityType"], m["type"], m["lifeContext"], m["labels"], m["branchId"]),
                         ("milestone", "milestone", "work", [], None))
        old_style = client.post("/api/claude/workItems", json={"title": "Call", "type": "meeting", "lifeContext": "Personal"}, headers=CLAUDE).json()["record"]
        self.assertEqual((old_style["entityType"], old_style["type"], old_style["lifeContext"]), ("event", "meeting", "personal"))

    def test_keys_skip_past_the_highest_number(self):
        project = client.post("/api/claude/projects", json={"name": "Gaps", "key": "G"}, headers=CLAUDE).json()["record"]
        client.post("/api/claude/workItems", json={"title": "Five", "key": "G-5", "projectId": project["id"]}, headers=CLAUDE)
        client.post("/api/claude/workItems", json={"title": "Keyless", "key": "", "projectId": project["id"]}, headers=CLAUDE)
        nxt = client.post("/api/claude/workItems", json={"title": "Next", "projectId": project["id"]}, headers=CLAUDE).json()["record"]
        self.assertEqual(nxt["key"], "G-7")

    def test_overview_and_status_filter_read_old_statuses(self):
        client.post("/api/claude/workItems", json={"title": "Reviewing", "status": "in_review"}, headers=CLAUDE)
        client.post("/api/claude/workItems", json={"title": "Finished", "status": "Completed"}, headers=CLAUDE)
        overview = client.get("/api/claude/overview", headers=CLAUDE).json()
        self.assertEqual(overview["openItems"], 1)
        doing = client.get("/api/claude/workItems", params={"status": "in_progress"}, headers=CLAUDE).json()
        self.assertEqual([r["title"] for r in doing["records"]], ["Reviewing"])

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

    def test_health(self):
        self.assertEqual(client.get("/api/claude/health").status_code, 401)
        data = client.get("/api/claude/health", headers=CLAUDE).json()
        self.assertTrue(data["success"])
        self.assertIsInstance(data["problems"], list)
        self.assertGreaterEqual(data["server"]["uptimeMinutes"], 0)

    def test_thought_maps(self):
        def rpc(name, args):
            reply = client.post(f"/mcp/{TOKEN}", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                       "params": {"name": name, "arguments": args}}).json()["result"]
            return reply["isError"], (reply["content"][0]["text"] if reply["isError"] else json.loads(reply["content"][0]["text"]))

        # No map yet: adding asks for create_map rather than guessing.
        err, msg = rpc("sage_thought_add", {"map": "Startup", "thoughts": [{"text": "Savings"}]})
        self.assertTrue(err)
        self.assertIn("create_map", msg)

        err, added = rpc("sage_thought_add", {"map": "Should I start a startup?", "create_map": True, "thoughts": [
            {"text": "8 months of savings", "status": "pro", "topic": "Money"},
            {"text": "Grant takes 4 to 6 months", "status": "con", "topic": "Money"},
            {"text": "Need a technical co-founder", "topic": "People"},
        ]})
        self.assertFalse(err, added)
        self.assertEqual([t["status"] for t in added["added"]], ["good", "bad", "open"])
        self.assertEqual(added["counts"], {"open": 1, "unsure": 0, "good": 1, "bad": 1})
        map_id = added["map"]["id"]
        note = client.get(f"/api/claude/notes/{map_id}", headers=CLAUDE).json()["record"]
        self.assertEqual((note["kind"], note["title"]), ("map", "Should I start a startup?"))

        # Part of the title finds it; "under" by text sets the parent and takes its topic.
        err, more = rpc("sage_thought_add", {"map": "startup", "thoughts": [
            {"text": "Arjun might join part-time", "status": "confused", "under": "need a technical co-founder"}]})
        self.assertFalse(err, more)
        child = more["added"][0]
        self.assertEqual((child["status"], child["topic"], child["source"]), ("unsure", "People", "claude"))
        self.assertEqual(child["parentId"], added["added"][2]["id"])

        err, maps = rpc("sage_maps", {})
        self.assertEqual(maps["maps"][0]["topics"], ["Money", "People"])
        self.assertEqual(maps["maps"][0]["thoughts"], 4)
        err, one = rpc("sage_map", {"map": map_id})
        self.assertEqual([t["text"] for t in one["thoughts"]][0], "8 months of savings")

        # Re-sorting goes through sage_update and the same status words.
        moved = client.patch(f"/api/claude/thoughts/{child['id']}", json={"status": "holds up"}, headers=CLAUDE).json()["record"]
        self.assertEqual(moved["status"], "good")
        self.assertEqual(client.patch(f"/api/claude/thoughts/{child['id']}", json={"status": "sideways"}, headers=CLAUDE).status_code, 400)
        err, msg = rpc("sage_thought_add", {"map": map_id, "thoughts": [{"text": "x", "under": "nothing like it"}]})
        self.assertTrue(err)

        # The app gets them through sync like any other table.
        synced = client.get("/api/sync/all", headers=CLAUDE).json()["data"]["thoughts"]
        self.assertEqual(len(synced), 4)
        self.assertEqual(client.get("/api/claude/maps", headers=CLAUDE).json()["maps"][0]["id"], map_id)

    def test_note_push(self):
        page = "<html><head><style>p{}</style></head><body><h1>Q3 &amp; plan</h1><p>Revenue up</p></body></html>"
        made = client.post("/api/claude/notes/push", json={"title": "Q3 report", "html": page, "source": "Gemini!"}, headers=CLAUDE).json()
        self.assertTrue(made["success"], made)
        self.assertFalse(made["updated"])
        note = client.get(f"/api/claude/notes/{made['note']['id']}", headers=CLAUDE).json()["record"]
        # The source is kept as sent, the preview text is the page's words.
        self.assertEqual((note["kind"], note["bodyHtml"], note["source"]), ("html", page, "gemini"))
        self.assertEqual(note["content"], "Q3 & plan Revenue up")

        # The same title replaces that note; code keeps its language and text.
        again = client.post("/api/claude/notes/push", json={"title": "Q3 report", "html": "<p>v2</p>"}, headers=CLAUDE).json()
        self.assertTrue(again["updated"])
        self.assertEqual(again["note"]["id"], made["note"]["id"])
        reply = client.post(f"/mcp/{TOKEN}", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "sage_note_push", "arguments": {"title": "Fizz", "code": "if a < b:\n    print(a)", "language": "Python"}}}).json()["result"]
        self.assertFalse(reply["isError"], reply)
        code = client.get(f"/api/claude/notes/{json.loads(reply['content'][0]['text'])['note']['id']}", headers=CLAUDE).json()["record"]
        self.assertEqual((code["kind"], code["language"], code["bodyHtml"]), ("code", "python", "if a < b:\n    print(a)"))

        # A page sent as a plain note through sage_create is shown as a report too.
        plain = client.post("/api/claude/notes", json={"title": "Pasted", "content": "<!DOCTYPE html><html><body><p>Hi</p></body></html>"}, headers=CLAUDE).json()["record"]
        self.assertEqual((plain["kind"], plain["content"]), ("html", "Hi"))

        for bad in ({"title": "x"}, {"html": "<p>"}, {"title": "x", "html": "<p>", "code": "1"}, {"title": "x", "html": "  "}):
            self.assertEqual(client.post("/api/claude/notes/push", json=bad, headers=CLAUDE).status_code, 400, bad)

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

        self.assertIn("sage_health", names)
        report = rpc("tools/call", {"name": "sage_health", "arguments": {}}).json()["result"]
        self.assertFalse(report["isError"])
        data = json.loads(report["content"][0]["text"])
        for part in ("server", "workers", "radar", "markets", "backups", "phone", "clock", "problems"):
            self.assertIn(part, data)
        self.assertNotIn("token", data["clock"])

        self.assertEqual(rpc("ping", token="w" * 40).status_code, 404)
        self.assertEqual(client.get(f"/mcp/{TOKEN}").status_code, 405)

    def test_logs_settings_and_connector(self):
        import logstore
        logstore.update(enabled=True, max_bytes=20 * 1024 * 1024)
        logstore.clear()
        logstore.info("request", "GET /api/overview -> 200 (5ms)")
        logstore.error("backup", "Backup worker error: boom")
        logstore.warn("auth", "Wrong Sage password from 1.2.3.4")

        # The settings endpoint reports the knobs, bounds and usage.
        cfg = client.get("/api/settings/logs", headers=OWNER).json()
        self.assertTrue(cfg["success"] and cfg["enabled"])
        self.assertEqual(cfg["maxBytes"], 20 * 1024 * 1024)
        self.assertIn("usedBytes", cfg)

        # The web app and the connector read the same log; filters work.
        got = client.get("/api/logs", params={"level": "warn"}, headers=OWNER).json()
        self.assertEqual(sorted(e["source"] for e in got["entries"]), ["auth", "backup"])

        def rpc(method, params=None):
            return client.post(f"/mcp/{TOKEN}", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
        names = {t["name"] for t in rpc("tools/list").json()["result"]["tools"]}
        self.assertIn("sage_logs", names)
        res = rpc("tools/call", {"name": "sage_logs", "arguments": {"source": "backup"}}).json()["result"]
        self.assertFalse(res["isError"])
        entries = json.loads(res["content"][0]["text"])["entries"]
        self.assertEqual([e["msg"] for e in entries], ["Backup worker error: boom"])

        # Turning it off stops new lines being kept.
        self.assertTrue(client.post("/api/settings/logs", json={"enabled": False}, headers=OWNER).json()["success"])
        before = client.get("/api/logs", headers=OWNER).json()["count"]
        logstore.info("request", "dropped while off")
        self.assertEqual(client.get("/api/logs", headers=OWNER).json()["count"], before)
        logstore.update(enabled=True, max_bytes=20 * 1024 * 1024)


    def test_drop_reports(self):
        import drop

        def call(name, args):
            res = client.post(f"/mcp/{TOKEN}", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                      "params": {"name": name, "arguments": args}}).json()["result"]
            return res["isError"], (json.loads(res["content"][0]["text"]) if not res["isError"] else res["content"][0]["text"])

        names = {t["name"] for t in client.post(f"/mcp/{TOKEN}", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).json()["result"]["tools"]}
        self.assertTrue({"sage_drop_publish", "sage_drop_list", "sage_drop_set", "sage_drop_delete"} <= names)

        with mock.patch.object(drop, "base_url", lambda: {"url": "https://sage.example.com", "kind": "custom"}):
            # Body HTML gets a page around it; the link is permanent and full.
            err, made = call("sage_drop_publish", {"title": "Q3 <report>", "html": "<h1>Revenue</h1>"})
            self.assertFalse(err, made)
            d = made["drop"]
            self.assertTrue(d["permanent"])
            self.assertIsNone(d["expiresAt"])
            self.assertEqual(d["url"], f"https://sage.example.com/d/{d['id']}/")
            self.assertEqual(d["source"], "claude")
            page = client.get(f"/d/{d['id']}/")
            self.assertEqual(page.status_code, 200)
            self.assertIn("<h1>Revenue</h1>", page.text)
            self.assertIn("<title>Q3 &lt;report&gt;</title>", page.text)
            self.assertIn("sandbox", page.headers["content-security-policy"])

            # Replacing keeps the link; a full page is kept as sent.
            err, again = call("sage_drop_publish", {"title": "Q3 v2", "html": "<!doctype html><p>v2</p>", "replace": d["id"]})
            self.assertFalse(err, again)
            self.assertTrue(again["replaced"])
            self.assertEqual(again["drop"]["url"], d["url"])
            self.assertEqual(client.get(f"/d/{d['id']}/").text, "<!doctype html><p>v2</p>")

            # hours makes a temporary one.
            err, temp = call("sage_drop_publish", {"title": "Today", "html": "<p>x</p>", "hours": 2})
            self.assertFalse(temp["drop"]["permanent"])
            self.assertIsNotNone(temp["drop"]["expiresAt"])

            err, listed = call("sage_drop_list", {})
            self.assertEqual({x["name"] for x in listed["drops"]} >= {"Q3 v2", "Today"}, True)

            err, off = call("sage_drop_set", {"id": d["id"], "enabled": False})
            self.assertTrue(off["drop"]["disabled"])
            self.assertEqual(client.get(f"/d/{d['id']}/").status_code, 403)

            for slug in (d["id"], temp["drop"]["id"]):
                self.assertFalse(call("sage_drop_delete", {"id": slug})[0])
            self.assertEqual(client.get(f"/d/{d['id']}/").status_code, 404)
            self.assertTrue(call("sage_drop_delete", {"id": d["id"]})[0])
            self.assertTrue(call("sage_drop_publish", {"title": "x", "html": "<p>", "replace": "nope"})[0])
            self.assertTrue(call("sage_drop_publish", {"title": "", "html": "<p>"})[0])

        # With no public address the path still comes back, with a note.
        with mock.patch.object(drop, "base_url", lambda: {}):
            err, home = call("sage_drop_publish", {"title": "Home", "html": "<p>hi</p>"})
            self.assertIsNone(home["drop"]["url"])
            self.assertIn("home network", home["note"])
            self.assertTrue(client.get("/api/claude/drops", headers=CLAUDE).json()["success"])
            self.assertTrue(client.delete(f"/api/claude/drops/{home['drop']['id']}", headers=CLAUDE).json()["success"])


class LogStoreTests(unittest.TestCase):
    def test_cap_drops_oldest_and_clamps(self):
        import tempfile as _tf
        from pathlib import Path as _P
        os.environ["SAGE_DB_PATH"] = str(_P(_tf.mkdtemp()) / "cap.db")
        import importlib, logstore
        importlib.reload(logstore)
        # The cap is clamped to a sane floor, never zero.
        self.assertGreaterEqual(logstore.update(max_bytes=1)["maxBytes"], logstore._MIN_BYTES)
        logstore.update(enabled=True, max_bytes=logstore._MIN_BYTES)
        logstore.clear()
        for i in range(10000):
            logstore.info("spam", f"line {i} " + "x" * 80)
        size = logstore._LOG_FILE.stat().st_size
        self.assertLessEqual(size, logstore._MIN_BYTES)
        # The newest line survives; the oldest is gone.
        newest = logstore.read(limit=1)["entries"][0]["msg"]
        self.assertIn("line 9999", newest)


if __name__ == "__main__":
    unittest.main()
