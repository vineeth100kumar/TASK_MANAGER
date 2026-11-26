"""Hook score and closing checks for reels.

    cd raspberry_pi && python -m unittest tests.test_reel_hook
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "content_engine" / "src"))

from autocontent.reel import parse_reel  # noqa: E402
from autocontent.reel.script import hook_score  # noqa: E402

HEAD = "---\nautocontent: reel\ntitle: T\nstyle: grid_pill\nvoice: af_heart\ncaptions: on\ntag: \"#t\"\n---\n\n"
TAIL = "\n\n## caption\nC.\n\n## hashtags\n#a #b #c\n"


def codes(cover_say, cta_say):
    text = (HEAD + f"## cover\nheadline: A test headline here\npill: headline here\nsay: {cover_say}\n\n"
            f"## cta\nheadline: Which one?\nsay: {cta_say}" + TAIL)
    return {i.code for i in parse_reel(text).issues}


class HookTests(unittest.TestCase):
    def test_strong_hook_scores_high(self):
        score, parts = hook_score("Jio raised ₹30,000 crore. Where did it go?")
        self.assertGreaterEqual(score, 85)
        self.assertTrue(all(parts.values()))

    def test_abstract_hook_scores_low(self):
        score, _ = hook_score("India rose while global stocks sank.")
        self.assertLess(score, 50)

    def test_empty_hook_is_zero(self):
        self.assertEqual(hook_score("")[0], 0)

    def test_weak_and_long_hooks_warn(self):
        c = codes("India rose while global stocks sank and nobody could really explain the reason why it happened.",
                  "Save this. Which one?")
        self.assertIn("HOOK_WEAK", c)
        self.assertIn("HOOK_LONG", c)

    def test_good_hook_and_close_are_clean(self):
        c = codes("Jio raised ₹30,000 crore. Where did it go?", "Save this for later. Debt or growth?")
        self.assertFalse(c & {"HOOK_WEAK", "HOOK_LONG", "CTA_NO_QUESTION", "CTA_NO_SAVE"})

    def test_close_without_question_or_save_warns(self):
        c = codes("Jio raised ₹30,000 crore. Where did it go?", "Thanks for watching.")
        self.assertIn("CTA_NO_QUESTION", c)
        self.assertIn("CTA_NO_SAVE", c)


if __name__ == "__main__":
    unittest.main()
