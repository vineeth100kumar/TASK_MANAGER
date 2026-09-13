import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .database import init_database, DB_PATH, db_pool
from .routers import items, finance, dashboard, ai, shortcuts, push, weather
from .services.ws_manager import ws_manager
from .services.push_service import check_due_reminders

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
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
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)

# Mount Routers
app.include_router(items.router)
app.include_router(finance.router)
app.include_router(dashboard.router)
app.include_router(ai.router)
app.include_router(weather.router)
app.include_router(shortcuts.router)
app.include_router(push.router)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
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
        "system": "Raspberry Pi 5 Ready",
        "service": "Sage Life OS Backend",
        "storage": "SQLite WAL Mode Active"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
