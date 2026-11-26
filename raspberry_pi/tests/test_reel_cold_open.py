"""The cold open: header, hero text, card, and a real render.

    cd raspberry_pi && python -m unittest tests.test_reel_cold_open
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "content_engine" / "src"))

from autocontent.reel import parse_reel  # noqa: E402
from autocontent.reel import cold  # noqa: E402
from autocontent.reel.script import COLD_OPEN_SECONDS, cold_open_text  # noqa: E402
from tests.test_reel_engine import CHROMIUM, FFMPEG, SCRIPT, tone_voice  # noqa: E402


def with_header(line: str) -> str:
    return SCRIPT.replace("autocontent: reel\n", "autocontent: reel\n" + line + "\n", 1)


class ColdOpenScriptTests(unittest.TestCase):
    def test_off_by_default(self):
        r = parse_reel(SCRIPT)
        self.assertEqual(r.meta["cold_open"], "off")
        self.assertEqual(cold_open_text(r), "")

    def test_auto_takes_the_first_big_number(self):
        r = parse_reel(with_header("cold_open: on"))
        self.assertEqual(r.meta["cold_open"], "auto")
        self.assertTrue(cold_open_text(r))

    def test_own_text_is_used_and_length_grows(self):
        base = parse_reel(SCRIPT).estimate_seconds()
        r = parse_reel(with_header("cold_open: ₹30,188 crore"))
        self.assertEqual(cold_open_text(r), "₹30,188 crore")
        self.assertAlmostEqual(r.estimate_seconds() - base, COLD_OPEN_SECONDS, places=1)

    def test_nothing_to_open_on_warns(self):
        text = with_header("cold_open: on")
        text = text.replace("## stat", "## statement")
        r = parse_reel(text)
        if not cold_open_text(r):
            self.assertIn("COLD_OPEN_NONE", {i.code for i in r.issues})

    def test_card_is_full_size_and_fits(self):
        img = cold.make_card("₹30,188 crore")
        self.assertEqual(img.size, (1080, 1920))
        self.assertEqual(cold.make_card("x" * 24).size, (1080, 1920))


@unittest.skipUnless(CHROMIUM and FFMPEG, "needs Chromium and ffmpeg")
class ColdOpenRenderTests(unittest.TestCase):
    def test_render_adds_the_card_and_keeps_cues_on_their_words(self):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        from autocontent.reel import make_reel
        tmp = tempfile.mkdtemp()
        try:
            plain = make_reel(SCRIPT, Path(tmp) / "a", engine=tone_voice, fetch_images=False, progress=lambda s: None)
            cold_s = make_reel(with_header("cold_open: on"), Path(tmp) / "b", engine=tone_voice, fetch_images=False,
                               progress=lambda s: None)
            self.assertAlmostEqual(cold_s["seconds"] - plain["seconds"], COLD_OPEN_SECONDS, delta=0.15)
            first = cold_s["timeline"][0]["start"]
            self.assertAlmostEqual(first, COLD_OPEN_SECONDS, places=2)
            self.assertAlmostEqual(cold_s["timeline"][1]["start"] - plain["timeline"][1]["start"], COLD_OPEN_SECONDS, delta=0.05)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
