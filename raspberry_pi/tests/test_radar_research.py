"""Tests for Radar's research pipeline (radar_research.py).

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "research.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import radar  # noqa: E402
import radar_research as rr  # noqa: E402

client = TestClient(db_server.app)

DDG_PAGE = """
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpayroll&amp;rut=x">Payroll in <b>Vietnam</b></a>
  <a class="result__snippet" href="#">EOR fees run 8&ndash;15% per head.</a>
</div>
<div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
<div class="result"><a class="result__a" href="https://example.org/fx">FX rules</a></div>
"""

ARTICLE = """<html><head><title>Payroll</title><script>var x = 1;</script></head><body>
<nav><p>Menu menu menu menu menu menu menu menu menu menu</p></nav>
<p>Western startups now hire a third of new engineers in Vietnam and Indonesia, per a 2026 survey.</p>
<footer><p>Copyright footer text that is long enough to be kept otherwise</p></footer></body></html>"""

HN = {"hits": [
    {"objectID": "1", "comment_text": "Paying contractors in Indonesia is a nightmare, we do it manually in spreadsheets.", "story_title": "Ask HN: payroll"},
    {"objectID": "2", "comment_text": "Works fine for us.", "story_title": "Show HN"},
]}

ANSWERS = {
    "queries": {"queries": ["sea contractor payroll", "vietnam fx rules 2026", "eor pricing", "indonesia e-invoicing", "payroll startups asia"]},
    "macro": {
        "summary": "Paying SEA contractors is broken.", "macro": "A third of new hires are in SEA.",
        "whyNow": "Indonesia's e-invoicing mandate starts in Q1 2027.",
        "valueChain": [{"layer": "EOR", "players": "Deel", "gap": "8-15% fees"}],
        "claims": [{"text": "EOR fees run 8-15% per head", "source": 1}, {"text": "bad ref", "source": 99}],
    },
    "ideas": {"ideas": [
        {"name": "PayBridge SEA", "oneLiner": "One invoice, six countries.", "icp": "Seed-stage CTOs", "pain": "Manual payouts",
         "whyNow": "E-invoicing", "sources": [1, 2], "tags": ["Fintech", "Nope"],
         "economics": {"acvUsd": "$18k", "grossMarginPct": 71, "paybackMonths": 7, "salesCycleWeeks": 4},
         "moat": {"network": 4, "switching": 8, "data": 6, "cost": 5, "regulatory": 7},
         "ratings": {"whyNow": 9, "pain": 9, "money": 8},
         "playbook": [{"name": "Discovery", "weeks": [1, 2], "steps": ["Interview 10 CTOs", "Map fees"]},
                      {"name": "MVP", "weeks": [3, 6], "steps": ["Build payout flow"]}]},
        {"name": "FxGuard", "oneLiner": "FX alerts.", "icp": "CFOs", "pain": "Surprise FX", "whyNow": "New rules",
         "economics": {"acvUsd": 4000, "grossMarginPct": 85, "paybackMonths": 3, "salesCycleWeeks": 2},
         "moat": {"network": 1, "switching": 2, "data": 3, "cost": 2, "regulatory": 1},
         "ratings": {"whyNow": 5, "pain": 4, "money": 3}, "playbook": []},
    ]},
    "reviews": {"reviews": [
        {"idea": "FxGuard", "risks": [{"kind": "Incumbent", "detail": "Banks do this", "severity": "high", "mitigation": "Niche"}]},
        {"idea": "PayBridge SEA", "risks": [{"kind": "Distribution", "detail": "Founders have an EOR", "severity": "High", "mitigation": "Accountants"},
                                             {"kind": "Regulatory", "detail": "FX rules", "severity": "Low", "mitigation": "Partner bank"}]},
    ]},
}


async def fake_complete(engine, prompt, max_tokens):
    for key in ("reviews", "ideas", "macro", "queries"):
        if f'{{"{key}"' in prompt or f'"{key}":' in prompt:
            return "<think>hmm</think>Here you go:\n```json\n" + json.dumps(ANSWERS[key]) + "\n```"
    raise AssertionError("unexpected prompt")


def handler(request: httpx.Request) -> httpx.Response:
    host = request.url.host
    if "duckduckgo" in host:
        return httpx.Response(200, text=DDG_PAGE)
    if "algolia" in host:
        return httpx.Response(200, json=HN)
    if host in ("example.com", "example.org"):
        return httpx.Response(200, text=ARTICLE, headers={"content-type": "text/html; charset=utf-8"})
    return httpx.Response(404)


def entities(table):
    conn = sqlite3.connect(db_server.DB_PATH)
    try:
        return [json.loads(r[0]) for r in conn.execute("SELECT payload FROM entities WHERE table_name = ? AND deleted = 0", (table,))]
    finally:
        conn.close()


def run_job(theme="Cross-border payroll for contractors in Vietnam"):
    async def go():
        job = {
            "id": "job-" + theme[:5], "theme": theme, "depth": "brief", "status": "running", "step": 0,
            "steps": [{"name": n, "status": "todo", "detail": "", "seconds": None} for n in rr.STEPS],
            "engine": None, "error": "", "ideaIds": [], "noteId": None, "createdAt": rr._utc(), "finishedAt": None,
        }
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            await rr.Pipeline(job, http).run()
        return job
    with mock.patch.object(rr, "_complete", fake_complete), mock.patch.object(rr, "engines", lambda: ["groq"]):
        return asyncio.run(go())


class Parsers(unittest.TestCase):
    def test_duckduckgo(self):
        results = rr.parse_duckduckgo(DDG_PAGE)
        self.assertEqual([r["url"] for r in results], ["https://example.com/payroll", "https://example.org/fx"])
        self.assertEqual(results[0]["title"], "Payroll in Vietnam")
        self.assertEqual(results[0]["snippet"], "EOR fees run 8–15% per head.")

    def test_page_text_skips_menus_and_scripts(self):
        title, text = rr.page_text(ARTICLE)
        self.assertEqual(title, "Payroll")
        self.assertIn("a third of new engineers", text)
        self.assertNotIn("Menu", text)
        self.assertNotIn("Copyright", text)

    def test_json_from_chatter(self):
        self.assertEqual(rr.parse_json('<think>{"x": 1}</think> ok {"queries": ["a"]} done', "queries"), {"queries": ["a"]})
        self.assertIsNone(rr.parse_json("no json here", "queries"))


class Scoring(unittest.TestCase):
    def test_clean_and_score(self):
        idea = rr.clean_idea(ANSWERS["ideas"]["ideas"][0], source_count=3)
        self.assertEqual(idea["acvUsd"], 18000)
        self.assertEqual(idea["tags"], ["Fintech"])
        self.assertEqual(idea["sources"], [1, 2])
        self.assertEqual(idea["playbook"][1], {"name": "MVP", "startWeek": 3, "endWeek": 6, "steps": ["Build payout flow"]})
        idea["risks"] = rr.clean_risks(ANSWERS["reviews"]["reviews"][1]["risks"])
        total, parts = rr.score(idea)
        # 9*2.5 + 9*2 + 8*2 + 6*2 + (15 - 3) = 80.5
        self.assertEqual(parts, {"whyNow": 22.5, "pain": 18.0, "money": 16.0, "moat": 12.0, "safety": 12})
        self.assertEqual(total, 80)

    def test_numbers_are_clamped(self):
        idea = rr.clean_idea({"economics": {"grossMarginPct": 400}, "moat": {"data": 99}, "ratings": {"pain": -3}}, 0)
        self.assertEqual(idea["grossMarginPct"], 100)
        self.assertEqual(idea["moat"]["data"], 10)
        self.assertEqual(idea["ratings"]["pain"], 0)


class EndToEnd(unittest.TestCase):
    def test_a_run_writes_dossier_ideas_and_note(self):
        job = run_job()
        self.assertEqual(job["status"], "done", job["error"])
        self.assertTrue(all(s["status"] == "done" for s in job["steps"]))
        self.assertIn("pages read", job["steps"][1]["detail"])
        self.assertEqual(job["steps"][2]["detail"], "1 complaint on Hacker News")

        dossier = next(d for d in entities("dossiers") if d["id"] == job["id"])
        self.assertEqual(dossier["status"], "done")
        self.assertEqual(dossier["engine"], "groq")
        self.assertEqual(dossier["claims"][0]["source"], 1)
        self.assertIsNone(dossier["claims"][1]["source"])  # source 99 doesn't exist
        self.assertTrue(any(s["kind"] == "hn" for s in dossier["sources"]))

        ideas = [i for i in entities("ideas") if i["dossierId"] == job["id"]]
        self.assertEqual([i["name"] for i in sorted(ideas, key=lambda i: -i["score"])], ["PayBridge SEA", "FxGuard"])
        pay = next(i for i in ideas if i["name"] == "PayBridge SEA")
        self.assertEqual(len(pay["risks"]), 2)
        self.assertIsNone(pay["projectId"])
        self.assertEqual(sorted(dossier["ideaIds"]), sorted(i["id"] for i in ideas))

        note = next(n for n in entities("notes") if n["id"] == dossier["noteId"])
        self.assertEqual(note["title"], f"Radar: {job['theme']}")
        self.assertTrue(note["body0"].startswith("~<h1>"))
        self.assertIn("PayBridge SEA (", note["content"])

    def test_no_sources_fails_cleanly(self):
        def empty(request):
            return httpx.Response(503)

        async def go():
            job = {"id": "empty", "theme": "zzzz qqqq", "depth": "brief", "status": "running", "step": 0,
                   "steps": [{"name": n, "status": "todo", "detail": "", "seconds": None} for n in rr.STEPS],
                   "engine": None, "error": "", "ideaIds": [], "noteId": None, "createdAt": rr._utc(), "finishedAt": None}
            async with httpx.AsyncClient(transport=httpx.MockTransport(empty)) as http:
                await rr.Pipeline(job, http).run()
            return job
        with mock.patch.object(rr, "_complete", fake_complete), mock.patch.object(rr, "engines", lambda: ["groq"]):
            job = asyncio.run(go())
        self.assertEqual(job["status"], "failed")
        self.assertIn("No sources", job["error"])
        self.assertFalse(any(d["id"] == "empty" for d in entities("dossiers")))

    def test_bad_json_twice_moves_to_next_engine(self):
        calls = []

        async def flaky(engine, prompt, max_tokens):
            calls.append(engine)
            if engine == "groq":
                return "Sorry, I can't format that."
            return json.dumps(ANSWERS["queries"])

        with mock.patch.object(rr, "_complete", flaky), mock.patch.object(rr, "engines", lambda: ["groq", "claude"]):
            job = {"engine": None}
            data, _ = asyncio.run(rr.ask_json(job, "x", "queries"))
        # Groq answers twice without JSON, so Claude gets asked.
        self.assertEqual(calls, ["groq", "groq", "claude"])
        self.assertEqual(data, ANSWERS["queries"])
        self.assertEqual(job["engine"], "claude")

        async def broken(engine, prompt, max_tokens):
            if engine == "groq":
                raise rr.AIError("Groq said 429")
            return json.dumps(ANSWERS["queries"])

        with mock.patch.object(rr, "_complete", broken), mock.patch.object(rr, "engines", lambda: ["groq", "claude"]):
            job = {"engine": None}
            data, _ = asyncio.run(rr.ask_json(job, "x", "queries"))
        self.assertEqual(data, ANSWERS["queries"])
        self.assertEqual(job["engine"], "claude")


class Routes(unittest.TestCase):
    def setUp(self):
        conn = sqlite3.connect(db_server.DB_PATH)
        conn.execute("DELETE FROM radar_jobs")
        conn.commit()
        conn.close()

    def test_daily_cap(self):
        radar.update_settings({"dailyCap": 1})
        try:
            with mock.patch.object(rr, "_run", mock.AsyncMock()):
                first = client.post("/api/radar/research", json={"theme": "Grid batteries in Texas"})
                self.assertEqual(first.status_code, 200, first.text)
                second = client.post("/api/radar/research", json={"theme": "Grid batteries in Texas"})
            self.assertEqual(second.status_code, 429)
            self.assertTrue(second.json()["limit"])
            listing = client.get("/api/radar/research").json()
            self.assertEqual(listing["runsToday"], 1)
            self.assertEqual(listing["jobs"][0]["theme"], "Grid batteries in Texas")
            job_id = first.json()["job"]["id"]
            self.assertEqual(client.get(f"/api/radar/research/{job_id}").json()["job"]["status"], "queued")
        finally:
            radar.update_settings({"dailyCap": 5})

    def test_short_theme_is_refused(self):
        self.assertEqual(client.post("/api/radar/research", json={"theme": " a "}).status_code, 400)

    def test_settings(self):
        data = client.put("/api/radar/settings", json={"brief": True, "engine": "nonsense", "dailyCap": 500}).json()["settings"]
        self.assertTrue(data["brief"])
        self.assertEqual(data["engine"], "groq")
        self.assertEqual(data["dailyCap"], 50)
        radar.update_settings({"brief": False, "dailyCap": 5})

    def test_restart_marks_running_jobs_failed(self):
        rr._save_job({"id": "stuck", "createdAt": rr._utc(), "status": "running"})
        rr.connect(db_server.DB_PATH, rr._apply, rr._broadcast, rr._now_local)
        self.assertEqual(rr.get_job("stuck")["status"], "failed")

    def test_dossiers_and_ideas_sync(self):
        self.assertIn("dossiers", db_server.SYNC_TABLES)
        self.assertIn("ideas", db_server.SYNC_TABLES)


if __name__ == "__main__":
    unittest.main()
