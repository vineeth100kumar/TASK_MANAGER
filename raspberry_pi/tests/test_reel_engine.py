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
from autocontent.reel import align, captions, compose, timing, voice  # noqa: E402
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
            gone = tl.frame(3.95)[700, 300]
            self.assertTrue((gone > after).all(), motion + " should be leaving by the end")

    def test_settled_frames_are_reused(self):
        tl = compose.Timeline([self.clip()], [], 4.0)
        a = tl.frame(2.0)
        b = tl.frame(2.1)
        self.assertIs(a, b)

    def test_caption_shows_only_in_its_window(self):
        from PIL import Image
        cap = compose.CaptionClip(1.0, 2.0, Image.new("RGBA", (300, 80), (0, 0, 255, 255)), (390, 1550))
        tl = compose.Timeline([self.clip()], [cap], 4.0)
        self.assertTrue((tl.frame(0.5)[1580, 540] == 255).all())
        self.assertEqual(tuple(tl.frame(1.5)[1580, 540]), (0, 0, 255))
        self.assertTrue((tl.frame(2.5)[1580, 540] == 255).all())


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
            self.assertTrue(all(t["start"] <= r < t["end"] for r in t["reveals"]))
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
