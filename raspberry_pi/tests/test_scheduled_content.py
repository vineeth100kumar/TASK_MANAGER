"""Tests for content_schedule.py: planned posts and reels are drawn ahead of their slot.

The file name sorts after test_safety on purpose: whichever test file imports db_server first
sets the data folder the later ones share, and test_safety counts items in it.

    cd raspberry_pi && python -m unittest tests.test_scheduled_content
"""

import datetime
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "sched.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import content_schedule  # noqa: E402
import posts  # noqa: E402
import reels  # noqa: E402

client = TestClient(db_server.app)
UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 11, 23, 6, 0, tzinfo=UTC)
SMALL = """---
autocontent: post
title: Tiny post
---

## cover
headline: Hello
Swipe.

## cta
headline: Save this
body: Follow.

## caption
Hi.

## hashtags
#hi
"""


def at(hours: float) -> str:
    return (NOW + datetime.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


class FakeBox:
    """Stands in for the project and task records claude_api would hold."""

    def __init__(self):
        self.projects = {"p1": {"id": "p1", "type": "content", "name": "Mind Deeds"}, "p2": {"id": "p2", "type": "content", "name": "Other"}}
        self.items = {}

    def find(self, table, record_id):
        return (self.projects if table == "projects" else self.items).get(record_id)

    async def create(self, table, fields):
        record = {**fields, "id": f"t{len(self.items) + 1}"}
        self.items[record["id"]] = record
        return record

    async def update(self, table, record_id, fields):
        if record_id not in self.items:
            raise KeyError(record_id)
        self.items[record_id].update(fields)
        return self.items[record_id]


class ShouldRelease(unittest.TestCase):
    def test_inside_the_lead_always_starts(self):
        due = NOW + datetime.timedelta(minutes=59)
        self.assertTrue(content_schedule.should_release(due, NOW, idle=False))
        self.assertTrue(content_schedule.should_release(NOW - datetime.timedelta(hours=2), NOW, idle=False))

    def test_further_out_only_when_idle_and_within_a_day(self):
        due = NOW + datetime.timedelta(hours=5)
        self.assertFalse(content_schedule.should_release(due, NOW, idle=False))
        self.assertTrue(content_schedule.should_release(due, NOW, idle=True))
        self.assertFalse(content_schedule.should_release(NOW + datetime.timedelta(hours=30), NOW, idle=True))


class PlannedPosts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        posts.connect(db_server.DB_PATH, None, None, None, None)
        reels.connect(db_server.DB_PATH)
        for mod in (posts, reels):   # nothing here may really draw
            patch = mock.patch.object(mod, "_run", mock.Mock(return_value=None))
            patch.start()
            self.addCleanup(patch.stop)

    async def test_a_dated_post_is_planned_not_drawn(self):
        with mock.patch.object(posts, "_spawn") as spawn:
            post = posts.start(SMALL, scheduled_for=at(5))
        self.assertEqual(post["status"], "planned")
        self.assertEqual(post["scheduledFor"], at(5))
        spawn.assert_not_called()
        self.assertIn(post["id"], [p["id"] for p in posts.planned()])
        posts.delete(post["id"])

    async def test_planned_posts_ignore_the_queue_limit(self):
        with mock.patch.object(posts, "queue_length", return_value=posts.MAX_QUEUE), mock.patch.object(posts, "_spawn"):
            post = posts.start(SMALL, scheduled_for=at(30))
        self.assertEqual(post["status"], "planned")
        posts.delete(post["id"])

    async def test_release_due_starts_only_what_is_due(self):
        with mock.patch.object(posts, "_spawn"):
            soon = posts.start(SMALL, scheduled_for=at(0.5))
            later = posts.start(SMALL, scheduled_for=at(40))
        # something else is drawing, so the "idle" early start is off
        with mock.patch.object(posts, "_spawn") as spawn, mock.patch.object(posts, "queue_length", return_value=1), \
                mock.patch.object(reels, "queue_length", return_value=0):
            started = content_schedule.release_due(NOW)
        self.assertEqual(started, 1)
        spawn.assert_called_once()
        self.assertEqual(posts.get(soon["id"])["status"], "queued")
        self.assertEqual(posts.get(later["id"])["status"], "planned")
        posts.delete(soon["id"])
        posts.delete(later["id"])

    async def test_idle_pi_starts_one_early(self):
        with mock.patch.object(posts, "_spawn"):
            a = posts.start(SMALL, scheduled_for=at(6))
            b = posts.start(SMALL, scheduled_for=at(8))
        with mock.patch.object(posts, "_spawn"), mock.patch.object(posts, "queue_length", return_value=0), \
                mock.patch.object(reels, "queue_length", return_value=0):
            started = content_schedule.release_due(NOW)
        self.assertEqual(started, 1)   # one at a time: the earlier slot goes first
        self.assertEqual(posts.get(a["id"])["status"], "queued")
        self.assertEqual(posts.get(b["id"])["status"], "planned")
        posts.delete(a["id"])
        posts.delete(b["id"])

    async def test_clearing_the_date_draws_it_now(self):
        with mock.patch.object(posts, "_spawn"):
            post = posts.start(SMALL, scheduled_for=at(30))
        with mock.patch.object(posts, "_spawn") as spawn:
            out = client.post(f"/api/posts/{post['id']}/schedule", json={"at": None}).json()
        self.assertEqual(out["post"]["status"], "queued")
        spawn.assert_called_once()
        posts.delete(post["id"])

    async def test_a_planned_post_survives_a_restart(self):
        with mock.patch.object(posts, "_spawn"):
            post = posts.start(SMALL, scheduled_for=at(30))
        posts.connect(db_server.DB_PATH, None, None, None, None)
        self.assertEqual(posts.get(post["id"])["status"], "planned")
        posts.delete(post["id"])

    async def test_a_loose_post_can_join_and_change_projects(self):
        box = FakeBox()
        posts.connect(db_server.DB_PATH, None, box.create, box.update, box.find)
        with mock.patch.object(posts, "_spawn"):
            post = posts.start(SMALL)   # made with no project
        post.update(status="done", slides=[], slideCount=2)
        posts.save(post)
        self.assertEqual(client.post(f"/api/posts/{post['id']}/project", json={"projectId": "nope"}).status_code, 400)
        moved = client.post(f"/api/posts/{post['id']}/project", json={"projectId": "p1"}).json()["post"]
        self.assertEqual(moved["projectId"], "p1")
        task = box.items[moved["taskId"]]
        self.assertEqual((task["projectId"], task["status"], task["stage"]), ("p1", "in_progress", "editing"))
        # changing project moves the same task, it does not make another
        again = client.post(f"/api/posts/{post['id']}/project", json={"projectId": "p2"}).json()["post"]
        self.assertEqual(again["taskId"], moved["taskId"])
        self.assertEqual(len(box.items), 1)
        self.assertEqual(box.items[again["taskId"]]["projectId"], "p2")
        # a posted one lands as Published
        posted = client.post(f"/api/posts/{post['id']}/posted").json()["post"]
        self.assertTrue(posted["posted"])
        posts.delete(post["id"])
        posts.connect(db_server.DB_PATH, None, None, None, None)

    async def _finished_post(self, scheduled):
        with mock.patch.object(posts, "_spawn"):
            post = posts.start(SMALL)
        post.update(status="done", slides=[], slideCount=2, scheduledFor=scheduled)
        posts.save(post)
        return post

    async def test_post_time_reminders_come_at_the_time_then_next_morning(self):
        tz = content_schedule.notifier._tz(content_schedule.notifier.get_prefs())
        due = datetime.datetime(2026, 11, 20, 3, 30, tzinfo=UTC)   # a Friday
        post = await self._finished_post("2026-11-20T03:30:00Z")
        sent = []

        async def deliver(kind, item, stage):
            sent.append((kind, stage))

        before = due - datetime.timedelta(minutes=5)
        self.assertEqual(await content_schedule.remind_due(before, deliver), [])
        at = await content_schedule.remind_due(due + datetime.timedelta(minutes=1), deliver)
        self.assertEqual([(k, st) for k, _, st in at if _ == post["id"]], [("post", 1)])
        # nothing more the same evening
        self.assertEqual([x for x in await content_schedule.remind_due(due + datetime.timedelta(hours=8), deliver) if x[1] == post["id"]], [])
        # next morning at 9 local: one more
        local_due = due.astimezone(tz)
        morning = (local_due + datetime.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        again = await content_schedule.remind_due(morning + datetime.timedelta(minutes=1), deliver)
        self.assertEqual([st for _, i, st in again if i == post["id"]], [2])
        # and then never again
        self.assertEqual([x for x in await content_schedule.remind_due(morning + datetime.timedelta(days=1), deliver) if x[1] == post["id"]], [])
        posts.delete(post["id"])

    async def test_no_reminder_once_posted_or_dropped_and_a_new_time_restarts_them(self):
        due = datetime.datetime(2026, 11, 20, 3, 30, tzinfo=UTC)
        now = due + datetime.timedelta(minutes=1)
        sent = []

        async def deliver(kind, item, stage):
            sent.append(item["id"])

        dropped = await self._finished_post("2026-11-20T03:30:00Z")
        posted = await self._finished_post("2026-11-20T03:30:00Z")
        client.post(f"/api/posts/{dropped['id']}/skip", json={})
        client.post(f"/api/posts/{posted['id']}/posted")
        out = await content_schedule.remind_due(now, deliver)
        self.assertNotIn(dropped["id"], [i for _, i, _ in out])
        self.assertNotIn(posted["id"], [i for _, i, _ in out])
        # a dropped post has no date left, and coming back needs a new one
        self.assertIsNone(posts.get(dropped["id"])["scheduledFor"])
        back = client.post(f"/api/posts/{dropped['id']}/skip", json={"undo": True}).json()["post"]
        self.assertFalse(back["wontPost"])
        client.post(f"/api/posts/{dropped['id']}/schedule", json={"at": "2026-11-20T03:30:00Z"})
        again = await content_schedule.remind_due(now, deliver)
        self.assertIn(dropped["id"], [i for _, i, _ in again])
        client.post(f"/api/posts/{dropped['id']}/schedule", json={"at": "2026-11-20T03:30:00Z"})   # same time again: restarts
        self.assertEqual(posts.get(dropped["id"])["remindStage"], 0)
        posts.delete(dropped["id"])
        posts.delete(posted["id"])

    async def test_very_old_dates_are_not_reminded(self):
        post = await self._finished_post("2026-11-01T03:30:00Z")
        sent = []

        async def deliver(kind, item, stage):
            sent.append(item["id"])

        await content_schedule.remind_due(datetime.datetime(2026, 11, 20, 3, 30, tzinfo=UTC), deliver)
        self.assertNotIn(post["id"], sent)
        self.assertEqual(posts.get(post["id"])["remindStage"], 2)
        posts.delete(post["id"])

    async def test_a_dropped_planned_post_is_never_drawn(self):
        with mock.patch.object(posts, "_spawn"):
            post = posts.start(SMALL, scheduled_for=at(0.2))
        client.post(f"/api/posts/{post['id']}/skip", json={})
        with mock.patch.object(posts, "_spawn") as spawn:
            content_schedule.release_due(NOW)
        spawn.assert_not_called()
        self.assertEqual(posts.get(post["id"])["status"], "planned")
        posts.delete(post["id"])

    async def test_ready_facts_name_the_slot(self):
        facts = posts.ready_facts({"title": "T", "scheduledFor": "2026-11-16T03:30:00Z", "projectId": None}, "post")
        self.assertEqual((facts["kind"], facts["title"]), ("post", "T"))
        self.assertTrue(facts["when"].startswith("Monday at"))
        self.assertTrue(facts["late"])


if __name__ == "__main__":
    unittest.main()
