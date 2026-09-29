"""
Thinking partner for the Canvas view.

The browser sends a board as a text outline (shapes, their labels, which arrow
joins what) plus a PNG snapshot, and asks for one of:

  review     - look for gaps, contradictions and shaky steps in the reasoning
  summarize  - pull the board together into a short written summary
  ask        - answer a free-form question about the board
  edit       - change the board as asked; replies with edit operations the
               browser previews and applies (the outline is then a numbered
               list of shapes n1.. and arrows e1.. to refer to)

Which AI answers, first match wins:
  1. Groq, with a key saved from the app's Settings, or GROQ_API_KEY in
     /etc/sage/sage.env or LUMO's lumo/rpi_server/.env (the same key the voice
     assistant uses). Fast, text only.
  2. Claude, when ANTHROPIC_API_KEY is set. Reads the outline and the picture.
  3. The Pi's local Ollama model. Free, but slow and much weaker.
"""

import json
import os
import re
from pathlib import Path
from typing import List, Optional

import httpx
from pydantic import BaseModel

CLAUDE_MODEL = os.getenv("SAGE_CANVAS_MODEL", "claude-opus-5-5")
LOCAL_MODEL = os.getenv("SAGE_CANVAS_LOCAL_MODEL", "qwen2.5:1.5b")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# Same defaults as LUMO's voice assistant.
GROQ_DEFAULT_MODEL = "qwen/qwen3.8-27b"
GROQ_FALLBACK_MODEL = "openai/gpt-oss-20b"
LUMO_ENV = Path(__file__).resolve().parent.parent / "lumo" / "rpi_server" / ".env"
# Keys entered in Settings, kept next to the database (outside git).
SECRETS_FILE = Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent / "sage_secrets.json"
# Keeps a runaway board from turning into a large bill.
MAX_OUTLINE_CHARS = 60_000

SYSTEM_PROMPT = """You are a thinking partner sitting beside someone as they work \
through an idea on a whiteboard. The board may be a flowchart, a mind map, a plan, \
loose notes or a sketch. You get a text outline of it (shapes, their labels, and \
which arrows connect what) and, when available, a picture of it.

Be direct and specific, like a sharp colleague looking over their shoulder. Refer \
to things on the board by their labels. Only talk about what is actually on the \
board. Say plainly when something is fine; never invent problems to seem useful, \
and never list a kind of problem you can't point to on the board. Match the length \
of your answer to the board: a board with two or three shapes gets two or three \
sentences. Unless asked for JSON, write plain text only, with simple "- " bullets if you need a list. No \
headings, no bold, no numbered checklists, no preamble."""

MODE_PROMPTS = {
    "review": (
        "Check my thinking on this board. Read it as the start of an idea that may still be "
        "growing, not as a finished document. If a step doesn't follow from the one before, "
        "a decision is missing an outcome, or something contradicts something else, say so and "
        "suggest a fix; name at most three problems, biggest first. The Arrows list is accurate: "
        "never say a connection is missing if it is listed there. If nothing is actually wrong, "
        "say so in one line, then give the one question most worth answering next to take the "
        "idea further."
    ),
    "summarize": (
        "Summarize what this board says, as if writing it up for someone who hasn't seen it: "
        "the goal, the main flow or structure, the key decisions, and any open questions "
        "left on the board. Keep it as short as the board is. Finish with a line of next "
        "steps if the board implies any."
    ),
}

EDIT_PROMPT = """Change the board as I ask below. You can only add shapes, add arrows, \
rename shapes, and remove shapes or arrows; the app places new shapes for you. Keep \
my ideas and wording unless I ask otherwise, and make only the changes the request \
needs.

Reply with only a JSON object, no other text:
{"reply": "one or two plain sentences saying what you changed", "ops": [...]}

Each op is one of:
{"op": "add_node", "ref": "new1", "label": "text", "shape": "box" | "decision" | "oval", "near": "n2"}
{"op": "add_edge", "from": "n2", "to": "new1", "label": "optional, e.g. Yes or No"}
{"op": "edit_label", "id": "n1", "label": "new text"}
{"op": "delete", "id": "n3" or "e2"}

Refer to existing shapes and arrows by their ids from the board (n1, e1...). Give each \
new shape a ref (new1, new2...) and use it in add_edge. "near" is the shape a new one \
follows, so it's placed under it. Use a decision shape for yes/no questions and label \
its outgoing arrows. If the request can't be done with these ops, return an empty ops \
list and say why in reply.

My request: """

IMPROVE_REQUEST = (
    "Improve this diagram: fill in the steps or outcomes that are clearly missing, "
    "and tidy wording that's unclear. Keep everything I've drawn."
)

# Small models copy markdown into the reply; the panel shows plain text.
def _plain(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.M)
    return text.strip()


class ThinkTurn(BaseModel):
    role: str  # "user" or "assistant"
    text: str


class CanvasThinkRequest(BaseModel):
    mode: str  # review | summarize | ask
    boardTitle: str = ""
    outline: str
    imagePng: Optional[str] = None  # base64, no data: prefix
    question: Optional[str] = None
    history: List[ThinkTurn] = []


def _ask_text(req: CanvasThinkRequest) -> str:
    if req.mode == "edit":
        return EDIT_PROMPT + ((req.question or "").strip() or IMPROVE_REQUEST)
    if req.mode == "ask":
        return (req.question or "").strip() or "What do you make of this board?"
    return MODE_PROMPTS.get(req.mode, MODE_PROMPTS["review"])


def _board_text(req: CanvasThinkRequest) -> str:
    outline = req.outline[:MAX_OUTLINE_CHARS]
    title = req.boardTitle.strip() or "Untitled board"
    return f'The board is called "{title}". Its current contents:\n\n{outline}'


def _transcript(req: CanvasThinkRequest) -> str:
    turns = [t for t in req.history[-8:] if t.text]
    if not turns:
        return ""
    lines = "\n\n".join(f"{'Me' if t.role == 'user' else 'You'}: {t.text}" for t in turns)
    return f"Our conversation about this board so far:\n\n{lines}"


def _lumo_setting(name: str) -> str:
    """A value from LUMO's .env, so the Groq key only has to be entered once."""
    try:
        for line in LUMO_ENV.read_text().splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and key.strip() == name:
                return value.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _saved_secrets() -> dict:
    try:
        return json.loads(SECRETS_FILE.read_text())
    except (OSError, ValueError):
        return {}


def _setting(name: str) -> str:
    return os.getenv(name, "").strip() or _lumo_setting(name)


def groq_key() -> str:
    key = str(_saved_secrets().get("GROQ_API_KEY", "")).strip() or _setting("GROQ_API_KEY")
    return "" if key.startswith("your_") else key  # .env.example placeholder


def save_groq_key(key: str) -> None:
    """Store (or, with an empty key, forget) the Groq key entered in Settings."""
    secrets = _saved_secrets()
    if key.strip():
        secrets["GROQ_API_KEY"] = key.strip()
    else:
        secrets.pop("GROQ_API_KEY", None)
    SECRETS_FILE.touch(mode=0o600, exist_ok=True)
    SECRETS_FILE.write_text(json.dumps(secrets))


def groq_key_status() -> dict:
    """Whether a Groq key is in use and where it came from, without revealing it."""
    saved = str(_saved_secrets().get("GROQ_API_KEY", "")).strip()
    key = groq_key()
    source = "settings" if saved else ("pi" if key else None)
    return {"set": bool(key), "source": source, "last4": key[-4:] if key else None}


def claude_available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY", "").strip())


def engine() -> str:
    if groq_key():
        return "groq"
    return "claude" if claude_available() else "local"


def think_with_claude(req: CanvasThinkRequest) -> str:
    import anthropic  # imported here so the server still starts without the package

    client = anthropic.Anthropic()

    # Each ask is a fresh one-message request: the board changes between asks,
    # so earlier turns go in as a short transcript rather than replayed history.
    content: list = []
    if req.imagePng:
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": req.imagePng}})
    content.append({"type": "text", "text": "\n\n".join(filter(None, [_transcript(req), _board_text(req), _ask_text(req)]))})
    messages = [{"role": "user", "content": content}]

    response = client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        messages=messages,
        thinking={"type": "adaptive"},
        output_config={"effort": "medium"},
        # If a safety check declines, Anthropic re-runs the request on its recommended fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        return "Claude declined to answer this one. Try rephrasing, or ask about a different part of the board."
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if response.stop_reason == "max_tokens":
        text += "\n\n(The answer was cut off.)"
    return text or "No answer came back. Try again."


def think_with_groq(req: CanvasThinkRequest) -> str:
    primary = os.getenv("SAGE_CANVAS_GROQ_MODEL", "").strip() or _setting("GROQ_LLM_MODEL") or GROQ_DEFAULT_MODEL
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(filter(None, [_transcript(req), _board_text(req), _ask_text(req)]))},
    ]
    last_error = ""
    for model in dict.fromkeys([primary, GROQ_FALLBACK_MODEL]):
        try:
            res = httpx.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {groq_key()}"},
                json={"model": model, "messages": messages, "temperature": 0.3, "max_tokens": 2048},
                timeout=60,
            )
        except httpx.HTTPError as e:
            last_error = f"couldn't reach Groq ({e})"
            continue
        if res.status_code == 401:
            raise RuntimeError("Groq rejected the API key. Check GROQ_API_KEY.")
        if res.status_code != 200:
            last_error = f"Groq said {res.status_code}: {res.text[:200]}"
            continue  # busy (429) or model gone: try the fallback
        text = _plain(res.json()["choices"][0]["message"].get("content") or "")
        return text or "No answer came back. Try again."
    raise RuntimeError(last_error)


def think_locally(req: CanvasThinkRequest) -> str:
    import ollama

    prompt = "\n\n".join(filter(None, [SYSTEM_PROMPT, _transcript(req), _board_text(req), _ask_text(req)]))
    response = ollama.generate(model=LOCAL_MODEL, prompt=prompt, options={"temperature": 0.3})
    return _plain(response["response"])


def _raw_answer(req: CanvasThinkRequest) -> tuple:
    if groq_key():
        return think_with_groq(req), "groq"
    if claude_available():
        return think_with_claude(req), "claude"
    return think_locally(req), "local"


def _parse_edits(text: str) -> dict:
    """The JSON an edit request asks for, forgiving code fences and chatter around it."""
    start, end = text.find("{"), text.rfind("}")
    try:
        data = json.loads(text[start:end + 1]) if start != -1 and end > start else {}
    except ValueError:
        data = {}
    ops = data.get("ops") if isinstance(data.get("ops"), list) else []
    reply = str(data.get("reply") or "").strip()
    if not data:
        reply = "I couldn't turn that into changes on the board. Try asking in a different way."
    return {"text": reply or ("Here are my changes." if ops else "I didn't find anything to change."), "ops": ops}


def think(req: CanvasThinkRequest) -> dict:
    text, engine = _raw_answer(req)
    if req.mode == "edit":
        return {**_parse_edits(text), "engine": engine}
    return {"text": text, "engine": engine}
