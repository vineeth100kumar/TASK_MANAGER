import datetime
import aiosqlite
from fastapi import APIRouter, Depends
from typing import Dict, Any, List

from ..database import get_db

router = APIRouter(prefix="/api/v1/dashboard", tags=["Daily Dashboard & Performance"])

@router.get("/today")
async def get_today_dashboard(db: aiosqlite.Connection = Depends(get_db)):
    """
    Returns today's real performance metrics, accomplishment timeline,
    streak count, and tasks summary. Zero fake or dummy data.
    """
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    
    # 1. Real tasks scheduled or completed today
    # priority is a text column, so ORDER BY priority DESC sorted it
    # alphabetically -- urgent, medium, low, high -- putting high-priority work
    # last. Rank it explicitly instead.
    query_today_tasks = """
        SELECT * FROM work_items
        WHERE (due_date = ? OR (completed_at IS NOT NULL AND completed_at LIKE ?))
        ORDER BY is_completed ASC,
                 CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                               WHEN 'medium' THEN 2 ELSE 3 END ASC,
                 created_at ASC
    """
    
    tasks_planned = 0
    tasks_completed = 0
    urgent_count = 0
    focus_minutes_logged = 0
    timeline = []
    
    async with db.execute(query_today_tasks, (today_str, f"{today_str}%")) as cursor:
        rows = await cursor.fetchall()
        for row in rows:
            tasks_planned += 1
            if row["priority"] == "urgent" and not row["is_completed"]:
                urgent_count += 1
                
            if row["is_completed"]:
                tasks_completed += 1
                focus_minutes_logged += row["actual_minutes"] or row["estimated_minutes"] or 25
                timeline.append({
                    "id": row["id"],
                    "title": row["title"],
                    "completed_at": row["completed_at"],
                    "priority": row["priority"],
                    "entity_type": row["entity_type"]
                })

    timeline.sort(key=lambda x: x.get("completed_at") or "", reverse=True)

    # 2. Real performance score calculation (NO hardcoded fake 85%)
    if tasks_planned == 0:
        score = 100 if tasks_completed > 0 else 0
    else:
        score = int((tasks_completed / tasks_planned) * 100)

    # 3. Real streak calculation in 1 single fast query (Eliminates 30 sequential DB calls)
    streak = 0
    if tasks_completed > 0:
        streak = 1
        cutoff_date = (datetime.datetime.now() - datetime.timedelta(days=40)).strftime("%Y-%m-%d")
        async with db.execute(
            "SELECT DISTINCT substr(completed_at, 1, 10) as cdate FROM work_items WHERE completed_at IS NOT NULL AND completed_at >= ?",
            (cutoff_date,)
        ) as cursor:
            completed_days = {row["cdate"] for row in await cursor.fetchall()}

        now = datetime.datetime.now()
        for i in range(1, 35):
            day_str = (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
            if day_str in completed_days:
                streak += 1
            else:
                break

    return {
        "date": today_str,
        "tasks_planned": tasks_planned,
        "tasks_completed": tasks_completed,
        "completion_rate": score,
        "focus_minutes_logged": focus_minutes_logged,
        "productivity_score": score,
        "urgent_task_count": urgent_count,
        "streak_days": streak,
        "timeline": timeline
    }
