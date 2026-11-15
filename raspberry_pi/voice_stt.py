"""voice_stt.py - Groq Whisper for the app's voice commands.

The web app records short spoken clips in the browser (it only cuts a clip when
someone is speaking, so silence is never sent) and posts each one here. This
turns it into text with Groq's Whisper, keeping inside Groq's free limits:
20 requests a minute, 2,000 a day, 7,200 audio seconds an hour and 28,800 a
day. Groq bills at least 10 seconds for any clip, so a clip counts as that.
The always-listening mode gets a smaller share of the day than a tap, so a TV
in the room can't use up the budget a tap needs.
"""

from __future__ import annotations

import logging
import re
import time
from collections import deque
from typing import Any, Deque, Dict, Optional

log = logging.getLogger("voice_stt")

GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MODEL = "whisper-large-v3-turbo"
MIN_BILLED_S = 10.0
MAX_BYTES = 3 * 1024 * 1024

# Under Groq's limits, with a little room.
PER_MINUTE = 16
PER_DAY = 1800
WAKE_PER_DAY = 1300           # always-listening stops here; taps still work
AUDIO_PER_HOUR = 6600.0
AUDIO_PER_DAY = 26000.0

# Whisper biased toward the words this app listens for.
PROMPT = ("Sage, set an alarm for 7:30 AM. Sage, set a timer for 10 minutes. "
          "Sage, cancel the 6 PM alarm. Sage, snooze. Sage, stop. Sage, start the stopwatch. "
          "Sage, lights to 40 percent. Sage, next song. Sage, volume up. Sage, what's playing?")

# What Whisper makes up from silence or noise.
_HALLUCINATIONS = {
    "thank you", "thanks for watching", "thank you for watching", "you", "bye", "okay", "ok",
    "subtitles by the amara.org community", "so", "uh", "um", "hmm", "mm", "mhm", "yeah",
}


def is_noise(text: str) -> bool:
    """Words Whisper hears in silence ("Thank you.") are not speech."""
    plain = re.sub(r"[^a-z' ]", "", (text or "").lower()).strip()
    return not plain or plain in _HALLUCINATIONS


class Budget:
    """Counts clips against Groq's limits (pure; the clock is passed in)."""

    def __init__(self) -> None:
        self.minute: Deque[float] = deque()
        self.hour: Deque[tuple] = deque()      # (at, billed seconds)
        self.day = ""
        self.clips = 0
        self.wake_clips = 0
        self.day_audio = 0.0

    def check(self, now: float, day: str, seconds: float, wake: bool) -> Optional[str]:
        """None when the clip may go; otherwise what to tell the person."""
        if day != self.day:
            self.day, self.clips, self.wake_clips, self.day_audio = day, 0, 0, 0.0
        while self.minute and now - self.minute[0] > 60:
            self.minute.popleft()
        while self.hour and now - self.hour[0][0] > 3600:
            self.hour.popleft()
        billed = max(MIN_BILLED_S, seconds)
        if len(self.minute) >= PER_MINUTE:
            return "Too many clips this minute. Give it a moment."
        if sum(b for _, b in self.hour) + billed > AUDIO_PER_HOUR:
            return "Voice has used its hour of Groq audio. It's back soon."
        if self.day_audio + billed > AUDIO_PER_DAY or self.clips >= PER_DAY:
            return "Voice has used today's Groq allowance."
        if wake and self.wake_clips >= WAKE_PER_DAY:
            return "Always-listening has used its share of today. Tap the mic instead."
        return None

    def spend(self, now: float, seconds: float, wake: bool) -> None:
        billed = max(MIN_BILLED_S, seconds)
        self.minute.append(now)
        self.hour.append((now, billed))
        self.clips += 1
        self.day_audio += billed
        if wake:
            self.wake_clips += 1


budget = Budget()


class VoiceError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def pick_text(data: Dict[str, Any]) -> str:
    """The words from a verbose_json answer, minus segments Whisper isn't sure are speech."""
    segments = data.get("segments") or []
    if not segments:
        return str(data.get("text") or "").strip()
    kept = [str(s.get("text", "")).strip() for s in segments
            if float(s.get("no_speech_prob", 0) or 0) < 0.6 and float(s.get("avg_logprob", 0) or 0) > -1.3]
    return " ".join(t for t in kept if t).strip()


async def transcribe(audio: bytes, content_type: str, seconds: float, wake: bool, lang: str = "en") -> str:
    import canvas_thinker
    import httpx
    if not audio or len(audio) < 1000:
        return ""
    if len(audio) > MAX_BYTES:
        raise VoiceError("That clip is too long.", 413)
    key = canvas_thinker.groq_key()
    if not key:
        raise VoiceError("Add a Groq key in Settings to use voice commands.", 400)
    now = time.time()
    why = budget.check(now, time.strftime("%Y-%m-%d"), seconds, wake)
    if why:
        raise VoiceError(why, 429)
    budget.spend(now, seconds, wake)
    ext = "wav" if "wav" in content_type else "mp4" if "mp4" in content_type or "aac" in content_type else "ogg" if "ogg" in content_type else "webm"
    data = {"model": MODEL, "response_format": "verbose_json", "temperature": "0", "prompt": PROMPT}
    if re.fullmatch(r"[a-z]{2}", lang or ""):
        data["language"] = lang
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(GROQ_STT_URL, headers={"Authorization": f"Bearer {key}"},
                                    files={"file": (f"clip.{ext}", audio, content_type or "audio/wav")}, data=data)
    except httpx.HTTPError as e:
        raise VoiceError(f"Couldn't reach Groq: {e.__class__.__name__}", 502)
    if res.status_code == 401:
        raise VoiceError("Groq rejected the key.", 400)
    if res.status_code == 429:
        raise VoiceError("Groq says too many requests. Give it a moment.", 429)
    if res.status_code != 200:
        log.info("Groq speech-to-text %s: %s", res.status_code, res.text[:200])
        raise VoiceError(f"Groq answered {res.status_code}.", 502)
    text = pick_text(res.json())
    return "" if is_noise(text) else text
