"""content_link.py: a post or reel follows its task when the task is moved on the project's board.

The file name sorts after test_safety on purpose (see test_scheduled_content.py).

    cd raspberry_pi && python -m unittest tests.test_zz_content_link
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "link.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db_server  # noqa: E402
import content_link  # noqa: E402
import posts  # noqa: E402
import reels  # noqa: E402
from tests.test_scheduled_content import FakeBox, SMALL  # noqa: E402


class FollowTheTask(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.box = FakeBox()
        posts.connect(db_server.DB_PATH, None, self.box.create, self.box.update, self.box.find)
        reels.connect(db_server.DB_PATH)
        for mod in (posts, reels):
            patch = mock.patch.object(mod, "_run", mock.Mock(return_value=None))
            patch.start()
            self.addCleanup(patch.stop)
        with mock.patch.object(posts, "_spawn"):
            self.post = posts.start(SMALL, project_id="p1")
        self.post.update(status="done", slides=[], slideCount=2)
        posts.save(self.post)
        await posts._ensure_task(self.post)
        self.task = self.box.items[self.post["taskId"]]
        self.addCleanup(lambda: posts.delete(self.post["id"]))
        self.addCleanup(lambda: posts.connect(db_server.DB_PATH, None, None, None, None))

    def now(self):
        return posts.get(self.post["id"])

    async def move(self, stage, status):
        self.task.update(stage=stage, status=status)
        return await content_link.follow_task(self.task)

    async def test_a_finished_post_starts_in_editing(self):
        self.assertEqual((self.task["stage"], self.task["status"]), ("editing", "in_progress"))
        self.assertEqual(self.task["postId"], self.post["id"])

    async def test_dragging_to_published_marks_it_posted(self):
        self.assertEqual(await self.move("published", "done"), "posted")
        self.assertTrue(self.now()["posted"])
        self.assertIsNotNone(self.now()["postedAt"])
        # the post's own move comes back to the hook a second time and finds nothing to do
        self.assertIsNone(await content_link.follow_task(self.task))

    async def test_dragging_back_unposts_it(self):
        await self.move("published", "done")
        self.assertEqual(await self.move("editing", "in_progress"), "unposted")
        self.assertFalse(self.now()["posted"])

    async def test_an_unfinished_post_cannot_be_published(self):
        unfinished = self.now()
        unfinished["status"] = "running"
        posts.save(unfinished)
        self.assertEqual(await self.move("published", "done"), "refused")
        self.assertFalse(self.now()["posted"])
        # the task went back to where the post really is
        self.assertEqual(self.task["stage"], "scripting")

    async def test_incomplete_drops_it_and_a_working_stage_brings_it_back(self):
        self.assertEqual(await self.move("incomplete", "done"), "dropped")
        self.assertTrue(self.now()["wontPost"])
        self.assertIsNone(await content_link.follow_task(self.task))
        self.assertEqual(await self.move("editing", "in_progress"), "restored")
        self.assertFalse(self.now()["wontPost"])

    async def test_moving_between_working_stages_changes_nothing(self):
        for stage in ("idea", "scripting", "recording", "editing"):
            self.assertIsNone(await self.move(stage, "in_progress"))
        self.assertFalse(self.now()["posted"])
        self.assertFalse(self.now()["wontPost"])

    async def test_a_task_with_no_stage_or_no_piece_is_left_alone(self):
        self.assertIsNone(await content_link.follow_task({"id": "t9", "title": "x", "status": "done"}))
        self.assertIsNone(await content_link.follow_task({"id": "t9", "postId": "gone", "stage": "published"}))
        self.assertIsNone(await content_link.follow_task({"id": "t9", "postId": self.post["id"], "status": "done"}))


class WhatTheTaskShows(unittest.TestCase):
    def test_a_reel_waiting_for_a_voice_is_in_recording(self):
        self.assertEqual(posts._task_stage({"status": "waiting"}), ("recording", "in_progress"))
        self.assertEqual(posts._task_stage({"status": "running"}), ("scripting", "in_progress"))
        self.assertEqual(posts._task_stage({"status": "waiting", "wontPost": True}), ("incomplete", "done"))

    def test_the_slot_becomes_the_tasks_date_and_time(self):
        with mock.patch.object(posts.notifier, "get_prefs", return_value={"timezone": "Asia/Kolkata"}):
            got = posts._when_fields({"scheduledFor": "2026-11-24T03:30:00Z"})
        self.assertEqual(got, {"dueDate": "2026-11-24", "dueTime": "09:00"})

    def test_no_slot_clears_them(self):
        self.assertEqual(posts._when_fields({"scheduledFor": None}), {"dueDate": None, "dueTime": None})


if __name__ == "__main__":
    unittest.main()
