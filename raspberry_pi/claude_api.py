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
import sqlite3
from html import escape
from typing import Any, Awaitable, Callable, List, Optional

from fastapi import APIRouter, Request
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


def connect(db_path: str, tables: set, apply, quick_add, today) -> None:
    global DB_PATH, TABLES, _apply, _quick_add, _today
    DB_PATH, TABLES, _apply, _quick_add, _today = db_path, set(tables), apply, quick_add, today


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
        wanted = {s.strip() for s in status.split(",") if s.strip()}
        records = [r for r in records if r.get("status") in wanted]
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


def overview() -> dict:
    today = _today().isoformat()
    counts = {}
    for table in sorted(TABLES):
        counts[table] = len(_rows(table))
    items = _rows("workItems") if "workItems" in TABLES else []
    open_items = [i for i in items if i.get("status") != "done" and not i.get("deletedAt")]

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
        "projects": [{"id": p.get("id"), "name": p.get("name")} for p in (_rows("projects") if "projects" in TABLES else [])],
    }


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


def _note_body(fields: dict) -> None:
    """The web app shows a note's body parts when it has any, so plain text
    sent as `content` is written there too, the way the editor would save it."""
    if "content" not in fields or any(k.startswith("body") for k in fields):
        return
    text = str(fields["content"] or "")
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
    "workItems": {"entityType": "task", "type": "task", "status": "todo", "priority": "medium",
                  "description": "", "isFocus": False, "version": 1},
}


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
    if table == "workItems" and fields.get("status") == "done" and "completedAt" not in fields:
        fields["completedAt"] = _now()
    if table == "notes":
        _note_body(fields)
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


@router.get("/history")
async def http_history(limit: int = 50):
    return await _answer(lambda: history(limit))


@router.post("/quick-add")
async def http_quick_add(request: Request):
    body = await _body(request) or {}
    return await _answer(lambda: quick_add(body.get("text", "") if isinstance(body, dict) else ""))


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
workItems (tasks, events, reminders: title, status todo|in_progress|done|blocked, priority low|medium|high|urgent,
dueDate YYYY-MM-DD, dueTime HH:mm, projectId, areaId, labels, isInbox, isFocus, description),
projects (name, key, color), areas, goals, habits (name, frequency, history of YYYY-MM-DD days),
notes (title, content), comments and subtasks (workItemId), activities, boards (drawings).
Start with sage_overview. Changes appear in the open web app straight away. Prefer updating
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
