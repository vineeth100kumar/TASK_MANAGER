import uuid
import json
import datetime
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional

from ..database import get_db
from ..models import DailyReflectionCreate, DailyReflectionResponse
from ..services.ws_manager import ws_manager
from ..services.planner_service import compute_big_rock_suggestions

router = APIRouter(prefix="/api/v1/planner", tags=["Morning/Evening Wizard"])


@router.get("/kickoff")
async def morning_kickoff(db: aiosqlite.Connection = Depends(get_db)):
    """Morning Wizard: today tasks, Big Rock suggestions, events, streak, existing reflection."""
    today = datetime.date.today().isoformat()
    active_tasks = []
    async with db.execute(
        """SELECT id, title, priority, energy, status, due_date, estimated_minutes, context_tags
           FROM work_items
           WHERE is_completed = 0
             AND status NOT IN ('done','archived')
             AND entity_type = 'task'
           ORDER BY
             CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             due_date ASC NULLS LAST
           LIMIT 50"""
    ) as cursor:
        for row in await cursor.fetchall():
            active_tasks.append(dict(row))
    today_events = []
    async with db.execute(
        """SELECT id, title, start_at, end_at, estimated_minutes
           FROM work_items
           WHERE entity_type = 'event'
             AND (due_date = ? OR DATE(start_at) = ?)
             AND is_completed = 0
           ORDER BY start_at ASC NULLS LAST""",
        (today, today)
    ) as cursor:
        for row in await cursor.fetchall():
            today_events.append(dict(row))
    existing_reflection = None
    async with db.execute("SELECT * FROM daily_reflections WHERE date = ?", (today,)) as cursor:
        row = await cursor.fetchone()
        if row:
            r = dict(row)
            try:
                big_rocks = json.loads(r.get("big_rocks", "[]"))
            except Exception:
                big_rocks = []
            existing_reflection = {
                "id": r["id"],
                "date": r["date"],
                "big_rocks": big_rocks,
                "reflection": r.get("reflection", ""),
                "mood": r.get("mood", "")
            }
    # Streak calculation in 1 single query
    cutoff_date = (datetime.date.today() - datetime.timedelta(days=40)).isoformat()
    async with db.execute(
        "SELECT DISTINCT substr(completed_at, 1, 10) as cdate FROM work_items WHERE completed_at IS NOT NULL AND completed_at >= ? AND is_completed = 1",
        (cutoff_date,)
    ) as cursor:
        completed_days = {row["cdate"] for row in await cursor.fetchall()}

    streak_days = 0
    today_date = datetime.date.today()
    if today_date.isoformat() in completed_days:
        streak_days = 1
        for i in range(1, 35):
            day_str = (today_date - datetime.timedelta(days=i)).isoformat()
            if day_str in completed_days:
                streak_days += 1
            else:
                break
    else:
        for i in range(1, 35):
            day_str = (today_date - datetime.timedelta(days=i)).isoformat()
            if day_str in completed_days:
                streak_days += 1
            else:
                break

    big_rock_suggestions = compute_big_rock_suggestions(active_tasks, limit=5)
    return {
        "date": today,
        "active_tasks": active_tasks,
        "big_rock_suggestions": big_rock_suggestions,
        "today_events": today_events,
        "existing_reflection": existing_reflection,
        "streak_days": streak_days,
        "total_active_tasks": len(active_tasks),
    }


@router.post("/debrief")
async def evening_debrief(payload: DailyReflectionCreate, db: aiosqlite.Connection = Depends(get_db)):
    """Evening Wizard: save reflection + auto-migrate unfinished tasks to tomorrow."""
    today = datetime.date.today().isoformat()
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    now_iso = datetime.datetime.now().isoformat()
    async with db.execute(
        "SELECT COUNT(*) FROM work_items WHERE is_completed = 1 AND DATE(completed_at) = ?", (today,)
    ) as cursor:
        completed_count = (await cursor.fetchone())[0]
    async with db.execute(
        "SELECT COUNT(*) FROM work_items WHERE is_completed = 0 AND status NOT IN ('done','archived')"
    ) as cursor:
        planned_count = (await cursor.fetchone())[0]
    # rowcount is what actually moved. Counting everything due tomorrow
    # afterwards also counted tasks that were already scheduled for tomorrow.
    migrate_cursor = await db.execute(
        """UPDATE work_items SET due_date = ?, updated_at = ?
           WHERE is_completed = 0
             AND status IN ('todo','in_progress','inbox')
             AND due_date = ?
             AND entity_type = 'task'""",
        (tomorrow, now_iso, today)
    )
    migrated_count = migrate_cursor.rowcount or 0
    big_rocks_json = json.dumps(payload.big_rocks or [])
    refl_id = f"refl_{uuid.uuid4().hex[:10]}"
    async with db.execute("SELECT id FROM daily_reflections WHERE date = ?", (today,)) as cursor:
        existing = await cursor.fetchone()
    if existing:
        await db.execute(
            """UPDATE daily_reflections
               SET big_rocks=?,reflection=?,mood=?,completed_count=?,planned_count=?,migrated_tasks_count=?,updated_at=?
               WHERE date=?""",
            (big_rocks_json, payload.reflection or "", payload.mood or "",
             completed_count, planned_count, migrated_count, now_iso, today)
        )
        refl_id = existing["id"]
    else:
        await db.execute(
            """INSERT INTO daily_reflections
               (id,date,big_rocks,reflection,mood,completed_count,planned_count,migrated_tasks_count,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (refl_id, today, big_rocks_json, payload.reflection or "", payload.mood or "",
             completed_count, planned_count, migrated_count, now_iso, now_iso)
        )
    await db.commit()
    await ws_manager.broadcast({"type": "TASKS_MIGRATED", "data": {"migrated_count": migrated_count, "to_date": tomorrow}})
    return {
        "success": True,
        "date": today,
        "completed_today": completed_count,
        "planned": planned_count,
        "migrated_to_tomorrow": migrated_count,
        "reflection_id": refl_id
    }


@router.get("/reflection/{date}", response_model=DailyReflectionResponse)
async def get_reflection(date: str, db: aiosqlite.Connection = Depends(get_db)):
    """Retrieve saved reflection for a date (YYYY-MM-DD)."""
    async with db.execute("SELECT * FROM daily_reflections WHERE date = ?", (date,)) as cursor:
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No reflection found for this date")
    r = dict(row)
    try:
        big_rocks = json.loads(r.get("big_rocks", "[]"))
    except Exception:
        big_rocks = []
    return DailyReflectionResponse(
        id=r["id"],
        date=r["date"],
        big_rocks=big_rocks,
        reflection=r.get("reflection", ""),
        mood=r.get("mood", ""),
        completed_count=r.get("completed_count", 0),
        planned_count=r.get("planned_count", 0),
        migrated_tasks_count=r.get("migrated_tasks_count", 0),
        created_at=r["created_at"],
        updated_at=r["updated_at"]
    )


@router.get("/reflections")
async def list_reflections(limit: int = 30, db: aiosqlite.Connection = Depends(get_db)):
    """List the last N daily reflections."""
    results = []
    async with db.execute("SELECT * FROM daily_reflections ORDER BY date DESC LIMIT ?", (limit,)) as cursor:
        for row in await cursor.fetchall():
            r = dict(row)
            try:
                big_rocks = json.loads(r.get("big_rocks", "[]"))
            except Exception:
                big_rocks = []
            results.append({
                "id": r["id"],
                "date": r["date"],
                "big_rocks": big_rocks,
                "reflection": r.get("reflection", ""),
                "mood": r.get("mood", ""),
                "completed_count": r.get("completed_count", 0),
                "planned_count": r.get("planned_count", 0),
                "migrated_tasks_count": r.get("migrated_tasks_count", 0)
            })
    return results
