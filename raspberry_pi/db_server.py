import json
import os
import hmac
import sqlite3
import datetime
import asyncio
from pathlib import Path
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from urllib.parse import parse_qs, quote

import access_gate
import backup
import quick_add

app = FastAPI(title="Sage Database (SQLite Local-First Backup Node)")

# Every setting can come from the environment. On the Pi, systemd loads them
# from /etc/sage/sage.env (see deploy/). The defaults match how this server
# ran before, so an existing sage_sync.db keeps being used.
DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
GOOGLE_SHEETS_URL = os.getenv(
    "SAGE_GAS_URL",
    "https://script.google.com/macros/s/AKfycbzZAbFXHcDt9ZfVvH9iJCLyy8AghHhGhEwZZnB6P9RSO0zjvgMcDxojKCm1-VQ1MNrg/exec",
)
# The key Apps Script expects (its SAGE_AUTH_KEY script property). Without it
# the backup web app is open to anyone who finds its address.
GAS_AUTH_KEY = os.getenv("SAGE_GAS_AUTH_KEY", "").strip()
# How often queued changes are copied to Apps Script, in seconds.
GAS_BACKUP_INTERVAL = int(os.getenv("SAGE_GAS_BACKUP_INTERVAL", "300"))
# The shared key every client sends as "Authorization: Bearer <key>". LUMO
# reads the same value from the same file. Empty means no key check, which is
# only safe when the server is not reachable from outside the Pi.
API_SECRET = os.getenv("API_SECRET", "").strip()
# The built web app (npm run build). Served at / when it exists.
DIST_DIR = Path(os.getenv("SAGE_DIST_DIR", str(Path(__file__).resolve().parent.parent / "dist")))
CORS_ORIGINS = [o.strip() for o in os.getenv("SAGE_CORS_ORIGINS", "*").split(",") if o.strip()]
# The tables the web app and LUMO sync. Anything else is refused, so a bad
# client can't create stray tables that then show up in /api/sync/all.
SYNC_TABLES = {
    "workItems", "projects", "areas", "goals", "habits", "notes",
    "comments", "subtasks", "activities", "boards",
}
SYNC_OPERATIONS = {"save", "patch", "delete"}
LEDGER_DAYS = 90

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def key_matches(candidate: Optional[str]) -> bool:
    return bool(candidate) and hmac.compare_digest(candidate.encode(), API_SECRET.encode())


def logged_in(request) -> bool:
    """A browser that typed the password (see access_gate.py) counts as
    holding the key, so the web app works on a new device without it."""
    return access_gate.enabled and access_gate.session_valid(request.cookies.get(access_gate.COOKIE_NAME))


def request_key(request) -> str:
    auth = request.headers.get("authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else request.headers.get("x-sage-key", "")


@app.middleware("http")
async def require_api_key(request, call_next):
    """
    Every /api/ route needs the key once API_SECRET is set. CORS preflights
    carry no headers, so they pass through, and /api/health stays open so
    install scripts and monitors can check the server is up.
    """
    path = request.url.path
    if (
        API_SECRET
        and path.startswith("/api/")
        and path != "/api/health"
        and request.method != "OPTIONS"
        and not logged_in(request)
    ):
        if not key_matches(request_key(request)):
            return JSONResponse({"success": False, "error": "Missing or wrong Sage API key"}, status_code=401)
    return await call_next(request)


# --- Password gate (see access_gate.py) ---
# Off until SAGE_ACCESS_PASSWORD_HASH is set. Then browsers need the login
# cookie from /login, and LUMO and scripts get through with the API key alone.
# The cookie also stands in for the key, so the password is all a browser needs.
# Icons stay public so the login page and home-screen installs can show them.
GATE_OPEN_PATHS = {
    "/login", "/logout", "/api/health",
    "/favicon.ico", "/favicon-32.png", "/apple-touch-icon.png",
    "/icon-192.png", "/icon-512.png", "/manifest.webmanifest",
    # The service worker that shows notifications. It holds no data, and
    # browsers fetch updates to it without always sending the login cookie.
    "/sw.js",
}


@app.middleware("http")
async def require_login(request, call_next):
    path = request.url.path
    if (
        not access_gate.enabled
        or request.method == "OPTIONS"
        or path in GATE_OPEN_PATHS
        or logged_in(request)
        or (API_SECRET and key_matches(request_key(request)))
    ):
        return await call_next(request)
    if path.startswith("/api/"):
        return JSONResponse({"success": False, "error": "Log in to Sage first"}, status_code=401)
    target = path + (f"?{request.url.query}" if request.url.query else "")
    return RedirectResponse(f"/login?next={quote(target)}", status_code=303)


@app.get("/login", include_in_schema=False)
def login_form(next: str = "/"):
    return HTMLResponse(access_gate.login_page(access_gate.safe_next(next)))


@app.post("/login", include_in_schema=False)
async def login(request: Request):
    form = parse_qs((await request.body()).decode(errors="replace"))
    password = (form.get("password") or [""])[0]
    next_path = access_gate.safe_next((form.get("next") or ["/"])[0])
    if not access_gate.enabled:
        return RedirectResponse(next_path, status_code=303)
    ip = access_gate.client_ip(request)
    # Each browser has its own id, so one device's wrong tries don't lock the others.
    device = request.cookies.get(access_gate.DEVICE_COOKIE, "")[:40]
    new_device = not device
    device = device or access_gate.new_device_id()

    def with_device(response):
        if new_device:
            response.set_cookie(access_gate.DEVICE_COOKIE, device, max_age=365 * 86400, httponly=True,
                                secure=access_gate.is_https(request), samesite="lax")
        return response

    wait = access_gate.locked_for(ip, device)
    if wait:
        minutes = max(1, round(wait / 60))
        page = access_gate.login_page(next_path, f"Too many wrong tries. Try again in {minutes} min.")
        return with_device(HTMLResponse(page, status_code=429))
    if not access_gate.verify_password(password):
        access_gate.record_failure(ip, device)
        print(f"Wrong Sage password from {ip}")
        return with_device(HTMLResponse(access_gate.login_page(next_path, "Wrong password."), status_code=401))
    access_gate.clear_failures(ip, device)
    response = with_device(RedirectResponse(next_path, status_code=303))
    response.set_cookie(
        access_gate.COOKIE_NAME,
        access_gate.new_session(),
        max_age=access_gate.SESSION_DAYS * 86400,
        httponly=True,
        secure=access_gate.is_https(request),
        samesite="lax",
    )
    return response


@app.get("/logout", include_in_schema=False)
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(access_gate.COOKIE_NAME)
    return response


# --- Live event stream (/ws) ---
# Clients connect, send {"type": "auth", "token": "<key>"} as the first frame,
# then receive one {"type": "SYNC_APPLIED", ...} message per applied batch so
# they can pull changes straight away instead of waiting for their next poll.
class EventHub:
    def __init__(self):
        self.sockets: set = set()

    async def broadcast(self, event: dict) -> None:
        message = json.dumps(event)
        for socket in list(self.sockets):
            try:
                await socket.send_text(message)
            except Exception:
                self.sockets.discard(socket)


events = EventHub()


@app.websocket("/ws")
async def event_stream(socket: WebSocket):
    await socket.accept()
    # Middleware doesn't see websockets, so the login cookie is checked here.
    # Without it, the auth frame's key is the only way in.
    if logged_in(socket):
        pass
    elif API_SECRET:
        try:
            first = json.loads(await asyncio.wait_for(socket.receive_text(), timeout=10))
        except Exception:
            await socket.close(code=4401)
            return
        if not (isinstance(first, dict) and first.get("type") == "auth" and key_matches(first.get("token"))):
            await socket.close(code=4401)
            return
    elif access_gate.enabled:
        await socket.close(code=4401)
        return
    events.sockets.add(socket)
    await socket.send_text(json.dumps({"type": "AUTH_OK"}))
    try:
        while True:
            await socket.receive_text()  # clients may ping; nothing else is expected
    except WebSocketDisconnect:
        pass
    finally:
        events.sockets.discard(socket)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Document Store Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entities (
            table_name TEXT,
            entity_id TEXT,
            revision INTEGER,
            payload TEXT,
            deleted INTEGER DEFAULT 0,
            PRIMARY KEY (table_name, entity_id)
        )
    ''')
    # Idempotency Ledger
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sync_operations (
            operation_id TEXT PRIMARY KEY,
            client_id TEXT,
            entity_type TEXT,
            entity_id TEXT,
            operation TEXT,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Metadata (Server Revision)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    
    # Unsynced Batches for Google Sheets Backup Queue
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS unsynced_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT
        )
    ''')
    
    # server_revision records which server revision last changed a row, so
    # /api/sync/changes can answer "what changed since revision N" correctly.
    # The per-entity `revision` is the client's version counter and runs on a
    # different scale, so comparing it with the server revision missed new
    # rows written by other clients.
    cursor.execute("PRAGMA table_info(entities)")
    if "server_revision" not in {row[1] for row in cursor.fetchall()}:
        cursor.execute("ALTER TABLE entities ADD COLUMN server_revision INTEGER")

    # Initialize Server Revision if not exists
    cursor.execute("INSERT OR IGNORE INTO metadata (key, value) VALUES ('serverRevision', '1')")
    # The op ledger only has to outlive retries; trim it so it doesn't grow forever.
    cursor.execute(f"DELETE FROM sync_operations WHERE processed_at < datetime('now', '-{LEDGER_DAYS} days')")
    conn.commit()
    conn.close()

init_db()

# --- Pydantic Models ---
class SyncOperation(BaseModel):
    operationId: str
    clientId: Optional[str] = ""
    entityType: str
    entityId: str
    operation: str  # 'save', 'patch', 'delete'
    revision: Optional[int] = 1
    payload: Optional[Dict[str, Any]] = None

class ProcessOperationsRequest(BaseModel):
    action: str = "processOperations"
    operations: List[SyncOperation]

# --- DB Helpers ---
def get_server_revision(cursor):
    cursor.execute("SELECT value FROM metadata WHERE key = 'serverRevision'")
    row = cursor.fetchone()
    return int(row[0]) if row else 1

def increment_server_revision(cursor):
    current = get_server_revision(cursor)
    next_rev = current + 1
    cursor.execute("UPDATE metadata SET value = ? WHERE key = 'serverRevision'", (str(next_rev),))
    return next_rev

# --- Periodic Backup Worker: Forward to Google Sheets ---
async def google_sheets_backup_worker():
    """
    Runs in the background. Every GAS_BACKUP_INTERVAL seconds, sends queued
    sync batches to Apps Script in order, stopping at the first failure so
    nothing is applied out of order.
    """
    while True:
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id, payload FROM unsynced_batches ORDER BY id ASC")
            rows = cursor.fetchall()

            if rows:
                print(f"Backing up {len(rows)} batches to Google Sheets...")
                # Apps Script answers every call with a 302 to
                # script.googleusercontent.com, where the JSON reply lives.
                async with httpx.AsyncClient(follow_redirects=True) as client:
                    for row_id, payload_str in rows:
                        resp = await client.post(
                            GOOGLE_SHEETS_URL,
                            params={"authKey": GAS_AUTH_KEY} if GAS_AUTH_KEY else None,
                            content=payload_str,
                            headers={"Content-Type": "text/plain;charset=utf-8"},
                            timeout=30.0
                        )
                        try:
                            reply = resp.json()
                            ok = resp.status_code == 200 and bool(reply.get('success'))
                        except ValueError:
                            reply, ok = {}, False
                        if not ok:
                            print(f"Google Sheets backup failed (HTTP {resp.status_code}): {resp.text[:200]}")
                            break
                        # A batch can succeed overall while some changes in it were
                        # refused. Say so rather than dropping them silently.
                        refused = [r for r in reply.get('results', []) if isinstance(r, dict) and r.get('status') == 'rejected']
                        if refused:
                            print(f"Google Sheets backup: {len(refused)} change(s) in batch {row_id} were rejected: {refused[:3]}")
                        cursor.execute("DELETE FROM unsynced_batches WHERE id = ?", (row_id,))
                        conn.commit()
            conn.close()
        except Exception as e:
            print(f"Backup worker error: {e}")

        await asyncio.sleep(GAS_BACKUP_INTERVAL)

@app.on_event("startup")
async def startup_event():
    if access_gate.enabled:
        print("Password gate is on: browsers must log in at /login.")
    if not API_SECRET:
        print("WARNING: API_SECRET is not set, so anyone who can reach this server can read and change your data.")
    asyncio.create_task(google_sheets_backup_worker())
    asyncio.create_task(notifier.scheduler())
    asyncio.create_task(backup.scheduler(lambda: datetime.datetime.now(notifier._tz(notifier.get_prefs()))))


@app.get("/api/health")
def health():
    return {"success": True, "auth": bool(API_SECRET), "passwordGate": access_gate.enabled, "webApp": (DIST_DIR / "index.html").is_file()}


# --- API Endpoints ---

def _rows_by_table(rows):
    out: Dict[str, list] = {}
    for table_name, payload_str in rows:
        out.setdefault(table_name, []).append(json.loads(payload_str))
    return out


def _deleted_ids(cursor, since: int = 0) -> Dict[str, list]:
    """Ids removed on the server after revision `since`, by table, so clients
    can drop their copies. Deleted rows stay in the table as markers."""
    cursor.execute(
        "SELECT table_name, entity_id FROM entities WHERE deleted = 1 AND COALESCE(server_revision, 0) > ?",
        (since,),
    )
    out: Dict[str, list] = {}
    for table_name, entity_id in cursor.fetchall():
        out.setdefault(table_name, []).append(entity_id)
    return out


@app.get("/api/sync/all")
def get_all_data():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    server_rev = get_server_revision(cursor)
    cursor.execute("SELECT table_name, payload FROM entities WHERE deleted = 0")
    data = _rows_by_table(cursor.fetchall())
    deleted = _deleted_ids(cursor)
    conn.close()
    return {
        "success": True,
        "schemaVersion": 5,
        "serverRevision": server_rev,
        "data": data,
        "deleted": deleted,
    }

@app.get("/api/sync/changes")
def get_changes_since(sinceRevision: int = 0):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    server_rev = get_server_revision(cursor)
    cursor.execute(
        "SELECT table_name, payload FROM entities WHERE COALESCE(server_revision, revision) > ? AND deleted = 0",
        (sinceRevision,),
    )
    changes = _rows_by_table(cursor.fetchall())
    deleted = _deleted_ids(cursor, sinceRevision)
    conn.close()
    return {
        "success": True,
        "sinceRevision": sinceRevision,
        "serverRevision": server_rev,
        "changes": changes,
        "deleted": deleted,
    }


def _parse_time(value) -> Optional[datetime.datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=datetime.timezone.utc)


def _is_older(incoming: Dict[str, Any], existing: Dict[str, Any]) -> bool:
    """True when the incoming copy was last edited before the one stored here,
    e.g. a device that was offline sending an edit made before a newer one
    from another device. Records without updatedAt are never treated as older."""
    new_time, old_time = _parse_time(incoming.get("updatedAt")), _parse_time(existing.get("updatedAt"))
    return bool(new_time and old_time and new_time < old_time)


@app.post("/api/sync/operations")
async def process_operations(request: Request):
    try:
        req_dict = json.loads(await request.body())
        req = ProcessOperationsRequest(**req_dict)
    except (ValueError, TypeError) as e:
        return JSONResponse({"success": False, "error": f"Bad sync request: {e}"}, status_code=400)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    op_results = []
    applied_ops = []
    new_server_rev = None

    def next_rev():
        # Only a batch that changes something moves the revision, so a retried
        # batch doesn't make every device pull again.
        nonlocal new_server_rev
        if new_server_rev is None:
            new_server_rev = increment_server_revision(cursor)
        return new_server_rev

    try:
        cursor.execute("BEGIN TRANSACTION")

        ids = [op.operationId for op in req.operations if op.operationId]
        processed_ops = set()
        if ids:
            marks = ",".join("?" * len(ids))
            cursor.execute(f"SELECT operation_id FROM sync_operations WHERE operation_id IN ({marks})", ids)
            processed_ops = {row[0] for row in cursor.fetchall()}

        # Operations are applied in the order sent, which is the order they were made.
        for op in req.operations:
            if not op.operationId:
                op_results.append({"operationId": "unknown", "status": "rejected", "reason": "Missing operationId"})
                continue
            if op.operationId in processed_ops:
                op_results.append({"operationId": op.operationId, "status": "applied", "idempotent": True})
                continue
            if op.entityType not in SYNC_TABLES:
                op_results.append({"operationId": op.operationId, "status": "rejected", "reason": f"Unknown table {op.entityType}"})
                continue
            if op.operation not in SYNC_OPERATIONS:
                op_results.append({"operationId": op.operationId, "status": "rejected", "reason": f"Unknown operation {op.operation}"})
                continue

            table = op.entityType
            cursor.execute(
                "SELECT payload, revision, deleted FROM entities WHERE table_name = ? AND entity_id = ?",
                (table, op.entityId),
            )
            existing = cursor.fetchone()
            result = {"operationId": op.operationId, "status": "applied"}

            if op.operation in ("save", "patch"):
                if existing and existing[2]:
                    # Deleted on another device: an edit made before that must not bring it back.
                    result = {"operationId": op.operationId, "status": "deleted", "reason": "Deleted on another device"}
                elif existing and _is_older(op.payload or {}, json.loads(existing[0])):
                    result = {
                        "operationId": op.operationId,
                        "status": "stale",
                        "reason": "A newer copy was saved from another device",
                        "currentRecord": json.loads(existing[0]),
                    }
                elif existing:
                    merged = {**json.loads(existing[0]), **(op.payload or {})}
                    merged["id"] = op.entityId
                    new_rev = max(op.revision or 1, existing[1] + 1)
                    merged["revision"] = new_rev
                    cursor.execute(
                        "UPDATE entities SET payload = ?, revision = ?, deleted = 0, server_revision = ? WHERE table_name = ? AND entity_id = ?",
                        (json.dumps(merged), new_rev, next_rev(), table, op.entityId),
                    )
                    result["entityRevision"] = new_rev
                else:
                    merged = {**(op.payload or {}), "id": op.entityId}
                    new_rev = op.revision or 1
                    merged["revision"] = new_rev
                    cursor.execute(
                        "INSERT INTO entities (table_name, entity_id, revision, payload, deleted, server_revision) VALUES (?, ?, ?, ?, 0, ?)",
                        (table, op.entityId, new_rev, json.dumps(merged), next_rev()),
                    )
                    result["entityRevision"] = new_rev
            else:
                # Keep a marker row (with the last copy, for recovery) so other
                # devices learn about the delete and stale edits can't revive it.
                if existing:
                    cursor.execute(
                        "UPDATE entities SET deleted = 1, server_revision = ? WHERE table_name = ? AND entity_id = ?",
                        (next_rev(), table, op.entityId),
                    )
                else:
                    cursor.execute(
                        "INSERT INTO entities (table_name, entity_id, revision, payload, deleted, server_revision) VALUES (?, ?, 1, ?, 1, ?)",
                        (table, op.entityId, json.dumps({"id": op.entityId}), next_rev()),
                    )

            op_results.append(result)
            processed_ops.add(op.operationId)
            # Stale and deleted outcomes are final answers too, so a retry gets the same one.
            cursor.execute(
                "INSERT INTO sync_operations (operation_id, client_id, entity_type, entity_id, operation) VALUES (?, ?, ?, ?, ?)",
                (op.operationId, op.clientId, op.entityType, op.entityId, op.operation),
            )
            if result["status"] == "applied":
                applied_ops.append(op)

        # Queue the applied changes for the Google Sheets backup.
        if applied_ops:
            cursor.execute(
                "INSERT INTO unsynced_batches (payload) VALUES (?)",
                (json.dumps({
                    "action": "processOperations",
                    "clientId": req_dict.get("clientId", ""),
                    "operations": [op.model_dump() for op in applied_ops],
                }),),
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    if applied_ops:
        await events.broadcast({
            "type": "SYNC_APPLIED",
            "serverRevision": new_server_rev,
            "changes": [
                {"entityType": op.entityType, "entityId": op.entityId, "operation": op.operation, "clientId": op.clientId}
                for op in applied_ops
            ],
        })

    return {
        "success": True,
        "serverRevision": new_server_rev if new_server_rev is not None else _current_revision(),
        "results": op_results,
    }


def _current_revision() -> int:
    conn = sqlite3.connect(DB_PATH)
    try:
        return get_server_revision(conn.cursor())
    finally:
        conn.close()


@app.post("/api/sync/clear")
async def clear_all(request: Request):
    # A stray call (a script, a retry, a curl in the wrong tab) must not wipe
    # everything, so the caller has to say so in words. Read by hand because
    # the browser sends text/plain to avoid a CORS preflight.
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        body = {}
    if not isinstance(body, dict) or body.get("confirm") != "DELETE":
        raise HTTPException(status_code=400, detail='Send {"confirm": "DELETE"} to clear all data.')
    try:
        saved = await asyncio.to_thread(backup.make_backup, "before-clear")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Couldn't save a backup first, so nothing was cleared: {e}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM entities")
    cursor.execute("DELETE FROM sync_operations")
    # The revision keeps counting up, so devices that were closed during the
    # clear still see everything saved after it.
    new_rev = increment_server_revision(cursor)
    cursor.execute("INSERT INTO unsynced_batches (payload) VALUES (?)", (json.dumps({"action": "clearAll"}),))
    conn.commit()
    conn.close()

    await events.broadcast({"type": "SYNC_CLEARED", "serverRevision": new_rev})
    return {"success": True, "serverRevision": new_rev, "message": "All database records wiped.", "backup": saved.name}


@app.get("/api/backup/status")
def backup_status():
    return {"success": True, **backup.status()}


@app.post("/api/backup/run")
async def backup_run():
    try:
        path = await asyncio.to_thread(backup.make_backup, "manual")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")
    return {"success": True, "file": path.name, **backup.status()}

# --- Quick-Add (Siri Shortcuts / Share Sheet / email capture) ---

class QuickAddRequest(BaseModel):
    text: str
    source: str = "api"  # api | email | siri | share-sheet


@app.post("/api/quick-add")
async def quick_add_endpoint(req: QuickAddRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    parsed = quick_add.parse_quick_add(text)
    entity_id = f"qa-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')}-{os.urandom(4).hex()}"
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    payload: Dict[str, Any] = {
        "id": entity_id,
        "title": parsed.title,
        "entityType": parsed.entity_type,
        "status": "todo",
        "isInbox": parsed.date is None,
        "isFocus": False,
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "revision": 1,
        "source": req.source,
    }
    if parsed.date:
        payload["dueDate"] = parsed.date
    if parsed.time:
        payload["dueTime"] = parsed.time
    if parsed.priority:
        payload["priority"] = parsed.priority
    if parsed.tags:
        payload["labels"] = parsed.tags
    if parsed.location:
        payload["location"] = parsed.location
    if parsed.repeat_rule:
        payload["repeatRule"] = parsed.repeat_rule
    if parsed.duration_minutes:
        payload["estimatedMinutes"] = parsed.duration_minutes

    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        next_rev = increment_server_revision(cursor)
        cursor.execute(
            "INSERT INTO entities (table_name, entity_id, revision, payload, deleted, server_revision) VALUES (?, ?, 1, ?, 0, ?)",
            ("workItems", entity_id, json.dumps(payload), next_rev),
        )
        cursor.execute(
            "INSERT INTO sync_operations (operation_id, client_id, entity_type, entity_id, operation) VALUES (?, ?, ?, ?, ?)",
            (f"quickadd-{entity_id}", req.source, "workItems", entity_id, "save"),
        )
        if GOOGLE_SHEETS_URL:
            cursor.execute(
                "INSERT INTO unsynced_batches (payload) VALUES (?)",
                (json.dumps({
                    "action": "processOperations",
                    "clientId": req.source,
                    "operations": [{
                        "operationId": f"quickadd-{entity_id}",
                        "clientId": req.source,
                        "entityType": "workItems",
                        "entityId": entity_id,
                        "operation": "save",
                        "revision": 1,
                        "payload": payload,
                    }],
                }),),
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    await events.broadcast({
        "type": "SYNC_APPLIED",
        "serverRevision": next_rev,
        "changes": [{"entityType": "workItems", "entityId": entity_id, "operation": "save", "clientId": req.source}],
    })

    return {"success": True, "item": payload, "parsed": parsed.to_dict()}


# --- Notification quick-actions ---
class ItemActionRequest(BaseModel):
    source: str = "notification"

@app.post("/api/items/{item_id}/done")
async def item_done(item_id: str, req: ItemActionRequest):
    """Mark an item done from a notification action button."""
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT payload FROM entities WHERE table_name = 'workItems' AND entity_id = ? AND deleted = 0",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        item = json.loads(row[0])
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        item["status"] = "done"
        item["completedAt"] = now_iso
        item["updatedAt"] = now_iso
        item["version"] = (item.get("version") or 1) + 1
        next_rev = increment_server_revision(cursor)
        cursor.execute(
            "UPDATE entities SET payload = ?, revision = revision + 1, server_revision = ? WHERE table_name = 'workItems' AND entity_id = ?",
            (json.dumps(item), next_rev, item_id),
        )
        cursor.execute(
            "INSERT INTO sync_operations (operation_id, client_id, entity_type, entity_id, operation) VALUES (?, ?, ?, ?, ?)",
            (f"notif-done-{item_id}-{next_rev}", req.source, "workItems", item_id, "save"),
        )
        conn.commit()
    finally:
        conn.close()
    await events.broadcast({"type": "SYNC_APPLIED", "serverRevision": next_rev})
    return {"ok": True, "id": item_id, "status": "done"}


@app.post("/api/items/{item_id}/snooze")
async def item_snooze(item_id: str, req: ItemActionRequest):
    """Snooze an item for 1 hour from a notification action button."""
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT payload FROM entities WHERE table_name = 'workItems' AND entity_id = ? AND deleted = 0",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        item = json.loads(row[0])
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        until = (now_utc + datetime.timedelta(hours=1)).isoformat()
        item["snoozedUntil"] = until
        item["snoozeCount"] = (item.get("snoozeCount") or 0) + 1
        item["updatedAt"] = now_utc.isoformat()
        item["version"] = (item.get("version") or 1) + 1
        next_rev = increment_server_revision(cursor)
        cursor.execute(
            "UPDATE entities SET payload = ?, revision = revision + 1, server_revision = ? WHERE table_name = 'workItems' AND entity_id = ?",
            (json.dumps(item), next_rev, item_id),
        )
        cursor.execute(
            "INSERT INTO sync_operations (operation_id, client_id, entity_type, entity_id, operation) VALUES (?, ?, ?, ?, ?)",
            (f"notif-snooze-{item_id}-{next_rev}", req.source, "workItems", item_id, "save"),
        )
        conn.commit()
    finally:
        conn.close()
    await events.broadcast({"type": "SYNC_APPLIED", "serverRevision": next_rev})
    return {"ok": True, "id": item_id, "snoozedUntil": until}


@app.post("/api/items/{item_id}/tomorrow")
async def item_tomorrow(item_id: str, req: ItemActionRequest):
    """Move an item to tomorrow from a notification action button."""
    import notifier as _notifier
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT payload FROM entities WHERE table_name = 'workItems' AND entity_id = ? AND deleted = 0",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        item = json.loads(row[0])
        prefs = _notifier.get_prefs()
        tz = _notifier._tz(prefs)
        now = datetime.datetime.now(datetime.timezone.utc).astimezone(tz)
        tomorrow = (now.date() + datetime.timedelta(days=1)).isoformat()
        item["dueDate"] = tomorrow
        item["snoozedUntil"] = None
        item["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        item["version"] = (item.get("version") or 1) + 1
        next_rev = increment_server_revision(cursor)
        cursor.execute(
            "UPDATE entities SET payload = ?, revision = revision + 1, server_revision = ? WHERE table_name = 'workItems' AND entity_id = ?",
            (json.dumps(item), next_rev, item_id),
        )
        cursor.execute(
            "INSERT INTO sync_operations (operation_id, client_id, entity_type, entity_id, operation) VALUES (?, ?, ?, ?, ?)",
            (f"notif-tomorrow-{item_id}-{next_rev}", req.source, "workItems", item_id, "save"),
        )
        conn.commit()
    finally:
        conn.close()
    await events.broadcast({"type": "SYNC_APPLIED", "serverRevision": next_rev})
    return {"ok": True, "id": item_id, "dueDate": tomorrow}


import re
import ollama

MODEL_NAME = "qwen2.5:1.5b"

# --- AI Models ---
class TaskParseRequest(BaseModel):
    natural_language: str

class DailyBriefingRequest(BaseModel):
    tasks_json: str

# --- Helper to guarantee hallucination-proof parsing ---
def safe_parse_json(raw_text: str):
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    elif text.startswith("`"):
        text = re.sub(r"^`(?:json)?\s*", "", text)
        text = re.sub(r"\s*`$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1:
            return json.loads(text[start:end+1])
        start_arr = text.find('[')
        end_arr = text.rfind(']')
        if start_arr != -1 and end_arr != -1:
            return json.loads(text[start_arr:end_arr+1])
        raise ValueError("Failed to extract valid JSON from AI output.")

# --- AI Endpoints ---
@app.post("/api/parse-task")
def parse_task(req: TaskParseRequest):
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    prompt = f"""
    You are a strict data extraction AI. Extract distinct actionable tasks from the user's brain-dump input.
    Today's date is {today}.
    Respond ONLY with a raw JSON array containing task objects matching this exact structure:
    [
        {{
            "title": "Clear actionable task title",
            "dueDate": "YYYY-MM-DD or null if no date specified",
            "priority": "low" | "medium" | "high" | "urgent",
            "estimatedMinutes": 30,
            "isInbox": true
        }}
    ]
    If the user enters multiple tasks, separate them into multiple objects in the array.
    User Input: {req.natural_language}
    """
    try:
        response = ollama.generate(
            model=MODEL_NAME, prompt=prompt, format='json', options={"temperature": 0.0}
        )
        parsed_data = safe_parse_json(response['response'])
        return {"success": True, "data": parsed_data}
    except Exception as e:
        print(f"Error parsing task: {e}")
        raise HTTPException(status_code=500, detail="AI failed to parse task reliably")

@app.post("/api/daily-briefing")
def daily_briefing(req: DailyBriefingRequest):
    prompt = f"""
    You are a strategic assistant. Review the following tasks for today.
    Tasks: 
    {req.tasks_json}
    Calculate the total estimated minutes, identify the bottleneck task, and write a 2-sentence motivational strategy.
    Respond ONLY with a raw JSON dictionary matching this exact structure:
    {{
        "strategyText": "Your 2 sentence strategy...",
        "totalFocusMinutes": 60,
        "bottleneckTaskTitle": "Title of the hardest task",
        "recommendedOrder": ["task_id_a", "task_id_b"]
    }}
    """
    try:
        response = ollama.generate(
            model=MODEL_NAME, prompt=prompt, format='json', options={"temperature": 0.25}
        )
        parsed_data = safe_parse_json(response['response'])
        return {"success": True, "data": parsed_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail="AI failed to generate briefing")

# --- Canvas thinking partner (see canvas_thinker.py) ---
import canvas_thinker

@app.get("/api/canvas/think")
def canvas_think_status():
    return {"success": True, "engine": canvas_thinker.engine()}

class GroqKeyRequest(BaseModel):
    key: str = ""

@app.get("/api/settings/groq-key")
def groq_key_status():
    return {"success": True, **canvas_thinker.groq_key_status()}

@app.post("/api/settings/groq-key")
def save_groq_key(req: GroqKeyRequest):
    key = req.key.strip()
    if key:
        # Check it with Groq first, so a typo shows up here, not on the canvas.
        try:
            res = httpx.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=15)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Couldn't reach Groq to check the key: {e}")
        if res.status_code == 401:
            raise HTTPException(status_code=400, detail="Groq says this key isn't valid.")
    canvas_thinker.save_groq_key(key)
    return {"success": True, **canvas_thinker.groq_key_status()}

@app.post("/api/canvas/think")
def canvas_think(req: canvas_thinker.CanvasThinkRequest):
    try:
        return {"success": True, **canvas_thinker.think(req)}
    except Exception as e:
        print(f"Canvas thinker failed: {e}")
        raise HTTPException(status_code=502, detail=f"The thinking partner couldn't answer: {e}")

# --- Public link (see public_link.py) ---
import public_link

@app.get("/api/public-url")
def public_url():
    return {"success": True, **public_link.find()}

# --- Notifications (see notifier.py) ---
import notifier
notifier.init_tables()


def _notification_config() -> dict:
    prefs = notifier.get_prefs()
    return {
        "success": True,
        "pushAvailable": notifier.push_available(),
        "vapidPublicKey": notifier.vapid_public_key(),
        "prefs": prefs,
        "devices": [{"label": d["label"], "endpoint": d["endpoint"], "lastSuccessAt": d["lastSuccessAt"]} for d in notifier.list_devices()],
        "emailPasswordSet": bool(notifier.smtp_password()),
        "emailReady": notifier.email_ready(prefs),
    }


@app.get("/api/notifications")
def notification_config():
    return _notification_config()


class PushSubscribeRequest(BaseModel):
    subscription: Dict[str, Any]
    label: str = "This device"
    timezone: Optional[str] = None


@app.post("/api/notifications/subscribe")
def push_subscribe(req: PushSubscribeRequest):
    try:
        notifier.save_subscription(req.subscription, req.label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if req.timezone and not notifier.get_prefs()["timezoneChosen"]:
        try:
            # Adopted once, from the first device; changing it later is done in Settings.
            notifier.save_prefs({"timezone": req.timezone, "timezoneChosen": True})
        except ValueError as e:
            # Keep the device either way; times stay in the last good timezone.
            print(f"Ignoring the timezone this device sent: {e}")
    return _notification_config()


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


@app.post("/api/notifications/unsubscribe")
def push_unsubscribe(req: PushUnsubscribeRequest):
    notifier.remove_subscription(req.endpoint)
    return _notification_config()


@app.put("/api/notifications/prefs")
def update_notification_prefs(update: Dict[str, Any]):
    try:
        notifier.save_prefs(update)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _notification_config()


class EmailPasswordRequest(BaseModel):
    password: str = ""


@app.post("/api/notifications/email-password")
def save_email_password(req: EmailPasswordRequest):
    notifier.save_smtp_password(req.password)
    return _notification_config()


def _email_capture_config() -> dict:
    prefs = notifier.get_prefs()
    cap = prefs.get("emailCapture", {})
    return {
        "success": True,
        "emailCapture": cap,
        # Its own password, as opposed to the notification email's one it
        # falls back to (usesEmailPassword).
        "imapPasswordSet": bool(notifier.own_imap_password()),
        "usesEmailPassword": not notifier.own_imap_password() and bool(notifier.smtp_password()),
        "emailAccount": prefs.get("email", {}).get("smtpUser", ""),
        "mailbox": notifier.imap_user(prefs),
        "emailCaptureReady": notifier.email_capture_ready(prefs),
    }


@app.get("/api/email-capture")
def email_capture_config():
    return _email_capture_config()


class ImapPasswordRequest(BaseModel):
    password: str = ""


@app.post("/api/email-capture/password")
def save_imap_password(req: ImapPasswordRequest):
    notifier.save_imap_password(req.password)
    return _email_capture_config()


@app.put("/api/email-capture/prefs")
def update_email_capture_prefs(update: Dict[str, Any]):
    try:
        notifier.save_prefs({"emailCapture": update})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _email_capture_config()


@app.post("/api/email-capture/test")
async def test_email_capture():
    prefs = notifier.get_prefs()
    if not notifier.email_capture_ready(prefs):
        raise HTTPException(status_code=400, detail="Email capture is not set up yet. Turn it on and make sure there is an email password (the notification one is used by default).")
    try:
        items = await asyncio.to_thread(notifier.check_email_inbox, prefs)
        if items:
            rev = await asyncio.to_thread(notifier.insert_captured_items, items)
            if rev:
                await events.broadcast({
                    "type": "SYNC_APPLIED",
                    "serverRevision": rev,
                    "changes": [
                        {"entityType": "workItems", "entityId": item["id"], "operation": "save", "clientId": "email-capture"}
                        for item in items
                    ],
                })
        return {"success": True, "captured": len(items), "items": [{"title": i["title"]} for i in items]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IMAP check failed: {e}")


class NotificationTestRequest(BaseModel):
    channel: str = "push"  # "push" or "email"
    endpoint: Optional[str] = None


@app.post("/api/notifications/test")
async def test_notification(req: NotificationTestRequest):
    prefs = notifier.get_prefs()
    if req.channel == "email":
        if not (prefs["email"]["to"] and notifier.smtp_password()):
            raise HTTPException(status_code=400, detail="Add the address and app password first.")
        intro = "Email from Sage works. Your morning plan will arrive like this."
        try:
            await asyncio.to_thread(
                notifier.send_email, prefs, "Sage test email",
                notifier.email_text("You're all set", intro, [], ""), notifier.email_html("You're all set", intro, [], ""),
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Couldn't send: {e}")
        return {"success": True}
    message = {"title": "Sage notifications are on", "body": "Reminders and your morning plan will show up here.", "tag": "test", "url": "/", "urgency": "high", "ttl": 600}
    results = await asyncio.to_thread(notifier.send_push, message, req.endpoint, prefs)
    if not results:
        raise HTTPException(status_code=400, detail="No device has notifications turned on yet.")
    return {"success": any(r["ok"] for r in results), "results": results}


# --- Web app ---
# Mounted last so every /api route above wins over a same-named file.
if (DIST_DIR / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="web")
else:
    print(f"No built web app at {DIST_DIR}; run `npm run build` in the repo root to serve it here.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("SAGE_BIND", "127.0.0.1"), port=8000)

