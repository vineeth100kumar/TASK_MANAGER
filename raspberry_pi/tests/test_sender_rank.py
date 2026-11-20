import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sender_rank as r  # noqa: E402

DAY = 24 * 3600


class SenderRankTest(unittest.TestCase):
    def test_bump_and_regular(self):
        stats = {}
        r.bump(stats, "Arya", 0)
        self.assertFalse(r.is_regular(stats, "Arya", 0))
        r.bump(stats, "arya", 60)
        r.bump(stats, "Arya", 120)
        self.assertTrue(r.is_regular(stats, "Arya", 120))
        self.assertEqual(stats["arya"]["count"], 3)

    def test_fades_with_the_half_life(self):
        stats = {}
        for t in range(4):
            r.bump(stats, "Arya", t)
        self.assertTrue(r.is_regular(stats, "Arya", 1))
        self.assertFalse(r.is_regular(stats, "Arya", 28 * DAY))

    def test_rank_names_and_top(self):
        stats = {}
        for _ in range(5):
            r.bump(stats, "Bran", 0)
        r.bump(stats, "Arya", 0)
        self.assertEqual(r.rank_names(stats, ["Arya", "Unknown", "Bran"], 0), ["Bran", "Arya", "Unknown"])
        self.assertEqual(r.top(stats, 0, 1), ["Bran"])

    def test_prune_keeps_the_strongest(self):
        stats = {}
        for i in range(10):
            for _ in range(i + 1):
                r.bump(stats, f"p{i}", 0)
        kept = r.prune(stats, 0, keep=3)
        self.assertEqual(sorted(kept), ["p7", "p8", "p9"])


if __name__ == "__main__":
    unittest.main()
