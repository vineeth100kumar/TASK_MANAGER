"""posted_cleanup.py: posted reels/posts keep the finished files, lose the working ones.

Sorts after test_safety on purpose (see test_scheduled_content.py).

    cd raspberry_pi && python -m unittest tests.test_zz_posted_cleanup
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "pc.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db_server  # noqa: E402,F401
import posted_cleanup as pc  # noqa: E402


def make(folder: Path, names):
    for n in names:
        f = folder / n
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x" * 100)


class Cleanup(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.folder = self.root / "r1"
        make(self.folder, ["script.md", "voice.m4a", "out/reel.mp4", "out/poster.jpg", "out/caption.txt", "out/reel.json",
                           "out/voice.wav", "out/work/deck/a.png"])
        self.vids = self.root / "videos"
        make(self.vids, ["a.mp4", "b.mp4"])
        (self.vids / "_vpicks.json").write_text(json.dumps({"q a": "a.mp4", "q b": "b.mp4"}))
        (self.vids / "_vcredits.json").write_text(json.dumps({"a.mp4": {}, "b.mp4": {}}))
        self.reel = {"id": "r1", "posted": True, "clips": ["a.mp4", "b.mp4"]}

    def test_keeps_finished_drops_working(self):
        freed = pc.clean_reel(self.reel, self.folder, [], self.vids)
        left = sorted(str(p.relative_to(self.folder)) for p in self.folder.rglob("*") if p.is_file())
        self.assertEqual(left, ["out/caption.txt", "out/poster.jpg", "out/reel.json", "out/reel.mp4", "script.md"])
        self.assertEqual(freed, 500)
        self.assertFalse((self.vids / "a.mp4").exists())
        self.assertEqual(json.loads((self.vids / "_vpicks.json").read_text()), {})

    def test_not_posted_does_nothing(self):
        self.reel["posted"] = False
        self.assertEqual(pc.clean_reel(self.reel, self.folder, [], self.vids), 0)
        self.assertTrue((self.folder / "out" / "voice.wav").exists())

    def test_no_video_leaves_everything(self):
        (self.folder / "out" / "reel.mp4").unlink()
        self.assertEqual(pc.clean_reel(self.reel, self.folder, [], self.vids), 0)
        self.assertTrue((self.folder / "voice.m4a").exists())

    def test_shared_footage_kept_for_unposted_reel(self):
        other = {"id": "r2", "posted": False, "status": "done", "clips": ["a.mp4"]}
        pc.clean_reel(self.reel, self.folder, [other], self.vids)
        self.assertTrue((self.vids / "a.mp4").exists())
        self.assertFalse((self.vids / "b.mp4").exists())
        self.assertEqual(json.loads((self.vids / "_vpicks.json").read_text()), {"q a": "a.mp4"})

    def test_posted_other_does_not_hold_footage(self):
        other = {"id": "r2", "posted": True, "status": "done", "clips": ["a.mp4"]}
        pc.clean_reel(self.reel, self.folder, [other], self.vids)
        self.assertFalse((self.vids / "a.mp4").exists())

    def test_waiting_reel_with_clip_line_keeps_all(self):
        other = {"id": "r3", "posted": False, "status": "queued", "script": "## s\nclip: sea waves\n"}
        pc.clean_reel(self.reel, self.folder, [other], self.vids)
        self.assertTrue((self.vids / "a.mp4").exists() and (self.vids / "b.mp4").exists())

    def test_post_drops_only_scratch(self):
        folder = self.root / "p1"
        make(folder, ["out/slide_01.png", "out/contact_sheet.png", "out/grounding_report.md", "out/audit.md"])
        pc.clean_post({"id": "p1", "posted": True}, folder)
        left = sorted(p.name for p in (folder / "out").iterdir())
        self.assertEqual(left, ["audit.md", "slide_01.png"])

    def test_totals_add_up(self):
        before = pc.totals()["freedBytes"]
        pc.clean_reel(self.reel, self.folder, [], self.vids)
        self.assertGreater(pc.totals()["freedBytes"], before)


if __name__ == "__main__":
    unittest.main()
