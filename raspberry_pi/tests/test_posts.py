"""Tests for Posts (posts.py): checking a script, drawing it, the email, the task link.

    cd raspberry_pi && python -m unittest tests.test_posts

The drawing tests need a Chromium; they use AUTOCONTENT_CHROMIUM or
/opt/pw-browsers/chromium and are skipped when neither exists.
"""

import asyncio
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "posts.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import notifier  # noqa: E402
import posts  # noqa: E402

client = TestClient(db_server.app)
EXAMPLE = (Path(posts.ENGINE_DIR) / "example_script.md").read_text(encoding="utf-8")
SMALL = """---
autocontent: post
title: Tiny post
---

## cover
headline: Three things that matter
Swipe to see them.

## point
headline: One
body: The first thing.

## cta
headline: Save this
body: Follow for more.

## caption
A short caption for the tiny post.

## hashtags
#tiny #post
"""
CHROMIUM = os.environ.get("AUTOCONTENT_CHROMIUM") or ("/opt/pw-browsers/chromium" if Path("/opt/pw-browsers/chromium").exists() else "")


class FakeBox:
    """Stands in for the project and task records claude_api would hold."""

    def __init__(self):
        self.projects = {"p1": {"id": "p1", "type": "content", "name": "Mind Deeds"}, "p2": {"id": "p2", "type": "technical"}}
        self.items = {}
        self.updates = []

    def find(self, table, record_id):
        return (self.projects if table == "projects" else self.items).get(record_id)

    async def create(self, table, fields):
        record = {**fields, "id": f"t{len(self.items) + 1}"}
        self.items[record["id"]] = record
        return record

    async def update(self, table, record_id, fields):
        self.items[record_id].update(fields)
        self.updates.append(dict(fields))
        return self.items[record_id]


class CheckTests(unittest.TestCase):
    def test_good_script(self):
        r = posts.check(SMALL)
        self.assertTrue(r["ok"])
        self.assertEqual([s["type"] for s in r["slides"]], ["cover", "point", "cta"])
        self.assertEqual(r["title"], "Tiny post")
        self.assertIn("tiny post", r["caption"])

    def test_errors_carry_line_numbers(self):
        r = posts.check(SMALL + "\n## chart\nheadline: Nothing to plot\n")
        self.assertFalse(r["ok"])
        self.assertGreaterEqual(r["errors"], 1)
        self.assertTrue(any(i["severity"] == "ERROR" and i["line"] for i in r["issues"]))

    def test_check_route(self):
        res = client.post("/api/posts/check", json={"script": SMALL}).json()
        self.assertTrue(res["success"] and res["check"]["ok"])
        self.assertEqual(client.post("/api/posts/check", json={"script": "x" * (posts.MAX_SCRIPT + 1)}).status_code, 400)

    def test_example_script_is_clean(self):
        self.assertTrue(posts.check(EXAMPLE)["ok"])


class PillSplit(unittest.TestCase):
    """The cover's pill word: marks and closing punctuation must not hide it."""

    def split(self, headline, pill):
        posts._engine_on_path()
        from autocontent.render.renderer import _pill_split
        return _pill_split(headline, pill)

    def test_bold_word_then_question_mark(self):
        self.assertEqual(self.split("How can the Iran war affect your **dinner**?", "dinner"),
                         ("How can the Iran war affect your", "dinner?"))

    def test_highlight_marks_and_plain(self):
        self.assertEqual(self.split("Why ==cash== wins", "cash wins"), ("Why", "cash wins"))
        self.assertEqual(self.split("Save more, spend ==less==", "less"), ("Save more, spend", "less"))
        self.assertEqual(self.split("Your move.", "move."), ("Your", "move."))

    def test_phrase_not_at_the_end(self):
        self.assertIsNone(self.split("Dinner is served", "dinner"))
        self.assertIsNone(self.split("dinner", "dinner"))


class DatabaseMode(unittest.TestCase):
    def test_database_is_in_wal_mode(self):
        # A post saves while it draws; in the old journal mode each save blocked
        # every read and the Pi logged "database is locked".
        import sqlite3
        conn = sqlite3.connect(db_server.DB_PATH)
        try:
            self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        finally:
            conn.close()

    def test_save_async_writes_the_post(self):
        post = {"id": "abcdefabcdef", "createdAt": "2026-11-01T00:00:00Z", "status": "done", "title": "x"}
        asyncio.run(posts.save_async(post))
        self.assertEqual(posts.get("abcdefabcdef")["title"], "x")
        posts.delete("abcdefabcdef")


class StartRules(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        posts.connect(db_server.DB_PATH, None, None, None, None)

    async def test_refuses_empty_bad_and_unknown_style(self):
        with self.assertRaises(ValueError):
            posts.start("   ")
        with self.assertRaises(ValueError):
            posts.start(SMALL, style="neon")
        with self.assertRaises(ValueError):
            posts.start("hello world")

    async def test_queue_limit(self):
        with mock.patch.object(posts, "queue_length", return_value=posts.MAX_QUEUE):
            with self.assertRaises(posts.Busy):
                posts.start(SMALL)

    async def test_missing_post(self):
        self.assertIsNone(posts.get("nope"))
        self.assertIsNone(posts.get("../../etc/passwd"))
        self.assertEqual(client.get("/api/posts/abcdefabcdef").status_code, 404)
        self.assertEqual(client.get("/api/posts/abcdefabcdef/slides/1.png").status_code, 404)

    async def test_restart_marks_unfinished_posts_failed(self):
        post = {"id": "aaaaaaaaaaaa", "createdAt": posts._utc(), "status": "running", "title": "t", "slides": []}
        posts.save(post)
        posts.connect(db_server.DB_PATH, None, None, None, None)
        self.assertEqual(posts.get("aaaaaaaaaaaa")["status"], "failed")
        posts.delete("aaaaaaaaaaaa")


@unittest.skipUnless(CHROMIUM, "no Chromium to draw with")
class DrawTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.box = FakeBox()
        self.events = []

        async def broadcast(event):
            self.events.append(event)

        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        posts.connect(db_server.DB_PATH, broadcast, self.box.create, self.box.update, self.box.find)

    async def finish(self, post):
        for _ in range(240):
            await asyncio.sleep(0.5)
            post = posts.get(post["id"])
            if post["status"] in ("done", "failed"):
                # "done" is saved before the JPEG copies and the email, so wait
                # for the whole run to end; otherwise the next step races it.
                for _ in range(200):
                    if not posts._lock.locked():
                        break
                    await asyncio.sleep(0.1)
                return posts.get(post["id"])
        self.fail("the post never finished")

    async def test_draws_emails_and_moves_the_task(self):
        sent = {}

        def fake_send(prefs, subject, text, html_body, images=None):
            sent.update(subject=subject, text=text, html=html_body, images=images)

        with mock.patch.object(notifier, "email_ready", return_value=True), \
                mock.patch.object(notifier, "send_email", side_effect=fake_send), \
                mock.patch.object(notifier, "_app_link", return_value="https://sage.example"):
            post = posts.start(SMALL, project_id="p1")
            self.assertEqual(post["status"], "queued")
            post = await self.finish(post)
            # "done" is saved before the email goes, so give the email its moment.
            for _ in range(40):
                if post["emailed"] or post["emailError"]:
                    break
                await asyncio.sleep(0.25)
                post = posts.get(post["id"])
        self.assertEqual(post["status"], "done", post.get("error"))
        self.assertEqual(post["slideCount"], 3)
        self.assertEqual(post["audit"] in ("pass", "fail"), True)
        self.assertTrue(post["emailed"], post.get("emailError"))
        self.assertIn("Tiny post", sent["subject"])
        self.assertEqual(len(sent["images"]), 3)
        self.assertIn("cid:slide1", sent["html"])
        self.assertIn("https://sage.example/?post=" + post["id"], sent["html"])
        self.assertIn("A short caption", sent["text"])
        # the slides are real PNGs of the right size
        res = client.get(f"/api/posts/{post['id']}/slides/1.png")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.content.startswith(b"\x89PNG"))
        from PIL import Image
        self.assertEqual(Image.open(io.BytesIO(res.content)).size, (1080, 1350))
        # the share sheet gets JPEGs of the same size
        jpg = client.get(f"/api/posts/{post['id']}/slides/1.jpg")
        self.assertEqual(jpg.headers["content-type"], "image/jpeg")
        self.assertTrue(jpg.content.startswith(b"\xff\xd8"))
        self.assertEqual(Image.open(io.BytesIO(jpg.content)).size, (1080, 1350))
        self.assertEqual(client.get(f"/api/posts/{post['id']}/slides/99.jpg").status_code, 404)
        # the post page shows small previews, made ahead of time when drawing finished
        self.assertTrue((posts.POSTS_DIR / post["id"] / "out" / "preview" / "slide_01.jpg").is_file())
        self.assertTrue((posts.POSTS_DIR / post["id"] / "out" / "share" / "slide_01.jpg").is_file())
        prev = client.get(f"/api/posts/{post['id']}/preview/1.jpg?v=x")
        self.assertEqual(prev.headers["content-type"], "image/jpeg")
        self.assertEqual(Image.open(io.BytesIO(prev.content)).size, (540, 675))
        self.assertLess(len(prev.content), len(res.content))
        self.assertEqual(client.get(f"/api/posts/{post['id']}/preview/99.jpg").status_code, 404)
        # every file the app loads was made before "done" was said, and is served as a plain file
        out = posts.POSTS_DIR / post["id"] / "out"
        for name in ("thumb/slide_01.jpg", "preview/slide_03.jpg", "share/slide_03.jpg", "post.zip"):
            self.assertTrue((out / name).is_file(), name)
        media = client.get(f"/api/posts/{post['id']}").json()["post"]["media"]
        self.assertEqual(media["base"], f"/media/posts/{post['id']}")
        thumb = client.get(f"{media['base']}/thumb/slide_01.jpg?v={media['v']}")
        self.assertEqual(thumb.status_code, 200)
        self.assertEqual(Image.open(io.BytesIO(thumb.content)).size, (240, 300))
        self.assertIn("immutable", thumb.headers["cache-control"])
        names = zipfile.ZipFile(io.BytesIO(client.get(f"/api/posts/{post['id']}/zip").content)).namelist()
        self.assertIn("slide_01.png", names)
        self.assertIn("caption.txt", names)
        # progress was announced
        self.assertTrue(any(e["type"] == "POST_PROGRESS" and e["status"] == "done" for e in self.events))
        # the project got a task that is Ready; Mark posted finishes it
        task = next(iter(self.box.items.values()))
        self.assertEqual((task["status"], task["stage"]), ("in_progress", "editing"))
        self.assertEqual(client.post(f"/api/posts/{post['id']}/posted").json()["post"]["posted"], True)
        self.assertEqual((task["status"], task["stage"]), ("done", "published"))
        client.post(f"/api/posts/{post['id']}/posted?undo=true")
        self.assertEqual((task["status"], task["stage"]), ("in_progress", "editing"))
        self.assertEqual(client.delete(f"/api/posts/{post['id']}").json()["success"], True)
        self.assertFalse((posts.POSTS_DIR / post["id"]).exists())

    async def test_non_content_project_gets_status_only(self):
        with mock.patch.object(notifier, "email_ready", return_value=False):
            post = await self.finish(posts.start(SMALL, project_id="p2"))
        task = self.box.items[post["taskId"]]
        self.assertNotIn("stage", task)
        self.assertEqual(post["status"], "done")
        self.assertIn("isn't set up", post["emailError"])

    async def test_square_size_and_rerender(self):
        with mock.patch.object(notifier, "email_ready", return_value=False):
            post = await self.finish(posts.start(SMALL, fmt="square", style="beige_grain"))
            from PIL import Image
            self.assertEqual(Image.open(posts.slide_path(post, 1)).size, (1080, 1080))
            again = posts.restart(post, SMALL.replace("Three things", "Four things"), fmt="portrait")
            self.assertEqual(again["status"], "queued")
            again = await self.finish(again)
        self.assertEqual(Image.open(posts.slide_path(again, 1)).size, (1080, 1350))
        self.assertIn("Four things", again["script"])

    async def test_send_to_phone_route_reports_email_problems(self):
        with mock.patch.object(notifier, "email_ready", return_value=False):
            post = await self.finish(posts.start(SMALL))
        res = client.post(f"/api/posts/{post['id']}/send")
        self.assertEqual(res.status_code, 502)

    async def test_qr(self):
        with mock.patch.object(notifier, "email_ready", return_value=False):
            post = await self.finish(posts.start(SMALL))
        with mock.patch.object(notifier, "_app_link", return_value="https://sage.example"):
            res = client.get(f"/api/posts/{post['id']}/qr.svg")
        self.assertEqual(res.status_code, 200)
        self.assertIn("<svg", res.text)


class MediaFiles(unittest.TestCase):
    """/media/posts/...: finished files served like a media server."""

    def setUp(self):
        from PIL import Image
        self.id = "abcdef012345"
        out = posts.POSTS_DIR / self.id / "out"
        out.mkdir(parents=True, exist_ok=True)
        for n in (1, 2):
            Image.new("RGB", (1080, 1350), (20 * n, 90, 160)).save(out / f"slide_{n:02d}.png")
        (out / "caption.txt").write_text("Hello caption", encoding="utf-8")
        self.post = {"id": self.id, "createdAt": "2026-11-05T08:00:00Z", "finishedAt": "2026-11-05T08:01:02Z",
                     "status": "done", "title": "My Post", "slides": ["slide_01.png", "slide_02.png"], "slideCount": 2,
                     "script": "x", "log": [], "progress": {"done": 2, "total": 2}}
        posts.save(self.post)
        self.media = posts.media_info(self.post)

    def tearDown(self):
        posts.delete(self.id)

    def url(self, kind, name, extra=""):
        return f"{self.media['base']}/{kind}/{name}?v={self.media['v']}{extra}"

    def test_list_and_post_carry_the_media_address(self):
        row = next(p for p in client.get("/api/posts").json()["posts"] if p["id"] == self.id)
        self.assertEqual(row["media"], self.media)
        self.assertEqual(self.media["v"], "20261105080102")
        self.assertIsNone(posts.media_info({**self.post, "status": "running"}))

    def test_old_post_gets_missing_copies_made_once(self):
        res = client.get(self.url("preview", "slide_02.jpg"))
        self.assertEqual((res.status_code, res.headers["content-type"]), (200, "image/jpeg"))
        self.assertTrue((posts.POSTS_DIR / self.id / "out" / "preview" / "slide_02.jpg").is_file())
        self.assertEqual(client.get(self.url("png", "slide_01.png")).headers["content-type"], "image/png")

    def test_cache_etag_range_and_download(self):
        res = client.get(self.url("full", "slide_01.jpg"))
        self.assertEqual(res.headers["cache-control"], "private, max-age=31536000, immutable")
        self.assertEqual(res.headers["accept-ranges"], "bytes")
        again = client.get(self.url("full", "slide_01.jpg"), headers={"If-None-Match": res.headers["etag"]})
        self.assertEqual(again.status_code, 304)
        part = client.get(self.url("full", "slide_01.jpg"), headers={"Range": "bytes=0-9"})
        self.assertEqual((part.status_code, len(part.content)), (206, 10))
        dl = client.get(self.url("full", "slide_01.jpg", "&download=My Post 01"))
        self.assertEqual(dl.headers["content-disposition"], 'attachment; filename="My-Post-01.jpg"')
        self.assertIn("inline", client.get(self.url("full", "slide_01.jpg")).headers.get("content-disposition", "inline"))
        no_v = client.get(f"{self.media['base']}/full/slide_01.jpg")
        self.assertEqual(no_v.headers["cache-control"], "private, no-cache")

    def test_whole_post_zip(self):
        res = client.get(self.url("zip", "post.zip", "&download=My Post"))
        self.assertEqual(res.status_code, 200)
        self.assertIn('filename="My-Post.zip"', res.headers["content-disposition"])
        names = zipfile.ZipFile(io.BytesIO(res.content)).namelist()
        self.assertEqual(sorted(names), ["caption.txt", "script.md", "slide_01.png", "slide_02.png"])
        # the old route hands over the same prebuilt file
        self.assertEqual(client.get(f"/api/posts/{self.id}/zip").content, res.content)

    def test_bad_names_and_ids_are_refused(self):
        for path in (f"{self.media['base']}/full/..%2F..%2Fposts.db", f"{self.media['base']}/png/slide_01.jpg",
                     f"{self.media['base']}/zip/other.zip", f"{self.media['base']}/thumb/slide_09.jpg",
                     "/media/posts/NOTANID/thumb/slide_01.jpg", f"{self.media['base']}/secret/slide_01.jpg"):
            self.assertEqual(client.get(path).status_code, 404, path)

    def test_needs_sign_in_or_the_posts_token_when_locked(self):
        with mock.patch.object(db_server, "API_SECRET", "s" * 32):
            self.assertEqual(client.get(self.url("thumb", "slide_01.jpg")).status_code, 401)
            self.assertEqual(client.get(self.url("thumb", "slide_01.jpg", "&t=wrong")).status_code, 401)
            self.assertEqual(client.get(self.url("thumb", "slide_01.jpg", f"&t={self.media['t']}")).status_code, 200)
            self.assertEqual(client.get(self.url("thumb", "slide_01.jpg"), headers={"Authorization": "Bearer " + "s" * 32}).status_code, 200)
            # another post's token doesn't open this one
            self.assertEqual(client.get(self.url("thumb", "slide_01.jpg", f"&t={posts.media_token('000000000000')}")).status_code, 401)


class EmailPrefs(unittest.TestCase):
    def test_default_is_on(self):
        self.assertTrue(notifier.DEFAULT_PREFS["email"]["postReady"])

    def test_inline_images_are_attached(self):
        prefs = notifier.get_prefs()
        captured = {}

        class Smtp:
            def __init__(self, *a, **k): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def ehlo(self): pass
            def has_extn(self, n): return True
            def starttls(self, context=None): pass
            def login(self, *a): pass
            def send_message(self, msg): captured["msg"] = msg

        with mock.patch("smtplib.SMTP", Smtp), mock.patch.object(notifier, "smtp_password", return_value="pw"):
            notifier.send_email(prefs, "s", "t", '<p>hi <img src="cid:slide1"></p>', {"slide1": b"\xff\xd8\xff\xd9"})
        ids = [part["Content-ID"] for part in captured["msg"].walk() if part["Content-ID"]]
        self.assertEqual(ids, ["<slide1>"])




class EnginePriorityTests(unittest.TestCase):
    def test_engine_runs_below_the_web_server(self):
        # The engine and its Chromium must not starve Sage's web server.
        self.assertGreater(posts.ENGINE_NICE, 0)
        if os.name == "posix":
            import subprocess
            out = subprocess.run([sys.executable, "-c", "import os; print(os.nice(0))"],
                                 preexec_fn=posts._lower_priority, capture_output=True, text=True)
            self.assertGreater(int(out.stdout), os.nice(0))

if __name__ == "__main__":
    unittest.main()


class PictureSourceTests(unittest.TestCase):
    def setUp(self):
        self.old = notifier.SECRETS_FILE
        notifier.SECRETS_FILE = Path(TMP) / "pic_secrets.json"
        for env in posts.PICTURE_KEYS.values():
            os.environ.pop(env, None)

    def tearDown(self):
        notifier.SECRETS_FILE = self.old

    def test_keys_saved_hidden_and_passed_to_the_engine(self):
        res = client.put("/api/posts/pictures", json={"pexels": "abcd efgh 1234 wxyz"}).json()
        self.assertTrue(res["sources"]["pexels"]["set"])
        self.assertEqual(res["sources"]["pexels"]["last4"], "wxyz")
        self.assertNotIn("abcdefgh", json.dumps(res))
        self.assertFalse(res["sources"]["unsplash"]["set"])
        self.assertTrue(res["sources"]["wikimedia"]["set"])
        self.assertEqual(posts._engine_env()["PEXELS_API_KEY"], "abcdefgh1234wxyz")
        self.assertIn("pictureSources", posts.status())
        res = client.put("/api/posts/pictures", json={"pexels": ""}).json()    # empty removes it
        self.assertFalse(res["sources"]["pexels"]["set"])
        self.assertNotIn("PEXELS_API_KEY", posts._engine_env())

    def test_prompt_tells_the_ai_about_search_pictures(self):
        text = (Path(posts.ENGINE_DIR) / "POST_FORMAT.md").read_text(encoding="utf-8")
        prompt = text.split("<!-- PROMPT START -->")[1].split("<!-- PROMPT END -->")[0]
        self.assertIn("search:", prompt)
        self.assertIn("Photo credits", prompt)

    def test_caption_gets_a_photo_credit(self):
        sys.path.insert(0, str(Path(posts.ENGINE_DIR) / "src"))
        from autocontent.spec import build, stock
        with mock.patch.object(stock, "credit_for", return_value="Photo by Ann on Pexels"):
            out = build.with_photo_credits("Hello\n", [{"type": "image", "image_source": "a.jpg"},
                                                       {"type": "image", "image_source": "b.jpg"}])
        self.assertEqual(out.count("Photo by Ann on Pexels"), 1)
        self.assertIn("Photo credits:", out)
        self.assertEqual(build.with_photo_credits("Hi\n", [{"type": "point"}]), "Hi\n")
