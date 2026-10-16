"""
chat_capture.py - the AI half of Chat capture in the New Item sheet.

The app reads dates, times, repeats, tags and priority itself (quickAddParser.ts)
and matches projects, branches, areas and open items by their words. It only
asks here when part of a message is still unclear: which project "the shoes
reel" belongs to, where one item ends and the next begins, or what a follow-up
like "make gym a habit" changes.

Which AI answers, first match wins:
  1. Groq, with the key Canvas already uses (Settings, or GROQ_API_KEY on the Pi).
  2. The Pi's local Ollama model, with a short time limit.
If neither answers, the app keeps what it worked out on its own.

The AI answers in names; this module turns them back into ids and drops any
name that isn't in the lists the app sent, so a made-up project never saves.
"""

import json
import os
import re
from typing import List, Optional

import httpx
from pydantic import BaseModel

import canvas_thinker

LOCAL_TIMEOUT_S = float(os.getenv("SAGE_CHAT_LOCAL_TIMEOUT", "25"))
KINDS = {"task", "reminder", "event", "habit"}
PRIORITIES = {"low", "medium", "high", "urgent"}


class CtxBranch(BaseModel):
    id: str
    name: str


class CtxProject(BaseModel):
    id: str
    name: str
    key: str = ""
    branches: List[CtxBranch] = []


class CtxArea(BaseModel):
    id: str
    name: str


class CtxItem(BaseModel):
    id: str
    key: str = ""
    title: str
    project: str = ""  # project or area name, as context for the AI


class CaptureCard(BaseModel):
    title: str
    kind: str = "task"
    project: str = ""
    branch: str = ""
    area: str = ""
    context: str = "work"
    when: str = ""
    priority: str = "medium"


class ChatCaptureRequest(BaseModel):
    mode: str = "split"  # split: a new message; edit: a follow-up about the cards
    message: str
    today: str = ""  # e.g. "Fri 16 Oct 2026"
    projects: List[CtxProject] = []
    areas: List[CtxArea] = []
    openItems: List[CtxItem] = []
    tags: List[str] = []
    cards: List[CaptureCard] = []


SPLIT_PROMPT = """You sort one message from Vineeth into items for his task manager, Sage.
Answer with JSON only, in this shape:
{"items": [{"text": "...", "title": "...", "kind": "task", "project": null, "branch": null, "area": null, "context": "work", "same_as": null, "tags": []}]}

For every separate thing to do or remember, one item:
- text: the exact words of the message that belong to this item, copied without changes, including any day, time or repeat words.
- title: a short clean title, without the day, time, repeat or project words.
- kind: task, reminder (he said "remind me"), event (a meeting or appointment at a time) or habit (something he wants to do regularly to build a routine).
- project and branch: copied exactly from the projects list, or null.
- area: copied exactly from the areas list, or null. Areas are personal life areas.
- context: work for projects, personal for areas and private errands.
- same_as: the key of an open item that is the same piece of work, or null.
- tags: only tags from the tags list that clearly fit, else [].
Never invent a project, branch, area, key or tag that is not in the lists."""

EDIT_PROMPT = """Vineeth is talking to Sage, his task manager, about the cards it just drafted or items already in Sage, and sent a follow-up.
Answer with JSON only, in this shape:
{"reply": "one short sentence saying what changed", "changes": [{"card": null, "item": null, "delete": false, "done": false, "reopen": false, "title": null, "kind": null, "project": null, "branch": null, "area": null, "context": null, "priority": null, "when": null, "clear_date": false, "no_repeat": false, "reminder_minutes_before": null, "no_reminder": false, "add_tags": [], "remove_tags": [], "note": null, "subtask": null}]}

One change per card or item the follow-up is about; fill only what it changes and leave the rest null, false or [].
- card: the number of a card, or item: the key of an open item (like C-13). Exactly one of the two.
- delete: he wants it gone. done / reopen: mark it finished, or not finished.
- title: a new title. kind: task, reminder, event or habit. priority: low, medium, high or urgent. context: work or personal.
- project, branch, area: copied exactly from the lists.
- when: new day, time or repeat words exactly as he would type them, e.g. "tomorrow 5pm" or "every mon wed fri 7am".
- clear_date: take the date off. no_repeat: stop it repeating.
- reminder_minutes_before: a number of minutes (0 = at the time). no_reminder: turn the reminder off.
- add_tags / remove_tags: tag names without #. note: text to add as a note. subtask: a step to add.
Never invent a card number, key, project, branch or area that is not in the lists."""


def _lists(req: ChatCaptureRequest) -> str:
    lines = [f"Today is {req.today}." if req.today else ""]
    if req.projects:
        lines.append("Projects (with branches):")
        for p in req.projects:
            branches = ", ".join(b.name for b in p.branches)
            lines.append(f"- {p.name}" + (f" (key {p.key})" if p.key else "") + (f": {branches}" if branches else ""))
    if req.areas:
        lines.append("Areas: " + ", ".join(a.name for a in req.areas))
    if req.openItems:
        lines.append("Open items:")
        for i in req.openItems[:60]:
            lines.append(f"- {i.key}: {i.title}" + (f" [{i.project}]" if i.project else ""))
    if req.tags:
        lines.append("Tags: " + ", ".join(req.tags[:40]))
    return "\n".join(l for l in lines if l)


def _user_text(req: ChatCaptureRequest) -> str:
    parts = [_lists(req)]
    if req.mode == "edit":
        parts.append("Cards:")
        for n, c in enumerate(req.cards, 1):
            where = " › ".join(filter(None, [c.project or c.area, c.branch]))
            parts.append(f"{n}. [{c.kind}] {c.title}" + (f" | {where}" if where else "") + (f" | {c.when}" if c.when else "") + f" | {c.priority}")
        parts.append(f"Follow-up: {req.message}")
    else:
        parts.append(f"Message: {req.message}")
    return "\n\n".join(parts)


def _ask_groq(system: str, user: str) -> str:
    primary = os.getenv("SAGE_CHAT_GROQ_MODEL", "").strip() or canvas_thinker._setting("GROQ_LLM_MODEL") or canvas_thinker.GROQ_DEFAULT_MODEL
    last_error = ""
    for model in dict.fromkeys([primary, canvas_thinker.GROQ_FALLBACK_MODEL]):
        try:
            res = httpx.post(
                canvas_thinker.GROQ_URL,
                headers={"Authorization": f"Bearer {canvas_thinker.groq_key()}"},
                json={"model": model, "temperature": 0.1, "max_tokens": 2048,
                      "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
                timeout=30,
            )
        except httpx.HTTPError as e:
            last_error = f"couldn't reach Groq ({e})"
            continue
        if res.status_code == 401:
            raise RuntimeError("Groq rejected the API key")
        if res.status_code != 200:
            last_error = f"Groq said {res.status_code}"
            continue
        return res.json()["choices"][0]["message"].get("content") or ""
    raise RuntimeError(last_error or "Groq gave no answer")


def _ask_local(system: str, user: str) -> str:
    import ollama

    client = ollama.Client(timeout=LOCAL_TIMEOUT_S)
    res = client.generate(model=canvas_thinker.LOCAL_MODEL, prompt=f"{system}\n\n{user}", format="json", options={"temperature": 0.1})
    return res["response"]


def engine() -> str:
    return "groq" if canvas_thinker.groq_key() else "local"


def _answer(system: str, user: str) -> tuple:
    if canvas_thinker.groq_key():
        try:
            return _ask_groq(system, user), "groq"
        except Exception as e:  # fall through to the local model
            print(f"Chat capture: Groq failed: {e}")
    return _ask_local(system, user), "local"


def _json_object(text: str, key: str) -> dict:
    """The last JSON object in the text that has `key`, forgiving fences, <think> and chatter."""
    text = re.sub(r"<think>.*?(</think>|$)", "", text or "", flags=re.S)
    found = {}
    decoder = json.JSONDecoder()
    for m in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and key in obj:
            found = obj
    return found


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


class _Lookup:
    """Names the AI gave, back to ids from the lists the app sent."""

    def __init__(self, req: ChatCaptureRequest):
        self.projects = {_norm(p.name): p for p in req.projects}
        self.areas = {_norm(a.name): a for a in req.areas}
        self.items = {_norm(i.key): i for i in req.openItems if i.key}
        self.tags = {_norm(t): t for t in req.tags}

    def project(self, name):
        return self.projects.get(_norm(name))

    def branch(self, project: Optional[CtxProject], name):
        if not project or not name:
            return None
        return next((b for b in project.branches if _norm(b.name) == _norm(name)), None)

    def area(self, name):
        return self.areas.get(_norm(name))

    def where(self, raw: dict) -> dict:
        out = {}
        project = self.project(raw.get("project"))
        if project:
            out["projectId"] = project.id
            branch = self.branch(project, raw.get("branch"))
            if branch:
                out["branchId"] = branch.id
        area = self.area(raw.get("area"))
        if area:
            out["areaId"] = area.id
        return out


def _clean_split(raw: dict, req: ChatCaptureRequest) -> List[dict]:
    look = _Lookup(req)
    message = _norm(req.message)
    items = []
    for it in raw.get("items") or []:
        if not isinstance(it, dict):
            continue
        text = str(it.get("text") or "").strip()
        title = str(it.get("title") or "").strip()
        if not text and not title:
            continue
        # The app re-reads dates from `text`, so it has to be words he actually typed.
        if text and _norm(text) not in message:
            text = ""
        out = {"text": text or title, "title": title or text}
        kind = _norm(it.get("kind"))
        if kind in KINDS:
            out["kind"] = kind
        out.update(look.where(it))
        context = _norm(it.get("context"))
        if context in ("work", "personal"):
            out["context"] = context
        same = look.items.get(_norm(it.get("same_as")))
        if same:
            out["sameAsId"] = same.id
        tags = [look.tags[_norm(t)] for t in (it.get("tags") or []) if _norm(t) in look.tags]
        if tags:
            out["tags"] = tags
        items.append(out)
    return items


def _clean_edit(raw: dict, req: ChatCaptureRequest) -> List[dict]:
    look = _Lookup(req)
    changes = []
    for ch in raw.get("changes") or []:
        if not isinstance(ch, dict):
            continue
        out = {}
        card = ch.get("card")
        if card not in (None, "", False):
            try:
                card = int(card)
            except (TypeError, ValueError):
                continue
            if not 1 <= card <= len(req.cards):
                continue
            out["card"] = card - 1
        else:
            item = look.items.get(_norm(ch.get("item")))
            if not item:
                continue
            out["itemId"] = item.id
        for flag, key in (("delete", "delete"), ("remove", "delete"), ("done", "done"), ("reopen", "reopen"),
                          ("clear_date", "clearDate"), ("no_repeat", "noRepeat"), ("no_reminder", "noReminder")):
            if ch.get(flag) is True:
                out[key] = True
        if ch.get("title"):
            out["title"] = str(ch["title"]).strip()
        kind = _norm(ch.get("kind"))
        if kind in KINDS:
            out["kind"] = kind
        priority = _norm(ch.get("priority"))
        if priority in PRIORITIES:
            out["priority"] = priority
        context = _norm(ch.get("context"))
        if context in ("work", "personal"):
            out["context"] = context
        if ch.get("when"):
            out["when"] = str(ch["when"]).strip()
        lead = ch.get("reminder_minutes_before")
        if isinstance(lead, (int, float)) and not isinstance(lead, bool) and 0 <= lead <= 7 * 1440:
            out["reminderMinutesBefore"] = int(lead)
        for src, dst in (("add_tags", "addTags"), ("remove_tags", "removeTags")):
            tags = [str(t).lstrip("#").strip().lower() for t in (ch.get(src) or []) if str(t).strip()]
            if tags:
                out[dst] = tags
        for key in ("note", "subtask"):
            if ch.get(key):
                out[key] = str(ch[key]).strip()
        if ch.get("project") or ch.get("area"):
            where = look.where(ch)
            if not where:
                continue  # a name that isn't in Sage: leave it alone
            out.update(where)
        if len(out) > 1:
            changes.append(out)
    return changes


def capture(req: ChatCaptureRequest) -> dict:
    if req.mode == "edit":
        text, used = _answer(EDIT_PROMPT, _user_text(req))
        raw = _json_object(text, "changes")
        return {"engine": used, "reply": str(raw.get("reply") or "").strip(), "changes": _clean_edit(raw, req)}
    text, used = _answer(SPLIT_PROMPT, _user_text(req))
    return {"engine": used, "items": _clean_split(_json_object(text, "items"), req)}
