"""Tests for Radar Lab's sparks (sparks.py).

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
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "sparks.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
os.environ.pop("SAGE_RADAR_FEEDS", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import radar  # noqa: E402
import radar_research as rr  # noqa: E402
import sparks  # noqa: E402

client = TestClient(db_server.app)
UTC = datetime.timezone.utc


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def seed_signals(now):
    conn = sqlite3.connect(radar.DB_PATH)
    conn.executescript("DELETE FROM radar_signals; DELETE FROM radar_sparks; DELETE FROM radar_spark_runs;")
    rows = [
        ("a", "Inc42", "Quick-commerce apps add a baby-care aisle", "https://example.com/a", now - datetime.timedelta(hours=2), "India", ["Fintech"]),
        ("b", "TechCrunch", "New EU rules on AI scribes for clinics", "https://example.com/b", now - datetime.timedelta(hours=5), "Europe", ["AI", "Regulation"]),
        ("c", "BBC Business", "Old story from last week", "https://example.com/c", now - datetime.timedelta(days=5), "Europe", []),
    ]
    for sid, source, title, link, published, region, tags in rows:
        conn.execute(
            "INSERT INTO radar_signals (id, source, title, link, published, seen_at, region, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, source, title, link, iso(published), iso(published), region, json.dumps(tags)),
        )
    conn.commit()
    conn.close()


ANSWER = {"sparks": [
    {"clue": 1, "change": "Clinics in Europe must log AI notes.", "idea": "ScribeLog", "pitch": "Audit logs for AI scribes, for small clinics.",
     "buyer": "Clinic owners", "angle": "Compliance helper", "fit": 4, "fitWhy": "Far from your field"},
    {"clue": 2, "change": "Quick-commerce now sells baby care.", "idea": "ShelfKid", "pitch": "Gets small kids' brands listed on quick-commerce apps.",
     "buyer": "D2C kids' brands", "angle": "Sell shovels", "fit": "9", "fitWhy": "You run a kids' brand"},
    {"clue": 2, "change": "Same clue twice", "idea": "Dupe", "pitch": "Should be dropped.", "fit": 10},
    {"clue": 99, "idea": "Nowhere", "pitch": "Bad clue number."},
    {"clue": 2, "idea": "", "pitch": "No name"},
]}

PROMPTS = []


async def fake_complete(engine, prompt, max_tokens):
    PROMPTS.append(prompt)
    return "Sure:\n```json\n" + json.dumps(ANSWER) + "\n```"


def make(now, kind="auto"):
    with mock.patch.object(rr, "_complete", fake_complete), mock.patch.object(rr, "engines", lambda: ["groq"]):
        return asyncio.run(sparks.make(kind, now))


def entities(table):
    conn = sqlite3.connect(db_server.DB_PATH)
    try:
        return [json.loads(r[0]) for r in conn.execute("SELECT payload FROM entities WHERE table_name = ? AND deleted = 0", (table,))]
    finally:
        conn.close()


class Sparks(unittest.TestCase):

    def setUp(self):
        self.now = radar._utcnow()
        seed_signals(self.now)
        radar.update_settings({"edge": {k: "" for k in radar.EDGE_KEYS}, "sparksPerDay": 5, "india": True})
        PROMPTS.clear()

    def test_batch_is_cleaned_and_ranked_by_fit(self):
        made = make(self.now)
        self.assertEqual([s["idea"] for s in made], ["ShelfKid", "ScribeLog"])
        self.assertEqual(made[0]["fit"], 9)
        # Clue 1 is the rules story (Regulation outranks an Indian source), clue 2 the Indian one.
        self.assertEqual(made[0]["clue"]["title"], "Quick-commerce apps add a baby-care aisle")
        self.assertEqual(made[0]["clue"]["label"], "Inc42 · Fintech")
        self.assertEqual(made[1]["clue"]["label"], "TechCrunch · AI · Regulation")
        data = client.get("/api/radar/sparks").json()
        self.assertEqual([s["idea"] for s in data["sparks"]], ["ShelfKid", "ScribeLog"])
        self.assertTrue(data["madeToday"])
        self.assertEqual(data["manualLeft"], sparks.MANUAL_PER_DAY)

    def test_old_headlines_are_not_clues(self):
        clues = sparks.news_clues(self.now)
        self.assertNotIn("Old story from last week", [c["title"] for c in clues])
        # Regulation and India rank ahead of the rest.
        self.assertEqual(len(clues), 2)

    def test_prompt_carries_my_edge(self):
        radar.update_settings({"edge": {"skills": "Embedded hardware, React", "hours": "8", "nonsense": "x"}})
        make(self.now)
        self.assertIn("- Skills: Embedded hardware, React", PROMPTS[0])
        self.assertIn("- Time: 8 hours a week", PROMPTS[0])
        self.assertIn("- Based in: India", PROMPTS[0])
        self.assertNotIn("nonsense", radar.get_settings()["edge"])

    def test_projects_stand_in_for_an_empty_edge(self):
        conn = sqlite3.connect(db_server.DB_PATH)
        conn.execute("INSERT OR REPLACE INTO entities (table_name, entity_id, revision, payload, deleted) VALUES (?, ?, 1, ?, 0)",
                     ("projects", "p1", json.dumps({"id": "p1", "name": "Baby Kolourz"})))
        conn.commit()
        conn.close()
        self.assertIn("- Works on: Baby Kolourz", sparks.edge_lines())
        radar.update_settings({"edge": {"skills": "Hardware"}})
        self.assertFalse(any(l.startswith("- Works on") for l in sparks.edge_lines()))

    def test_keep_saves_a_spark_stage_idea(self):
        spark = make(self.now)[0]
        res = client.post(f"/api/radar/sparks/{spark['id']}/keep").json()
        self.assertEqual(res["spark"]["state"], "kept")
        idea = next(i for i in entities("ideas") if i["id"] == res["spark"]["ideaId"])
        self.assertEqual(idea["stage"], "spark")
        self.assertEqual(idea["name"], "ShelfKid")
        self.assertEqual(idea["fit"], 9)
        self.assertEqual(idea["playbook"], [])
        # Keeping twice doesn't make a second idea.
        client.post(f"/api/radar/sparks/{spark['id']}/keep")
        self.assertEqual(sum(1 for i in entities("ideas") if i.get("sparkId") == spark["id"]), 1)
        listing = client.get("/api/radar/sparks").json()
        self.assertNotIn(spark["id"], [s["id"] for s in listing["sparks"]])
        self.assertIn(spark["id"], [s["id"] for s in listing["kept"]])

    def test_dismissed_sparks_are_avoided_next_time(self):
        spark = make(self.now)[1]
        client.post(f"/api/radar/sparks/{spark['id']}/dismiss", json={"reason": "Not my field"})
        self.assertEqual(sparks.get(spark["id"])["reason"], "Not my field")
        client.post(f"/api/radar/sparks/{spark['id']}/dismiss", json={"reason": "made up"})
        self.assertEqual(sparks.get(spark["id"])["reason"], "")
        client.post(f"/api/radar/sparks/{spark['id']}/dismiss", json={"reason": "Not my field"})
        PROMPTS.clear()
        make(self.now, "manual")
        self.assertIn("ScribeLog (turned down: Not my field)", PROMPTS[0])

    def test_research_starts_a_run(self):
        spark = make(self.now)[0]
        with mock.patch.object(rr, "_run", mock.AsyncMock()):
            res = client.post(f"/api/radar/sparks/{spark['id']}/research").json()
        self.assertTrue(res["job"]["theme"].startswith("ShelfKid: Gets small kids' brands"))
        self.assertEqual(sparks.get(spark["id"])["state"], "researched")

    def test_unknown_spark(self):
        self.assertEqual(client.post("/api/radar/sparks/nope/keep").status_code, 404)

    def test_manual_batches_are_capped(self):
        for _ in range(sparks.MANUAL_PER_DAY):
            with mock.patch.object(rr, "_complete", fake_complete), mock.patch.object(rr, "engines", lambda: ["groq"]):
                self.assertEqual(client.post("/api/radar/sparks/make").status_code, 200)
        self.assertEqual(client.post("/api/radar/sparks/make").status_code, 429)

    def test_no_headlines_no_ai_call(self):
        conn = sqlite3.connect(radar.DB_PATH)
        conn.execute("DELETE FROM radar_signals")
        conn.commit()
        conn.close()
        with self.assertRaises(sparks.NoClues):
            make(self.now)
        self.assertEqual(PROMPTS, [])
        self.assertFalse(client.get("/api/radar/sparks").json()["lastRun"]["ok"])

    def test_sparks_per_day_setting(self):
        self.assertEqual(radar.update_settings({"sparksPerDay": 7})["sparksPerDay"], 5)
        self.assertEqual(radar.update_settings({"sparksPerDay": 3})["sparksPerDay"], 3)
        self.assertEqual(len(make(self.now)), 2)  # only two good ones came back
        self.assertIn("Write 3 sparks", PROMPTS[0])


class Morning(unittest.TestCase):

    def at(self, hour):
        return datetime.datetime(2026, 10, 16, hour, 0, tzinfo=UTC)

    def test_waits_for_seven(self):
        self.assertFalse(sparks.morning_due(self.at(6), [], self.at(6)))
        self.assertTrue(sparks.morning_due(self.at(7), [], self.at(7)))

    def test_once_a_day_and_retries_hourly(self):
        ok = [{"kind": "manual", "ok": 1, "at": iso(self.at(7))}]
        self.assertFalse(sparks.morning_due(self.at(9), ok, self.at(9)))
        failed = [{"kind": "auto", "ok": 0, "at": iso(self.at(7))}]
        self.assertFalse(sparks.morning_due(self.at(7), failed, self.at(7) + datetime.timedelta(minutes=30)))
        self.assertTrue(sparks.morning_due(self.at(8), failed, self.at(8)))
        three = failed * 3
        self.assertFalse(sparks.morning_due(self.at(12), three, self.at(12)))


class FitScore(unittest.TestCase):

    def test_fit_takes_fifteen_points(self):
        idea = {"ratings": {"whyNow": 10, "pain": 10, "money": 10, "fit": 10}, "moat": {k: 10 for k in rr.MOAT_KEYS}, "risks": []}
        total, parts = rr.score(idea)
        self.assertEqual(total, 100)
        self.assertEqual(parts["fit"], 15)
        idea["ratings"]["fit"] = 0
        self.assertEqual(rr.score(idea)[0], 85)

    def test_old_ideas_keep_their_formula(self):
        idea = {"ratings": {"whyNow": 10, "pain": 10, "money": 10}, "moat": {k: 10 for k in rr.MOAT_KEYS}, "risks": []}
        total, parts = rr.score(idea)
        self.assertEqual(total, 100)
        self.assertNotIn("fit", parts)

    def test_clean_idea_keeps_fit_only_when_given(self):
        self.assertNotIn("fit", rr.clean_idea({"ratings": {"whyNow": 3}}, 0)["ratings"])
        self.assertEqual(rr.clean_idea({"ratings": {"fit": "8"}}, 0)["ratings"]["fit"], 8)

    def test_research_prompt_names_the_founder(self):
        prompt = rr.prompt_ideas("theme", {}, [], [], ["- Skills: hardware"])
        self.assertIn("The founder (rate fit for this person):\n- Skills: hardware", prompt)
        self.assertIn('"fit": 0', prompt)
        self.assertNotIn('"fit"', rr.prompt_ideas("theme", {}, [], []))


if __name__ == "__main__":
    unittest.main()
