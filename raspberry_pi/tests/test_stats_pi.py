"""Tests for the live Pi stats (pi_stats.py).

    cd raspberry_pi && python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pi_stats  # noqa: E402


class PiStatsTests(unittest.TestCase):
    def test_snapshot_has_every_section(self):
        pi_stats._cache.update(at=0.0, data=None)
        s = pi_stats.snapshot()
        for key in ("cpu", "gpu", "memory", "swap", "uptimeSeconds", "disks"):
            self.assertIn(key, s)
        self.assertEqual([d["label"] for d in s["disks"]], ["USB boot drive", "SD card"])
        self.assertTrue(s["disks"][0]["mounted"])

    def test_snapshot_is_cached(self):
        pi_stats._cache.update(at=0.0, data=None)
        a = pi_stats.snapshot()
        with mock.patch.object(pi_stats, "_collect", side_effect=AssertionError("not cached")):
            self.assertIs(pi_stats.snapshot(), a)

    def test_missing_card_reports_unmounted(self):
        d = pi_stats._disk("SD card", "/definitely/not/mounted", "x")
        self.assertFalse(d["mounted"])

    def test_throttle_flags(self):
        self.assertEqual(pi_stats._throttle_flags(0), [])
        self.assertEqual(pi_stats._throttle_flags(0x50005), ["Under-voltage now", "Throttled now", "Under-voltage since boot", "Throttled since boot"])

    def test_vcgencmd_parse(self):
        self.assertEqual(pi_stats._num("temp=48.3'C"), 48.3)
        self.assertEqual(pi_stats._num("gpu=76M"), 76.0)
        self.assertIsNone(pi_stats._num(None))


if __name__ == "__main__":
    unittest.main()
