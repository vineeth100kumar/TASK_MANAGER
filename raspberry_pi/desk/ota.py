"""
ota.py - LUMO's firmware updates over Wi-Fi, so a merged change reaches the
clock without a USB cable.

1. When a change to lumo/esp32_client/ is merged, GitHub builds the firmware
   (.github/workflows/lumo-firmware.yml) and publishes it as a release whose
   notes are a small manifest: {"version", "branch", "sha", "md5", "size",
   "asset"}.
2. Every CHECK_EVERY this looks for the newest build of the branch this Pi
   runs (SAGE_BRANCH, or the checkout's), and downloads it once into
   raspberry_pi/firmware/, checking its size and MD5.
3. When the clock runs an older version, takes updates (firmware 2.13 says so
   in its HELLO) and isn't busy (an alarm ringing or due soon, a timer
   running, a card waiting for an answer), this serves the file on a port
   opened just for it (OTA_PORT, behind a random path) and sends OTA with its
   address. The clock downloads it, checks the MD5, flashes and restarts.
4. The clock comes back on the new version (done), or on the old one with
   why it failed in its HELLO. A version that fails MAX_TRIES times is left
   until a newer one comes out or someone presses Update now in Sage.

Updates can be switched off on the LUMO page (settings: updates.auto).
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import subprocess
import time
from collections import deque
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger("desk.ota")

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.getenv("SAGE_LUMO_FIRMWARE_DIR", str(REPO_ROOT / "raspberry_pi" / "firmware")))
OTA_PORT = int(os.getenv("SAGE_LUMO_OTA_PORT", "8766"))
CHECK_EVERY = int(os.getenv("SAGE_LUMO_OTA_CHECK", str(15 * 60)))
TAG_PREFIX = "lumo-fw-"
# The clock's update has this long to come back before it counts as failed.
UPDATE_TIMEOUT = 5 * 60
MAX_TRIES = 3
RETRY_AFTER = 30 * 60
# Not this close to an alarm, so a slow update never eats one.
ALARM_MARGIN_MINUTES = 10
# Firmware that takes updates over Wi-Fi.
OTA_FIRMWARE = (2, 13)


def version(text: Any) -> tuple:
    try:
        return tuple(int(x) for x in str(text or "").split("."))
    except ValueError:
        return ()


def _git(*args: str) -> str:
    try:
        out = subprocess.run(["git", "-C", str(REPO_ROOT), *args], capture_output=True, text=True, timeout=5)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def this_branch() -> str:
    return os.getenv("SAGE_BRANCH") or _git("rev-parse", "--abbrev-ref", "HEAD") or "main"


def this_repo() -> str:
    """owner/name on GitHub, from SAGE_LUMO_REPO or the checkout's origin."""
    if os.getenv("SAGE_LUMO_REPO"):
        return os.environ["SAGE_LUMO_REPO"]
    match = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$", _git("remote", "get-url", "origin"))
    return match.group(1) if match else "vineeth100kumar/TASK_MANAGER"


def newest_build(releases: list, branch: str) -> Optional[dict]:
    """The newest firmware build for `branch` from GitHub's release list:
    its manifest plus the asset's download URL."""
    best = None
    for release in releases or []:
        if not isinstance(release, dict) or not str(release.get("tag_name", "")).startswith(TAG_PREFIX):
            continue
        try:
            manifest = json.loads(release.get("body") or "")
        except ValueError:
            continue
        if not isinstance(manifest, dict) or manifest.get("branch") != branch or not version(manifest.get("version")):
            continue
        asset = next((a for a in release.get("assets") or [] if a.get("name") == manifest.get("asset")), None)
        if not asset or not re.fullmatch(r"[0-9a-f]{32}", str(manifest.get("md5", ""))):
            continue
        build = {
            "version": manifest["version"], "sha": str(manifest.get("sha", ""))[:40], "md5": manifest["md5"],
            "size": int(manifest.get("size") or asset.get("size") or 0), "asset": manifest["asset"],
            "url": asset.get("browser_download_url", ""), "publishedAt": release.get("published_at"),
            "release": release.get("html_url"),
        }
        key = (version(build["version"]), build["publishedAt"] or "")
        if best is None or key > (version(best["version"]), best["publishedAt"] or ""):
            best = build
    return best


async def _github_releases(repo: str) -> list:
    import httpx
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        r = await client.get(f"https://api.github.com/repos/{repo}/releases", params={"per_page": 30},
                             headers={"Accept": "application/vnd.github+json"})
        r.raise_for_status()
        return r.json()


async def _download(url: str) -> bytes:
    import httpx
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.content


class FirmwareUpdates:
    def __init__(
        self,
        link,
        busy: Callable[[], str] = lambda: "",
        auto: Callable[[], bool] = lambda: True,
        releases: Callable[[str], Awaitable[list]] = _github_releases,
        download: Callable[[str], Awaitable[bytes]] = _download,
        branch: Optional[str] = None,
        repo: Optional[str] = None,
        cache: Path = CACHE,
        port: int = OTA_PORT,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.link = link
        self.busy = busy          # why the clock can't update now ("" if it can)
        self.auto = auto
        self.fetch_releases = releases
        self.download = download
        self.branch = branch or this_branch()
        self.repo = repo or this_repo()
        self.cache = cache
        self.port = port
        self.clock = clock

        self.latest: Optional[dict] = None   # the newest build for this branch
        self.file: Optional[Path] = None     # that build, downloaded and checked
        self.checked_at = 0.0
        self.check_error = ""
        self.state = "idle"                  # idle, updating, done or failed
        self.target = ""                     # the version being installed
        self.started_at = 0.0
        self.error = ""
        self.waiting = ""                    # why an available update is waiting
        self.tries: dict = {}                # version -> failed tries
        self.retry_at = 0.0
        self.history: deque = deque(maxlen=10)
        self._server: Optional[Any] = None
        self._path = ""
        self.on_change: Optional[Callable[[], Awaitable[None]]] = None
        link.on_connect = self.on_connect

    # --- What Sage shows ---

    def status(self) -> dict:
        running = getattr(self.link, "fw", "")
        latest = self.latest["version"] if self.latest else None
        return {
            "branch": self.branch,
            "canUpdate": bool(self.link.connected and self.clock_takes_updates()),
            "latest": latest,
            "latestSha": self.latest["sha"][:7] if self.latest else None,
            "latestAt": self.latest["publishedAt"] if self.latest else None,
            "ready": self.file is not None,
            "newer": bool(latest and version(latest) > version(running)),
            "state": self.state,
            "target": self.target or None,
            "error": self.error or None,
            "waiting": self.waiting or None,
            "checkedAt": int(self.checked_at * 1000) if self.checked_at else None,
            "checkError": self.check_error or None,
            "history": list(reversed(self.history)),
        }

    def clock_takes_updates(self) -> bool:
        return bool(getattr(self.link, "can_ota", False)) and version(getattr(self.link, "fw", "")) >= OTA_FIRMWARE

    def _record(self, result: str, detail: str = "") -> None:
        self.history.append({"at": int(self.clock() * 1000), "version": self.target, "result": result, "detail": detail})

    async def _changed(self) -> None:
        if self.on_change:
            try:
                await self.on_change()
            except Exception:
                log.exception("Announcing a firmware update failed")

    # --- Finding and downloading builds ---

    async def check(self) -> None:
        """Look for a newer build on GitHub and download it once."""
        self.checked_at = self.clock()
        try:
            build = newest_build(await self.fetch_releases(self.repo), self.branch)
        except Exception as e:
            self.check_error = f"couldn't reach GitHub: {e}"[:160]
            log.warning("LUMO firmware check failed: %s", e)
            return
        self.check_error = ""
        if not build:
            return
        if not self.latest or (build["version"], build["sha"]) != (self.latest["version"], self.latest["sha"]):
            log.info("LUMO firmware %s (%s) is the newest build for %s", build["version"], build["sha"][:7], self.branch)
            self.latest, self.file = build, None
        if self.file is None:
            await self._fetch(build)

    async def _fetch(self, build: dict) -> None:
        path = self.cache / f"lumo-{build['version']}-{build['sha'][:7]}.bin"
        if path.exists() and self._good(path.read_bytes(), build):
            self.file = path
            return
        try:
            data = await self.download(build["url"])
        except Exception as e:
            self.check_error = f"couldn't download {build['version']}: {e}"[:160]
            return
        if not self._good(data, build):
            self.check_error = f"the download of {build['version']} didn't match its MD5; trying again later"
            return
        self.cache.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(path)
        for old in self.cache.glob("lumo-*.bin"):
            if old != path:
                old.unlink(missing_ok=True)
        self.file = path
        log.info("LUMO firmware %s downloaded (%d bytes)", build["version"], len(data))

    @staticmethod
    def _good(data: bytes, build: dict) -> bool:
        return bool(data) and (not build["size"] or len(data) == build["size"]) and hashlib.md5(data).hexdigest() == build["md5"]

    # --- Updating the clock ---

    def due(self) -> bool:
        """Whether the clock should get the newest build now; sets `waiting`."""
        self.waiting = ""
        if not self.latest or self.file is None or self.state == "updating":
            return False
        if version(self.latest["version"]) <= version(getattr(self.link, "fw", "")):
            return False
        if not self.link.connected:
            self.waiting = "LUMO isn't connected"
            return False
        if not self.clock_takes_updates():
            self.waiting = "flash firmware 2.13 by USB once; after that LUMO updates itself"
            return False
        if not self.auto():
            self.waiting = "automatic updates are off"
            return False
        if self.tries.get(self.latest["version"], 0) >= MAX_TRIES:
            self.waiting = f"{self.latest['version']} failed {MAX_TRIES} times; press Update now to try again"
            return False
        if self.clock() < self.retry_at:
            self.waiting = "trying again after the last failure"
            return False
        busy = self.busy()
        if busy:
            self.waiting = busy
            return False
        return True

    async def tick(self) -> None:
        """Every 30 s: time out a lost update, check GitHub now and then, and update when due."""
        if self.state == "updating" and self.clock() - self.started_at > UPDATE_TIMEOUT:
            await self._failed("LUMO didn't come back after the update")
        if self.clock() - self.checked_at >= CHECK_EVERY:
            await self.check()
        if self.due():
            await self.start()

    async def update_now(self) -> str:
        """Look on GitHub, then send the newest build if it's newer. Returns "" or why not."""
        await self.check()
        if self.check_error and not (self.latest and self.file):
            return self.check_error
        return await self.start(force=True)

    async def start(self, force: bool = False) -> str:
        """Send the newest build to the clock. Returns "" or why it can't."""
        if force:
            if self.latest:
                self.tries.pop(self.latest["version"], None)
            self.retry_at = 0.0
            if not self.latest or self.file is None:
                await self.check()
            if not self.latest:
                return self.check_error or "No firmware build found on GitHub yet."
            if self.file is None:
                return self.check_error or "The firmware isn't downloaded yet."
            if not self.link.connected:
                return "LUMO isn't connected."
            if not self.clock_takes_updates():
                return "LUMO needs firmware 2.13 by USB once before it can update over Wi-Fi."
            if version(self.latest["version"]) <= version(self.link.fw):
                return f"LUMO already runs {self.link.fw}."
            busy = self.busy()
            if busy:
                return f"Not now: {busy}."
        if self.state == "updating":
            return "An update is already running."
        host = getattr(self.link, "local_ip", "")
        if not host:
            return "The Pi's address isn't known."
        await self._serve()
        self.state, self.target, self.started_at, self.error = "updating", self.latest["version"], self.clock(), ""
        url = f"http://{host}:{self.port}/{self._path}/{self.file.name}"
        log.info("Updating LUMO %s -> %s", self.link.fw, self.target)
        if not await self.link.send({"cmd": "OTA", "url": url, "version": self.target}):
            await self._failed("LUMO went away before it got the update")
            return self.error
        await self._changed()
        return ""

    async def on_connect(self) -> None:
        """The clock paired: after an update, did it take?"""
        if self.state != "updating":
            return
        if self.link.fw == self.target:
            self.state, self.error = "done", ""
            self.tries.pop(self.target, None)
            self._record("done")
            log.info("LUMO updated to %s", self.target)
            await self._stop_serving()
            await self._changed()
        elif self.link.ota_error:
            await self._failed(self.link.ota_error)
        # Otherwise it dropped while downloading; it says why next time, or times out.

    async def _failed(self, why: str) -> None:
        self.state, self.error = "failed", why
        self.tries[self.target] = self.tries.get(self.target, 0) + 1
        self.retry_at = self.clock() + RETRY_AFTER
        self._record("failed", why)
        log.warning("LUMO update to %s failed: %s", self.target, why)
        await self._stop_serving()
        await self._changed()

    # --- The one-off file server ---

    async def _serve(self) -> None:
        if self._server is not None:
            return
        self._path = secrets.token_urlsafe(12)
        self._server = await asyncio.start_server(self._answer, "0.0.0.0", self.port)

    async def _stop_serving(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.close()
            try:
                await asyncio.wait_for(server.wait_closed(), 5)
            except Exception:
                pass

    async def _answer(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request = (await asyncio.wait_for(reader.readline(), 10)).decode("latin-1").split()
            while (await asyncio.wait_for(reader.readline(), 10)) not in (b"\r\n", b"\n", b""):
                pass
            file = self.file
            if (len(request) < 2 or request[0] != "GET" or file is None or self.latest is None
                    or request[1] != f"/{self._path}/{file.name}"):
                writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                return
            data = file.read_bytes()
            writer.write((
                "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n"
                f"Content-Length: {len(data)}\r\nx-MD5: {self.latest['md5']}\r\nConnection: close\r\n\r\n"
            ).encode())
            for i in range(0, len(data), 16384):
                writer.write(data[i:i + 16384])
                await writer.drain()
        except Exception as e:
            log.warning("Serving LUMO's update failed: %s", e)
        finally:
            try:
                await writer.drain()
                writer.close()
            except Exception:
                pass
