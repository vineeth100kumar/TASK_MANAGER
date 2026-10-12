"""Tests for Radar's Markets board and its why engine (markets.py).

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import datetime
import json
import os
import random
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "markets.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
os.environ.pop("SAGE_RADAR_FEEDS", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import markets  # noqa: E402
import prices  # noqa: E402
import radar  # noqa: E402
import radar_research  # noqa: E402

client = TestClient(db_server.app)
UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 12, 18, 0, tzinfo=UTC)


def days(n, end=datetime.date(2026, 10, 12)):
    """n weekdays ending at end, oldest first."""
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= datetime.timedelta(days=1)
    return list(reversed(out))


def walk(dates, rets, start=100.0):
    out, price = [], start
    for d, r in zip(dates, rets):
        price *= 1 + r / 100
        out.append((d, round(price, 6)))
    return out


def store(symbol, series, now=NOW):
    conn = sqlite3.connect(markets.DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO market_series (symbol, closes, updated_at, history_at, error) VALUES (?, ?, ?, ?, '')",
        (symbol, json.dumps(series), radar._iso(now), radar._iso(now)),
    )
    conn.commit()
    conn.close()


def reset():
    conn = sqlite3.connect(markets.DB_PATH)
    conn.executescript("DELETE FROM market_series; DELETE FROM market_why; DELETE FROM radar_signals; DELETE FROM radar_sources;")
    conn.commit()
    conn.close()
    radar.forget_yahoo_session()
    prices.forget()


def chart(stamps, closes, price=None, when=None, offset=-14400):
    meta = {"gmtoffset": offset}
    if price is not None:
        meta.update(regularMarketPrice=price, regularMarketTime=when)
    return {"chart": {"result": [{"meta": meta, "timestamp": stamps, "indicators": {"quote": [{"close": closes}]}}], "error": None}}


def mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class Series(unittest.TestCase):
    def test_parse_uses_exchange_days_and_live_price(self):
        # 2026-10-09 13:30 UTC and 2026-10-12 13:30 UTC; New York is UTC-4.
        data = chart([1791552600, 1791811800], [100.0, None], price=101.5, when=1791831600)
        self.assertEqual(markets.parse_series(data), [("2026-10-09", 100.0), ("2026-10-12", 101.5)])

    def test_parse_error(self):
        with self.assertRaises(ValueError):
            markets.parse_series({"chart": {"result": None, "error": {"description": "No data found"}}})

    def test_merge_replaces_days_and_keeps_order(self):
        merged = markets.merge([("2026-10-08", 1.0), ("2026-10-09", 2.0)], [("2026-10-09", 2.5), ("2026-10-12", 3.0)])
        self.assertEqual(merged, [("2026-10-08", 1.0), ("2026-10-09", 2.5), ("2026-10-12", 3.0)])

    def test_change_per_range(self):
        dates = days(30)
        series = [(d, 100.0 + i) for i, d in enumerate(dates)]
        self.assertAlmostEqual(markets.change(series, "1D"), round((129 / 128 - 1) * 100, 2))
        self.assertAlmostEqual(markets.change(series, "1W"), round((129 / 124 - 1) * 100, 2))
        self.assertAlmostEqual(markets.change(series, "1M"), round((129 / 108 - 1) * 100, 2))
        # No close from last year yet, so no YTD.
        self.assertIsNone(markets.change(series, "YTD"))
        with_last_year = [("2025-12-31", 50.0)] + series
        self.assertAlmostEqual(markets.change(with_last_year, "YTD"), round((129 / 50 - 1) * 100, 2))
        self.assertIsNone(markets.change(series[:1], "1D"))


class Math(unittest.TestCase):
    def test_fit_recovers_known_sensitivities(self):
        rng = random.Random(1)
        dates = days(200)
        market = {d: rng.gauss(0, 1) for d in dates}
        oil = {d: rng.gauss(0, 2) for d in dates}
        target = {d: 1.3 * market[d] + 0.4 * oil[d] + rng.gauss(0, 0.05) for d in dates}
        betas = markets.fit(target, {"market": market, "oil": oil})
        self.assertAlmostEqual(betas["market"], 1.3, delta=0.05)
        self.assertAlmostEqual(betas["oil"], 0.4, delta=0.05)

    def test_fit_needs_enough_days(self):
        dates = days(20)
        self.assertIsNone(markets.fit({d: 1.0 for d in dates}, {"market": {d: 1.0 for d in dates}}))

    def test_split_adds_up(self):
        parts = markets.split(1.42, {"market": 1.25, "rates": -0.18}, {"market": 0.41, "rates": -1.21})
        self.assertEqual([p["key"] for p in parts], ["market", "rates", "left"])
        self.assertAlmostEqual(sum(p["value"] for p in parts), 1.42, places=2)


class Reasons(unittest.TestCase):
    labels = {"market": "the S&P 500", "oil": "oil", "rates": "the 10-year yield", "dollar": "the dollar"}

    def test_factor_reason(self):
        parts = markets.split(-1.62, {"market": 0.8, "oil": 0.9}, {"market": 0.41, "oil": -1.22})
        reasons = markets.rule_reasons("Energy", -1.62, parts, None, [], "1D", self.labels)
        self.assertEqual(reasons[0]["title"], "Oil moved")
        self.assertIn("Oil fell 1.22%", reasons[0]["text"])
        self.assertEqual(reasons[0]["confidence"], "Medium")
        # The market rose, so it isn't offered as a reason for a fall.
        self.assertFalse(any("S&P" in r["text"] for r in reasons))

    def test_biggest_company_and_news(self):
        parts = markets.split(1.42, {"market": 1.0}, {"market": 0.2})
        news = [{"title": "Chip orders beat forecasts", "source": "MIT Tech Review", "link": "https://x", "published": "2026-10-12T16:00:00Z"}]
        reasons = markets.rule_reasons("Technology", 1.42, parts, ("NVDA", 3.1), news, "1D", self.labels)
        self.assertEqual([r["title"] for r in reasons], ["NVDA rose", "In the news"])
        # Most of the move is left over, so the headline is Medium, not Low.
        self.assertEqual(reasons[1]["confidence"], "Medium")
        self.assertEqual(reasons[1]["evidence"][0]["link"], "https://x")

    def test_no_clear_reason(self):
        parts = markets.split(-2.0, {"market": 1.0}, {"market": 0.1})
        reasons = markets.rule_reasons("Real estate", -2.0, parts, None, [], "1D", self.labels)
        self.assertEqual(reasons[0]["title"], "No clear reason yet")

    def test_quiet_moves_need_no_reason(self):
        self.assertEqual(markets.rule_reasons("Staples", 0.1, [], None, [], "1D", self.labels), [])

    def test_ai_reasons_are_checked(self):
        clues = [{"kind": "number", "text": "Energy −1.62% (1D)"}, {"kind": "headline", "text": "Yahoo: Crude falls", "link": "https://y", "source": "Yahoo"}]
        owned = {"Energy": [1, 2]}
        raw = {
            "Energy": [
                {"title": "Cheaper oil", "text": "Crude fell as routes reopened.", "cite": [1, 2]},
                {"title": "Made up", "text": "No clues cited.", "cite": []},
                {"title": "Bad cite", "text": "Cites a clue that isn't there.", "cite": [9]},
            ],
            "Unknown sector": [{"title": "x", "text": "y", "cite": [1]}],
        }
        out = markets.clean_reasons(raw, clues, owned)
        self.assertEqual(list(out), ["Energy"])
        self.assertEqual(len(out["Energy"]), 1)
        self.assertEqual(out["Energy"][0]["confidence"], "High")
        self.assertEqual(out["Energy"][0]["evidence"][1], {"kind": "headline", "label": "Yahoo", "link": "https://y"})


class Fetching(unittest.TestCase):
    def setUp(self):
        reset()

    def test_fresh_prices_are_not_fetched_again(self):
        asked = []

        def handler(request):
            asked.append(request.url.params["range"])
            return httpx.Response(200, json=chart([1791552600], [100.0], price=101.0, when=1791831600))

        self.assertEqual(asyncio.run(markets.refresh(["XLK"], mock_client(handler), NOW)), 1)
        self.assertEqual(asyncio.run(markets.refresh(["XLK"], mock_client(handler), NOW + datetime.timedelta(minutes=10))), 0)
        self.assertEqual(asyncio.run(markets.refresh(["XLK"], mock_client(handler), NOW + datetime.timedelta(minutes=25))), 1)
        self.assertEqual(asked, ["1y", "1y"])
        self.assertEqual(markets.load_series(["XLK"])["XLK"], [("2026-10-09", 100.0), ("2026-10-12", 101.0)])
        board = markets.board("US", "1D", NOW)
        self.assertEqual(board["sources"], ["Yahoo"])

    def test_failure_keeps_last_closes_and_shows_in_sources(self):
        store("XLK", [("2026-10-09", 100.0)])
        bad = mock_client(lambda r: httpx.Response(429))
        self.assertEqual(asyncio.run(markets.refresh(["XLK"], bad, NOW)), 0)
        self.assertEqual(markets.load_series(["XLK"])["XLK"], [("2026-10-09", 100.0)])
        source = next(s for s in radar.summary(NOW)["sources"] if s["name"] == "Markets board")
        self.assertFalse(source["ok"])
        self.assertIn("XLK", source["error"])

    def test_open_hours(self):
        self.assertTrue(markets.is_open("US", datetime.datetime(2026, 10, 12, 15, 0, tzinfo=UTC)))
        self.assertFalse(markets.is_open("US", datetime.datetime(2026, 10, 11, 15, 0, tzinfo=UTC)))  # Sunday
        self.assertTrue(markets.is_open("India", datetime.datetime(2026, 10, 12, 5, 0, tzinfo=UTC)))


def fill_us(rng=None):
    """A year of made-up closes for every US symbol, with Energy tied to oil."""
    rng = rng or random.Random(7)
    dates = days(260)
    market = [rng.gauss(0.05, 1) for _ in dates]
    oil = [rng.gauss(0, 2) for _ in dates]
    oil[-1] = -3.0
    market[-1] = 0.5
    for symbol in markets.view_symbols("US"):
        if symbol == "^GSPC":
            rets = market
        elif symbol == "CL=F":
            rets = oil
        elif symbol == "XLE":
            rets = [0.7 * m + 0.8 * o + rng.gauss(0, 0.2) for m, o in zip(market, oil)]
        elif symbol == "XLK":
            rets = [1.2 * m + rng.gauss(0, 0.3) for m in market]
            rets[-1] = 2.5
        else:
            rets = [rng.gauss(0, 1) * 0.5 + m * 0.9 for m in market]
        store(symbol, walk(dates, rets))


class Board(unittest.TestCase):
    def setUp(self):
        reset()
        markets._asked.clear()
        fill_us()

    def test_board_shape(self):
        data = markets.board("US", "1D", NOW)
        self.assertEqual([s["name"] for s in data["sectors"]][:2], ["Technology", "Financials"])
        self.assertEqual(len(data["gauges"]), 8)
        self.assertEqual(data["breadth"]["of"], 34)
        self.assertEqual(data["breadth"]["unit"], "industries")
        self.assertIn("leads", data["headline"])
        self.assertAlmostEqual(sum(s["weight"] for s in data["sectors"]), 100, delta=0.5)
        tech = data["sectors"][0]
        self.assertEqual(len(tech["industries"]), 4)
        self.assertLessEqual(len(tech["closes"]), 30)
        self.assertEqual(data["writer"], "rules")

    def test_energy_move_is_traced_to_oil(self):
        energy = next(s for s in markets.board("US", "1D", NOW)["sectors"] if s["name"] == "Energy")
        oil = next(p for p in energy["why"]["parts"] if p["key"] == "oil")
        self.assertAlmostEqual(oil["beta"], 0.8, delta=0.1)
        self.assertLess(oil["value"], 0)
        self.assertEqual(energy["why"]["reasons"][0]["title"], "Oil moved")

    def test_market_reason_names_the_biggest_contributor(self):
        why = markets.board("US", "1D", NOW)["why"]
        self.assertEqual(why["points"][0]["name"], "Technology")
        self.assertEqual(why["reasons"][0]["title"], "Technology did the most")
        self.assertEqual(why["reasons"][0]["confidence"], "High")
        self.assertNotIn("No clear reason yet", [r["title"] for r in why["reasons"]])

    def test_headlines_are_evidence(self):
        conn = sqlite3.connect(radar.DB_PATH)
        conn.execute(
            "INSERT INTO radar_signals (id, source, title, link, published, seen_at, region, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("n1", "MIT Tech Review", "Chip orders for AI servers beat forecasts", "https://example.com/n1",
             radar._iso(NOW - datetime.timedelta(hours=2)), radar._iso(NOW), "Global", json.dumps(["AI"])),
        )
        conn.commit()
        conn.close()
        tech = markets.board("US", "1D", NOW)["sectors"][0]
        self.assertEqual(tech["why"]["news"][0]["link"], "https://example.com/n1")

    def test_ai_reasons_replace_rules_and_are_rate_limited(self):
        async def fake_complete(engine, prompt, max_tokens):
            self.assertIn("Clues, numbered", prompt)
            first = int(re.search(r"^- Energy: clues (\d+)", prompt, re.M).group(1))
            return json.dumps({"reasons": {"Energy": [{"title": "Cheaper oil", "text": "Oil fell, so energy fell.", "cite": [first]}]}})

        with mock.patch.object(radar_research, "_complete", fake_complete), mock.patch.object(radar_research, "engines", lambda: ["groq"]):
            self.assertTrue(markets.ai_due("US", "1D", NOW))
            payload = asyncio.run(markets.write_reasons("US", "1D", NOW))
        self.assertEqual(payload["engine"], "groq")
        data = markets.board("US", "1D", NOW)
        energy = next(s for s in data["sectors"] if s["name"] == "Energy")
        self.assertEqual(energy["why"]["reasons"][0]["title"], "Cheaper oil")
        self.assertEqual(data["writer"], "groq")
        # Same prices, so no second run.
        self.assertFalse(markets.ai_due("US", "1D", NOW + datetime.timedelta(hours=1)))

    def test_news_stays_in_its_view(self):
        conn = sqlite3.connect(radar.DB_PATH)
        conn.execute(
            "INSERT INTO radar_signals (id, source, title, link, published, seen_at, region, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("n2", "Economic Times", "Infosys lifts guidance; IT stocks rally", "https://example.com/n2",
             radar._iso(NOW - datetime.timedelta(hours=2)), radar._iso(NOW), "India", json.dumps(["AI"])),
        )
        conn.commit()
        conn.close()
        self.assertEqual(markets.board("US", "1D", NOW)["why"]["news"], [])
        self.assertEqual(markets.matching_news(["stocks"], "", "1D", NOW, "India")[0]["link"], "https://example.com/n2")

    def test_no_ai_keeps_rules(self):
        async def broken(engine, prompt, max_tokens):
            raise RuntimeError("offline")

        with mock.patch.object(radar_research, "_complete", broken), mock.patch.object(radar_research, "engines", lambda: ["local"]):
            self.assertIsNone(asyncio.run(markets.write_reasons("US", "1D", NOW)))
        self.assertEqual(markets.board("US", "1D", NOW)["writer"], "rules")
        # A failed try waits its turn instead of running on every page load.
        self.assertFalse(markets.ai_due("US", "1D", NOW + datetime.timedelta(minutes=5)))
        self.assertTrue(markets.ai_due("US", "1D", NOW + datetime.timedelta(minutes=31)))

    def test_route(self):
        with mock.patch.object(markets, "ai_due", lambda *a: False):
            res = client.get("/api/radar/markets", params={"region": "US", "range": "1W"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["range"], "1W")
        self.assertEqual(len(body["sectors"]), 11)

    def test_india_follows_the_setting(self):
        radar.update_settings({"india": False})
        try:
            self.assertNotIn("India", markets.regions())
            self.assertEqual(markets.board("India", "1D", NOW)["region"], "US")
        finally:
            radar.update_settings({"india": True})
        self.assertIn("India", markets.regions())

    def test_empty_board(self):
        reset()
        self.assertIn("Twelve Data key", markets.board("Global", "1D", NOW)["headline"])
        with mock.patch.object(prices, "twelve_key", return_value="k"):
            data = markets.board("Global", "1D", NOW)
        self.assertEqual(data["headline"], "Radar is fetching the first prices. This takes a minute.")
        self.assertEqual(data["why"]["points"], [])

    def test_board_says_when_yahoo_refuses(self):
        reset()
        refused = mock_client(lambda r: httpx.Response(429))
        self.assertEqual(asyncio.run(markets.refresh(["XLK", "XLF"], refused, NOW)), 0)
        with mock.patch.object(prices, "twelve_key", return_value="k"):
            headline = markets.board("US", "1D", NOW)["headline"]
        self.assertIn("Radar can't get prices yet: XLK: Yahoo HTTP 429", headline)


if __name__ == "__main__":
    unittest.main()
