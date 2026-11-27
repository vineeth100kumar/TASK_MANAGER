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

    def test_box_spoken_word_reads_on_the_card_for_every_theme_and_accent(self):
        for name, colors in caps.THEMES.items():
            html = caps._html("f", ["A", "B"], 0, colors, 72, "box")
            active = html.split(".a { color: ")[1][:7] if ".a { color: " in html else html.split(".a {")[1].split("color: ")[1][:7]
            self.assertGreaterEqual(caps.contrast(active, caps.BOX_CARD), 4.5, name)
        for accent in ("#111111", "#000", "#7952B3", "#EE4425", "#444444", "#1E3A8A"):
            self.assertGreaterEqual(caps.contrast(caps.readable_on(accent), caps.BOX_CARD), 4.5, accent)
        self.assertEqual(caps.readable_on("#111111"), "#EE4425")


if __name__ == "__main__":
    unittest.main()
