"""Worker heartbeats and GET /api/health/services."""

import asyncio
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "svc.db")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import system_health  # noqa: E402

client = TestClient(db_server.app)


def status_of(name, now=None):
    return {r["name"]: r for r in system_health.service_rows(now)}[name]


class Rows(unittest.TestCase):
    def setUp(self):
        system_health.workers.clear()
        system_health.beats.clear()

    def test_statuses(self):
        for n in ("quiet", "beating", "late", "done", "died"):
            system_health.worker_started(n)
        system_health.beat(60, name="beating")
        system_health.beat(60, name="late")
        system_health.worker_stopped("done", None)
        system_health.worker_stopped("died", ValueError("boom"))
        later = time.time() + 60 * 2 + 61  # past twice the beat interval plus a minute
        self.assertEqual(status_of("quiet")["status"], "running")      # alive, no heartbeats sent
        self.assertEqual(status_of("beating")["status"], "ok")
        self.assertEqual(status_of("late", later)["status"], "stale")
        self.assertEqual(status_of("done")["status"], "stopped")
        died = status_of("died")
        self.assertEqual(died["status"], "down")
        self.assertIn("boom", died["error"])

    def test_on_time_beat_is_ok_up_to_the_limit(self):
        system_health.worker_started("w")
        system_health.beat(60, name="w")
        at = system_health.beats["w"]["at"]
        self.assertEqual(status_of("w", at + 179)["status"], "ok")
        self.assertEqual(status_of("w", at + 181)["status"], "stale")

    def test_a_restarted_worker_forgets_its_old_beat(self):
        system_health.worker_started("w")
        system_health.beat(5, name="w")
        system_health.worker_started("w")
        self.assertEqual(status_of("w")["status"], "running")

    def test_beat_outside_a_task_never_raises(self):
        system_health.beat(5)  # no running loop, no name
        self.assertEqual(system_health.beats, {})

    def test_beat_finds_its_worker_by_task_name(self):
        async def worker():
            system_health.beat(5)
            await asyncio.sleep(0.05)

        async def main():
            db_server._background(worker())
            await asyncio.sleep(0.02)
            return system_health.service_rows()

        rows = asyncio.run(main())
        mine = [r for r in rows if r["name"].endswith("worker")]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["status"], "ok")

    def test_a_stale_worker_is_a_problem_line(self):
        system_health.worker_started("w")
        system_health.beat(60, name="w")
        system_health.beats["w"]["at"] -= 1000
        data = system_health.report(
            db_server.DB_PATH, web_app=True, auth=True, password_gate=True, radar_enabled=False,
            backups=lambda: {}, phone=lambda: {"available": False}, clock=lambda: {"enabled": False},
        )
        lines = "\n".join(system_health.problems(data))
        self.assertIn("Worker w has not reported", lines)


class Endpoint(unittest.TestCase):
    def setUp(self):
        system_health.workers.clear()
        system_health.beats.clear()

    def test_lists_services_and_the_writer(self):
        system_health.worker_started("ok.worker")
        system_health.beat(60, name="ok.worker")
        body = client.get("/api/health/services").json()
        self.assertTrue(body["success"])
        self.assertTrue(body["ok"])
        self.assertEqual(body["unhealthy"], [])
        self.assertEqual([s["name"] for s in body["services"]], ["ok.worker"])
        self.assertEqual(body["services"][0]["status"], "ok")
        self.assertIn("uptimeMinutes", body)

    def test_a_down_or_stale_worker_makes_it_not_ok(self):
        system_health.worker_started("dead")
        system_health.worker_stopped("dead", RuntimeError("x"))
        system_health.worker_started("stuck")
        system_health.beat(10, name="stuck")
        system_health.beats["stuck"]["at"] -= 3600
        body = client.get("/api/health/services").json()
        self.assertFalse(body["ok"])
        self.assertEqual(sorted(body["unhealthy"]), ["dead", "stuck"])

    def test_needs_the_key_when_one_is_set(self):
        with mock.patch.object(db_server, "API_SECRET", "k"):
            self.assertEqual(client.get("/api/health/services").status_code, 401)
            ok = client.get("/api/health/services", headers={"Authorization": "Bearer k"})
            self.assertEqual(ok.status_code, 200)
            # the plain liveness ping stays open
            self.assertEqual(client.get("/api/health").status_code, 200)


if __name__ == "__main__":
    unittest.main()
