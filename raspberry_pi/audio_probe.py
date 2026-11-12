"""
audio_probe.py - one full snapshot of the Spotify-on-the-soundbar audio chain,
written to Sage's log (source "audio-probe") so a person or Claude can read it
with sage_logs instead of asking for one command at a time.

It covers every hop: Soloist (state + last output), the PipeWire sink and its
services, the parec | aplay bridge, bluez-alsa and its PCMs, the soundbar's
Bluetooth link, the ALSA devices, running processes, recent system logs and
power/load. Two live checks help most: a one-second silence write to the
soundbar's ALSA device (does it open?) and a one-second read from the Spotify
sink's monitor (does the sink deliver audio?).

Everything is read-only apart from that silent second. Each command has a short
timeout, so a stuck tool can't hang Sage.
"""

import asyncio
import os
import re
import shlex
import shutil
import time
from pathlib import Path
from typing import Any, List, Optional, Tuple

_lock = asyncio.Lock()
MAX_LINE = 1800
Section = Tuple[str, str]


def _env() -> dict:
    env = dict(os.environ)
    runtime = f"/run/user/{os.getuid()}"
    env.setdefault("XDG_RUNTIME_DIR", runtime)
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path={runtime}/bus")
    return env


async def sh(cmd: str, timeout: float = 6.0) -> str:
    """Run a shell pipeline, return stdout+stderr trimmed (never raises)."""
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd, env=_env(), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            start_new_session=True)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                os.killpg(os.getpgid(proc.pid), 9)
            except (ProcessLookupError, OSError):
                pass
            return "(timed out after %ds)" % timeout
        text = out.decode(errors="replace").strip()
        return text if text else f"(no output, exit {proc.returncode})"
    except Exception as e:  # noqa: BLE001 - a probe must never break Sage
        return f"(could not run: {e})"


def tidy(text: str, limit: int = MAX_LINE) -> str:
    """Collapse blank space so a section reads on few lines. Pure."""
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in (text or "").splitlines()]
    out = " | ".join(l for l in lines if l)
    return out if len(out) <= limit else out[:limit - 12] + " …(cut)"


def grep_lines(text: str, pattern: str, limit: int = 12) -> str:
    """Only the lines matching `pattern`. Pure."""
    rx = re.compile(pattern, re.I)
    hits = [l for l in (text or "").splitlines() if rx.search(l)]
    return "\n".join(hits[:limit]) if hits else "(none)"


def soloist_summary(connect: Any) -> str:
    """Soloist's own state as Sage sees it. Pure-ish (reads attributes)."""
    st = connect.state or {}
    pos = (st.get("position") or {}).get("position_ms")
    item = (st.get("item") or {}).get("uri", "")
    bridge = getattr(connect, "bridge", None)
    return (f"running={connect.alive()} wsReady={connect.ready} loggedIn={connect.logged_in} "
            f"active={connect.is_active} status={st.get('status')} volume={st.get('volume')} "
            f"position_ms={pos} item={item} usedSoundbarSink={getattr(connect, 'used_node', None)} "
            f"sinkDevice={getattr(connect, 'device', '')!r} nodeFails={getattr(connect, 'node_fails', None)} "
            f"bridgeAlive={bridge is not None and bridge.returncode is None} "
            f"bridgeExit={None if bridge is None else bridge.returncode} "
            f"fails={getattr(connect, 'fails', None)} error={(connect.error or {}).get('message', '')[:200]!r}")


async def collect(connect: Any, deep: bool = True) -> List[Section]:
    """Every section of the snapshot, in the order a person would check them."""
    import spotify as sp   # late: spotify imports this module lazily too

    sections: List[Section] = []
    add = lambda title, text: sections.append((title, tidy(text)))   # noqa: E731

    settings = {}
    address = ""
    try:
        import speaker as speaker_mod
        settings = speaker_mod.get_settings()
        address = settings.get("address", "")
    except Exception as e:  # noqa: BLE001
        add("speaker settings", f"unreadable: {e}")

    add("soloist (as Sage sees it)", soloist_summary(connect))
    add("soloist last output", "\n".join(list(connect.lines)[-6:]) or "(nothing yet)")
    links = (getattr(connect.speaker, "links", None) or {}) if connect.speaker else {}
    add("soundbar link (Sage)", f"address={address or '(none picked)'} surround={settings.get('surround')} "
        f"phoneSpeaker={settings.get('phoneSpeaker')} links={links}")
    add("want_device", repr(connect.want_device()))

    # Soundbar over Bluetooth
    if address and shutil.which("bluetoothctl"):
        info = await sh(f"bluetoothctl info {shlex.quote(address)}")
        add("soundbar bluetooth", grep_lines(info, r"Name|Alias|Paired|Bonded|Trusted|Connected|UUID.*(110b|110d|Audio)|RSSI|Modalias", 16))
    if shutil.which("bluetoothctl"):
        add("bluetooth adapter", grep_lines(await sh("bluetoothctl show"), r"Powered|Discoverable|Pairable|Discovering|Name"))
    add("bluez + bluealsa services", await sh("systemctl is-active bluetooth; systemctl list-units --no-legend --all 'bluealsa*' 2>&1 | head -5"))

    # bluez-alsa PCMs and ALSA devices
    for tool in ("bluealsactl", "bluealsa-cli"):
        if shutil.which(tool):
            add(f"{tool} list-pcms", await sh(f"{tool} list-pcms"))
            break
    else:
        add("bluealsa control tool", "bluealsactl / bluealsa-cli not found")
    aplay_l = await sh("aplay -L")
    add("alsa devices (bluealsa / surround)", grep_lines(aplay_l, r"bluealsa|sage_surround", 8))
    add("alsa cards", await sh("aplay -l"))

    # PipeWire side
    add("pipewire services", await sh("systemctl --user is-active pipewire pipewire-pulse wireplumber; loginctl show-user $(id -un) -p Linger"))
    add("pactl info", grep_lines(await sh("pactl info"), r"Server (Name|String)|Default Sink|Default Source|Server Version", 6))
    add("pactl sinks (state)", await sh("pactl list short sinks"))
    add("pactl sink-inputs (who plays)", await sh("pactl list short sink-inputs"))
    add("pactl sources", await sh("pactl list short sources"))
    add("spotify sink detail", grep_lines(await sh(f"pactl list sinks"), rf"Name: {re.escape(sp.PW_NODE)}|State:|Mute:|Volume:|Monitor Source|Sample Specification", 14))
    if shutil.which("wpctl"):
        add("wpctl status", await sh("wpctl status", 8))
    add("sink config on disk", (sp.PW_CONF.read_text() if sp.PW_CONF.exists() else "(no config file)"))

    # Processes
    add("audio processes", grep_lines(
        await sh("ps -eo pid,etimes,stat,pcpu,pmem,args"), r"soloist|parec|aplay|bluealsa|pipewire|wireplumber|pulse", 14))
    add("soloist data dir", await sh(f"ls -la {shlex.quote(str(sp.DATA_DIR))} | head -12"))

    # Live checks
    if deep:
        device = connect.device or connect.want_device()
        if device:
            add(f"LIVE: 1 s of silence to {device}",
                await sh(f"aplay -q -D {shlex.quote(device)} -t raw -f S16_LE -r 44100 -c 2 -d 1 /dev/zero; echo exit=$?", 10))
        if connect.alive() and connect.used_node:
            add("LIVE: bytes the Spotify sink delivers in 1.5 s (0 = nothing reaches the bridge)",
                await sh(f"timeout 1.5 parec -d {shlex.quote(sp.PW_NODE + '.monitor')} --format=s16le --rate=44100 --channels=2 | wc -c", 5))

    # System logs
    add("journal: pipewire/wireplumber (user)", await sh("journalctl --user -u pipewire -u pipewire-pulse -u wireplumber -n 12 --no-pager -o cat", 8))
    add("journal: bluetooth/bluealsa", await sh("journalctl -u bluetooth -u 'bluealsa*' -n 14 --no-pager -o cat", 8))
    add("kernel: bluetooth/audio/usb errors", grep_lines(await sh("dmesg 2>&1 | tail -150"), r"bluetooth|hci|snd|usb.*(error|reset)|under-?voltage|oom", 8))

    # Power and load
    add("load / memory", f"{Path('/proc/loadavg').read_text().strip() if Path('/proc/loadavg').exists() else ''} | "
        + tidy(await sh("free -m | head -2")))
    if shutil.which("vcgencmd"):
        add("power (vcgencmd get_throttled)", await sh("vcgencmd get_throttled"))
    return sections


async def record(connect: Any, reason: str, deep: bool = True) -> int:
    """Collect a snapshot and write it to the log. Returns how many lines."""
    import logstore
    if _lock.locked():       # one at a time; a probe already running covers it
        return 0
    async with _lock:
        started = time.time()
        try:
            sections = await collect(connect, deep)
        except Exception as e:  # noqa: BLE001
            logstore.warn("audio-probe", f"[{reason}] probe failed: {e}")
            return 0
        logstore.info("audio-probe", f"[{reason}] ---- audio snapshot begins ({len(sections)} sections, took {time.time() - started:.1f}s)")
        for title, text in sections:
            logstore.info("audio-probe", f"[{reason}] {title}: {text}"[:2000])
        logstore.info("audio-probe", f"[{reason}] ---- audio snapshot ends")
        return len(sections)
