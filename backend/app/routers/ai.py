import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Query
from typing import Optional, List, Dict, Any

from ..services.ai_engine import (
    generate_greeting, parse_brain_dump, auto_fill_task_details,
    improve_task_data, organize_board_data, generate_project_description
)
from ..services.ai_runtime import status as ai_runtime_status
from ..services.capture_service import (
    claim_capture, commit_capture, read_capture, release_capture, remember_capture,
)
from ..services.weather_service import get_current_weather
from ..services.ws_manager import ws_manager
from ..services.backlog_service import (
    get_backlog_stats, set_home_mode, process_backlog_items
)
from ..config import DEFAULT_LAT, DEFAULT_LON, DEFAULT_USER_NAME
from ..database import get_db
import aiosqlite

router = APIRouter(prefix="/api/v1/ai", tags=["Local AI Intelligence"])

class BrainDumpRequest(BaseModel):
    natural_language: str

class AutoFillRequest(BaseModel):
    title: str
    context: Optional[str] = None
    project_id: Optional[str] = None

class ImproveTaskRequest(BaseModel):
    title: str
    context: Optional[str] = None
    entity_type: Optional[str] = "task"
    project_id: Optional[str] = None

class ProjectDescriptionRequest(BaseModel):
    name: str
    project_id: Optional[str] = None
    context: Optional[str] = None

class HomeModeRequest(BaseModel):
    home_mode: bool

class ProcessBacklogRequest(BaseModel):
    max_items: Optional[int] = 50
    force: Optional[bool] = False

class OrganizeBoardRequest(BaseModel):
    tasks: Optional[List[Dict[str, Any]]] = None

class CaptureRequest(BaseModel):
    text: str
    # False returns what was understood without writing anything, which is what
    # the capture bar calls while the user is still typing.
    commit: bool = True
    # Let the local Ollama model do the reading. Turn it off for the
    # keystroke-by-keystroke hints, where the answer has to be instant, or when
    # the Pi is busy: the deterministic parser answers on its own in under a
    # millisecond.
    use_ai: bool = True
    log_expenses: bool = True
    # The client's id for this capture, the same across every retry of it. A
    # capture that arrives twice under one id is answered with what the first
    # one created rather than creating it again.
    request_id: Optional[str] = None

@router.get("/greeting")
async def get_greeting(
    name: str = DEFAULT_USER_NAME,
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
    db: aiosqlite.Connection = Depends(get_db)
):

    """Fetches live weather and task stats to synthesize a personalized AI greeting."""
    weather = await get_current_weather(lat, lon)
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")

    # Get task stats
    urgent_count = 0
    completed_count = 0
    planned_count = 0

    async with db.execute("SELECT is_completed, priority FROM work_items WHERE due_date = ?", (today_str,)) as cursor:
        rows = await cursor.fetchall()
        for r in rows:
            planned_count += 1
            if r["is_completed"]:
                completed_count += 1
            elif r["priority"] == "urgent":
                urgent_count += 1

    greeting_text = await generate_greeting(
        username=name,
        weather_condition=weather.get("condition", "Clear"),
        temperature=weather.get("temperature", 25.0),
        urgent_task_count=urgent_count,
        today_completed_count=completed_count,
        total_planned_count=planned_count
    )

    return {
        "greeting": greeting_text,
        "weather": weather,
        "stats": {
            "planned": planned_count,
            "completed": completed_count,
            "urgent": urgent_count
        }
    }

@router.get("/status")
async def ai_status():
    """
    Whether the Pi is currently running the model, and how long it usually takes.

    The WebSocket announces starts and stops, but only to clients that were
    already connected. A phone waking up mid-capture reads this instead, so it
    can show that the Pi is thinking rather than that something is wrong.
    """
    return ai_runtime_status()

@router.post("/capture")
async def capture(req: CaptureRequest, db: aiosqlite.Connection = Depends(get_db)):
    """
    Understand a line of ordinary writing and act on it.

    "going out with cousins at 7.30pm so leave office by 6.30pm" becomes an
    event at 19:30 and a reminder at 18:30. The local Ollama model reads the
    note; its dates, times and amounts are checked against a deterministic
    parse of the same words before anything is written, and if Ollama is down
    that parse answers on its own. With commit=false nothing is written, so the
    same call drives the live hints under the capture bar.
    """
    text = (req.text or "").strip()
    if not text:
        return {"success": False, "committed": False, "items": [], "detail": "Nothing to capture"}

    if not req.commit:
        items = await read_capture(db, text, use_ai=req.use_ai)
        return {"success": True, "committed": False, "items": [i.to_dict() for i in items]}

    # Everything below writes rows, so it happens at most once per request_id.
    request_id = (req.request_id or "").strip()[:64]
    if request_id:
        mine, previous = await claim_capture(db, request_id)
        if not mine:
            if previous is not None:
                return {**previous, "duplicate": True}
            return {
                "success": True,
                "committed": False,
                "duplicate": True,
                "items": [],
                "detail": "That capture is already being handled",
            }

    try:
        items = await read_capture(db, text, use_ai=req.use_ai)
        result = await commit_capture(db, text, log_expenses=req.log_expenses, items=items)
    except Exception:
        # The claim must not outlive a failed attempt, or the retry that would
        # have worked is told the capture is already handled.
        if request_id:
            await release_capture(db, request_id)
        raise

    response = {
        "success": bool(result["created"]),
        "committed": True,
        "items": result["created"],
        "transactions": result["transactions"],
    }
    if request_id:
        await remember_capture(db, request_id, response)
    return response

@router.post("/parse-brain-dump")
async def parse_dump(req: BrainDumpRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Extracts structured tasks, due dates, priority, and optional financial transactions."""
    extracted = await parse_brain_dump(req.natural_language, projects=await _project_names(db))
    return {"success": True, "items": extracted}

async def _project_names(db: aiosqlite.Connection) -> List[Dict[str, Any]]:
    async with db.execute("SELECT id, name FROM projects") as cursor:
        return [{"id": r["id"], "name": r["name"]} for r in await cursor.fetchall()]

@router.post("/auto-fill")
async def auto_fill(req: AutoFillRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Expands a task title into a detailed description and 3-5 subtask checklist, with project awareness."""
    proj_name = None
    prev_tasks = []
    if req.project_id:
        async with db.execute("SELECT name FROM projects WHERE id = ?", (req.project_id,)) as p_cur:
            p_row = await p_cur.fetchone()
            if p_row:
                proj_name = p_row["name"]
        async with db.execute("SELECT title FROM work_items WHERE project_id = ? ORDER BY created_at DESC LIMIT 5", (req.project_id,)) as t_cur:
            t_rows = await t_cur.fetchall()
            prev_tasks = [r["title"] for r in t_rows]

    details = await auto_fill_task_details(
        req.title, req.context,
        project_name=proj_name,
        previous_tasks=prev_tasks
    )
    return {"success": True, "data": details}

@router.post("/improve-task")
async def improve_task(req: ImproveTaskRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Refines a task title, description, subtasks, priority, energy, and estimates with project awareness."""
    proj_name = None
    prev_tasks = []
    if req.project_id:
        async with db.execute("SELECT name FROM projects WHERE id = ?", (req.project_id,)) as p_cur:
            p_row = await p_cur.fetchone()
            if p_row:
                proj_name = p_row["name"]
        async with db.execute("SELECT title FROM work_items WHERE project_id = ? ORDER BY created_at DESC LIMIT 5", (req.project_id,)) as t_cur:
            t_rows = await t_cur.fetchall()
            prev_tasks = [r["title"] for r in t_rows]

    result = await improve_task_data(
        req.title, req.context, req.entity_type,
        project_name=proj_name,
        previous_tasks=prev_tasks
    )
    return {"success": True, "data": result}

@router.post("/generate-project-description")
async def generate_proj_desc(
    req: ProjectDescriptionRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Generates an executive project scope and deliverables dossier."""
    existing_tasks = []
    if req.project_id:
        async with db.execute("SELECT title FROM work_items WHERE project_id = ? ORDER BY created_at DESC LIMIT 10", (req.project_id,)) as t_cur:
            t_rows = await t_cur.fetchall()
            existing_tasks = [r["title"] for r in t_rows]
            
    desc = await generate_project_description(req.name, existing_tasks, req.context)
    return {"success": True, "description": desc, "data": {"description": desc}}

@router.post("/organize-board")
async def organize_board(
    req: Optional[OrganizeBoardRequest] = None,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Analyzes pending tasks across the board to prioritize Big Rocks and propose optimizations."""
    tasks = req.tasks if (req and req.tasks is not None) else None
    if tasks is None:
        async with db.execute("SELECT id, title, description, priority, entity_type, due_date, estimated_minutes, is_completed FROM work_items WHERE is_completed = 0") as cursor:
            rows = await cursor.fetchall()
            tasks = [dict(r) for r in rows]
    
    result = await organize_board_data(tasks)
    return {"success": True, "data": result}

@router.get("/home-mode")
async def get_home_mode_status(db: aiosqlite.Connection = Depends(get_db)):
    """Returns Home Mode quiet hours status, quiet hours schedule, and pending backlog counts."""
    stats = await get_backlog_stats(db)
    return {"success": True, "data": stats}

@router.post("/home-mode")
async def update_home_mode_setting(
    req: HomeModeRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Enables or disables Home Mode (fan noise quiet hours protection)."""
    await set_home_mode(db, req.home_mode)
    stats = await get_backlog_stats(db)
    return {"success": True, "data": stats}

@router.post("/process-backlog")
async def process_backlog(
    req: Optional[ProcessBacklogRequest] = None,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Processes existing tasks and projects lacking descriptions in created_at DESC order.
    Defers if Home Mode is active and outside quiet hours (01:30 AM), unless force=True."""
    max_items = req.max_items if req and req.max_items else 50
    force = req.force if req and req.force is not None else False
    result = await process_backlog_items(db, max_items=max_items, force=force, ws_broadcast=ws_manager.broadcast)
    return {"success": True, "data": result}

