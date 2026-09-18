import asyncio
import datetime
import aiosqlite
import uuid
from typing import Optional, List, Dict, Any

from .ai_engine import auto_fill_task_details, generate_project_description

def is_quiet_hours_window(now: Optional[datetime.datetime] = None) -> bool:
    """
    Returns True if local time is in the midnight quiet hours window (01:30 AM to 05:30 AM).
    During this window, heavy backlog batch processing is permitted because the user is asleep
    and Raspberry Pi 5 fan noise will not be noticed or cause disturbance.
    """
    if now is None:
        now = datetime.datetime.now()

    # 01:30 AM to 05:30 AM
    if now.hour == 1 and now.minute >= 30:
        return True
    if 2 <= now.hour < 5:
        return True
    if now.hour == 5 and now.minute <= 30:
        return True
    return False

async def get_setting(db: aiosqlite.Connection, key: str, default: str = "") -> str:
    """Reads a setting value from system_settings table."""
    try:
        async with db.execute("SELECT value FROM system_settings WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
            return row["value"] if row else default
    except Exception:
        return default

async def set_setting(db: aiosqlite.Connection, key: str, value: str):
    """Writes or updates a setting in system_settings table."""
    now_iso = datetime.datetime.now().isoformat()
    await db.execute(
        "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, now_iso)
    )
    await db.commit()

async def is_home_mode_active(db: aiosqlite.Connection) -> bool:
    """Returns True if Home Mode (fan noise quiet hours protection) is enabled."""
    val = await get_setting(db, "home_mode", default="true")
    return val.strip().lower() in ("true", "1", "yes", "on")

async def set_home_mode(db: aiosqlite.Connection, enabled: bool):
    """Toggles Home Mode on or off."""
    await set_setting(db, "home_mode", "true" if enabled else "false")

async def get_backlog_stats(db: aiosqlite.Connection) -> Dict[str, Any]:
    """Returns counts of projects and tasks missing descriptions, plus quiet hours status."""
    async with db.execute(
        "SELECT COUNT(*) FROM projects WHERE description IS NULL OR trim(description) = ''"
    ) as p_cur:
        p_row = await p_cur.fetchone()
        pending_projects = p_row[0] if p_row else 0

    async with db.execute(
        "SELECT COUNT(*) FROM work_items WHERE description IS NULL OR trim(description) = ''"
    ) as t_cur:
        t_row = await t_cur.fetchone()
        pending_tasks = t_row[0] if t_row else 0

    home_mode = await is_home_mode_active(db)
    quiet_hours_now = is_quiet_hours_window()

    return {
        "home_mode": home_mode,
        "quiet_hours_schedule": "01:30 - 05:30",
        "is_quiet_hours_now": quiet_hours_now,
        "pending_projects": pending_projects,
        "pending_tasks": pending_tasks,
        "can_run_now": (not home_mode) or quiet_hours_now
    }

async def process_backlog_items(
    db: aiosqlite.Connection,
    max_items: int = 50,
    force: bool = False,
    ws_broadcast = None
) -> Dict[str, Any]:
    """
    Finds existing projects and tasks lacking descriptions and auto-generates them.
    STRICT PRIORITY: Newer projects and tasks are processed first (created_at DESC).
    FAN PROTECTION: If home_mode is active and current time is outside 01:30 AM - 05:30 AM,
    batch processing is deferred unless force=True.
    """
    stats = await get_backlog_stats(db)
    home_mode = stats["home_mode"]
    quiet_hours_now = stats["is_quiet_hours_now"]

    if not force and home_mode and not quiet_hours_now:
        return {
            "processed_projects": 0,
            "processed_tasks": 0,
            "deferred": True,
            "reason": "Home mode active: Backlog AI processing deferred to midnight 01:30 AM to prevent Raspberry Pi fan noise.",
            "pending_projects": stats["pending_projects"],
            "pending_tasks": stats["pending_tasks"]
        }

    processed_projects = 0
    processed_tasks = 0

    # 1. Process projects missing descriptions: Newer first (created_at DESC)
    async with db.execute(
        "SELECT id, name, created_at FROM projects "
        "WHERE description IS NULL OR trim(description) = '' "
        "ORDER BY created_at DESC LIMIT ?",
        (max_items,)
    ) as p_cur:
        projects_to_update = await p_cur.fetchall()

    for proj in projects_to_update:
        p_id = proj["id"]
        p_name = proj["name"]
        async with db.execute(
            "SELECT title FROM work_items WHERE project_id = ? ORDER BY created_at DESC LIMIT 5",
            (p_id,)
        ) as task_cur:
            t_rows = await task_cur.fetchall()
            existing_titles = [r["title"] for r in t_rows if r["title"]]

        desc = await generate_project_description(p_name, existing_tasks=existing_titles)
        await db.execute("UPDATE projects SET description = ? WHERE id = ?", (desc, p_id))
        await db.commit()
        processed_projects += 1
        await asyncio.sleep(0.3)  # Gentle throttle to prevent CPU fan noise spikes

    remaining_quota = max_items - processed_projects
    if remaining_quota > 0:
        # 2. Process tasks missing descriptions: Newer first (created_at DESC)
        async with db.execute(
            "SELECT id, title, project_id, entity_type, context_tags FROM work_items "
            "WHERE description IS NULL OR trim(description) = '' "
            "ORDER BY created_at DESC LIMIT ?",
            (remaining_quota,)
        ) as t_cur:
            tasks_to_update = await t_cur.fetchall()

        for t in tasks_to_update:
            t_id = t["id"]
            t_title = t["title"]
            p_id = t["project_id"]
            entity_type = t["entity_type"] or "task"
            context_tags = t["context_tags"] or ""

            project_name = None
            previous_tasks = []
            if p_id:
                async with db.execute("SELECT name FROM projects WHERE id = ?", (p_id,)) as p_name_cur:
                    p_row = await p_name_cur.fetchone()
                    if p_row:
                        project_name = p_row["name"]

                async with db.execute(
                    "SELECT title FROM work_items WHERE project_id = ? AND id != ? ORDER BY created_at DESC LIMIT 5",
                    (p_id, t_id)
                ) as prev_cur:
                    prev_rows = await prev_cur.fetchall()
                    previous_tasks = [r["title"] for r in prev_rows if r["title"]]

            generated = await auto_fill_task_details(
                title=t_title,
                context=context_tags,
                project_name=project_name,
                previous_tasks=previous_tasks,
                entity_type=entity_type
            )

            new_desc = generated.get("description", "")
            new_subtasks = generated.get("subtasks", [])

            now_iso = datetime.datetime.now().isoformat()
            await db.execute(
                "UPDATE work_items SET description = ?, updated_at = ? WHERE id = ?",
                (new_desc, now_iso, t_id)
            )

            # Backfill subtasks only if task had zero subtasks
            async with db.execute("SELECT COUNT(*) FROM subtasks WHERE work_item_id = ?", (t_id,)) as sub_cnt_cur:
                sub_cnt_row = await sub_cnt_cur.fetchone()
                sub_cnt = sub_cnt_row[0] if sub_cnt_row else 0

            if sub_cnt == 0 and new_subtasks:
                for idx, s_title in enumerate(new_subtasks):
                    sub_id = f"sub_{uuid.uuid4().hex[:10]}"
                    await db.execute(
                        "INSERT INTO subtasks (id, work_item_id, title, is_completed, position, created_at) VALUES (?, ?, ?, 0, ?, ?)",
                        (sub_id, t_id, s_title, idx, now_iso)
                    )

            await db.commit()
            processed_tasks += 1

            if ws_broadcast:
                try:
                    await ws_broadcast({"type": "ITEM_UPDATED", "data": {"id": t_id, "description": new_desc}})
                except Exception:
                    pass

            await asyncio.sleep(0.3)  # Gentle throttle

    updated_stats = await get_backlog_stats(db)

    return {
        "processed_projects": processed_projects,
        "processed_tasks": processed_tasks,
        "deferred": False,
        "reason": "Processed successfully",
        "pending_projects": updated_stats["pending_projects"],
        "pending_tasks": updated_stats["pending_tasks"]
    }
