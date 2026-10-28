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

    def test_root_absolute_references_are_pointed_at_the_drop(self):
        site = {
            "dist/index.html": '<link rel="icon" href="/favicon.png"><script type="module" src="/assets/app.js"></script>'
                               '<a href="/">home</a><a href="/api/drops">api</a><script src="//cdn.example.com/x.js"></script>',
            "dist/assets/app.js": 'const a="/images/cat.webp",b=`/images/dog.webp`,c="/api/sync/all",d="/images/missing.webp",'
                                  'e=n=>`/images/${n}.webp`,f=n=>"/images/"+n,g=`/api/${n}`;',
            "dist/assets/app.css": "body{background:url(/images/cat.webp)} .x{background:url('/images/dog.webp')}",
            "dist/favicon.png": "png", "dist/images/cat.webp": "c", "dist/images/dog.webp": "d",
        }
        d = upload([("site.zip", zipped(site))]).json()["drop"]
        page = client.get(d["path"]).text
        self.assertIn(f'href="{d["path"]}favicon.png"', page)
        self.assertIn(f'src="{d["path"]}assets/app.js"', page)
        self.assertIn(f'<a href="{d["path"]}">home</a>', page)
        # Not files of this drop: left alone, so they never reach into it or out of it.
        self.assertIn('href="/api/drops"', page)
        self.assertIn('src="//cdn.example.com/x.js"', page)
        js = client.get(d["path"] + "assets/app.js").text
        self.assertIn(f'"{d["path"]}images/cat.webp"', js)
        self.assertIn(f"`{d['path']}images/dog.webp`", js)
        self.assertIn('"/api/sync/all"', js)
        self.assertIn('"/images/missing.webp"', js)
        # Names built in code: the folder is what counts.
        self.assertIn("`" + d["path"] + "images/${n}.webp`", js)
        self.assertIn('"' + d["path"] + 'images/"+n', js)
        self.assertIn("`/api/${n}`", js)
        css = client.get(d["path"] + "assets/app.css").text
        self.assertIn(f"url({d['path']}images/cat.webp)", css)
        self.assertIn(f"url('{d['path']}images/dog.webp')", css)
        # Images and other files are sent untouched.
        self.assertEqual(client.get(d["path"] + "images/cat.webp").content, b"c")

    def test_a_projects_source_gets_a_warning(self):
        src = {"p/index.html": '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
               "p/src/main.tsx": "import x from 'y'", "p/package.json": "{}"}
        res = upload([("p.zip", zipped(src))]).json()
        self.assertEqual(len(res["warnings"]), 1)
        self.assertIn("npm run build", res["warnings"][0])
        # Whoever opens it sees why, not a white page.
        page = client.get(res["drop"]["path"])
        self.assertEqual(page.status_code, 200)
        self.assertIn("not a built site", page.text)
        self.assertIn("npm run build", page.text)
        ok = upload([("ok.html", b"<h1>hi</h1><script src=app.js></script>")]).json()
        self.assertEqual(ok["warnings"], [])
        self.assertNotIn("warnings", client.get("/api/drops").json()["drops"][0])

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


    # --- Clipboard: temporary text links ---

    def test_a_clip_shares_text_at_a_link_with_a_raw_copy(self):
        res = client.post("/api/drops/clip", json={"text": "hello world\nsecond line"})
        self.assertEqual(res.status_code, 200)
        d = res.json()["drop"]
        self.assertEqual(d["kind"], "clip")
        self.assertFalse(d["permanent"])
        self.assertEqual(d["name"], "hello world")
        page = client.get(d["path"], headers={"Sec-Fetch-Dest": "document"})
        self.assertEqual(page.status_code, 200)
        self.assertIn("hello world", page.text)
        self.assertIn("Copy", page.text)
        raw = client.get(d["path"] + "raw")
        self.assertEqual(raw.text, "hello world\nsecond line")
        self.assertIn("text/plain", raw.headers["content-type"])

    def test_an_empty_clip_is_refused(self):
        self.assertEqual(client.post("/api/drops/clip", json={"text": "   "}).status_code, 400)

    def test_a_clip_cannot_be_made_permanent(self):
        d = client.post("/api/drops/clip", json={"text": "x"}).json()["drop"]
        res = client.post(f"/api/drops/{d['id']}/permanent", json={"on": True})
        self.assertEqual(res.status_code, 400)
        self.assertIn("temporary", res.json()["error"])

    def test_a_clip_is_capped_at_a_week(self):
        d = client.post("/api/drops/clip", json={"text": "x", "hours": 9999}).json()["drop"]
        self.assertLessEqual(d["expiresAt"] - d["createdAt"], drop.CLIP_MAX_HOURS * 3600 + 1)

    # --- Images on a clip ---

    def clip_with_images(self, text="", images=2):
        return client.post("/api/drops/clip", json={"text": text, "images": images}).json()["drop"]

    def send_image(self, d, name, data, thumb=""):
        params = {"thumb": thumb} if thumb else {"name": name}
        return client.post(f"/api/drops/{d['id']}/images", params=params, content=data)

    def test_a_clip_can_be_just_images(self):
        d = self.clip_with_images()
        self.assertEqual(d["name"], "2 images")
        self.assertEqual(self.send_image(d, "cat.png", b"\x89PNG" + b"a" * 100).status_code, 200)
        res = self.send_image(d, "dog.jpg", b"\xff\xd8" + b"b" * 50).json()
        self.assertEqual(res["drop"]["images"], 2)
        self.assertEqual(res["drop"]["imageBytes"], 104 + 52)
        page = client.get(d["path"], headers={"Sec-Fetch-Dest": "document"})
        self.assertEqual(page.status_code, 200)
        self.assertIn("images/cat.png", page.text)
        self.assertIn("Download all (2)", page.text)
        self.assertNotIn("id=copy", page.text)
        self.assertEqual(client.get(d["path"] + "raw").status_code, 404)
        img = client.get(d["path"] + "images/cat.png")
        self.assertEqual(img.headers["content-type"], "image/png")
        self.assertIn("sandbox", img.headers["content-security-policy"])
        self.assertEqual(img.headers["cache-control"], "no-store")
        self.assertNotIn("content-disposition", img.headers)
        down = client.get(d["path"] + "images/cat.png?download=1")
        self.assertIn("attachment", down.headers["content-disposition"])

    def test_the_same_name_twice_is_kept_as_two_images(self):
        d = self.clip_with_images()
        self.send_image(d, "image.png", b"one")
        self.assertEqual(self.send_image(d, "image.png", b"two").json()["name"], "image-2.png")

    def test_images_past_the_clip_limit_are_refused_and_not_kept(self):
        d = self.clip_with_images()
        with mock.patch.object(drop, "CLIP_IMAGES_BYTES", 100):
            self.assertEqual(self.send_image(d, "a.png", b"x" * 80).status_code, 200)
            res = self.send_image(d, "b.png", b"x" * 40)
        self.assertEqual(res.status_code, 413)
        self.assertIn("MB", res.json()["error"])
        files = sorted(p.name for p in (drop.DROP_DIR / d["id"] / "images").iterdir())
        self.assertEqual(files, ["a.png"])

    def test_only_images_can_go_on_a_clip(self):
        d = self.clip_with_images()
        self.assertEqual(self.send_image(d, "page.html", b"<script>").status_code, 400)
        self.assertEqual(self.send_image(d, "../../x.png", b"x").json()["name"], "x.png")
        site = upload([("a.html", b"hi")]).json()["drop"]
        self.assertEqual(self.send_image(site, "a.png", b"x").status_code, 400)

    def test_a_thumbnail_is_shown_in_the_grid_instead_of_the_image(self):
        d = self.clip_with_images(images=1)
        self.send_image(d, "big.png", b"x" * 1000)
        self.assertEqual(self.send_image(d, "", b"thumb", thumb="nope.png").status_code, 400)
        self.assertEqual(self.send_image(d, "", b"thumb", thumb="big.png").status_code, 200)
        page = client.get(d["path"]).text
        self.assertIn("thumbs/big.png.jpg", page)
        self.assertEqual(client.get(d["path"] + "thumbs/big.png.jpg").content, b"thumb")
        # Thumbnails don't count as images.
        self.assertEqual(drop.list_drops()[0]["images"], 1)

    def test_download_all_streams_every_image_as_a_zip(self):
        d = self.clip_with_images(text="holiday")
        self.send_image(d, "a.png", b"A" * 300000)
        self.send_image(d, "b.jpg", b"B" * 10)
        res = client.get(d["path"] + "images.zip")
        self.assertEqual(res.status_code, 200)
        self.assertIn("attachment", res.headers["content-disposition"])
        z = zipfile.ZipFile(io.BytesIO(res.content))
        self.assertEqual(z.namelist(), ["a.png", "b.jpg"])
        self.assertEqual(z.read("a.png"), b"A" * 300000)

    def test_a_clip_with_images_still_needs_text_or_images(self):
        self.assertEqual(client.post("/api/drops/clip", json={"text": "", "images": 0}).status_code, 400)

    def test_expired_clips_take_their_images_with_them(self):
        d = self.clip_with_images(text="x")
        self.send_image(d, "a.png", b"x" * 10)
        self.assertGreater(drop.usage()["bytes"], 10)
        drop.sweep(now=time.time() + drop.CLIP_MAX_HOURS * 3600 + 10)
        self.assertFalse((drop.DROP_DIR / d["id"]).exists())
        self.assertEqual(self.send_image(d, "b.png", b"x").status_code, 400)

    def test_image_uploads_need_the_key(self):
        d = self.clip_with_images()
        with mock.patch.object(db_server, "API_SECRET", "s3cret"):
            res = client.post(f"/api/drops/{d['id']}/images", params={"name": "a.png"}, content=b"x")
        self.assertEqual(res.status_code, 401)


    # --- Permanent links ---

    def test_a_site_link_can_be_made_permanent_and_temporary_again(self):
        d = upload([("a.html", b"hi")]).json()["drop"]
        on = client.post(f"/api/drops/{d['id']}/permanent", json={"on": True}).json()["drop"]
        self.assertTrue(on["permanent"])
        # A permanent drop in the past is not swept away.
        conn = drop._db()
        conn.execute("UPDATE drops SET expires_at = ? WHERE id = ?", (time.time() - 10, d["id"]))
        conn.commit(); conn.close()
        self.assertEqual(drop.sweep(), 0)
        self.assertEqual(client.get(d["path"], headers={"Sec-Fetch-Dest": "document"}).status_code, 200)
        off = client.post(f"/api/drops/{d['id']}/permanent", json={"on": False}).json()["drop"]
        self.assertFalse(off["permanent"])
        self.assertGreater(off["expiresAt"], time.time())

    # --- Turning a link off and back on ---

    def test_a_link_can_be_turned_off_and_back_on(self):
        d = upload([("a.html", b"hi")]).json()["drop"]
        client.post(f"/api/drops/{d['id']}/enabled", json={"on": False})
        off = client.get(d["path"], headers={"Sec-Fetch-Dest": "document"})
        self.assertEqual(off.status_code, 403)
        self.assertIn("turned off", off.text)
        # The files are still there; turning it back on serves them again.
        client.post(f"/api/drops/{d['id']}/enabled", json={"on": True})
        self.assertEqual(client.get(d["path"], headers={"Sec-Fetch-Dest": "document"}).status_code, 200)

    def test_toggles_report_a_gone_drop(self):
        self.assertEqual(client.post("/api/drops/nope/enabled", json={"on": False}).status_code, 400)
        self.assertEqual(client.post("/api/drops/nope/permanent", json={"on": True}).status_code, 400)

    # --- Storage stats ---

    def test_drop_usage_counts_sites_clips_and_permanent(self):
        upload([("a.html", b"hi")])
        p = upload([("b.html", b"ho")]).json()["drop"]
        client.post(f"/api/drops/{p['id']}/permanent", json={"on": True})
        client.post("/api/drops/clip", json={"text": "note"})
        u = drop.usage()
        self.assertEqual(u["sites"], 2)
        self.assertEqual(u["clips"], 1)
        self.assertEqual(u["permanent"], 1)
        self.assertGreater(u["bytes"], 0)

    def test_storage_endpoint_reports_disk_and_sage_files(self):
        upload([("a.html", b"hi there")])
        s = client.get("/api/storage").json()
        self.assertTrue(s["success"])
        self.assertGreater(s["disk"]["total"], 0)
        self.assertIn("bytes", s["db"])
        self.assertIn("bytes", s["backups"])
        self.assertGreaterEqual(s["drop"]["sites"], 1)


if __name__ == "__main__":
    unittest.main()
