import json
import os
import hmac
import sqlite3
import datetime
import asyncio
from pathlib import Path
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

app = FastAPI(title="Sage Database (SQLite Local-First Backup Node)")

# Every setting can come from the environment. On the Pi, systemd loads them
# from /etc/sage/sage.env (see deploy/). The defaults match how this server
# ran before, so an existing sage_sync.db keeps being used.
DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
GOOGLE_SHEETS_URL = os.getenv(
    "SAGE_GAS_URL",
    "https://script.google.com/macros/s/AKfycbzZAbFXHcDt9ZfVvH9iJCLyy8AghHhGhEwZZnB6P9RSO0zjvgMcDxojKCm1-VQ1MNrg/exec",
)
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
    ):
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else request.headers.get("x-sage-key", "")
        if not key_matches(token):
            return JSONResponse({"success": False, "error": "Missing or wrong Sage API key"}, status_code=401)
    return await call_next(request)


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
    if API_SECRET:
        try:
            first = json.loads(await asyncio.wait_for(socket.receive_text(), timeout=10))
        except Exception:
            await socket.close(code=4401)
            return
        if not (isinstance(first, dict) and first.get("type") == "auth" and key_matches(first.get("token"))):
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
    Runs continuously in the background. Wakes up every 4 hours, reads all 
    unsynced operations from the queue, and batches them to Google Sheets.
    """
    while True:
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id, payload FROM unsynced_batches ORDER BY id ASC LIMIT 50")
            rows = cursor.fetchall()
            
            if rows:
                print(f"Found {len(rows)} batches to backup to Google Sheets...")
                for row_id, payload_str in rows:
                    payload = json.loads(payload_str)
                    async with httpx.AsyncClient() as client:
                        resp = await client.post(
                            GOOGLE_SHEETS_URL,
                            json=payload,
                            headers={"Content-Type": "text/plain;charset=utf-8"},
                            timeout=30.0
                        )
                        if resp.status_code == 200 and resp.json().get('success'):
                            cursor.execute("DELETE FROM unsynced_batches WHERE id = ?", (row_id,))
                            conn.commit()
                        else:
                            print(f"Google Sheets backup failed. Will retry later.")
                            break # stop processing this run, try again in 4 hours
            conn.close()
        except Exception as e:
            print(f"Backup worker error: {e}")
            
        await asyncio.sleep(4 * 3600)  # Sleep for 4 hours

@app.on_event("startup")
async def startup_event():
    if not API_SECRET:
        print("WARNING: API_SECRET is not set, so anyone who can reach this server can read and change your data.")
    asyncio.create_task(google_sheets_backup_worker())


@app.get("/api/health")
def health():
    return {"success": True, "auth": bool(API_SECRET), "webApp": (DIST_DIR / "index.html").is_file()}


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

from fastapi import Request

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

class ProjectBreakdownRequest(BaseModel):
    goal: str
    context: Optional[str] = ""

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

@app.post("/api/breakdown-project")
def breakdown_project(req: ProjectBreakdownRequest):
    prompt = f"""
    You are an expert project manager. Break down the following goal into logical sequential tasks.
    Goal: {req.goal}
    Context: {req.context}
    Respond ONLY with a raw JSON dictionary matching this exact structure:
    {{
        "projectTitle": "Name of the project",
        "tasks": [
            {{ "id": "task_1", "title": "Step 1...", "dependsOn": [] }},
            {{ "id": "task_2", "title": "Step 2...", "dependsOn": ["task_1"] }}
        ]
    }}
    Keep the breakdown to 3-7 high-impact tasks. Ensure dependencies are logical.
    """
    try:
        response = ollama.generate(
            model=MODEL_NAME, prompt=prompt, format='json', options={"temperature": 0.15}
        )
        parsed_data = safe_parse_json(response['response'])
        return {"success": True, "data": parsed_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail="AI failed to generate breakdown reliably")

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

# --- Web app ---
# Mounted last so every /api route above wins over a same-named file.
if (DIST_DIR / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="web")
else:
    print(f"No built web app at {DIST_DIR}; run `npm run build` in the repo root to serve it here.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

