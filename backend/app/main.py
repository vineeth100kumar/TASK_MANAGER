import os
import asyncio
import secrets
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .config import API_SECRET, ENV, ALLOWED_ORIGINS
from .auth import verify_auth_token, assert_api_secret_configured
from .database import init_database, DB_PATH, db_pool
from .routers import items, finance, dashboard, ai, shortcuts, push, weather, planner, whiteboards
from .services.ws_manager import ws_manager
from .services.push_service import check_due_reminders
from .version import VERSION, BUILD_NAME

scheduler = AsyncIOScheduler()

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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    if API_SECRET:
        if not token or not secrets.compare_digest(token, API_SECRET):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await ws_manager.connect(websocket)
    try:
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
