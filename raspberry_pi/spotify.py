"""
spotify.py - the Pi as a Spotify Connect speaker, playing on Sage's soundbar.

This uses Spotify Soloist, Spotify's own player for headless devices (an
official binary, not an open-source reimplementation), so Spotify plays
properly instead of refusing the audio key. Sage runs it as a child process
and controls it over its local WebSocket.

Sign in: you make a free Soloist API key once at
developer.spotify.com/dashboard/soloist (the account needs Premium), paste it
into Sage, and then pick "Sage" in the Spotify app's device list, from
anywhere. No developer app, redirect URL or spotify.com/pair code: Soloist
joins through Spotify Connect, the way a real speaker does, and remembers you.

Audio: Soloist plays through PipeWire, so Sage makes a PipeWire sink that
feeds the soundbar's bluez-alsa device (through the surround device when
Surround is on) and points Soloist at it (`-d sage-spotify`). When no soundbar
is picked, Soloist plays on the Pi's own output. Sage's voice (speaker.py)
pauses Soloist for a moment and then carries on.

Settings live in the metadata table under "spotify". Soloist's sign-in and
state live in SAGE_SOLOIST_DIR (default ~/.local/share/sage-soloist). The API
key is the only secret; it is never logged or sent anywhere but Soloist.
"""

import asyncio
import json
import logging
import os
import re
import shlex
import shutil
import signal
import sqlite3
import time
from collections import deque
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

log = logging.getLogger("spotify")

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
SETTINGS_KEY = "spotify"
WS_PORT = int(os.getenv("SAGE_SOLOIST_PORT", "3678"))
WS = f"ws://127.0.0.1:{WS_PORT}"
DATA_DIR = Path(os.getenv("SAGE_SOLOIST_DIR", "") or (Path.home() / ".local" / "share" / "sage-soloist"))
CACHE_DIR = Path(os.getenv("SAGE_SOLOIST_CACHE", "") or (Path.home() / ".cache" / "sage-soloist"))
PW_NODE = "sage-spotify"      # the PipeWire sink Soloist plays into
PW_CONF = Path.home() / ".config" / "pipewire" / "pipewire.conf.d" / "50-sage-spotify.conf"
CHECK_EVERY = 3.0


DEFAULTS: Dict[str, Any] = {
    "enabled": True,      # run the Spotify speaker
    "name": "Sage",       # the name in Spotify's device list
    "apiKey": "",         # the Soloist API key (developer.spotify.com/dashboard/soloist)
}


def binary() -> str:
    """Where the soloist binary is, or ""."""
    env = os.getenv("SAGE_SOLOIST_BIN", "")
    if env:
        return env if os.access(env, os.X_OK) else ""
    return shutil.which("soloist") or ("/usr/local/bin/soloist" if os.access("/usr/local/bin/soloist", os.X_OK) else "")


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
    if "enabled" in update:
        out["enabled"] = bool(update["enabled"])
    if "name" in update:
        name = re.sub(r"[^\w .'&()-]", "", str(update.get("name") or "")).strip()[:40]
        if not name:
            raise ValueError("Give the speaker a name, like Sage or Living room.")
        out["name"] = name
    if "apiKey" in update:
        key = str(update.get("apiKey") or "").strip()
        if key and not re.fullmatch(r"[\w.-]{8,200}", key):
            raise ValueError("That doesn't look like a Soloist API key.")
        out["apiKey"] = key
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


def public_settings(settings: dict) -> dict:
    """Settings for the web app: the key becomes a yes/no, never sent out. Pure."""
    out = {k: v for k, v in settings.items() if k != "apiKey"}
    out["hasKey"] = bool(settings.get("apiKey"))
    return out


# --- Pure helpers ---

def audio_env(base: Optional[dict] = None) -> dict:
    """The environment a child needs to reach the user's PipeWire/Pulse server.
    Sage runs as a system service, which has no XDG_RUNTIME_DIR, so without
    this Soloist can't find the sound server: it "plays" at 0:00 forever and
    no stream ever reaches the sink. Pure."""
    env = dict(os.environ if base is None else base)
    runtime = env.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    env["XDG_RUNTIME_DIR"] = runtime
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path={runtime}/bus")
    env.setdefault("PULSE_SERVER", f"unix:{runtime}/pulse/native")
    env.setdefault("PIPEWIRE_RUNTIME_DIR", runtime)
    return env


def soloist_cmd(settings: dict, node: str) -> List[str]:
    """How to launch Soloist. The key is passed on argv as the docs show. Pure."""
    cmd = ["soloist", "--device-name", settings["name"], "--api-key", settings["apiKey"],
           "--ws", f"127.0.0.1:{WS_PORT}", "--data-dir", str(DATA_DIR), "--cache-dir", str(CACHE_DIR)]
    if node:
        cmd += ["-d", node]
    return cmd


def pipewire_sink_conf(node: str, alsa_device: str = "") -> str:
    """A PipeWire config fragment: a silent virtual sink named `node` that
    Soloist plays into. A bridge (bridge_cmd) then copies its monitor to the
    soundbar's bluez-alsa device. (Feeding a bluez-alsa PCM from PipeWire's own
    ALSA sink never drained, so Soloist froze and flipped play/pause.) Pure."""
    props = json.dumps({
        "factory.name": "support.null-audio-sink",
        "node.name": node,
        "node.description": "Spotify on the soundbar",
        "media.class": "Audio/Sink",
        "object.linger": True,
        "audio.position": ["FL", "FR"],
        "audio.rate": 44100,
    })
    return ("context.objects = [\n"
            "  { factory = adapter\n"
            f"    args = {props}\n"
            "  }\n"
            "]\n")


def bridge_cmd(node: str, alsa_device: str) -> str:
    """Shell pipeline: record the sink's monitor, play it on the soundbar. Pure."""
    return (f"exec parec -d {shlex.quote(node + '.monitor')} --format=s16le --rate=44100 --channels=2 --latency-msec=60"
            f" | exec aplay -q -D {shlex.quote(alsa_device)} -t raw -f S16_LE -r 44100 -c 2")


def now_playing(state: Optional[dict]) -> Optional[dict]:
    """The bits of Soloist's playback_state the web app shows. Pure."""
    if not state:
        return None
    item = state.get("item") or None
    status = str(state.get("status") or "idle")
    pos = state.get("position") or {}
    options = state.get("options") or {}

    def _deco(obj, *path, default=""):
        cur = (obj or {}).get("decorations") or {}
        for p in path:
            cur = (cur or {}).get(p)
            if cur is None:
                return default
        return cur

    track = None
    if item:
        identity = ((item.get("decorations") or {}).get("identity") or {})
        artists = identity.get("artists") or identity.get("artist_names") or []
        if isinstance(artists, list):
            artists = ", ".join(str(a.get("name") if isinstance(a, dict) else a) for a in artists)
        track = {
            "name": str(identity.get("name") or ""),
            "artists": str(artists or ""),
            "album": str(_deco(item, "album", "name") or identity.get("album") or ""),
            "cover": str(_deco(item, "identity", "image_url") or identity.get("image_url") or ""),
            "duration": int(_deco(item, "playback", "duration_ms", default=0) or 0),
            "position": int(pos.get("position_ms") or 0),
            "uri": str(item.get("uri") or ""),
        }
    return {
        "playing": status == "playing",
        "paused": status == "paused",
        "stopped": status == "idle",
        "buffering": status == "buffering",
        "volume": int(state.get("volume") or 0),
        "shuffle": bool(options.get("shuffle")),
        "context": str(_deco(state.get("context"), "identity", "name") or ""),
        "active": bool(state.get("is_active")),
        "track": track,
    }


def friendly_log(line: str) -> str:
    """A Soloist log line, trimmed for showing. Pure."""
    return re.sub(r"\s+", " ", line or "").strip()[:240]


def expired(code: Optional[int]) -> bool:
    """Soloist exits 10 when its build is more than 90 days old. Pure."""
    return code == 10


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
        self.running_key = ""        # name|apiKey Soloist is running with
        self.device = ""             # the ALSA device the PipeWire sink feeds now
        self.bridge: Optional[asyncio.subprocess.Process] = None
        self._probe_at = 0.0         # when the last audio snapshot was taken
        self._progress_pos = -1      # song position (s) from Soloist's status lines
        self._progress_at = 0.0      # when that position last changed
        self._stalled_at = 0.0       # last stall snapshot
        self._line_status = ""       # playing / paused / buffering from the last status line
        self._bridge_died_at = 0.0
        self.used_node = False       # the last start used the soundbar sink node
        self.node_fails = 0          # quick crashes while the soundbar sink was used
        self.state: Optional[dict] = None   # last playback_state
        self.logged_in = False
        self.is_active = False
        self.ready = False           # the WebSocket is connected
        self.build_expired = False
        self.error: Optional[dict] = None
        self.held = False
        self._ws = None
        self._connecting = False
        self._last_sent = ""
        self._ops = asyncio.Lock()       # one start/stop/restart at a time
        self._log_at = 0.0
        self._log_last = ""

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
            "settings": public_settings(settings),
            "installed": bool(binary()),
            "running": self.alive(),
            "ready": self.ready,
            "loggedIn": self.logged_in,
            "expired": self.build_expired,
            "player": now_playing(self.state),
            "soundbar": {"address": soundbar.get("address", ""), "name": soundbar.get("name", ""), "connected": bool(sb.get("connected"))},
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

    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    # --- Audio routing (PipeWire sink -> the soundbar) ---

    def want_device(self) -> str:
        """The soundbar's ALSA device (through surround when on), or "" for the
        Pi's own output."""
        try:
            import speaker as speaker_mod
            settings = speaker_mod.get_settings()
            if settings["address"] and self.speaker is not None:
                return self.speaker.device(settings)
        except Exception as e:
            log.debug("No soundbar device: %s", e)
        return ""

    async def _write_sink(self, alsa_device: str) -> bool:
        """Point the PipeWire sink at the soundbar; restart PipeWire if it changed.
        Returns True when Soloist should play into the sink node."""
        if not alsa_device:
            if PW_CONF.exists():
                try:
                    PW_CONF.unlink()
                    await self._restart_pipewire()
                except OSError:
                    pass
            self.device = ""
            return False
        conf = pipewire_sink_conf(PW_NODE, alsa_device)
        try:
            current = PW_CONF.read_text() if PW_CONF.exists() else ""
            if current != conf:   # also replaces the older ALSA-sink version
                PW_CONF.parent.mkdir(parents=True, exist_ok=True)
                PW_CONF.write_text(conf)
                await self._restart_pipewire()
            self.device = alsa_device
            return True
        except OSError as e:
            self._fail(f"Couldn't set up the Spotify sound output: {e}")
            return False

    async def _restart_pipewire(self) -> None:
        env = dict(os.environ)
        env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
        for svc in ("pipewire", "pipewire-pulse", "wireplumber"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "systemctl", "--user", "restart", svc, env=env,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                await asyncio.wait_for(proc.wait(), timeout=10)
            except (OSError, asyncio.TimeoutError) as e:
                log.debug("Couldn't restart %s: %s", svc, e)
        await asyncio.sleep(1.0)  # let the nodes come back

    # --- The process ---

    async def start(self) -> None:
        exe = binary()
        settings = get_settings()
        if not exe or not settings["enabled"] or not settings["apiKey"]:
            return
        # Clear any leftover Soloist still holding the data-dir lock, or the new
        # one refuses to start ("Stop the running session before starting
        # soloist again") and we loop forever.
        await self._reap_strays()
        want = self.want_device()
        # After a couple of quick crashes with the soundbar sink, fall back to
        # the Pi's own output so music at least plays while we sort the sink out.
        use_node = False
        if want and self.node_fails < 2:
            # Connect the soundbar first so its ALSA device exists for the sink.
            if self.speaker is not None:
                try:
                    await self.speaker.ensure_connected()
                except Exception as e:
                    log.debug("Soundbar not ready for Spotify: %s", e)
            use_node = await self._write_sink(want)
        else:
            if want and self.node_fails >= 2:
                self._fail("Spotify couldn't open the soundbar, so it's playing on the "
                           "Pi's own output for now. Try Restart, or re-pick the soundbar.")
            await self._write_sink("")
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.lines.clear()
        self.ready = False
        self.build_expired = False
        try:
            self.proc = await asyncio.create_subprocess_exec(
                *soloist_cmd(settings, PW_NODE if use_node else ""), env=audio_env(),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, start_new_session=True)
        except OSError as e:
            self._fail(f"Soloist didn't start: {e}")
            self.next_start = time.time() + 60
            return
        self.started_at = time.time()
        self.used_node = use_node
        self.running_key = settings["name"] + "|" + settings["apiKey"]
        asyncio.ensure_future(self._read_log(self.proc))
        if use_node:
            await self._start_bridge()
        self._progress_at, self._line_status, self._progress_pos = 0.0, "", -1
        self.probe_later(10, "after start", min_gap=20)
        log.info("Spotify (Soloist) started as %r%s.", settings["name"], " on the soundbar" if use_node else "")

    # --- Diagnostics (audio_probe.py writes a full snapshot to the log) ---

    async def diagnose(self, reason: str, deep: bool = True) -> None:
        """Write the full audio snapshot to sage_logs (source audio-probe)."""
        self._probe_at = time.time()
        try:
            import audio_probe
            await audio_probe.record(self, reason, deep)
        except Exception as e:
            log.debug("Audio snapshot failed: %s", e)

    def probe_later(self, delay: float, reason: str, min_gap: float = 30.0) -> None:
        """Take a snapshot `delay` seconds from now, unless one was just taken."""
        async def go() -> None:
            await asyncio.sleep(delay)
            if time.time() - self._probe_at >= min_gap:
                await self.diagnose(reason)
        asyncio.ensure_future(go())

    async def probe_loop(self) -> None:
        """Independent of the main loop (so nothing else can block it): while a
        song is playing or loading, write an audio snapshot about every 45 s,
        plus one the moment it starts, so there is always one from during play."""
        beat = 0.0
        while True:
            await asyncio.sleep(4)
            try:
                now = time.time()
                st = (self.state or {}).get("status")
                busy = self._line_status in ("playing", "buffering") or st in ("playing", "buffering")
                # A one-line heartbeat of what this loop sees, so a snapshot that
                # doesn't fire can be explained from the log alone.
                if now - beat >= 20:
                    beat = now
                    try:
                        import audio_probe
                        import logstore
                        logstore.info("spotify-loop",
                                      f"alive={self.alive()} busy={busy} lineStatus={self._line_status!r} wsStatus={st!r} "
                                      f"posAge={int(now - self._progress_at) if self._progress_at else None}s "
                                      f"lastProbeAge={int(now - self._probe_at) if self._probe_at else None}s "
                                      f"probeLockHeld={audio_probe._lock.locked()} bridgeAlive={self._bridge_alive()} "
                                      f"lines={len(self.lines)}")
                    except Exception:
                        pass
                # While a song plays, a snapshot about every 45 s; while merely
                # running, one every 3 min, so there is always recent data.
                gap = 45 if busy else 180
                if self.alive() and now - self._probe_at >= gap:
                    await asyncio.wait_for(self.diagnose("playing" if busy else "idle"), timeout=90)
                self.check_stall()
            except Exception as e:
                log.debug("Probe loop: %s", e)
                try:
                    import logstore
                    logstore.warn("spotify-loop", f"probe loop error: {e!r}")
                except Exception:
                    pass

    def check_stall(self) -> None:
        """Soloist says "playing" but the song position hasn't moved: log why."""
        now = time.time()
        if (self._line_status == "playing" and self._progress_at and now - self._progress_at > 12
                and now - self._stalled_at > 180 and self.alive()):
            self._stalled_at = now
            try:
                import logstore
                logstore.warn("spotify", f"Spotify says playing but the song hasn't moved for {int(now - self._progress_at)} s "
                              "(no sound is draining). Taking an audio snapshot.")
            except Exception:
                pass
            asyncio.ensure_future(self.diagnose("stalled"))

    def _bridge_alive(self) -> bool:
        return self.bridge is not None and self.bridge.returncode is None

    async def _start_bridge(self) -> None:
        """Copy the Spotify sink to the soundbar (parec | aplay)."""
        await self._stop_bridge()
        if not self.device:
            return
        env = dict(os.environ)
        env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
        try:
            self.bridge = await asyncio.create_subprocess_shell(
                bridge_cmd(PW_NODE, self.device), env=env,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
                start_new_session=True)
            asyncio.ensure_future(self._read_bridge_errors(self.bridge))
        except OSError as e:
            self._fail(f"Couldn't start the Spotify sound bridge: {e}")

    async def _read_bridge_errors(self, proc: asyncio.subprocess.Process) -> None:
        """Copy the first lines parec/aplay complain about into the log."""
        assert proc.stderr is not None
        shown = 0
        while shown < 8:
            raw = await proc.stderr.readline()
            if not raw:
                break
            text = friendly_log(raw.decode(errors="replace"))
            if text:
                shown += 1
                try:
                    import logstore
                    logstore.warn("soloist-bridge", text)
                except Exception:
                    pass
        # keep draining so the pipe never fills
        while await proc.stderr.readline():
            pass

    async def _stop_bridge(self) -> None:
        proc, self.bridge = self.bridge, None
        if proc is None or proc.returncode is not None:
            return
        self._signal_group(proc, signal.SIGTERM)
        try:
            await asyncio.wait_for(proc.wait(), timeout=3)
        except asyncio.TimeoutError:
            self._signal_group(proc, signal.SIGKILL)
            await proc.wait()

    async def _reap_strays(self) -> None:
        """Kill any Soloist process using our data dir, so a fresh start doesn't
        collide with a leftover holding the session lock. Covers orphans that a
        plain terminate() on a detached session missed."""
        target = f"--data-dir {DATA_DIR}"
        for sig in ("-TERM", "-KILL"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "pkill", sig, "-f", "--", target,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                code = await asyncio.wait_for(proc.wait(), timeout=5)
            except (OSError, asyncio.TimeoutError) as e:
                log.debug("Couldn't reap stray Soloist: %s", e)
                return
            if code != 0:      # nothing matched (exit 1): no stray to kill
                return
            await asyncio.sleep(1.0)   # give SIGTERM a moment before SIGKILL

    async def _read_log(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode(errors="replace").rstrip()
            self.lines.append(line)
            self._track_progress(line)
            self._log_line(line)

    def _track_progress(self, line: str) -> None:
        """Read Soloist's status lines (`playing <uri> ... [2:38 / 4:53]`) to know
        whether the song position is moving."""
        m = re.search(r"\b(playing|paused|buffering)\b.*\[(\d+):(\d\d) / ", line)
        if not m:
            return
        status, pos = m.group(1), int(m.group(2)) * 60 + int(m.group(3))
        now = time.time()
        if status != self._line_status or pos != self._progress_pos:
            self._progress_at = now
        self._line_status, self._progress_pos = status, pos

    def _log_line(self, line: str) -> None:
        """Copy Soloist's own output into Sage's log (source "soloist") so it can
        be read with sage_logs. Progress ticks are dropped and the rest is
        rate-limited, so a chatty player can't flood the log."""
        text = friendly_log(line)
        if not text or re.search(r"\[\d+:\d\d / [\d?:]+\]\s*$", text) and "paused" not in text and "playing" not in text:
            return
        now = time.time()
        if now - self._log_at < 1.0 or text == self._log_last:
            return
        self._log_at, self._log_last = now, text
        try:
            import logstore
            logstore.info("soloist", text)
        except Exception:
            pass

    async def stop(self) -> None:
        proc, self.proc = self.proc, None
        self.ready = False
        self.logged_in = False
        self.is_active = False
        self.state = None
        await self._close_ws()
        await self._stop_bridge()
        if proc is None or proc.returncode is not None:
            # Even with no tracked process, a detached Soloist may linger and
            # hold the lock; clear it so the next start is clean.
            await self._reap_strays()
            return
        # Soloist runs in its own session (start_new_session), so signal the
        # whole group, not just the leader, or children keep the lock.
        self._signal_group(proc, signal.SIGTERM)
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            self._signal_group(proc, signal.SIGKILL)
            await proc.wait()
        await self._reap_strays()

    @staticmethod
    def _signal_group(proc: asyncio.subprocess.Process, sig: int) -> None:
        try:
            os.killpg(os.getpgid(proc.pid), sig)
        except (ProcessLookupError, OSError):
            try:
                proc.send_signal(sig)
            except (ProcessLookupError, OSError):
                pass

    async def restart(self) -> None:
        async with self._ops:
            await self._restart()

    async def _restart(self) -> None:
        await self.stop()
        self.next_start = 0.0
        self.fails = 0
        self.node_fails = 0
        await self.supervise()

    async def supervise(self) -> None:
        """Keep Soloist running when it's on, with a growing pause if it keeps dying."""
        settings = get_settings()
        if not settings["enabled"] or not settings["apiKey"] or not binary():
            if self.alive():
                await self.stop()
            return
        if self.alive():
            if self.running_key != settings["name"] + "|" + settings["apiKey"]:
                log.info("Spotify settings changed; restarting Soloist.")
                await self.stop()
            else:
                if self.used_node and not self._bridge_alive():
                    if time.time() - self._bridge_died_at > 60:
                        self._bridge_died_at = time.time()
                        try:
                            import logstore
                            logstore.warn("spotify", "The Spotify sound bridge (parec | aplay) stopped; restarting it.")
                        except Exception:
                            pass
                        self.probe_later(2, "bridge died")
                    await self._start_bridge()
                self.check_stall()
                return
        if self.proc is not None and self.proc.returncode is not None:
            code = self.proc.returncode
            lived = time.time() - self.started_at
            tail = [friendly_log(l) for l in list(self.lines) if l.strip()][-3:]
            last = " · ".join(tail) if tail else "exit " + str(code)
            locked = any("another" in t.lower() or "running session" in t.lower() for t in tail)
            if expired(code):
                self.build_expired = True
                self._fail("Spotify's player (Soloist) has expired and needs updating. Run on the Pi: "
                           "sudo deploy/install_pi.sh --only audio")
                self.next_start = time.time() + 3600
            elif locked:
                # A leftover held the lock; _reap_strays at the next start clears
                # it. Retry soon and don't count it as a real failure.
                self._fail("Spotify had a leftover player open; clearing it and starting again.")
                self.next_start = time.time() + 4
            else:
                # A quick crash while the soundbar sink was in use points at the
                # sink; count it so start() can fall back to the Pi's output.
                if self.used_node and lived < 30:
                    self.node_fails += 1
                elif lived >= 30:
                    self.node_fails = 0
                self.fails = self.fails + 1 if lived < 60 else 1
                wait = min(300, 5 * 2 ** (self.fails - 1))
                self._fail(f"Spotify stopped ({last}). Starting it again in {wait} s.")
                self.next_start = time.time() + wait
            self.proc = None
            self.ready = False
        if time.time() >= self.next_start:
            await self.start()

    # --- The control socket ---

    async def _close_ws(self) -> None:
        ws, self._ws = self._ws, None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass

    async def ws_loop(self) -> None:
        """Hold a WebSocket to Soloist, read its events, keep state fresh."""
        import websockets
        while True:
            if not self.alive():
                await asyncio.sleep(1.5)
                continue
            try:
                async with websockets.connect(WS, open_timeout=5, ping_interval=30) as ws:
                    self._ws = ws
                    self.ready = True
                    await self._send({"type": "command", "command": "get_auth_state"})
                    await self._send({"type": "command", "command": "get_state"})
                    await self.publish()
                    async for raw in ws:
                        try:
                            ev = json.loads(raw)
                        except ValueError:
                            continue
                        await self.on_event(ev)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.debug("Spotify control socket dropped: %s", e)
            finally:
                self._ws = None
                self.ready = False
            await asyncio.sleep(1.5)

    async def _send(self, message: dict) -> None:
        ws = self._ws
        if ws is None:
            raise RuntimeError("Spotify isn't running on the Pi yet.")
        await ws.send(json.dumps(message))

    async def on_event(self, ev: dict) -> None:
        kind = str(ev.get("type") or "")
        if kind == "auth_state":
            self.logged_in = bool(ev.get("logged_in"))
            was_active, self.is_active = self.is_active, bool(ev.get("is_active"))
            if self.logged_in:
                self.error = None
            if self.is_active and not was_active:
                asyncio.ensure_future(self.on_active())
        elif kind == "playback_state":
            if ev.get("status") == "playing" and (self.state or {}).get("status") != "playing":
                self.probe_later(6, "playing", min_gap=60)
            self.state = ev
            self.is_active = bool(ev.get("is_active", self.is_active))
        elif kind == "track_changed":
            if self.state is not None:
                self.state["item"] = ev.get("item")
        elif kind == "playback_changed":
            if ev.get("status") == "playing" and (self.state or {}).get("status") != "playing":
                self.probe_later(6, "playing", min_gap=30)
            if self.state is not None:
                self.state["status"] = ev.get("status")
        elif kind == "volume_changed":
            if self.state is not None:
                self.state["volume"] = ev.get("volume")
        elif kind == "position_sync":
            if self.state is not None:
                self.state["position"] = ev.get("position")
        elif kind == "options_changed":
            if self.state is not None:
                self.state["options"] = ev.get("options")
        elif kind == "context_changed":
            if self.state is not None:
                self.state["context"] = ev.get("context")
        elif kind == "device_changed":
            self.is_active = bool(ev.get("is_active", self.is_active))
        elif kind == "error":
            msg = str(ev.get("message") or "")
            if "auth" not in msg.lower():   # "requires authentication" just means not picked yet
                self._fail(f"Spotify: {msg[:160]}")
        await self.publish()

    async def on_active(self) -> None:
        """We became the active Spotify device: make sure the soundbar is on it."""
        if self._connecting or self.speaker is None:
            return
        want = self.want_device()
        if not want:
            return
        self._connecting = True
        try:
            await self.speaker.make_room()   # stop any phone pass-through
            await self.speaker.ensure_connected()
            if want != self.device:
                await self.rewire(want)
        finally:
            self._connecting = False

    # --- Controls ---

    async def control(self, action: str) -> None:
        if action == "playpause":
            p = now_playing(self.state)
            cmd = "pause" if (p and p["playing"]) else "play"
        else:
            cmd = {"pause": "pause", "resume": "play", "next": "skip_next", "prev": "skip_prev"}.get(action)
        if not cmd:
            raise ValueError("Unknown control.")
        await self._send({"type": "command", "command": cmd})

    async def set_volume(self, percent: int) -> None:
        await self._send({"type": "command", "command": "set_volume", "volume": max(0, min(100, int(percent)))})

    async def shuffle(self, on: bool) -> None:
        await self._send({"type": "command", "command": "set_shuffle", "enabled": bool(on)})

    async def sign_out(self) -> None:
        """Clear Soloist's stored sign-in with its --pair reset, then restart."""
        await self.stop()
        exe = binary()
        settings = get_settings()
        if exe and settings["apiKey"]:
            try:
                proc = await asyncio.create_subprocess_exec(
                    exe, "--device-name", settings["name"], "--api-key", settings["apiKey"],
                    "--data-dir", str(DATA_DIR), "--pair", env=audio_env(),
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                await asyncio.wait_for(proc.wait(), timeout=15)
            except (OSError, asyncio.TimeoutError) as e:
                log.info("Soloist sign-out reset failed: %s", e)
        await self.restart()
        await self.publish(force=True)

    def playing(self) -> bool:
        p = now_playing(self.state)
        return bool(self.ready and p and p["playing"])

    async def hold(self) -> bool:
        """Pause for Sage's voice. True when it was playing (so release() resumes)."""
        if not self.playing():
            return False
        try:
            await self._send({"type": "command", "command": "pause"})
            self.held = True
            await asyncio.sleep(0.4)
            return True
        except Exception as e:
            log.info("Couldn't pause Spotify to speak: %s", e)
            return False

    async def release(self) -> None:
        if not self.held:
            return
        self.held = False
        try:
            await self._send({"type": "command", "command": "play"})
        except Exception as e:
            log.info("Couldn't resume Spotify after speaking: %s", e)

    async def pause_quietly(self) -> None:
        if self.playing():
            try:
                await self._send({"type": "command", "command": "pause"})
            except Exception:
                pass

    async def rewire(self, want: str) -> None:
        """Point the music at a new soundbar device (surround changed, another
        soundbar). Soloist plays into the fixed sage-spotify sink either way, so
        only the parec | aplay bridge moves; Soloist keeps playing. (Restarting
        Soloist here used to stop the music and race the supervisor.)"""
        if self.used_node and want:
            self.device = want
            await self._start_bridge()
        else:
            await self.restart()   # switching between soundbar and Pi output

    async def follow_output(self) -> None:
        """Surround switched or another soundbar picked: move the bridge."""
        want = self.want_device()
        if self.alive() and want != self.device:
            await self.rewire(want)

    # --- Running ---

    async def run(self, broadcast: Emit, speaker: Any) -> None:
        self.emit = broadcast
        self.speaker = speaker
        speaker.music = self
        if not binary():
            log.info("Soloist isn't installed; Spotify is off (run: sudo deploy/install_pi.sh --only audio).")
        asyncio.ensure_future(self.ws_loop())
        asyncio.ensure_future(self.probe_loop())
        while True:
            try:
                if not self._ops.locked():   # a restart is mid-way: don't start a second Soloist
                    await self.supervise()
                await asyncio.wait_for(self.publish(), timeout=10)
            except Exception as e:
                log.debug("Spotify check failed: %s", e)
            await asyncio.sleep(CHECK_EVERY)


connect = SpotifyConnect()
