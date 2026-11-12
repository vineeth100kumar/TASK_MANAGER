"""
recorder.py - Record audio from a USB microphone on the Pi.

Vineeth has a Bluetooth USB microphone plugged in. This module:

  1. Lists ALSA capture devices and picks the USB mic (or lets you choose).
  2. Records a WAV file using arecord.
  3. Serves recordings with playback.
  4. Transcribes them via Groq Whisper (the only AI on the Pi).

Recordings live in DATA_DIR/sage_recordings/<id>/. Each has:
  - audio.wav  (the raw recording)
  - meta.json  (title, duration, device, created_at, transcript)

Settings live in the metadata table under "recorder".
"""

import asyncio
import datetime
import json
import logging
import os
import re
import shutil
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

import canvas_thinker
import logstore
import notifier

log = logging.getLogger("recorder")

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
DATA_DIR = notifier.DATA_DIR
RECORDINGS_DIR = DATA_DIR / "sage_recordings"
MAX_DURATION_S = 600  # 10 minutes max
DEFAULT_SAMPLE_RATE = 44100
DEFAULT_CHANNELS = 1
DEFAULT_FORMAT = "S16_LE"

GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_WHISPER_MODEL = "whisper-large-v3"

router = APIRouter()


# --- Database ---

def connect(db_path: str):
    global DB_PATH
    DB_PATH = db_path
    _ensure_table()
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def _ensure_table():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS recordings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                duration_s REAL DEFAULT 0,
                device TEXT DEFAULT '',
                transcript TEXT DEFAULT '',
                transcribing INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                file_size INTEGER DEFAULT 0
            )
        """)


# --- ALSA device discovery ---

async def list_capture_devices() -> List[Dict[str, str]]:
    """List ALSA capture devices (arecord -l), returning card/device info."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "arecord", "-l",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        text = out.decode(errors="replace")
    except Exception:
        return []

    devices = []
    for line in text.splitlines():
        m = re.match(r"card\s+(\d+):\s+(\S+)\s+\[(.+?)\],\s+device\s+(\d+):\s+(.+)", line)
        if m:
            card, card_id, card_name, dev, dev_name = m.groups()
            devices.append({
                "card": card,
                "device": dev,
                "cardId": card_id,
                "cardName": card_name.strip(),
                "deviceName": dev_name.strip(),
                "hw": f"hw:{card},{dev}",
                "plughw": f"plughw:{card},{dev}",
            })
    return devices


def _pick_usb_device(devices: List[Dict[str, str]]) -> Optional[Dict[str, str]]:
    """Pick the first USB capture device, which is the most likely mic."""
    for d in devices:
        name = (d.get("cardName", "") + " " + d.get("deviceName", "")).lower()
        if "usb" in name:
            return d
    return devices[0] if devices else None


# --- Settings ---

def _settings() -> Dict[str, Any]:
    try:
        with _conn() as c:
            row = c.execute("SELECT value FROM metadata WHERE key = 'recorder'").fetchone()
            return json.loads(row[0]) if row else {}
    except Exception:
        return {}


def _save_settings(s: Dict[str, Any]):
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('recorder', ?)", (json.dumps(s),))


# --- Recording ---

_active_proc: Optional[asyncio.subprocess.Process] = None
_active_id: Optional[str] = None
_active_started: float = 0


async def start_recording(device: str = "", title: str = "", max_seconds: int = 0) -> Dict[str, Any]:
    """Start recording from the given ALSA device (or auto-detect USB mic)."""
    global _active_proc, _active_id, _active_started

    if _active_proc and _active_proc.returncode is None:
        return {"success": False, "error": "A recording is already in progress", "activeId": _active_id}

    if not device:
        devices = await list_capture_devices()
        picked = _pick_usb_device(devices)
        if not picked:
            return {"success": False, "error": "No capture device found. Is the USB microphone plugged in?"}
        device = picked["plughw"]

    rec_id = datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    rec_dir = RECORDINGS_DIR / rec_id
    rec_dir.mkdir(parents=True, exist_ok=True)
    wav_path = rec_dir / "audio.wav"

    duration = min(max_seconds or MAX_DURATION_S, MAX_DURATION_S)

    try:
        _active_proc = await asyncio.create_subprocess_exec(
            "arecord", "-D", device,
            "-f", DEFAULT_FORMAT, "-r", str(DEFAULT_SAMPLE_RATE),
            "-c", str(DEFAULT_CHANNELS), "-d", str(duration),
            "-t", "wav", str(wav_path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _active_id = rec_id
        _active_started = time.time()

        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        meta = {
            "id": rec_id, "title": title or f"Recording {rec_id[:15]}",
            "device": device, "created_at": now, "duration_s": 0,
            "transcript": "", "transcribing": False,
        }
        (rec_dir / "meta.json").write_text(json.dumps(meta, indent=2))

        logstore.append("info", f"Recording started: {rec_id} on {device} (max {duration}s)", source="recorder")
        return {"success": True, "id": rec_id, "device": device, "maxSeconds": duration}

    except Exception as e:
        _active_proc = None
        _active_id = None
        shutil.rmtree(rec_dir, ignore_errors=True)
        return {"success": False, "error": str(e)}


async def stop_recording() -> Dict[str, Any]:
    """Stop the active recording and finalize it."""
    global _active_proc, _active_id, _active_started

    if not _active_proc or _active_proc.returncode is not None:
        _active_proc = None
        pid = _active_id
        _active_id = None
        if pid:
            return await _finalize(pid)
        return {"success": False, "error": "No active recording"}

    rec_id = _active_id

    try:
        _active_proc.terminate()
        try:
            await asyncio.wait_for(_active_proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            _active_proc.kill()
    except ProcessLookupError:
        pass

    _active_proc = None
    _active_id = None
    elapsed = time.time() - _active_started

    if rec_id:
        return await _finalize(rec_id, elapsed)
    return {"success": False, "error": "Recording ID lost"}


async def _finalize(rec_id: str, elapsed: float = 0) -> Dict[str, Any]:
    """Save the recording metadata and index it in the database."""
    rec_dir = RECORDINGS_DIR / rec_id
    wav_path = rec_dir / "audio.wav"

    if not wav_path.is_file():
        shutil.rmtree(rec_dir, ignore_errors=True)
        return {"success": False, "error": "Recording file not found"}

    file_size = wav_path.stat().st_size
    if file_size < 100:
        shutil.rmtree(rec_dir, ignore_errors=True)
        return {"success": False, "error": "Recording is empty (no audio captured)"}

    # Get actual duration from WAV header
    duration = _wav_duration(wav_path) or elapsed

    meta_path = rec_dir / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.is_file() else {}
    meta["duration_s"] = round(duration, 1)
    meta["file_size"] = file_size
    meta_path.write_text(json.dumps(meta, indent=2))

    with _conn() as c:
        c.execute("""
            INSERT OR REPLACE INTO recordings (id, title, duration_s, device, transcript, transcribing, created_at, file_size)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        """, (rec_id, meta.get("title", rec_id), duration, meta.get("device", ""),
              meta.get("transcript", ""), meta.get("created_at", ""), file_size))

    logstore.append("info", f"Recording saved: {rec_id} ({duration:.1f}s, {file_size} bytes)", source="recorder")
    return {"success": True, "id": rec_id, "duration": round(duration, 1), "fileSize": file_size}


def _wav_duration(path: Path) -> Optional[float]:
    """Read duration from a WAV file header."""
    try:
        import struct
        with open(path, "rb") as f:
            riff = f.read(4)
            if riff != b"RIFF":
                return None
            f.read(4)
            wave = f.read(4)
            if wave != b"WAVE":
                return None
            bits_per_sample = 16
            channels = 1
            sample_rate = 44100
            while True:
                chunk_id = f.read(4)
                if len(chunk_id) < 4:
                    break
                chunk_size = struct.unpack("<I", f.read(4))[0]
                if chunk_id == b"fmt ":
                    fmt_data = f.read(chunk_size)
                    channels = struct.unpack("<H", fmt_data[2:4])[0]
                    sample_rate = struct.unpack("<I", fmt_data[4:8])[0]
                    bits_per_sample = struct.unpack("<H", fmt_data[14:16])[0]
                elif chunk_id == b"data":
                    bytes_per_sample = bits_per_sample // 8
                    total_samples = chunk_size // (bytes_per_sample * channels)
                    return total_samples / sample_rate
                else:
                    f.seek(chunk_size, 1)
    except Exception:
        pass
    return None


def recording_status() -> Dict[str, Any]:
    """Current recording state."""
    if _active_proc and _active_proc.returncode is None:
        return {"recording": True, "id": _active_id, "elapsed": round(time.time() - _active_started, 1)}
    return {"recording": False}


# --- Listing and retrieval ---

def recent(limit: int = 50) -> List[Dict[str, Any]]:
    """Most recent recordings."""
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM recordings ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get(rec_id: str) -> Optional[Dict[str, Any]]:
    """Get one recording's metadata."""
    if not re.fullmatch(r"[\w-]+", rec_id):
        return None
    with _conn() as c:
        row = c.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    return dict(row) if row else None


def delete(rec_id: str) -> bool:
    rec = get(rec_id)
    if not rec:
        return False
    shutil.rmtree(RECORDINGS_DIR / rec_id, ignore_errors=True)
    with _conn() as c:
        c.execute("DELETE FROM recordings WHERE id = ?", (rec_id,))
    logstore.append("info", f"Recording deleted: {rec_id}", source="recorder")
    return True


# --- Transcription via Groq Whisper ---

async def transcribe(rec_id: str) -> Dict[str, Any]:
    """Transcribe a recording using Groq's Whisper API."""
    rec = get(rec_id)
    if not rec:
        return {"success": False, "error": "Recording not found"}

    key = canvas_thinker.groq_key()
    if not key:
        return {"success": False, "error": "No Groq API key configured. Add one in Settings."}

    wav_path = RECORDINGS_DIR / rec_id / "audio.wav"
    if not wav_path.is_file():
        return {"success": False, "error": "Audio file missing"}

    # Mark as transcribing
    with _conn() as c:
        c.execute("UPDATE recordings SET transcribing = 1 WHERE id = ?", (rec_id,))

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            with open(wav_path, "rb") as f:
                resp = await client.post(
                    GROQ_WHISPER_URL,
                    headers={"Authorization": f"Bearer {key}"},
                    files={"file": ("audio.wav", f, "audio/wav")},
                    data={"model": GROQ_WHISPER_MODEL, "response_format": "verbose_json"},
                )

        if resp.status_code == 401:
            with _conn() as c:
                c.execute("UPDATE recordings SET transcribing = 0 WHERE id = ?", (rec_id,))
            return {"success": False, "error": "Groq rejected the API key"}

        if resp.status_code != 200:
            with _conn() as c:
                c.execute("UPDATE recordings SET transcribing = 0 WHERE id = ?", (rec_id,))
            return {"success": False, "error": f"Groq returned {resp.status_code}: {resp.text[:200]}"}

        data = resp.json()
        transcript = data.get("text", "").strip()

        # Save transcript
        with _conn() as c:
            c.execute("UPDATE recordings SET transcript = ?, transcribing = 0 WHERE id = ?",
                      (transcript, rec_id))

        meta_path = RECORDINGS_DIR / rec_id / "meta.json"
        if meta_path.is_file():
            meta = json.loads(meta_path.read_text())
            meta["transcript"] = transcript
            meta["transcribing"] = False
            meta_path.write_text(json.dumps(meta, indent=2))

        logstore.append("info", f"Transcribed recording {rec_id}: {len(transcript)} chars", source="recorder")
        return {"success": True, "transcript": transcript}

    except Exception as e:
        with _conn() as c:
            c.execute("UPDATE recordings SET transcribing = 0 WHERE id = ?", (rec_id,))
        return {"success": False, "error": str(e)}


# --- Routes ---

class StartBody(BaseModel):
    device: str = ""
    title: str = ""
    maxSeconds: int = 0


class RenameBody(BaseModel):
    title: str


@router.get("/api/recordings")
async def recordings_list(limit: int = 50):
    devices = await list_capture_devices()
    return {
        "success": True,
        "status": recording_status(),
        "recordings": recent(min(max(1, limit), 200)),
        "devices": devices,
        "groqKey": bool(canvas_thinker.groq_key()),
    }


@router.get("/api/recordings/devices")
async def recordings_devices():
    return {"success": True, "devices": await list_capture_devices()}


@router.post("/api/recordings/start")
async def recordings_start(body: StartBody):
    result = await start_recording(body.device, body.title, body.maxSeconds)
    return JSONResponse(result, status_code=200 if result["success"] else 400)


@router.post("/api/recordings/stop")
async def recordings_stop():
    result = await stop_recording()
    return JSONResponse(result, status_code=200 if result["success"] else 400)


@router.get("/api/recordings/status")
def recordings_status():
    return {"success": True, **recording_status()}


@router.get("/api/recordings/{rec_id}")
def recordings_get(rec_id: str):
    rec = get(rec_id)
    if not rec:
        return JSONResponse({"success": False, "error": "Not found"}, status_code=404)
    return {"success": True, "recording": rec}


@router.post("/api/recordings/{rec_id}/transcribe")
async def recordings_transcribe(rec_id: str):
    result = await transcribe(rec_id)
    return JSONResponse(result, status_code=200 if result["success"] else 400)


@router.put("/api/recordings/{rec_id}")
async def recordings_rename(rec_id: str, body: RenameBody):
    rec = get(rec_id)
    if not rec:
        return JSONResponse({"success": False, "error": "Not found"}, status_code=404)
    with _conn() as c:
        c.execute("UPDATE recordings SET title = ? WHERE id = ?", (body.title.strip(), rec_id))
    meta_path = RECORDINGS_DIR / rec_id / "meta.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text())
        meta["title"] = body.title.strip()
        meta_path.write_text(json.dumps(meta, indent=2))
    return {"success": True}


@router.delete("/api/recordings/{rec_id}")
def recordings_delete(rec_id: str):
    if delete(rec_id):
        return {"success": True}
    return JSONResponse({"success": False, "error": "Not found"}, status_code=404)


@router.get("/media/recordings/{rec_id}/audio.wav")
def recordings_audio(rec_id: str, request: Request):
    if not re.fullmatch(r"[\w-]+", rec_id):
        return JSONResponse({"error": "Invalid id"}, status_code=400)
    wav = RECORDINGS_DIR / rec_id / "audio.wav"
    if not wav.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)
    return FileResponse(wav, media_type="audio/wav",
                        headers={"Cache-Control": "private, max-age=3600"})
