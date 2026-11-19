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

    async def test_ready_facts_name_the_slot(self):
        facts = posts.ready_facts({"title": "T", "scheduledFor": "2026-11-16T03:30:00Z", "projectId": None}, "post")
        self.assertEqual((facts["kind"], facts["title"]), ("post", "T"))
        self.assertTrue(facts["when"].startswith("Monday at"))
        self.assertTrue(facts["late"])


if __name__ == "__main__":
    unittest.main()
