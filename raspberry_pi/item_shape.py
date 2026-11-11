"""One shape for every work item, the Pi's copy of src/services/items.ts.

Older app versions, imports, the Claude connector and LUMO have each stored
work items a little differently (no entityType, "in_review", "Personal",
labels as text, no key). The web app reads them all through normalizeItem;
the Pi's own readers (overview, notifier, list filters) use normalize_item
here, so both sides agree on what is open, what kind it is and where it shows.
Reading never rewrites the database; backfill_items.py does that, on request.
"""
import re
from typing import Iterable, Optional

KINDS = ("task", "event", "reminder", "milestone")
BASES = ("todo", "in_progress", "blocked", "done")
PRIORITIES = ("low", "medium", "high", "urgent")

STATUS_WORDS = {
    "todo": "todo", "to_do": "todo", "open": "todo", "new": "todo", "backlog": "todo", "idea": "todo",
    "planned": "todo", "not_started": "todo",
    "in_progress": "in_progress", "inprogress": "in_progress", "doing": "in_progress", "in_review": "in_progress",
    "review": "in_progress", "active": "in_progress", "started": "in_progress", "wip": "in_progress",
    "blocked": "blocked", "waiting": "blocked", "on_hold": "blocked", "hold": "blocked", "paused": "blocked",
    "done": "done", "complete": "done", "completed": "done", "achieved": "done", "closed": "done",
    "finished": "done", "shipped": "done", "published": "done",
}

# Each project type's own statuses and the base they stand on (projectTypes.ts).
TYPE_STAGES = {
    "technical": {"backlog": "todo", "procurement": "in_progress", "building": "in_progress",
                  "testing": "in_progress", "blocked": "blocked", "shipped": "done"},
    "content": {"idea": "todo", "scripting": "in_progress", "recording": "in_progress",
                "editing": "in_progress", "blocked": "blocked", "published": "done"},
}


def _word(value) -> str:
    return re.sub(r"[\s-]+", "_", str(value if value is not None else "").strip().lower())


def _truthy(value) -> bool:
    return value is True or value == 1 or _word(value) in ("true", "yes", "1")


def kind_of(raw: dict) -> str:
    e = _word(raw.get("entityType"))
    if e in KINDS:
        return e
    t = _word(raw.get("type"))
    if t in ("meeting", "event"):
        return "event"
    if t in ("reminder", "milestone"):
        return t
    return "task"


def context_of(raw: dict) -> str:
    return "personal" if _word(raw.get("lifeContext")) in ("personal", "life") else "work"


def status_of(raw: dict, project_type: Optional[str] = None) -> tuple:
    """(base status, stage) for any stored status word."""
    s = _word(raw.get("status"))
    stage = raw.get("stage") or None
    if s in BASES:
        return s, stage
    stages = TYPE_STAGES.get(project_type or "", {})
    if s in stages:
        return stages[s], s
    if s in STATUS_WORDS:
        return STATUS_WORDS[s], stage
    return ("done" if raw.get("completedAt") else "todo"), stage


def _labels(value) -> list:
    if isinstance(value, list):
        return [str(x).strip() for x in value if x is not None and str(x).strip()]
    if isinstance(value, str) and value.strip():
        return [x.strip() for x in value.split(",") if x.strip()]
    return []


def normalize_item(raw: dict, project_type: Optional[str] = None) -> dict:
    """The item in the one shape; unknown fields are kept as they are."""
    kind = kind_of(raw)
    if kind == "milestone":
        # Logged once the work is done, so always done (older open ones too).
        stages = TYPE_STAGES.get(project_type or "", {})
        stored = raw.get("stage")
        status, stage = "done", (stored if stages.get(stored) == "done" else None)
    else:
        status, stage = status_of(raw, project_type)
    priority = _word(raw.get("priority"))
    out = dict(raw)
    out.update({
        "key": str(raw.get("key") or ""),
        "title": str(raw.get("title") or "").strip() and str(raw["title"]) or "Untitled",
        "entityType": kind,
        "type": str(raw.get("type") or kind),
        "status": status,
        "stage": stage,
        "priority": priority if priority in PRIORITIES else ("urgent" if priority == "critical" else "medium"),
        "lifeContext": context_of(raw),
        "projectId": raw.get("projectId") or None,
        "branchId": raw.get("branchId") or None,
        "areaId": raw.get("areaId") or None,
        "labels": _labels(raw.get("labels")),
        "isInbox": _truthy(raw.get("isInbox")),
        "isFocus": _truthy(raw.get("isFocus")),
        "isHidden": _truthy(raw.get("isHidden")),
    })
    if kind == "milestone" and not raw.get("completedAt"):
        out["completedAt"] = str(raw.get("dueDate") or raw.get("startDate") or raw.get("createdAt") or "")[:10] or None
    return out


def is_hidden(item: dict) -> bool:
    """A hidden task: kept out of every list, count, plan and digest, and
    only shown on the app's password-locked Hidden page (the web app's
    items.ts uses the same test). Its own reminder still comes, without
    its title."""
    return _truthy(item.get("isHidden"))


def is_alarm(item: dict) -> bool:
    """A LUMO alarm: a reminder labelled "alarm" that the desk clock rings
    (desk/alarms.py and the web app use the same test). Alarms live on the
    LUMO page and are never counted or listed as tasks."""
    return any(str(label).strip().lower() == "alarm" for label in item.get("labels") or [])


def is_open(item: dict) -> bool:
    """Open means not deleted and not done; status decides, as in the web app."""
    return not item.get("deletedAt") and item.get("status") != "done"


def next_key(items: Iterable[dict], prefix: str) -> str:
    """One past the highest PREFIX-n in use, so gaps and keyless items never repeat a key."""
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    highest = 0
    for item in items:
        m = pattern.match(str((item or {}).get("key") or ""))
        if m:
            highest = max(highest, int(m.group(1)))
    return f"{prefix}-{highest + 1}"


def project_types(projects: Iterable[dict]) -> dict:
    """project id -> its type, with old 'standard'/empty read as other."""
    out = {}
    for p in projects:
        t = str(p.get("type") or "").strip()
        out[p.get("id")] = "other" if t in ("", "standard") else t
    return out
