"""
song.py - what the clock knows about the song that's playing.

The phone sends only the title, artist and (AMS) where it is in the song, no
sound, so the clock can't hear the music. Instead:

- `about` asks Groq (with the key saved in Sage's Settings) for the genre, an
  estimated tempo and energy, and a few short facts. The clock's ring and
  level bars move at that tempo, and the facts take turns under the title.
  The tempo is the model's estimate, not measured, so the ring keeps the
  song's pace without being locked to its beat.
- `lyrics` gets the time-stamped lyrics from LRCLIB (free, no key), which
  the desk sends a line at a time as the song reaches it.

Both are cached on disk by title and artist, so a song is only looked up once.
The clock's fonts are ASCII only, so text is folded to ASCII on the way out
(and lyrics mostly in another script are left out).
"""

import asyncio
import json
import logging
import os
import re
import unicodedata
from pathlib import Path
from typing import List, Optional, Tuple

import httpx

log = logging.getLogger("desk")

CACHE_FILE = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent / "song_cache.json"
CACHE_MAX = 400
LRCLIB = "https://lrclib.net/api"
USER_AGENT = "Sage desk clock (https://github.com/vineeth100kumar/TASK_MANAGER)"
FACT_LEN = 96

PROMPT = """You describe songs for a small desk clock's now-playing screen.
Song: "{title}" by {artist}.{details}
Reply with JSON only, in this shape:
{{"genre": "one or two words", "bpm": 120, "energy": 0.6, "facts": ["...", "...", "..."]}}
- bpm: the song's tempo as a whole number; your best estimate if unsure.
- energy: 0 (calm, quiet) to 1 (loud, driving).
- facts: up to three true, interesting facts about this song (when it came out,
  the album, chart records, how it was made, samples, who wrote it). Each under
  90 characters, plain text. Leave facts empty rather than guess.
If you don't know the song, give your best genre/bpm/energy for the artist and no facts."""

_lock = asyncio.Lock()


def ascii_text(text: str, limit: int = FACT_LEN) -> str:
    """Folded to the clock's ASCII fonts: accents dropped, quotes and dashes
    straightened, anything else left out."""
    text = (text or "").translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"',
                                                  "–": "-", "—": "-", "…": "..."}))
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit - 3].rstrip() + "..."


def _key(title: str, artist: str) -> str:
    return f"{title.strip().lower()}\u0001{artist.strip().lower()}"


def _load() -> dict:
    try:
        return json.loads(CACHE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def _save(cache: dict) -> None:
    if len(cache) > CACHE_MAX:
        for k in list(cache)[:len(cache) - CACHE_MAX]:
            del cache[k]
    try:
        CACHE_FILE.write_text(json.dumps(cache))
    except OSError as e:
        log.warning("Couldn't save the song cache: %s", e)


async def _cached(kind: str, title: str, artist: str, fetch):
    key = _key(title, artist)
    async with _lock:
        cache = await asyncio.to_thread(_load)
        entry = cache.get(key, {})
        if kind in entry:
            return entry[kind]
    value = await fetch()
    if value is None:
        return None  # failed: try again next time
    async with _lock:
        cache = await asyncio.to_thread(_load)
        cache.setdefault(key, {})[kind] = value
        await asyncio.to_thread(_save, cache)
    return value


def clean_about(raw: dict) -> dict:
    """The model's answer, checked and trimmed for the clock."""
    try:
        bpm = int(round(float(raw.get("bpm") or 0)))
    except (TypeError, ValueError):
        bpm = 0
    if not 40 <= bpm <= 220:
        bpm = 0
    try:
        energy = min(1.0, max(0.0, float(raw.get("energy"))))
    except (TypeError, ValueError):
        energy = 0.5
    facts = [ascii_text(str(f)) for f in (raw.get("facts") or []) if isinstance(f, str)]
    return {
        "genre": ascii_text(str(raw.get("genre") or ""), 22),
        "bpm": bpm,
        "energy": round(energy, 2),
        "facts": [f for f in facts if f][:3],
    }


def details(album: str = "", duration: float = 0, app: str = "") -> str:
    """What else the phone told us about the song, to help pin down which
    recording it is (a live version, a remix, a radio edit)."""
    lines = []
    if album:
        lines.append(f"Album: {album}.")
    if duration and duration > 0:
        lines.append(f"Length: {int(duration) // 60}:{int(duration) % 60:02d}.")
    if app:
        lines.append(f"Playing in: {app}.")
    return "".join("\n" + line for line in lines)


async def _ask_groq(title: str, artist: str, extra: str = "") -> Optional[dict]:
    import canvas_thinker  # the key saved in Sage's Settings, and its models
    key = canvas_thinker.groq_key()
    if not key:
        return None
    models = [os.getenv("SAGE_SONG_GROQ_MODEL", "").strip() or canvas_thinker.GROQ_DEFAULT_MODEL,
              canvas_thinker.GROQ_FALLBACK_MODEL]
    async with httpx.AsyncClient(timeout=30.0) as client:
        for model in dict.fromkeys(m for m in models if m):
            try:
                res = await client.post(canvas_thinker.GROQ_URL, headers={"Authorization": f"Bearer {key}"}, json={
                    "model": model, "temperature": 0.2, "max_tokens": 1024,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": PROMPT.format(title=title, artist=artist or "an unknown artist", details=extra)}],
                })
                if res.status_code != 200:
                    log.info("Groq couldn't describe %s (%s): %s", title, model, res.status_code)
                    continue
                text = res.json()["choices"][0]["message"].get("content") or ""
                text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
                match = re.search(r"\{.*\}", text, re.S)
                return clean_about(json.loads(match.group(0))) if match else None
            except (httpx.HTTPError, ValueError, KeyError, IndexError) as e:
                log.info("Groq couldn't describe %s: %s", title, e)
    return None


async def about(title: str, artist: str, album: str = "", duration: float = 0, app: str = "") -> Optional[dict]:
    """Genre, bpm (0 when unknown), energy 0..1 and up to three facts, or None
    without a Groq key or when Groq can't be reached. Groq gets the title and
    artist, and the album, length and app when the phone has said them."""
    if not title:
        return None
    extra = details(album, duration, app)
    return await _cached("about", title, artist, lambda: _ask_groq(title, artist, extra))


def parse_lrc(lrc: str) -> List[Tuple[float, str]]:
    """'[01:02.50] words' lines as (seconds, words), in order. An empty line
    is a gap (an instrumental break)."""
    out = []
    for line in (lrc or "").splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", line)
        words = re.sub(r"\[[^\]]*\]", "", line).strip()
        for m, s in stamps:
            out.append((int(m) * 60 + float(s), words))
    out.sort(key=lambda x: x[0])
    return out


def usable(lines: List[Tuple[float, str]]) -> List[Tuple[float, str]]:
    """Folded to ASCII, or nothing if most of the words don't survive that."""
    text = "".join(w for _, w in lines)
    if not text or sum(c.isascii() for c in text) < 0.8 * len(text):
        return []
    return [(t, ascii_text(w)) for t, w in lines]


async def _ask_lrclib(title: str, artist: str, duration: float) -> Optional[list]:
    params = {"track_name": title, "artist_name": artist}
    if duration:
        params["duration"] = int(round(duration))
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": USER_AGENT}) as client:
            res = await client.get(f"{LRCLIB}/get", params=params)
            found = res.json() if res.status_code == 200 else None
            if not found or not found.get("syncedLyrics"):
                res = await client.get(f"{LRCLIB}/search", params={"track_name": title, "artist_name": artist})
                if res.status_code != 200:
                    return None if res.status_code >= 500 else []
                found = next((r for r in res.json() if r.get("syncedLyrics")), None)
    except (httpx.HTTPError, ValueError) as e:
        log.info("LRCLIB couldn't be reached for %s: %s", title, e)
        return None
    if not found or found.get("instrumental"):
        return []
    return [list(x) for x in usable(parse_lrc(found.get("syncedLyrics") or ""))]


async def lyrics(title: str, artist: str, duration: float = 0) -> List[Tuple[float, str]]:
    """Timed lines, or [] when there are none (or LRCLIB can't be reached)."""
    if not title:
        return []
    found = await _cached("lyrics", title, artist, lambda: _ask_lrclib(title, artist, duration))
    return [(float(t), w) for t, w in (found or [])]


def line_at(lines: List[Tuple[float, str]], position: float) -> int:
    """The index of the line being sung at `position` seconds, or -1 before
    the first."""
    current = -1
    for i, (t, _) in enumerate(lines):
        if t > position:
            break
        current = i
    return current
