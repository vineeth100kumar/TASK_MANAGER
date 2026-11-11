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
YEAR = radar._utcnow().year


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


WIKI_SEARCH = {"query": {"search": [{"title": "3D printing"}, {"title": "3D printing processes"}]}}
WIKI_PAGE = {"query": {"pages": {"1": {
    "title": "3D printing", "fullurl": "https://en.wikipedia.org/wiki/3D_printing", "description": "Additive process",
    "extract": "3D printing is the construction of a three-dimensional object from a CAD model. It can be done in a variety of processes.\n\nThe term covers many techniques.",
    "pageprops": {"wikibase_item": "Q229367"}, "thumbnail": {"source": "https://upload.wikimedia.org/x.jpg"},
}}}}


def b(**kw):
    return {k: {"value": v} for k, v in kw.items()}


SPARQL = {"results": {"bindings": [
    b(c="http://www.wikidata.org/entity/Q1", cLabel="Stratasys", countryLabel="United States", exLabel="Nasdaq", ticker="ssys", emp="1980", inception="1989-01-01T00:00:00Z", web="https://stratasys.com"),
    b(c="http://www.wikidata.org/entity/Q1", cLabel="Stratasys", countryLabel="Israel", emp="2100"),
    b(c="http://www.wikidata.org/entity/Q2", cLabel="EOS GmbH", countryLabel="Germany", emp="1500"),
    b(c="http://www.wikidata.org/entity/Q3", cLabel="3D Systems", countryLabel="United States", exLabel="New York Stock Exchange", ticker="DDD", emp="1900"),
    b(c="http://www.wikidata.org/entity/Q4", cLabel="Q4"),  # no English label
    b(c="http://www.wikidata.org/entity/Q5", cLabel="Think3D", countryLabel="India"),
]}}
SEC_TICKERS = {"0": {"cik_str": 1517413, "ticker": "SSYS", "title": "Stratasys"}, "1": {"cik_str": 910638, "ticker": "DDD", "title": "3D Systems"}}


def fact(start, end, val, form="10-K", filed=None):
    return {"start": start, "end": end, "val": val, "form": form, "filed": filed or end}


SEC_CONCEPT = {"units": {"USD": [
    fact(f"{YEAR - 3}-01-01", f"{YEAR - 3}-12-31", 600_000_000),
    fact(f"{YEAR - 2}-01-01", f"{YEAR - 2}-12-31", 630_000_000),
    fact(f"{YEAR - 2}-10-01", f"{YEAR - 2}-12-31", 160_000_000),  # a quarter inside the 10-K
    fact(f"{YEAR - 2}-01-01", f"{YEAR - 2}-12-31", 999, form="10-Q"),
]}}
OPENALEX = {"group_by": [{"key": str(YEAR - 1), "count": 9000}, {"key": str(YEAR - 6), "count": 6000}, {"key": str(YEAR), "count": 100}, {"key": "1990", "count": 3}]}
DDG_PAGE = f"""
<div class="result"><a class="result__a" href="https://example.com/am">3D Printing Market Size Report</a>
<a class="result__snippet">The global 3D printing market size was valued at USD 24.8 billion in {YEAR - 1} and is projected to reach USD 68.0 billion by {YEAR + 6}, growing at a CAGR of 18.5%.</a></div>
<div class="result"><a class="result__a" href="https://example.org/am">3D printing market</a>
<a class="result__snippet">The 3D printing market reached $20.4 billion in {YEAR - 1}. Unrelated: our company raised $5 million.</a></div>
"""
ARTICLE = f"<html><title>AM</title><body><p>The 3D printing market will be worth $70 billion by {YEAR + 6}, with a 20% CAGR over the period.</p></body></html>"
NEWS_FEED = """<?xml version="1.0"?><rss><channel>
<item><title>Indian startup prints rocket engines - Mint</title><link>https://news.example.com/rocket</link><pubDate>Thu, 22 Oct 2026 08:00:00 GMT</pubDate></item>
</channel></rss>"""

CALLS = []


def handler(request: httpx.Request) -> httpx.Response:
    host, path = request.url.host, request.url.path
    CALLS.append(host)
    if host == "en.wikipedia.org":
        return httpx.Response(200, json=WIKI_SEARCH if request.url.params.get("list") == "search" else WIKI_PAGE)
    if host == "query.wikidata.org":
        assert "wd:Q229367" in request.url.params["query"]
        return httpx.Response(200, json=SPARQL)
    if host == "www.sec.gov":
        return httpx.Response(200, json=SEC_TICKERS)
    if host == "data.sec.gov":
        if "Revenues" in path and "RevenueFromContract" not in path and "CIK0001517413" in path:
            return httpx.Response(200, json=SEC_CONCEPT)
        return httpx.Response(404)
    if host == "api.openalex.org":
        return httpx.Response(200, json=OPENALEX)
    if "duckduckgo" in host:
        return httpx.Response(200, text=DDG_PAGE)
    if "news.google.com" in host:
        return httpx.Response(200, content=NEWS_FEED.encode())
    if host in ("example.com", "example.org"):
        return httpx.Response(200, text=ARTICLE, headers={"content-type": "text/html"})
    return httpx.Response(404)


def new_brief(query):
    return {
        "id": "b-" + query, "version": industry.VERSION, "key": industry.key_of(query), "query": query, "status": "running", "step": 0,
        "steps": [{"name": n, "status": "todo", "detail": "", "seconds": None} for n in industry.STEPS],
        "error": "", "createdAt": iso(radar._utcnow()), "finishedAt": None, "name": "", "oneLiner": "", "wiki": None, "companies": [],
        "research": None, "figures": [], "market": None, "news": [], "board": None, "sources": [], "ai": None, "aiStatus": "", "aiError": "",
        "engine": None, "noteId": None,
    }


def build(query="3D printing", transport_handler=handler):
    async def go():
        brief = new_brief(query)
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport_handler)) as http:
            await industry.Builder(brief, http).run()
        industry.save(brief)
        return brief
    return asyncio.run(go())


def seed(now):
    conn = sqlite3.connect(radar.DB_PATH)
    conn.executescript("DELETE FROM radar_signals; DELETE FROM radar_industries; DELETE FROM radar_industry_cache; DELETE FROM radar_industry_ai;")
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
        radar.update_settings({"india": True})
        CALLS.clear()

    def test_no_ai_is_called(self):
        with mock.patch.object(rr, "_complete", side_effect=AssertionError("AI called")):
            b = build()
        self.assertEqual(b["status"], "done", b["error"])
        self.assertIsNone(b["ai"])

    def test_wikipedia_gives_name_and_intro(self):
        b = build()
        self.assertEqual(b["name"], "3D printing")
        self.assertEqual(b["oneLiner"], "3D printing is the construction of a three-dimensional object from a CAD model.")
        self.assertEqual(b["wiki"]["qid"], "Q229367")
        self.assertEqual(b["wiki"]["url"], "https://en.wikipedia.org/wiki/3D_printing")

    def test_wikidata_companies_merged_and_ranked(self):
        b = build()
        names = [c["name"] for c in b["companies"]]
        self.assertEqual(names, ["Stratasys", "3D Systems", "EOS GmbH", "Think3D"])  # listed first, then employees
        s = b["companies"][0]
        self.assertEqual((s["ticker"], s["exchange"], s["employees"], s["founded"], s["country"]), ("SSYS", "Nasdaq", 2100, 1989, "United States"))

    def test_sec_revenue_from_10k_only(self):
        b = build()
        s = b["companies"][0]
        self.assertEqual(s["revenueUsd"], 630_000_000)
        self.assertEqual(s["revenueYear"], YEAR - 2)
        self.assertEqual(s["revenueGrowthPct"], 5.0)
        self.assertNotIn("revenueUsd", b["companies"][1])  # DDD: no revenue concept found
        # The ticker list is cached for a week.
        CALLS.clear()
        build()
        self.assertNotIn("www.sec.gov", CALLS)

    def test_openalex_counts(self):
        r = build()["research"]
        self.assertEqual(len(r["years"]), 10)
        self.assertEqual(r["lastYear"], 9000)
        self.assertEqual(r["growth5yPct"], 50)
        self.assertNotIn(YEAR, [y["year"] for y in r["years"]])  # this year isn't over

    def test_market_figures_keep_their_source(self):
        b = build()
        sizes = sorted((f["usdB"], f["site"]) for f in b["figures"] if f["kind"] == "size")
        self.assertEqual(sizes, [(20.4, "example.org"), (24.8, "example.com")])
        forecasts = sorted(f["usdB"] for f in b["figures"] if f["kind"] == "forecast")
        self.assertEqual(forecasts, [68.0, 70.0, 70.0])  # both pages carry the article
        self.assertNotIn(0.005, [f.get("usdB") for f in b["figures"]])  # "$5 million" doesn't name the market
        m = b["market"]
        self.assertEqual((m["sizeUsdB"], m["sizeYear"], m["sizeSites"]), (22.6, YEAR - 1, 2))
        self.assertEqual((m["forecastUsdB"], m["forecastYear"], m["forecastSites"]), (70.0, YEAR + 6, 2))
        self.assertEqual((m["cagrPct"], m["cagrSites"]), (20.0, 2))
        self.assertIn("example.com", [s["site"] for s in b["sources"]])

    def test_amounts_and_units(self):
        figs = industry.market_figures([{"url": "https://x.com/a", "snippet": "The drone market hit US$1,250 million in 2024. Drone market: $1.2 trillion by 2040."}], "drones", 2026)
        self.assertEqual([(f["usdB"], f["year"], f["kind"]) for f in figs], [(1.25, 2024, "size"), (1200.0, 2040, "forecast")])

    def test_news_mixes_radar_and_the_web(self):
        b = build()
        titles = [n["title"] for n in b["news"]]
        self.assertIn("3D printing startup raises $40M for metal parts", titles)
        self.assertIn("Indian startup prints rocket engines", titles)

    def test_one_source_down_keeps_the_rest(self):
        def no_wikidata(request):
            if request.url.host == "query.wikidata.org":
                return httpx.Response(503)
            return handler(request)
        b = build(transport_handler=no_wikidata)
        self.assertEqual(b["status"], "partial")
        self.assertIn("Wikidata failed", b["error"])
        self.assertEqual(b["name"], "3D printing")
        self.assertTrue(b["market"])

    def test_nothing_found(self):
        b = build(transport_handler=lambda r: httpx.Response(404))
        self.assertIn(b["status"], ("partial", "failed"))
        self.assertTrue(b["news"])  # Radar's own headline still matched

    def test_board_match(self):
        cands = industry.board_candidates()
        self.assertEqual(industry.match_board("semiconductor equipment", cands)["symbol"], "SOXX")
        self.assertEqual(industry.match_board("Airlines", cands)["symbol"], "JETS")
        self.assertIsNone(industry.match_board("3D printing", cands))

    def test_board_line_reads_cached_prices(self):
        conn = sqlite3.connect(markets.DB_PATH)
        closes = [[f"2026-10-{d:02d}", 100 + d] for d in range(1, 23)]
        conn.execute("INSERT OR REPLACE INTO market_series (symbol, closes, updated_at) VALUES (?, ?, ?)", ("JETS", json.dumps(closes), "x"))
        conn.commit()
        conn.close()
        line = industry.board_line(industry.match_board("airlines", industry.board_candidates()))
        self.assertEqual(line["changes"]["1D"], round((122 / 121 - 1) * 100, 2))

    def test_keys(self):
        self.assertEqual(industry.key_of("3D Printing industry"), industry.key_of(" 3d-printing "))


AI_ANSWER = {
    "trends": [{"title": "Metal parts", "text": "Aerospace prints parts.", "news": 1}, {"title": "", "text": "dropped"}],
    "risks": [{"title": "Slow adoption", "text": "Costly.", "severity": "huge"}],
    "openings": [{"idea": "Drone part farm", "buyer": "Drone startups", "why": "Small runs"}],
    "india": "Small but growing.",
    "fit": {"score": 12, "why": "Hardware skills.", "firstStep": "Call three drone makers."},
}


class Routes(unittest.TestCase):

    def setUp(self):
        seed(radar._utcnow())
        radar.update_settings({"edge": {"skills": "Embedded hardware"}})

    def test_search_reuses_the_saved_brief(self):
        with mock.patch.object(industry, "_run", mock.AsyncMock()):
            first = client.post("/api/radar/industry", json={"query": "3D printing"}).json()["brief"]
            self.assertEqual(first["status"], "queued")
            again = client.post("/api/radar/industry", json={"query": "3d printing industry"}).json()["brief"]
            self.assertEqual(again["id"], first["id"])
            industry.save(dict(first, status="done", name="3D printing"))
            self.assertEqual(client.post("/api/radar/industry", json={"query": "3D printing"}).json()["brief"]["id"], first["id"])
            fresh = client.post("/api/radar/industry", json={"query": "3D printing", "fresh": True}).json()["brief"]
            self.assertNotEqual(fresh["id"], first["id"])
            # A brief from the old AI-written version is made again.
            industry.save(dict(fresh, status="done", version=1, key="drones", id="old"))
            self.assertNotEqual(client.post("/api/radar/industry", json={"query": "Drones"}).json()["brief"]["id"], "old")
        self.assertEqual(len(client.get("/api/radar/industry").json()["recent"]), 2)

    def test_bad_query_and_cap(self):
        self.assertEqual(client.post("/api/radar/industry", json={"query": " a "}).status_code, 400)
        with mock.patch.object(industry, "_run", mock.AsyncMock()), mock.patch.object(industry, "DAILY_CAP", 1):
            self.assertEqual(client.post("/api/radar/industry", json={"query": "Robotics"}).status_code, 200)
            self.assertEqual(client.post("/api/radar/industry", json={"query": "Drones"}).status_code, 429)

    def test_ask_ai_only_on_request(self):
        brief = build()
        prompts = []

        async def fake(engine, prompt, max_tokens):
            prompts.append(prompt)
            return json.dumps(AI_ANSWER)

        with mock.patch.object(rr, "_complete", fake), mock.patch.object(rr, "engines", lambda: ["groq"]):
            res = client.post(f"/api/radar/industry/{brief['id']}/ai")
            self.assertEqual(res.status_code, 200)
            asyncio.run(industry.write_ai(industry.get(brief["id"])))
        done = industry.get(brief["id"])
        self.assertEqual(done["aiStatus"], "done")
        self.assertEqual([t["title"] for t in done["ai"]["trends"]], ["Metal parts"])
        self.assertEqual(done["ai"]["risks"][0]["severity"], "Medium")
        self.assertEqual(done["ai"]["fit"]["score"], 10)
        self.assertIn("Stratasys (SSYS)", prompts[0])
        self.assertIn("- Skills: Embedded hardware", prompts[0])

    def test_ai_cap(self):
        brief = build()
        with mock.patch.object(industry, "write_ai", mock.AsyncMock()), mock.patch.object(industry, "AI_PER_DAY", 1):
            self.assertEqual(client.post(f"/api/radar/industry/{brief['id']}/ai").status_code, 200)
            industry.save(dict(industry.get(brief["id"]), aiStatus="done"))
            self.assertEqual(client.post(f"/api/radar/industry/{brief['id']}/ai").status_code, 429)
        self.assertEqual(client.post("/api/radar/industry/nope/ai").status_code, 404)

    def test_save_to_notes(self):
        b = build()
        note_id = client.post(f"/api/radar/industry/{b['id']}/note").json()["brief"]["noteId"]
        conn = sqlite3.connect(db_server.DB_PATH)
        row = conn.execute("SELECT payload FROM entities WHERE table_name = 'notes' AND entity_id = ?", (note_id,)).fetchone()
        conn.close()
        note = json.loads(row[0])
        self.assertEqual(note["title"], "Industry: 3D printing")
        self.assertIn("Stratasys", note["content"])
        self.assertIn("revenue $630M", note["content"])
        self.assertEqual(client.post(f"/api/radar/industry/{b['id']}/note").json()["brief"]["noteId"], note_id)
        self.assertEqual(client.post("/api/radar/industry/nope/note").status_code, 404)


if __name__ == "__main__":
    unittest.main()
