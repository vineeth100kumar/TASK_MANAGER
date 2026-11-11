"""
spotify.py - the Pi as a Spotify Connect speaker, playing on Sage's soundbar.

go-librespot (an open-source Spotify Connect client, installed by
deploy/install_pi.sh --only audio) runs as a child of Sage. It signs in the
way a TV or a games console does: it asks Spotify for a short code, you enter
it at spotify.com/pair on your phone or laptop with your normal Spotify
account (Premium), and it remembers you. No Spotify developer app or keys.

Then "Sage" shows up in the Spotify app's device list, from anywhere. Pick it
and the music plays on the soundbar:

- When Spotify starts playing, Sage connects the soundbar (speaker.py) if it
  isn't already. If the first song tried to start before the soundbar was
  ready, Sage starts it again once it is.
- Sage's own voice (greeting, reminders) pauses Spotify for a moment and then
  carries on. The optional phone pass-through steps aside while Spotify plays.
- Surround (speaker.py) applies to Spotify too; switching it moves the music
  live through go-librespot's /player/output.
- Settings > Bluetooth has a Spotify card: sign in, now playing, play/pause,
  skip, volume, the name in the device list, quality, sign out.

go-librespot's own HTTP API listens on 127.0.0.1 only; Sage talks to it and
the web app talks to Sage. Settings live in the metadata table under
"spotify". Its sign-in and state live in SAGE_SPOTIFY_DIR (default
~/.config/sage-spotify).
"""

import asyncio
import json
import logging
import os
import re
import shutil
import sqlite3
import time
from collections import deque
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional

log = logging.getLogger("spotify")

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
SETTINGS_KEY = "spotify"
PORT = int(os.getenv("SAGE_SPOTIFY_PORT", "3678"))
API = f"http://127.0.0.1:{PORT}"
CONFIG_DIR = Path(os.getenv("SAGE_SPOTIFY_DIR", "") or (Path.home() / ".config" / "sage-spotify"))
CHECK_EVERY = 3.0
QUALITIES = (96, 160, 320)

DEFAULTS: Dict[str, Any] = {
    "enabled": True,      # run the Spotify Connect speaker
    "name": "Sage",       # the name in Spotify's device list
    "quality": 320,       # kbps: 96 | 160 | 320
    "normalise": True,    # even out loudness between songs
    "autoplay": True,     # keep playing similar songs when a playlist ends
}


def binary() -> str:
    """Where go-librespot is, or ""."""
    env = os.getenv("SAGE_SPOTIFY_BIN", "")
    if env:
        return env if os.access(env, os.X_OK) else ""
    return shutil.which("go-librespot") or ("/usr/local/bin/go-librespot" if os.access("/usr/local/bin/go-librespot", os.X_OK) else "")


# --- Settings ---

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
    return conn


def get_settings() -> dict:
    conn = _connect()
    try:
        row = conn.execute("SELECT value FROM metadata WHERE key = ?", (SETTINGS_KEY,)).fetchone()
    finally:
        conn.close()
    saved: Any = {}
    if row:
        try:
            saved = json.loads(row[0])
        except ValueError:
            saved = {}
    out = dict(DEFAULTS)
    if isinstance(saved, dict):
        out.update({k: v for k, v in saved.items() if k in DEFAULTS})
    return out


def clean_settings(update: dict, current: Optional[dict] = None) -> dict:
    """Merge an update into the settings, refusing values that don't fit. Pure."""
    out = dict(current or DEFAULTS)
    for key in ("enabled", "normalise", "autoplay"):
        if key in update:
            out[key] = bool(update[key])
    if "name" in update:
        name = re.sub(r"[^\w .'&()-]", "", str(update.get("name") or "")).strip()[:40]
        if not name:
            raise ValueError("Give the speaker a name, like Sage or Living room.")
        out["name"] = name
    if "quality" in update:
        quality = int(update["quality"])
        if quality not in QUALITIES:
            raise ValueError("Quality is 96, 160 or 320 kbps.")
        out["quality"] = quality
    return out


def save_settings(update: dict) -> dict:
    settings = clean_settings(update, get_settings())
    conn = _connect()
    try:
        conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", (SETTINGS_KEY, json.dumps(settings)))
        conn.commit()
    finally:
        conn.close()
    return settings


# --- Pure helpers ---

def daemon_config(settings: dict, device: str) -> dict:
    """go-librespot's config.yml (JSON is valid YAML). Pure."""
    return {
        "log_level": "info",
        "log_disable_timestamp": True,
        "device_name": settings["name"],
        "device_type": "speaker",
        "audio_backend": "alsa",
        "audio_device": device or "default",
        # Music isn't lip-synced to anything, so a roomy buffer: fewer dropouts
        # over Bluetooth, and the only cost is volume and skips landing 0.5 s later.
        "audio_buffer_time": 500000,
        "bitrate": settings["quality"],
        "normalisation_disabled": not settings["normalise"],
        "disable_autoplay": not settings["autoplay"],
        "zeroconf_enabled": False,
        "credentials": {"type": "device_auth"},
        "server": {"enabled": True, "address": "127.0.0.1", "port": PORT, "image_size": "default"},
    }


def restart_keys(a: dict, b: dict) -> bool:
    """True when a settings change needs go-librespot restarted. Pure."""
    return any(a.get(k) != b.get(k) for k in ("name", "quality", "normalise", "autoplay"))


def now_playing(status: Optional[dict]) -> Optional[dict]:
    """The bits of go-librespot's /status the web app shows. Pure."""
    if not status:
        return None
    track = status.get("track") or None
    steps = int(status.get("volume_steps") or 100) or 100
    return {
        "playing": not status.get("stopped") and not status.get("paused") and bool(track),
        "paused": bool(status.get("paused")),
        "stopped": bool(status.get("stopped")),
        "buffering": bool(status.get("buffering")),
        "volume": round(int(status.get("volume") or 0) * 100 / steps),
        "shuffle": bool(status.get("shuffle_context")),
        "context": status.get("context_name") or "",
        "track": {
            "name": track.get("name") or "",
            "artists": ", ".join(track.get("artist_names") or []),
            "album": track.get("album_name") or "",
            "cover": track.get("album_cover_url") or "",
            "duration": int(track.get("duration") or 0),
            "position": int(track.get("position") or 0),
            "uri": track.get("uri") or "",
        } if track else None,
    }


def saved_user(config_dir: Path = CONFIG_DIR) -> str:
    """The Spotify account go-librespot remembers, or ""."""
    for name in ("state.json", "credentials.json"):
        try:
            data = json.loads((config_dir / name).read_text())
        except (OSError, ValueError):
            continue
        creds = data.get("credentials", data) if isinstance(data, dict) else {}
        if isinstance(creds, dict) and creds.get("username") and creds.get("data"):
            return str(creds["username"])
    return ""


def forget_user(config_dir: Path = CONFIG_DIR) -> None:
    """Sign out: drop the remembered account, keep the device id and volume."""
    try:
        (config_dir / "credentials.json").unlink()
    except OSError:
        pass
    path = config_dir / "state.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return
    if isinstance(data, dict) and "credentials" in data:
        data["credentials"] = {"username": "", "data": None}
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.replace(tmp, path)


def friendly_log(line: str) -> str:
    """go-librespot's log line without logrus' level= / msg= noise. Pure."""
    msg = re.search(r'msg="((?:[^"\\]|\\.)*)"', line)
    err = re.search(r'error="((?:[^"\\]|\\.)*)"', line)
    text = (msg.group(1) if msg else line).replace('\\"', '"')
    if err:
        text += ": " + err.group(1).replace('\\"', '"')
    return text.strip()[:240]


# --- The speaker ---

Emit = Callable[[dict], Awaitable[None]]


class SpotifyConnect:
    def __init__(self) -> None:
        self.emit: Optional[Emit] = None
        self.speaker = None          # speaker.speaker, set by run()
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.lines: deque = deque(maxlen=40)
        self.started_at = 0.0
        self.next_start = 0.0
        self.fails = 0
        self.running_settings: Optional[dict] = None
        self.device = ""             # the ALSA device go-librespot plays on now
        self.status: Optional[dict] = None
        self.auth: Optional[dict] = None
        self.ready = False           # the API answered
        self.user = ""
        self.error: Optional[dict] = None
        self.held = False            # paused for Sage's voice
        self.retry: Optional[dict] = None    # a song that failed to start before the soundbar was up
        self.last_load: Optional[dict] = None
        self._connecting = False
        self._last_sent = ""
        self._client = None

    # --- go-librespot's API ---

    async def api(self, method: str, path: str, body: Optional[dict] = None, timeout: float = 5):
        import httpx
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=API)
        try:
            res = await self._client.request(method, path, json=body, timeout=timeout)
        except httpx.HTTPError as e:
            raise RuntimeError(f"Spotify on the Pi didn't answer ({type(e).__name__}).") from e
        if res.status_code == 204:
            return None
        if res.status_code >= 400:
            raise RuntimeError(res.text.strip()[:200] or f"HTTP {res.status_code}")
        try:
            return res.json()
        except ValueError:
            return {}

    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    # --- State for the web app ---

    def snapshot(self) -> dict:
        settings = get_settings()
        sb = (getattr(self.speaker, "links", None) or {}).get("soundbar") or {}
        try:
            import speaker as speaker_mod
            soundbar = speaker_mod.get_settings()
        except Exception:
            soundbar = {"address": "", "name": ""}
        return {
            "settings": settings,
            "installed": bool(binary()),
            "running": self.alive(),
            "ready": self.ready,
            "user": self.user or saved_user(),
            "auth": self.auth,
            "player": now_playing(self.status),
            "soundbar": {"address": soundbar.get("address", ""), "name": soundbar.get("name", ""), "connected": bool(sb.get("connected"))},
            "device": self.device,
            "error": self.error if self.error and time.time() - self.error["at"] < 600 else None,
        }

    async def publish(self, force: bool = False) -> None:
        if not self.emit:
            return
        snap = await asyncio.to_thread(self.snapshot)
        key = json.dumps(snap, sort_keys=True, default=str)
        if force or key != self._last_sent:
            self._last_sent = key
            await self.emit({"type": "SPOTIFY_STATE", **snap})

    def _fail(self, message: str) -> None:
        log.info("Spotify: %s", message)
        self.error = {"message": message, "at": time.time()}
        try:
            import logstore
            logstore.warn("spotify", message)
        except Exception:
            pass

    # --- The process ---

    def want_device(self) -> str:
        """The soundbar (through surround when it's on), or the Pi's own output."""
        try:
            import speaker as speaker_mod
            settings = speaker_mod.get_settings()
            if settings["address"] and self.speaker is not None:
                return self.speaker.device(settings)
        except Exception as e:
            log.debug("No soundbar device: %s", e)
        return "default"

    async def start(self) -> None:
        exe = binary()
        if not exe:
            return
        settings = get_settings()
        self.device = self.want_device()
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        (CONFIG_DIR / "config.yml").write_text(json.dumps(daemon_config(settings, self.device), indent=2))
        self.lines.clear()
        self.ready = False
        try:
            self.proc = await asyncio.create_subprocess_exec(
                exe, "--config_dir", str(CONFIG_DIR),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, start_new_session=True)
        except OSError as e:
            self._fail(f"go-librespot didn't start: {e}")
            self.next_start = time.time() + 60
            return
        self.started_at = time.time()
        self.running_settings = settings
        asyncio.ensure_future(self._read_log(self.proc))
        log.info("Spotify Connect started as %r on %s.", settings["name"], self.device)

    async def _read_log(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode(errors="replace").rstrip()
            self.lines.append(line)
            if "level=error" in line or "level=fatal" in line or "level=panic" in line:
                log.info("go-librespot: %s", line[:300])

    async def stop(self) -> None:
        proc, self.proc = self.proc, None
        self.ready = False
        self.status = None
        self.auth = None
        if proc is None or proc.returncode is not None:
            return
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    async def restart(self) -> None:
        await self.stop()
        self.next_start = 0.0
        self.fails = 0
        await self.supervise()

    async def supervise(self) -> None:
        """Keep go-librespot running when it's on, with a growing pause if it keeps dying."""
        settings = get_settings()
        if not settings["enabled"] or not binary():
            if self.alive():
                await self.stop()
            return
        if self.alive():
            if self.running_settings and restart_keys(self.running_settings, settings):
                log.info("Spotify settings changed; restarting go-librespot.")
                await self.stop()
            else:
                return
        if self.proc is not None and self.proc.returncode is not None:
            # It stopped by itself.
            lived = time.time() - self.started_at
            last = next((friendly_log(l) for l in reversed(self.lines) if "level=" in l and "level=info" not in l and "level=debug" not in l), "")
            self.fails = self.fails + 1 if lived < 60 else 1
            wait = min(300, 5 * 2 ** (self.fails - 1))
            self._fail(f"Spotify stopped ({last or 'no reason given'}). Starting it again in {wait} s.")
            self.next_start = time.time() + wait
            self.proc = None
            self.ready = False
        if time.time() >= self.next_start:
            await self.start()

    # --- Watching it ---

    async def poll(self) -> None:
        if not self.alive():
            self.ready = False
            return
        try:
            await self.api("GET", "/")
            self.ready = True
            self.auth = await self.api("GET", "/auth/code")
            self.status = await self.api("GET", "/status")
            if self.status and self.status.get("username"):
                self.user = str(self.status["username"])
                self.auth = None
            if self.status and self.fails and time.time() - self.started_at > 60:
                self.fails = 0
        except Exception as e:
            log.debug("Spotify API not answering: %s", e)
            self.ready = False
        await self.follow_output()

    async def follow_output(self) -> None:
        """Surround switched or another soundbar picked: move the music live."""
        want = self.want_device()
        if not self.ready or want == self.device:
            return
        try:
            await self.api("POST", "/player/output", {"device": want})
            log.info("Spotify now plays on %s.", want)
            self.device = want
        except Exception as e:
            log.info("Couldn't move Spotify to %s: %s", want, e)

    async def events(self) -> None:
        """go-librespot's event stream: start the soundbar the moment music starts."""
        import websockets
        while True:
            if not self.ready:
                await asyncio.sleep(2)
                continue
            try:
                async with websockets.connect(f"ws://127.0.0.1:{PORT}/events", open_timeout=5, ping_interval=30) as ws:
                    async for raw in ws:
                        try:
                            ev = json.loads(raw)
                        except ValueError:
                            continue
                        await self.on_event(str(ev.get("type") or ""), ev.get("data") or {})
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.debug("Spotify events dropped: %s", e)
            await asyncio.sleep(2)

    async def on_event(self, kind: str, data: dict) -> None:
        if kind == "will_play":
            self.last_load = {"context": data.get("context_uri") or "", "uri": data.get("uri") or "", "at": time.time()}
            asyncio.ensure_future(self.soundbar_up())
        elif kind in ("active", "playing"):
            asyncio.ensure_future(self.soundbar_up())
        elif kind == "playback_error":
            await self.on_playback_error(data)
        if kind in ("active", "inactive", "metadata", "will_play", "playing", "not_playing", "paused", "stopped", "volume", "shuffle_context"):
            try:
                self.status = await self.api("GET", "/status")
            except Exception:
                pass
            await self.publish()

    def _soundbar_ready(self) -> bool:
        sb = (getattr(self.speaker, "links", None) or {}).get("soundbar") or {}
        return bool(sb.get("connected"))

    async def on_playback_error(self, data: dict) -> None:
        uri = str(data.get("uri") or "")
        if self._connecting or not self._soundbar_ready():
            # The soundbar wasn't there yet: play it again once it is.
            load = self.last_load or {}
            self.retry = {"uri": uri or load.get("uri", ""), "context": load.get("context", "") if load.get("uri") == uri or not uri else ""}
            return
        if self.device.startswith("sage_surround") and self.speaker is not None:
            self.speaker._surround_failed("Spotify couldn't open it")
            await self.follow_output()
            self.retry = {"uri": uri, "context": (self.last_load or {}).get("context", "")}
            await self.replay()
            return
        why = str(data.get("message") or data.get("kind") or "unknown error")
        self._fail(f"Spotify couldn't play that: {why[:160]}")

    async def soundbar_up(self) -> None:
        """Connect the soundbar for Spotify, then retry a song that missed it."""
        if self.speaker is None or self._connecting:
            return
        try:
            import speaker as speaker_mod
            if not speaker_mod.get_settings()["address"]:
                return
        except Exception:
            return
        self._connecting = True
        try:
            await self.speaker.make_room()
            if not self._soundbar_ready():
                if await self.speaker.ensure_connected():
                    await asyncio.sleep(0.5)
            await self.follow_output()
        finally:
            self._connecting = False
        await self.replay()

    async def replay(self) -> None:
        retry, self.retry = self.retry, None
        if not retry or not retry.get("uri") or not self._soundbar_ready():
            return
        body = {"uri": retry["context"] or retry["uri"]}
        if retry["context"]:
            body["skip_to_uri"] = retry["uri"]
        try:
            await self.api("POST", "/player/play", body, timeout=15)
            log.info("Started the song again now the soundbar is up.")
        except Exception as e:
            self._fail(f"Couldn't start the song again: {e}")

    # --- Controls ---

    async def control(self, action: str) -> None:
        paths = {"playpause": "/player/playpause", "pause": "/player/pause", "resume": "/player/resume",
                 "next": "/player/next", "prev": "/player/prev"}
        if action not in paths:
            raise ValueError("Unknown control.")
        if not self.ready:
            raise RuntimeError("Spotify isn't running on the Pi yet.")
        await self.api("POST", paths[action], {} if action == "next" else None)
        self.status = await self.api("GET", "/status")
        await self.publish()

    async def set_volume(self, percent: int) -> None:
        if not self.ready:
            raise RuntimeError("Spotify isn't running on the Pi yet.")
        percent = max(0, min(100, int(percent)))
        steps = int((self.status or {}).get("volume_steps") or 100) or 100
        await self.api("POST", "/player/volume", {"volume": round(percent * steps / 100)})
        self.status = await self.api("GET", "/status")
        await self.publish()

    async def shuffle(self, on: bool) -> None:
        if not self.ready:
            raise RuntimeError("Spotify isn't running on the Pi yet.")
        await self.api("POST", "/player/shuffle_context", {"shuffle_context": bool(on)})
        self.status = await self.api("GET", "/status")
        await self.publish()

    async def sign_out(self) -> None:
        await self.stop()
        await asyncio.to_thread(forget_user)
        self.user = ""
        self.status = None
        await self.restart()
        await self.publish(force=True)

    def playing(self) -> bool:
        p = now_playing(self.status)
        return bool(self.ready and p and p["playing"])

    async def hold(self) -> bool:
        """Pause for Sage's voice. True when it was playing (so release() resumes)."""
        if not self.playing():
            return False
        try:
            await self.api("POST", "/player/pause")
            self.held = True
            await asyncio.sleep(0.4)  # go-librespot closes the ALSA device on pause
            return True
        except Exception as e:
            log.info("Couldn't pause Spotify to speak: %s", e)
            return False

    async def release(self) -> None:
        if not self.held:
            return
        self.held = False
        try:
            await self.api("POST", "/player/resume")
        except Exception as e:
            log.info("Couldn't resume Spotify after speaking: %s", e)

    async def pause_quietly(self) -> None:
        if self.playing():
            try:
                await self.api("POST", "/player/pause")
            except Exception:
                pass

    # --- Running ---

    async def run(self, broadcast: Emit, speaker: Any) -> None:
        self.emit = broadcast
        self.speaker = speaker
        speaker.music = self
        if not binary():
            log.info("go-librespot isn't installed; Spotify Connect is off (run: sudo deploy/install_pi.sh --only audio).")
        asyncio.ensure_future(self.events())
        while True:
            try:
                await self.supervise()
                await self.poll()
                await self.publish()
            except Exception as e:
                log.debug("Spotify check failed: %s", e)
            await asyncio.sleep(CHECK_EVERY)


connect = SpotifyConnect()
