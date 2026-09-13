import uuid
import json
import datetime
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict

from ..database import get_db
from ..models import (
    WorkItemCreate, WorkItemUpdate, WorkItemResponse,
    SubtaskResponse, ProjectCreate, ProjectResponse,
    MilestoneCreate, MilestoneResponse
)
from ..services.recurrence import calculate_next_occurrence
from ..services.ws_manager import ws_manager

router = APIRouter(prefix="/api/v1/items", tags=["Items & Milestones"])

@router.get("", response_model=List[WorkItemResponse])
async def list_items(
    entity_type: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    project_id: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Lists work items with optional filtering and pre-batched subtasks for maximum speed."""
    query = "SELECT * FROM work_items WHERE 1=1"
    params = []
    
    if entity_type:
        query += " AND entity_type = ?"
        params.append(entity_type)
    if status:
        query += " AND status = ?"
        params.append(status)
    if priority:
        query += " AND priority = ?"
        params.append(priority)
    if project_id:
        query += " AND project_id = ?"
        params.append(project_id)
        
    query += " ORDER BY is_completed ASC, due_date ASC, created_at DESC"
    
    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()

    if not rows:
        return []

    item_ids = [row["id"] for row in rows]
    subtasks_by_item: Dict[str, List[SubtaskResponse]] = {iid: [] for iid in item_ids}
    
    # Pre-batch fetch ALL subtasks in ONE single fast query (Eliminates N+1 DB roundtrips)
    placeholders = ",".join("?" for _ in item_ids)
    sub_query = f"SELECT * FROM subtasks WHERE work_item_id IN ({placeholders}) ORDER BY position ASC"
    async with db.execute(sub_query, item_ids) as sub_cursor:
        for s in await sub_cursor.fetchall():
            wid = s["work_item_id"]
            if wid in subtasks_by_item:
                subtasks_by_item[wid].append(SubtaskResponse(
                    id=s["id"],
                    work_item_id=s["work_item_id"],
                    title=s["title"],
                    is_completed=bool(s["is_completed"]),
                    position=s["position"],
                    created_at=s["created_at"]
                ))

    items = []
    for row in rows:
        item_id = row["id"]
        depends_on = []
        if row["depends_on"]:
            try:
                depends_on = json.loads(row["depends_on"])
            except Exception:
                depends_on = []
                
        items.append(WorkItemResponse(
            id=row["id"],
            title=row["title"],
            description=row["description"],
            entity_type=row["entity_type"],
            status=row["status"],
            priority=row["priority"],
            energy=row["energy"],
            due_date=row["due_date"],
            start_at=row["start_at"],
            end_at=row["end_at"],
            remind_at=row["remind_at"],
            repeat_rule=row["repeat_rule"],
            next_occurrence=row["next_occurrence"],
            project_id=row["project_id"],
            milestone_id=row["milestone_id"],
            estimated_minutes=row["estimated_minutes"],
            actual_minutes=row["actual_minutes"],
            depends_on=depends_on,
            is_completed=bool(row["is_completed"]),
            completed_at=row["completed_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            subtasks=subtasks_by_item.get(item_id, [])
        ))
            
    return items

@router.post("", response_model=WorkItemResponse)
async def create_item(item: WorkItemCreate, db: aiosqlite.Connection = Depends(get_db)):
    item_id = f"item_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.datetime.now().isoformat()
    
    next_occurrence = None
    if item.repeat_rule:
        calc = calculate_next_occurrence(item.repeat_rule)
        if calc:
            next_occurrence = calc.isoformat()
            
    query = """
        INSERT INTO work_items (
            id, title, description, entity_type, status, priority, energy,
            due_date, start_at, end_at, remind_at, repeat_rule, next_occurrence,
            project_id, milestone_id, estimated_minutes, actual_minutes,
            depends_on, is_completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    """
    await db.execute(query, (
        item_id, item.title, item.description, item.entity_type, item.status, item.priority, item.energy,
        item.due_date, item.start_at, item.end_at, item.remind_at, item.repeat_rule, next_occurrence,
        item.project_id, item.milestone_id, item.estimated_minutes, item.actual_minutes,
        json.dumps(item.depends_on), now_iso, now_iso
    ))
    
    subtask_responses = []
    if item.subtasks:
        for idx, sub_title in enumerate(item.subtasks):
            sub_id = f"sub_{uuid.uuid4().hex[:10]}"
            await db.execute(
                "INSERT INTO subtasks (id, work_item_id, title, is_completed, position, created_at) VALUES (?, ?, ?, 0, ?, ?)",
                (sub_id, item_id, sub_title, idx, now_iso)
            )
            subtask_responses.append(SubtaskResponse(
                id=sub_id, work_item_id=item_id, title=sub_title, is_completed=False, position=idx, created_at=now_iso
            ))
            
    await db.commit()
    
    res = WorkItemResponse(
        id=item_id,
        title=item.title,
        description=item.description,
        entity_type=item.entity_type,
        status=item.status,
        priority=item.priority,
        energy=item.energy,
        due_date=item.due_date,
        start_at=item.start_at,
        end_at=item.end_at,
        remind_at=item.remind_at,
        repeat_rule=item.repeat_rule,
        next_occurrence=next_occurrence,
        project_id=item.project_id,
        milestone_id=item.milestone_id,
        estimated_minutes=item.estimated_minutes,
        actual_minutes=item.actual_minutes,
        depends_on=item.depends_on,
        is_completed=False,
        completed_at=None,
        created_at=now_iso,
        updated_at=now_iso,
        subtasks=subtask_responses
    )
    
    # Broadcast to all connected clients
    await ws_manager.broadcast({"type": "ITEM_CREATED", "data": res.model_dump()})
    return res

@router.patch("/{item_id}", response_model=WorkItemResponse)
async def update_item(item_id: str, updates: WorkItemUpdate, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT * FROM work_items WHERE id = ?", (item_id,)) as cursor:
        existing = await cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Item not found")

    now_iso = datetime.datetime.now().isoformat()
    fields = []
    values = []
    
    update_dict = updates.model_dump(exclude_unset=True)
    
    # Handle completion & recurrence
    if "is_completed" in update_dict:
        is_done = update_dict["is_completed"]
        fields.append("is_completed = ?")
        values.append(1 if is_done else 0)
        
        if is_done:
            fields.append("completed_at = ?")
            values.append(now_iso)
            fields.append("status = ?")
            values.append("done")
            
            # Recurrence check: If recurring, schedule the next cycle!
            repeat_rule = existing["repeat_rule"]
            if repeat_rule:
                next_date = calculate_next_occurrence(repeat_rule)
                if next_date:
                    fields.append("next_occurrence = ?")
                    values.append(next_date.isoformat())
                    # Auto-advance due_date to next cycle and reset status if desired
                    fields.append("due_date = ?")
                    values.append(next_date.strftime("%Y-%m-%d"))
        else:
            fields.append("completed_at = ?")
            values.append(None)
            if existing["status"] == "done":
                fields.append("status = ?")
                values.append("todo")
                
        del update_dict["is_completed"]

    for k, v in update_dict.items():
        if k == "depends_on":
            fields.append("depends_on = ?")
            values.append(json.dumps(v))
        else:
            fields.append(f"{k} = ?")
            values.append(v)
            
    fields.append("updated_at = ?")
    values.append(now_iso)
    values.append(item_id)
    
    sql = f"UPDATE work_items SET {', '.join(fields)} WHERE id = ?"
    await db.execute(sql, values)
    await db.commit()
    
    # Return updated item
    async with db.execute("SELECT * FROM work_items WHERE id = ?", (item_id,)) as cursor:
        updated_row = await cursor.fetchone()
        
    subtasks = []
    async with db.execute("SELECT * FROM subtasks WHERE work_item_id = ? ORDER BY position ASC", (item_id,)) as sub_cursor:
        for s in await sub_cursor.fetchall():
            subtasks.append(SubtaskResponse(
                id=s["id"],
                work_item_id=s["work_item_id"],
                title=s["title"],
                is_completed=bool(s["is_completed"]),
                position=s["position"],
                created_at=s["created_at"]
            ))
            
    res = WorkItemResponse(
        id=updated_row["id"],
        title=updated_row["title"],
        description=updated_row["description"],
        entity_type=updated_row["entity_type"],
        status=updated_row["status"],
        priority=updated_row["priority"],
        energy=updated_row["energy"],
        due_date=updated_row["due_date"],
        start_at=updated_row["start_at"],
        end_at=updated_row["end_at"],
        remind_at=updated_row["remind_at"],
        repeat_rule=updated_row["repeat_rule"],
        next_occurrence=updated_row["next_occurrence"],
        project_id=updated_row["project_id"],
        milestone_id=updated_row["milestone_id"],
        estimated_minutes=updated_row["estimated_minutes"],
        actual_minutes=updated_row["actual_minutes"],
        depends_on=json.loads(updated_row["depends_on"]) if updated_row["depends_on"] else [],
        is_completed=bool(updated_row["is_completed"]),
        completed_at=updated_row["completed_at"],
        created_at=updated_row["created_at"],
        updated_at=updated_row["updated_at"],
        subtasks=subtasks
    )
    
    await ws_manager.broadcast({"type": "ITEM_UPDATED", "data": res.model_dump()})
    return res

@router.delete("/{item_id}")
async def delete_item(item_id: str, db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM work_items WHERE id = ?", (item_id,))
    await db.commit()
    await ws_manager.broadcast({"type": "ITEM_DELETED", "data": {"id": item_id}})
    return {"success": True, "id": item_id}

# Subtask toggle
@router.patch("/subtasks/{subtask_id}/toggle")
async def toggle_subtask(subtask_id: str, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT * FROM subtasks WHERE id = ?", (subtask_id,)) as cursor:
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Subtask not found")
        new_status = 0 if row["is_completed"] else 1
        
    await db.execute("UPDATE subtasks SET is_completed = ? WHERE id = ?", (new_status, subtask_id))
    await db.commit()
    await ws_manager.broadcast({"type": "SUBTASK_TOGGLED", "data": {"id": subtask_id, "is_completed": bool(new_status)}})
    return {"success": True, "id": subtask_id, "is_completed": bool(new_status)}

# Projects & Milestones
@router.get("/projects", response_model=List[ProjectResponse])
async def list_projects(db: aiosqlite.Connection = Depends(get_db)):
    projects = []
    async with db.execute("SELECT * FROM projects ORDER BY created_at DESC") as cursor:
        for row in await cursor.fetchall():
            projects.append(ProjectResponse(
                id=row["id"], name=row["name"], color=row["color"], description=row["description"], created_at=row["created_at"]
            ))
    return projects

@router.post("/projects", response_model=ProjectResponse)
async def create_project(proj: ProjectCreate, db: aiosqlite.Connection = Depends(get_db)):
    p_id = f"proj_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()
    await db.execute(
        "INSERT INTO projects (id, name, color, description, created_at) VALUES (?, ?, ?, ?, ?)",
        (p_id, proj.name, proj.color, proj.description, now_iso)
    )
    await db.commit()
    return ProjectResponse(id=p_id, name=proj.name, color=proj.color, description=proj.description, created_at=now_iso)

@router.get("/milestones", response_model=List[MilestoneResponse])
async def list_milestones(db: aiosqlite.Connection = Depends(get_db)):
    """Lists milestones with pre-batched task counts in 2 fast queries total."""
    milestones = []
    async with db.execute("SELECT * FROM milestones ORDER BY due_date ASC") as cursor:
        m_rows = await cursor.fetchall()

    if not m_rows:
        return []

    # Batch count linked tasks in 1 single aggregate query
    counts_by_milestone: Dict[str, tuple] = {}
    async with db.execute(
        "SELECT milestone_id, COUNT(*) as total, SUM(is_completed) as completed FROM work_items WHERE milestone_id IS NOT NULL GROUP BY milestone_id"
    ) as count_cursor:
        for c in await count_cursor.fetchall():
            mid = c["milestone_id"]
            counts_by_milestone[mid] = (c["total"] or 0, c["completed"] or 0)

    for row in m_rows:
        m_id = row["id"]
        total, completed = counts_by_milestone.get(m_id, (0, 0))
        pct = int((completed / total) * 100) if total > 0 else 0
        milestones.append(MilestoneResponse(
            id=m_id,
            project_id=row["project_id"],
            title=row["title"],
            due_date=row["due_date"],
            status=row["status"],
            created_at=row["created_at"],
            linked_task_count=total,
            completed_task_count=completed,
            progress_percentage=pct
        ))
    return milestones

@router.post("/milestones", response_model=MilestoneResponse)
async def create_milestone(m: MilestoneCreate, db: aiosqlite.Connection = Depends(get_db)):
    m_id = f"mile_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()
    await db.execute(
        "INSERT INTO milestones (id, project_id, title, due_date, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
        (m_id, m.project_id, m.title, m.due_date, now_iso)
    )
    await db.commit()
    return MilestoneResponse(
        id=m_id,
        project_id=m.project_id,
        title=m.title,
        due_date=m.due_date,
        status="pending",
        created_at=now_iso,
        linked_task_count=0,
        completed_task_count=0,
        progress_percentage=0
    )
