import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Query
from typing import Optional, List, Dict, Any

from ..services.ai_engine import generate_greeting, parse_brain_dump, auto_fill_task_details, improve_task_data, organize_board_data
from ..services.weather_service import get_current_weather
from ..config import DEFAULT_LAT, DEFAULT_LON, DEFAULT_USER_NAME
from ..database import get_db
import aiosqlite

router = APIRouter(prefix="/api/v1/ai", tags=["Local AI Intelligence"])

class BrainDumpRequest(BaseModel):
    natural_language: str

class AutoFillRequest(BaseModel):
    title: str
    context: Optional[str] = None

class ImproveTaskRequest(BaseModel):
    title: str
    context: Optional[str] = None
    entity_type: Optional[str] = "task"

class OrganizeBoardRequest(BaseModel):
    tasks: Optional[List[Dict[str, Any]]] = None

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

@router.post("/parse-brain-dump")
async def parse_dump(req: BrainDumpRequest):
    """Extracts structured tasks, due dates, priority, and optional financial transactions."""
    extracted = await parse_brain_dump(req.natural_language)
    return {"success": True, "items": extracted}

@router.post("/auto-fill")
async def auto_fill(req: AutoFillRequest):
    """Expands a task title into a detailed description and 3-5 subtask checklist."""
    details = await auto_fill_task_details(req.title, req.context)
    return {"success": True, "data": details}

@router.post("/improve-task")
async def improve_task(req: ImproveTaskRequest):
    """Refines a task title, description, subtasks, priority, energy, and estimates."""
    result = await improve_task_data(req.title, req.context, req.entity_type)
    return {"success": True, "data": result}

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
