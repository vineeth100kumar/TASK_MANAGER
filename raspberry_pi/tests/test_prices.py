"""Where Radar's prices come from, and falling back when a source says no."""
import asyncio
import datetime
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

import prices  # noqa: E402

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 12, 15, 0, tzinfo=UTC)


def client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def twelve_ok(closes):
    return {"status": "ok", "values": [{"datetime": d, "close": str(c)} for d, c in reversed(closes)]}


class Routes(unittest.TestCase):
    def test_each_kind_of_symbol(self):
        self.assertEqual(prices.routes("^GSPC"), [("twelve", "SPY"), ("fred", "SP500"), ("yahoo", "^GSPC")])
        self.assertEqual(prices.routes("XLK"), [("twelve", "XLK"), ("yahoo", "XLK")])
        self.assertEqual(prices.routes("^TNX"), [("fred", "DGS10"), ("yahoo", "^TNX")])
        self.assertEqual(prices.routes("^NSEI"), [("nse", "NIFTY 50"), ("yahoo", "^NSEI")])
        self.assertEqual(prices.routes("INR=X"), [("twelve", "USD/INR"), ("yahoo", "INR=X")])
        self.assertEqual(prices.routes("HDFCBANK.NS"), [("yahoo", "HDFCBANK.NS")])

    def test_every_board_symbol_has_a_source_besides_yahoo(self):
        import markets
        lonely = [s for r in ("US", "India", "Global") for s in markets.view_symbols(r)
                  if len(prices.routes(s)) == 1 and not s.endswith(".NS")]
        self.assertEqual(lonely, [])


class Parsing(unittest.TestCase):
    def test_twelve(self):
        self.assertEqual(prices.parse_twelve(twelve_ok([("2026-10-09", 1.5), ("2026-10-12", 2)])),
                         [("2026-10-09", 1.5), ("2026-10-12", 2.0)])
        with self.assertRaisesRegex(prices.SourceError, "429"):
            prices.parse_twelve({"status": "error", "code": 429, "message": "You have run out of API credits"})

    def test_fred_skips_missing_days(self):
        text = "observation_date,DGS10\n2026-10-08,4.10\n2026-10-09,.\n2026-10-12,4.05\n"
        self.assertEqual(prices.parse_fred(text), [("2026-10-08", 4.1), ("2026-10-12", 4.05)])

    def test_nse_today_and_previous_close(self):
        data = {"timestamp": "12-Oct-2026 15:30", "data": [
            {"index": "NIFTY 50", "last": "25,110.5", "previousClose": 25000},
            {"index": "NIFTY IT", "last": 40000, "previousClose": 40400},
        ]}
        # The 12th is a Monday, so the previous close is Friday's.
        self.assertEqual(prices.parse_nse(data, "NIFTY 50"), [("2026-10-09", 25000.0), ("2026-10-12", 25110.5)])
        with self.assertRaises(prices.SourceError):
            prices.parse_nse(data, "NIFTY AUTO")

    def test_combine(self):
        old = [("2026-10-08", 1.0), ("2026-10-09", 2.0)]
        # A couple of days at the same level are merged in...
        self.assertEqual(prices.combine(old, "yahoo", [("2026-10-09", 2.5), ("2026-10-12", 3.0)], "nse", 300),
                         [("2026-10-08", 1.0), ("2026-10-09", 2.5), ("2026-10-12", 3.0)])
        # ...but a fund's prices never mix with an index's.
        self.assertEqual(prices.combine(old, "yahoo", [("2026-10-12", 600.0)], "twelve", 300), [("2026-10-12", 600.0)])


class Fetching(unittest.TestCase):
    def setUp(self):
        prices.forget()

    def test_falls_back_when_twelve_is_out_of_calls(self):
        def handler(request):
            if request.url.host == "api.twelvedata.com":
                return httpx.Response(200, json={"status": "error", "code": 429, "message": "out of credits"})
            if request.url.host == "fred.stlouisfed.org":
                return httpx.Response(200, text="observation_date,SP500\n2026-10-09,6000\n2026-10-12,6050\n")
            return httpx.Response(500)

        with mock.patch.object(prices, "twelve_key", return_value="k"):
            series, source, name = asyncio.run(prices.fetch(client(handler), "^GSPC"))
        self.assertEqual((source, name), ("fred", "SP500"))
        self.assertEqual(series[-1], ("2026-10-12", 6050.0))

    def test_no_key_skips_twelve_quietly(self):
        seen = []

        def handler(request):
            seen.append(request.url.host)
            return httpx.Response(429)

        with mock.patch.object(prices, "twelve_key", return_value=""):
            with self.assertRaises(prices.SourceError) as caught:
                asyncio.run(prices.fetch(client(handler), "XLK"))
        self.assertNotIn("api.twelvedata.com", seen)
        self.assertEqual(str(caught.exception), "Yahoo HTTP 429")

    def test_yahoo_rests_after_429(self):
        calls = []

        def handler(request):
            calls.append(request.url.host)
            return httpx.Response(429)

        with mock.patch.object(prices, "twelve_key", return_value=""):
            for _ in range(2):
                with self.assertRaises(prices.SourceError):
                    asyncio.run(prices.fetch(client(handler), "XLK"))
        yahoo_calls = [h for h in calls if "yahoo" in h]
        with mock.patch.object(prices, "twelve_key", return_value=""):
            with self.assertRaisesRegex(prices.SourceError, "resting"):
                asyncio.run(prices.fetch(client(handler), "XLK"))
        self.assertEqual(len([h for h in calls if "yahoo" in h]), len(yahoo_calls))

    def test_nse_one_call_for_every_index(self):
        calls = []

        def handler(request):
            calls.append(request.url.path)
            if request.url.path == "/api/allIndices":
                return httpx.Response(200, json={"timestamp": "12-Oct-2026 15:30", "data": [
                    {"index": "NIFTY 50", "last": 25100, "previousClose": 25000},
                    {"index": "NIFTY IT", "last": 40000, "previousClose": 40400}]})
            return httpx.Response(200, text="<html></html>")

        async def both():
            async with client(handler) as c:
                return await asyncio.gather(prices.fetch(c, "^NSEI"), prices.fetch(c, "^CNXIT"))

        (nifty, src1, _), (it, src2, _) = asyncio.run(both())
        self.assertEqual((src1, src2), ("nse", "nse"))
        self.assertEqual(it[-1][1], 40000.0)
        self.assertEqual(calls.count("/api/allIndices"), 1)

    def test_twelve_daily_budget(self):
        prices._twelve.update(day=datetime.datetime.now(UTC).date().isoformat(), used=prices.TWELVE_PER_DAY)
        with self.assertRaisesRegex(prices.SourceError, "used up"):
            asyncio.run(prices._twelve_turn())


class Freshness(unittest.TestCase):
    def test_fresh(self):
        self.assertTrue(prices.fresh("twelve", NOW - datetime.timedelta(minutes=30), NOW, True))
        self.assertFalse(prices.fresh("twelve", NOW - datetime.timedelta(minutes=61), NOW, True))
        self.assertTrue(prices.fresh("twelve", NOW - datetime.timedelta(hours=5), NOW, False))
        self.assertFalse(prices.fresh(None, NOW, NOW, True))


if __name__ == "__main__":
    unittest.main()
