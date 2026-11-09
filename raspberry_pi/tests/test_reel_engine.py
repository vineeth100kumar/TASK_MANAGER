"""Tests for the reel engine (content_engine/src/autocontent/reel): reading a script, timing, voice
text, captions, compositing, and a whole reel made end to end.

    cd raspberry_pi && python -m unittest tests.test_reel_engine

Kokoro and Whisper are not run here (their models are downloaded on the Pi): a stand-in voice that
makes one tone burst per word takes the voice's place, and word timing uses the model-free backend.
The end-to-end test needs a Chromium (AUTOCONTENT_CHROMIUM or /opt/pw-browsers/chromium) and ffmpeg.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

ENGINE_SRC = Path(__file__).resolve().parent.parent / "content_engine" / "src"
sys.path.insert(0, str(ENGINE_SRC))

from autocontent.reel import parse_reel, is_reel_text  # noqa: E402
from autocontent.reel import align, captions, compose, layers, timing, voice  # noqa: E402
from autocontent.reel.align import Timed  # noqa: E402

CHROMIUM = os.environ.get("AUTOCONTENT_CHROMIUM") or ("/opt/pw-browsers/chromium" if Path("/opt/pw-browsers/chromium").exists() else "")
FFMPEG = shutil.which("ffmpeg") is not None

SCRIPT = """---
autocontent: reel
title: Shops online
style: grid_pill
voice: af_heart
captions: on
music: upbeat
tag: "#smallbusiness"
---

## cover
kicker: THE QUIET TRUTH
headline: 9 in 10 shops still sell **offline**
pill: offline
say: Nine in ten corner shops still sell offline only.

## stat
headline: Repeat customers bring in
number: 65%
body: of a typical shop's sales.
source: Retail survey 2024
motion: pop
say: Your regulars are already two thirds
  of your sales, so start with them.
show: your regulars | two thirds

## list
headline: Go online this weekend
1. Photograph your best-sellers
2. Build a WhatsApp catalogue
3. Put a QR code on the counter
say: Here is the plan. First, photograph your best sellers. Second, build a catalogue. Third, put a code on the counter.

## cta
headline: Which step comes first?
subtext: COMMENT 1, 2 OR 3
pill: SAVE THIS
theme: dark
say: Tell me which step you will do first.

## caption
Most corner shops never go online.

## hashtags
#smallbusiness #retail
"""


def tone_voice(text, voice_name, speed):
    """A stand-in for Kokoro: one tone burst per word, longer words longer."""
    sig = []
    for w in text.split():
        n = int(24000 * (0.10 + 0.05 * len(w)))
        sig.append(0.3 * np.sin(2 * np.pi * (150 + len(w) * 12) * np.arange(n) / 24000) * np.hanning(n) ** 0.4)
        sig.append(np.zeros(int(24000 * (0.22 if w.endswith((".", ",")) else 0.03))))
    return np.concatenate(sig).astype("float32")


class ReelScriptTests(unittest.TestCase):
    def test_reel_lines_are_lifted_and_slides_read_like_a_post(self):
        r = parse_reel(SCRIPT)
        self.assertTrue(r.ok, [str(i) for i in r.issues if i.severity == "ERROR"])
        self.assertEqual([s.slide["type"] for s in r.scenes], ["cover", "stat", "list", "cta"])
        self.assertEqual(r.scenes[1].say, "Your regulars are already two thirds of your sales, so start with them.")
        self.assertEqual(r.scenes[1].show, ["your regulars", "two thirds"])
        self.assertEqual(r.scenes[1].motion, "pop")
        self.assertEqual(r.scenes[0].motion, "rise")      # the cover's usual motion
        self.assertEqual(r.scenes[2].motion, "stagger")   # a list's usual motion
        self.assertEqual(r.meta["format"], "reel")
        self.assertEqual(r.meta["voice"], "af_heart")
        self.assertEqual(r.caption.strip(), "Most corner shops never go online.")
        self.assertFalse(r.uses_own_voice)

    def test_reel_lines_never_end_up_in_the_slides(self):
        r = parse_reel(SCRIPT)
        for sc in r.scenes:
            for value in sc.slide.values():
                self.assertNotIn("Nine in ten", str(value))
        self.assertNotIn("say:", r.post_text)
        self.assertEqual(len(r.post_text.split("\n")), len(SCRIPT.split("\n")))   # line numbers still match the file

    def test_issues_point_at_the_authors_lines(self):
        text = SCRIPT.replace("headline: Which step comes first?", "headline: Which step comes first?\nbody: x")
        r = parse_reel(text)
        line = next(i for i in r.issues if "'body:'" in i.message).line
        self.assertEqual(text.split("\n")[line - 1].strip(), "body: x")

    def test_music_and_format_lines_are_ignored_with_a_warning(self):
        r = parse_reel(SCRIPT.replace("music: upbeat", "music: upbeat\nformat: portrait"))
        codes = {i.code for i in r.issues}
        self.assertIn("MUSIC_IGNORED", codes)
        self.assertIn("FORMAT_FIXED", codes)
        self.assertEqual(r.meta["format"], "reel")

    def test_checks(self):
        no_say = "\n".join(l for l in SCRIPT.split("\n") if not l.startswith(("say:", "  of your"))).replace("show: your regulars | two thirds\n", "")
        r = parse_reel(no_say)
        self.assertIn("NO_NARRATION", {i.code for i in r.errors})
        r = parse_reel(SCRIPT.replace("show: your regulars | two thirds", "show: nothing like it"))
        self.assertIn("CUE_NOT_FOUND", {i.code for i in r.issues})
        r = parse_reel(SCRIPT.replace("say: Tell me which step you will do first.", "say: " + "word " * 70))
        self.assertIn("SCENE_LONG", {i.code for i in r.issues})
        self.assertIn("SCENE_SILENT", {i.code for i in parse_reel(SCRIPT.replace("say: Tell me which step you will do first.", "")).issues})
        self.assertIn("MOTION_UNKNOWN", {i.code for i in parse_reel(SCRIPT.replace("motion: pop", "motion: spin")).issues})

    def test_not_a_reel(self):
        self.assertFalse(is_reel_text("---\nautocontent: post\n---\n"))
        self.assertTrue(is_reel_text(SCRIPT))
        r = parse_reel("---\nautocontent: post\n---\n## cover\nheadline: x\n")
        self.assertIn("NOT_A_REEL", {i.code for i in r.errors})

    def test_own_voice(self):
        r = parse_reel(SCRIPT.replace("voice: af_heart", "voice: mine"))
        self.assertTrue(r.uses_own_voice)

    def test_estimate(self):
        r = parse_reel(SCRIPT)
        self.assertTrue(10 < r.estimate_seconds() < 60)


class TimingTests(unittest.TestCase):
    WORDS = [Timed(w, 1.0 + i * 0.4, 1.0 + i * 0.4 + 0.3) for i, w in enumerate("your regulars are already two thirds of your sales".split())]

    def test_cues_find_their_words(self):
        self.assertEqual(timing.find_cue("two thirds", self.WORDS, 0), 4)
        self.assertEqual(timing.find_cue("Two, thirds!", self.WORDS, 0), 4)
        self.assertIsNone(timing.find_cue("nowhere", self.WORDS, 0))

    def test_reveals_follow_the_cues(self):
        t = timing.plan_reveals(3, ["your regulars", "two thirds"], self.WORDS, 0.8, 6.0, 0.3)
        self.assertEqual(len(t), 3)
        self.assertAlmostEqual(t[0], 0.8 + timing.OPEN, places=2)         # opens with the slide
        self.assertGreaterEqual(t[1], t[0] + timing.MIN_STEP - 1e-9)       # a cue at the very start waits for the opener
        self.assertAlmostEqual(t[2], self.WORDS[4].start - timing.LEAD, places=2)
        self.assertTrue(t[0] < t[1] < t[2])

    def test_reveals_spread_without_cues_and_never_bunch_up(self):
        t = timing.plan_reveals(4, [], self.WORDS, 0.8, 6.0, 0.3)
        self.assertEqual(len(t), 4)
        for a, b in zip(t, t[1:]):
            self.assertGreaterEqual(b - a, 0.12 - 1e-9)
        self.assertLessEqual(max(t), 6.0)
        self.assertEqual(timing.plan_reveals(0, [], self.WORDS, 0, 5, 0.3), [])

    def test_windows_cover_the_reel_without_gaps(self):
        spans = [(0.1, 3.0), (3.6, 7.0), None, (10.0, 12.5)]
        w = timing.scene_windows(spans, [None, None, 2.0, None], 1.2, 0.3)
        self.assertEqual(w[0][0], 0.0)
        for a, b in zip(w, w[1:]):
            self.assertAlmostEqual(a[1], b[0], places=6)
        self.assertGreater(w[-1][1], 12.5)
        for a, b in w:
            self.assertGreater(b - a, 1.0)


class AlignTests(unittest.TestCase):
    def test_spread_follows_the_words(self):
        words = "one two three four".split()
        t = align.spread(words, [(0.0, 2.0)])
        self.assertEqual(len(t), 4)
        self.assertTrue(all(a.end <= b.start + 1e-6 for a, b in zip(t, t[1:])))
        self.assertAlmostEqual(t[0].start, 0.0, places=2)

    def test_spread_puts_a_sentence_break_on_the_silence(self):
        words = "hello there. next sentence here".split()
        t = align.spread(words, [(0.0, 1.0), (2.0, 3.5)])
        first_after_gap = next(x for x in t if x.start >= 1.0)
        self.assertGreaterEqual(first_after_gap.start, 2.0 - 1e-6)

    def test_match_uses_recognised_times_and_fills_gaps(self):
        script = "nine in ten corner shops sell offline".split()
        heard = [Timed("nine", 0.2, 0.5), Timed("in", 0.5, 0.6), Timed("10", 0.6, 0.9),   # "ten" heard as "10"
                 Timed("shops", 1.5, 1.9), Timed("sell", 1.9, 2.2), Timed("offline", 2.2, 2.8)]
        t = align.match(script, heard)
        self.assertEqual([x.text for x in t], script)
        self.assertEqual(t[4].start, 1.5)
        self.assertTrue(0.9 <= t[3].start < 1.5)                    # "corner" was missed: placed in the gap
        self.assertTrue(all(a.start <= b.start for a, b in zip(t, t[1:])))

    @unittest.skipUnless(FFMPEG, "no ffmpeg")
    def test_speech_segments_and_spread_on_real_audio(self):
        with tempfile.TemporaryDirectory() as d:
            wav = Path(d) / "a.wav"
            words = "alpha beta gamma. delta epsilon".split()
            sig = []
            for w in words:
                n = int(24000 * (0.12 + 0.04 * len(w)))
                sig.append(0.4 * np.sin(2 * np.pi * 200 * np.arange(n) / 24000))
                sig.append(np.zeros(int(24000 * (0.6 if w.endswith(".") else 0.04))))
            voice.write_wav(wav, np.concatenate(sig))
            segs = align.speech_segments(wav)
            self.assertGreaterEqual(len(segs), 2)                   # the sentence break is found
            t, used = align.align(wav, words, backend="spread")
            self.assertEqual(used, "spread")
            self.assertEqual(len(t), 5)
            self.assertAlmostEqual(align.duration(wav), len(np.concatenate(sig)) / 24000, places=1)


class VoiceTextTests(unittest.TestCase):
    def test_speakable(self):
        self.assertEqual(voice.speakable("151% a year"), "151 percent a year")
        self.assertEqual(voice.speakable("It costs ₹5.2 lakh."), "It costs 5.2 lakh rupees.")
        self.assertEqual(voice.speakable("Only ₹10 crore"), "Only 10 crore rupees")
        self.assertEqual(voice.speakable("Pay $5 now"), "Pay 5 dollars now")
        self.assertEqual(voice.speakable("3x faster & cheaper"), "3 times faster and cheaper")
        self.assertEqual(voice.speakable("up to 1,20,000"), "up to 120000")

    def test_voice_names(self):
        self.assertIsNone(voice.check_voice("af_heart"))
        self.assertIsNotNone(voice.check_voice("en-US-AriaNeural"))

    @unittest.skipUnless(FFMPEG, "no ffmpeg")
    def test_tts_track_has_windows_in_order(self):
        with tempfile.TemporaryDirectory() as d:
            r = parse_reel(SCRIPT)
            track = voice.render_tts(r.scenes, "af_heart", 1.0, Path(d), engine=tone_voice)
            self.assertEqual(len(track.windows), 4)
            self.assertTrue(all(a < b for a, b in track.windows))
            self.assertTrue(all(x[1] <= y[0] for x, y in zip(track.windows, track.windows[1:])))
            self.assertAlmostEqual(track.windows[-1][1], track.seconds, delta=1.0)


class CaptionTests(unittest.TestCase):
    def words(self, text, start=0.0, step=0.3):
        return [Timed(w, start + i * step, start + i * step + 0.25) for i, w in enumerate(text.split())]

    def test_phrases_are_short_and_never_cross_slides(self):
        ph = captions.make_phrases([(1, self.words("Nine in ten corner shops still sell offline only.")),
                                    (2, self.words("Your regulars are already two thirds of your sales.", 5.0))])
        self.assertTrue(all(1 <= len(p.words) <= captions.MAX_WORDS for p in ph))
        self.assertEqual({p.scene for p in ph}, {1, 2})
        self.assertEqual(sum(len(p.words) for p in ph), 18)
        for p in ph:
            self.assertLessEqual(len(" ".join(w.text for w in p.words)), captions.MAX_CHARS + 6)

    def test_a_sentence_end_starts_a_new_phrase(self):
        ph = captions.make_phrases([(1, self.words("Go. Now then."))])
        self.assertEqual([len(p.words) for p in ph], [1, 2])


class ComposeTests(unittest.TestCase):
    def clip(self, motion="rise", t0=0.0, t1=4.0):
        from PIL import Image
        base = Image.new("RGB", (compose.W, compose.H), (255, 255, 255))
        piece = Image.new("RGBA", (400, 200), (20, 20, 20, 255))
        return compose.SceneClip(t0, t1, base, [compose.Piece(piece, (100, 600, 400, 200), at=1.0)], motion)

    def test_pieces_arrive_over_time_and_leave(self):
        for motion in compose.ENTER:
            tl = compose.Timeline([self.clip(motion)], [], 4.0)
            before = tl.frame(0.5)[700, 300]
            during = tl.frame(1.2)[700, 300]
            after = tl.frame(2.5)[700, 300]
            self.assertTrue((before == 255).all(), motion)
            self.assertTrue((after < 60).all(), motion)
            self.assertTrue(during.shape == (3,))
            # a piece is not faded out at the end: the next slide's wipe carries it away, which is
            # what keeps the change from showing a bare backdrop (see test_one_slide_wipes_into_the_next)
            self.assertTrue((tl.frame(3.95)[700, 300] == after).all(), motion)

    def test_each_kind_of_thing_arrives_its_own_way(self):
        """The point of the reel: a headline is not animated like a number or a picture."""
        self.assertEqual(compose.piece_motion("stat-number")[0], "punch")
        self.assertEqual(compose.piece_motion("cover-headline")[0], "words")   # text writes itself
        self.assertEqual(compose.piece_motion("image-frame")[0], "reveal")
        self.assertEqual(compose.piece_motion("data-table")[0], "grow")
        self.assertEqual(compose.piece_motion("list-item")[0], "words")        # a step is typed, its badge pops
        self.assertEqual(compose.piece_motion("compare-col right")[0], "words")
        self.assertEqual(compose.piece_motion("accent-pill")[0], "words")      # pill laid down, then typed on
        self.assertEqual(compose.piece_motion("kicker")[0], "label")           # a label rises out of a slot
        self.assertEqual(compose.piece_motion("mystery-thing", "rise"), ("rise", 0))   # unknown: the slide's own

    def test_a_piece_uses_its_own_motion_over_the_slides(self):
        clip = self.clip("rise")
        clip.pieces[0].motion = "punch"
        dur = compose.MOTIONS["punch"][0]
        small = compose._piece_state(clip.pieces[0], 1.0 + dur * 0.15, clip.motion, clip)[0]
        over = compose._piece_state(clip.pieces[0], 1.0 + dur * 0.55, clip.motion, clip)[0]
        done = compose._piece_state(clip.pieces[0], 1.0 + dur, clip.motion, clip)[0]
        self.assertLess(small.shape[1], 400)        # it starts small...
        self.assertGreater(over.shape[1], 400)      # ...overshoots its size...
        self.assertEqual(done.shape[1], 400)        # ...and settles, never sliding down the screen

    def test_nothing_pans_across_the_screen(self):
        """The slide is drawn at the video's own size: the text sits still, it is never panned."""
        self.assertEqual(layers.OVERSAMPLE, 1.0)
        self.assertFalse(hasattr(compose, "pan_for"))
        clip = self.clip()
        tl = compose.Timeline([clip], [], 4.0)
        a, b = tl.frame(2.0), tl.frame(2.4)        # settled: not one pixel moves (below the progress bar)
        self.assertTrue((a[compose.BAR_H:] == b[compose.BAR_H:]).all())

    def test_text_is_typed_out_word_by_word(self):
        from PIL import Image
        piece = compose.Piece(image=Image.new("RGBA", (400, 60), (0, 0, 0, 255)), box=(100, 700, 400, 60),
                              at=1.0, motion="words",
                              words=[(0, 0, 130, 60), (130, 0, 130, 60), (260, 0, 140, 60)])
        plan = piece.typing
        self.assertEqual(len(plan), 3)
        for (a0, d0), (a1, _) in zip(plan, plan[1:]):
            self.assertGreater(a1, a0 + d0 - 1e-6)        # one word, then the next
        clip = compose.SceneClip(0.0, 4.0, Image.new("RGB", (compose.W, compose.H), (255, 255, 255)), [piece])
        at = lambda t: compose._word_states(piece, t, clip)
        self.assertEqual(at(0.9), [])
        half = at(1.0 + plan[0][1] / 2)
        self.assertEqual(len(half), 2)                     # half of the first word, and the caret
        self.assertLess(half[0][0].shape[1], 130)
        self.assertEqual(len(at(1.0 + plan[1][0] + plan[1][1] / 2)), 3)
        done = at(1.0 + plan[-1][0] + plan[-1][1] + 0.01)
        self.assertEqual(len(done), 3, "the caret goes once the line is typed")
        self.assertEqual([a.shape[1] for a, *_ in done], [130, 130, 140])

    def test_the_caret_stands_where_the_typing_has_reached(self):
        from PIL import Image
        piece = compose.Piece(image=Image.new("RGBA", (400, 60), (0, 0, 0, 255)), box=(100, 700, 400, 60),
                              at=1.0, motion="words", words=[(0, 0, 200, 60), (200, 0, 200, 60)],
                              accents=[1], accent_rgb=(238, 68, 37))
        clip = compose.SceneClip(0.0, 4.0, Image.new("RGB", (compose.W, compose.H), (255, 255, 255)), [piece])
        a0, d0 = piece.typing[0]
        early = compose._word_states(piece, 1.0 + d0 * 0.25, clip)
        late = compose._word_states(piece, 1.0 + d0 * 0.75, clip)
        caret = lambda states: next(s for s in states if s[0].shape[1] == compose.CARET_W)
        self.assertEqual(tuple(caret(early)[0][0, 0, :3]), (238, 68, 37))
        self.assertLess(caret(early)[1], caret(late)[1], "the caret moves along as the text is typed")

    def test_a_spelled_out_abbreviation_reads_as_a_word(self):
        """`say: N X P` makes the voice read the letters; the caption should still show NXP."""
        make = lambda text: [align.Timed(w, i * 0.3, i * 0.3 + 0.25) for i, w in enumerate(text.split())]
        said = lambda text: [w.text for w in captions.join_spelled(make(text))]
        self.assertEqual(said("N X P restructured, then listed"), ["NXP", "restructured,", "then", "listed"])
        self.assertEqual(said("running on A I. devices"), ["running", "on", "AI.", "devices"])
        self.assertEqual(said("In the U K, sales rose"), ["In", "the", "UK,", "sales", "rose"])
        self.assertEqual(said("a I think so"), ["a", "I", "think", "so"])   # ordinary words are left alone
        joined = captions.join_spelled(make("N X P grew"))[0]
        self.assertAlmostEqual(joined.start, 0.0)
        self.assertAlmostEqual(joined.end, 0.85)      # it is lit for as long as the letters are said

    def test_two_captions_are_never_on_screen_together(self):
        from PIL import Image
        pic = Image.new("RGBA", (200, 80), (0, 0, 0, 255))
        clips = [compose.CaptionClip(0.0, 1.4, pic, (0, 1550)),     # runs past the next one
                 compose.CaptionClip(1.0, 1.6, pic, (0, 1550)),
                 compose.CaptionClip(4.0, 4.2, pic, (0, 1550))]     # a gap before this one
        out = compose.tidy_captions(clips)
        for a, b in zip(out, out[1:]):
            self.assertLessEqual(a.t1, b.t0, "captions must not overlap")
        self.assertEqual(out[1].t1, 3.1, "the last caption of a phrase holds into the gap, up to 1.5s")

    def test_a_big_number_counts_up_to_itself(self):
        from PIL import Image
        steps = layers.count_steps("65%")
        self.assertEqual(steps[-1], "65%")
        self.assertTrue(all(s.endswith("%") for s in steps))
        values = [float(s[:-1]) for s in steps]
        self.assertEqual(values, sorted(values))
        self.assertLess(values[0], 30)
        self.assertEqual(layers.count_steps("Hello"), [])      # nothing to count
        self.assertEqual(layers.count_steps("3x"), [])         # too small to be worth it
        self.assertEqual(layers.count_steps("1,250")[-1], "1,250")
        frames = [Image.new("RGBA", (300, 200), (i * 8, 0, 0, 255)) for i in range(10)]
        piece = compose.Piece(image=frames[-1], box=(100, 700, 300, 200), at=1.0, count=frames)
        clip = compose.SceneClip(0.0, 4.0, Image.new("RGB", (compose.W, compose.H), (255, 255, 255)), [piece])
        self.assertEqual(piece.how("rise"), "count")
        early = compose._piece_state(piece, 1.05, "rise", clip)[0][0, 0, 0]
        late = compose._piece_state(piece, 1.0 + compose.MOTIONS["count"][0] * 0.9, "rise", clip)[0][0, 0, 0]
        self.assertLess(early, late, "the number should still be counting up")
        self.assertEqual(compose._piece_state(piece, 2.9, "rise", clip)[0][0, 0, 0], frames[-1].getpixel((0, 0))[0])

    def test_one_slide_wipes_into_the_next(self):
        from PIL import Image
        light = self.clip(t0=0.0, t1=4.0)
        dark = self.clip(t0=4.0, t1=8.0)
        dark.base = Image.new("RGB", (compose.W, compose.H), (0, 0, 0))
        tl = compose.Timeline([light, dark], [], 8.0)
        top = tl.frame(4.0 - compose.EXIT / 2)[20, 540]
        self.assertTrue((top < 200).all(), "the next slide should be wiping in over this one")
        self.assertTrue((tl.frame(3.5)[20, 540] == 255).all(), "and not before it leaves")

    def test_settled_frames_are_reused(self):
        tl = compose.Timeline([self.clip()], [], 4.0)
        tl.frame(2.0)
        inner = tl._cache[0]                        # the slide itself is drawn once and kept...
        tl.frame(2.1)
        self.assertIs(tl._cache[0], inner)
        self.assertFalse((tl.frame(2.0)[0] == tl.frame(3.0)[0]).all())   # ...only the bar moves on

    def test_caption_shows_only_in_its_window(self):
        from PIL import Image
        cap = compose.CaptionClip(1.0, 2.0, Image.new("RGBA", (300, 80), (0, 0, 255, 255)), (390, 1550))
        tl = compose.Timeline([self.clip()], [cap], 4.0)
        self.assertTrue((tl.frame(0.5)[1580, 540] == 255).all())
        self.assertEqual(tuple(tl.frame(1.5)[1580, 540]), (0, 0, 255))
        self.assertTrue((tl.frame(2.5)[1580, 540] == 255).all())


class CrowdedSlideTests(unittest.TestCase):
    """A script can arrive with far more on a slide than a phone screen holds — an AI wrote it, or
    the author pasted a paragraph. The check says so, and the renderer makes it fit anyway."""

    HUGE = """---
autocontent: reel
title: Too much
voice: af_heart
---

## point
kicker: A KICKER THAT IS FAR TOO LONG TO BE A LABEL
headline: This headline goes on and on and will not fit the screen at all
- The financial crisis hurt sales and profitability across the whole business
- Its two thousand and ten stock listing helped repay a great deal of debt
- A third bullet that also runs on well past the room a reel screen has
- And a fourth one, because nothing stopped the writer putting it in
- And a fifth for good measure
source: Somewhere, 2026
say: There is far too much on this slide for anyone to read in four seconds.
"""

    def test_an_overstuffed_slide_is_an_error_with_a_way_out(self):
        reel = parse_reel(self.HUGE)
        codes = [i.code for i in reel.issues]
        self.assertIn("SLIDE_TOO_FULL", codes)
        self.assertFalse(reel.ok, "it should stop before anything is drawn")
        too_full = next(i for i in reel.issues if i.code == "SLIDE_TOO_FULL")
        self.assertEqual(too_full.slide, 1)
        self.assertIn("Split it", too_full.hint)
        self.assertIn("KICKER_LONG", codes)
        self.assertIn("HEADLINE_LONG", codes)

    FULL = """---
autocontent: reel
title: A full slide
voice: af_heart
---

## cover
headline: Three habits that save an **hour**
say: Three small habits give you back an hour a day.

## point
headline: What the crisis did
- The financial crisis hurt sales and profitability
- The 2010 listing helped repay a good deal of debt
- Restructuring took the best part of two long years
say: The financial crisis hit sales and profits, and the listing helped repay debt.
"""

    def test_a_full_slide_is_only_a_warning(self):
        reel = parse_reel(self.FULL)
        self.assertTrue(reel.ok, [i.message for i in reel.errors])
        self.assertIn("SLIDE_FULL", [i.code for i in reel.issues])

    @unittest.skipUnless(CHROMIUM, "needs Chromium")
    def test_the_renderer_makes_a_full_slide_fit_above_the_captions(self):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        """The fail-safe: whatever the script asks for, the slide's own content stops above the
        band the spoken captions run in. Nothing may be drawn over them."""
        from autocontent.render.renderer import SlideRenderer, browser_launch_options
        from autocontent.render.style_config import CANVAS_FORMATS
        from playwright.sync_api import sync_playwright
        floor = CANVAS_FORMATS["reel"]["content_bottom"]
        slide = {"n": 1, "type": "point", "kicker": "2008-2010: THE EARLY TEST",
                 "headline": "A difficult start led to **restructuring** of the whole business",
                 "bullets": ["The financial crisis hurt sales and profitability",
                             "Its 2010 stock listing helped repay a great deal of debt",
                             "A third bullet, because an AI wrote the script"],
                 "source_note": "NXP SEC Form 6-K, Nov 2010"}
        renderer = SlideRenderer("grid_pill", canvas_format="reel")
        renderer.collect_fit = True
        with sync_playwright() as pw:
            browser = pw.chromium.launch(**browser_launch_options())
            page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
            renderer.lay_out(page, slide, renderer.build_slide_html(slide, {"page_name": "Mind Deeds", "handle": "@mind.deeds"}, 1, 1))
            bottom = page.evaluate("""() => Math.max(0, ...[...document.querySelectorAll('.content-container *')]
                .map((e) => e.getBoundingClientRect().bottom).filter((v) => v > 0))""")
            browser.close()
        self.assertTrue(renderer.fit_report[0]["ok"], renderer.fit_report[0]["problems"])
        self.assertLessEqual(bottom, floor + 1, "the slide's content must stop above the caption band")


class MotionTests(unittest.TestCase):
    """Each thing on a slide arrives the way that kind of thing would."""

    def base(self):
        from PIL import Image
        return Image.new("RGB", (compose.W, compose.H), (255, 255, 255))

    def test_a_highlight_with_an_apostrophe_is_coloured_not_printed(self):
        from autocontent.render.renderer import decorate_html
        html = "<style></style><body><h1>The Freescale merger ==expanded NXP's reach.==</h1></body>"
        out = decorate_html(html, {}, "#EE4425")
        self.assertIn('<span class="hlw">expanded NXP\'s reach.</span>', out)
        self.assertNotIn("==", out.split("<body")[1])

    def test_a_stray_highlight_mark_is_dropped(self):
        from autocontent.render.renderer import decorate_html
        out = decorate_html('<style></style><body><h1 class="x">An ==unclosed mark</h1></body>', {}, "#EE4425")
        self.assertNotIn("==", out.split("<body")[1])
        self.assertIn("An unclosed mark", out)

    def test_a_label_rises_out_of_a_slot(self):
        from PIL import Image
        piece = compose.Piece(Image.new("RGBA", (300, 40), (238, 68, 37, 255)), (100, 300, 300, 40), at=1.0, motion="label")
        clip = compose.SceneClip(0, 4, self.base(), [piece])
        dur = compose.MOTIONS["label"][0]
        arr, x, y, op = compose._piece_state(piece, 1.0 + dur * 0.3, "rise", clip)
        self.assertLess(arr.shape[0], 40)            # only its top shows yet...
        self.assertEqual(y + arr.shape[0], 340)      # ...standing on the label's own floor
        self.assertEqual(op, 1.0)                    # it is not faded in
        arr, x, y, op = compose._piece_state(piece, 1.0 + dur, "rise", clip)
        self.assertEqual((arr.shape[0], y), (40, 300))

    def piece_with_parts(self):
        """A 600x200 piece: a pill backing, a dot in front of the words, a rule under them."""
        from PIL import Image
        im = Image.new("RGBA", (600, 200), (0, 0, 0, 0))
        px = im.load()
        for xx in range(600):
            for yy in range(200):
                if 40 <= xx < 560 and 20 <= yy < 120:
                    px[xx, yy] = (238, 68, 37, 255)          # the pill
                if 10 <= xx < 30 and 60 <= yy < 80:
                    px[xx, yy] = (20, 20, 20, 255)           # the dot
                if 40 <= xx < 300 and 170 <= yy < 180:
                    px[xx, yy] = (238, 68, 37, 255)          # the rule
                if 80 <= xx < 520 and 45 <= yy < 95 and xx % 20 < 12:
                    px[xx, yy] = (255, 255, 255, 255)        # the words, white on the pill
        back = Image.new("RGBA", (600, 200), (0, 0, 0, 0))
        back.paste(im.crop((40, 20, 560, 120)).point(lambda v: v), (40, 20))
        bpx = back.load()
        for xx in range(40, 560):
            for yy in range(20, 120):
                bpx[xx, yy] = (238, 68, 37, 255)
        return compose.Piece(im, (100, 500, 600, 200), at=1.0, motion="words",
                             words=[(80, 45, 200, 50), (300, 45, 220, 50)],
                             decos=[(10, 60, 20, 20, "dot"), (40, 170, 260, 10, "line")],
                             backing=back, word_rgb=[(255, 255, 255), (255, 255, 255)])

    def test_a_pill_is_laid_down_before_its_text_is_typed(self):
        p = self.piece_with_parts()
        clip = compose.SceneClip(0, 6, self.base(), [p])
        tl = compose.Timeline([clip], [], 6.0, bar=False)
        early = tl.frame(1.0 + compose.BACK_IN * 0.3)
        self.assertEqual(tuple(early[500 + 70, 100 + 60]), (238, 68, 37))     # the pill's left end is down
        self.assertTrue((early[500 + 70, 100 + 540] == 255).all())            # its right end isn't yet
        self.assertGreater(p.lead_in, 0)                                       # the text waits for it

    def test_a_rule_under_the_text_is_drawn_after_the_typing(self):
        p = self.piece_with_parts()
        k = next(i for i, part in enumerate(p.deco_parts) if part[3] == "line")
        self.assertTrue(p.deco_parts[k][4], "a rule below the text comes after it")
        typed = p.lead_in + p.typing[-1][0] + p.typing[-1][1]
        self.assertGreater(p.deco_begins(k), typed - 0.1)
        dot = next(i for i, part in enumerate(p.deco_parts) if part[3] == "dot")
        self.assertLess(p.deco_begins(dot), p.lead_in + 0.01)                # the dot pops ahead of its line

    def test_the_caret_on_a_pill_is_the_text_colour(self):
        p = self.piece_with_parts()
        clip = compose.SceneClip(0, 6, self.base(), [p])
        t = 1.0 + p.lead_in + p.typing[0][1] * 0.5
        parts = compose._word_states(p, t, clip)
        caret = parts[-1][0]
        self.assertEqual(caret.shape[1], compose.CARET_W)
        self.assertEqual(tuple(caret[0, 0, :3]), (255, 255, 255))

    def test_a_background_line_is_drawn_on_then_keeps_flowing(self):
        from PIL import Image
        draw = [Image.new("RGBA", (40, 40), (i, 0, 0, 255)) for i in range(1, 11)]
        flow = [Image.new("RGBA", (40, 40), (0, i, 0, 255)) for i in range(1, 9)]
        d = compose.DoodleClip(draw, flow, (10, 300, 40, 40), at=1.0, length=600)
        self.assertIsNone(d.state(0.9))
        first = d.state(1.0 + 0.05)[0][0, 0, 0]
        later = d.state(1.0 + d.draw_takes * 0.8)[0][0, 0, 0]
        self.assertLess(first, later)                                          # the pen moves along it
        seen = {int(d.state(1.0 + d.draw_takes + 0.05 + k * 0.1)[0][0, 0, 1]) for k in range(40)}
        self.assertGreater(len(seen), 4)                                       # then the dashes run, looping
        clip = compose.SceneClip(0, 8, self.base(), [], doodles=[d])
        tl = compose.Timeline([clip], [], 8.0, bar=False)
        self.assertFalse((tl.frame(5.0)[310, 20] == tl.frame(5.2)[310, 20]).all())   # still moving when all else is still

    def test_background_lines_are_placed_clear_of_everything(self):
        from autocontent.reel import doodles
        shapes, _ = doodles._candidates(1080, 1920)
        # a fit that only exists far from the text in the corner
        idx = next(i for i, s in enumerate(shapes) if s["name"] == "wave" and s["scale"] == 1.0)
        found = [[idx, 300, 1200, 600.0]]
        picks = doodles.choose(found, shapes, 1, None, 1080, 1920)
        self.assertEqual(len(picks), 1)
        self.assertEqual(picks[0][0]["name"], "wave")
        self.assertEqual(doodles.choose([], shapes, 1, None, 1080, 1920), [])     # no room, no line
        d, w, h = doodles.transform("M 0 0 C 10 0, 20 10, 30 30", 2.0, True)
        self.assertEqual((w, h), (60.0, 60.0))
        self.assertTrue(d.startswith("M 60.0 0.0"))                            # mirrored: starts at the right

    @unittest.skipUnless(CHROMIUM, "needs Chromium")
    def test_lines_never_touch_the_words_on_a_real_slide(self):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        import tempfile
        from autocontent.render.renderer import SlideRenderer, browser_launch_options
        from autocontent.reel import doodles
        from playwright.sync_api import sync_playwright
        slide = {"n": 2, "type": "point", "kicker": "2006: A NEW COMPANY",
                 "headline": "Philips sold control of **its chip business.**",
                 "bullets": ["Investors bought an 80.1% stake.", "The business became NXP Semiconductors."]}
        renderer = SlideRenderer("grid_pill", canvas_format="reel")
        with sync_playwright() as pw, tempfile.TemporaryDirectory() as tmp:
            browser = pw.chromium.launch(**browser_launch_options())
            page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
            renderer.lay_out(page, slide, renderer.build_slide_html(slide, {"page_name": "Mind Deeds", "handle": "@mind.deeds"}, 3, 1))
            words = page.evaluate("""() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let n; while ((n = w.nextNode())) { if (!n.nodeValue.trim()) continue; const r = document.createRange();
                r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 1) out.push([b.left, b.top, b.right, b.bottom]); }
                return out; }""")
            lines = doodles.make(page, slide, "light", Path(tmp), 2, 1080, 1920)
            self.assertTrue(lines, "a slide with free room gets a line")
            for ln in lines:
                self.assertEqual(len(ln.draw), doodles.DRAW_FRAMES)
                self.assertEqual(len(ln.flow), doodles.FLOW_FRAMES)
                x, y, w, h = ln.box
                from PIL import Image
                ink = np.asarray(Image.open(ln.flow[0]))[..., 3] > 20
                ys, xs = np.nonzero(ink)
                for wx0, wy0, wx1, wy1 in words:
                    hit = ((xs + x >= wx0 - 8) & (xs + x <= wx1 + 8) & (ys + y >= wy0 - 8) & (ys + y <= wy1 + 8)).any()
                    self.assertFalse(hit, f"a line runs into text at {wx0:.0f},{wy0:.0f}")
                self.assertGreaterEqual(y, doodles.TOP_BAND - 10)
                self.assertLessEqual(y + h, doodles.CAPTION_BAND[0] + 10)
            browser.close()

    @unittest.skipUnless(CHROMIUM, "needs Chromium")
    def test_a_big_statement_with_a_highlight_still_fits(self):
        """The fail-safe shrank only childless elements, so a headline with a highlighted word in it
        (its words sit around a <span>) stayed huge and the slide failed."""
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        from autocontent.render.renderer import SlideRenderer, browser_launch_options
        from playwright.sync_api import sync_playwright
        slide = {"n": 1, "type": "statement", "kicker": "The real reason", "theme": "dark",
                 "headline": "It is not the tech. It is the **first 30 days.**"}
        renderer = SlideRenderer("beige_grain", canvas_format="reel")
        renderer.collect_fit = True
        with sync_playwright() as pw:
            browser = pw.chromium.launch(**browser_launch_options())
            page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
            renderer.lay_out(page, slide, renderer.build_slide_html(slide, {"page_name": "Mind Deeds", "handle": "@m"}, 1, 1))
            browser.close()
        self.assertTrue(renderer.fit_report[0]["ok"], renderer.fit_report[0]["problems"])

    @unittest.skipUnless(CHROMIUM, "needs Chromium")
    def test_a_tall_cover_headline_clears_the_brand_row_with_its_underline_under_it(self):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        from autocontent.render.renderer import SlideRenderer, browser_launch_options
        from playwright.sync_api import sync_playwright
        slide = {"n": 1, "type": "cover", "kicker": "THE QUIET TRUTH", "headline": "9 in 10 shops still sell **offline**"}
        renderer = SlideRenderer("beige_grain", canvas_format="reel")
        renderer.collect_fit = True
        with sync_playwright() as pw:
            browser = pw.chromium.launch(**browser_launch_options())
            page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
            renderer.lay_out(page, slide, renderer.build_slide_html(slide, {"page_name": "Mind Deeds", "handle": "@m"}, 1, 1))
            got = page.evaluate("""() => ({
                head: document.querySelector('.header-row').getBoundingClientRect().bottom,
                top: Math.min(...[...document.querySelectorAll('.headline-container *')].map((e) => e.getBoundingClientRect())
                     .filter((r) => r.height > 1).map((r) => r.top)),
                base: document.getElementById('baseline-anchor').getBoundingClientRect().bottom,
                line: document.querySelector('svg.doodle-underline polygon').getBoundingClientRect().top })""")
            browser.close()
        self.assertGreater(got["top"], got["head"] + 40)
        self.assertGreater(got["line"], got["base"])            # under the last line, not through it
        self.assertLess(got["line"], got["base"] + 60)


@unittest.skipUnless(CHROMIUM and FFMPEG, "needs Chromium and ffmpeg")
class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        cls.tmp = tempfile.mkdtemp()
        from autocontent.reel import make_reel
        cls.out = Path(cls.tmp) / "out"
        cls.logs = []
        cls.summary = make_reel(SCRIPT, cls.out, engine=tone_voice, fetch_images=False, progress=cls.logs.append)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def probe(self):
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt,r_frame_rate,duration",
                              "-of", "json", str(self.out / "reel.mp4")], capture_output=True, text=True)
        return {s["codec_name"]: s for s in json.loads(out.stdout)["streams"]}

    def test_the_file_is_a_phone_ready_reel(self):
        s = self.probe()
        self.assertEqual((s["h264"]["width"], s["h264"]["height"]), (1080, 1920))
        self.assertEqual(s["h264"]["pix_fmt"], "yuv420p")
        self.assertEqual(s["h264"]["r_frame_rate"], "30/1")
        self.assertIn("aac", s)
        self.assertAlmostEqual(float(s["h264"]["duration"]), self.summary["seconds"], delta=0.2)
        self.assertAlmostEqual(float(s["aac"]["duration"]), self.summary["seconds"], delta=0.3)
        head = (self.out / "reel.mp4").read_bytes()[:64]
        self.assertIn(b"ftyp", head)
        moov = (self.out / "reel.mp4").read_bytes()[:4000]
        self.assertIn(b"moov", moov)          # +faststart: playable before it has downloaded

    def test_the_files_that_go_with_it(self):
        for name in ("poster.jpg", "caption.txt", "reel.json", "script.md", "voice.wav"):
            self.assertTrue((self.out / name).is_file(), name)
        self.assertIn("corner shops", (self.out / "caption.txt").read_text(encoding="utf-8"))
        self.assertFalse((self.out / "work").exists())
        from PIL import Image
        with Image.open(self.out / "poster.jpg") as im:
            self.assertEqual(im.size, (1080, 1920))

    def test_timeline_is_in_order_and_music_warning_is_kept(self):
        tl = self.summary["timeline"]
        self.assertEqual([t["n"] for t in tl], [1, 2, 3, 4])
        for a, b in zip(tl, tl[1:]):
            self.assertAlmostEqual(a["end"], b["start"], places=2)
        for t in tl:
            self.assertEqual(t["reveals"], sorted(t["reveals"]))
            # the first thing on a slide may start while the one before is still wiping away
            self.assertTrue(all(t["start"] - compose.EXIT <= r < t["end"] for r in t["reveals"]))
        self.assertTrue(any("Music" in w for w in self.summary["warnings"]))
        self.assertTrue(self.summary["captions"])

    def test_pieces_really_arrive_one_after_another(self):
        """Frames just before and after a reveal differ only where the piece is."""
        t = self.summary["timeline"][2]       # the list slide
        r1, r2 = t["reveals"][1], t["reveals"][2]
        def frame(sec):
            png = Path(self.tmp) / f"f_{sec}.png"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(sec), "-i", str(self.out / "reel.mp4"), "-frames:v", "1", str(png)], check=True)
            from PIL import Image
            return np.asarray(Image.open(png).convert("L"), dtype=np.int16)
        before, after = frame(r2 - 0.1), frame(r2 + 0.9)
        diff = np.abs(after[:1450] - before[:1450]) > 40
        self.assertGreater(int(diff.sum()), 2000)                 # the next item appeared
        self.assertGreater(r2, r1)

    def test_a_slide_that_does_not_fit_is_refused_with_the_reason(self):
        from autocontent.reel import make_reel
        from autocontent.reel.pipeline import ReelError
        long_title = "word " * 90
        bad = SCRIPT.replace("headline: Go online this weekend", "headline: " + long_title)
        with self.assertRaises(ReelError) as ctx:
            make_reel(bad, Path(self.tmp) / "bad", engine=tone_voice, fetch_images=False, progress=lambda s: None)
        self.assertTrue(str(ctx.exception) or ctx.exception.issues)

    def test_unknown_voice_and_missing_recording_are_plain_errors(self):
        from autocontent.reel import make_reel
        from autocontent.reel.pipeline import ReelError
        with self.assertRaises(ReelError) as ctx:
            make_reel(SCRIPT.replace("af_heart", "nonsense"), Path(self.tmp) / "v", engine=tone_voice, progress=lambda s: None)
        self.assertIn("voice", str(ctx.exception))
        with self.assertRaises(ReelError) as ctx:
            make_reel(SCRIPT.replace("af_heart", "mine"), Path(self.tmp) / "m", progress=lambda s: None)
        self.assertIn("recording", str(ctx.exception))

    def test_your_own_recording(self):
        from autocontent.reel import make_reel
        wav = Path(self.tmp) / "mine.wav"
        text = " ".join(s for s in ("Nine in ten corner shops still sell offline only.",
                                    "Your regulars are already two thirds of your sales, so start with them.",
                                    "Here is the plan. First, photograph your best sellers. Second, build a catalogue. Third, put a code on the counter.",
                                    "Tell me which step you will do first."))
        voice.write_wav(wav, tone_voice(text, "x", 1.0))
        out = Path(self.tmp) / "mine_out"
        s = make_reel(SCRIPT.replace("af_heart", "mine"), out, voice_file=wav, fetch_images=False, progress=lambda m: None)
        self.assertEqual(s["voice"], "own recording")
        self.assertTrue((out / "reel.mp4").is_file())
        self.assertEqual([t["n"] for t in s["timeline"]], [1, 2, 3, 4])


if __name__ == "__main__":
    unittest.main()
