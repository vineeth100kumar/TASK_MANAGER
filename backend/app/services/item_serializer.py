"""
One shape for a work item, everywhere.

The frontend takes whatever arrives on the WebSocket and drops it straight into
its task list (`event.data as WorkItem`), so a broadcast that is missing fields
does not fail loudly -- it puts a half-built object in the store, and the next
thing to touch it breaks. `subtasks` is the sharp edge: the subtask-toggle
handler maps over `item.subtasks` for every item it holds.

So anything that announces an item builds its payload here, from the row that
was actually written.
"""

import json
from typing import Any, Dict, List, Optional

import aiosqlite


def _column(row: aiosqlite.Row, name: str, default: Any = None) -> Any:
    return row[name] if name in row.keys() else default


def serialize_subtask(row: aiosqlite.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "work_item_id": row["work_item_id"],
        "title": row["title"],
        "is_completed": bool(row["is_completed"]),
        "position": row["position"],
        "created_at": row["created_at"],
    }


def serialize_item(row: aiosqlite.Row, subtasks: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """A work_items row in exactly the shape WorkItemResponse sends."""
    depends_on: List[str] = []
    raw_depends = _column(row, "depends_on")
    if raw_depends:
        try:
            parsed = json.loads(raw_depends)
            if isinstance(parsed, list):
                depends_on = parsed
        except (TypeError, ValueError):
            depends_on = []

    return {
        "id": row["id"],
        "title": row["title"],
        "description": _column(row, "description"),
        "entity_type": row["entity_type"],
        "status": row["status"],
        "priority": row["priority"],
        "energy": row["energy"],
        "due_date": _column(row, "due_date"),
        "start_at": _column(row, "start_at"),
        "end_at": _column(row, "end_at"),
        "remind_at": _column(row, "remind_at"),
        "repeat_rule": _column(row, "repeat_rule"),
        "next_occurrence": _column(row, "next_occurrence"),
        "project_id": _column(row, "project_id"),
        "milestone_id": _column(row, "milestone_id"),
        "estimated_minutes": _column(row, "estimated_minutes", 30),
        "actual_minutes": _column(row, "actual_minutes", 0) or 0,
        "depends_on": depends_on,
        "context_tags": _column(row, "context_tags") or "",
        "is_completed": bool(_column(row, "is_completed", 0)),
        "completed_at": _column(row, "completed_at"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "subtasks": subtasks or [],
    }


async def load_item(db: aiosqlite.Connection, item_id: str) -> Optional[Dict[str, Any]]:
    """Read an item back with its subtasks, ready to broadcast."""
    async with db.execute("SELECT * FROM work_items WHERE id = ?", (item_id,)) as cursor:
        row = await cursor.fetchone()
    if row is None:
        return None

    subtasks: List[Dict[str, Any]] = []
    async with db.execute(
        "SELECT * FROM subtasks WHERE work_item_id = ? ORDER BY position ASC", (item_id,)
    ) as cursor:
        for sub_row in await cursor.fetchall():
            subtasks.append(serialize_subtask(sub_row))

    return serialize_item(row, subtasks)
