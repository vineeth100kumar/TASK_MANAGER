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

app = FastAPI(title="Sage Database (SQLite Local-First Backup Node)")

# Every setting can come from the environment. On the Pi, systemd loads them
# from /etc/sage/sage.env (see deploy/). The defaults match how this server
# ran before, so an existing sage_sync.db keeps being used.
DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
GOOGLE_SHEETS_URL = os.getenv(
    "SAGE_GAS_URL",
    "https://script.google.com/macros/s/AKfycbzZAbFXHcDt9ZfVvH9iJCLyy8AghHhGhEwZZnB6P9RSO0zjvgMcDxojKCm1-VQ1MNrg/exec",
)
# How often queued changes are copied to Apps Script, in seconds.
GAS_BACKUP_INTERVAL = int(os.getenv("SAGE_GAS_BACKUP_INTERVAL", "300"))
# The shared key every client sends as "Authorization: Bearer <key>". LUMO
# reads the same value from the same file. Empty means no key check, which is
# only safe when the server is not reachable from outside the Pi.
API_SECRET = os.getenv("API_SECRET", "").strip()
# The built web app (npm run build). Served at / when it exists.
DIST_DIR = Path(os.getenv("SAGE_DIST_DIR", str(Path(__file__).resolve().parent.parent / "dist")))
CORS_ORIGINS = [o.strip() for o in os.getenv("SAGE_CORS_ORIGINS", "*").split(",") if o.strip()]

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
    wait = access_gate.locked_for(ip)
    if wait:
        minutes = max(1, round(wait / 60))
        page = access_gate.login_page(next_path, f"Too many wrong tries. Try again in {minutes} min.")
        return HTMLResponse(page, status_code=429)
    if not access_gate.verify_password(password):
        access_gate.record_failure(ip)
        print(f"Wrong Sage password from {ip}")
        return HTMLResponse(access_gate.login_page(next_path, "Wrong password."), status_code=401)
    access_gate.clear_failures(ip)
    response = RedirectResponse(next_path, status_code=303)
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
                            content=payload_str,
                            headers={"Content-Type": "text/plain;charset=utf-8"},
                            timeout=30.0
                        )
                        try:
                            ok = resp.status_code == 200 and resp.json().get('success')
                        except ValueError:
                            ok = False
                        if not ok:
                            print(f"Google Sheets backup failed (HTTP {resp.status_code}): {resp.text[:200]}")
                            break
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


@app.get("/api/health")
def health():
    return {"success": True, "auth": bool(API_SECRET), "passwordGate": access_gate.enabled, "webApp": (DIST_DIR / "index.html").is_file()}


# --- API Endpoints ---

@app.get("/api/sync/all")
def get_all_data():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    server_rev = get_server_revision(cursor)
    
    cursor.execute("SELECT table_name, payload FROM entities WHERE deleted = 0")
    rows = cursor.fetchall()
    
    data = {}
    for table_name, payload_str in rows:
        if table_name not in data:
            data[table_name] = []
        data[table_name].append(json.loads(payload_str))
        
    conn.close()
    return {
        "success": True,
        "schemaVersion": 5,
        "serverRevision": server_rev,
        "data": data
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
    rows = cursor.fetchall()
    
    changes = {}
    for table_name, payload_str in rows:
        if table_name not in changes:
            changes[table_name] = []
        changes[table_name].append(json.loads(payload_str))
        
    conn.close()
    return {
        "success": True,
        "sinceRevision": sinceRevision,
        "serverRevision": server_rev,
        "changes": changes
    }

@app.post("/api/sync/operations")
async def process_operations(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    req_dict = json.loads(body)
    req = ProcessOperationsRequest(**req_dict)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    op_results = []
    
    try:
        cursor.execute("BEGIN TRANSACTION")
        
        # Get all previously processed operations for idempotency
        cursor.execute("SELECT operation_id FROM sync_operations")
        processed_ops = {row[0] for row in cursor.fetchall()}
        
        new_server_rev = increment_server_revision(cursor)
        
        for op in req.operations:
            if not op.operationId:
                op_results.append({"operationId": "unknown", "status": "rejected", "reason": "Missing operationId"})
                continue
                
            if op.operationId in processed_ops:
                op_results.append({"operationId": op.operationId, "status": "applied", "idempotent": True})
                continue
                
            table = op.entityType
            
            if op.operation in ['save', 'patch']:
                cursor.execute("SELECT payload, revision FROM entities WHERE table_name = ? AND entity_id = ?", (table, op.entityId))
                existing = cursor.fetchone()
                
                if existing:
                    existing_payload = json.loads(existing[0])
                    existing_rev = existing[1]
                    # Field level merge
                    merged = {**existing_payload, **(op.payload or {})}
                    new_rev = max(op.revision or 1, existing_rev + 1)
                    merged['revision'] = new_rev
                    
                    cursor.execute('''
                        UPDATE entities 
                        SET payload = ?, revision = ?, deleted = 0, server_revision = ?
                        WHERE table_name = ? AND entity_id = ?
                    ''', (json.dumps(merged), new_rev, new_server_rev, table, op.entityId))
                else:
                    merged = op.payload or {}
                    new_rev = op.revision or 1
                    merged['revision'] = new_rev
                    cursor.execute('''
                        INSERT INTO entities (table_name, entity_id, revision, payload, deleted, server_revision) 
                        VALUES (?, ?, ?, ?, 0, ?)
                    ''', (table, op.entityId, new_rev, json.dumps(merged), new_server_rev))
                
                op_results.append({"operationId": op.operationId, "status": "applied", "entityRevision": new_rev})
                
            elif op.operation == 'delete':
                cursor.execute("DELETE FROM entities WHERE table_name = ? AND entity_id = ?", (table, op.entityId))
                op_results.append({"operationId": op.operationId, "status": "applied"})
            
            # Log operation
            cursor.execute('''
                INSERT INTO sync_operations (operation_id, client_id, entity_type, entity_id, operation)
                VALUES (?, ?, ?, ?, ?)
            ''', (op.operationId, op.clientId, op.entityType, op.entityId, op.operation))
            
        # Queue the backup to Google Sheets for the periodic worker
        cursor.execute("INSERT INTO unsynced_batches (payload) VALUES (?)", (json.dumps(req_dict),))
        conn.commit()
        
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    results_by_id = {r["operationId"]: r for r in op_results}
    applied = [
        {"entityType": op.entityType, "entityId": op.entityId, "operation": op.operation, "clientId": op.clientId}
        for op in req.operations
        if results_by_id.get(op.operationId, {}).get("status") == "applied"
        and not results_by_id[op.operationId].get("idempotent")
    ]
    if applied:
        await events.broadcast({"type": "SYNC_APPLIED", "serverRevision": new_server_rev, "changes": applied})

    return {
        "success": True,
        "serverRevision": new_server_rev,
        "results": op_results
    }

@app.post("/api/sync/clear")
async def clear_all(background_tasks: BackgroundTasks):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM entities")
    cursor.execute("DELETE FROM sync_operations")
    cursor.execute("UPDATE metadata SET value = '1' WHERE key = 'serverRevision'")
    cursor.execute("INSERT INTO unsynced_batches (payload) VALUES (?)", (json.dumps({"action": "clearAll"}),))
    conn.commit()
    conn.close()

    await events.broadcast({"type": "SYNC_CLEARED", "serverRevision": 1})
    return {"success": True, "serverRevision": 1, "message": "All database records wiped."}

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

# --- Web app ---
# Mounted last so every /api route above wins over a same-named file.
if (DIST_DIR / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="web")
else:
    print(f"No built web app at {DIST_DIR}; run `npm run build` in the repo root to serve it here.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

