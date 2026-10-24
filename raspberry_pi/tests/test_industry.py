"""Tests for Radar's industry search (industry.py).

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
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "industry.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
os.environ.pop("SAGE_RADAR_FEEDS", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import industry  # noqa: E402
import markets  # noqa: E402
import radar  # noqa: E402
import radar_research as rr  # noqa: E402

client = TestClient(db_server.app)


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


DDG_PAGE = """
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fam">Additive manufacturing market</a>
<a class="result__snippet">The 3D printing market was $24B in 2025.</a></div>
<div class="result"><a class="result__a" href="https://example.org/leaders">3D printing leaders</a>
<a class="result__snippet">Stratasys and 3D Systems lead.</a></div>
"""
ARTICLE = "<html><title>AM</title><body><p>The additive manufacturing market reached $24 billion in 2025 and grows 18% a year.</p></body></html>"
NEWS_FEED = """<?xml version="1.0"?><rss><channel>
<item><title>Indian startup prints rocket engines - Mint</title><link>https://news.example.com/rocket</link><pubDate>Thu, 22 Oct 2026 08:00:00 GMT</pubDate></item>
</channel></rss>"""

ANSWER = {
    "name": "3D printing",
    "oneLiner": "Making parts layer by layer from a digital file.",
    "whatItIs": "Printers build parts from plastic, resin or metal.",
    "howMoney": "Printers, materials and printing services.",
    "outlook": {"stance": "growing", "text": "Factories use it for real parts now."},
    "market": {"sizeUsdB": "$24B", "year": 2025, "cagrPct": 18, "forecastUsdB": 60, "forecastYear": 2020, "source": 1, "note": "Estimates differ."},
    "keyNumbers": [{"label": "Metal share", "value": "30%", "source": 99}, {"label": "", "value": "x"}],
    "segments": [{"name": "Hardware", "sharePct": 60}, {"name": "Materials", "sharePct": 60}],
    "valueChain": [{"layer": "Materials", "players": "BASF", "gap": "Cheap metal powder"}],
    "players": [
        {"name": "Stratasys", "ticker": "ssys", "exchange": "nasdaq", "country": "US", "type": "Listed", "role": "Polymer printers"},
        {"name": "Wipro 3D", "ticker": "", "type": "Private", "country": "India", "role": "Metal printing"},
        {"name": "3D Systems", "ticker": "DDD", "type": "Private", "country": "US", "role": "Printers"},
    ],
    "trends": [{"title": "Metal printing", "text": "Aerospace parts.", "source": 2}],
    "risks": [{"title": "Slow adoption", "text": "Costly per part.", "severity": "huge"}],
    "openings": [{"idea": "Print farm for drone parts", "buyer": "Drone startups", "why": "Small runs"}],
    "india": "India's market is small but growing.",
    "fit": {"score": 12, "why": "You know hardware.", "firstStep": "Call three drone makers."},
    "board": "XLI",
}

PROMPTS = []


async def fake_complete(engine, prompt, max_tokens):
    PROMPTS.append(prompt)
    return "```json\n" + json.dumps(ANSWER) + "\n```"


def handler(request: httpx.Request) -> httpx.Response:
    host = request.url.host
    if "duckduckgo" in host:
        return httpx.Response(200, text=DDG_PAGE)
    if "news.google.com" in host:
        return httpx.Response(200, content=NEWS_FEED.encode())
    if host in ("example.com", "example.org"):
        return httpx.Response(200, text=ARTICLE, headers={"content-type": "text/html"})
    return httpx.Response(404)


def build(query="3D printing", complete=fake_complete):
    async def go():
        brief = {
            "id": "b-" + query, "key": industry.key_of(query), "query": query, "status": "running", "step": 0,
            "steps": [{"name": n, "status": "todo", "detail": "", "seconds": None} for n in industry.STEPS],
            "engine": None, "error": "", "createdAt": iso(radar._utcnow()), "finishedAt": None,
            "news": [], "board": None, "sources": [], "noteId": None,
        }
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            await industry.Builder(brief, http).run()
        industry.save(brief)
        return brief
    with mock.patch.object(rr, "_complete", complete), mock.patch.object(rr, "engines", lambda: ["groq"]):
        return asyncio.run(go())


def seed(now):
    conn = sqlite3.connect(radar.DB_PATH)
    conn.executescript("DELETE FROM radar_signals; DELETE FROM radar_industries;")
    conn.execute(
        "INSERT INTO radar_signals (id, source, title, link, published, seen_at, region, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("s1", "TechCrunch", "3D printing startup raises $40M for metal parts", "https://example.net/s1",
         iso(now - datetime.timedelta(hours=3)), iso(now), "US", json.dumps([])),
    )
    conn.commit()
    conn.close()


class Brief(unittest.TestCase):

    def setUp(self):
        seed(radar._utcnow())
        radar.update_settings({"edge": {k: "" for k in radar.EDGE_KEYS}, "india": True})
        radar.update_settings({"edge": {"skills": "Embedded hardware"}})
        PROMPTS.clear()

    def test_full_brief_is_cleaned(self):
        b = build()
        self.assertEqual(b["status"], "done")
        self.assertEqual(b["engine"], "groq")
        self.assertEqual(b["outlook"]["stance"], "Growing")
        self.assertEqual(b["market"]["sizeUsdB"], 24)
        # A forecast before the size's year is dropped, not drawn backwards.
        self.assertIsNone(b["market"]["forecastUsdB"])
        self.assertEqual(b["market"]["source"], 1)
        self.assertIsNone(b["keyNumbers"][0]["source"])  # 99 isn't a source
        self.assertEqual(len(b["keyNumbers"]), 1)
        self.assertEqual([s["sharePct"] for s in b["segments"]], [50, 50])
        stratasys, wipro, ddd = b["players"]
        self.assertEqual((stratasys["ticker"], stratasys["exchange"]), ("SSYS", "NASDAQ"))
        self.assertEqual(wipro["type"], "Private")
        self.assertEqual(ddd["type"], "Listed")  # a ticker means listed
        self.assertEqual(b["risks"][0]["severity"], "Medium")
        self.assertEqual(b["fit"]["score"], 10)
        self.assertIn("India", b["india"])

    def test_news_mixes_radar_and_the_web(self):
        b = build()
        titles = [n["title"] for n in b["news"]]
        self.assertIn("3D printing startup raises $40M for metal parts", titles)
        self.assertIn("Indian startup prints rocket engines", titles)
        web = next(n for n in b["news"] if n["kind"] == "web")
        self.assertEqual(web["source"], "Mint")
        # Sources keep no page text once the brief is written.
        self.assertTrue(all("text" not in s for s in b["sources"]))
        self.assertIn("example.com", [s["site"] for s in b["sources"]])

    def test_prompt_has_sources_edge_and_board(self):
        build()
        self.assertIn("The additive manufacturing market reached $24 billion", PROMPTS[0])
        self.assertIn("- Skills: Embedded hardware", PROMPTS[0])
        self.assertIn("SOXX (Semiconductors)", PROMPTS[0])
        self.assertIn('"india"', PROMPTS[0])

    def test_board_match_by_name_then_ai_pick(self):
        cands = industry.board_candidates()
        self.assertEqual(industry.match_board("semiconductor equipment", cands)["symbol"], "SOXX")
        self.assertEqual(industry.match_board("Airlines", cands)["symbol"], "JETS")
        self.assertIsNone(industry.match_board("3D printing", cands))
        b = build()
        self.assertEqual(b["board"]["symbol"], "XLI")  # nothing matched by name, so the AI's pick

    def test_board_line_reads_cached_prices(self):
        conn = sqlite3.connect(markets.DB_PATH)
        closes = [[f"2026-10-{d:02d}", 100 + d] for d in range(1, 23)]
        conn.execute("INSERT OR REPLACE INTO market_series (symbol, closes, updated_at) VALUES (?, ?, ?)", ("JETS", json.dumps(closes), "x"))
        conn.commit()
        conn.close()
        line = industry.board_line(industry.match_board("airlines", industry.board_candidates()))
        self.assertEqual(line["changes"]["1D"], round((122 / 121 - 1) * 100, 2))
        self.assertEqual(len(line["closes"]), 22)

    def test_ai_failure_keeps_news(self):
        async def broken(engine, prompt, max_tokens):
            raise rr.AIError("Groq said 503")
        b = build(complete=broken)
        self.assertEqual(b["status"], "partial")
        self.assertIn("503", b["error"])
        self.assertTrue(b["news"])
        self.assertEqual(b["steps"][2]["status"], "failed")

    def test_keys(self):
        self.assertEqual(industry.key_of("3D Printing industry"), industry.key_of(" 3d-printing "))
        self.assertEqual(industry.key_of("The EV battery market"), "ev battery")


class Routes(unittest.TestCase):

    def setUp(self):
        seed(radar._utcnow())

    def test_search_starts_then_reuses_the_saved_brief(self):
        with mock.patch.object(industry, "_run", mock.AsyncMock()):
            first = client.post("/api/radar/industry", json={"query": "3D printing"}).json()["brief"]
            self.assertEqual(first["status"], "queued")
            # While it runs, searching again opens the same one.
            again = client.post("/api/radar/industry", json={"query": "3d printing industry"}).json()["brief"]
            self.assertEqual(again["id"], first["id"])
            done = dict(first, status="done", name="3D printing")
            industry.save(done)
            again = client.post("/api/radar/industry", json={"query": "3D printing"}).json()["brief"]
            self.assertEqual(again["id"], first["id"])
            fresh = client.post("/api/radar/industry", json={"query": "3D printing", "fresh": True}).json()["brief"]
            self.assertNotEqual(fresh["id"], first["id"])
        listing = client.get("/api/radar/industry").json()
        self.assertEqual(len(listing["recent"]), 1)
        self.assertEqual(client.get(f"/api/radar/industry/{first['id']}").json()["brief"]["name"], "3D printing")

    def test_bad_query_and_cap(self):
        self.assertEqual(client.post("/api/radar/industry", json={"query": " a "}).status_code, 400)
        with mock.patch.object(industry, "_run", mock.AsyncMock()), mock.patch.object(industry, "DAILY_CAP", 1):
            self.assertEqual(client.post("/api/radar/industry", json={"query": "Robotics"}).status_code, 200)
            self.assertEqual(client.post("/api/radar/industry", json={"query": "Drones"}).status_code, 429)

    def test_save_to_notes(self):
        b = build()
        res = client.post(f"/api/radar/industry/{b['id']}/note").json()
        note_id = res["brief"]["noteId"]
        conn = sqlite3.connect(db_server.DB_PATH)
        row = conn.execute("SELECT payload FROM entities WHERE table_name = 'notes' AND entity_id = ?", (note_id,)).fetchone()
        conn.close()
        note = json.loads(row[0])
        self.assertEqual(note["title"], "Industry: 3D printing")
        self.assertIn("Stratasys", note["content"])
        self.assertTrue(note["body0"].startswith("~<h1>3D printing</h1>"))
        # Saving again updates the same note.
        again = client.post(f"/api/radar/industry/{b['id']}/note").json()
        self.assertEqual(again["brief"]["noteId"], note_id)
        self.assertEqual(client.post("/api/radar/industry/nope/note").status_code, 404)


if __name__ == "__main__":
    unittest.main()
