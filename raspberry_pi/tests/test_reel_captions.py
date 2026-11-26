"""Caption presets: `captions: on|off|bold|box|minimal`.

    cd raspberry_pi && python -m unittest tests.test_reel_captions
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "content_engine" / "src"))

from autocontent.reel import parse_reel  # noqa: E402
from autocontent.reel import captions as caps  # noqa: E402
from tests.test_reel_engine import SCRIPT  # noqa: E402


class CaptionPresetTests(unittest.TestCase):
    def meta(self, value):
        return parse_reel(SCRIPT.replace("captions: on", f"captions: {value}")).meta["captions"]

    def test_presets_are_read_and_the_old_values_still_work(self):
        self.assertEqual(self.meta("on"), "on")
        self.assertEqual(self.meta("off"), "off")
        for p in caps.PRESETS:
            self.assertEqual(self.meta(p), p)

    def test_default_look_is_unchanged(self):
        colors = caps.THEMES["light"]
        self.assertEqual(caps._html("f", ["A", "B"], 0, colors, 72), caps._html("f", ["A", "B"], 0, colors, 72, "bold"))
        self.assertNotIn("rgba(17,17,17", caps._html("f", ["A"], 0, colors, 72))

    def test_each_preset_looks_different(self):
        colors = caps.THEMES["light"]
        pages = {p: caps._html("f", ["A", "B"], 0, colors, 72, p) for p in caps.PRESETS}
        self.assertEqual(len(set(pages.values())), 3)
        self.assertIn("rgba(17,17,17", pages["box"])
        self.assertIn("opacity: 0.45", pages["minimal"])


if __name__ == "__main__":
    unittest.main()
