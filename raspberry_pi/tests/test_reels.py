"""Tests for Reels (reels.py): checking a script, uploading a recording, making the video, the
email, the task link and the media files.

    cd raspberry_pi && python -m unittest tests.test_reels

Kokoro (the built-in voice) is downloaded on the Pi and isn't run here: these tests make reels
from a stand-in recording (tone bursts, one per word) uploaded the way the app uploads it, which
runs the whole real pipeline: Chromium draws the slides, ffmpeg encodes the video. They are skipped
when there is no Chromium (AUTOCONTENT_CHROMIUM or /opt/pw-browsers/chromium) or no ffmpeg.
"""

import asyncio
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "reels.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import claude_api  # noqa: E402
import db_server  # noqa: E402
import notifier  # noqa: E402
import posts  # noqa: E402
import reels  # noqa: E402

client = TestClient(db_server.app)
CHROMIUM = os.environ.get("AUTOCONTENT_CHROMIUM") or ("/opt/pw-browsers/chromium" if Path("/opt/pw-browsers/chromium").exists() else "")
FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None

SMALL = """---
autocontent: reel
title: Tiny reel
voice: mine
---

## cover
headline: Three things that matter
say: Three things matter when you start.

## point
headline: One
body: The first thing.
say: The first thing is to begin today, not next week.

## cta
headline: Save this
pill: SAVE THIS
say: Save this for later.

## caption
A short caption for the tiny reel.

## hashtags
#tiny #reel
"""
SPOKEN = ("Three things matter when you start. The first thing is to begin today, not next week. "
          "Save this for later.")
KOKORO = SMALL.replace("voice: mine", "voice: af_heart")


def recording(path: Path, text: str = SPOKEN) -> Path:
    """A stand-in for a voice recording: one tone burst per word."""
    reels._engine_on_path()
    import numpy as np
    from autocontent.reel import voice
    sig = []
    for w in text.split():
        n = int(24000 * (0.10 + 0.05 * len(w)))
        sig.append(0.3 * np.sin(2 * np.pi * (150 + len(w) * 12) * np.arange(n) / 24000) * np.hanning(n) ** 0.4)
        sig.append(np.zeros(int(24000 * (0.22 if w.endswith((".", ",")) else 0.03))))
    voice.write_wav(path, np.concatenate(sig).astype("float32"))
    return path


class FakeBox:
    def __init__(self):
        self.projects = {"p1": {"id": "p1", "type": "content", "name": "Mind Deeds"}, "p2": {"id": "p2", "type": "technical"}}
        self.items = {}

    def find(self, table, record_id):
        return (self.projects if table == "projects" else self.items).get(record_id)

    async def create(self, table, fields):
        record = {**fields, "id": f"t{len(self.items) + 1}"}
        self.items[record["id"]] = record
        return record

    async def update(self, table, record_id, fields):
        self.items[record_id].update(fields)
        return self.items[record_id]


class CheckTests(unittest.TestCase):
    def test_good_script(self):
        r = reels.check(SMALL)
        self.assertTrue(r["ok"], r["issues"])
        self.assertEqual([s["type"] for s in r["scenes"]], ["cover", "point", "cta"])
        self.assertEqual(r["title"], "Tiny reel")
        self.assertTrue(r["needsRecording"])
        self.assertEqual(r["voice"], "mine")
        self.assertGreater(r["seconds"], 5)
        self.assertIn("tiny reel", r["caption"])

    def test_errors_carry_line_numbers_and_unknown_voices_are_caught(self):
        r = reels.check(KOKORO.replace("af_heart", "en-US-AriaNeural"))
        self.assertFalse(r["ok"])
        self.assertTrue(any(i["code"] == "VOICE_UNKNOWN" for i in r["issues"]))
        r = reels.check(SMALL + "\n## chart\nheadline: Nothing to plot\nsay: Nothing.\n")
        self.assertFalse(r["ok"])
        self.assertTrue(any(i["severity"] == "ERROR" and i["line"] for i in r["issues"]))

    def test_a_post_script_is_not_a_reel(self):
        r = reels.check(SMALL.replace("autocontent: reel", "autocontent: post"))
        self.assertFalse(r["ok"])
        self.assertEqual(r["issues"][0]["code"], "NOT_A_REEL")

    def test_check_route(self):
        res = client.post("/api/reels/check", json={"script": SMALL}).json()
        self.assertTrue(res["success"] and res["check"]["ok"])
        self.assertEqual(client.post("/api/reels/check", json={"script": "x" * (reels.MAX_SCRIPT + 1)}).status_code, 400)

    def test_example_reel_is_clean(self):
        text = (reels.ENGINE_DIR / "example_reel.md").read_text(encoding="utf-8")
        r = reels.check(text)
        self.assertTrue(r["ok"], r["issues"])
        self.assertEqual(r["warnings"], 0, r["issues"])
        self.assertEqual(r["voice"], "af_heart")


class StartRules(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        reels.connect(db_server.DB_PATH)
        posts.connect(db_server.DB_PATH, None, None, None, None)

    async def test_refuses_empty_bad_and_unknown_style(self):
        with self.assertRaises(ValueError):
            reels.start("   ")
        with self.assertRaises(ValueError):
            reels.start(SMALL, style="neon")
        with self.assertRaises(ValueError):
            reels.start("hello world")

    async def test_queue_limit(self):
        with mock.patch.object(reels, "queue_length", return_value=reels.MAX_QUEUE):
            with self.assertRaises(reels.Busy):
                reels.start(SMALL)

    async def test_own_voice_waits_for_the_recording(self):
        reel = reels.start(SMALL)
        self.assertEqual(reel["status"], "waiting")
        self.assertTrue(reel["needsRecording"])
        self.assertEqual(reels.queue_length(), 0)         # waiting isn't queued: it holds no turn
        reels.delete(reel["id"])

    async def test_missing_reel(self):
        self.assertIsNone(reels.get("nope"))
        self.assertIsNone(reels.get("../../etc/passwd"))
        self.assertEqual(client.get("/api/reels/abcdefabcdef").status_code, 404)
        self.assertEqual(client.get("/media/reels/abcdefabcdef/video/reel.mp4").status_code, 404)

    async def test_restart_marks_unfinished_reels_failed(self):
        reel = {"id": "aaaaaaaaaaaa", "createdAt": reels._utc(), "status": "running", "title": "t", "log": []}
        reels.save(reel)
        reels.connect(db_server.DB_PATH)
        self.assertEqual(reels.get("aaaaaaaaaaaa")["status"], "failed")
        reels.delete("aaaaaaaaaaaa")

    async def test_list_rows_are_light(self):
        reel = reels.start(SMALL)
        row = next(r for r in client.get("/api/reels").json()["reels"] if r["id"] == reel["id"])
        for heavy in ("script", "log", "timeline"):
            self.assertNotIn(heavy, row)
        self.assertIn("captionStart", row)
        reels.delete(reel["id"])


class RecordingReuseRules(unittest.IsolatedAsyncioTestCase):
    """A kept recording belongs to a script that asks for one. Editing the script to use the
    built-in voice must not read the author's old recording instead."""

    async def asyncSetUp(self):
        reels.connect(db_server.DB_PATH)
        # restart() queues the making; these tests only want the command it would run.
        held = mock.patch.object(reels, "_spawn", lambda coro: coro.close())
        held.start()
        self.addCleanup(held.stop)
        self.reel = reels.start(SMALL)
        folder = reels.REELS_DIR / self.reel["id"]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "voice_upload.wav").write_bytes(b"RIFF....")
        self.reel.update(voiceFile="voice_upload.wav", voiceSeconds=12.0, status="done", finishedAt=reels._utc())
        reels.save(self.reel)

    async def asyncTearDown(self):
        reels.delete(self.reel["id"])

    async def test_own_voice_passes_the_recording_to_the_engine(self):
        argv = await self.argv_of(reels.restart(self.reel))
        self.assertIn("--voice-file", argv)

    async def test_switching_to_the_built_in_voice_drops_it(self):
        with mock.patch.object(reels, "_voice_problem", return_value=""):
            reel = reels.restart(self.reel, KOKORO)
        self.assertFalse(reel["needsRecording"])
        self.assertNotIn("--voice-file", await self.argv_of(reel))

    async def test_the_built_in_voice_being_missing_fails_the_remake_at_once(self):
        with mock.patch.object(reels, "_voice_problem", return_value="No voice files."):
            reel = reels.restart(self.reel, KOKORO)
        self.assertEqual((reel["status"], reel["error"]), ("failed", "No voice files."))

    async def argv_of(self, reel):
        """What reels.py would run for this reel, without running it."""
        seen = {}

        async def fake_exec(*argv, **kw):
            seen["argv"] = list(argv)
            raise RuntimeError("not run")

        with mock.patch.object(asyncio, "create_subprocess_exec", side_effect=fake_exec):
            with self.assertRaises(RuntimeError):
                await reels._draw(reel, reels.REELS_DIR / reel["id"], reels.REELS_DIR / reel["id"] / "script.md")
        return seen["argv"]


class VoiceUploadRules(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        reels.connect(db_server.DB_PATH)
        self.reel = reels.start(SMALL)

    async def asyncTearDown(self):
        reels.delete(self.reel["id"])

    def put(self, name, data):
        return client.put(f"/api/reels/{self.reel['id']}/voice?name={name}", content=data)

    async def test_wrong_kind_of_file(self):
        res = self.put("notes.txt", b"hello")
        self.assertEqual(res.status_code, 400)
        self.assertIn("audio or video", res.json()["error"])

    async def test_empty_and_unreadable_files(self):
        self.assertEqual(self.put("a.wav", b"").status_code, 400)
        res = self.put("a.m4a", b"this is not audio at all" * 50)
        self.assertEqual(res.status_code, 400)
        self.assertIn("no sound", res.json()["error"])
        self.assertEqual(reels.get(self.reel["id"])["status"], "waiting")
        self.assertEqual(list((reels.REELS_DIR / self.reel["id"]).glob("voice_upload*")), [])

    async def test_too_big(self):
        with mock.patch.object(reels, "MAX_VOICE_MB", 0):
            res = client.put(f"/api/reels/{self.reel['id']}/voice?name=a.wav", content=b"x" * 100)
        self.assertEqual(res.status_code, 400)
        self.assertIn("limit", res.json()["error"])

    async def test_unknown_reel(self):
        self.assertEqual(client.put("/api/reels/abcdefabcdef/voice?name=a.wav", content=b"x").status_code, 404)

    async def test_a_reel_being_made_refuses_a_new_recording(self):
        self.reel["status"] = "running"
        reels.save(self.reel)
        res = self.put("a.wav", b"RIFF")
        self.assertEqual(res.status_code, 400)
        self.reel["status"] = "waiting"
        reels.save(self.reel)


class Readiness(unittest.TestCase):
    def test_status_says_what_is_missing(self):
        state = reels.status()
        for key in ("ready", "problems", "voiceReady", "voiceProblem", "voices", "timing", "emailReady", "queued"):
            self.assertIn(key, state)
        self.assertIn("af_heart", state["voices"])
        self.assertIn(state["timing"], ("whisper", "spread"))

    def test_missing_voice_files_are_named_in_plain_words(self):
        with mock.patch.dict(os.environ, {"REEL_MODEL_DIR": "/nonexistent/models"}), \
                mock.patch("importlib.util.find_spec", side_effect=lambda n, *a: object()):
            problem = reels._voice_problem()
        self.assertIn("kokoro-v1.0.onnx", problem)
        self.assertIn("own recording still works", problem)

    def test_health_has_a_reel_maker_part(self):
        health = client.get("/api/health").json() if client.get("/api/health").status_code == 200 else {}
        part = db_server._reel_maker_status()
        self.assertEqual(set(part), {"ready", "problems", "voiceReady", "voiceProblem", "timing", "waiting", "emailReady"})
        self.assertIsInstance(health, dict)


@unittest.skipUnless(CHROMIUM and FFMPEG, "needs Chromium and ffmpeg")
class MakeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.box = FakeBox()
        self.events = []

        async def broadcast(event):
            self.events.append(event)

        os.environ["AUTOCONTENT_CHROMIUM"] = CHROMIUM
        posts.connect(db_server.DB_PATH, broadcast, self.box.create, self.box.update, self.box.find)
        reels.connect(db_server.DB_PATH)
        self.wav = recording(Path(TMP) / "voice.wav")

    async def upload(self, reel):
        # on this test's own event loop, so the reel it queues keeps running after the request returns
        import httpx
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=db_server.app), base_url="http://test") as ac:
            res = await ac.put(f"/api/reels/{reel['id']}/voice?name=voice.wav", content=self.wav.read_bytes())
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()["reel"]

    async def finish(self, reel):
        for _ in range(600):
            await asyncio.sleep(0.5)
            reel = reels.get(reel["id"])
            if reel["status"] in ("done", "failed"):
                for _ in range(200):
                    if not posts._lock.locked():
                        break
                    await asyncio.sleep(0.1)
                return reels.get(reel["id"])
        self.fail("the reel never finished")

    async def test_makes_emails_and_moves_the_task(self):
        sent = {}

        def fake_send(prefs, subject, text, html_body, images=None):
            sent.update(subject=subject, text=text, html=html_body, images=images)

        with mock.patch.object(notifier, "email_ready", return_value=True), \
                mock.patch.object(notifier, "send_email", side_effect=fake_send), \
                mock.patch.object(notifier, "_app_link", return_value="https://sage.example"):
            reel = reels.start(SMALL, project_id="p1")
            self.assertEqual(reel["status"], "waiting")
            queued = await self.upload(reel)
            self.assertEqual(queued["status"], "queued")
            reel = await self.finish(reel)
            for _ in range(40):
                if reel["emailed"] or reel["emailError"]:
                    break
                await asyncio.sleep(0.25)
                reel = reels.get(reel["id"])
        self.assertEqual(reel["status"], "done", reel.get("error"))
        self.assertTrue(reel["emailed"], reel.get("emailError"))
        self.assertEqual(reel["progress"]["percent"], 100)
        self.assertGreater(reel["seconds"], 5)
        self.assertEqual(len(reel["timeline"]), 3)
        self.assertIn("Tiny reel", sent["subject"])
        self.assertIn("cid:poster", sent["html"])
        self.assertTrue(sent["images"]["poster"].startswith(b"\xff\xd8"))
        self.assertIn("https://sage.example/?reel=" + reel["id"], sent["html"])
        self.assertIn("A short caption", sent["text"])
        # the file is a real vertical video
        out = reels.REELS_DIR / reel["id"] / "out"
        probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json",
                                           str(out / "reel.mp4")], capture_output=True, text=True).stdout)
        kinds = {s["codec_name"]: s for s in probe["streams"]}
        self.assertEqual((kinds["h264"]["width"], kinds["h264"]["height"]), (1080, 1920))
        self.assertIn("aac", kinds)
        # progress was announced all the way
        self.assertTrue(any(e["type"] == "REEL_PROGRESS" and e["status"] == "done" for e in self.events))
        self.assertTrue(any(e["type"] == "REEL_PROGRESS" and e["status"] == "running" and 0 < e["percent"] < 100 for e in self.events))
        # media: the app's addresses, cached, resumable and seekable
        media = client.get(f"/api/reels/{reel['id']}").json()["reel"]["media"]
        self.assertEqual(media["base"], f"/media/reels/{reel['id']}")
        url = f"{media['base']}/video/reel.mp4?v={media['v']}"
        video = client.get(url)
        self.assertEqual((video.status_code, video.headers["content-type"]), (200, "video/mp4"))
        self.assertIn("immutable", video.headers["cache-control"])
        part = client.get(url, headers={"Range": "bytes=0-99"})
        self.assertEqual((part.status_code, len(part.content)), (206, 100))
        self.assertEqual(client.get(url, headers={"If-None-Match": video.headers["etag"]}).status_code, 304)
        self.assertIn('filename="My-Reel.mp4"', client.get(url + "&download=My Reel").headers["content-disposition"])
        poster = client.get(f"{media['base']}/poster/poster.jpg?v={media['v']}")
        self.assertTrue(poster.content.startswith(b"\xff\xd8"))
        for bad in ("video/other.mp4", "voice/voice.wav", "video/..%2Fscript.md"):
            self.assertEqual(client.get(f"{media['base']}/{bad}").status_code, 404, bad)
        # needs sign-in or the reel's own token when locked
        with mock.patch.object(db_server, "API_SECRET", "s" * 32):
            self.assertEqual(client.get(url).status_code, 401)
            self.assertEqual(client.get(url + f"&t={media['t']}").status_code, 200)
            self.assertEqual(client.get(url + f"&t={reels.media_token('000000000000')}").status_code, 401)
            self.assertEqual(client.get(url, headers={"Authorization": "Bearer " + "s" * 32}).status_code, 200)
        # the project got a task that is Ready; Mark posted finishes it
        task = next(iter(self.box.items.values()))
        self.assertEqual((task["status"], task["stage"]), ("in_progress", "editing"))
        self.assertTrue(client.post(f"/api/reels/{reel['id']}/posted").json()["reel"]["posted"])
        self.assertEqual((task["status"], task["stage"]), ("done", "published"))
        client.post(f"/api/reels/{reel['id']}/posted?undo=true")
        self.assertEqual((task["status"], task["stage"]), ("in_progress", "editing"))
        # QR, then delete
        with mock.patch.object(notifier, "_app_link", return_value="https://sage.example"):
            self.assertIn("<svg", client.get(f"/api/reels/{reel['id']}/qr.svg").text)
        self.assertTrue(client.delete(f"/api/reels/{reel['id']}").json()["success"])
        self.assertFalse((reels.REELS_DIR / reel["id"]).exists())

    async def test_remake_reuses_the_recording_and_a_bad_script_is_refused(self):
        with mock.patch.object(notifier, "email_ready", return_value=False):
            reel = reels.start(SMALL)
            await self.upload(reel)
            reel = await self.finish(reel)
            self.assertEqual(reel["status"], "done", reel.get("error"))
            self.assertIn("isn't set up", reel["emailError"])
            again = reels.restart(reel, SMALL.replace("Three things that matter", "Four things that matter")
                                  .replace("title: Tiny reel", "title: A different reel"))
            self.assertEqual(again["status"], "queued")          # the kept recording was used: no new upload
            self.assertEqual(again["title"], "A different reel")  # an edited script brings its own name
            again = await self.finish(again)
            self.assertEqual(again["status"], "done", again.get("error"))
            self.assertIn("Four things", again["script"])
            # a script that cannot fit is refused before it takes a turn
            with self.assertRaises(ValueError):
                reels.restart(again, SMALL.replace("headline: One", "headline: " + "word " * 80))
        reels.delete(reel["id"])

    async def test_kokoro_not_ready_fails_at_once_with_the_reason(self):
        with mock.patch.object(reels, "_voice_problem", return_value="The voice files aren't there."):
            res = client.post("/api/reels", json={"script": KOKORO})
        self.assertEqual(res.status_code, 200)
        reel = res.json()["reel"]
        self.assertEqual(reel["status"], "failed")
        self.assertIn("voice files", reel["error"])
        reels.delete(reel["id"])

    async def test_connector_tools(self):
        fmt = claude_api.reel_format()
        self.assertIn("say:", fmt["format"])
        self.assertIn("## cover", fmt["example"])
        self.assertNotIn("PROMPT", fmt["format"])
        self.assertTrue(claude_api.check_reel({"script": SMALL})["check"]["ok"])
        with self.assertRaises(claude_api.ApiError):
            claude_api.check_reel({"script": ""})
        out = await claude_api.create_reel({"script": SMALL})
        self.assertEqual(out["reel"]["status"], "waiting")
        self.assertIn("recording", out["note"])
        listed = await claude_api.list_reels({})
        self.assertTrue(any(r["id"] == out["reel"]["id"] for r in listed["reels"]))
        got = await claude_api.get_reel({"id": out["reel"]["id"]})
        self.assertEqual(got["reel"]["id"], out["reel"]["id"])
        reels.delete(out["reel"]["id"])


class EnginePriorityTests(unittest.TestCase):
    def test_engine_runs_below_the_web_server(self):
        self.assertGreater(reels.ENGINE_NICE, 0)
        if os.name == "posix":
            out = subprocess.run([sys.executable, "-c", "import os; print(os.nice(0))"],
                                 preexec_fn=reels._lower_priority, capture_output=True, text=True)
            self.assertGreater(int(out.stdout), os.nice(0))

    def test_progress_lines_map_to_percent(self):
        def pct(line):
            for pattern, percent, _ in reels.STEPS:
                hit = pattern.search(line)
                if hit:
                    return percent(*[float(g) for g in hit.groups()])
        self.assertEqual(pct("Speaking slide 3 of 3..."), 15)
        self.assertEqual(round(pct("Cutting slide 2 of 4 into pieces (stat)...")), 38)
        self.assertEqual(round(pct("  encoding 50%")), 80)


if __name__ == "__main__":
    unittest.main()
