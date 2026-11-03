"""The blackout diagnostics probe (diagnostics.py).

    cd raspberry_pi && python -m unittest tests.test_diagnostics
"""

import datetime
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import diagnostics  # noqa: E402

UTC = datetime.timezone.utc


def _at(seconds_ago: float) -> str:
    return diagnostics._iso(time.time() - seconds_ago)


def sample(seconds_ago=0, public_ok=True, local_ok=True, uv=False, lag=0.0, slowest_ms=0, slowest_path=""):
    pub = {"ok": public_ok, "ms": 50} if public_ok else {"ok": False, "ms": 10000, "error": "ReadTimeout: timed out"}
    loc = {"ok": local_ok, "ms": 2} if local_ok else {"ok": False, "ms": 9000, "error": "ConnectError"}
    return {
        "t": _at(seconds_ago),
        "loopLagMs": lag,
        "requests": {"inflight": 0, "peakInflight": 1, "started": 3, "slowestMs": slowest_ms, "slowestPath": slowest_path, "errors": 0},
        "localProbe": loc,
        "publicProbe": pub,
        "throttled": {"underVoltageNow": uv, "underVoltageEver": uv, "flags": ["under-voltage now"] if uv else []},
        "load": [0.1, 0.1, 0.1], "memory": {"freeMb": 3000}, "iowaitPct": 2.0, "tempC": 46.0,
        "network": {"iface": "wlan0", "up": True, "kind": "wifi", "rssiDbm": -55},
        "tailscale": {"ok": True, "backendState": "Running"}, "journal": {"ok": True, "counts": {}},
    }


class Fresh(unittest.TestCase):
    def setUp(self):
        diagnostics.store = diagnostics._Store()
        diagnostics.live = diagnostics._Live()


class LiveTracking(Fresh):
    def test_inflight_peak_and_slowest(self):
        diagnostics.request_begin()
        diagnostics.request_begin()
        self.assertEqual(diagnostics.live.inflight, 2)
        diagnostics.request_end("/api/posts", 1200, 200)
        diagnostics.request_end("/api/sync/all", 300, 200)
        taken = diagnostics.live.take()
        self.assertEqual(taken["peakInflight"], 2)
        self.assertEqual(taken["started"], 2)
        self.assertEqual(taken["slowestMs"], 1200)
        self.assertEqual(taken["slowestPath"], "/api/posts")
        # take() resets the window but keeps the live count (both ended -> 0).
        self.assertEqual(diagnostics.live.take()["started"], 0)

    def test_errors_counted(self):
        diagnostics.request_begin()
        diagnostics.request_end("/api/x", 5, 500)
        self.assertEqual(diagnostics.live.take()["errors"], 1)


class Throttled(Fresh):
    def test_decodes_under_voltage_bits(self):
        proc = mock.Mock(stdout="throttled=0x50005\n")
        with mock.patch.object(diagnostics.subprocess, "run", return_value=proc):
            out = diagnostics._throttled()
        self.assertEqual(out["hex"], "0x50005")
        self.assertTrue(out["underVoltageNow"])
        self.assertTrue(out["underVoltageEver"])
        self.assertIn("under-voltage now", out["flags"])

    def test_clean_is_empty(self):
        proc = mock.Mock(stdout="throttled=0x0\n")
        with mock.patch.object(diagnostics.subprocess, "run", return_value=proc):
            out = diagnostics._throttled()
        self.assertFalse(out["underVoltageNow"])
        self.assertEqual(out["flags"], [])

    def test_missing_vcgencmd_is_none(self):
        with mock.patch.object(diagnostics.subprocess, "run", side_effect=FileNotFoundError):
            self.assertIsNone(diagnostics._throttled())


class Episodes(Fresh):
    def test_network_blackout_classified_as_funnel(self):
        # Public down for three ticks while localhost keeps answering.
        for s in (30, 20, 10):
            diagnostics._note_episode(True, sample(seconds_ago=s, public_ok=False, local_ok=True))
        self.assertIsNotNone(diagnostics.store.open_episode)
        diagnostics._note_episode(False, sample(seconds_ago=0, public_ok=True, local_ok=True))
        self.assertIsNone(diagnostics.store.open_episode)
        self.assertEqual(len(diagnostics.store.episodes), 1)
        ep = diagnostics.store.episodes[0]
        self.assertIn("network/Funnel", ep["cause"])
        self.assertGreater(ep["durationSeconds"], 0)

    def test_server_down_classified_as_host(self):
        diagnostics._note_episode(True, sample(seconds_ago=20, public_ok=False, local_ok=False))
        diagnostics._note_episode(False, sample(seconds_ago=0, public_ok=True, local_ok=True))
        self.assertIn("server/host", diagnostics.store.episodes[0]["cause"])

    def test_under_voltage_wins_the_classification(self):
        diagnostics._note_episode(True, sample(seconds_ago=20, public_ok=False, local_ok=False, uv=True))
        diagnostics._note_episode(False, sample(seconds_ago=0))
        self.assertIn("power", diagnostics.store.episodes[0]["cause"])


class Summary(Fresh):
    def test_counts_and_verdict_for_funnel_outage(self):
        for s in (120, 90, 60, 30, 10):
            diagnostics.store.add(sample(seconds_ago=s, public_ok=(s not in (120, 90)), local_ok=True))
        # one closed episode: public failed at 120 and 90, recovered at 60
        diagnostics.store.episodes.append({
            "startedAt": _at(120), "endedAt": _at(60), "durationSeconds": 60,
            "localOkThroughout": True, "localFailSeen": False, "underVoltageSeen": False,
            "cause": "network/Funnel path (...)",
        })
        out = diagnostics.summary(24)
        self.assertEqual(out["blackouts"]["count"], 1)
        self.assertEqual(out["counts"]["publicProbeFailures"], 2)
        self.assertEqual(out["counts"]["localProbeFailures"], 0)
        self.assertIn("path to the Pi", out["verdict"])
        self.assertIsNotNone(out["now"])

    def test_no_blackouts_reads_clean(self):
        for s in (90, 60, 30):
            diagnostics.store.add(sample(seconds_ago=s))
        out = diagnostics.summary(24)
        self.assertEqual(out["blackouts"]["count"], 0)
        self.assertIn("No blackouts", out["verdict"])

    def test_ongoing_episode_shows_in_summary(self):
        diagnostics._note_episode(True, sample(seconds_ago=20, public_ok=False, local_ok=True))
        diagnostics.store.add(sample(seconds_ago=20, public_ok=False, local_ok=True))
        out = diagnostics.summary(24)
        self.assertTrue(out["blackouts"]["ongoing"])
        self.assertEqual(out["blackouts"]["count"], 1)

    def test_window_excludes_old_samples(self):
        diagnostics.store.add(sample(seconds_ago=48 * 3600))  # 2 days old
        diagnostics.store.add(sample(seconds_ago=60))
        self.assertEqual(diagnostics.summary(1)["samples"], 1)


class HealthSummary(Fresh):
    def test_compact_shape(self):
        diagnostics.store.add(sample(seconds_ago=10, uv=True))
        hs = diagnostics.health_summary()
        for key in ("enabled", "blackouts24h", "underVoltageNow", "localProbe", "publicProbe", "verdict"):
            self.assertIn(key, hs)
        self.assertTrue(hs["underVoltageNow"])


class Recent(Fresh):
    def test_newest_first_and_bounded(self):
        for s in (90, 60, 30, 0):
            diagnostics.store.add(sample(seconds_ago=s))
        got = diagnostics.recent(2)
        self.assertEqual(got["count"], 2)
        self.assertGreaterEqual(got["samples"][0]["t"], got["samples"][1]["t"])


if __name__ == "__main__":
    unittest.main()
