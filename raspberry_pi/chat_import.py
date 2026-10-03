"""
Read an exported WhatsApp chat and find the tasks, plans and milestones in it.

WhatsApp has no way for an app to read a personal account, so the person
exports a chat (Chat info > Export Chat > Without Media) and gives Sage the
file. Nothing here talks to WhatsApp. The export is read in memory and never
stored; only the items the person ticks in the app are saved, by the app.

The AI is the same one the Canvas uses (see canvas_thinker.engine()): Groq,
then Claude, then the Pi's local Ollama model.
"""

import base64
import datetime
import io
import json
import os
import re
import zipfile
from dataclasses import dataclass
from typing import List, Optional, Tuple

import httpx
from pydantic import BaseModel

import canvas_thinker

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
# The newest messages win when a chat is longer than this; keeps the AI
# request (and its bill) small.
MAX_TRANSCRIPT_CHARS = 60_000
KINDS = ("task", "milestone", "event")

# iPhone:  [03/10/2026, 10:12:33 AM] Rahul: text
# Android: 03/10/2026, 10:12 - Rahul: text
_LINE = re.compile(
    r"^\[?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?"
    r"\s*([ap]\.?\s?m\.?)?\]?\s*(?:-\s*)?(.*)$",
    re.I,
)
# Lines WhatsApp writes itself, and attachments left out of the export.
_NOISE = re.compile(
    r"(end-to-end encrypted|<media omitted>|(image|video|audio|sticker|gif|document) omitted"
    r"|this message was deleted|you deleted this message|missed (voice|video) call"
    r"|<this message was edited>)",
    re.I,
)


@dataclass
class Message:
    date: Optional[datetime.date]
    time: str  # HH:MM
    sender: str
    text: str


def decode_upload(file_name: str, data_base64: str) -> Tuple[str, str]:
    """The chat text and a name for the chat from an uploaded .txt or .zip."""
    try:
        raw = base64.b64decode(data_base64, validate=False)
    except ValueError:
        raise ValueError("That file couldn't be read.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("That file is too big. Export the chat Without Media.")
    name = chat_name(file_name)
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            texts = [n for n in z.namelist() if n.lower().endswith(".txt") and not n.startswith("__MACOSX")]
            if not texts:
                raise ValueError("There's no chat in that zip. Export the chat again and pick the .zip or .txt it makes.")
            texts.sort(key=lambda n: (os.path.basename(n) != "_chat.txt", n))
            raw = z.read(texts[0])
            if name == "Chat" and os.path.basename(texts[0]) != "_chat.txt":
                name = chat_name(texts[0])
    return raw.decode("utf-8-sig", errors="replace"), name


def chat_name(file_name: str) -> str:
    base = os.path.splitext(os.path.basename(file_name or ""))[0]
    m = re.match(r"^WhatsApp Chat (?:-|with)\s*(.+)$", base, re.I)
    name = (m.group(1) if m else base).strip()
    return name if name and name != "_chat" else "Chat"


def _as_date(a: int, b: int, y: int, day_first: bool) -> Optional[datetime.date]:
    day, month = (a, b) if day_first else (b, a)
    try:
        return datetime.date(y + 2000 if y < 100 else y, month, day)
    except ValueError:
        return None


def _day_first(lines: List[Tuple[int, int, int]]) -> bool:
    """Whether dates are DD/MM. Settled by any number over 12; otherwise the
    reading where messages follow each other most closely, which a real
    chat does (1/10 then 2/10 is a day apart as DD/MM, a month as MM/DD)."""
    for a, b, _ in lines:
        if a > 12:
            return True
        if b > 12:
            return False

    def spread(day_first: bool) -> int:
        dates = [d for d in (_as_date(a, b, y, day_first) for a, b, y in lines) if d]
        return sum(abs((later - earlier).days) for earlier, later in zip(dates, dates[1:]))

    return spread(True) <= spread(False)


def parse_export(text: str) -> List[Message]:
    text = text.replace("\u200e", "").replace("\u200f", "").replace("\u202f", " ").replace("\r\n", "\n")
    matched = []
    for line in text.split("\n"):
        m = _LINE.match(line.strip())
        matched.append(m)
    day_first = _day_first([(int(m.group(1)), int(m.group(2)), int(m.group(3))) for m in matched if m])

    messages: List[Message] = []
    for line, m in zip(text.split("\n"), matched):
        if not m:
            # A message that runs over several lines.
            if messages and line.strip():
                messages[-1].text += "\n" + line.strip()
            continue
        date = _as_date(int(m.group(1)), int(m.group(2)), int(m.group(3)), day_first)
        hour, minute = int(m.group(4)), int(m.group(5))
        ampm = (m.group(6) or "").lower().replace(".", "").replace(" ", "")
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        rest = m.group(7)
        sender, sep, body = rest.partition(": ")
        if not sep or len(sender) > 60:
            continue  # "Rahul added Priya", "You changed the group name"...
        messages.append(Message(date, f"{hour:02d}:{minute:02d}", sender.strip(), body.strip()))
    return [m for m in messages if m.text and not _NOISE.search(m.text)]


def recent(messages: List[Message], days: int, today: datetime.date) -> List[Message]:
    if days > 0:
        since = today - datetime.timedelta(days=days)
        messages = [m for m in messages if m.date is None or m.date >= since]
    kept: List[Message] = []
    size = 0
    for m in reversed(messages):
        size += len(m.text) + len(m.sender) + 20
        if size > MAX_TRANSCRIPT_CHARS:
            break
        kept.append(m)
    return list(reversed(kept))


def transcript(messages: List[Message]) -> str:
    return "\n".join(
        f"{m.date.isoformat() if m.date else '?'} {m.time} {m.sender}: {m.text}" for m in messages
    )


SYSTEM_PROMPT = """You read a WhatsApp conversation for someone and find what \
they should put in their task manager: things to do, plans with a date, deadlines \
and milestones. You answer with JSON only.

Pick out:
- task: something someone has to do ("can you send the deck", "I'll book the hall", \
"need to pay rent").
- event: a plan at a time or place ("dinner friday 8pm", "call at 3 tomorrow", \
"meeting at the office monday").
- milestone: a deadline or checkpoint for a project or goal ("launch on the 20th", \
"v2 goes live next week", "exam on 5 Nov").

Leave out chit-chat, jokes, greetings, things already done or cancelled later in \
the chat, and anything vague with no action. When a plan changes later in the \
chat, use the final version. Merge repeats into one item.

Each line of the chat starts with the date it was sent (YYYY-MM-DD) and the time. \
Work out real dates from that: "tomorrow" in a message sent 2026-10-01 is \
2026-10-02, "friday" means the next Friday after the message. Leave the date \
null when none is given.

Answer with exactly this shape and nothing else:
{"items": [{"title": "short imperative title, under 80 characters", \
"kind": "task" | "event" | "milestone", "date": "YYYY-MM-DD" or null, \
"time": "HH:MM" (24h) or null, "who": "the person who asked or who it is for", \
"quote": "the message it came from, word for word, under 200 characters", \
"sent": "YYYY-MM-DD the quote was sent"}]}
Return {"items": []} when there is nothing worth keeping."""


def _ask_groq(prompt: str) -> str:
    primary = os.getenv("SAGE_CANVAS_GROQ_MODEL", "").strip() or canvas_thinker._setting("GROQ_LLM_MODEL") or canvas_thinker.GROQ_DEFAULT_MODEL
    last_error = ""
    for model in dict.fromkeys([primary, canvas_thinker.GROQ_FALLBACK_MODEL]):
        try:
            res = httpx.post(
                canvas_thinker.GROQ_URL,
                headers={"Authorization": f"Bearer {canvas_thinker.groq_key()}"},
                json={
                    "model": model,
                    "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 8192,
                },
                timeout=90,
            )
        except httpx.HTTPError as e:
            last_error = f"couldn't reach Groq ({e})"
            continue
        if res.status_code == 401:
            raise RuntimeError("Groq rejected the API key. Check it in Settings.")
        if res.status_code != 200:
            last_error = f"Groq said {res.status_code}: {res.text[:200]}"
            continue
        return res.json()["choices"][0]["message"].get("content") or ""
    raise RuntimeError(last_error)


def _ask_claude(prompt: str) -> str:
    import anthropic  # imported here so the server still starts without the package

    response = anthropic.Anthropic().messages.create(
        model=canvas_thinker.CLAUDE_MODEL,
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text")


def _ask_local(prompt: str) -> str:
    import ollama

    response = ollama.generate(
        model=canvas_thinker.LOCAL_MODEL,
        prompt=SYSTEM_PROMPT + "\n\n" + prompt,
        options={"temperature": 0.2},
    )
    return response["response"]


def ask_ai(prompt: str) -> Tuple[str, str]:
    engine = canvas_thinker.engine()
    if engine == "groq":
        return _ask_groq(prompt), engine
    if engine == "claude":
        return _ask_claude(prompt), engine
    return _ask_local(prompt), engine


def _valid_date(value) -> Optional[str]:
    try:
        return datetime.date.fromisoformat(str(value)).isoformat()
    except ValueError:
        return None


def _valid_time(value) -> Optional[str]:
    m = re.match(r"^(\d{1,2}):(\d{2})$", str(value or "").strip())
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def parse_items(text: str) -> List[dict]:
    """The items from the AI's answer, forgiving code fences, reasoning and
    chatter around the JSON, and dropping anything malformed."""
    text = re.sub(r"<think>.*?(</think>|$)", "", text, flags=re.S)
    found: dict = {}
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text, match.start())
        except ValueError:
            continue
        if isinstance(value, dict) and isinstance(value.get("items"), list):
            found = value
    items = []
    seen = set()
    for raw in found.get("items", []):
        if not isinstance(raw, dict):
            continue
        title = re.sub(r"\s+", " ", str(raw.get("title") or "")).strip()[:120]
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        kind = str(raw.get("kind") or "task").lower()
        items.append({
            "title": title,
            "kind": kind if kind in KINDS else "task",
            "date": _valid_date(raw.get("date")),
            "time": _valid_time(raw.get("time")),
            "who": str(raw.get("who") or "").strip()[:60],
            "quote": str(raw.get("quote") or "").strip()[:300],
            "sent": _valid_date(raw.get("sent")),
        })
    return items


class ChatImportRequest(BaseModel):
    fileName: str = ""
    dataBase64: str
    days: int = 30  # how far back to read; 0 reads the whole chat


def read_chat(req: ChatImportRequest, today: Optional[datetime.date] = None) -> dict:
    today = today or datetime.date.today()
    text, name = decode_upload(req.fileName, req.dataBase64)
    messages = parse_export(text)
    if not messages:
        raise ValueError("That doesn't look like a WhatsApp chat export. In WhatsApp, open the chat, tap its name, then Export Chat.")
    window = recent(messages, req.days, today)
    base = {"chatName": name, "messageCount": len(window), "totalMessages": len(messages)}
    if not window:
        return {**base, "items": [], "engine": canvas_thinker.engine()}
    prompt = (
        f"Today is {today.isoformat()}. The chat is called \"{name}\".\n\n"
        f"Chat:\n{transcript(window)}"
    )
    answer, engine = ask_ai(prompt)
    return {
        **base,
        "from": next((m.date.isoformat() for m in window if m.date), None),
        "to": next((m.date.isoformat() for m in reversed(window) if m.date), None),
        "engine": engine,
        "items": parse_items(answer),
    }
