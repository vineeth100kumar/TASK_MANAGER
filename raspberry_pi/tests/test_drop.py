"""Tests for Drop's temporary share links (drop.py).

    cd raspberry_pi && python -m unittest discover -s tests
"""

import io
import os
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "drop.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import access_gate  # noqa: E402
import db_server  # noqa: E402
import drop  # noqa: E402

client = TestClient(db_server.app, follow_redirects=False)


def zipped(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return buf.getvalue()


def upload(files, hours=None, name=None, paths=None, c=client):
    data = {}
    if hours is not None:
        data["hours"] = str(hours)
    if name:
        data["name"] = name
    if paths:
        data["paths"] = paths
    return c.post("/api/drops", files=[("files", (n, b)) for n, b in files], data=data)


class DropTests(unittest.TestCase):
    def setUp(self):
        for d in drop.list_drops():
            drop.remove(d["id"])
        patcher = mock.patch.object(drop, "base_url", lambda: {"url": None, "kind": None})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_single_html_file_is_served_at_its_link(self):
        res = upload([("report.html", b"<h1>Hello</h1>")])
        self.assertEqual(res.status_code, 200, res.text)
        d = res.json()["drop"]
        self.assertEqual(d["name"], "report.html")
        self.assertGreaterEqual(len(d["id"]), 20)
        page = client.get(d["path"])
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"Hello", page.content)
        self.assertIn("sandbox", page.headers["content-security-policy"])
        self.assertNotIn("allow-same-origin", page.headers["content-security-policy"])
        self.assertEqual(page.headers["x-content-type-options"], "nosniff")
        self.assertEqual(page.headers["cache-control"], "no-store")
        # Without the slash, relative links would break.
        self.assertEqual(client.get(d["path"].rstrip("/")).status_code, 301)

    def test_a_zip_site_loses_its_top_folder(self):
        blob = zipped({"site/index.html": "<link href=css/a.css>", "site/css/a.css": "body{}", "__MACOSX/._x": "junk"})
        d = upload([("site.zip", blob)]).json()["drop"]
        self.assertEqual(d["entry"], "index.html")
        self.assertEqual(d["files"], 2)
        self.assertEqual(d["name"], "site")
        css = client.get(d["path"] + "css/a.css")
        self.assertEqual(css.status_code, 200)
        self.assertTrue(css.headers["content-type"].startswith("text/css"))

    def test_a_folder_keeps_its_relative_paths(self):
        res = upload([("index.html", b"<img src=img/x.png>"), ("x.png", b"\x89PNG")],
                     paths=["demo/index.html", "demo/img/x.png"])
        d = res.json()["drop"]
        self.assertEqual(d["name"], "demo")
        self.assertEqual(client.get(d["path"] + "img/x.png").status_code, 200)

    def test_page_in_a_subfolder_is_opened_from_its_folder(self):
        d = upload([("s.zip", zipped({"a/report/page.html": "x", "a/notes.txt": "y"}))]).json()["drop"]
        res = client.get(d["path"])
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res.headers["location"].endswith("/report/page.html"))

    def test_no_page_shows_a_list_of_files(self):
        d = upload([("s.zip", zipped({"a.png": "1", "b.txt": "2"}))]).json()["drop"]
        res = client.get(d["path"])
        self.assertIn(b"b.txt", res.content)

    def test_traversal_is_refused(self):
        res = upload([("evil.zip", zipped({"../../etc/x.html": "boom"}))])
        self.assertEqual(res.status_code, 400)
        res = upload([("x.html", b"x")], paths=["..\\..\\x.html"])
        self.assertEqual(res.status_code, 400)
        self.assertIsNone(drop.clean_path("C:/Windows/x"))
        d = upload([("index.html", b"x")]).json()["drop"]
        follow = TestClient(db_server.app)
        for bad in ("../drop.db", "..%2F..%2Fdrop.db", "%2e%2e/%2e%2e/drop.db", "..%5C..%5Cdrop.db"):
            res = follow.get(d["path"] + bad)
            self.assertEqual(res.status_code, 404, bad)
            self.assertNotIn(b"SQLite", res.content)

    def test_nothing_runs_on_the_server(self):
        d = upload([("s.zip", zipped({"index.html": "x", "run.py": "print(1)", "a.php": "<?php ?>"}))]).json()["drop"]
        res = client.get(d["path"] + "run.py")
        self.assertEqual(res.content, b"print(1)")

    def test_size_and_count_limits(self):
        with mock.patch.object(drop, "MAX_BYTES", 100), mock.patch.object(drop, "MAX_MB", 0):
            self.assertEqual(upload([("big.html", b"x" * 200)]).status_code, 400)
            # A zip that unpacks past the limit is stopped while unpacking.
            self.assertEqual(upload([("bomb.zip", zipped({"a.html": "x" * 5000}))]).status_code, 400)
        with mock.patch.object(drop, "MAX_ACTIVE", 1):
            self.assertEqual(upload([("a.html", b"1")]).status_code, 200)
            self.assertEqual(upload([("b.html", b"2")]).status_code, 400)

    def test_expired_drops_are_refused_and_swept(self):
        d = upload([("a.html", b"1")], hours=1).json()["drop"]
        folder = drop.DROP_DIR / d["id"]
        self.assertTrue(folder.is_dir())
        with mock.patch.object(drop.time, "time", lambda: d["expiresAt"] + 1):
            self.assertEqual(client.get(d["path"]).status_code, 410)
        self.assertFalse(folder.exists())
        d2 = upload([("b.html", b"2")], hours=1).json()["drop"]
        self.assertEqual(drop.sweep(now=d2["expiresAt"] + 1), 1)
        self.assertEqual(client.get(d2["path"]).status_code, 404)

    def test_delete_extend_and_views(self):
        d = upload([("a.html", b"1")], hours=1).json()["drop"]
        client.get(d["path"], headers={"Sec-Fetch-Dest": "document"})
        client.get(d["path"], headers={"Sec-Fetch-Dest": "iframe"})
        listed = client.get("/api/drops").json()["drops"]
        self.assertEqual(listed[0]["views"], 1)
        longer = client.post(f"/api/drops/{d['id']}/extend", json={"hours": 168}).json()["drop"]
        self.assertGreater(longer["expiresAt"], d["expiresAt"] + 100 * 3600)
        self.assertEqual(client.delete(f"/api/drops/{d['id']}").status_code, 200)
        self.assertEqual(client.get(d["path"]).status_code, 404)

    def test_links_are_public_but_the_rest_still_needs_the_password(self):
        d = upload([("a.html", b"hi")]).json()["drop"]
        stored = access_gate.hash_password("1234", iterations=1000)
        with mock.patch.object(access_gate, "enabled", True), mock.patch.object(access_gate, "PASSWORD_HASH", stored), \
                mock.patch.object(db_server, "API_SECRET", "k"):
            stranger = TestClient(db_server.app, follow_redirects=False)
            self.assertEqual(stranger.get(d["path"], headers={"Sec-Fetch-Dest": "document"}).status_code, 200)
            self.assertEqual(stranger.get("/api/drops").status_code, 401)
            self.assertEqual(upload([("b.html", b"x")], c=stranger).status_code, 401)
            self.assertEqual(stranger.delete(f"/api/drops/{d['id']}").status_code, 401)
            self.assertEqual(stranger.get("/", headers={"Sec-Fetch-Dest": "document"}).status_code, 303)


if __name__ == "__main__":
    unittest.main()
