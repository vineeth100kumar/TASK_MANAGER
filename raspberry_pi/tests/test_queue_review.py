"""Tests for the render queue and the approve/reject (archive) flow on Posts and Reels.

These don't draw anything: the render step (reels._run / posts._run) is patched out, so the queue
ordering, the cooldown gate and the review/archive/restore routes are checked on their own, fast,
with no Chromium or ffmpeg.

    cd raspberry_pi && python -m unittest tests.test_queue_review
"""

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "qr.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import posts  # noqa: E402
import reels  # noqa: E402

client = TestClient(db_server.app)

REEL = """---
autocontent: reel
title: Queue test reel
voice: af_heart
---

## cover
headline: A test
say: This is a test of the queue.

## caption
A caption.
"""

POST = """---
autocontent: post
title: Queue test post
---

## cover
headline: A test
Swipe on.

## caption
A caption.
"""


def run(coro):
    # A fresh loop per call (asyncio.get_event_loop() raises on 3.11+ when none is running).
    return asyncio.run(coro)


class ReelQueueTests(unittest.TestCase):
    def setUp(self):
        reels.connect(os.environ["SAGE_DB_PATH"])
        # Don't actually render: just mark the reel done so review/restore have something to act on.
        self._run = mock.patch.object(reels, "_run", new=self._fake_run).start()
        self._voice = mock.patch.object(reels, "_voice_problem", return_value="").start()
        self.addCleanup(mock.patch.stopall)
        for r in reels.recent(limit=0) + reels.recent(limit=0, archived=True):
            reels.delete(r["id"])

    async def _fake_run(self, reel):
        reel.update(status="done", size=1234, finishedAt=reels._utc(), seconds=5)
        await reels.save_async(reel)

    async def _start(self):
        rid = reels.start(REEL)["id"]   # spawns the (patched) _run on this running loop
        for _ in range(100):
            await asyncio.sleep(0.01)
            if (reels.get(rid) or {}).get("status") == "done":
                break
        return rid

    def _make(self):
        return reels.get(run(self._start()))

    def test_cap_is_four(self):
        self.assertEqual(reels.MAX_QUEUE, 4)

    def test_queue_position_in_order(self):
        made = [self._make() for _ in range(3)]
        # force them back to queued so positions are visible
        for i, r in enumerate(made):
            r["status"] = "queued"
            reels.save(r)
        pos = {r["id"]: reels.queue_position(r["id"]) for r in made}
        self.assertEqual(sorted(pos.values()), [1, 2, 3])
        # oldest is first in line
        self.assertEqual(reels.queue_position(made[0]["id"]), 1)
        rows = {r["id"]: r for r in reels.recent()}
        self.assertEqual(rows[made[0]["id"]]["queuePosition"], 1)

    def test_reject_archives_and_strips_the_video(self):
        reel = self._make()
        res = client.post(f"/api/reels/{reel['id']}/review", json={"action": "reject"})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()["reel"]
        self.assertEqual(body["review"], "rejected")
        self.assertTrue(body["archived"])
        self.assertEqual(body["size"], 0)
        self.assertIsNone(body["media"])
        # gone from the live list, present in the archive, script still kept
        self.assertNotIn(reel["id"], [r["id"] for r in reels.recent()])
        self.assertIn(reel["id"], [r["id"] for r in reels.recent(archived=True)])
        self.assertTrue(reels.get(reel["id"])["script"])

    def test_approve_marks_ready(self):
        reel = self._make()
        res = client.post(f"/api/reels/{reel['id']}/review", json={"action": "approve"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["reel"]["review"], "approved")
        self.assertFalse(res.json()["reel"]["archived"])

    def test_restore_requeues_from_the_kept_script(self):
        reel = self._make()
        client.post(f"/api/reels/{reel['id']}/review", json={"action": "reject"})
        res = client.post(f"/api/reels/{reel['id']}/restore")
        self.assertEqual(res.status_code, 200, res.text)
        run(asyncio.sleep(0))
        back = reels.get(reel["id"])
        self.assertFalse(back["archived"])
        self.assertEqual(back["review"], "pending")
        self.assertIn(reel["id"], [r["id"] for r in reels.recent()])

    def test_cooldown_waits_then_proceeds(self):
        # With a recent finish and a 1 s cooldown, _cooldown sleeps roughly that long.
        reels._last_finished = reels.time.monotonic()
        with mock.patch.object(reels, "COOLDOWN_SECONDS", 1):
            reel = {"id": "a" * 12, "progress": {}}
            start = reels.time.monotonic()
            with mock.patch.object(reels, "save_async", new=self._noop), \
                 mock.patch.object(reels, "_announce", new=self._noop):
                run(reels._cooldown(reel))
            self.assertGreaterEqual(reels.time.monotonic() - start, 0.9)

    async def _noop(self, *a, **k):
        return None


class PostReviewTests(unittest.TestCase):
    def setUp(self):
        posts.connect(os.environ["SAGE_DB_PATH"])
        mock.patch.object(posts, "_run", new=self._fake_run).start()
        self.addCleanup(mock.patch.stopall)
        for p in posts.recent(limit=0) + posts.recent(limit=0, archived=True):
            posts.delete(p["id"])

    async def _fake_run(self, post):
        post.update(status="done", slideCount=3, slides=["slide_01.png"], finishedAt=posts._utc())
        await posts.save_async(post)

    async def _start(self):
        pid = posts.start(POST)["id"]
        for _ in range(100):
            await asyncio.sleep(0.01)
            if (posts.get(pid) or {}).get("status") == "done":
                break
        return pid

    def _make(self):
        return posts.get(run(self._start()))

    def test_reject_then_restore(self):
        post = self._make()
        res = client.post(f"/api/posts/{post['id']}/review", json={"action": "reject"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["post"]["archived"])
        self.assertEqual(res.json()["post"]["slideCount"], 0)
        self.assertNotIn(post["id"], [p["id"] for p in posts.recent()])
        self.assertIn(post["id"], [p["id"] for p in posts.recent(archived=True)])
        res = client.post(f"/api/posts/{post['id']}/restore")
        self.assertEqual(res.status_code, 200, res.text)
        run(asyncio.sleep(0))
        self.assertFalse(posts.get(post["id"])["archived"])

    def test_unknown_action_is_refused(self):
        post = self._make()
        res = client.post(f"/api/posts/{post['id']}/review", json={"action": "sideways"})
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
