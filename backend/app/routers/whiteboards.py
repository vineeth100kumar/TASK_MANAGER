import uuid
import datetime
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional

from ..database import get_db
from ..models import (
    WhiteboardCreate,
    WhiteboardUpdate,
    WhiteboardResponse,
    WhiteboardListItem
)
from ..services.ws_manager import ws_manager

router = APIRouter(prefix="/api/v1/whiteboards", tags=["Whiteboards & Drawing"])

@router.get("", response_model=List[WhiteboardListItem])
async def list_whiteboards(
    project_id: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Lists whiteboards with optional project filtering."""
    query = """
        SELECT w.id, w.title, w.project_id, w.created_at, w.updated_at,
               p.name as project_name, p.color as project_color
        FROM whiteboards w
        LEFT JOIN projects p ON w.project_id = p.id
        WHERE 1=1
    """
    params = []
    if project_id:
        query += " AND w.project_id = ?"
        params.append(project_id)

    query += " ORDER BY w.updated_at DESC"

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()

    return [
        WhiteboardListItem(
            id=row["id"],
            title=row["title"],
            project_id=row["project_id"],
            project_name=row["project_name"],
            project_color=row["project_color"],
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"])
        )
        for row in rows
    ]


@router.post("", response_model=WhiteboardResponse)
async def create_whiteboard(
    payload: WhiteboardCreate,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Creates a new whiteboard."""
    board_id = f"wb_{uuid.uuid4().hex[:12]}"
    now = datetime.datetime.now().isoformat()

    title = (payload.title or "").strip() or "Untitled Whiteboard"
    elements = payload.elements or "[]"
    view_state = payload.view_state or '{"panX": 0, "panY": 0, "zoom": 1}'

    await db.execute(
        """
        INSERT INTO whiteboards (id, title, project_id, elements, view_state, thumbnail_data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (board_id, title, payload.project_id, elements, view_state, payload.thumbnail_data, now, now)
    )
    await db.commit()

    project_name = None
    project_color = None
    if payload.project_id:
        async with db.execute("SELECT name, color FROM projects WHERE id = ?", (payload.project_id,)) as cursor:
            p_row = await cursor.fetchone()
            if p_row:
                project_name = p_row["name"]
                project_color = p_row["color"]

    # Notify live subscribers
    await ws_manager.broadcast("whiteboard_created", {"id": board_id, "title": title})

    return WhiteboardResponse(
        id=board_id,
        title=title,
        project_id=payload.project_id,
        project_name=project_name,
        project_color=project_color,
        elements=elements,
        view_state=view_state,
        thumbnail_data=payload.thumbnail_data,
        created_at=now,
        updated_at=now
    )

@router.get("/{board_id}", response_model=WhiteboardResponse)
async def get_whiteboard(
    board_id: str,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Fetches a whiteboard with complete element data."""
    query = """
        SELECT w.*, p.name as project_name, p.color as project_color
        FROM whiteboards w
        LEFT JOIN projects p ON w.project_id = p.id
        WHERE w.id = ?
    """
    async with db.execute(query, (board_id,)) as cursor:
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Whiteboard not found")

    return WhiteboardResponse(
        id=row["id"],
        title=row["title"],
        project_id=row["project_id"],
        project_name=row["project_name"],
        project_color=row["project_color"],
        elements=row["elements"] or "[]",
        view_state=row["view_state"] or '{"panX": 0, "panY": 0, "zoom": 1}',
        thumbnail_data=row["thumbnail_data"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"])
    )

@router.patch("/{board_id}", response_model=WhiteboardResponse)
async def update_whiteboard(
    board_id: str,
    payload: WhiteboardUpdate,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Updates whiteboard elements, view_state, title, or project link."""
    # Check exists
    async with db.execute("SELECT id FROM whiteboards WHERE id = ?", (board_id,)) as cursor:
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Whiteboard not found")

    updates = []
    params = []
    now = datetime.datetime.now().isoformat()

    if payload.title is not None:
        updates.append("title = ?")
        params.append(payload.title.strip() or "Untitled Whiteboard")
    if payload.project_id is not None:
        updates.append("project_id = ?")
        params.append(payload.project_id if payload.project_id != "" else None)
    if payload.elements is not None:
        updates.append("elements = ?")
        params.append(payload.elements)
    if payload.view_state is not None:
        updates.append("view_state = ?")
        params.append(payload.view_state)
    if payload.thumbnail_data is not None:
        updates.append("thumbnail_data = ?")
        params.append(payload.thumbnail_data)

    updates.append("updated_at = ?")
    params.append(now)

    params.append(board_id)
    await db.execute(f"UPDATE whiteboards SET {', '.join(updates)} WHERE id = ?", params)
    await db.commit()

    # Fetch updated
    return await get_whiteboard(board_id, db)

@router.delete("/{board_id}")
async def delete_whiteboard(
    board_id: str,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Deletes a whiteboard."""
    async with db.execute("DELETE FROM whiteboards WHERE id = ?", (board_id,)) as cursor:
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Whiteboard not found")
    await db.commit()

    await ws_manager.broadcast("whiteboard_deleted", {"id": board_id})
    return {"success": True, "id": board_id}
