"""Every task belongs somewhere (the Pi's copy of src/services/placement.ts).

A work item with no project and no life area is put in the project it names,
or the one whose open tasks it most resembles; if nothing fits it goes to the
Inbox project. LUMO alarms are the one exception.
"""
import re
from typing import Iterable, Optional

INBOX_PROJECT_ID = "inbox"
INBOX_PROJECT_NAME = "Inbox"

_STOP = set("a an the to of for on in at and or with my me i it is be do get make call add new task item please".split())


def _words(text: str) -> list:
    return [w[:7] for w in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(w) > 2 and w not in _STOP]


def is_alarm(record: dict) -> bool:
    labels = record.get("labels") or []
    if isinstance(labels, str):
        labels = [labels]
    return any(str(l).lower() == "alarm" for l in labels)


def needs_place(record: dict) -> bool:
    return not record.get("projectId") and not record.get("areaId") and not record.get("deletedAt") and not is_alarm(record)


def choose_project(title: str, projects: Iterable[dict], items: Iterable[dict]) -> Optional[str]:
    """The project id this title belongs to, or None when nothing fits."""
    lower = str(title or "").lower()
    real = [p for p in projects if p.get("id") != INBOX_PROJECT_ID and p.get("name")]
    for p in real:
        if re.search(r"(^|[^a-z0-9])" + re.escape(p["name"].lower()) + r"([^a-z0-9]|$)", lower):
            return p["id"]
    mine = set(_words(title))
    ids = {p["id"] for p in real}
    score: dict = {}
    for it in items:
        pid = it.get("projectId")
        if pid in ids and not it.get("deletedAt"):
            shared = sum(1 for w in _words(it.get("title")) if w in mine)
            if shared:
                score[pid] = score.get(pid, 0) + shared
    if score:
        pid, best = max(score.items(), key=lambda kv: kv[1])
        if best >= 2:
            return pid
    return None


def inbox_project(now: str) -> dict:
    return {"id": INBOX_PROJECT_ID, "name": INBOX_PROJECT_NAME, "key": "INBOX", "color": "bg-slate-500",
            "type": "other", "description": "Tasks that were added without a project.",
            "createdAt": now, "updatedAt": now, "revision": 1}
