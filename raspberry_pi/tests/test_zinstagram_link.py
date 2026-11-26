"""Tests for instagram_link.py: a posted piece finds its Instagram link (S-201).

Sorts late on purpose (see test_scheduled_content).

    cd raspberry_pi && python -m unittest tests.test_zinstagram_link
"""

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "ig.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db_server  # noqa: E402,F401  (sets up the shared database)
import instagram_link  # noqa: E402
import social  # noqa: E402


def put_media(sage_id="abc", kind="post", link="https://instagram.com/p/XYZ/"):
    conn = social._db()
    conn.execute("INSERT OR REPLACE INTO social_media (id, project_id, kind, caption, permalink, thumbnail,"
                 " posted_at, sage_kind, sage_id, metrics, updated_at) VALUES ('m1','p1','image','c',?,'','2026-11-26T00:00:00Z',?,?,'{}','')",
                 (link, kind, sage_id))
    conn.commit()
    conn.close()


class Find(unittest.TestCase):
    def test_found_after_a_pull(self):
        item = {"id": "abc", "projectId": "p1", "posted": True}

        async def fake_pull(project_id):
            put_media()
        with mock.patch.object(instagram_link, "connected", return_value=True), \
             mock.patch.object(social, "pull", fake_pull):
            self.assertTrue(asyncio.run(instagram_link.try_once("post", item)))
        self.assertEqual(item["instagramUrl"], "https://instagram.com/p/XYZ/")
        self.assertEqual(item["instagramCheck"], "found")

    def test_missed_when_not_listed(self):
        item = {"id": "nope", "projectId": "p1", "posted": True}
        pull = mock.AsyncMock()
        with mock.patch.object(instagram_link, "connected", return_value=True), mock.patch.object(social, "pull", pull):
            self.assertFalse(asyncio.run(instagram_link.try_once("post", item)))
        self.assertNotIn("instagramUrl", item)

    def test_offline_without_a_page(self):
        item = {"id": "abc", "projectId": "none", "posted": True}
        self.assertFalse(asyncio.run(instagram_link.try_once("post", item)))
        self.assertEqual(item["instagramCheck"], "offline")

    def test_search_retries_then_gives_up(self):
        store = {"id": "q", "projectId": "p1", "posted": True}
        saved = []

        async def save(i):
            saved.append(dict(i))
        with mock.patch.object(instagram_link, "connected", return_value=True), \
             mock.patch.object(social, "pull", mock.AsyncMock()), \
             mock.patch("asyncio.sleep", mock.AsyncMock()):
            asyncio.run(instagram_link._search("post", "q", lambda _id: store, save, (1, 2, 3)))
        self.assertEqual(store["instagramCheck"], "missed")

    def test_clear(self):
        item = {"id": "a", "instagramUrl": "x", "instagramId": "y", "instagramCheck": "found"}
        instagram_link.clear("post", item)
        self.assertEqual(item, {"id": "a"})


if __name__ == "__main__":
    unittest.main()
