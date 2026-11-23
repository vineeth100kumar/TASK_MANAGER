"""Posts take the reel's `objects:` and `diagram:` lines and draw the finished picture; the posts guide
(content_engine/POST_FORMAT.md) must describe only what works.   cd raspberry_pi && python -m unittest tests.test_post_overlays
(Named so it sorts after test_safety, like the other engine tests that share the data folder.)"""
import re
import sys
import tempfile
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent / "content_engine"
sys.path.insert(0, str(ENGINE / "src"))

from autocontent.spec import parse_post, parse_spec  # noqa: E402
from autocontent.reel.objects import SHAPES, object_problems  # noqa: E402
from autocontent.reel.diagram import list_presets  # noqa: E402

GUIDE = (ENGINE / "POST_FORMAT.md").read_text(encoding="utf-8")
PROMPT = GUIDE.split("<!-- PROMPT START -->")[1].split("<!-- PROMPT END -->")[0]
HEAD = "---\nautocontent: post\ntitle: T\n---\n\n"
CAP = "\n\n## caption\nCaption.\n\n## hashtags\n#a #b #c\n"
WAFFLE = """## statement
headline: You are short
align: top
diagram: waffle
  rows: 2 x 3
  shape: square
  on: 1-2 "you have"
  ghost: rest "still missing"
objects: arrow-down @ 80,30 120 accent | check @ 20,62 100 success
"""


class Parsing(unittest.TestCase):
    def test_lines_are_kept_on_the_slide_and_dont_trip_the_post_parser(self):
        spec = parse_post(HEAD + WAFFLE + CAP)
        self.assertTrue(spec.ok, [str(i) for i in spec.issues])
        s = spec.slides[0]
        self.assertTrue(s["diagram"].startswith("waffle"))
        self.assertIn("rows: 2 x 3", s["diagram"])
        self.assertIn("arrow-down", s["objects"])
        self.assertEqual(s["headline"], "You are short")
        self.assertEqual(s.get("align"), "top")

    def test_plain_parser_unchanged(self):
        spec = parse_spec(HEAD + "## statement\nheadline: Hi\n" + CAP)
        self.assertNotIn("diagram", spec.slides[0])

    def test_bad_diagram_is_an_error_with_its_line(self):
        spec = parse_post(HEAD + "## statement\nheadline: Hi\ndiagram: waffle\n  legnd: off\n" + CAP)
        bad = [i for i in spec.issues if i.code == "DIAGRAM_BAD"]
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0].severity, "ERROR")
        self.assertEqual(bad[0].slide, 1)
        self.assertFalse(spec.ok)

    def test_unknown_object_warns(self):
        spec = parse_post(HEAD + "## statement\nheadline: Hi\nobjects: rocketship-xyz @ 50,50 100 accent\n" + CAP)
        self.assertTrue(any(i.code == "OBJECT_IGNORED" for i in spec.issues))
        self.assertTrue(spec.ok)


class Guide(unittest.TestCase):
    def test_guide_examples_parse_clean(self):
        block = PROMPT.split("EXPLAINER DIAGRAMS AND OBJECTS")[1]
        diagram = "\n".join(re.findall(r"^diagram: waffle\n(?:  .+\n)+", block, re.M)[0:1]).strip("\n")
        self.assertIn("rows: 2 x 3", diagram)
        objects = re.findall(r"^objects: .+$", block, re.M)[0]
        text = HEAD + "## statement\nheadline: Short\nalign: top\n" + diagram + "\n" + objects + CAP
        spec = parse_post(text)
        bad = [str(i) for i in spec.issues if i.code in ("DIAGRAM_BAD", "OBJECT_IGNORED") or i.severity == "ERROR"]
        self.assertEqual(bad, [])

    def test_every_preset_and_shape_named_in_the_prompt_exists(self):
        block = PROMPT.split("Presets:")[1].split("\n")[0]
        for name in re.findall(r"(\w+) \(", block):
            self.assertIn(name, list_presets(), name)
        names = PROMPT.split("Names (only these): ")[1].split(".")[0].split(", ")
        for n in names:
            self.assertIn(n, SHAPES, n)
            self.assertEqual(object_problems(f"{n} @ 50,50 100 accent"), [], n)


try:
    import playwright  # noqa: F401
    HAVE_PW = True
except ImportError:
    HAVE_PW = False


@unittest.skipUnless(HAVE_PW, "Playwright is not installed here")
class Drawing(unittest.TestCase):
    def test_overlays_are_drawn_on_the_slide(self):
        from PIL import Image
        from autocontent.spec.build import build_from_spec
        from autocontent.render.renderer import SlideRenderer
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "p.md"
            src.write_text(HEAD + WAFFLE + CAP, encoding="utf-8")
            plain = Path(d) / "q.md"
            plain.write_text(HEAD + WAFFLE.split("diagram:")[0] + CAP, encoding="utf-8")
            sizes = []
            for f, out in ((src, "a"), (plain, "b")):
                folder, data, _ = build_from_spec(f, out_dir=Path(d) / out)
                r = SlideRenderer(data["style"], canvas_format=data["canvas_format"])
                r.base_dir = folder
                r.collect_fit = True
                r.fit_report = []
                pngs = r.render_deck(data, folder)
                self.assertEqual(r.fit_report[0]["problems"], [])
                im = Image.open(pngs[0]).convert("RGB")
                # the lower half of the slide is blank grid on the plain one and holds the diagram on the other
                low = im.crop((100, 700, 980, 1150)).getcolors(1 << 20)
                sizes.append(len(low))
            self.assertGreater(sizes[0], sizes[1] + 3)


if __name__ == "__main__":
    unittest.main()
