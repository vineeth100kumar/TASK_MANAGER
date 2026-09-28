"""
Thinking partner for the Canvas view.

The browser sends a board as a text outline (shapes, their labels, which arrow
joins what) plus a PNG snapshot, and asks for one of:

  review     - look for gaps, contradictions and shaky steps in the reasoning
  summarize  - pull the board together into a short written summary
  ask        - answer a free-form question about the board

With ANTHROPIC_API_KEY set (in /etc/sage/sage.env), Claude reads the outline
and the picture. Without it, the Pi's local Ollama model reads the outline
only, which is free but much weaker at spotting reasoning mistakes.
"""

import os
from typing import List, Optional

from pydantic import BaseModel

CLAUDE_MODEL = os.getenv("SAGE_CANVAS_MODEL", "claude-opus-5-5")
LOCAL_MODEL = os.getenv("SAGE_CANVAS_LOCAL_MODEL", "qwen2.5:1.5b")
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
        "are left dangling. Put the biggest issue first and suggest a fix for each. If it "
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


def claude_available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY", "").strip())


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


def think_locally(req: CanvasThinkRequest) -> str:
    import ollama

    prompt = "\n\n".join(filter(None, [SYSTEM_PROMPT, _transcript(req), _board_text(req), _ask_text(req)]))
    response = ollama.generate(model=LOCAL_MODEL, prompt=prompt, options={"temperature": 0.3})
    return response["response"].strip()


def think(req: CanvasThinkRequest) -> dict:
    if claude_available():
        return {"text": think_with_claude(req), "engine": "claude"}
    return {"text": think_locally(req), "engine": "local"}
