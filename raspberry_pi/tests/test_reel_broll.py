"""Stock footage (b-roll) behind reel scenes: the `clip:` line, its checks, the footage search and
download (all network replaced), the frame backdrop, and a mixed reel made end to end.

    cd raspberry_pi && python -m unittest tests.test_reel_broll
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

ENGINE_SRC = Path(__file__).resolve().parent.parent / "content_engine" / "src"
sys.path.insert(0, str(ENGINE_SRC))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from autocontent import settings  # noqa: E402
from autocontent.reel import broll, compose, parse_reel  # noqa: E402
from autocontent.reel import pipeline  # noqa: E402
from autocontent.spec.stock import StockError  # noqa: E402

CHROMIUM = os.environ.get("AUTOCONTENT_CHROMIUM") or ("/opt/pw-browsers/chromium" if Path("/opt/pw-browsers/chromium").exists() else "")
FFMPEG = shutil.which("ffmpeg") is not None

HEAD = "---\nautocontent: reel\ntitle: Footage test\nstyle: grid_pill\nvoice: af_heart\ntag: \"#test\"\n{extra}---\n\n"
TAIL = "\n## caption\nA caption line.\n\n## hashtags\n#one #two #three\n"
COVER = "## cover\nheadline: Why **ports** matter\npill: matter\nsay: Why do ports matter to you?\n{clip}\n"
POINT = "## point\nheadline: Ships carry the world\nbody: Most goods travel by sea.\nsay: Most goods you own came by sea.\n{clip}\n"
STAT = "## stat\nheadline: Share of trade\nnumber: 80%\nbody: moves by ship.\nsay: Eighty percent moves by ship.\n{clip}\n"
CTA = "## cta\nheadline: Which port?\nsay: Save this and tell me which port.\n"


def script(cover="", point="", stat="", extra=""):
    return HEAD.format(extra=extra) + COVER.format(clip=cover) + POINT.format(clip=point) + STAT.format(clip=stat) + CTA + TAIL


def codes(text):
    return [i.code for i in parse_reel(text).issues]


def make_test_mp4(path: Path, seconds: float = 1.0, size: str = "320x568") -> Path:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=10:duration={seconds}",
                    "-pix_fmt", "yuv420p", str(path)], check=True)
    return path


class ClipScriptTests(unittest.TestCase):
    def test_clip_line_and_aliases_are_read(self):
        for key in ("clip", "broll", "footage", "bvideo"):
            r = parse_reel(script(point=f"{key}: container ship at sea"))
            self.assertEqual(r.scenes[1].clip, "container ship at sea", key)
            self.assertEqual(r.scenes[0].clip, "")
            self.assertEqual(r.scenes[2].clip, "")
            self.assertNotIn("container ship", r.post_text)        # lifted out: the slide reader never sees it

    def test_off_and_none_mean_no_clip(self):
        for v in ("off", "none", "No"):
            self.assertEqual(parse_reel(script(point=f"clip: {v}")).scenes[1].clip, "")

    def test_header_broll_off_ignores_every_clip(self):
        r = parse_reel(script(point="clip: container ship", extra="broll: off\n"))
        self.assertEqual(r.scenes[1].clip, "")
        self.assertEqual(r.meta["broll"], "off")
        self.assertEqual(parse_reel(script(point="clip: container ship")).meta["broll"], "on")


class ClipCheckTests(unittest.TestCase):
    def test_a_good_mix_is_silent(self):
        text = script(cover="clip: container ship at sea")
        found = [c for c in codes(text) if c.startswith(("CLIP", "BROLL"))]
        self.assertEqual(found, [])
        text = script(point="clip: busy port cranes")
        self.assertEqual([c for c in codes(text) if c.startswith(("CLIP", "BROLL"))], [])

    def test_all_stock_warns(self):
        text = script(cover="clip: container ship", point="clip: port cranes", stat="clip: cargo containers")
        text = text.replace(CTA, CTA + "clip: sunset harbour\n")
        self.assertIn("BROLL_TOO_MUCH", codes(text))

    def test_all_but_the_cover_warns(self):
        text = script(point="clip: port cranes", stat="clip: cargo containers")
        text = text.replace(CTA, CTA + "clip: sunset harbour\n")      # the cover is clean; every other slide has footage
        self.assertIn("BROLL_TOO_MUCH", codes(text))

    def test_one_clean_slide_is_enough(self):
        text = script(cover="clip: container ship", point="clip: port cranes")
        self.assertNotIn("BROLL_TOO_MUCH", codes(text))

    def test_clip_on_chart_table_image_diagram_or_recap_conflicts(self):
        base = HEAD.format(extra="") + COVER.format(clip="") + "{mid}\n" + CTA + TAIL
        chart = "## chart\nheadline: Trade by year\nchart: bar\ndata: 2020=5, 2021=7\nsay: Trade grew each year.\nclip: ships at sea"
        table = "## table\nheadline: Ports\ncolumns: Port | TEU\nrows:\n- A | 1\n- B | 2\nsay: Two ports compared.\nclip: ships at sea"
        recap = "## recap\n- 80% | by sea\n- 3x | cheaper\nsay: Save the numbers.\nclip: ships at sea"
        diagram = ("## statement\nheadline: You are 4000 short\nalign: top\nclip: ships at sea\n"
                   "say: You have only two of six blocks.\ndiagram: waffle\n  rows: 2 x 3\n  shape: square\n"
                   "  on: 1-2 \"you have\" @ \"only two\"\n  ghost: rest \"still missing\"")
        for mid in (chart, table, recap, diagram):
            with self.subTest(mid.splitlines()[0]):
                self.assertIn("CLIP_CONFLICT", codes(base.replace("{mid}", mid)), mid)

    def test_clip_without_searchable_words_warns(self):
        self.assertIn("CLIP_EMPTY", codes(script(point="clip: the of a")))
        self.assertIn("CLIP_EMPTY", codes(script(point="clip:")))
        self.assertNotIn("CLIP_EMPTY", codes(script(point="clip: container ship")))


class GuideTests(unittest.TestCase):
    def test_the_guide_and_its_prompt_teach_clip(self):
        guide = (ENGINE_SRC.parent / "REEL_FORMAT.md").read_text(encoding="utf-8")
        prompt = guide.split("<!-- PROMPT START -->")[1].split("<!-- PROMPT END -->")[0]
        for needle in ("`clip:`", "NEVER on every slide", "`broll:`"):
            self.assertIn(needle, prompt)
        for code in ("CLIP_CONFLICT", "BROLL_TOO_MUCH", "CLIP_EMPTY"):
            self.assertIn(code, (ENGINE_SRC / "autocontent" / "reel" / "script.py").read_text(encoding="utf-8"))
        ex = parse_reel((ENGINE_SRC.parent / "example_reel.md").read_text(encoding="utf-8"))
        self.assertTrue(any(s.clip for s in ex.scenes))
        self.assertEqual([i.code for i in ex.issues if i.code.startswith(("CLIP", "BROLL"))], [])


# ---------- the search and download, with the network replaced ----------

PEXELS = {"videos": [
    {"id": 111, "url": "https://www.pexels.com/video/container-ship-at-sea-111/", "duration": 12, "user": {"name": "Ann Lee"},
     "video_files": [
         {"file_type": "video/mp4", "width": 2160, "height": 3840, "link": "https://cdn.example/111_4k.mp4"},
         {"file_type": "video/mp4", "width": 1080, "height": 1920, "link": "https://cdn.example/111_hd.mp4"},
         {"file_type": "video/mp4", "width": 720, "height": 1280, "link": "https://cdn.example/111_sd.mp4"},
         {"file_type": "video/mp4", "width": 1440, "height": 2560, "link": "https://cdn.example/111_qhd.mp4"}]},
    {"id": 222, "url": "https://www.pexels.com/video/happy-people-crowd-222/", "duration": 8, "user": {"name": "Bo"},
     "video_files": [{"file_type": "video/mp4", "width": 1080, "height": 1920, "link": "https://cdn.example/222.mp4"}]}]}
PIXABAY = {"hits": [
    {"id": 333, "pageURL": "https://pixabay.com/videos/ship-333/", "tags": "ship, sea, ocean", "user": "carl", "duration": 9,
     "videos": {"large": {"url": "https://cdn.example/333_l.mp4", "width": 1920, "height": 1080},
                "medium": {"url": "https://cdn.example/333_m.mp4", "width": 1280, "height": 720},
                "tiny": {"url": "https://cdn.example/333_t.mp4", "width": 640, "height": 360}}}]}


class FakeNet:
    def __init__(self, mp4: bytes, pexels=PEXELS, pixabay=PIXABAY, fail_pexels=False):
        self.mp4, self.pexels, self.pixabay, self.fail_pexels, self.urls = mp4, pexels, pixabay, fail_pexels, []

    def __call__(self, url, headers=None, timeout=40, max_bytes=0):
        self.urls.append(url)
        if "api.pexels.com" in url:
            if self.fail_pexels:
                raise StockError("the service answered HTTP 500")
            return json.dumps(self.pexels).encode(), "application/json"
        if "pixabay.com/api/videos" in url:
            return json.dumps(self.pixabay).encode(), "application/json"
        if url.startswith("https://cdn.example/"):
            return self.mp4, "video/mp4"
        raise AssertionError("unexpected network call: " + url)


@unittest.skipUnless(FFMPEG, "needs ffmpeg")
class BrollSearchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.mp4 = make_test_mp4(self.tmp / "src.mp4").read_bytes()
        patches = [mock.patch.object(settings, "VIDEOS_DIR", self.tmp / "videos"),
                   mock.patch.object(broll, "key_for", lambda p: "key")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_the_file_is_the_smallest_one_that_is_tall_enough_and_never_4k(self):
        pick = broll.pick_file([(2160, 3840, "4k"), (1080, 1920, "hd"), (720, 1280, "sd"), (1440, 2560, "qhd")])
        self.assertEqual(pick[2], "sd")                       # 1280 tall is already enough: the smallest file that is
        self.assertEqual(broll.pick_file([(2160, 3840, "4k"), (1080, 1920, "hd"), (1440, 2560, "qhd")])[2], "hd")
        self.assertEqual(broll.pick_file([(720, 1280, "sd"), (360, 640, "tiny"), (3840, 2160, "4k")])[2], "sd")   # none tall enough: the biggest
        self.assertIsNone(broll.pick_file([(3840, 2160, "4k")]))

    def test_resolve_downloads_remembers_and_credits(self):
        net = FakeNet(self.mp4)
        with mock.patch.object(broll, "_fetch", net):
            info, err = broll.resolve_clip("container ship at sea")
        self.assertEqual(err, "")
        self.assertTrue(Path(info["path"]).is_file())
        self.assertTrue(info["name"].endswith(".mp4"))
        self.assertIn("Ann Lee", info["credit"])
        self.assertIn("Pexels", info["credit"])
        self.assertEqual(info["page_url"], "https://www.pexels.com/video/container-ship-at-sea-111/")
        self.assertIn("https://cdn.example/111_sd.mp4", net.urls)           # 720x1280: tall enough and the smallest
        self.assertNotIn("https://cdn.example/111_4k.mp4", net.urls)
        self.assertNotIn("https://cdn.example/111_qhd.mp4", net.urls)
        folder = self.tmp / "videos"
        self.assertEqual(json.loads((folder / "_vpicks.json").read_text())["container ship at sea"], info["name"])
        self.assertIn("Pexels", json.loads((folder / "_vcredits.json").read_text())[info["name"]]["credit"])
        self.assertEqual(broll.pick_for("Container ship, at sea!"), info["name"])      # the phrase is cleaned first

    def test_a_rebuild_reuses_the_remembered_pick_without_the_network(self):
        with mock.patch.object(broll, "_fetch", FakeNet(self.mp4)):
            first, _ = broll.resolve_clip("container ship at sea")
        with mock.patch.object(broll, "_fetch", side_effect=AssertionError("no network wanted")):
            again, err = broll.resolve_clip("container ship at sea")
        self.assertEqual(err, "")
        self.assertEqual(again["name"], first["name"])
        self.assertEqual(again["credit"], first["credit"])

    def test_people_footage_is_hidden_unless_asked_for(self):
        with mock.patch.object(broll, "_fetch", FakeNet(self.mp4)):
            res = broll.search("harbour")
        ids = [c["id"] for c in res["candidates"]]
        self.assertIn("pexels:111", ids)
        self.assertNotIn("pexels:222", ids)                  # "happy people crowd"
        with mock.patch.object(broll, "_fetch", FakeNet(self.mp4)):
            self.assertIn("pexels:222", [c["id"] for c in broll.search("harbour", people=True)["candidates"]])

    def test_pixabay_is_used_when_pexels_fails(self):
        net = FakeNet(self.mp4, fail_pexels=True)
        with mock.patch.object(broll, "_fetch", net):
            info, err = broll.resolve_clip("ship ocean")
        self.assertEqual(err, "")
        self.assertIn("Pixabay", info["credit"])
        self.assertIn("https://cdn.example/333_l.mp4", net.urls)      # the 1080-tall file, not the 720 or the tiny one

    def test_a_long_phrase_is_retried_with_fewer_keywords(self):
        empty = {"videos": []}
        calls = []

        def net(url, headers=None, timeout=40, max_bytes=0):
            calls.append(url)
            if "api.pexels.com" in url and "ship" in url and "wonderful" not in url:
                return json.dumps(PEXELS).encode(), "application/json"
            if "api.pexels.com" in url or "pixabay.com/api/videos" in url:
                return json.dumps(empty).encode(), "application/json"
            return self.mp4, "video/mp4"
        with mock.patch.object(broll, "_fetch", net):
            res = broll.search("wonderful gigantic container ship harbour")
        self.assertTrue(res["candidates"])
        self.assertTrue(any("Nothing matched" in n for n in res["notes"]))

    def test_errors_come_back_as_text_not_exceptions(self):
        with mock.patch.object(broll, "_fetch", side_effect=StockError("no internet connection (down)")):
            info, err = broll.resolve_clip("container ship")
        self.assertIsNone(info)
        self.assertIn("internet", err)
        with mock.patch.object(broll, "key_for", lambda p: ""):
            info, err = broll.resolve_clip("container ship")
        self.assertIsNone(info)
        self.assertIn("key", err)
        self.assertEqual(broll.resolve_clip("")[0], None)

    def test_a_download_that_is_not_a_video_is_refused(self):
        with mock.patch.object(broll, "_fetch", FakeNet(b"<html>nope</html>" * 100)):
            info, err = broll.resolve_clip("container ship at sea")
        self.assertIsNone(info)
        self.assertIn("could not be downloaded", err)

    def test_pipeline_falls_back_instead_of_failing(self):
        r = parse_reel(script(point="clip: container ship at sea"))
        lines = []
        with mock.patch.object(broll, "_fetch", side_effect=StockError("no internet connection (down)")):
            found, problems = pipeline.fetch_footage(r.scenes, True, lines.append)
        self.assertEqual(found, {})
        self.assertEqual(len(problems), 1)
        self.assertTrue(any("FOOTAGE PROBLEM" in l for l in lines))
        with mock.patch.object(broll, "resolve_clip", side_effect=RuntimeError("boom")):
            found, problems = pipeline.fetch_footage(r.scenes, True, lambda s: None)
        self.assertEqual(found, {})
        self.assertIn("boom", problems[0])

    def test_fetch_images_off_skips_the_search(self):
        r = parse_reel(script(point="clip: container ship at sea"))
        with mock.patch.object(broll, "_fetch", side_effect=AssertionError("offline")):
            found, problems = pipeline.fetch_footage(r.scenes, False, lambda s: None)
        self.assertEqual(found, {})
        self.assertIn("switched off", problems[0])


# ---------- the backdrop ----------

@unittest.skipUnless(FFMPEG, "needs ffmpeg")
class BackdropTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.mp4 = make_test_mp4(self.tmp / "src.mp4", seconds=1.0)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_frames_cover_the_reel_size_and_loop(self):
        vb = compose.extract_frames(self.mp4, self.tmp / "f", seconds=2.5, fps=10)
        self.assertEqual(vb.count, 25)
        f0 = vb.frame_at(0.0)
        self.assertEqual(f0.shape, (1920, 1080, 3))
        self.assertEqual(f0.dtype, np.uint8)
        self.assertFalse(np.array_equal(f0, vb.frame_at(0.5)))            # it moves
        self.assertEqual(vb.index_at(2.5), 0)                             # past the end: round to the start
        self.assertTrue(np.array_equal(vb.frame_at(0.0), vb.frame_at(2.5)))
        self.assertTrue(np.array_equal(vb.frame_at(0.3), vb.frame_at(2.8)))
        self.assertTrue(np.array_equal(vb.frame_at(-1.0), f0))            # before the slide starts: the first frame

    def test_a_shorter_clip_is_looped_to_the_length_asked_for(self):
        vb = compose.extract_frames(self.mp4, self.tmp / "f", seconds=3.0, fps=10)       # the clip is 1 s long
        self.assertEqual(vb.count, 30)
        self.assertTrue(np.array_equal(vb.frame_at(0.0), vb.frame_at(1.0)))               # frame 10 is the clip's frame 0 again

    def test_frames_are_loaded_one_at_a_time_from_disk(self):
        vb = compose.extract_frames(self.mp4, self.tmp / "f", seconds=1.0, fps=10)
        self.assertFalse(any(isinstance(v, np.ndarray) and v.shape[0] > 100 and k not in ("_last",) for k, v in vars(vb).items()))
        a = vb.frame_at(0.0)
        for jpg in (self.tmp / "f").glob("*.jpg"):
            jpg.write_bytes(b"gone")
        self.assertIs(vb.frame_at(0.01), a)                               # same frame index is not read twice

    def test_unreadable_footage_raises_runtime_error(self):
        bad = self.tmp / "bad.mp4"
        bad.write_bytes(b"not a video")
        with self.assertRaises(RuntimeError):
            compose.extract_frames(bad, self.tmp / "g", seconds=1.0, fps=10)

    def test_footage_sits_under_a_scrim_with_the_pieces_on_top(self):
        from PIL import Image
        vb = compose.extract_frames(self.mp4, self.tmp / "f", seconds=1.0, fps=10)
        bright = Image.new("RGB", (compose.W, compose.H), (255, 255, 255))
        clip = compose.SceneClip(t0=0.0, t1=2.0, base=bright, video=vb)
        raw = vb.frame_at(0.0).astype(np.int32)
        out = compose.Timeline._content(clip, 0.0).astype(np.int32)
        self.assertEqual(out.shape, (compose.H, compose.W, 3))
        self.assertLess(out[:100].mean(), raw[:100].mean() * 0.62)             # top: dark enough for the handle
        self.assertLess(out[1700:].mean(), raw[1700:].mean() * 0.62)            # bottom: dark enough for the captions
        mid = out[800:1100].mean() / raw[800:1100].mean()
        self.assertGreater(mid, 0.7)                                           # the middle shows the footage
        self.assertLess(out.mean(), 255 * 0.5)                                 # never the slide's own bright base
        # brand furniture stays on top of the footage
        chrome = np.zeros((60, 300, 4), dtype=np.uint8)
        chrome[..., :3], chrome[..., 3] = 255, 255
        clip.chrome = [(chrome, 40, 40)]
        with_chrome = compose.Timeline._content(clip, 0.0)
        self.assertTrue((with_chrome[50:90, 50:300] == 255).all())

    def test_a_footage_scene_is_never_cached(self):
        from PIL import Image
        vb = compose.extract_frames(self.mp4, self.tmp / "f", seconds=1.0, fps=10)
        clip = compose.SceneClip(t0=0.0, t1=3.0, base=Image.new("RGB", (compose.W, compose.H), "white"), video=vb)
        self.assertTrue(clip.moving)
        tl = compose.Timeline([clip], [], 3.0)
        a, b = tl.frame(1.0), tl.frame(1.4)
        self.assertFalse(np.array_equal(a, b))
        self.assertEqual(tl._cache, {})
        self.assertFalse(compose.SceneClip(t0=0, t1=1, base=Image.new("RGB", (4, 4))).moving)


# ---------- a mixed reel, end to end ----------

def _tone_voice(text, voice_name, speed):
    sig = []
    for w in text.split():
        n = int(24000 * (0.10 + 0.05 * len(w)))
        sig.append(0.3 * np.sin(2 * np.pi * (150 + len(w) * 12) * np.arange(n) / 24000) * np.hanning(n) ** 0.4)
        sig.append(np.zeros(int(24000 * (0.22 if w.endswith((".", ",")) else 0.03))))
    return np.concatenate(sig).astype("float32")


@unittest.skipUnless(CHROMIUM and FFMPEG, "needs Chromium and ffmpeg")
class MixedReelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        os.environ["AUTOCONTENT_NO_SANDBOX"] = "1"
        from autocontent.reel import make_reel
        cls.tmp = Path(tempfile.mkdtemp())
        cls.mp4 = make_test_mp4(cls.tmp / "footage.mp4", seconds=2.0)
        cls.logs = []
        cls.out = cls.tmp / "out"

        def resolve(query):
            return {"name": "f.mp4", "path": str(cls.mp4), "credit": "Footage by Test on Pexels", "page_url": "https://example/p"}, ""
        with mock.patch.object(broll, "resolve_clip", resolve):
            cls.summary = make_reel(script(point="clip: container ship at sea", stat="pause: 2.5"), cls.out, engine=_tone_voice,
                                    fetch_images=True, progress=cls.logs.append, keep_work=True)
        # a second reel whose footage can't be had: it must still render, as ordinary slides
        cls.out2 = cls.tmp / "out2"
        with mock.patch.object(broll, "resolve_clip", lambda q: (None, "no internet connection")):
            cls.summary2 = make_reel(script(point="clip: container ship at sea", stat="pause: 2.5"), cls.out2, engine=_tone_voice,
                                     fetch_images=True, progress=cls.logs.append)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def frame(self, out, sec, name):
        from PIL import Image
        png = self.tmp / name
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(sec), "-i", str(out / "reel.mp4"), "-frames:v", "1", str(png)], check=True)
        return np.asarray(Image.open(png).convert("RGB"), dtype=np.int16)

    def test_credits_are_kept(self):
        self.assertEqual(self.summary["videoCredits"], [{"slide": 2, "credit": "Footage by Test on Pexels", "pageUrl": "https://example/p"}])
        self.assertIn("Footage credits: Footage by Test on Pexels", (self.out / "caption.txt").read_text(encoding="utf-8"))
        self.assertNotIn("videoCredits", self.summary2)

    def test_footage_plays_behind_the_clip_scene_and_not_behind_the_others(self):
        tl = {t["n"]: t for t in self.summary["timeline"]}
        a = tl[2]
        s0, s1 = a["start"] + 0.9, a["start"] + 1.5
        f0, f1 = self.frame(self.out, s0, "a0.png"), self.frame(self.out, s1, "a1.png")
        # the footage is moving behind the scene (the test pattern scrolls), in the unlit middle of the frame
        self.assertGreater(int((np.abs(f0[700:1100] - f1[700:1100]) > 20).sum()), 5000)
        # the stat slide that follows is a clean designed slide: nothing moves in its backdrop once it has settled
        b = tl[3]
        g0, g1 = self.frame(self.out, b["end"] - 1.3, "b0.png"), self.frame(self.out, b["end"] - 0.8, "b1.png")
        self.assertLess(int((np.abs(g0[:1450] - g1[:1450]) > 20).sum()), 2000)

    def test_the_brand_handle_stays_on_the_clip_scene(self):
        # the footage scene's top band is the dark scrim with the handle in light type on it
        a = {t["n"]: t for t in self.summary["timeline"]}[2]
        f = self.frame(self.out, a["start"] + 1.5, "chrome.png")
        top = f[20:200]
        self.assertGreater(int((top.min(axis=2) > 200).sum()), 300)       # light pixels: the handle / tag text

    def test_footage_failure_falls_back_to_normal_slides(self):
        self.assertTrue((self.out2 / "reel.mp4").is_file())
        self.assertTrue(any("no footage" in w for w in self.summary2["warnings"]))
        self.assertTrue(any("FOOTAGE PROBLEM" in l for l in self.logs))

    def test_the_work_folder_has_the_frames(self):
        self.assertTrue(any((self.out / "work" / "broll" / "s02").glob("f*.jpg")))
        self.assertFalse((self.out / "work" / "broll" / "s03").exists())


if __name__ == "__main__":
    unittest.main()
