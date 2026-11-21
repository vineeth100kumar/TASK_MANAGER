"""Tests for reel diagrams (content_engine/src/autocontent/reel/diagram.py): reading a recipe, the six
layout engines, the presets, states and cues, and a reel made end to end with a diagram in it.

    cd raspberry_pi && python -m unittest tests.test_diagrams

The drawing tests need nothing but Python; the end-to-end test needs a Chromium (AUTOCONTENT_CHROMIUM or
/opt/pw-browsers/chromium) and ffmpeg, and is skipped without them.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

ENGINE_SRC = Path(__file__).resolve().parent.parent / "content_engine" / "src"
sys.path.insert(0, str(ENGINE_SRC))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from autocontent.reel import DiagramError, compose, list_presets, parse_diagram, parse_reel  # noqa: E402
from autocontent.reel import diagram as D  # noqa: E402
from autocontent.reel import timing  # noqa: E402
from autocontent.reel.align import Timed  # noqa: E402

CHROMIUM = os.environ.get("AUTOCONTENT_CHROMIUM") or ("/opt/pw-browsers/chromium" if Path("/opt/pw-browsers/chromium").exists() else "")
FFMPEG = shutil.which("ffmpeg") is not None

PRESETS = ["anatomy", "bars", "concentric", "cycle", "flow", "funnel", "heatmap", "hierarchy", "matrix",
           "meter", "overlap", "plan", "scale", "seatmap", "section", "swimlane", "table", "timeline", "waffle"]


def words(text):
    return [Timed(w, i * 0.4, i * 0.4 + 0.3) for i, w in enumerate(text.split())]


class PresetTests(unittest.TestCase):
    def test_every_preset_is_shipped_and_draws_well_formed_svg_in_both_themes(self):
        self.assertEqual(sorted(set(PRESETS) - set(list_presets())), [])
        for name in PRESETS:
            for theme in ("light", "dark"):
                d = parse_diagram(name)
                svg = d.svg([], theme, "#EE4425")
                ET.fromstring(svg)                       # well-formed, so Chromium will draw it
                self.assertGreater(len(d.parts), 1, name)
                self.assertNotIn("NaN", svg, name)

    def test_every_preset_fits_inside_its_own_box(self):
        for name in PRESETS:
            d = parse_diagram(name)
            for p in d.parts:
                x, y, w, h = p.bbox()
                if p.kind in ("text",):
                    continue
                self.assertGreaterEqual(x, -1, (name, p.kind))
                self.assertGreaterEqual(y, -1, (name, p.kind))
                self.assertLessEqual(x + w, d.w + 1, (name, p.kind, x + w))
                self.assertLessEqual(y + h, d.h + 1, (name, p.kind, y + h))

    def test_a_preset_alone_is_a_complete_sample_and_a_slide_replaces_its_data(self):
        sample = parse_diagram("flow")
        mine = parse_diagram("flow\nitem: A | 1 day\nitem: B | 3 days\nitem: C | 2 days")
        self.assertEqual([p.label for p in sample.parts], ["Design", "Fab", "Test", "Ship"])
        self.assertEqual([p.label for p in mine.parts], ["A", "B", "C"])

    def test_a_replaced_line_keeps_the_place_the_preset_gave_it(self):
        # the preset says `on:` then `base: rest`; the slide's own `on:` must still come first
        d = parse_diagram('seatmap\non: 1-40 "sold" @ "forty"')
        self.assertEqual([x.kind for x in d.directives], ["on", "base"])
        self.assertEqual(len(d.directives[0].ids), 40)
        self.assertEqual(len(d.directives[1].ids), 128 - 40)


class StateTests(unittest.TestCase):
    def grid(self, extra=""):
        return parse_diagram("grid\nshape: square\nrows: 4 x 5\n" + extra)

    def test_selectors(self):
        d = self.grid('on: 1-3, 7\nwarn: rows 4\nghost: cols 5\nbase: r2c2')
        ids = [x.ids for x in d.directives]
        self.assertEqual(ids[0], {1, 2, 3, 7})
        self.assertEqual(ids[1], {16, 17, 18, 19, 20})
        self.assertEqual(ids[2], {5, 10, 15, 20})
        self.assertEqual(ids[3], {7})

    def test_rest_means_what_no_other_line_names_wherever_it_is_written(self):
        a = self.grid('base: rest "empty"\non: 1-5 "taken"')
        b = self.grid('on: 1-5 "taken"\nbase: rest "empty"')
        for d in (a, b):
            state, hidden, eff = d._states(set())
            self.assertEqual(sum(1 for s in state.values() if s == "on"), 5)
        legend = a.svg([]).count("EMPTY · 15")
        self.assertEqual(legend, 1)

    def test_a_cue_changes_the_picture_only_once_it_is_applied(self):
        d = self.grid('on: 1-10 "full" @ "ten"')
        before, after = d.svg([]), d.svg(["ten"])
        self.assertNotEqual(before, after)
        self.assertNotIn("FULL ·", before)           # nothing is full yet, so no legend entry for it
        self.assertIn("FULL · 10", after)

    def test_the_legend_counts_what_is_in_that_state_right_now(self):
        d = self.grid('on: 1-6 "sold" @ "six"\nbase: rest "empty"')
        self.assertIn("EMPTY · 20", d.svg([]))
        late = d.svg(["six"])
        self.assertIn("SOLD · 6", late)
        self.assertIn("EMPTY · 14", late)

    def test_appear_hides_parts_until_the_cue(self):
        d = self.grid('appear: 11-20 @ "later"')
        hidden = d._states(set())[1]
        self.assertEqual(hidden, set(range(11, 21)))
        self.assertEqual(d._states({"later"})[1], set())
        self.assertGreater(d.svg(["later"]).count("<rect"), d.svg([]).count("<rect"))

    def test_marks_appear_on_their_cue(self):
        d = self.grid('mark: rows 1 "front row" @ "front"')
        self.assertNotIn("FRONT ROW", d.svg([]))
        self.assertIn("FRONT ROW", d.svg(["front"]))

    def test_cues_are_listed_once_in_recipe_order(self):
        d = self.grid('on: 1-3 @ "one"\nwarn: 4 @ "two"\nmark: 5 "m" @ "one"')
        self.assertEqual(d.cues(), ["one", "two"])


class ErrorTests(unittest.TestCase):
    def bad(self, text, fragment):
        with self.assertRaises(DiagramError) as cm:
            parse_diagram(text)
        self.assertIn(fragment, str(cm.exception) + " " + cm.exception.hint)
        return cm.exception

    def test_unknown_diagram_says_what_exists(self):
        e = self.bad("spaceship", "I don't know a diagram called 'spaceship'")
        self.assertIn("seatmap", e.hint)

    def test_a_selector_that_names_nothing_is_refused(self):
        self.bad("grid\nrows: 2 x 2\non: 99", "no part called")
        self.bad("flow\nwarn: Nonesuch", "no part called")

    def test_bad_sizes_and_lines(self):
        self.bad("grid\nrows: lots", "should look like")
        self.bad("grid\nthis is not a line", "Can't read the line")
        self.bad("grid\nrows: 40 x 40", "too many")
        self.bad("flow\nitem: Only one | 1", "at least two")
        self.bad("hierarchy\nroot: Top\nitem: X | 1 | Nobody", "isn't in the tree")
        self.bad("cycle\nitem: A\nitem: B", "between 3 and 10")

    def test_too_many_cues(self):
        lines = "\n".join(f'on: {i} @ "w{i}"' for i in range(1, 16))
        self.bad("grid\nrows: 4 x 5\n" + lines, "Too many")

    def test_a_dense_grid_is_refused_with_a_hint(self):
        e = self.bad("grid\nrows: 30 x 20\nsize: 300 x 200", "too dense")
        self.assertTrue(e.hint)


class ReviewFixTests(unittest.TestCase):
    def test_tab_indent_stays_in_diagram(self):
        r = parse_reel(script("diagram: seatmap\n\trows: 2 x 2\n\ton: 1"))
        self.assertTrue(r.ok, [str(i) for i in r.issues])
        self.assertNotIn("rows:", r.post_text)

    def test_unknown_line_suggests(self):
        with self.assertRaises(DiagramError) as cm:
            parse_diagram("grid\nrows: 2 x 2\nlegnd: auto")
        self.assertIn("legend", cm.exception.hint)

    def test_empty_rest_is_fine(self):
        parse_diagram("grid\nrows: 1 x 2\non: 1-2\nbase: rest")

    def test_quoted_numeric_label(self):
        d = parse_diagram("timeline\nitem: 2015 | 2015\nitem: 2020 | 2020\non: \"2015\"")
        self.assertTrue(d.svg([]))

    def test_scale_item_without_value(self):
        parse_diagram("scale\nitem: A\nitem: B")

    def test_tree_loop_is_an_error(self):
        with self.assertRaises(DiagramError):
            parse_diagram("hierarchy\nroot: R\nitem: A | 1 | B\nitem: B | 1 | A")

    def test_slide_content_replaces_preset_sample(self):
        d = parse_diagram("seatmap\nrows: 2 x 3")
        self.assertEqual(len([p for p in d.parts if p.sel]), 6)

    def test_plan_steps_stay_inside_slide(self):
        from types import SimpleNamespace as NS
        from autocontent.reel.diagram import plan_steps
        words = [NS(start=9.0 + i) for i in range(3)]
        steps, _ = plan_steps(["a", "b", "c"], words, 0.0, 3.0, 0.3, lambda c, w, after: after)
        self.assertTrue(all(t <= 3.0 for t, _ in steps), steps)


class EngineTests(unittest.TestCase):
    def test_space_free_layout_places_parts_in_percentages(self):
        d = parse_diagram("space\nbox: 10,10,30,20 | Left\nbox: 60,10,30,20 | Right\narrow: 40,20 > 60,20\n"
                          "leader: 20,30 > 5,60 | Part\ndot: 50,80 | Here\ntext: 50,95 | note\ncircle: 50,50,10 | Disc")
        kinds = [p.kind for p in d.parts]
        for k in ("box", "arrow", "leader", "marker", "text", "disc"):
            self.assertIn(k, kinds)
        left = d.parts[0]
        self.assertAlmostEqual(left.x, 0.10 * d.w, delta=1)
        leader = next(p for p in d.parts if p.kind == "leader")
        self.assertAlmostEqual(leader.x, 0.20 * d.w, delta=1)          # the start of the leader stays put
        self.assertAlmostEqual(leader.bbox()[2], abs(0.05 * d.w - 0.20 * d.w), delta=1)    # `mark:` outlines the whole leader

    def test_funnel_works_out_the_drops(self):
        svg = parse_diagram("funnel").svg([])
        for drop in ("−58", "−24", "−12"):
            self.assertIn(drop, svg)

    def test_timeline_spaces_numeric_labels_by_value(self):
        d = parse_diagram("timeline\nitem: 2000 | a\nitem: 2001 | b\nitem: 2010 | c")
        xs = [p.x for p in d.parts]
        self.assertLess(xs[1] - xs[0], (xs[2] - xs[1]) / 5)

    def test_flow_marks_the_broken_step_with_a_badge(self):
        calm = parse_diagram("flow").svg([])
        warned = parse_diagram('flow\nwarn: Fab "the queue"').svg([])
        self.assertEqual(calm.count("<circle"), 0)
        self.assertEqual(warned.count("<circle"), 1)         # the round mark on the broken box

    def test_scale_uses_area_not_side(self):
        d = parse_diagram("scale\nitem: a | 1\nitem: b | 4")
        a, b = d.parts[0], d.parts[1]
        self.assertAlmostEqual(b.w / a.w, 2.0, places=2)

    def test_tree_levels_and_connectors(self):
        d = parse_diagram("hierarchy\nroot: R\nitem: A | 1\nitem: B | 2\nitem: A1 | 3 | A")
        self.assertEqual(len(d.parts), 4)
        self.assertEqual(len(d.connectors), 3)
        ys = {p.label: p.y for p in d.parts}
        self.assertLess(ys["R"], ys["A"])
        self.assertLess(ys["A"], ys["A1"])

    def test_the_part_cap(self):
        with self.assertRaises(DiagramError):
            parse_diagram("grid\ncount: 700\ncols: 28")

    def test_user_presets_are_found_in_a_named_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "mine.yml").write_text("engine: grid\nshape: dot\nrows: 2 x 3\non: 1 \"yes\"\n")
            os.environ["SAGE_DIAGRAMS_DIR"] = tmp
            try:
                d = parse_diagram("mine")
                self.assertEqual(len(d.parts), 6)
                self.assertIn("mine", list_presets())
            finally:
                os.environ.pop("SAGE_DIAGRAMS_DIR")


class StepTests(unittest.TestCase):
    def test_each_cue_brings_the_next_picture_before_its_word(self):
        w = words("a full house is two hundred seats on a tuesday only forty are sold and the cheap rows go first")
        steps, missed = D.plan_steps(["forty", "cheap rows"], w, 0.0, 9.0, 0.3, timing.find_cue)
        self.assertEqual(missed, [])
        self.assertEqual([s[1] for s in steps], [[], ["forty"], ["forty", "cheap rows"]])
        times = [s[0] for s in steps]
        self.assertEqual(times, sorted(times))
        self.assertAlmostEqual(times[1], 11 * 0.4 - 0.18, places=2)
        self.assertTrue(all(b - a >= 0.12 for a, b in zip(times, times[1:])))

    def test_cues_keep_the_order_they_are_spoken_not_the_order_written(self):
        w = words("alpha beta gamma delta epsilon zeta eta theta")
        steps, _ = D.plan_steps(["theta", "beta"], w, 0.0, 8.0, 0.3, timing.find_cue)
        self.assertEqual([s[1] for s in steps][-1], ["beta", "theta"])

    def test_a_cue_never_heard_is_reported_and_spread(self):
        steps, missed = D.plan_steps(["nowhere"], words("alpha beta gamma"), 0.0, 6.0, 0.3, timing.find_cue)
        self.assertEqual(missed, ["nowhere"])
        self.assertEqual(len(steps), 2)
        self.assertLess(steps[1][0], 6.0)

    def test_two_cues_never_land_on_top_of_each_other(self):
        steps, _ = D.plan_steps(["alpha", "beta"], words("alpha beta gamma"), 0.0, 6.0, 0.3, timing.find_cue)
        times = [s[0] for s in steps]
        self.assertTrue(all(b - a >= 0.12 for a, b in zip(times, times[1:])))

    def test_a_silent_slide_still_gets_every_cue(self):
        steps, missed = D.plan_steps(["a", "b"], [], 0.0, 5.0, 0.3, timing.find_cue)
        self.assertEqual(missed, ["a", "b"])
        self.assertEqual(len(steps), 3)


class SettlingTests(unittest.TestCase):
    def test_a_picture_that_arrives_late_keeps_the_slide_from_being_cached_as_finished(self):
        from PIL import Image
        base = Image.new("RGB", (compose.W, compose.H), "white")
        piece = compose.ObjectPiece(image=Image.new("RGBA", (10, 10)), box=(0, 0, 10, 10), at=6.0, anim="fade")
        clip = compose.SceneClip(t0=0, t1=9, base=base, objects=[piece])
        self.assertGreater(clip.settles_at, 6.3)
        piece.exit_at = 7.0
        self.assertGreater(clip.settles_at, 7.2)


def script(diagram_lines="diagram: waffle\n  on: 1-3 \"a\" @ \"three\"", say="One two three four five six."):
    return f"""---
autocontent: reel
title: Seats
style: grid_pill
voice: af_heart
captions: on
---

## statement
headline: Short headline
align: top
say: {say}
{diagram_lines}

## caption
Seats.

## hashtags
#seats
"""


class ScriptTests(unittest.TestCase):
    def test_a_diagram_block_is_read_with_its_lines_kept_as_lines(self):
        r = parse_reel(script("diagram: seatmap\n  rows: 4 x 5\n  on: 1-6 \"sold\" @ \"six\""))
        self.assertTrue(r.ok, [str(i) for i in r.issues])
        d = r.scenes[0].diagram
        self.assertEqual(len(d.parts), 20)
        self.assertEqual(d.cues(), ["six"])
        self.assertNotIn("rows:", r.post_text)                      # none of it leaks into the slide

    def test_a_bad_diagram_is_an_error_that_says_which_slide_and_how_to_fix_it(self):
        r = parse_reel(script("diagram: spaceship"))
        errs = [i for i in r.issues if i.code == "DIAGRAM_BAD"]
        self.assertEqual(len(errs), 1)
        self.assertEqual(errs[0].slide, 1)
        self.assertIn("seatmap", errs[0].hint)
        self.assertFalse(r.ok)

    def test_a_cue_missing_from_the_narration_is_warned_about(self):
        r = parse_reel(script("diagram: waffle\n  on: 1-3 @ \"seventeen\""))
        self.assertTrue(r.ok)
        self.assertTrue(any(i.code == "DIAGRAM_CUE_NOT_FOUND" for i in r.issues))
        ok = parse_reel(script())
        self.assertFalse(any(i.code == "DIAGRAM_CUE_NOT_FOUND" for i in ok.issues))

    def test_a_crowded_diagram_slide_is_warned_about(self):
        text = script().replace("headline: Short headline", "headline: A very long headline that goes on and on and on for far too long\nbody: and a long body line too with many more words than any diagram slide can take")
        r = parse_reel(text)
        self.assertTrue(any(i.code == "DIAGRAM_CROWDED" for i in r.issues))

    def test_diagram_keys_never_collide_with_the_slide_keys(self):
        from autocontent.reel.script import SCENE_KEYS
        keys = {"shape", "rows", "cols", "count", "stage", "layout", "item", "row", "head", "on", "warn", "base",
                "ghost", "appear", "mark", "legend", "at", "size", "gap", "heat", "value", "max", "limit",
                "limit_label", "unit", "label", "note", "x", "y", "point", "box", "dot", "circle", "text",
                "arrow", "line", "leader", "root", "set", "overlap", "layer", "title"}
        self.assertEqual(keys & set(SCENE_KEYS), set())


@unittest.skipUnless(CHROMIUM and FFMPEG, "needs Chromium and ffmpeg")
class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        from tests.test_reel_engine import tone_voice
        from autocontent.reel import make_reel
        cls.tmp = tempfile.mkdtemp()
        cls.logs = []
        cls.out = Path(cls.tmp) / "out"
        text = script("diagram: seatmap\n  rows: 8 x 16\n  on: 1-48 \"sold\" @ \"six\"\n  warn: 100-103 @ \"five\"",
                      say="One two three four five six. Then seven eight nine ten eleven twelve thirteen.")
        text = text.replace("## caption", "## cta\nheadline: Pick one\npill: SAVE THIS\nsay: Which one will you fix first?\n\n## caption")
        cls.summary = make_reel(text, cls.out, engine=tone_voice, fetch_images=False, progress=cls.logs.append)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def frame(self, sec):
        from PIL import Image
        png = Path(self.tmp) / f"f_{sec}.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(sec), "-i", str(self.out / "reel.mp4"),
                        "-frames:v", "1", str(png)], check=True)
        return np.asarray(Image.open(png).convert("RGB"), dtype=np.int16)

    def test_the_diagram_changes_as_its_words_are_spoken(self):
        tl = self.summary["timeline"][0]
        early = self.frame(tl["start"] + 0.6)
        late = self.frame(tl["end"] - 0.7)
        accent = (early[..., 0] > 200) & (early[..., 1] < 110) & (early[..., 2] < 90)
        accent_late = (late[..., 0] > 200) & (late[..., 1] < 110) & (late[..., 2] < 90)
        # the sold seats (accent colour) are in the later frame and not the earlier one
        self.assertGreater(int(accent_late[900:1450].sum()), int(accent[900:1450].sum()) + 1000)

    def test_a_reel_with_a_diagram_is_still_a_reel(self):
        self.assertEqual(len(self.summary["timeline"]), 2)
        self.assertTrue((self.out / "reel.mp4").is_file())


if __name__ == "__main__":
    unittest.main()
