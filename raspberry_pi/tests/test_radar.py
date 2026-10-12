"""Tests for Radar's headlines, prices and source health (radar.py).

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import datetime
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "radar.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
os.environ.pop("SAGE_RADAR_FEEDS", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import radar  # noqa: E402

client = TestClient(db_server.app)
UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 11, 12, 0, tzinfo=UTC)

RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
<item><title>EU AI Act rules start biting for model makers</title><link>https://example.com/a</link>
  <pubDate>Sun, 11 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Container freight rates fall as Red Sea routes reopen</title><link>https://example.com/b</link>
  <pubDate>Sat, 10 Oct 2026 09:00:00 +0000</pubDate></item>
<item><title>  </title><link>https://example.com/empty</link></item>
<item><title>No link here</title></item>
<item><title>From the future</title><link>https://example.com/future</link><pubDate>Mon, 12 Oct 2026 23:00:00 GMT</pubDate></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title type="html">FDA clears an AI scribe &amp;amp; more</title>
  <link rel="alternate" href="https://example.com/c"/><updated>2026-10-11T08:30:00Z</updated></entry>
</feed>"""


def chart(closes, price):
    return {"chart": {"result": [{"meta": {"regularMarketPrice": price}, "indicators": {"quote": [{"close": closes}]}}], "error": None}}


def reset():
    conn = sqlite3.connect(radar.DB_PATH)
    conn.executescript("DELETE FROM radar_signals; DELETE FROM radar_quotes; DELETE FROM radar_sources;")
    conn.commit()
    conn.close()
    radar.forget_yahoo_session()


def insert_signal(id_, published, tags, seen=None, region="Global", source="Test"):
    conn = sqlite3.connect(radar.DB_PATH)
    conn.execute(
        "INSERT INTO radar_signals (id, source, title, link, published, seen_at, region, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (id_, source, f"Headline {id_}", f"https://example.com/{id_}", radar._iso(published), radar._iso(seen or published), region, json.dumps(tags)),
    )
    conn.commit()
    conn.close()


class Parsing(unittest.TestCase):
    def test_rss(self):
        items = radar.parse_feed(RSS, NOW)
        self.assertEqual([i["link"] for i in items], ["https://example.com/a", "https://example.com/b", "https://example.com/future"])
        self.assertEqual(items[0]["published"], datetime.datetime(2026, 10, 11, 10, 0, tzinfo=UTC))
        # A date in the future is pulled back to now.
        self.assertEqual(items[2]["published"], NOW)

    def test_atom(self):
        items = radar.parse_feed(ATOM, NOW)
        self.assertEqual(items[0]["title"], "FDA clears an AI scribe & more")
        self.assertEqual(items[0]["link"], "https://example.com/c")

    def test_not_a_feed(self):
        with self.assertRaises(ValueError):
            radar.parse_feed(b"<html><body>Blocked</body></html>", NOW)
        with self.assertRaises(ValueError):
            radar.parse_feed(b"not xml at all", NOW)


class Tagging(unittest.TestCase):
    def test_tags(self):
        self.assertEqual(radar.tag_title("EU AI Act rules start biting for model makers"), ["AI", "Regulation"])
        self.assertEqual(radar.tag_title("Container freight rates fall as Red Sea routes reopen"), ["Supply chain"])
        self.assertEqual(radar.tag_title("FDA clears first AI scribe"), ["AI", "Health"])

    def test_whole_words_and_case(self):
        # "said" has "ai" in it; "us" is a pronoun, not the country.
        self.assertEqual(radar.tag_title("She said the plan was fine"), [])
        self.assertEqual(radar.guess_region("Tell us what you think", None), "Global")
        self.assertEqual(radar.guess_region("US banks brace for new rules", None), "Americas")

    def test_region(self):
        self.assertEqual(radar.guess_region("Why Vietnam and Indonesia are the new back office", None), "Asia-Pacific")
        self.assertEqual(radar.guess_region("Startups raise more money", "Europe"), "Europe")
        self.assertEqual(radar.guess_region("Nigeria's fintechs grow up", "Europe"), "Emerging")

    def test_india(self):
        self.assertEqual(radar.guess_region("RBI holds repo rate as rupee steadies", None), "India")
        self.assertEqual(radar.guess_region("Bengaluru startup raises Series B", None), "India")
        # A tie goes to India; Indian sources keep India when nothing is named.
        self.assertEqual(radar.guess_region("US tariffs hit Indian exporters", None), "India")
        self.assertEqual(radar.guess_region("Startups raise more money", "India"), "India")
        self.assertEqual(radar.guess_region("Japan and China lead chip spending", None), "Asia-Pacific")


class Chart(unittest.TestCase):
    def test_change_from_previous_close(self):
        quote = radar.parse_chart(chart([100, None, 101, 102.0], 102.0))
        self.assertEqual(quote["price"], 102.0)
        self.assertAlmostEqual(quote["changePct"], 0.99, places=2)
        self.assertEqual(quote["closes"], [100, 101, 102.0])

    def test_error(self):
        with self.assertRaises(ValueError):
            radar.parse_chart({"chart": {"result": None, "error": {"description": "No data found"}}})


def mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class YahooChart(unittest.TestCase):
    def setUp(self):
        reset()

    def test_second_host_answers_when_first_is_down(self):
        def handler(request):
            if request.url.host == "query1.finance.yahoo.com":
                raise httpx.ConnectError("down")
            return httpx.Response(200, json=chart([10, 11], 11))

        data = asyncio.run(radar.yahoo_chart(mock_client(handler), "^GSPC", {"range": "10d"}))
        self.assertEqual(radar.parse_chart(data)["price"], 11)

    def test_refused_gets_cookie_and_crumb_once(self):
        calls = {"crumb": 0}

        def handler(request):
            if request.url.host == "fc.yahoo.com":
                return httpx.Response(404, headers={"set-cookie": "A3=abc; Domain=.yahoo.com; Path=/"})
            if request.url.path.endswith("getcrumb"):
                calls["crumb"] += 1
                return httpx.Response(200, text="Xy1.z")
            if request.url.params.get("crumb") == "Xy1.z":
                return httpx.Response(200, json=chart([10, 11], 11))
            return httpx.Response(429)

        async def run():
            async with mock_client(handler) as client:
                return await asyncio.gather(*[radar.yahoo_chart(client, s, {}) for s in ("A", "B", "C")])

        self.assertEqual(len(asyncio.run(run())), 3)
        self.assertEqual(calls["crumb"], 1)

    def test_unknown_symbol_is_not_retried(self):
        seen = []

        def handler(request):
            seen.append(request.url.host)
            return httpx.Response(404)

        with self.assertRaises(httpx.HTTPStatusError):
            asyncio.run(radar.yahoo_chart(mock_client(handler), "NOPE", {}))
        self.assertEqual(seen, ["query1.finance.yahoo.com"])


class Fetching(unittest.TestCase):
    def setUp(self):
        reset()

    def test_feeds_are_stored_once_and_health_is_kept(self):
        def handler(request):
            if "techcrunch" in request.url.host:
                return httpx.Response(200, content=RSS)
            if "hnrss" in request.url.host:
                return httpx.Response(200, content=ATOM)
            if "economist" in request.url.host:
                return httpx.Response(200, content=b"<rss><channel></channel></rss>")
            return httpx.Response(503)

        added = asyncio.run(radar.refresh_feeds(mock_client(handler), NOW))
        self.assertEqual(added, 4)
        # The same headlines again are not new.
        self.assertEqual(asyncio.run(radar.refresh_feeds(mock_client(handler), NOW)), 0)

        sources = {s["name"]: s for s in radar.summary(NOW)["sources"]}
        self.assertTrue(sources["TechCrunch"]["ok"])
        self.assertEqual(sources["TechCrunch"]["items"], 3)
        self.assertFalse(sources["The Economist"]["ok"])
        self.assertEqual(sources["The Economist"]["error"], "no headlines")
        self.assertFalse(sources["BBC Business"]["ok"])
        self.assertEqual(sources["BBC Business"]["error"], "HTTP 503")

    def test_quotes_keep_last_good_price(self):
        good = mock_client(lambda r: httpx.Response(200, json=chart([10, 11], 11)))
        self.assertEqual(asyncio.run(radar.refresh_quotes(good, NOW)), len(radar.quotes()))
        bad = mock_client(lambda r: httpx.Response(429))
        self.assertEqual(asyncio.run(radar.refresh_quotes(bad, NOW)), 0)

        data = radar.summary(NOW)
        self.assertEqual([q["name"] for q in data["ticker"]], [name for _, name, _ in radar.quotes()])
        self.assertEqual(data["ticker"][0]["name"], "Nifty 50")
        self.assertEqual(data["ticker"][0]["price"], 11)
        markets = next(s for s in data["sources"] if s["name"] == "Yahoo markets")
        self.assertFalse(markets["ok"])
        self.assertIn("HTTP 429", markets["error"])
        self.assertIsNotNone(markets["lastOkAt"])


class Velocity(unittest.TestCase):
    def setUp(self):
        reset()

    def test_learning_at_first(self):
        insert_signal("a", NOW - datetime.timedelta(hours=2), ["AI"], seen=NOW - datetime.timedelta(hours=2))
        v = radar.summary(NOW)["velocity"]
        self.assertTrue(v["learning"])
        self.assertEqual(v["tags"][0], {"tag": "AI", "recent": 1, "velocity": None})
        self.assertIn("learning", radar.summary(NOW)["headline"])

    def test_rising_tag(self):
        # Ten days of one Regulation headline a day, then six in the last two days.
        for day in range(3, 13):
            moment = NOW - datetime.timedelta(days=day)
            insert_signal(f"old{day}", moment, ["Regulation"])
        for n in range(6):
            insert_signal(f"new{n}", NOW - datetime.timedelta(hours=n * 5 + 1), ["Regulation", "AI"])
        data = radar.summary(NOW)
        top = data["velocity"]["tags"][0]
        self.assertFalse(data["velocity"]["learning"])
        self.assertEqual(top["tag"], "Regulation")
        self.assertGreaterEqual(top["velocity"], 2.5)
        self.assertTrue(data["headline"].startswith("Regulation news is running"))
        # AI has no usual pace yet, so it has no velocity.
        ai = next(t for t in data["velocity"]["tags"] if t["tag"] == "AI")
        self.assertIsNone(ai["velocity"])

        rows = radar.signals(now=NOW)
        self.assertTrue(rows[0]["rising"])
        self.assertEqual(rows[0]["id"], "new0")


class Routes(unittest.TestCase):
    def setUp(self):
        reset()
        insert_signal("eu", NOW - datetime.timedelta(hours=1), ["Regulation"], region="Europe")
        insert_signal("asia", NOW - datetime.timedelta(hours=2), ["Fintech"], region="Asia-Pacific")

    def test_signals_filters(self):
        self.assertEqual(len(client.get("/api/radar/signals").json()["signals"]), 2)
        self.assertEqual([s["id"] for s in client.get("/api/radar/signals?region=Europe").json()["signals"]], ["eu"])
        self.assertEqual([s["id"] for s in client.get("/api/radar/signals?tag=Fintech").json()["signals"]], ["asia"])
        self.assertEqual(len(client.get("/api/radar/signals?region=Global").json()["signals"]), 2)

    def test_summary_shape(self):
        data = client.get("/api/radar/summary").json()
        self.assertTrue(data["success"])
        for key in ("headline", "ticker", "velocity", "sources", "regions", "tags", "new24h"):
            self.assertIn(key, data)
        self.assertEqual(data["regions"][0], "Global")

    def test_india_lane(self):
        insert_signal("in", NOW - datetime.timedelta(hours=3), [], region="India")
        # From an Indian source but about the Fed: still in the India lane.
        insert_signal("et-fed", NOW - datetime.timedelta(hours=4), [], region="Americas", source="Economic Times")
        ids = [s["id"] for s in client.get("/api/radar/signals?region=India").json()["signals"]]
        self.assertEqual(ids, ["in", "et-fed"])
        self.assertEqual([s["id"] for s in client.get("/api/radar/signals?region=Americas").json()["signals"]], ["et-fed"])
        self.assertEqual(client.get("/api/radar/summary").json()["regions"][:2], ["Global", "India"])

    def test_india_switch(self):
        self.assertTrue(client.get("/api/radar/settings").json()["settings"]["india"])
        self.assertIn("Inc42", [f["name"] for f in radar.feeds()])
        try:
            self.assertFalse(client.put("/api/radar/settings", json={"india": False}).json()["settings"]["india"])
            self.assertNotIn("Inc42", [f["name"] for f in radar.feeds()])
            self.assertNotIn("^NSEI", [s for s, _, _ in radar.quotes()])
            self.assertIn("TechCrunch", [f["name"] for f in radar.feeds()])
            insert_signal("et", NOW - datetime.timedelta(hours=1), [], region="India", source="Inc42")
            self.assertNotIn("et", [x["id"] for x in radar.signals(now=NOW)])
        finally:
            client.put("/api/radar/settings", json={"india": True})
        self.assertEqual(radar.quotes()[0][0], "^NSEI")

    def test_radar_tables_never_sync(self):
        self.assertFalse(any(t.startswith("radar") for t in db_server.SYNC_TABLES))
        data = client.get("/api/sync/all").json()
        self.assertFalse(any("radar" in k.lower() for k in data.get("data", data)))


class Market(unittest.TestCase):
    def test_hours(self):
        # 10:00 New York on a Monday; then a Sunday.
        self.assertTrue(radar.Collector.market_open(datetime.datetime(2026, 10, 12, 14, 0, tzinfo=UTC)))
        self.assertFalse(radar.Collector.market_open(datetime.datetime(2026, 10, 11, 14, 0, tzinfo=UTC)))
        # 11:00 in Mumbai on a Monday (05:30 UTC), when New York is shut.
        self.assertTrue(radar.Collector.market_open(datetime.datetime(2026, 10, 12, 5, 30, tzinfo=UTC)))
        self.assertFalse(radar.Collector.market_open(datetime.datetime(2026, 10, 12, 11, 0, tzinfo=UTC)))


if __name__ == "__main__":
    unittest.main()
