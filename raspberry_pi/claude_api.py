"""
claude_api.py - lets Claude read and change your Sage data, with its own key.

Off until SAGE_CLAUDE_TOKEN is set in /etc/sage/sage.env (deploy/claude_access.sh
makes one). That token is not API_SECRET: it reaches your tasks, notes and the
rest of the synced data, and the web app's own files so Claude can open Sage in
a browser, but not the settings, passwords, Bluetooth, phone or clear-all routes.

Two ways in, the same tools behind both:

  /api/claude/...         plain HTTP, "Authorization: Bearer <token>"
  /mcp/<token>            an MCP server, for adding Sage as a custom connector

Every change goes through the normal sync path with clientId "claude", so open
copies of the web app update straight away and /api/claude/history lists what
Claude changed. Deletes leave the usual marker row holding the last copy.
"""

import datetime
import hmac
import json
import os
import re
import sqlite3
from html import escape, unescape
from typing import Any, Awaitable, Callable, List, Optional

from fastapi import APIRouter, Request

import item_shape
from fastapi.responses import JSONResponse, Response

TOKEN = os.getenv("SAGE_CLAUDE_TOKEN", "").strip()
MIN_TOKEN_LENGTH = 32
CLIENT_ID = "claude"
# Longer values (note bodies, drawings) are cut short in lists; get one record to see it all.
LIST_VALUE_LIMIT = 2000
NOTE_PART_SIZE = 45000

if TOKEN and len(TOKEN) < MIN_TOKEN_LENGTH:
    print(f"SAGE_CLAUDE_TOKEN is shorter than {MIN_TOKEN_LENGTH} characters, so Claude's access stays off.")
    TOKEN = ""
enabled = bool(TOKEN)

# Filled in by db_server.connect_claude_api(), which owns the database and the sync path.
DB_PATH = "sage_sync.db"
TABLES: set = set()
# _apply(operations) runs a list of sync operations through the normal sync path.
_apply: Optional[Callable[[List[dict]], Awaitable[dict]]] = None
_quick_add: Optional[Callable[[str], Awaitable[dict]]] = None
_today: Callable[[], datetime.date] = datetime.date.today
_health: Optional[Callable[[], dict]] = None


def connect(db_path: str, tables: set, apply, quick_add, today, health=None) -> None:
    global DB_PATH, TABLES, _apply, _quick_add, _today, _health
    DB_PATH, TABLES, _apply, _quick_add, _today, _health = db_path, set(tables), apply, quick_add, today, health


def token_matches(candidate: Optional[str]) -> bool:
    return enabled and bool(candidate) and hmac.compare_digest(candidate.encode(), TOKEN.encode())


# Sync routes the web app itself needs, so a browser carrying the token can run it.
_SYNC_ROUTES = {("GET", "/api/sync/all"), ("GET", "/api/sync/changes"), ("POST", "/api/sync/operations")}


def allows(method: str, path: str) -> bool:
    """What the Claude token may reach. Everything else under /api/ needs API_SECRET."""
    if path.startswith("/api/claude/") or path == "/api/health" or (method, path) in _SYNC_ROUTES:
        return True
    return method in ("GET", "HEAD") and not path.startswith(("/api/", "/mcp"))


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# --- Reading ---

def _rows(table: str) -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT payload FROM entities WHERE table_name = ? AND deleted = 0", (table,)
        ).fetchall()
    finally:
        conn.close()
    return [json.loads(r[0]) for r in rows]


def _check_table(table: str) -> None:
    if table not in TABLES:
        raise ApiError(404, f"Unknown table {table}. Tables: {', '.join(sorted(TABLES))}")


def _find(table: str, record_id: str) -> Optional[dict]:
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(
            "SELECT payload FROM entities WHERE table_name = ? AND entity_id = ? AND deleted = 0", (table, record_id)
        ).fetchone()
    finally:
        conn.close()
    return json.loads(row[0]) if row else None


def _short(record: dict) -> dict:
    out = {}
    for key, value in record.items():
        if isinstance(value, str) and len(value) > LIST_VALUE_LIMIT:
            out[key] = value[:200] + f"... [{len(value)} characters; get the record to see all of it]"
        else:
            out[key] = value
    return out


def _joined(record: dict, count_key: str, prefix: str) -> Optional[str]:
    parts = int(record.get(count_key) or 0)
    if not parts:
        return None
    return "".join(str(record.get(f"{prefix}{i}") or "").removeprefix("~") for i in range(parts))


def list_records(table: str, q: str = "", status: str = "", due_by: str = "", limit: int = 50) -> dict:
    _check_table(table)
    records = _rows(table)
    if q:
        needle = q.lower()
        records = [r for r in records if needle in json.dumps(r, ensure_ascii=False).lower()]
    if status:
        # Compared in the one shape, so "in_review" counts as in_progress, as in the app.
        wanted = {s.strip() for s in status.split(",") if s.strip()}
        types = item_shape.project_types(_rows("projects")) if table == "workItems" else {}
        records = [r for r in records if (item_shape.normalize_item(r, types.get(r.get("projectId")))["status"] if table == "workItems" else r.get("status")) in wanted]
    if due_by:
        records = [r for r in records if r.get("dueDate") and str(r["dueDate"]) <= due_by]
    records.sort(key=lambda r: str(r.get("updatedAt") or r.get("createdAt") or ""), reverse=True)
    limit = max(1, min(int(limit or 50), 500))
    return {"table": table, "total": len(records), "records": [_short(r) for r in records[:limit]]}


def get_record(table: str, record_id: str) -> dict:
    _check_table(table)
    record = _find(table, record_id)
    if record is None:
        raise ApiError(404, f"No {table} record {record_id}")
    if table == "notes":
        body = _joined(record, "bodyParts", "body")
        if body is not None:
            record["bodyHtml"] = body
    if table == "boards":
        scene = _joined(record, "sceneParts", "scene")
        if scene is not None:
            record["sceneJson"] = scene
    return record


def _project_type(p: dict) -> str:
    """Older projects hold 'standard' or nothing, which the app shows as Other."""
    t = (p.get("type") or "").strip()
    return "other" if t in ("", "standard") else t


def overview() -> dict:
    today = _today().isoformat()
    counts = {}
    for table in sorted(TABLES):
        counts[table] = len(_rows(table))
    types = item_shape.project_types(_rows("projects")) if "projects" in TABLES else {}
    items = [item_shape.normalize_item(i, types.get(i.get("projectId"))) for i in _rows("workItems")] if "workItems" in TABLES else []
    # LUMO alarms are reminders underneath but not tasks.
    open_items = [i for i in items if item_shape.is_open(i) and not item_shape.is_alarm(i)]

    def brief(i: dict) -> dict:
        return {k: i.get(k) for k in ("id", "title", "status", "priority", "dueDate", "dueTime", "projectId") if i.get(k) is not None}

    due = sorted((i for i in open_items if i.get("dueDate") and str(i["dueDate"]) <= today),
                 key=lambda i: (str(i["dueDate"]), str(i.get("dueTime") or "")))
    return {
        "today": today,
        "counts": counts,
        "openItems": len(open_items),
        "dueTodayOrOverdue": [brief(i) for i in due[:50]],
        "focus": [brief(i) for i in open_items if i.get("isFocus")][:20],
        "inbox": [brief(i) for i in open_items if i.get("isInbox")][:20],
        "projects": [{"id": p.get("id"), "name": p.get("name"), "type": _project_type(p)} for p in (_rows("projects") if "projects" in TABLES else [])],
    }


def health() -> dict:
    if _health is None:
        raise ApiError(503, "The health report isn't connected")
    return _health()


def history(limit: int = 50) -> dict:
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT processed_at, entity_type, entity_id, operation FROM sync_operations "
            "WHERE client_id = ? ORDER BY processed_at DESC, rowid DESC LIMIT ?",
            (CLIENT_ID, max(1, min(int(limit or 50), 500))),
        ).fetchall()
    finally:
        conn.close()
    return {"changes": [{"at": r[0], "table": r[1], "id": r[2], "operation": r[3]} for r in rows]}


# --- Writing ---

def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


RAW_NOTE_KINDS = ("html", "code")
MAX_PUSH_CHARS = 2_000_000


def _html_text(html: str) -> str:
    """Plain words of an HTML page, for the Notes list preview and search."""
    html = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", html)
    text = unescape(re.sub(r"(?s)<[^>]+>", " ", html))
    return re.sub(r"\s+", " ", text).strip()[:40000]


def _note_body(fields: dict, kind: Optional[str] = None) -> None:
    """The web app shows a note's body parts when it has any, so plain text
    sent as `content` is written there too, the way the editor would save it.
    HTML reports and code notes keep their source as sent: the app shows them
    in a sandboxed frame or a code view, never in the editor."""
    if "content" not in fields or any(k.startswith("body") for k in fields):
        return
    text = str(fields["content"] or "")
    kind = fields.get("kind", kind)
    if kind in RAW_NOTE_KINDS:
        html = text
        fields["content"] = _html_text(text) if kind == "html" else text[:40000]
    else:
        html = "".join(f"<div>{escape(line) if line else '<br>'}</div>" for line in text.split("\n")) if text else ""
    parts = max(1, -(-len(html) // NOTE_PART_SIZE))
    for i in range(parts):
        fields[f"body{i}"] = "~" + html[i * NOTE_PART_SIZE:(i + 1) * NOTE_PART_SIZE]
    fields["bodyParts"] = parts


async def _write(table: str, record_id: str, operation: str, payload: Optional[dict]) -> dict:
    op = {
        "operationId": f"claude-{record_id}-{os.urandom(6).hex()}",
        "clientId": CLIENT_ID,
        "entityType": table,
        "entityId": record_id,
        "operation": operation,
        "revision": 1,
        "payload": payload,
    }
    reply = await _apply([op])
    result = reply["results"][0]
    if result.get("status") != "applied":
        raise ApiError(409, result.get("reason") or f"Not applied: {result.get('status')}")
    return result


_DEFAULTS = {
    # entityType and type are worked out from what was sent (item_shape.kind_of).
    "workItems": {"status": "todo", "priority": "medium",
                  "description": "", "isFocus": False, "version": 1},
}


def _next_key(record: dict) -> str:
    """Same key scheme as the web app: PROJECTKEY-n, LIFE-n for areas, else TASK-n."""
    prefix = "TASK"
    if record.get("projectId"):
        project = _find("projects", record["projectId"]) if "projects" in TABLES else None
        if project and project.get("key"):
            prefix = project["key"]
    elif record.get("areaId"):
        prefix = "LIFE"
    return item_shape.next_key(_rows("workItems"), prefix)


async def create_record(table: str, fields: dict) -> dict:
    _check_table(table)
    if not isinstance(fields, dict) or not fields:
        raise ApiError(400, "Send the new record's fields as a JSON object")
    record_id = str(fields.get("id") or f"claude-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')}-{os.urandom(3).hex()}")
    if _find(table, record_id):
        raise ApiError(409, f"{table} {record_id} already exists; update it instead")
    now = _now()
    record = {**_DEFAULTS.get(table, {}), **fields, "id": record_id, "createdAt": fields.get("createdAt") or now, "updatedAt": now}
    if table == "workItems":
        if not str(record.get("title") or "").strip():
            raise ApiError(400, "A work item needs a title")
        record.setdefault("isInbox", not record.get("dueDate") and not record.get("projectId"))
        record.setdefault("source", CLIENT_ID)
        # Written in the one shape the app reads (item_shape.py), so a milestone
        # isn't stored with type "task" and every item has its context and labels.
        record["entityType"] = item_shape.kind_of(record)
        if "type" not in fields:
            record["type"] = record["entityType"]
        record["lifeContext"] = item_shape.context_of(record)
        record.setdefault("labels", [])
        record.setdefault("branchId", None)
        # A milestone is logged after the work is done, so it is always done.
        if record["entityType"] == "milestone":
            record["status"] = "done"
            if record.get("stage") and record["stage"] not in ("done", "shipped", "published"):
                record["stage"] = None
        if record.get("status") == "done" and not record.get("completedAt"):
            record["completedAt"] = now
        if not record.get("key"):
            record["key"] = _next_key(record)
    if table == "thoughts":
        if not str(record.get("text") or "").strip() or not record.get("mapId"):
            raise ApiError(400, "A thought needs text and the mapId of its map")
        record["status"] = thought_status(record.get("status"))
        record.setdefault("topic", "")
        record.setdefault("source", CLIENT_ID)
    if table == "notes":
        record.setdefault("title", "Untitled")
        record.setdefault("content", "")
        _note_body(record)
    await _write(table, record_id, "save", record)
    return get_record(table, record_id)


async def update_record(table: str, record_id: str, fields: dict) -> dict:
    _check_table(table)
    if not isinstance(fields, dict) or not fields:
        raise ApiError(400, "Send the fields to change as a JSON object")
    if _find(table, record_id) is None:
        raise ApiError(404, f"No {table} record {record_id}")
    fields = {k: v for k, v in fields.items() if k not in ("id", "revision", "createdAt")}
    if table == "workItems" and "status" in fields and item_shape.kind_of({**_find(table, record_id), **fields}) == "milestone":
        fields["status"] = "done"  # a milestone can't be reopened; it was logged as done
    if table == "workItems" and fields.get("status") == "done" and "completedAt" not in fields:
        fields["completedAt"] = _now()
    if table == "notes":
        _note_body(fields, _find(table, record_id).get("kind"))
    if table == "thoughts" and "status" in fields:
        fields["status"] = thought_status(fields["status"])
    fields["updatedAt"] = _now()
    await _write(table, record_id, "patch", fields)
    return get_record(table, record_id)


async def delete_record(table: str, record_id: str) -> dict:
    _check_table(table)
    if _find(table, record_id) is None:
        raise ApiError(404, f"No {table} record {record_id}")
    await _write(table, record_id, "delete", None)
    return {"deleted": record_id, "table": table}


async def quick_add(text: str) -> dict:
    if not str(text or "").strip():
        raise ApiError(400, "text is required")
    return await _quick_add(text)


# --- Thought maps: a note with kind "map", its thoughts in the thoughts table ---

THOUGHT_STATUSES = ("open", "unsure", "good", "bad")
# Words Claude (or a person) might use for each icon.
_STATUS_WORDS = {
    "open": "open", "?": "open", "unsorted": "open", "question": "open", "todo": "open",
    "unsure": "unsure", "confused": "unsure", "confusing": "unsure", "maybe": "unsure", "ongoing": "unsure", "researching": "unsure",
    "good": "good", "pro": "good", "holds": "good", "holds up": "good", "valid": "good", "yes": "good", "tick": "good",
    "bad": "bad", "con": "bad", "doesn't hold": "bad", "invalid": "bad", "no": "bad", "dropped": "bad", "ruled out": "bad",
}


def thought_status(word: Any) -> str:
    key = str(word or "open").strip().lower()
    if key not in _STATUS_WORDS:
        raise ApiError(400, f"Unknown status {word!r}. Use open, unsure, good or bad (pro and con work too)")
    return _STATUS_WORDS[key]


def _maps() -> List[dict]:
    return [n for n in _rows("notes") if n.get("kind") == "map"]


def _thoughts_of(map_id: str) -> List[dict]:
    rows = [t for t in _rows("thoughts") if t.get("mapId") == map_id]
    rows.sort(key=lambda t: (str(t.get("createdAt") or ""), str(t.get("id"))))
    return rows


def _counts(thoughts: List[dict]) -> dict:
    counts = {s: 0 for s in THOUGHT_STATUSES}
    for t in thoughts:
        counts[t.get("status") if t.get("status") in counts else "open"] += 1
    return counts


def _find_map(ref: str) -> Optional[dict]:
    ref = str(ref or "").strip()
    if not ref:
        return None
    maps = _maps()
    for m in maps:
        if m.get("id") == ref:
            return m
    lower = ref.lower()
    exact = [m for m in maps if str(m.get("title") or "").strip().lower() == lower]
    if exact:
        return exact[0]
    partial = [m for m in maps if lower in str(m.get("title") or "").lower()]
    if len(partial) > 1:
        raise ApiError(400, "More than one map matches: " + ", ".join(repr(m.get("title")) for m in partial) + ". Use the map's id")
    return partial[0] if partial else None


def list_maps() -> dict:
    out = []
    for m in sorted(_maps(), key=lambda m: str(m.get("updatedAt") or ""), reverse=True):
        thoughts = _thoughts_of(m["id"])
        topics = []
        for t in thoughts:
            if t.get("topic") and t["topic"] not in topics:
                topics.append(t["topic"])
        out.append({"id": m["id"], "title": m.get("title"), "thoughts": len(thoughts), "counts": _counts(thoughts),
                    "topics": topics, "updatedAt": m.get("updatedAt")})
    return {"maps": out}


def get_map(ref: str) -> dict:
    m = _find_map(ref)
    if not m:
        raise ApiError(404, f"No thought map called {ref!r}. sage_maps lists them")
    thoughts = _thoughts_of(m["id"])
    keep = ("id", "text", "status", "topic", "parentId", "note", "source", "createdAt")
    return {
        "map": {"id": m["id"], "title": m.get("title"), "lifeContext": m.get("lifeContext")},
        "counts": _counts(thoughts),
        "thoughts": [{k: t.get(k) for k in keep if t.get(k) not in (None, "")} for t in thoughts],
    }


async def add_thoughts(ref: str, thoughts: Any, create_map: bool = False) -> dict:
    if not isinstance(thoughts, list) or not thoughts:
        raise ApiError(400, "Send thoughts as a list of {text, status, topic, under, note}")
    m = _find_map(ref)
    if not m:
        if not create_map or not str(ref or "").strip():
            raise ApiError(404, f"No thought map called {ref!r}. sage_maps lists them, or pass create_map true")
        m = await create_record("notes", {"title": str(ref).strip(), "kind": "map", "content": ""})
    existing = _thoughts_of(m["id"])
    added = []
    base = datetime.datetime.now(datetime.timezone.utc)
    for i, raw in enumerate(thoughts):
        if isinstance(raw, str):
            raw = {"text": raw}
        if not isinstance(raw, dict) or not str(raw.get("text") or "").strip():
            raise ApiError(400, f"Thought {i + 1} needs some text")
        parent = None
        under = str(raw.get("under") or raw.get("parentId") or "").strip()
        if under:
            pool = existing + added
            parent = next((t for t in pool if t["id"] == under), None) or \
                next((t for t in pool if str(t.get("text") or "").strip().lower() == under.lower()), None)
            if not parent:
                raise ApiError(400, f"No thought {under!r} in {m.get('title')!r} to put thought {i + 1} under")
        topic = str(raw.get("topic") or "").strip()
        if not topic and parent:
            topic = parent.get("topic") or ""
        # A millisecond apart, so a batch keeps the order it was sent in.
        at = (base + datetime.timedelta(milliseconds=i)).isoformat().replace("+00:00", "Z")
        fields = {
            "mapId": m["id"], "text": str(raw["text"]).strip()[:500], "status": thought_status(raw.get("status")),
            "topic": topic[:40], "parentId": parent["id"] if parent else None, "source": CLIENT_ID, "createdAt": at,
        }
        if str(raw.get("note") or "").strip():
            fields["note"] = str(raw["note"]).strip()[:2000]
        added.append(await create_record("thoughts", fields))
    await update_record("notes", m["id"], {"title": m.get("title")})  # bumps the map up the Notes list
    return {"map": {"id": m["id"], "title": m.get("title")}, "added": added, "counts": _counts(existing + added)}


# --- Reports and code pushed into Notes ---

def _find_note(ref: str) -> Optional[dict]:
    ref = str(ref or "").strip()
    if not ref:
        return None
    notes = [n for n in _rows("notes") if n.get("kind") != "map"]
    return next((n for n in notes if n.get("id") == ref), None) or \
        next((n for n in notes if str(n.get("title") or "").strip().lower() == ref.lower()), None)


async def push_note(args: Any) -> dict:
    """Saves an HTML report or a piece of code as a note. Sending the same title
    (or the note's id as `replace`) again updates that note instead of adding one."""
    if not isinstance(args, dict):
        raise ApiError(400, "Send {title, html} or {title, code, language}")
    title = str(args.get("title") or "").strip()[:200]
    html, code = args.get("html"), args.get("code")
    if not title or (html is None) == (code is None):
        raise ApiError(400, "Send a title and exactly one of html or code")
    body = str(html if html is not None else code)
    if not body.strip():
        raise ApiError(400, "The html or code is empty")
    if len(body) > MAX_PUSH_CHARS:
        raise ApiError(413, f"That is {len(body)} characters; a note holds at most {MAX_PUSH_CHARS}")
    fields = {
        "title": title, "kind": "html" if html is not None else "code", "content": body,
        # Who sent it, e.g. claude, gemini or chatgpt, shown on the note.
        "source": re.sub(r"[^a-z0-9 ._-]", "", str(args.get("source") or CLIENT_ID).lower())[:30] or CLIENT_ID,
    }
    if code is not None:
        fields["language"] = re.sub(r"[^a-z0-9+#._-]", "", str(args.get("language") or "").lower())[:20]
    if args.get("projectId"):
        fields["projectId"] = str(args["projectId"])
    if args.get("lifeContext") in ("work", "personal"):
        fields["lifeContext"] = args["lifeContext"]
    old = _find_note(args.get("replace") or title)
    if old and old.get("kind") in RAW_NOTE_KINDS:
        record = await update_record("notes", old["id"], fields)
        return {"updated": True, "note": _short(record)}
    record = await create_record("notes", fields)
    return {"updated": False, "note": _short(record)}


# --- Plain HTTP: /api/claude/... (the token is checked by db_server's middleware) ---

router = APIRouter(prefix="/api/claude")


async def _answer(work) -> JSONResponse:
    try:
        result = work()
        if hasattr(result, "__await__"):
            result = await result
    except ApiError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=e.status)
    return JSONResponse({"success": True, **result})


async def _body(request: Request) -> Any:
    try:
        return json.loads(await request.body() or b"{}")
    except ValueError:
        return None


@router.get("/overview")
async def http_overview():
    return await _answer(overview)


@router.get("/health")
async def http_health():
    return await _answer(health)


@router.get("/history")
async def http_history(limit: int = 50):
    return await _answer(lambda: history(limit))


@router.post("/quick-add")
async def http_quick_add(request: Request):
    body = await _body(request) or {}
    return await _answer(lambda: quick_add(body.get("text", "") if isinstance(body, dict) else ""))


@router.get("/maps")
async def http_maps():
    return await _answer(list_maps)


@router.get("/maps/{ref}")
async def http_map(ref: str):
    return await _answer(lambda: get_map(ref))


@router.post("/maps/{ref}/thoughts")
async def http_add_thoughts(ref: str, request: Request):
    body = await _body(request) or {}
    if not isinstance(body, dict):
        body = {}
    return await _answer(lambda: add_thoughts(ref, body.get("thoughts"), bool(body.get("createMap"))))


@router.post("/notes/push")
async def http_push_note(request: Request):
    body = await _body(request)
    return await _answer(lambda: push_note(body))


@router.get("/{table}")
async def http_list(table: str, q: str = "", status: str = "", due_by: str = "", limit: int = 50):
    return await _answer(lambda: list_records(table, q, status, due_by, limit))


@router.get("/{table}/{record_id}")
async def http_get(table: str, record_id: str):
    return await _answer(lambda: {"record": get_record(table, record_id)})


async def _record(coro) -> dict:
    return {"record": await coro}


@router.post("/{table}")
async def http_create(table: str, request: Request):
    body = await _body(request)
    return await _answer(lambda: _record(create_record(table, body)))


@router.patch("/{table}/{record_id}")
async def http_update(table: str, record_id: str, request: Request):
    body = await _body(request)
    return await _answer(lambda: _record(update_record(table, record_id, body)))


@router.delete("/{table}/{record_id}")
async def http_delete(table: str, record_id: str):
    return await _answer(lambda: delete_record(table, record_id))


# --- MCP: /mcp/<token>, JSON-RPC over plain HTTP POST (stateless) ---

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

INSTRUCTIONS = """Sage is Vineeth's task manager. Its data is a set of tables of JSON records:
workItems (tasks, events, reminders: title, status todo|in_progress|done|blocked, stage (the project type's own status, e.g. idea|scripting|recording|editing|published for content, backlog|procurement|building|testing|shipped for technical; it must sit on the same status), priority low|medium|high|urgent,
dueDate YYYY-MM-DD, dueTime HH:mm, projectId, areaId, labels, isInbox, isFocus, description),
projects (name, key, color, type technical|nontech|content|other or a custom name), areas, goals, habits (name, frequency, history of YYYY-MM-DD days),
notes (title, content; kind html for a report, code for code), comments and subtasks (workItemId), activities, boards (drawings),
dossiers (Radar research on a theme: summary, macro, whyNow, valueChain, claims citing sources by number,
sources, ideaIds, noteId) and ideas (startup ideas from a dossier: name, oneLiner, icp, pain, score out of 100,
acvUsd and other estimates, moat 0-10, risks, playbook, starred, projectId once turned into a project).
Thought maps are notes with kind "map" (Notes > Maps in the app): Vineeth's thinking on a decision, one
record per thought in the thoughts table (mapId, text, status open|unsure|good|bad, topic, parentId, note,
source). When he talks a decision through, put each point into his map with sage_thought_add: good for a
point that holds up (a pro), bad for one that doesn't (a con), unsure for confusion, open for unsorted
questions. Re-sort a thought by changing its status with sage_update. Use sage_maps and sage_map to read them.
To hand Vineeth a report, plan or snippet to keep, push it into Notes with sage_note_push.
Start with sage_overview; sage_health says whether the Pi itself is working. Changes appear in the open web app straight away. Prefer updating
over deleting, and say what you changed."""


def _table_prop() -> dict:
    return {"type": "string", "enum": sorted(TABLES), "description": "Which table"}


def _tools() -> List[dict]:
    obj = {"type": "object", "additionalProperties": True}
    return [
        {"name": "sage_overview", "description": "Today's date, record counts, open items due today or overdue, focus, inbox and projects.",
         "inputSchema": {"type": "object", "properties": {}}},
        {"name": "sage_list", "description": "List records in a table, newest first. Long values are shortened; use sage_get for the full record.",
         "inputSchema": {"type": "object", "required": ["table"], "properties": {
             "table": _table_prop(),
             "q": {"type": "string", "description": "Text to search for anywhere in the record"},
             "status": {"type": "string", "description": "Only these statuses, comma separated (work items)"},
             "due_by": {"type": "string", "description": "Only records due on or before this YYYY-MM-DD"},
             "limit": {"type": "integer", "description": "At most this many (default 50, max 500)"}}}},
        {"name": "sage_get", "description": "One full record by id.",
         "inputSchema": {"type": "object", "required": ["table", "id"], "properties": {"table": _table_prop(), "id": {"type": "string"}}}},
        {"name": "sage_create", "description": "Create a record. Work items need a title; sensible defaults fill the rest.",
         "inputSchema": {"type": "object", "required": ["table", "fields"], "properties": {"table": _table_prop(), "fields": obj}}},
        {"name": "sage_update", "description": "Change some fields of a record; fields not sent stay as they are.",
         "inputSchema": {"type": "object", "required": ["table", "id", "fields"], "properties": {"table": _table_prop(), "id": {"type": "string"}, "fields": obj}}},
        {"name": "sage_delete", "description": "Delete a record. Only when asked; the last copy is kept on the server for recovery.",
         "inputSchema": {"type": "object", "required": ["table", "id"], "properties": {"table": _table_prop(), "id": {"type": "string"}}}},
        {"name": "sage_quick_add", "description": "Add a work item from a sentence, the way Siri quick add does, e.g. 'Call the bank tomorrow 5pm !high #money'.",
         "inputSchema": {"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}}},
        {"name": "sage_health", "description": "Is the Pi working? Server version and uptime, background workers, "
         "Radar sources (with why any are down), the Markets board, backups, phone link and desk clock, plus a "
         "plain list of problems.",
         "inputSchema": {"type": "object", "properties": {}}},
        {"name": "sage_maps", "description": "Vineeth's thought maps (mind maps in Notes): title, how many thoughts are "
         "open, unsure, good (holds up) or bad (doesn't hold), and their topics.",
         "inputSchema": {"type": "object", "properties": {}}},
        {"name": "sage_map", "description": "One thought map with every thought in time order: id, text, status, topic, "
         "parentId (the thought it sits under), note and who added it.",
         "inputSchema": {"type": "object", "required": ["map"], "properties": {
             "map": {"type": "string", "description": "The map's id or title (part of the title works)"}}}},
        {"name": "sage_thought_add", "description": "Add thoughts to a thought map while talking a decision through: "
         "pros as good, cons as bad, confusions as unsure, unsorted questions as open. They appear in the app at once, "
         "marked as from Claude.",
         "inputSchema": {"type": "object", "required": ["map", "thoughts"], "properties": {
             "map": {"type": "string", "description": "The map's id or title"},
             "create_map": {"type": "boolean", "description": "Make a new map with this title if none matches"},
             "thoughts": {"type": "array", "items": {"type": "object", "required": ["text"], "properties": {
                 "text": {"type": "string", "description": "One short point"},
                 "status": {"type": "string", "enum": list(THOUGHT_STATUSES), "description": "Default open"},
                 "topic": {"type": "string", "description": "A short topic name such as Money or People; reuse the map's topics"},
                 "under": {"type": "string", "description": "Id or exact text of the thought this one belongs under"},
                 "note": {"type": "string"}}}}}}},
        {"name": "sage_note_push", "description": "Put an HTML report or a piece of code into Sage Notes. HTML shows "
         "in a sandboxed frame that already carries Sage's look (font, colours, light and dark, tables, code blocks), so "
         "send plain semantic HTML without your own theme; it may use the CSS variables --sage-bg, --sage-surface, "
         "--sage-text, --sage-muted, --sage-border, --sage-accent, --sage-good, --sage-warn, --sage-bad. Scripts run "
         "but cannot reach the app or the network except for scripts and styles from cdnjs, jsdelivr or unpkg. "
         "Sending the same title again replaces that note.",
         "inputSchema": {"type": "object", "required": ["title"], "properties": {
             "title": {"type": "string"},
             "html": {"type": "string", "description": "A full page or just body HTML. Send this or code"},
             "code": {"type": "string", "description": "Source code, shown highlighted with a copy button"},
             "language": {"type": "string", "description": "For code: python, ts, js, html, css, json, bash, cpp, sql..."},
             "source": {"type": "string", "description": "Which AI sent it, e.g. claude, gemini, chatgpt (default claude)"},
             "replace": {"type": "string", "description": "Id or title of an existing report or code note to overwrite"},
             "projectId": {"type": "string"},
             "lifeContext": {"type": "string", "enum": ["work", "personal"]}}}},
        {"name": "sage_history", "description": "Recent changes Claude made to Sage.",
         "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer"}}}},
    ]


async def _call_tool(name: str, args: dict) -> dict:
    if name == "sage_overview":
        return overview()
    if name == "sage_list":
        return list_records(args.get("table", ""), args.get("q", ""), args.get("status", ""), args.get("due_by", ""), args.get("limit", 50))
    if name == "sage_get":
        return get_record(args.get("table", ""), str(args.get("id", "")))
    if name == "sage_create":
        return await create_record(args.get("table", ""), args.get("fields"))
    if name == "sage_update":
        return await update_record(args.get("table", ""), str(args.get("id", "")), args.get("fields"))
    if name == "sage_delete":
        return await delete_record(args.get("table", ""), str(args.get("id", "")))
    if name == "sage_quick_add":
        return await quick_add(args.get("text", ""))
    if name == "sage_health":
        return health()
    if name == "sage_maps":
        return list_maps()
    if name == "sage_map":
        return get_map(args.get("map", ""))
    if name == "sage_thought_add":
        return await add_thoughts(args.get("map", ""), args.get("thoughts"), bool(args.get("create_map")))
    if name == "sage_note_push":
        return await push_note(args)
    if name == "sage_history":
        return history(args.get("limit", 50))
    raise ApiError(404, f"Unknown tool {name}")


async def _rpc(message: dict) -> Optional[dict]:
    method, msg_id, params = message.get("method"), message.get("id"), message.get("params") or {}
    if msg_id is None:
        return None  # a notification, e.g. notifications/initialized

    def ok(result):
        return {"jsonrpc": "2.0", "id": msg_id, "result": result}

    if method == "initialize":
        asked = params.get("protocolVersion")
        return ok({
            "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "sage", "version": "1.0.0"},
            "instructions": INSTRUCTIONS,
        })
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": _tools()})
    if method == "tools/call":
        try:
            result = await _call_tool(params.get("name", ""), params.get("arguments") or {})
            return ok({"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False})
        except ApiError as e:
            return ok({"content": [{"type": "text", "text": str(e)}], "isError": True})
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


mcp_router = APIRouter()


@mcp_router.api_route("/mcp/{token}", methods=["GET", "POST", "DELETE"], include_in_schema=False)
async def mcp_endpoint(token: str, request: Request):
    # A wrong token gets the same 404 as an unknown path, so the address gives nothing away.
    if not token_matches(token):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    if request.method != "POST":
        return Response(status_code=405, headers={"Allow": "POST"})
    try:
        message = json.loads(await request.body())
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, status_code=400)
    if not isinstance(message, dict):
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Send one JSON-RPC message"}}, status_code=400)
    reply = await _rpc(message)
    return Response(status_code=202) if reply is None else JSONResponse(reply)
