import os
import json
import asyncio
import secrets

import aiosqlite
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from . import config
from .config import ENV, ALLOWED_ORIGINS
from .auth import verify_auth_token, assert_api_secret_configured

from .database import init_database, DB_PATH, db_pool
from .routers import items, finance, dashboard, ai, shortcuts, push, weather, planner, whiteboards
from .services.ws_manager import ws_manager
from .services.push_service import check_due_reminders
from .services.backlog_service import process_backlog_items
from .version import VERSION, BUILD_NAME

scheduler = AsyncIOScheduler()

async def run_backlog_worker(db_path: str, ws_mgr):
    """Periodic job to process backlog items. Deferral check for fan noise happens inside process_backlog_items."""
    try:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            await process_backlog_items(db, max_items=20, force=False, ws_broadcast=ws_mgr.broadcast)
    except Exception as e:
        print(f"Error in backlog worker: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Enforce API_SECRET presence on startup
    assert_api_secret_configured()

    # Startup: Initialize SQLite schema, indexes, and connection pool
    await init_database()
    await db_pool.init()
    
    # Start periodic reminder worker (runs every 60 seconds)
    scheduler.add_job(
        check_due_reminders,
        "interval",
        seconds=60,
        args=[DB_PATH, ws_manager],
        id="reminder_worker"
    )
    # Start periodic backlog description worker (runs every 15 minutes, active 01:30 AM or when Home Mode is off)
    scheduler.add_job(
        run_backlog_worker,
        "interval",
        minutes=15,
        args=[DB_PATH, ws_manager],
        id="backlog_description_worker"
    )
    scheduler.start()
    print("Database connection pool initialized and background scheduler started.")
    
    yield
    
    # Shutdown
    scheduler.shutdown()
    await db_pool.close()
    print("Scheduler & database pool shutdown gracefully.")

app = FastAPI(
    title="Sage Life & Task Operating System",
    description="Unified Task, Event, Milestone, and Finance Manager for Raspberry Pi 5 with iOS & PC optimization",
    version=VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)

# Mount Routers with shared-secret bearer token authentication
auth_dep = [Depends(verify_auth_token)]
app.include_router(items.router, dependencies=auth_dep)
app.include_router(finance.router, dependencies=auth_dep)
app.include_router(dashboard.router, dependencies=auth_dep)
app.include_router(ai.router, dependencies=auth_dep)
app.include_router(weather.router, dependencies=auth_dep)
app.include_router(shortcuts.router, dependencies=auth_dep)
app.include_router(push.router, dependencies=auth_dep)
app.include_router(planner.router, dependencies=auth_dep)
app.include_router(whiteboards.router, dependencies=auth_dep)

# How long a freshly opened socket has to prove itself before it is dropped.
WS_AUTH_TIMEOUT_SECONDS = 10.0


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Live sync, authenticated by a first message rather than a query parameter.

    The token used to travel as `/ws?token=...`. A query string is written to
    nginx's access log and to every proxy along the way, so the one secret that
    guards this data ended up in plain text in places nobody thinks to scrub.
    The socket is accepted first now, and the client's first frame must be
    {"type": "auth", "token": "..."}; anything else, or nothing at all within
    a few seconds, and the connection closes without ever joining the pool.
    """
    await websocket.accept()

    try:
        raw = await asyncio.wait_for(
            websocket.receive_text(), timeout=WS_AUTH_TIMEOUT_SECONDS
        )
    except Exception:
        # Timed out, disconnected, or never said anything intelligible.
        try:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        except Exception:
            pass
        return

    token = ""
    try:
        message = json.loads(raw)
        if isinstance(message, dict) and message.get("type") == "auth":
            token = str(message.get("token") or "")
    except (ValueError, TypeError):
        token = ""

    # Read through the module rather than a copy bound at import time, so the
    # socket always checks against the secret in force now.
    expected = config.API_SECRET
    if not (expected and token and secrets.compare_digest(token, expected)):
        try:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        except Exception:
            pass
        return

    # Authenticated: only now does it start receiving broadcasts.
    ws_manager.register(websocket)
    try:
        await websocket.send_text(json.dumps({"type": "AUTH_OK"}))

        while True:
            # Keep-alive ping/pong
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "version": VERSION,
        "build": BUILD_NAME,
        "system": "Raspberry Pi 5 Ready",
        "service": "Sage Life OS Backend",
        "storage": "SQLite WAL Mode Active"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=(ENV == "development"))
