import datetime
import aiosqlite
from fastapi import APIRouter, Depends
from typing import Dict, Any, List

from ..database import get_db

router = APIRouter(prefix="/api/v1/dashboard", tags=["Daily Dashboard & Performance"])

@router.get("/today")
async def get_today_dashboard(db: aiosqlite.Connection = Depends(get_db)):
    """
    Returns today's comprehensive performance metrics, accomplishment timeline,
    streak count, and tasks summary.
    """
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    
    # 1. Tasks scheduled or completed today
    query_today_tasks = """
        SELECT * FROM work_items 
        WHERE (due_date = ? OR (completed_at IS NOT NULL AND completed_at LIKE ?))
        ORDER BY is_completed ASC, priority DESC, created_at ASC
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

    # Sort timeline by completed_at desc
    timeline.sort(key=lambda x: x.get("completed_at") or "", reverse=True)

    # 2. Performance score calculation
    if tasks_planned == 0:
        score = 100 if tasks_completed > 0 else 85
    else:
        base_rate = (tasks_completed / tasks_planned) * 100
        # Boost for focus minutes
        focus_boost = min(15, (focus_minutes_logged // 30) * 5)
        score = min(100, int(base_rate + focus_boost))

    # 3. Consecutive active streak calculation
    streak = 1
    # Check past 30 days
    current_date = datetime.datetime.now()
    for i in range(1, 30):
        prev_date_str = (current_date - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        async with db.execute(
            "SELECT COUNT(*) FROM work_items WHERE completed_at LIKE ?",
            (f"{prev_date_str}%",)
        ) as prev_cursor:
            cnt = (await prev_cursor.fetchone())[0]
            if cnt > 0:
                streak += 1
            else:
                break

    return {
        "date": today_str,
        "tasks_planned": tasks_planned,
        "tasks_completed": tasks_completed,
        "completion_rate": int((tasks_completed / tasks_planned) * 100) if tasks_planned > 0 else (100 if tasks_completed > 0 else 0),
        "focus_minutes_logged": focus_minutes_logged,
        "productivity_score": score,
        "urgent_task_count": urgent_count,
        "streak_days": streak,
        "timeline": timeline
    }
