"""
Thinking partner for the Canvas view.

The browser sends a board as a text outline (shapes, their labels, which arrow
joins what) plus a PNG snapshot, and asks for one of:

  review     - look for gaps, contradictions and shaky steps in the reasoning
  summarize  - pull the board together into a short written summary
  ask        - answer a free-form question about the board

Which AI answers, first match wins:
  1. Groq, when GROQ_API_KEY is set in /etc/sage/sage.env or in LUMO's
     lumo/rpi_server/.env (the same key the voice assistant uses). Fast, text only.
  2. Claude, when ANTHROPIC_API_KEY is set. Reads the outline and the picture.
  3. The Pi's local Ollama model. Free, but slow and much weaker.
"""

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
# Keeps a runaway board from turning into a large bill.
MAX_OUTLINE_CHARS = 60_000

SYSTEM_PROMPT = """You are a thinking partner sitting beside someone as they work \
through an idea on a whiteboard. The board may be a flowchart, a mind map, a plan, \
loose notes or a sketch. You get a text outline of it (shapes, their labels, and \
which arrows connect what) and, when available, a picture of it.

Be direct and specific, like a sharp colleague looking over their shoulder. Refer \
to things on the board by their labels. Say plainly when something is fine; do not \
invent problems to seem useful. Keep answers short: a few bullets or a short \
paragraph, in plain text with simple "- " bullets. No headings, no preamble."""

MODE_PROMPTS = {
    "review": (
        "Check my thinking on this board. Point out the most important problems, if any: "
        "steps that don't follow, missing branches (e.g. a decision with only one outcome), "
        "loops with no exit, contradictions, assumptions I haven't stated, or things that "
        "are left dangling. The Arrows list is accurate: never say a connection is missing "
        "if it is listed there. Put the biggest issue first and suggest a fix for each. If it "
        "holds together, say so and name the one thing most worth thinking about next."
    ),
    "summarize": (
        "Summarize what this board says, as if writing it up for someone who hasn't seen it: "
        "the goal, the main flow or structure, the key decisions, and any open questions "
        "left on the board. Finish with a line of next steps if the board implies any."
    ),
}


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


def _setting(name: str) -> str:
    return os.getenv(name, "").strip() or _lumo_setting(name)


def groq_key() -> str:
    key = _setting("GROQ_API_KEY")
    return "" if key.startswith("your_") else key  # .env.example placeholder


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
        text = res.json()["choices"][0]["message"].get("content") or ""
        # Reasoning models can include their scratch work.
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
        return text or "No answer came back. Try again."
    raise RuntimeError(last_error)


def think_locally(req: CanvasThinkRequest) -> str:
    import ollama

    prompt = "\n\n".join(filter(None, [SYSTEM_PROMPT, _transcript(req), _board_text(req), _ask_text(req)]))
    response = ollama.generate(model=LOCAL_MODEL, prompt=prompt, options={"temperature": 0.3})
    return response["response"].strip()


def think(req: CanvasThinkRequest) -> dict:
    if groq_key():
        return {"text": think_with_groq(req), "engine": "groq"}
    if claude_available():
        return {"text": think_with_claude(req), "engine": "claude"}
    return {"text": think_locally(req), "engine": "local"}
