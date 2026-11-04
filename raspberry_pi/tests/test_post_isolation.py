"""Slide drawing is kept from slowing the app: low CPU and disk priority, a
memory limit, the whole process group stopped together, and the JPEG copies
made in a child process."""

import asyncio
import os
import signal
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "iso.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import lowprio  # noqa: E402
import posts  # noqa: E402
import posts_copies  # noqa: E402

LINUX = os.path.isdir("/proc/self")


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:  # a zombie counts as gone
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        return False


class Scheduler(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(lowprio.parse_scheduler("none [mq-deadline] kyber bfq\n"), "mq-deadline")
        self.assertEqual(lowprio.parse_scheduler("[none] mq-deadline"), "none")
        self.assertEqual(lowprio.parse_scheduler("bfq\n"), "bfq")
        self.assertIsNone(lowprio.parse_scheduler("  \n"))

    def test_lookup_never_raises(self):
        lowprio.io_scheduler(str(Path(TMP)))            # whatever this machine has
        self.assertIsNone(lowprio.io_scheduler("/no/such/path"))

    def test_status_says_how_the_engine_is_limited(self):
        with mock.patch.dict(os.environ, {"SAGE_POSTS_IONICE": "idle", "SAGE_POSTS_MAX_MB": "1234"}):
            info = posts.engine_limits()
        self.assertEqual(info["ioPriority"], "idle")
        self.assertEqual(info["maxMemoryMb"], 1234)
        self.assertEqual(info["nice"], posts.ENGINE_NICE)
        with mock.patch.dict(os.environ, {"SAGE_POSTS_IONICE": "off"}):
            self.assertEqual(posts.engine_limits()["ioPriority"], "off")
        self.assertEqual(posts.engine_limits()["ioPriority"], "best-effort 7")


class Priority(unittest.TestCase):
    def test_setting_to_value(self):
        self.assertEqual(lowprio.io_priority_value("7"), (2 << 13) | 7)
        self.assertEqual(lowprio.io_priority_value("3"), (2 << 13) | 3)
        self.assertEqual(lowprio.io_priority_value("idle"), 3 << 13)
        self.assertEqual(lowprio.io_priority_value("99"), (2 << 13) | 7)       # clamped
        self.assertEqual(lowprio.io_priority_value("nonsense"), (2 << 13) | 7)
        for off in ("off", "0", "no", ""):
            self.assertIsNone(lowprio.io_priority_value(off))

    def test_default_comes_from_the_environment(self):
        with mock.patch.dict(os.environ, {"SAGE_POSTS_IONICE": "idle"}):
            self.assertEqual(lowprio.io_priority_value(), 3 << 13)
        with mock.patch.dict(os.environ, {"SAGE_POSTS_IONICE": "off"}):
            self.assertIsNone(lowprio.io_priority_value())

    def test_syscall_gets_the_right_arguments(self):
        libc = mock.Mock()
        libc.syscall.return_value = 0
        with mock.patch.object(lowprio, "_libc", libc), mock.patch.object(lowprio.platform, "machine", return_value="aarch64"):
            self.assertTrue(lowprio.set_io_priority((2 << 13) | 7))
        libc.syscall.assert_called_once_with(30, 1, 0, (2 << 13) | 7)

    def test_a_refused_or_unavailable_syscall_is_quietly_false(self):
        libc = mock.Mock()
        libc.syscall.return_value = -1
        with mock.patch.object(lowprio, "_libc", libc), mock.patch.object(lowprio.platform, "machine", return_value="x86_64"):
            self.assertFalse(lowprio.set_io_priority(5))
        with mock.patch.object(lowprio, "_libc", None):
            self.assertFalse(lowprio.set_io_priority(5))
        with mock.patch.object(lowprio.platform, "machine", return_value="riscv64"):
            self.assertFalse(lowprio.set_io_priority(5))
        self.assertFalse(lowprio.set_io_priority(None))

    def test_lower_sets_nice_and_io_priority(self):
        with mock.patch.object(lowprio.os, "nice") as nice, mock.patch.object(lowprio, "set_io_priority") as io:
            lowprio.lower(15)
        nice.assert_called_once_with(15)
        io.assert_called_once()

    def test_lower_survives_a_refused_nice(self):
        with mock.patch.object(lowprio.os, "nice", side_effect=OSError), mock.patch.object(lowprio, "set_io_priority") as io:
            lowprio.lower(15)
        io.assert_called_once()


@unittest.skipUnless(LINUX, "needs /proc")
class Groups(unittest.TestCase):
    def test_group_memory_is_counted_and_the_whole_group_is_killed(self):
        import subprocess
        proc = subprocess.Popen(["sh", "-c", "sleep 60 & sleep 60 & wait"], start_new_session=True)
        try:
            time.sleep(0.4)
            self.assertGreater(lowprio.group_rss_mb(proc.pid), 0)
            kids = [n for n in os.listdir("/proc") if n.isdigit() and n != str(proc.pid) and _pgrp(n) == proc.pid]
            self.assertGreaterEqual(len(kids), 2)
            lowprio.kill_group(proc.pid)
            proc.wait(5)
            time.sleep(0.3)
            self.assertFalse(any(alive(int(k)) for k in kids))
            self.assertEqual(lowprio.group_rss_mb(proc.pid), 0)
        finally:
            lowprio.kill_group(proc.pid)

    def test_kill_group_of_nothing_is_fine(self):
        lowprio.kill_group(2 ** 22 + 12345)


def _pgrp(name: str):
    try:
        return int(Path(f"/proc/{name}/stat").read_text().rsplit(")", 1)[1].split()[2])
    except (OSError, ValueError, IndexError):
        return None


def fake_engine(body: str) -> Path:
    """A stand-in for content_engine: `python -m autocontent` runs `body`."""
    root = Path(tempfile.mkdtemp())
    pkg = root / "src" / "autocontent"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("")
    (pkg / "__main__.py").write_text(textwrap.dedent(body))
    return root


def new_post(folder_name="p1"):
    folder = Path(tempfile.mkdtemp()) / folder_name
    (folder / "out").mkdir(parents=True)
    script = folder / "script.md"
    script.write_text("x")
    return {"id": folder_name, "style": "grid_pill", "format": "portrait", "log": [], "error": ""}, folder, script


def draw(post, folder, script):
    async def go():
        with mock.patch.object(posts, "save_async", mock.AsyncMock()), mock.patch.object(posts, "_announce", mock.AsyncMock()):
            return await posts._draw(post, folder, script)
    return asyncio.run(go())


@unittest.skipUnless(LINUX, "needs /proc")
class Watchdog(unittest.TestCase):
    def test_a_normal_draw_returns_promptly_and_is_not_held_by_the_watcher(self):
        engine = fake_engine("print('[ 0.1s | +0.1s] Rendering slide 1 of 1')")
        post, folder, script = new_post()
        began = time.monotonic()
        with mock.patch.object(posts, "ENGINE_DIR", engine):
            code = draw(post, folder, script)
        self.assertEqual(code, 0)
        self.assertLess(time.monotonic() - began, 1.5)  # the 2 s memory check doesn't delay the end

    def test_too_much_memory_stops_the_engine_with_a_plain_message(self):
        engine = fake_engine("""
            import subprocess, sys, time
            child = subprocess.Popen([sys.executable, "-c", "b = bytearray(250 * 1024 * 1024); b[::4096] = b'x' * len(b[::4096]); import time; time.sleep(60)"])
            open(sys.argv[-1] if False else "child.pid", "w").write(str(child.pid))
            time.sleep(60)
        """)
        post, folder, script = new_post()
        with mock.patch.object(posts, "ENGINE_DIR", engine), mock.patch.dict(os.environ, {"SAGE_POSTS_MAX_MB": "100"}), \
                mock.patch.object(posts, "MEMORY_CHECK_SECONDS", 0.2):
            with self.assertRaises(RuntimeError) as ctx:
                draw(post, folder, script)
        self.assertIn("used more than 100 MB", str(ctx.exception))
        self.assertGreater(post["peakMb"], 100)
        time.sleep(0.4)
        pid = int((engine / "child.pid").read_text())
        self.assertFalse(alive(pid), "Chromium (the child) must stop with the engine")

    def test_limit_zero_turns_the_watchdog_off(self):
        engine = fake_engine("""
            b = bytearray(150 * 1024 * 1024); b[::4096] = b'x' * len(b[::4096])
            import time; time.sleep(1.0)
        """)
        post, folder, script = new_post()
        with mock.patch.object(posts, "ENGINE_DIR", engine), mock.patch.dict(os.environ, {"SAGE_POSTS_MAX_MB": "0"}), \
                mock.patch.object(posts, "MEMORY_CHECK_SECONDS", 0.2):
            self.assertEqual(draw(post, folder, script), 0)
        self.assertGreater(post["peakMb"], 100)  # still measured, just not enforced

    def test_a_timeout_stops_chromium_too(self):
        engine = fake_engine("""
            import subprocess, time
            c = subprocess.Popen(["sleep", "60"])
            open("child.pid", "w").write(str(c.pid))
            time.sleep(60)
        """)
        post, folder, script = new_post()
        with mock.patch.object(posts, "ENGINE_DIR", engine), mock.patch.object(posts, "RENDER_TIMEOUT", 1):
            with self.assertRaises(asyncio.TimeoutError):
                draw(post, folder, script)
        time.sleep(0.4)
        self.assertFalse(alive(int((engine / "child.pid").read_text())))

    def test_the_engine_starts_in_its_own_group_at_low_priority(self):
        engine = fake_engine("pass")
        post, folder, script = new_post()
        seen = {}
        real = asyncio.create_subprocess_exec

        async def spy(*a, **k):
            seen.update(k)
            return await real(*a, **k)

        with mock.patch.object(posts, "ENGINE_DIR", engine), mock.patch.object(posts.asyncio, "create_subprocess_exec", spy):
            draw(post, folder, script)
        self.assertTrue(seen["start_new_session"])
        self.assertIs(seen["preexec_fn"], posts._lower_priority)


def make_pngs(out: Path, n=2):
    from PIL import Image
    out.mkdir(parents=True, exist_ok=True)
    for i in range(1, n + 1):
        Image.new("RGB", (1080, 1350), (200, 30 * i, 90)).save(out / f"slide_{i:02d}.png")


class Copies(unittest.TestCase):
    def test_make_all_makes_both_kinds_once(self):
        out = Path(tempfile.mkdtemp()) / "out"
        make_pngs(out)
        self.assertEqual(posts_copies.make_all(out), 4)
        self.assertEqual(posts_copies.make_all(out), 0)  # nothing to redo
        from PIL import Image
        with Image.open(out / "preview" / "slide_01.jpg") as im:
            self.assertEqual(im.width, 540)
        with Image.open(out / "share" / "slide_01.jpg") as im:
            self.assertEqual(im.width, 1080)  # never enlarged

    def test_a_newer_slide_is_copied_again(self):
        out = Path(tempfile.mkdtemp()) / "out"
        make_pngs(out, 1)
        posts_copies.make_all(out)
        later = time.time() + 5
        os.utime(out / "slide_01.png", (later, later))
        self.assertEqual(posts_copies.make_all(out), 2)

    def test_the_script_runs_on_its_own(self):
        import subprocess
        out = Path(tempfile.mkdtemp()) / "out"
        make_pngs(out, 1)
        res = subprocess.run([sys.executable, str(Path(posts_copies.__file__)), str(out)], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(res.stdout.strip(), "2")

    def test_the_old_helpers_still_give_the_same_files(self):
        post_id = "iso-copies"
        out = Path(TMP) / "sage_posts_test" / post_id / "out"
        make_pngs(out, 1)
        post = {"id": post_id, "slides": ["slide_01.png"]}
        with mock.patch.object(posts, "POSTS_DIR", Path(TMP) / "sage_posts_test"):
            self.assertEqual(posts.preview_jpeg(post, 1), out / "preview" / "slide_01.jpg")
            self.assertTrue(posts.share_jpeg(post, 1).is_file())
            self.assertIsNone(posts.preview_jpeg(post, 9))

    def test_copies_are_made_in_a_low_priority_child(self):
        post_id = "iso-child"
        base = Path(TMP) / "child_posts"
        make_pngs(base / post_id / "out", 2)
        post = {"id": post_id, "slides": ["slide_01.png", "slide_02.png"]}
        seen = {}
        real = asyncio.create_subprocess_exec

        async def spy(*a, **k):
            seen.update(k)
            seen["argv"] = a
            return await real(*a, **k)

        async def go():
            with mock.patch.object(posts, "POSTS_DIR", base), mock.patch.object(posts.asyncio, "create_subprocess_exec", spy), \
                    mock.patch.object(posts, "prepare_copies") as inline:
                await posts._copies_in_child(post)
                return inline

        inline = asyncio.run(go())
        inline.assert_not_called()  # the child did it
        self.assertTrue((base / post_id / "out" / "preview" / "slide_02.jpg").is_file())
        self.assertIs(seen["preexec_fn"], posts._lower_priority)
        self.assertIn("posts_copies.py", seen["argv"][1])

    def test_if_the_child_cannot_run_the_copies_are_made_here(self):
        post_id = "iso-fallback"
        base = Path(TMP) / "fallback_posts"
        make_pngs(base / post_id / "out", 1)
        post = {"id": post_id, "slides": ["slide_01.png"]}

        async def go():
            with mock.patch.object(posts, "POSTS_DIR", base), mock.patch.object(posts.sys, "executable", "/no/such/python"):
                await posts._copies_in_child(post)

        asyncio.run(go())
        self.assertTrue((base / post_id / "out" / "share" / "slide_01.jpg").is_file())

    def test_a_child_that_fails_falls_back_too(self):
        post_id = "iso-fail"
        base = Path(TMP) / "fail_posts"
        make_pngs(base / post_id / "out", 1)
        (base / post_id / "out" / "slide_01.png").write_bytes(b"not a png")  # the child's PIL will fail on it
        post = {"id": post_id, "slides": ["slide_01.png"]}

        async def go():
            with mock.patch.object(posts, "POSTS_DIR", base), mock.patch.object(posts, "prepare_copies") as inline:
                await posts._copies_in_child(post)
                return inline

        inline = asyncio.run(go())
        inline.assert_called_once_with(post)


if __name__ == "__main__":
    unittest.main()
