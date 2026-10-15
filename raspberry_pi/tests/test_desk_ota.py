"""Tests for desk/ota.py: LUMO's firmware updates over Wi-Fi.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import hashlib
import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from desk import ota  # noqa: E402

BRANCH = "claude/project-thread-clc1ti"
FIRMWARE = b"\xe9" + bytes(range(256)) * 40


def release(version, branch=BRANCH, data=FIRMWARE, sha="a" * 40, published="2026-10-15T08:00:00Z", md5=None):
    asset = f"lumo-{version}.bin"
    manifest = {"version": version, "branch": branch, "sha": sha, "md5": md5 or hashlib.md5(data).hexdigest(),
                "size": len(data), "asset": asset}
    return {"tag_name": f"lumo-fw-{version}-{sha[:7]}", "body": json.dumps(manifest), "published_at": published,
            "html_url": "https://github.com/x/y/releases/1",
            "assets": [{"name": asset, "size": len(data), "browser_download_url": f"https://example.test/{asset}"}]}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeLink:
    def __init__(self, fw="2.13.0"):
        self.fw = fw
        self.can_ota = True
        self.ota_error = ""
        self.local_ip = "127.0.0.1"
        self.socket = object()
        self.sent = []
        self.on_connect = None

    @property
    def connected(self):
        return self.socket is not None

    async def send(self, command):
        self.sent.append(command)
        return self.connected


class NewestBuild(unittest.TestCase):
    def test_picks_the_newest_version_for_this_branch(self):
        releases = [
            release("2.13.0"), release("2.14.0", branch="main"), release("2.13.1", sha="b" * 40),
            {"tag_name": "v1", "body": "", "assets": []}, {"tag_name": "lumo-fw-x", "body": "not json"},
        ]
        build = ota.newest_build(releases, BRANCH)
        self.assertEqual((build["version"], build["sha"]), ("2.13.1", "b" * 40))
        self.assertEqual(build["url"], "https://example.test/lumo-2.13.1.bin")
        self.assertIsNone(ota.newest_build(releases, "other"))

    def test_a_rebuild_of_the_same_version_is_newer(self):
        build = ota.newest_build([release("2.13.0", published="2026-10-15T08:00:00Z"),
                                  release("2.13.0", sha="c" * 40, published="2026-10-15T09:00:00Z")], BRANCH)
        self.assertEqual(build["sha"], "c" * 40)


class Updates(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.link = FakeLink()
        self.releases = [release("2.13.1")]
        self.downloads = []
        self.busy = ""
        self.auto = True
        self.now = 1_000_000.0

        async def releases(repo):
            return self.releases

        async def download(url):
            self.downloads.append(url)
            return FIRMWARE

        self.ota = ota.FirmwareUpdates(
            self.link, busy=lambda: self.busy, auto=lambda: self.auto, releases=releases, download=download,
            branch=BRANCH, repo="x/y", cache=Path(tempfile.mkdtemp()), port=free_port(), clock=lambda: self.now)

    async def asyncTearDown(self):
        await self.ota._stop_serving()

    async def fetch(self, url):
        path = url.split(str(self.ota.port), 1)[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", self.ota.port)
        writer.write(f"GET {path} HTTP/1.1\r\nHost: pi\r\n\r\n".encode())
        await writer.drain()
        raw = await reader.read()
        writer.close()
        head, _, body = raw.partition(b"\r\n\r\n")
        return head.decode(), body

    async def test_downloads_once_and_sends_the_update_with_its_md5(self):
        await self.ota.tick()
        self.assertEqual(len(self.downloads), 1)
        command = self.link.sent[-1]
        self.assertEqual((command["cmd"], command["version"]), ("OTA", "2.13.1"))
        self.assertTrue(command["url"].startswith(f"http://127.0.0.1:{self.ota.port}/"))
        head, body = await self.fetch(command["url"])
        self.assertIn("200 OK", head)
        self.assertIn(f"x-MD5: {hashlib.md5(FIRMWARE).hexdigest()}", head)
        self.assertEqual(body, FIRMWARE)
        head, _ = await self.fetch(f"http://127.0.0.1:{self.ota.port}/guess/lumo.bin")
        self.assertIn("404", head)
        # Back on the new version: done, and nothing is sent again.
        self.link.fw = "2.13.1"
        await self.ota.on_connect()
        self.assertEqual(self.ota.state, "done")
        self.now += ota.CHECK_EVERY
        await self.ota.tick()
        self.assertEqual(len(self.link.sent), 1)
        self.assertEqual(len(self.downloads), 1)

    async def test_a_bad_download_is_not_sent(self):
        self.releases = [release("2.13.1", md5="0" * 32)]
        await self.ota.tick()
        self.assertEqual(self.link.sent, [])
        self.assertIn("MD5", self.ota.check_error)

    async def test_waits_while_busy_off_or_on_old_firmware(self):
        self.busy = "an alarm is ringing"
        await self.ota.tick()
        self.assertEqual(self.ota.status()["waiting"], "an alarm is ringing")
        self.busy, self.auto = "", False
        await self.ota.tick()
        self.assertEqual(self.ota.waiting, "automatic updates are off")
        self.auto, self.link.fw, self.link.can_ota = True, "2.12.0", False
        await self.ota.tick()
        self.assertIn("by USB once", self.ota.waiting)
        self.assertEqual(self.link.sent, [])
        self.assertIn("by USB", await self.ota.start(force=True))

    async def test_failure_is_retried_later_then_left_until_update_now(self):
        for attempt in range(ota.MAX_TRIES):
            await self.ota.tick()
            self.assertEqual(self.ota.state, "updating")
            self.link.ota_error = "Verify Bin Header Failed"
            await self.ota.on_connect()
            self.assertEqual(self.ota.state, "failed")
            await self.ota.tick()
            self.assertEqual(len(self.link.sent), attempt + 1)   # not straight away
            self.now += ota.RETRY_AFTER
        await self.ota.tick()
        self.assertEqual(len(self.link.sent), ota.MAX_TRIES)
        self.assertIn("failed 3 times", self.ota.waiting)
        self.assertEqual(await self.ota.start(force=True), "")
        self.assertEqual(len(self.link.sent), ota.MAX_TRIES + 1)

    async def test_an_update_that_never_comes_back_times_out(self):
        await self.ota.tick()
        self.now += ota.UPDATE_TIMEOUT + 1
        await self.ota.tick()
        self.assertEqual(self.ota.history[-1]["result"], "failed")
        self.assertIn("didn't come back", self.ota.history[-1]["detail"])

    async def test_github_down_is_reported_not_raised(self):
        async def broken(repo):
            raise OSError("no route")
        self.ota.fetch_releases = broken
        await self.ota.tick()
        self.assertIn("couldn't reach GitHub", self.ota.check_error)
        self.assertEqual(self.link.sent, [])


if __name__ == "__main__":
    unittest.main()
