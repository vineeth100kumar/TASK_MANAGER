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

Plans ("I want to launch a YouTube channel about LUMO", "split C-13 into
steps") go to Groq only, with a stricter JSON shape and the larger models
first; the local model is too slow for them, so when Groq can't answer the
app starts from a template for the project type instead.

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
    type: str = ""  # Technical, Non-tech, Content, Other or the user's own name
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


class PlanTaskIn(BaseModel):
    title: str
    phase: int = 0
    days: int = 1
    priority: str = "medium"


class PlanIn(BaseModel):
    name: str = ""
    type: str = "other"
    phases: List[str] = []
    tasks: List[PlanTaskIn] = []


class ChatCaptureRequest(BaseModel):
    # split: a new message; edit: a follow-up about the cards;
    # plan: a goal to break down; plan_edit: a follow-up about the plan
    mode: str = "split"
    message: str
    today: str = ""  # e.g. "Fri 16 Oct 2026"
    projects: List[CtxProject] = []
    areas: List[CtxArea] = []
    openItems: List[CtxItem] = []
    tags: List[str] = []
    cards: List[CaptureCard] = []
    # Plans
    planMode: str = "new"  # new project, more for an existing project, or steps for one item
    target: str = ""  # the project or item it's about
    targetItems: List[str] = []  # what that project already has, so the plan doesn't repeat it
    typeHint: str = ""
    days: Optional[int] = None  # how long he said it should take
    plan: Optional[PlanIn] = None


SPLIT_PROMPT = """You sort one message from Vineeth into items for his task manager, Sage.
Answer with JSON only, in this shape:
{"items": [{"text": "...", "title": "...", "kind": "task", "project": null, "branch": null, "area": null, "context": "work", "same_as": null, "tags": []}]}

For every separate thing to do or remember, one item:
- text: the exact words of the message that belong to this item, copied without changes, including any day, time or repeat words.
- title: a short clean title, without the day, time, repeat or project words.
- kind: task, reminder (he said "remind me"), event (a meeting or appointment at a time) or habit (something he wants to do regularly to build a routine).
- project and branch: copied exactly from the projects list, or null. A project's type says what kind of work it holds, e.g. filming, editing or posting fits a Content project.
- area: copied exactly from the areas list, or null. Areas are personal life areas.
- context: work for projects, personal for areas and private errands.
- same_as: the key of an open item that is the same piece of work, or null.
- tags: only tags from the tags list that clearly fit, else [].
Never invent a project, branch, area, key or tag that is not in the lists."""

EDIT_PROMPT = """Vineeth is reviewing items Sage drafted from his message and sent a follow-up.
Answer with JSON only, in this shape:
{"reply": "one short sentence saying what changed", "changes": [{"card": 1, "title": null, "kind": null, "project": null, "branch": null, "area": null, "context": null, "priority": null, "when": null, "remove": false}]}

Only list the cards the follow-up is about, and only fill the fields it changes; leave the rest null.
- card: the number of the card.
- kind: task, reminder, event or habit.
- project, branch, area: copied exactly from the lists.
- priority: low, medium, high or urgent.
- when: new day, time or repeat words exactly as he would type them, e.g. "tomorrow 5pm" or "every mon wed fri 7am".
- remove: true if he wants the card dropped.
Never invent a project, branch or area that is not in the lists."""


def _lists(req: ChatCaptureRequest) -> str:
    lines = [f"Today is {req.today}." if req.today else ""]
    if req.projects:
        lines.append("Projects (type, then branches):")
        for p in req.projects:
            branches = ", ".join(b.name for b in p.branches)
            meta = ", ".join(x for x in (f"key {p.key}" if p.key else "", p.type) if x)
            lines.append(f"- {p.name}" + (f" ({meta})" if meta else "") + (f": {branches}" if branches else ""))
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
        try:
            card = int(ch.get("card"))
        except (TypeError, ValueError):
            continue
        if not 1 <= card <= len(req.cards):
            continue
        out = {"card": card - 1}
        if ch.get("remove") is True:
            out["remove"] = True
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
        if ch.get("project") or ch.get("area"):
            where = look.where(ch)
            if not where:
                continue  # a name that isn't in Sage: leave the card alone
            out.update(where)
        if len(out) > 1:
            changes.append(out)
    return changes

PLAN_TYPES = {"technical", "nontech", "content", "other"}
MAX_PLAN_TASKS = 24
MAX_PHASES = 6
MAX_TASK_DAYS = 60

PLAN_SHAPE = """{"name": "short project name", "type": "content", "summary": "one sentence on the approach",
 "phases": ["first stage", "second stage"],
 "tasks": [{"title": "verb-first task", "phase": 0, "days": 2, "priority": "high", "note": "one line on how, or empty"}]}"""

PLAN_PROMPT = """You are a practical project planner inside Vineeth's task manager, Sage.
He gives you a goal. Break it into the real work it takes, in the order he would do it.
Answer with JSON only, in exactly this shape:
""" + PLAN_SHAPE + """

- name: 2 to 5 words, the project as he would name it.
- type: technical (code, hardware, software), nontech (errands, admin, events, life), content (videos, posts, writing) or other.
- phases: 3 to 5 stages that follow each other in time, one or two words each, named for this goal.
- tasks: 8 to 20 tasks across those stages, in the order to do them. Each title starts with a verb and is specific to his goal, short enough for a list.
- phase: the index of the stage (0 is the first).
- days: realistic working days for one person doing this alongside other work, 1 to 30.
- priority: high for what everything after it depends on, low for nice-to-haves, else medium.
- note: one line with the useful how-to detail, or "".
Never add stages or tasks unrelated to his goal."""

STEPS_PROMPT = """You split one task from Vineeth's task manager, Sage, into steps he can tick off.
Answer with JSON only, in exactly this shape:
""" + PLAN_SHAPE + """

- name: the task title, unchanged.
- phases: ["Steps"].
- tasks: 3 to 10 concrete steps in order, each starting with a verb, all phase 0.
- days: 1 unless a step clearly takes longer.
- priority: medium unless one step is the critical one."""

PLAN_EDIT_PROMPT = """Vineeth is reviewing a project plan Sage drafted and asked for a change.
Apply his change and return the whole revised plan as JSON only, in exactly this shape:
""" + PLAN_SHAPE + """

Keep everything he didn't ask to change exactly as it was: same names, order, days and priorities.
When he asks for a new stage or more detail, write tasks specific to his goal."""


def _plan_text(req: ChatCaptureRequest) -> str:
    parts = [f"Today is {req.today}." if req.today else ""]
    if req.mode == "plan_edit" and req.plan:
        p = req.plan
        lines = [f"Plan: {p.name} ({p.type})"]
        for n, phase in enumerate(p.phases):
            lines.append(f"Stage {n}: {phase}")
            for t in p.tasks:
                if t.phase == n:
                    lines.append(f"  - {t.title} | {t.days} days | {t.priority}")
        parts.append("\n".join(lines))
        parts.append(f"His change: {req.message}")
        return "\n\n".join(x for x in parts if x)
    if req.planMode == "steps":
        parts.append(f"Task: {req.target or req.message}")
        parts.append(f"He said: {req.message}")
        return "\n\n".join(x for x in parts if x)
    if req.planMode == "existing" and req.target:
        parts.append(f"This is more work for his existing project {req.target}.")
        if req.targetItems:
            parts.append("It already has these tasks, so don't repeat them:\n" + "\n".join(f"- {t}" for t in req.targetItems[:40]))
    if req.typeHint in PLAN_TYPES and req.typeHint != "other":
        parts.append(f"It looks like a {req.typeHint} project.")
    if req.days:
        parts.append(f"He wants it done in about {req.days} days, so the task days should add up to roughly that.")
    parts.append(f"Goal: {req.message}")
    return "\n\n".join(x for x in parts if x)


def _plan_models() -> List[str]:
    """The biggest models first: a plan needs more thought than sorting a message."""
    chosen = os.getenv("SAGE_PLAN_GROQ_MODEL", "").strip()
    return list(dict.fromkeys(m for m in [
        chosen,
        "openai/gpt-oss-120b",
        os.getenv("SAGE_CHAT_GROQ_MODEL", "").strip() or canvas_thinker._setting("GROQ_LLM_MODEL") or canvas_thinker.GROQ_DEFAULT_MODEL,
        canvas_thinker.GROQ_FALLBACK_MODEL,
    ] if m))


def _ask_groq_plan(system: str, user: str) -> str:
    if not canvas_thinker.groq_key():
        raise RuntimeError("no Groq key on the Pi")
    last_error = ""
    for model in _plan_models():
        body = {"model": model, "temperature": 0.3, "max_tokens": 6000,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        for attempt in range(2):
            try:
                res = httpx.post(canvas_thinker.GROQ_URL, headers={"Authorization": f"Bearer {canvas_thinker.groq_key()}"}, json=body, timeout=45)
            except httpx.HTTPError as e:
                last_error = f"couldn't reach Groq ({e})"
                break
            if res.status_code == 401:
                raise RuntimeError("Groq rejected the API key")
            if res.status_code == 400 and attempt == 0 and "response_format" in body:
                body.pop("response_format")  # a model without JSON mode: ask again plainly
                continue
            if res.status_code != 200:
                last_error = f"Groq said {res.status_code} for {model}"
                break
            text = res.json()["choices"][0]["message"].get("content") or ""
            if _json_object(text, "tasks"):
                return text
            last_error = f"{model} gave no plan"
            break
    raise RuntimeError(last_error or "Groq gave no plan")


def _int(v, default: int) -> int:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return default


def _clean_plan(raw: dict, req: ChatCaptureRequest) -> Optional[dict]:
    """Only what Sage can save: capped counts, known types and priorities, stages that exist."""
    phases = [re.sub(r"\s+", " ", str(p or "")).strip()[:40] for p in (raw.get("phases") or []) if isinstance(p, (str, int))]
    phases = [p for p in phases if p][:MAX_PHASES] or ["Steps" if req.planMode == "steps" else "Plan"]
    tasks, seen = [], set()
    for t in raw.get("tasks") or []:
        if not isinstance(t, dict):
            continue
        title = re.sub(r"\s+", " ", str(t.get("title") or "")).strip()[:120]
        if not title or _norm(title) in seen:
            continue
        seen.add(_norm(title))
        phase = _int(t.get("phase"), len(phases) - 1)
        if not 0 <= phase < len(phases):
            phase = len(phases) - 1
        priority = _norm(t.get("priority"))
        tasks.append({
            "title": title,
            "phase": phase,
            "days": max(1, min(MAX_TASK_DAYS, _int(t.get("days"), 1))),
            "priority": priority if priority in PRIORITIES else "medium",
            "note": str(t.get("note") or "").strip()[:200],
        })
        if len(tasks) >= MAX_PLAN_TASKS:
            break
    if len(tasks) < 2:
        return None
    # Keep the tasks in stage order, and drop stages left empty.
    tasks.sort(key=lambda t: t["phase"])
    used = sorted({t["phase"] for t in tasks})
    for t in tasks:
        t["phase"] = used.index(t["phase"])
    kind = _norm(raw.get("type"))
    if kind in ("tech", "non-tech", "non tech"):
        kind = "technical" if kind == "tech" else "nontech"
    return {
        "name": re.sub(r"\s+", " ", str(raw.get("name") or "")).strip()[:60],
        "type": kind if kind in PLAN_TYPES else (req.typeHint if req.typeHint in PLAN_TYPES else "other"),
        "summary": str(raw.get("summary") or "").strip()[:200],
        "phases": [phases[i] for i in used],
        "tasks": tasks,
    }


def plan(req: ChatCaptureRequest) -> dict:
    if req.mode == "plan_edit":
        system = PLAN_EDIT_PROMPT
    else:
        system = STEPS_PROMPT if req.planMode == "steps" else PLAN_PROMPT
    text = _ask_groq_plan(system, _plan_text(req))
    cleaned = _clean_plan(_json_object(text, "tasks"), req)
    if not cleaned:
        raise RuntimeError("Groq's plan had nothing usable in it")
    return {"engine": "groq", "plan": cleaned}


def capture(req: ChatCaptureRequest) -> dict:
    if req.mode in ("plan", "plan_edit"):
        return plan(req)
    if req.mode == "edit":
        text, used = _answer(EDIT_PROMPT, _user_text(req))
        raw = _json_object(text, "changes")
        return {"engine": used, "reply": str(raw.get("reply") or "").strip(), "changes": _clean_edit(raw, req)}
    text, used = _answer(SPLIT_PROMPT, _user_text(req))
    return {"engine": used, "items": _clean_split(_json_object(text, "items"), req)}
