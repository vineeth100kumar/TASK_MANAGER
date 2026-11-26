"""The save card (`recap`), the closing `choice:` and the pinned first comment.

    cd raspberry_pi && python -m unittest tests.test_reel_recap
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "content_engine" / "src"))

from autocontent.reel import parse_reel  # noqa: E402
from autocontent.reel.script import first_comment  # noqa: E402
from tests.test_reel_engine import CHROMIUM, FFMPEG, SCRIPT, tone_voice  # noqa: E402

RECAP = """## recap
headline: 3 numbers to keep
- 65% | from regulars
- 3 | steps
- ₹0 | to start
say: Keep these three. Regulars bring sixty five percent. There are three steps. And it costs nothing to start.
show: Regulars | three steps | nothing

"""


def with_recap(text: str, choice: str = "") -> str:
    out = text.replace("## cta", RECAP + "## cta", 1)
    if choice:
        out = out.replace("subtext: COMMENT 1, 2 OR 3\n", f"choice: {choice}\n")
    return out


class RecapTests(unittest.TestCase):
    def test_recap_is_a_dark_list_marked_save_this(self):
        r = parse_reel(with_recap(SCRIPT))
        self.assertTrue(r.ok, [str(i) for i in r.issues if i.severity == "ERROR"])
        s = next(sc for sc in r.scenes if sc.slide.get("headline") == "3 numbers to keep")
        self.assertEqual(s.slide["type"], "list")
        self.assertEqual(s.slide["kicker"], "SAVE THIS")
        self.assertEqual(s.slide["theme"], "dark")
        self.assertEqual(len(s.slide.get("items") or s.slide.get("numbered") or []), 3)
        self.assertIn("65% — from regulars", str(s.slide))

    def test_headline_default_and_no_warnings_about_the_recap(self):
        text = with_recap(SCRIPT).replace("headline: 3 numbers to keep\n", "")
        r = parse_reel(text)
        self.assertTrue(any(sc.slide.get("headline") == "3 numbers to keep" for sc in r.scenes))
        self.assertFalse([i for i in r.issues if i.slide and r.scenes[i.slide - 1].slide.get("kicker") == "SAVE THIS"
                          and i.severity == "ERROR"])

    def test_line_numbers_still_point_at_the_script(self):
        text = with_recap(SCRIPT).replace("show: Regulars | three steps | nothing", "show: Regulars | three steps | nothing | a | b")
        r = parse_reel(text)
        bad = [i for i in r.issues if i.code in ("CUES_TOO_MANY", "CUES_SHIFTED")]
        self.assertTrue(bad)
        lines = text.split("\n")
        self.assertTrue(lines[bad[0].line - 1].startswith("## recap"), lines[bad[0].line - 1])

    def test_choice_becomes_the_subtext_and_the_first_comment(self):
        r = parse_reel(with_recap(SCRIPT, "Debt | Growth"))
        cta = r.scenes[-1].slide
        self.assertEqual(cta["cta_pill_subtext"], "COMMENT DEBT OR GROWTH")
        self.assertEqual(r.choice, ("Debt", "Growth"))
        self.assertIn("Debt or Growth", first_comment(r))

    def test_a_choice_too_long_for_the_slide_is_an_error(self):
        r = parse_reel(with_recap(SCRIPT, "Regulars | Catalogue"))
        self.assertIn("CHOICE_TOO_LONG", {i.code for i in r.errors})

    def test_no_choice_still_gets_a_first_comment(self):
        self.assertTrue(first_comment(parse_reel(SCRIPT)))


@unittest.skipUnless(CHROMIUM and FFMPEG, "needs Chromium and ffmpeg")
class RecapRenderTests(unittest.TestCase):
    def test_the_card_renders_and_fits(self):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        from autocontent.reel import make_reel
        tmp = tempfile.mkdtemp()
        try:
            s = make_reel(with_recap(SCRIPT, "Debt | Growth"), Path(tmp) / "r", engine=tone_voice,
                          fetch_images=False, progress=lambda m: None)
            self.assertEqual(s["scenes"], 5)
            self.assertIn("Debt", s["firstComment"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
