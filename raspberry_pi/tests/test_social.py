"""social.py: the Instagram numbers a content page keeps.

Nothing here talks to Meta. The metric names move around, so what matters is
that a refused metric is dropped rather than losing the pull, that the daily
snapshot and the overview add up, and that a made-in-Sage post is matched to
its Instagram post.

This file must sort AFTER test_safety.py: whichever test imports db_server
first fixes the data folder, which breaks test_safety's backup count.
"""
import asyncio
import datetime
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import social


class FakeResponse:
    def __init__(self, status: int, body: dict):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class FakeClient:
    """Stands in for httpx.AsyncClient: answers from a list of canned replies."""

    def __init__(self, replies):
        self.replies = replies
        self.calls = []

    async def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        reply = self.replies.pop(0) if self.replies else FakeResponse(200, {"data": []})
        return reply(params) if callable(reply) else reply


class SocialStorageTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        social.connect(os.path.join(self.dir.name, "sage.db"))

    def test_connect_is_repeatable(self):
        social.connect(social.DB_PATH)  # a restart must not lose anything
        self.assertEqual(social.accounts(), [])

    def test_status_before_anything_is_connected(self):
        state = social.status("p1")
        self.assertFalse(state["connected"])
        self.assertEqual(state["projectId"], "p1")

    def test_overview_adds_up_the_days_and_leaves_counts_out_of_totals(self):
        social._save_account("p1", token="t", username="mind", ig_user_id="9",
                             connected_at=social._iso(social._utcnow()))
        conn = social._db()
        for day, followers, reach in (("2026-11-01", 100, 50), ("2026-11-02", 110, 70)):
            conn.execute("INSERT INTO social_day (project_id, day, followers, follows, media_count, metrics)"
                         " VALUES (?, ?, ?, ?, ?, ?)",
                         ("p1", day, followers, 10, 5, json.dumps({"reach": reach, "total_interactions": 10})))
        conn.commit()
        conn.close()
        out = social.overview("p1", 30)
        self.assertEqual(out["followers"], 110)
        self.assertEqual(out["followersChange"], 10)
        self.assertEqual(out["totals"]["reach"], 120)
        # followers and mediaCount are a state, not something to sum
        self.assertNotIn("followers", out["totals"])
        self.assertNotIn("mediaCount", out["totals"])
        self.assertEqual(out["engagementRate"], round(100 * 20 / 120, 2))

    def test_posts_measure_each_one_against_the_page_average(self):
        social._save_account("p1", token="t")
        conn = social._db()
        for media_id, reach in (("m1", 50), ("m2", 150)):
            conn.execute("INSERT INTO social_media (id, project_id, kind, caption, permalink, thumbnail,"
                         " posted_at, sage_kind, sage_id, metrics, updated_at)"
                         " VALUES (?, ?, 'REELS', 'c', '', '', '2026-11-01T00:00:00+00:00', NULL, NULL, ?, '')",
                         (media_id, "p1", json.dumps({"reach": reach})))
        conn.commit()
        conn.close()
        out = social.posts("p1")
        self.assertEqual(out["averageReach"], 100)
        self.assertEqual({p["id"]: p["vsAverage"] for p in out["posts"]}, {"m1": -50, "m2": 50})

    def test_forget_clears_the_numbers_and_the_token(self):
        social._save_account("p1", token="t")
        conn = social._db()
        conn.execute("INSERT INTO social_media (id, project_id, metrics) VALUES ('m1', 'p1', '{}')")
        conn.execute("INSERT INTO social_media_snap (media_id, age_days, metrics, taken_at)"
                     " VALUES ('m1', 1, '{}', '')")
        conn.execute("INSERT INTO social_day (project_id, day, followers) VALUES ('p1', '2026-11-01', 5)")
        conn.commit()
        conn.close()
        social.forget("p1")
        self.assertIsNone(social.account_row("p1"))
        conn = social._db()
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM social_media").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM social_media_snap").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM social_day").fetchone()[0], 0)
        finally:
            conn.close()


class LinkAccountTest(unittest.IsolatedAsyncioTestCase):
    """How a pasted value is routed: a Unified-login system-user token vs the old code/token."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        social.connect(os.path.join(self.dir.name, "sage.db"))

    async def asyncSetUp(self):
        # pull() hits the network; stand it in.
        patch = mock.patch.object(social, "pull", mock.AsyncMock(return_value={"ok": True}))
        patch.start()
        self.addCleanup(patch.stop)

    async def test_a_long_token_takes_the_unified_facebook_path_and_never_expires(self):
        with mock.patch.object(social, "assigned_accounts",
                               mock.AsyncMock(return_value=[{"id": "178", "username": "mind"}])), \
             mock.patch.object(social, "account",
                               mock.AsyncMock(return_value={"username": "mind", "profile_picture_url": "p.jpg"})) as acct:
            await social.link_account("p1", "EAA" + "x" * 90)
        row = social.account_row("p1")
        self.assertEqual(row["host"], social.GRAPH_FB)
        self.assertEqual(row["ig_user_id"], "178")
        self.assertEqual(row["username"], "mind")
        self.assertIsNone(row["token_expires_at"])   # a system-user token never expires
        # the account was read off the IG node, not /me
        self.assertEqual(acct.await_args.kwargs.get("ig_user_id"), "178")
        self.assertEqual(acct.await_args.kwargs.get("host"), social.GRAPH_FB)

    async def test_a_long_token_with_no_assigned_account_falls_back_to_instagram_login(self):
        # Unified login returns nothing -> treat it as an old Instagram-login long-lived token.
        with mock.patch.object(social, "assigned_accounts", mock.AsyncMock(return_value=[])), \
             mock.patch.object(social, "_long_lived", mock.AsyncMock(return_value=("tok", "2027-01-01T00:00:00+00:00"))), \
             mock.patch.object(social, "account",
                               mock.AsyncMock(return_value={"user_id": "9", "username": "mind"})):
            await social.link_account("p1", "IGAA" + "y" * 90)
        row = social.account_row("p1")
        self.assertEqual(row["host"], social.GRAPH)
        self.assertEqual(row["ig_user_id"], "9")
        self.assertEqual(row["token_expires_at"], "2027-01-01T00:00:00+00:00")

    async def test_a_short_code_takes_the_old_exchange_path(self):
        with mock.patch.object(social, "assigned_accounts", mock.AsyncMock(return_value=[])) as asg, \
             mock.patch.object(social, "exchange_code",
                               mock.AsyncMock(return_value=("tok", "2027-01-01T00:00:00+00:00"))) as ex, \
             mock.patch.object(social, "account",
                               mock.AsyncMock(return_value={"user_id": "9", "username": "mind"})):
            await social.link_account("p1", "AQBshortcode")
        ex.assert_awaited_once()
        asg.assert_not_awaited()   # a short code is never tried as a token
        self.assertEqual(social.account_row("p1")["host"], social.GRAPH)


class InsightsTest(unittest.TestCase):
    """A metric Meta retires must not cost us the others."""

    def _run(self, replies, metrics):
        client = FakeClient(replies)
        return asyncio.run(social._insights(client, "/9/insights", metrics, "token")), client

    def test_good_reply_is_read_from_total_value_and_values(self):
        reply = FakeResponse(200, {"data": [
            {"name": "reach", "total_value": {"value": 120}},
            {"name": "views", "values": [{"value": 7}, {"value": 9}]},
        ]})
        (out, dropped), _ = self._run([reply], ["reach", "views"])
        self.assertEqual(out, {"reach": 120.0, "views": 9.0})
        self.assertEqual(dropped, [])

    def test_one_dead_metric_is_dropped_and_the_rest_survive(self):
        def answer(params):
            asked = params["metric"].split(",")
            if "impressions" in asked:
                return FakeResponse(400, {"error": {"message": "metric[0] must be a valid insights metric"}})
            return FakeResponse(200, {"data": [{"name": m, "total_value": {"value": 5}} for m in asked]})

        (out, dropped), client = self._run([answer] * 12, ["reach", "impressions", "views", "likes"])
        self.assertEqual(dropped, ["impressions"])
        self.assertEqual(set(out), {"reach", "views", "likes"})
        self.assertGreater(len(client.calls), 1)  # it narrowed down rather than giving up

    def test_a_failure_that_is_not_about_a_metric_is_raised_with_its_reason(self):
        # Used to blank every tile and say "Instagram refused these metrics". Now the
        # real reason (permission, token, rate limit) reaches the dashboard.
        reply = FakeResponse(400, {"error": {"message": "(#10) Application does not have permission"}})
        client = FakeClient([reply])
        with self.assertRaises(social.SocialError) as ctx:
            asyncio.run(social._insights(client, "/9/insights", ["reach", "views"], "token"))
        self.assertIn("permission", str(ctx.exception))
        self.assertEqual(len(client.calls), 1)  # no pointless halving

    def test_empty_metric_list_asks_nothing(self):
        (out, dropped), client = self._run([], [])
        self.assertEqual((out, dropped), ({}, []))
        self.assertEqual(client.calls, [])


class MatchSageTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        social.connect(os.path.join(self.dir.name, "sage.db"))
        self.conn = social._db()
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE posts (id TEXT PRIMARY KEY, created_at TEXT, status TEXT, payload TEXT)")
        self.conn.execute("CREATE TABLE reels (id TEXT PRIMARY KEY, created_at TEXT, status TEXT, payload TEXT)")

    def _post(self, post_id, payload):
        self.conn.execute("INSERT INTO posts (id, payload) VALUES (?, ?)", (post_id, json.dumps(payload)))
        self.conn.commit()

    def test_matches_a_sage_post_by_caption_in_the_same_project(self):
        self._post("p-1", {"projectId": "proj", "caption": "Three small habits that give you an hour back",
                           "createdAt": "2026-11-01T10:00:00+00:00"})
        kind, found = social._match_sage("proj", "Three small habits that give you an hour back\n\n#habits",
                                         "2026-11-01T12:00:00+00:00", self.conn)
        self.assertEqual((kind, found), ("post", "p-1"))

    def test_another_project_is_never_matched(self):
        self._post("p-1", {"projectId": "other", "caption": "Three small habits that give you an hour back",
                           "createdAt": "2026-11-01T10:00:00+00:00"})
        self.assertEqual(social._match_sage("proj", "Three small habits that give you an hour back",
                                            "2026-11-01T12:00:00+00:00", self.conn), (None, None))

    def test_a_post_from_months_earlier_is_not_matched(self):
        self._post("p-1", {"projectId": "proj", "caption": "Three small habits that give you an hour back",
                           "createdAt": "2026-01-01T10:00:00+00:00"})
        self.assertEqual(social._match_sage("proj", "Three small habits that give you an hour back",
                                            "2026-11-01T12:00:00+00:00", self.conn), (None, None))

    def test_a_caption_too_short_to_tell_apart_is_left_alone(self):
        self._post("p-1", {"projectId": "proj", "caption": "Hi", "createdAt": "2026-11-01T10:00:00+00:00"})
        self.assertEqual(social._match_sage("proj", "Hi", "2026-11-01T12:00:00+00:00", self.conn), (None, None))

    def test_missing_tables_are_not_an_error(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        self.addCleanup(conn.close)
        self.assertEqual(social._match_sage("proj", "A caption long enough to match", "", conn), (None, None))


class ScheduleTest(unittest.TestCase):
    def test_pull_is_due_once_a_day_after_the_hour(self):
        morning = datetime.datetime(2026, 11, 24, social.PULL_HOUR, 5)
        night = datetime.datetime(2026, 11, 24, social.PULL_HOUR - 1, 0)
        self.assertTrue(social.due(morning, None))
        self.assertFalse(social.due(night, None))
        self.assertFalse(social.due(morning, "2026-11-24T06:30:00"))      # already done today
        self.assertTrue(social.due(morning, "2026-11-23T06:30:00"))       # yesterday
        self.assertTrue(social.due(morning, "nonsense"))                  # unreadable: pull again

    def test_token_refreshes_near_the_end_but_not_in_its_first_day(self):
        now = datetime.datetime(2026, 11, 24, 9, 0)
        old = (now - datetime.timedelta(days=40)).isoformat()
        fresh = (now - datetime.timedelta(hours=2)).isoformat()
        self.assertTrue(social.token_due(10, old, now))
        self.assertFalse(social.token_due(40, old, now))   # plenty of time left
        self.assertFalse(social.token_due(10, fresh, now))  # Meta wants it a day old
        self.assertFalse(social.token_due(None, old, now))
        self.assertFalse(social.token_due(-1, old, now))    # already expired: refreshing can't help


class MediaKindTest(unittest.TestCase):
    def test_clips_count_as_reels_and_anything_odd_as_feed(self):
        self.assertEqual(social._kind({"media_product_type": "CLIPS"}), "REELS")
        self.assertEqual(social._kind({"media_product_type": "REELS"}), "REELS")
        self.assertEqual(social._kind({"media_product_type": "STORY"}), "STORY")
        self.assertEqual(social._kind({"media_product_type": "AD"}), "FEED")
        self.assertEqual(social._kind({}), "FEED")

    def test_every_media_kind_has_metrics(self):
        for kind in ("REELS", "FEED", "STORY"):
            self.assertTrue(social.MEDIA_METRICS[kind])
        # impressions died on 21 Apr 2025; views replaced it
        for metrics in social.MEDIA_METRICS.values():
            self.assertNotIn("impressions", metrics)
        self.assertNotIn("impressions", social.ACCOUNT_METRICS)


if __name__ == "__main__":
    unittest.main()


class WindowInsightsTest(unittest.TestCase):
    """Tiles show Instagram's own 7/30/90-day totals, asked live."""

    def setUp(self):
        social._window_cache.clear()
        self.tmp = tempfile.TemporaryDirectory()
        social.connect(os.path.join(self.tmp.name, "t.db"))
        social._save_account("p1", ig_user_id="17", token="T" * 80, host=social.GRAPH_FB,
                             username="x")

    def tearDown(self):
        self.tmp.cleanup()

    def test_one_call_with_since_until(self):
        calls = []

        async def fake(client, path, metrics, token, extra=None, host=social.GRAPH):
            calls.append(extra)
            return {"reach": 10.0, "views": 50.0}, []

        with mock.patch.object(social, "_insights", fake):
            out = asyncio.run(social.window_insights("p1", 7))
        self.assertEqual(out["totals"]["views"], 50.0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["until"] - calls[0]["since"], 7 * 86400)
        self.assertFalse(out["approxReach"])

    def test_long_range_refused_is_asked_in_pieces(self):
        calls = []

        async def fake(client, path, metrics, token, extra=None, host=social.GRAPH):
            calls.append(extra)
            if extra["until"] - extra["since"] > 30 * 86400:
                raise social.SocialError("range too long")
            return {"views": 100.0}, []

        with mock.patch.object(social, "_insights", fake):
            out = asyncio.run(social.window_insights("p1", 90))
        self.assertEqual(out["totals"]["views"], 300.0)  # three 30-day pieces
        self.assertTrue(out["approxReach"])

    def test_cached(self):
        n = []

        async def fake(client, path, metrics, token, extra=None, host=social.GRAPH):
            n.append(1)
            return {"views": 1.0}, []

        with mock.patch.object(social, "_insights", fake):
            asyncio.run(social.window_insights("p1", 30))
            asyncio.run(social.window_insights("p1", 30))
        self.assertEqual(len(n), 1)

    def test_not_connected(self):
        self.assertIsNone(asyncio.run(social.window_insights("nope", 7)))


class PullKeepsPostsWhenInsightsFailTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        social.connect(os.path.join(self.tmp.name, "t.db"))
        social._save_account("p1", ig_user_id="17", token="T" * 80, host=social.GRAPH_FB, username="x")

    def tearDown(self):
        self.tmp.cleanup()

    def test_account_numbers_refused_still_pulls_posts_and_says_why(self):
        async def deny(*a, **k):
            raise social.SocialError("(#10) Application does not have permission", 502)

        with mock.patch.object(social, "account", mock.AsyncMock(return_value={"followers_count": 2, "id": "17"})), \
             mock.patch.object(social, "account_insights", deny), \
             mock.patch.object(social, "media_list", mock.AsyncMock(return_value=[])):
            out = asyncio.run(social.pull("p1"))
        self.assertTrue(out["ok"])
        self.assertIn("permission", social.account_row("p1")["problem"])


class PostsForAiTest(unittest.TestCase):
    """What an AI reads through sage_social_posts: titles, hashtags, winners, sorting."""

    ROWS = [
        # id, kind, caption, posted_at, metrics
        ("a", "REELS", "JIO LISTED. WHO GOT THE MONEY?\nBody #India #Markets", "2026-11-09T10:00:00+0000",
         {"views": 268, "likes": 91, "comments": 4, "saved": 22, "reach": 200}),
        ("b", "REELS", "Fertilizer prices fell #india", "2026-11-02T10:00:00+0000",
         {"views": 239, "likes": 60, "comments": 14, "saved": 11, "reach": 150}),
        ("c", "FEED", "No numbers yet", "2026-11-22T10:00:00+0000", {}),
    ]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        social.connect(os.path.join(self.tmp.name, "t.db"))
        conn = social._db()
        for mid, kind, caption, posted, metrics in self.ROWS:
            conn.execute(
                "INSERT INTO social_media (id, project_id, kind, caption, permalink, thumbnail, posted_at,"
                " sage_kind, sage_id, metrics, updated_at) VALUES (?, 'p1', ?, ?, '', '', ?, NULL, NULL, ?, '')",
                (mid, kind, caption, posted, json.dumps(metrics)))
        conn.commit()
        conn.close()

    def tearDown(self):
        self.tmp.cleanup()

    def test_title_and_hashtags_come_out_of_the_caption(self):
        out = {p["id"]: p for p in social.posts("p1")["posts"]}
        self.assertEqual(out["a"]["title"], "JIO LISTED. WHO GOT THE MONEY?")
        self.assertEqual(out["a"]["hashtags"], ["india", "markets"])
        self.assertEqual(social.hashtags("a #x #X, not#this & #y_z"), ["x", "y_z"])

    def test_top_names_the_winner_with_its_caption(self):
        top = social.posts("p1")["top"]
        self.assertEqual(top["views"]["id"], "a")
        self.assertEqual(top["comments"]["id"], "b")      # the other post wins this one
        self.assertIn("Body", top["views"]["caption"])
        self.assertEqual(top["views"]["hashtags"], ["india", "markets"])

    def test_sort_puts_best_first_and_missing_numbers_last(self):
        ids = [p["id"] for p in social.posts("p1", sort="views")["posts"]]
        self.assertEqual(ids, ["a", "b", "c"])
        ids = [p["id"] for p in social.posts("p1", sort="comments")["posts"]]
        self.assertEqual(ids, ["b", "a", "c"])
        ids = [p["id"] for p in social.posts("p1", sort="date")["posts"]]
        self.assertEqual(ids, ["c", "a", "b"])
        self.assertEqual(social.posts("p1", sort="nonsense")["sort"], "date")

    def test_hashtag_stats_average_over_the_posts_that_use_the_tag(self):
        stats = {r["tag"]: r for r in social.posts("p1")["hashtagStats"]}
        self.assertEqual(stats["india"]["posts"], 2)
        self.assertEqual(stats["india"]["avgViews"], 253.5)
        self.assertEqual(stats["markets"]["avgViews"], 268.0)
        self.assertEqual(social.posts("p1")["hashtagStats"][0]["tag"], "markets")  # best average first


class SageSourceTest(unittest.TestCase):
    """The topic behind an Instagram post: the Sage script it was made from."""

    def test_source_gives_title_script_and_planned_caption(self):
        import types
        import claude_api
        piece = {"title": "Why Jio listed", "script": "S" * 900, "caption": "cap", "hashtags": ["a"], "style": "mono"}
        fake = types.SimpleNamespace(get=lambda i: piece if i == "x" else None)
        with mock.patch.object(claude_api, "_posts", fake):
            short = claude_api._sage_source("post", "x")
            full = claude_api._sage_source("post", "x", full=True)
            self.assertEqual(short["title"], "Why Jio listed")
            self.assertEqual(len(short["script"]), 400)
            self.assertEqual(len(full["script"]), 900)
            self.assertEqual(full["plannedHashtags"], ["a"])
            self.assertIsNone(claude_api._sage_source("post", "missing"))
            self.assertIsNone(claude_api._sage_source(None, None))
