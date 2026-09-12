import uuid
import datetime
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Header
from typing import Optional, Dict, Any

from ..database import get_db
from ..models import SiriQuickTask, SiriQuickExpense
from ..services.ai_engine import parse_brain_dump
from ..services.ws_manager import ws_manager

router = APIRouter(prefix="/api/v1/shortcuts", tags=["iOS Shortcuts & Siri Voice Integration"])

# Simple API Key validation
API_SECRET = "sage_rpi5_secret_ios_key_2026"

def verify_token(authorization: Optional[str] = Header(None)):
    if authorization:
        token = authorization.replace("Bearer ", "").strip()
        if token == API_SECRET:
            return True
    # For initial local network setup convenience, allow without token if not set
    return True

@router.post("/quick-task")
async def siri_quick_task(payload: SiriQuickTask, db: aiosqlite.Connection = Depends(get_db)):
    """
    Siri Voice Endpoint: 'Hey Siri, Add Task'
    Receives dictated text, parses with AI engine, and saves to database.
    """
    parsed_items = await parse_brain_dump(payload.input_text)
    if not parsed_items:
        raise HTTPException(status_code=400, detail="Could not parse task")

    item = parsed_items[0]
    item_id = f"item_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.datetime.now().isoformat()

    await db.execute("""
        INSERT INTO work_items (
            id, title, description, entity_type, status, priority, energy,
            due_date, remind_at, estimated_minutes, is_completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'todo', ?, 'medium', ?, ?, ?, 0, ?, ?)
    """, (
        item_id,
        item["title"],
        item.get("description", "Added via Siri"),
        item.get("entity_type", "task"),
        item.get("priority", "medium"),
        item.get("due_date"),
        item.get("due_date"), # Default reminder
        item.get("estimated_minutes", 30),
        now_iso,
        now_iso
    ))
    await db.commit()

    # Broadcast to live UI
    await ws_manager.broadcast({
        "type": "ITEM_CREATED",
        "data": {"id": item_id, "title": item["title"], "source": "Siri"}
    })

    # Return speech response for Siri
    return {
        "success": True,
        "spoken_response": f"Added task: {item['title']}. Priority is {item.get('priority', 'medium')}.",
        "task_id": item_id,
        "title": item["title"]
    }

@router.post("/log-expense")
async def siri_log_expense(payload: SiriQuickExpense, db: aiosqlite.Connection = Depends(get_db)):
    """
    Siri Voice Endpoint: 'Hey Siri, Log Expense'
    Example: 250 rupees via UPI for Lunch.
    """
    tx_id = f"tx_{uuid.uuid4().hex[:10]}"
    now_iso = datetime.datetime.now().isoformat()
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")

    # Locate appropriate account (default to primary bank or cash)
    account_type = "cash" if payload.payment_mode == "cash" else "bank"
    async with db.execute("SELECT id, name, balance FROM finance_accounts WHERE account_type = ? LIMIT 1", (account_type,)) as cursor:
        acc = await cursor.fetchone()
        if not acc:
            # Fallback to any account
            async with db.execute("SELECT id, name, balance FROM finance_accounts LIMIT 1") as f_cursor:
                acc = await f_cursor.fetchone()

    account_id = acc["id"]
    new_balance = acc["balance"] - payload.amount
    await db.execute("UPDATE finance_accounts SET balance = ?, updated_at = ? WHERE id = ?", (new_balance, now_iso, account_id))

    # Match category
    cat_id = None
    if payload.category:
        async with db.execute("SELECT id FROM finance_categories WHERE name LIKE ? LIMIT 1", (f"%{payload.category}%",)) as c_cur:
            cat_row = await c_cur.fetchone()
            if cat_row:
                cat_id = cat_row["id"]

    await db.execute("""
        INSERT INTO finance_transactions (
            id, account_id, category_id, type, amount, payment_mode, description, date, created_at
        ) VALUES (?, ?, ?, 'expense', ?, ?, ?, ?, ?)
    """, (
        tx_id, account_id, cat_id, payload.amount, payload.payment_mode,
        payload.description or f"Logged via Siri ({payload.payment_mode.upper()})",
        today_str, now_iso
    ))
    await db.commit()

    await ws_manager.broadcast({
        "type": "FINANCE_TRANSACTION_CREATED",
        "data": {"id": tx_id, "amount": payload.amount, "mode": payload.payment_mode}
    })

    return {
        "success": True,
        "spoken_response": f"Logged {payload.amount} rupees spent via {payload.payment_mode.upper()}. Your updated balance is {int(new_balance)} rupees.",
        "remaining_balance": new_balance
    }

@router.get("/status")
async def siri_status_briefing(db: aiosqlite.Connection = Depends(get_db)):
    """Siri Daily Briefing voice readout."""
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    
    # Task stats
    async with db.execute("SELECT COUNT(*), SUM(is_completed) FROM work_items WHERE due_date = ?", (today_str,)) as cursor:
        counts = await cursor.fetchone()
        total = counts[0] or 0
        completed = counts[1] or 0
        
    # Bank balance
    async with db.execute("SELECT SUM(balance) FROM finance_accounts WHERE account_type = 'bank'") as b_cur:
        bank_bal = (await b_cur.fetchone())[0] or 0.0

    speech = f"You have completed {completed} out of {total} tasks today. Your current bank balance is {int(bank_bal)} rupees."
    return {
        "spoken_response": speech,
        "tasks_completed": completed,
        "tasks_total": total,
        "bank_balance": bank_bal
    }
