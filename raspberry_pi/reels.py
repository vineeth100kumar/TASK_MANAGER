"""
Reels: paste or upload a script (and, if you like, your own voice-over), the Pi makes the
Instagram reel, and an email says when it is done.

The reel maker is the Auto Content engine (content_engine/, the same one Posts uses), run as a
separate process (python -m autocontent reel), so its Chromium and ffmpeg never live inside the
Sage server. A reel is the post script plus the words to say (see content_engine/REEL_FORMAT.md):
the slides are drawn like a post's, cut into pieces that appear one after another in time with
the voice, captioned word by word, and encoded as one 1080x1920 H.264/AAC mp4. The voice is
either your own recording or Kokoro, a free voice that runs on the Pi. No AI, no cloud, no cost.

  POST /api/reels/check          check a script, with line numbers, no making
  POST /api/reels                save a script and queue the making (or wait for your recording)
  PUT  /api/reels/{id}/voice     your own recording (raw body, ?name=voice.m4a); queues the reel
  GET  /api/reels                recent reels + whether the reel maker is ready
  GET  /api/reels/{id}           one reel: progress log, caption, timeline
  POST /api/reels/{id}/remake, /posted, /send ; DELETE /api/reels/{id}
  GET  /media/reels/{id}/{video|poster}/{name}   the finished files, straight off disk
       (cached, resumable and seekable: Range requests), ?download=<name> saves instead of showing.

Reels live in a Pi-only table; the files live in sage_reels/<id>/ next to the database (so they are
in the nightly backup and never sync to other devices). A reel can belong to a project that has Use
Auto Content switched on: it then appears there as a normal task that moves Script > Ready > Posted.
It shares Posts' one-at-a-time lock: the Pi draws a post or a reel, not both at once.
"""

import asyncio
import datetime
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

import item_shape
import logstore
import lowprio
import notifier
import posts

DB_PATH = "sage_sync.db"
ENGINE_DIR = posts.ENGINE_DIR
REELS_DIR = notifier.DATA_DIR / "sage_reels"
STYLES = posts.STYLES
MAX_SCRIPT = 60_000          # characters
MAX_QUEUE = 4                # reels waiting or being made at once
# A quiet minute between videos: when one render finishes, the next queued reel waits this long
# before it starts, so the Pi settles (and its CPU, memory and disk recover) between videos.
COOLDOWN_SECONDS = int(os.environ.get("SAGE_REELS_COOLDOWN", "60"))
RENDER_TIMEOUT = 2400        # seconds; a Pi 5 needs a few minutes for a minute of video
KEEP = 30                    # reels kept (a finished one is 10 to 60 MB)
LOG_LINES = 120
MAX_VOICE_MB = 150           # an uploaded recording
VOICE_EXTENSIONS = {"m4a", "mp3", "wav", "aac", "ogg", "oga", "opus", "flac", "caf", "amr", "3gp", "mp4", "mov", "webm", "mkv"}
ENGINE_NICE = int(os.environ.get("SAGE_REELS_NICE", "15"))
MEMORY_CHECK_SECONDS = 2.0

_ids = re.compile(r"[0-9a-f]{12}")
_tasks: set = set()
_last_finished: float = 0.0   # time.monotonic() when the last reel render ended (for the cooldown)

PROGRESS = posts.PROGRESS
# progress lines the engine prints, and how far through the work each one is
STEPS = (
    (re.compile(r"Speaking slide (\d+) of (\d+)"), lambda a, b: 2 + 13 * a / b, "Speaking the narration"),
    (re.compile(r"Finding when each word"), lambda: 16, "Finding when each word is spoken"),
    (re.compile(r"Cutting slide (\d+) of (\d+)"), lambda a, b: 20 + 35 * a / b, "Cutting the slides into pieces"),
    (re.compile(r"Drawing the captions"), lambda: 58, "Drawing the captions"),
    (re.compile(r"encoding (\d+)%"), lambda a: 60 + 0.4 * a, "Encoding the video"),
    (re.compile(r"Encoding the video"), lambda: 60, "Encoding the video"),
)


def _lower_priority() -> None:
    lowprio.lower(ENGINE_NICE)


def _max_mb() -> int:
    try:
        return max(0, int(float(os.environ.get("SAGE_REELS_MAX_MB", "2600"))))
    except ValueError:
        return 2600


def _utc() -> str:
    return posts._utc()


# --- Storage ---

def connect(db_path: str) -> None:
    global DB_PATH
    DB_PATH = db_path
    REELS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS reels (id TEXT PRIMARY KEY, created_at TEXT, status TEXT, payload TEXT)")
    # A reel that was being made when the server stopped will never finish now.
    for reel_id, payload in conn.execute("SELECT id, payload FROM reels").fetchall():
        reel = json.loads(payload)
        if reel.get("status") in ("queued", "running"):
            reel.update(status="failed", error="Sage restarted while this was being made. Press Make again.")
            conn.execute("UPDATE reels SET status = ?, payload = ? WHERE id = ?", (reel["status"], json.dumps(reel), reel_id))
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def save(reel: dict) -> None:
    _write((reel["id"], reel["createdAt"], reel["status"], json.dumps(reel)))


async def save_async(reel: dict) -> None:
    """save() for code on the event loop: the JSON is made here, so nothing changes it mid-write,
    and the write itself runs on a thread so a busy database can't freeze other requests."""
    await asyncio.to_thread(_write, (reel["id"], reel["createdAt"], reel["status"], json.dumps(reel)))


def _write(row: tuple) -> None:
    conn = _db()
    try:
        conn.execute("INSERT OR REPLACE INTO reels (id, created_at, status, payload) VALUES (?, ?, ?, ?)", row)
        old = conn.execute("SELECT id FROM reels WHERE id NOT IN (SELECT id FROM reels ORDER BY created_at DESC LIMIT ?)", (KEEP,)).fetchall()
        for r in old:
            shutil.rmtree(REELS_DIR / r["id"], ignore_errors=True)
        conn.execute("DELETE FROM reels WHERE id NOT IN (SELECT id FROM reels ORDER BY created_at DESC LIMIT ?)", (KEEP,))
        conn.commit()
    finally:
        conn.close()


def get(reel_id: str) -> Optional[dict]:
    if not _ids.fullmatch(reel_id or ""):
        return None
    conn = _db()
    try:
        row = conn.execute("SELECT payload FROM reels WHERE id = ?", (reel_id,)).fetchone()
    finally:
        conn.close()
    return json.loads(row["payload"]) if row else None


def recent(project_id: str = "", limit: int = 60, archived: bool = False) -> List[dict]:
    conn = _db()
    try:
        rows = conn.execute("SELECT payload FROM reels ORDER BY created_at DESC").fetchall()
    finally:
        conn.close()
    out = []
    for row in rows:
        reel = json.loads(row["payload"])
        if project_id and reel.get("projectId") != project_id:
            continue
        # Rejected reels are kept in the archive (their script stays, the video is gone); the main
        # list shows live reels only, and ?archived=true shows the archive instead.
        if bool(reel.get("archived")) != bool(archived):
            continue
        out.append(summary(reel))
        if limit and len(out) >= limit:
            break
    _mark_queue_positions(out)
    return out


def queue_position(reel_id: str) -> int:
    """This reel's place in the make line: 1 is being made (or next), 2 is behind it, and so on.
    0 means it isn't waiting."""
    conn = _db()
    try:
        rows = conn.execute("SELECT id FROM reels WHERE status IN ('queued', 'running') ORDER BY created_at ASC").fetchall()
    finally:
        conn.close()
    ids = [r["id"] for r in rows]
    return ids.index(reel_id) + 1 if reel_id in ids else 0


def _mark_queue_positions(rows: List[dict]) -> None:
    """Number the waiting reels in a list by when they were made, cheaply (no per-row query)."""
    waiting = sorted((r for r in rows if r.get("status") in ("queued", "running")),
                     key=lambda r: r.get("createdAt") or "")
    for i, r in enumerate(waiting, start=1):
        r["queuePosition"] = i


_ROW_DROP = ("script", "log", "caption", "timeline", "warnings")


def summary(reel: dict) -> dict:
    """The list row: light metadata only. The script, log and timeline come with the open view."""
    keep = {k: v for k, v in reel.items() if k not in _ROW_DROP}
    keep["captionStart"] = (reel.get("caption") or "")[:140]
    keep["media"] = media_info(reel)
    keep.setdefault("review", "pending")
    keep.setdefault("archived", False)
    keep["queuePosition"] = 0
    return keep


def queue_length() -> int:
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM reels WHERE status IN ('queued', 'running')").fetchone()[0]
    finally:
        conn.close()


async def _announce(reel: dict) -> None:
    if posts._broadcast:
        try:
            await posts._broadcast({"type": "REEL_PROGRESS", "id": reel["id"], "status": reel["status"],
                                    "percent": reel.get("progress", {}).get("percent", 0)})
        except Exception:
            pass


# --- Is the reel maker ready? ---

def status() -> dict:
    """What the New reel screen needs to know before it offers Make."""
    base = posts.status()
    problems = [p for p in base["problems"] if "slide" in p.lower() or "Python module" in p or "Chromium" in p]
    if not (ENGINE_DIR / "src" / "autocontent" / "reel").is_dir():
        problems.append("The reel engine (content_engine/.../reel) is missing from this install.")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        problems.append("ffmpeg isn't installed (sudo apt install ffmpeg, or re-run deploy/install_pi.sh).")
    voice_problem = _voice_problem()
    prefs = notifier.get_prefs()
    link = notifier._app_link()
    return {
        "ready": not problems,
        "problems": problems,
        "styles": list(STYLES),
        "voiceReady": not voice_problem,
        "voiceProblem": voice_problem,
        "voices": _voices(),
        "timing": _timing_backend(),
        "emailReady": notifier.email_ready(prefs),
        "emailOn": bool(prefs["email"].get("postReady", True)),
        "emailTo": prefs["email"].get("to") or "",
        "link": link,
        "secureLink": link.startswith("https://"),
        "queued": queue_length(),
        "maxScript": MAX_SCRIPT,
        "maxVoiceMb": MAX_VOICE_MB,
        "engine": {"nice": ENGINE_NICE, "maxMemoryMb": _max_mb()},
    }


def _engine_on_path() -> None:
    posts._engine_on_path()


def _voice_problem() -> str:
    """Why Kokoro can't speak here (own recordings still work), or ''. Cheap: nothing is loaded."""
    import importlib.util
    if importlib.util.find_spec("kokoro_onnx") is None:
        return "The Kokoro voice package isn't installed (re-run deploy/install_pi.sh). Your own recording still works."
    d = Path(os.environ.get("REEL_MODEL_DIR", "") or (Path.home() / ".cache" / "sage-reels"))
    missing = [n for n in ("kokoro-v1.0.onnx", "voices-v1.0.bin") if not (d / n).is_file()]
    if missing:
        return f"The voice files ({', '.join(missing)}) aren't in {d} (re-run deploy/install_pi.sh). Your own recording still works."
    return ""


def _timing_backend() -> str:
    import importlib.util
    if importlib.util.find_spec("faster_whisper") is not None:
        return "whisper"
    return "spread"


def _voices() -> List[str]:
    _engine_on_path()
    try:
        from autocontent.reel.voice import VOICES
        return list(VOICES)
    except Exception:
        return []


# --- Checking a script ---

def check(script: str) -> dict:
    """Parse the script the way the engine will: every error and warning with its line and slide,
    the scenes with their narration, the length it will run and the voice it asks for."""
    _engine_on_path()
    from autocontent.reel import parse_reel
    from autocontent.reel.voice import check_voice
    reel = parse_reel(script, base_dir=ENGINE_DIR)
    issues = [{"severity": i.severity, "code": i.code, "message": i.message, "line": i.line,
               "slide": i.slide, "hint": i.hint or ""} for i in reel.issues]
    meta = reel.meta
    own = reel.uses_own_voice
    voice_name = str(meta.get("voice") or "")
    voice_problem = check_voice(voice_name) if voice_name and not own else ""
    if voice_problem:
        issues.append({"severity": "ERROR", "code": "VOICE_UNKNOWN", "message": voice_problem, "line": None,
                       "slide": None, "hint": ""})
    scenes = []
    for sc in reel.scenes:
        s = sc.slide
        scenes.append({
            "n": sc.n, "type": s.get("type"), "motion": sc.motion, "words": len(sc.words),
            "title": str(s.get("headline") or s.get("number") or s.get("quote") or s.get("body") or "")[:90],
            "say": sc.say[:600],
        })
    errors = sum(1 for i in issues if i["severity"] == "ERROR")
    return {
        "ok": errors == 0 and bool(reel.scenes),
        "errors": errors,
        "warnings": sum(1 for i in issues if i["severity"] != "ERROR"),
        "issues": issues,
        "scenes": scenes,
        "seconds": reel.estimate_seconds() if reel.scenes else 0,
        "caption": reel.caption or "",
        "hashtags": list(reel.hashtags or []),
        "title": str(meta.get("title") or (scenes[0]["title"] if scenes else "")).strip(),
        "style": str(meta.get("style") or ""),
        "voice": "mine" if own else voice_name,
        "needsRecording": own,
        "captions": meta.get("captions", "on") != "off",
    }


# --- Making a reel ---

class Busy(Exception):
    pass


def _clean_script(script: str) -> str:
    return posts._clean_script(script)


def _first_error(report: dict) -> str:
    first = next((i for i in report["issues"] if i["severity"] == "ERROR"), None)
    where = f" (line {first['line']})" if first and first.get("line") else ""
    return f"The script has {report['errors']} error(s); fix them first. {first['message'] if first else ''}{where}".strip()


def start(script: str, title: str = "", style: str = "", project_id: str = "") -> dict:
    script = _clean_script(script)
    if not script.strip():
        raise ValueError("Paste a script first.")
    if len(script) > MAX_SCRIPT:
        raise ValueError(f"That script is {len(script):,} characters; the limit is {MAX_SCRIPT:,}.")
    if style and style not in STYLES:
        raise ValueError(f"Style must be one of {', '.join(STYLES)}.")
    report = check(script)
    if not report["ok"]:
        raise ValueError(_first_error(report))
    if queue_length() >= MAX_QUEUE:
        raise Busy(f"{MAX_QUEUE} reels are already waiting. Try again in a few minutes.")
    reel = {
        "id": uuid.uuid4().hex[:12],
        "createdAt": _utc(),
        "title": (title or report["title"] or "Untitled reel").strip()[:120],
        "script": script,
        "style": style or report["style"] or "grid_pill",
        "voice": report["voice"],
        "needsRecording": report["needsRecording"],
        "voiceFile": "",
        "projectId": project_id or None,
        "taskId": None,
        "status": "waiting" if report["needsRecording"] else "queued",
        "review": "pending",   # pending | approved | rejected
        "archived": False,     # a rejected reel is archived: the script is kept, the video removed
        "archivedAt": None,
        "error": "",
        "log": [],
        "progress": {"percent": 0, "stage": ""},
        "seconds": None,        # how long the video runs
        "madeIn": None,         # how long the Pi took
        "size": 0,
        "scenes": len(report["scenes"]),
        "estimate": report["seconds"],
        "timeline": [],
        "warnings": [],
        "wordTiming": "",
        "caption": report["caption"],
        "hashtags": report["hashtags"],
        "finishedAt": None,
        "posted": False,
        "postedAt": None,
        "emailed": False,
        "emailError": "",
    }
    # The built-in voice can't speak here: say so now, rather than after a minute of drawing.
    voice_problem = _voice_problem() if reel["status"] == "queued" else ""
    if voice_problem:
        reel.update(status="failed", error=voice_problem, finishedAt=_utc())
    save(reel)
    if reel["status"] == "queued":
        _spawn(_run(reel))
    return reel


def restart(reel: dict, script: str = "", style: str = "") -> dict:
    """Make the same reel again, optionally with an edited script (a kept recording is used again)."""
    if reel["status"] in ("queued", "running"):
        raise ValueError("This reel is still being made.")
    if script:
        script = _clean_script(script)
        if len(script) > MAX_SCRIPT:
            raise ValueError(f"That script is {len(script):,} characters; the limit is {MAX_SCRIPT:,}.")
        report = check(script)
        if not report["ok"]:
            raise ValueError(_first_error(report))
        # an edited script brings its own title: a reel must not keep the name of the one it replaced
        if report.get("title"):
            reel["title"] = str(report["title"]).strip()[:120]
        reel.update(script=script, caption=report["caption"], hashtags=report["hashtags"], voice=report["voice"],
                    needsRecording=report["needsRecording"], scenes=len(report["scenes"]), estimate=report["seconds"])
    if style in STYLES:
        reel["style"] = style
    if reel["needsRecording"] and not _voice_path(reel):
        reel["status"] = "waiting"
        save(reel)
        return reel
    if queue_length() >= MAX_QUEUE:
        raise Busy(f"{MAX_QUEUE} reels are already waiting. Try again in a few minutes.")
    reel.update(status="queued", error="", log=[], seconds=None, madeIn=None, size=0, timeline=[], warnings=[],
                finishedAt=None, emailed=False, emailError="", posted=False, postedAt=None,
                progress={"percent": 0, "stage": ""})
    voice_problem = "" if reel["needsRecording"] else _voice_problem()
    if voice_problem:
        reel.update(status="failed", error=voice_problem, finishedAt=_utc())
        save(reel)
        return reel
    save(reel)
    _spawn(_run(reel))
    return reel


def _voice_path(reel: dict) -> Optional[Path]:
    name = reel.get("voiceFile")
    path = REELS_DIR / reel["id"] / name if name else None
    return path if path and path.is_file() else None


class VoiceError(Exception):
    pass


async def attach_voice(reel: dict, name: str, length: int, stream) -> dict:
    """Save an uploaded recording beside the reel and queue it. `stream` yields the body's bytes."""
    if reel["status"] in ("queued", "running"):
        raise VoiceError("This reel is being made right now; wait for it to finish.")
    ext = (name.rsplit(".", 1)[-1] if "." in name else "").lower()
    if ext not in VOICE_EXTENSIONS:
        raise VoiceError(f"I can't use a .{ext or '?'} file. Send an audio or video recording ({', '.join(sorted(VOICE_EXTENSIONS))}).")
    if length <= 0:
        raise VoiceError("The recording is empty.")
    if length > MAX_VOICE_MB * 1024 * 1024:
        raise VoiceError(f"That recording is {length / 1048576:.0f} MB; the limit is {MAX_VOICE_MB} MB.")
    folder = REELS_DIR / reel["id"]
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / f"voice_upload.{ext}.part"
    got = 0
    try:
        with open(tmp, "wb") as fh:
            async for chunk in stream:
                got += len(chunk)
                if got > MAX_VOICE_MB * 1024 * 1024:
                    raise VoiceError(f"That recording is over {MAX_VOICE_MB} MB.")
                await asyncio.to_thread(fh.write, chunk)
        seconds = await asyncio.to_thread(_probe_seconds, tmp)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    if not seconds or seconds < 1:
        tmp.unlink(missing_ok=True)
        raise VoiceError("That file has no sound I can read. Record again, or send a different file.")
    if seconds > 600:
        tmp.unlink(missing_ok=True)
        raise VoiceError("That recording is over ten minutes; a reel should be much shorter.")
    for old in folder.glob("voice_upload.*"):
        if old != tmp:
            old.unlink(missing_ok=True)
    final = folder / f"voice_upload.{ext}"
    tmp.replace(final)
    reel["voiceFile"] = final.name
    reel["voiceSeconds"] = round(seconds, 1)
    if queue_length() >= MAX_QUEUE:
        await save_async(reel)
        raise Busy(f"{MAX_QUEUE} reels are already waiting. The recording is saved; press Make in a few minutes.")
    reel.update(status="queued", error="", log=[], progress={"percent": 0, "stage": ""})
    await save_async(reel)
    _spawn(_run(reel))
    return reel


def _probe_seconds(path: Path) -> float:
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "format=duration",
                              "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True, timeout=60)
        return float(out.stdout.strip() or 0)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 0.0


def _spawn(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _note(reel: dict, text: str) -> None:
    reel["log"].append({"at": _utc(), "text": text[:300]})
    del reel["log"][:-LOG_LINES]


async def _cooldown(reel: dict) -> None:
    """Wait out the quiet minute after the previous video before this one starts. The reel stays
    'queued' meanwhile, with the stage saying how long is left, so the page shows it resting."""
    if _last_finished <= 0 or COOLDOWN_SECONDS <= 0:
        return
    remaining = COOLDOWN_SECONDS - (time.monotonic() - _last_finished)
    while remaining > 0:
        reel["progress"] = {"percent": 0, "stage": f"A short rest between videos — starting in {round(remaining)}s"}
        await save_async(reel)
        await _announce(reel)
        await asyncio.sleep(min(remaining, 5.0))
        remaining = COOLDOWN_SECONDS - (time.monotonic() - _last_finished)


async def _run(reel: dict) -> None:
    global _last_finished
    async with posts._lock:  # one post or reel at a time on the Pi
        await _cooldown(reel)
        folder = REELS_DIR / reel["id"]
        out = folder / "out"
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True, exist_ok=True)
        script_file = folder / "script.md"
        script_file.write_text(reel["script"], encoding="utf-8")
        reel["status"] = "running"
        _note(reel, "Started")
        await save_async(reel)
        await _announce(reel)
        await _ensure_task(reel)
        code = None
        try:
            code = await _draw(reel, folder, script_file)
        except asyncio.TimeoutError:
            reel["status"], reel["error"] = "failed", f"Making it took longer than {RENDER_TIMEOUT // 60} minutes and was stopped."
        except Exception as e:
            reel["status"], reel["error"] = "failed", str(e)[:300] or e.__class__.__name__
        _last_finished = time.monotonic()  # the cooldown for the next video runs from here
        _finish(reel, folder, code)
        reel["finishedAt"] = _utc()
        await save_async(reel)
        await _announce(reel)
        if reel["status"] == "done":
            await _after_done(reel)
        else:
            logstore.warn("reels", f"Reel {reel['id']} failed: {reel['error']}")


def _engine_env() -> Dict[str, str]:
    env = posts._engine_env()
    env.setdefault("REEL_WHISPER_MODEL", "base.en")
    return env


async def _draw(reel: dict, folder: Path, script_file: Path) -> int:
    argv = [sys.executable, "-m", "autocontent", "reel", str(script_file), "-o", str(folder / "out"),
            "--style", reel["style"], "--preset", os.environ.get("REEL_PRESET", "veryfast")]
    voice_file = _voice_path(reel) if reel.get("needsRecording") else None
    if voice_file:
        argv += ["--voice-file", str(voice_file)]
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=str(ENGINE_DIR), env=_engine_env(),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        preexec_fn=_lower_priority if os.name == "posix" else None,
        start_new_session=True,
    )
    errors: List[str] = []
    last_save = [0.0]

    async def read() -> None:
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                return
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            m = PROGRESS.match(line)
            text = m.group(3) if m else line
            if not m and not re.search(r"error|fail|warn|problem|not found|Traceback|don't fit|isn't ready", line, re.I):
                continue
            errors.append(text)
            del errors[:-12]
            moved = False
            for pattern, percent, stage in STEPS:
                hit = pattern.search(text)
                if hit:
                    value = percent(*[float(g) for g in hit.groups()])
                    if value >= reel["progress"].get("percent", 0):
                        reel["progress"] = {"percent": round(value), "stage": stage}
                        moved = True
                    break
            if not text.strip().startswith("encoding"):
                _note(reel, text)
            now = time.monotonic()
            if moved or now - last_save[0] >= 1.0:
                if now - last_save[0] >= 0.8:
                    last_save[0] = now
                    await save_async(reel)
                    await _announce(reel)

    limit_mb = _max_mb()
    peak, over = [0.0], [0.0]

    async def watch() -> None:
        while proc.returncode is None:
            await asyncio.sleep(MEMORY_CHECK_SECONDS)
            used = await asyncio.to_thread(lowprio.group_rss_mb, proc.pid)
            if used is None:
                return
            peak[0] = max(peak[0], used)
            if limit_mb and used > limit_mb:
                over[0] = used
                lowprio.kill_group(proc.pid)
                return

    started = datetime.datetime.now()
    watcher = asyncio.create_task(watch())
    try:
        await asyncio.wait_for(asyncio.gather(read(), proc.wait()), timeout=RENDER_TIMEOUT)
    except asyncio.TimeoutError:
        lowprio.kill_group(proc.pid)
        proc.kill()
        raise
    finally:
        watcher.cancel()
    reel["madeIn"] = round((datetime.datetime.now() - started).total_seconds(), 1)
    if peak[0]:
        reel["peakMb"] = round(peak[0])
    if over[0]:
        raise RuntimeError(f"Making it used more than {limit_mb} MB of memory (it reached {round(over[0])} MB) and was stopped. "
                           "Try a shorter script, or raise SAGE_REELS_MAX_MB.")
    if proc.returncode != 0:
        reel["error"] = _plain_error(errors)
    return proc.returncode or 0


def _plain_error(lines: List[str]) -> str:
    """The most useful line the engine said before it stopped (its own messages are already plain)."""
    useful = [l for l in lines if not re.match(r"(Speaking|Cutting|encoding|Drawing|Finding)", l)]
    if any("Executable doesn't exist" in l or "playwright install" in l for l in lines):
        return "Chromium isn't installed on the Pi. Run: playwright install chromium"
    text = " ".join(useful[-3:]) if useful else ""
    return (text or "The reel maker stopped without saying why.")[:400]


def _finish(reel: dict, folder: Path, code: Optional[int]) -> None:
    out = folder / "out"
    mp4 = out / "reel.mp4"
    if reel["status"] == "failed":
        return
    if code == 0 and mp4.is_file():
        info: dict = {}
        try:
            info = json.loads((out / "reel.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        reel.update(status="done", seconds=info.get("seconds"), size=mp4.stat().st_size,
                    timeline=info.get("timeline") or [], warnings=info.get("warnings") or [],
                    wordTiming=info.get("wordTiming") or "", scenes=info.get("scenes") or reel.get("scenes"),
                    progress={"percent": 100, "stage": "Done"})
        caption = out / "caption.txt"
        if caption.exists():
            reel["caption"] = caption.read_text(encoding="utf-8", errors="replace").strip()
    else:
        reel["status"] = "failed"
        reel["error"] = reel["error"] or "No video came out."


# --- Linking to the project's task ---

def _project(reel: dict) -> Optional[dict]:
    if not reel.get("projectId") or not posts._find_record:
        return None
    return posts._find_record("projects", reel["projectId"])


def _stage_fields(reel: dict, stage: str, status: str) -> dict:
    project = _project(reel)
    if project and str(project.get("type") or "") == "content" and stage in item_shape.TYPE_STAGES["content"]:
        return {"status": status, "stage": stage}
    return {"status": status}


async def _ensure_task(reel: dict) -> None:
    if not reel.get("projectId") or not posts._create_record or not _project(reel) or reel.get("taskId"):
        return
    try:
        item = await posts._create_record("workItems", {
            "title": f"Reel: {reel['title']}", "projectId": reel["projectId"], "entityType": "task",
            "labels": ["reel"], "reelId": reel["id"],
            "description": "Made with Auto Content. Open the reel from Sage > Reels.",
            **_stage_fields(reel, "scripting", "in_progress"),
        })
        reel["taskId"] = item.get("id")
        await save_async(reel)
    except Exception as e:
        logstore.warn("reels", f"Couldn't add the task for reel {reel['id']}: {e}")


async def _move_task(reel: dict, stage: str, status: str) -> None:
    if not reel.get("taskId") or not posts._update_record:
        return
    try:
        await posts._update_record("workItems", reel["taskId"], _stage_fields(reel, stage, status))
    except Exception as e:
        logstore.warn("reels", f"Couldn't move the task for reel {reel['id']}: {e}")


async def _after_done(reel: dict) -> None:
    await _move_task(reel, "editing", "in_progress")
    await _email(reel)


# --- Email ---

def reel_link(reel: dict) -> str:
    return notifier._view_link(f"reel={reel['id']}")


def poster_jpeg(reel: dict, width: int = 420) -> Optional[bytes]:
    from PIL import Image
    path = REELS_DIR / reel["id"] / "out" / "poster.jpg"
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            im.thumbnail((width, width * 2))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=80, optimize=True)
            return buf.getvalue()
    except OSError:
        return None


def build_email(reel: dict, poster: Optional[bytes]):
    link = reel_link(reel)
    heading = f"Your reel is ready: {reel['title']}"
    intro = f"{reel.get('seconds') or 0:.0f} seconds"
    if reel.get("madeIn"):
        intro += f", made in {reel['madeIn'] / 60:.0f} min" if reel["madeIn"] >= 90 else f", made in {reel['madeIn']:.0f} seconds"
    intro += ". Open it on your phone, tap Share and choose Instagram, then add trending music there." if link else ". Open Sage > Reels to share it."
    image = (f'<a href="{link or "#"}"><img src="cid:poster" alt="Reel poster" width="210" '
             f'style="width:210px;border-radius:10px;border:1px solid #e6e6ec"></a>') if poster else ""
    caption = reel.get("caption") or ""
    caption_html = (
        '<h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin:22px 0 6px">Caption (press and hold to copy)</h2>'
        f'<div style="font-size:15px;line-height:1.5;white-space:pre-wrap;background:#f4f4f7;border-radius:10px;padding:12px">{posts._esc(caption)}</div>'
        if caption else "")
    extra = f'<div style="margin-top:14px">{image}</div>{caption_html}'
    cta = "Share to Instagram" if link else "Open Sage"
    html_body = notifier.email_html(heading, intro, [], link, cta=cta, preheader=intro, extra_html=extra)
    text = notifier.email_text(heading, intro, [], link, cta=cta)
    if caption:
        text += "\n\nCAPTION\n" + caption
    return heading, text, html_body, ({"poster": poster} if poster else {})


async def _email(reel: dict, *, force: bool = False) -> bool:
    prefs = await asyncio.to_thread(notifier.get_prefs)
    if not force and not prefs["email"].get("postReady", True):
        return False
    if not notifier.email_ready(prefs):
        reel["emailError"] = "Email isn't set up yet (Settings > Notifications)."
        await save_async(reel)
        return False
    try:
        poster = await asyncio.to_thread(poster_jpeg, reel)
        heading, text, html_body, images = build_email(reel, poster)
        await asyncio.to_thread(notifier.send_email, prefs, heading, text, html_body, images)
        reel["emailed"], reel["emailError"] = True, ""
        logstore.info("reels", f"Emailed reel {reel['id']}")
    except Exception as e:
        reel["emailed"], reel["emailError"] = False, str(e)[:200] or e.__class__.__name__
        logstore.warn("reels", f"Email for reel {reel['id']} failed: {reel['emailError']}")
    await save_async(reel)
    await _announce(reel)
    return reel["emailed"]


def delete(reel_id: str) -> bool:
    if not _ids.fullmatch(reel_id or ""):
        return False
    conn = _db()
    try:
        cur = conn.execute("DELETE FROM reels WHERE id = ?", (reel_id,))
        conn.commit()
    finally:
        conn.close()
    shutil.rmtree(REELS_DIR / reel_id, ignore_errors=True)
    return cur.rowcount > 0


def _strip_media(reel: dict) -> None:
    """Remove a reel's rendered video (and poster), keeping its script and any uploaded voice so it
    can be remade from the archive later. The out/ folder holds the render; the voice sits beside it."""
    shutil.rmtree(REELS_DIR / reel["id"] / "out", ignore_errors=True)
    reel["size"] = 0


# --- Media files: the finished video and its poster, served straight off disk ---
#
# Same rules as /media/posts/ (posts.py): the login cookie, the API key or the reel's own signed
# token (?t=), a year of caching for any URL that carries ?v=<when it was made>, ETag / Last-Modified
# and Range requests so the phone can seek and resume the 20 to 60 MB video.

MEDIA_PREFIX = "/media/reels/"
_MEDIA_FILES = {"video": ("reel.mp4", "video/mp4"), "poster": ("poster.jpg", "image/jpeg")}


def media_token(reel_id: str) -> str:
    return hmac.new(posts._key(), f"reel-media:{reel_id}".encode(), hashlib.sha256).hexdigest()[:24]


def media_version(reel: dict) -> str:
    return re.sub(r"[^0-9]", "", str(reel.get("finishedAt") or "")) or "0"


def media_info(reel: dict) -> Optional[dict]:
    if reel.get("status") != "done" or not reel.get("size"):
        return None
    return {"base": f"{MEDIA_PREFIX}{reel['id']}", "v": media_version(reel), "t": media_token(reel["id"]),
            "video": "video/reel.mp4", "poster": "poster/poster.jpg"}


def with_media(reel: dict) -> dict:
    out = {**reel, "media": media_info(reel)}
    out.setdefault("review", "pending")
    out.setdefault("archived", False)
    out["queuePosition"] = queue_position(reel["id"]) if reel.get("status") in ("queued", "running") else 0
    return out


def _download_name(raw: str, ext: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-.")[:60] or "reel"
    return base if base.lower().endswith(f".{ext}") else f"{base}.{ext}"


# --- Routes ---

router = APIRouter()


class CheckBody(BaseModel):
    script: str


class NewReel(BaseModel):
    script: str
    title: str = ""
    style: str = ""
    projectId: str = ""


class Again(BaseModel):
    script: str = ""
    style: str = ""


def _missing() -> JSONResponse:
    return JSONResponse({"success": False, "error": "No such reel"}, status_code=404)


def _bad(message: str, code: int = 400) -> JSONResponse:
    return JSONResponse({"success": False, "error": message}, status_code=code)


@router.get("/api/reels")
def reels_list(projectId: str = "", limit: int = 60, archived: bool = False):
    return {"success": True, "status": status(),
            "reels": recent(projectId, max(1, min(limit, 100)), archived)}


@router.get("/api/reels/status")
def reels_status():
    return {"success": True, "status": status()}


@router.post("/api/reels/check")
def reels_check(body: CheckBody):
    if len(body.script) > MAX_SCRIPT:
        return _bad(f"That script is {len(body.script):,} characters; the limit is {MAX_SCRIPT:,}.")
    try:
        return {"success": True, "check": check(_clean_script(body.script))}
    except Exception as e:
        return _bad(f"Couldn't read that script: {str(e)[:200]}")


@router.post("/api/reels")
async def reels_create(body: NewReel):
    state = status()
    if not state["ready"]:
        return _bad("The reel maker isn't ready on this Pi. " + " ".join(state["problems"]), 503)
    try:
        reel = start(body.script, body.title, body.style, body.projectId)
    except ValueError as e:
        return _bad(str(e))
    except Busy as e:
        return _bad(str(e), 429)
    return {"success": True, "reel": with_media(reel)}


@router.get("/api/reels/{reel_id}")
def reels_get(reel_id: str):
    reel = get(reel_id)
    return {"success": True, "reel": with_media(reel), "status": status()} if reel else _missing()


@router.put("/api/reels/{reel_id}/voice")
async def reels_voice(reel_id: str, request: Request, name: str = "voice.m4a"):
    reel = get(reel_id)
    if not reel:
        return _missing()
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        return _bad("Upload size unknown.", 411)
    try:
        reel = await attach_voice(reel, name, int(length), request.stream())
    except VoiceError as e:
        return _bad(str(e))
    except Busy as e:
        return _bad(str(e), 429)
    return {"success": True, "reel": with_media(reel)}


@router.post("/api/reels/{reel_id}/remake")
async def reels_remake(reel_id: str, body: Again):
    reel = get(reel_id)
    if not reel:
        return _missing()
    try:
        reel = restart(reel, body.script, body.style)
    except ValueError as e:
        return _bad(str(e), 409)
    except Busy as e:
        return _bad(str(e), 429)
    return {"success": True, "reel": with_media(reel)}


@router.post("/api/reels/{reel_id}/posted")
async def reels_posted(reel_id: str, undo: bool = False):
    reel = get(reel_id)
    if not reel:
        return _missing()
    if reel["status"] != "done":
        return _bad("Only a finished reel can be marked as posted.", 409)
    reel["posted"] = not undo
    reel["postedAt"] = None if undo else _utc()
    await save_async(reel)
    if undo:
        await _move_task(reel, "editing", "in_progress")
    else:
        await _move_task(reel, "published", "done")
    return {"success": True, "reel": with_media(reel)}


class ReviewBody(BaseModel):
    action: str = ""   # approve | reject | reset


@router.post("/api/reels/{reel_id}/review")
async def reels_review(reel_id: str, body: ReviewBody):
    """Approve a reel (mark it ready to post), reject it (send it to the archive, keeping the
    script but removing the video), or reset it back to pending."""
    reel = get(reel_id)
    if not reel:
        return _missing()
    if reel["status"] in ("queued", "running"):
        return _bad("Wait for it to finish, then approve or reject it.", 409)
    action = (body.action or "").strip().lower()
    if action == "approve":
        reel.update(review="approved", archived=False, archivedAt=None)
    elif action == "reject":
        reel.update(review="rejected", archived=True, archivedAt=_utc(), posted=False, postedAt=None)
        _strip_media(reel)
        await _move_task(reel, "scripting", "todo")
    elif action == "reset":
        reel.update(review="pending", archived=False, archivedAt=None)
    else:
        return _bad("Unknown review action.")
    await save_async(reel)
    return {"success": True, "reel": with_media(reel)}


@router.post("/api/reels/{reel_id}/restore")
async def reels_restore(reel_id: str):
    """Bring a rejected reel back from the archive and remake its video from the kept script."""
    reel = get(reel_id)
    if not reel:
        return _missing()
    reel.update(archived=False, archivedAt=None, review="pending")
    try:
        reel = restart(reel)
    except ValueError:
        # It can't be remade right now (e.g. it still needs a recording); just un-archive it.
        await save_async(reel)
    except Busy as e:
        await save_async(reel)
        return _bad(str(e), 429)
    return {"success": True, "reel": with_media(reel)}


@router.post("/api/reels/{reel_id}/send")
async def reels_send(reel_id: str):
    """Email this reel to the address in Settings (the "Send to my phone" button)."""
    reel = get(reel_id)
    if not reel:
        return _missing()
    if reel["status"] != "done":
        return _bad("This reel isn't finished yet.", 409)
    if not await _email(reel, force=True):
        return _bad(reel.get("emailError") or "The email couldn't be sent.", 502)
    return {"success": True, "reel": with_media(reel)}


@router.delete("/api/reels/{reel_id}")
def reels_delete(reel_id: str):
    reel = get(reel_id)
    if not reel:
        return _missing()
    if reel["status"] in ("queued", "running"):
        return _bad("Wait for it to finish, then delete it.", 409)
    delete(reel_id)
    return {"success": True}


@router.get("/api/reels/{reel_id}/qr.svg")
def reels_qr(reel_id: str):
    reel = get(reel_id)
    link = reel_link(reel) if reel else ""
    if not reel or not link:
        return _missing()
    try:
        return Response(posts.qr_svg(link), media_type="image/svg+xml")
    except ImportError:
        return _missing()


@router.get(MEDIA_PREFIX + "{reel_id}/{kind}/{name}", include_in_schema=False)
def reels_media(reel_id: str, kind: str, name: str, request: Request, v: str = "", t: str = "", download: str = ""):
    if not _ids.fullmatch(reel_id):
        return _missing()
    check_auth = posts._media_auth
    allowed = (check_auth is None or check_auth(request) or (t and hmac.compare_digest(t, media_token(reel_id))))
    if not allowed:
        return JSONResponse({"success": False, "error": "Log in to Sage first"}, status_code=401)
    entry = _MEDIA_FILES.get(kind)
    if not entry or name != entry[0]:
        return _missing()
    path = REELS_DIR / reel_id / "out" / entry[0]
    try:
        stat = path.stat()
    except OSError:
        return _missing()
    headers = {"Cache-Control": posts.MEDIA_CACHE if v else "private, no-cache", "X-Content-Type-Options": "nosniff"}
    ext = path.suffix.lstrip(".")
    name_kw = {"filename": _download_name(download, ext)} if download else {}
    response = FileResponse(path, media_type=entry[1], headers=headers, stat_result=stat, **name_kw)
    etag = response.headers.get("etag", "")
    sent = request.headers.get("if-none-match", "")
    if etag and sent and etag in [tag.strip().removeprefix("W/") for tag in sent.split(",")]:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": headers["Cache-Control"]})
    return response
