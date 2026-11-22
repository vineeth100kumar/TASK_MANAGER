"""The reel format guide (content_engine/REEL_FORMAT.md) must never describe something the engine
doesn't do. Its AI prompt is what Sage's AI writer and outside AIs copy from, so every example in it
is parsed here and has to come out with no errors and no warnings.

    cd raspberry_pi && python -m unittest tests.test_reel_format_guide
"""

import re
import sys
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent / "content_engine"
sys.path.insert(0, str(ENGINE / "src"))

from autocontent.reel import parse_reel  # noqa: E402
from autocontent.reel.diagram import list_presets  # noqa: E402
from autocontent.reel.objects import SHAPES, OBJ_ANIMS, COLOUR_TOKENS, object_problems  # noqa: E402
from autocontent.reel.script import TONES, expected_pieces, pill_fits  # noqa: E402
from autocontent.reel.voice import VOICES  # noqa: E402
from autocontent.spec.parser import SLIDE_TYPES  # noqa: E402

GUIDE = (ENGINE / "REEL_FORMAT.md").read_text(encoding="utf-8")
PROMPT = GUIDE.split("<!-- PROMPT START -->")[1].split("<!-- PROMPT END -->")[0]
HEADER = "---\nautocontent: reel\ntitle: Guide check\nstyle: grid_pill\nvoice: af_heart\ncaptions: on\ntag: \"#test\"\n---\n\n"
TAIL = "\n\n## caption\nA caption line.\n\n## hashtags\n#one #two #three\n"


def problems(text: str, short_ok: bool = True):
    """Every issue the checker raises (a one-slide test reel may be short, and a `search:` picture
    always notes that it is fetched when the reel is made)."""
    r = parse_reel(text)
    return [str(i) for i in r.issues if i.code != "IMAGE_SEARCH" and not (short_ok and i.code == "REEL_SHORT")]


def full_example() -> str:
    part = PROMPT.split("## 14. A COMPLETE EXAMPLE")[1]
    return part[part.index("---\nautocontent: reel"):part.index("NOW WRITE")].strip()


class GuideExamples(unittest.TestCase):
    def test_prompt_markers_and_no_marker_word_inside(self):
        self.assertIn("say:", PROMPT)
        self.assertNotIn("PROMPT", PROMPT)

    def test_full_example_in_the_prompt_is_clean(self):
        example = full_example()
        self.assertEqual(problems(example, short_ok=False), [])
        r = parse_reel(example)
        self.assertEqual(r.scenes[0].slide["type"], "cover")
        self.assertEqual(r.scenes[-1].slide["type"], "cta")
        self.assertTrue(any(s.diagram for s in r.scenes))

    def test_every_slide_snippet_in_the_prompt_is_clean(self):
        snippets = [b for b in re.findall(r"```\n(.*?)```", PROMPT, re.S) if b.lstrip().startswith("## ")
                    and not b.lstrip().startswith(("## caption",))]
        self.assertGreaterEqual(len(snippets), 12)
        for snip in snippets:
            # every slide snippet must be fine on its own, between a cover and a cta
            body = snip if snip.startswith("## cover") else "## cover\nheadline: A short test cover\nsay: A short test.\n\n" + snip
            if "## cta" not in body:
                body += "\n\n## cta\nheadline: Which one?\nsay: Tell me which one."
            with self.subTest(snippet=snip.splitlines()[0]):
                self.assertEqual(problems(HEADER + body + TAIL), [], snip)

    def test_example_cues_match_the_piece_counts(self):
        example = full_example()
        for s in parse_reel(example).scenes:
            if s.show:
                self.assertEqual(len(s.show), expected_pieces(s.slide) - 1, s.slide["type"])

    def test_header_example_block_is_clean(self):
        block = re.search(r"```\n(---\nautocontent: reel.*?---\n)```", PROMPT, re.S).group(1)
        block = block.replace("<short title, 3 to 8 words>", "A title").replace("<one topic word>", "topic")
        self.assertEqual(problems(block + "\n## cover\nheadline: A short test cover\nsay: A short test.\n\n"
                                          "## cta\nheadline: Which one?\nsay: Tell me which one." + TAIL), [])


class GuideNamesExist(unittest.TestCase):
    """Every name the prompt offers is one the engine knows."""

    def test_slide_types(self):
        line = re.search(r"type is one of: ([a-z, ]+)\.", PROMPT).group(1)
        for t in [x.strip() for x in line.split(",")]:
            self.assertIn(t, SLIDE_TYPES)

    def test_voices(self):
        for v in re.findall(r"`([ab][fm]_[a-z]+)`", PROMPT):
            self.assertIn(v, VOICES)

    def test_tones(self):
        row = next(l for l in PROMPT.splitlines() if l.startswith("| `tone:`"))
        for t in re.findall(r"`([a-z]+)`", row.split("|")[2]):
            self.assertIn(t, TONES)

    def test_diagram_presets(self):
        section = PROMPT.split("## 9. DIAGRAMS")[1].split("## 10.")[0]
        for name in re.findall(r"^\| `([a-z]+)` \|", section, re.M):
            self.assertIn(name, list_presets())

    def test_object_names_colours_and_animations(self):
        section = PROMPT.split("## 10. OBJECTS")[1].split("## 11.")[0]
        names = re.search(r"name: ONLY one of these: ([a-z, -]+)\.", section).group(1)
        for n in [x.strip() for x in names.split(",")]:
            self.assertIn(n, SHAPES)
        colours = re.search(r"colour: ([a-z, ]+), or a hex", section).group(1)
        for c in [x.strip() for x in colours.split(",")]:
            self.assertIn(c, COLOUR_TOKENS)
        anims = re.search(r"animation: ([a-z, ]+)\.", section).group(1)
        for a in [x.strip() for x in anims.split(",")]:
            self.assertIn(a, OBJ_ANIMS)
        example = re.search(r"Example: `objects: (.*?)`", section).group(1)
        self.assertEqual(object_problems(example), [])


class NewChecks(unittest.TestCase):
    """The checks added with the guide, for the mistakes outside AIs actually made."""

    def test_cover_pill_must_end_the_headline(self):
        self.assertTrue(pill_fits("Profit is not the same as cash", "as cash"))
        self.assertTrue(pill_fits("Can you **restock?**", "restock?"))
        self.assertFalse(pill_fits("You made a ==profit==.", "Can you restock?"))
        text = HEADER + "## cover\nheadline: You made a **profit**.\npill: Can you restock?\nsay: You made a profit.\n" + TAIL
        self.assertTrue(any("PILL" in i.code for i in parse_reel(text).issues))
        beige = text.replace("style: grid_pill", "style: beige_grain")
        self.assertFalse(any("PILL" in i.code for i in parse_reel(beige).issues))

    def test_too_few_cues_shift(self):
        text = HEADER + ("## list\nheadline: Three steps\n1. One\n2. Two\n3. Three\n"
                         "say: First one. Second two. Third three.\nshow: Second\n") + TAIL
        codes = [i.code for i in parse_reel(text).issues]
        self.assertIn("CUES_SHIFTED", codes)
        ok = text.replace("show: Second", "show: First | Second | Third")
        self.assertNotIn("CUES_SHIFTED", [i.code for i in parse_reel(ok).issues])

    def test_too_many_cues(self):
        text = HEADER + "## statement\nheadline: Only a headline\nsay: Only a headline here.\nshow: Only | headline\n" + TAIL
        self.assertIn("CUES_TOO_MANY", [i.code for i in parse_reel(text).issues])

    def test_objects_that_would_not_draw_are_reported(self):
        self.assertEqual(object_problems("arrow-right @ 50,40 120 accent fly"), [])
        self.assertTrue(object_problems("star @ 50,40 120 accent spin 45deg"))      # rotation is r45
        self.assertTrue(object_problems("check @ 50,40 120 draw"))                  # animation in the colour slot
        self.assertTrue(object_problems("circle @ 50,40 80 warn"))                  # the token is `warning`
        self.assertTrue(object_problems("not-a-shape @ 50,40 80 accent pop"))
        self.assertTrue(object_problems("arrow-right somewhere"))


if __name__ == "__main__":
    unittest.main()
