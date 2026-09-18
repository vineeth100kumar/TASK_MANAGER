import uuid
import datetime
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, Dict, Any

from ..database import get_db
from ..models import SiriQuickTask, SiriQuickExpense
from ..services.capture_service import commit_capture
from ..services.ws_manager import ws_manager

router = APIRouter(prefix="/api/v1/shortcuts", tags=["iOS Shortcuts & Siri Voice Integration"])

@router.post("/quick-task")
async def siri_quick_task(payload: SiriQuickTask, db: aiosqlite.Connection = Depends(get_db)):
    """
    Siri Voice Endpoint: 'Hey Siri, Add Task'

    Dictated speech goes through the same capture engine as the app's capture
    bar, so "going out with cousins at 7.30pm so leave office by 6.30pm" spoken
    at the phone creates the same two items it would if typed.
    """
    result = await commit_capture(db, payload.input_text)
    created = result["created"]
    if not created:
        raise HTTPException(status_code=400, detail="Could not parse task")

    first = created[0]
    if len(created) == 1:
        spoken = f"Added {first['entity_type']}: {first['title']}."
        if first.get("start_at"):
            spoken += f" Scheduled for {_spoken_time(first['start_at'])}."
    else:
        spoken = f"Added {len(created)} items, starting with {first['title']}."

    return {
        "success": True,
        "spoken_response": spoken,
        "task_id": first["id"],
        "title": first["title"],
        "items": created,
    }

def _spoken_time(iso_value: str) -> str:
    """A time Siri can read out, rather than an ISO timestamp."""
    try:
        moment = datetime.datetime.fromisoformat(iso_value)
    except ValueError:
        return iso_value
    return moment.strftime("%-I:%M %p on %A").replace(" 00", "")

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

    if not acc:
        raise HTTPException(status_code=404, detail="No active finance account found")

    account_id = acc["id"]
    await db.execute(
        "UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?",
        (payload.amount, now_iso, account_id)
    )

    # Fetch updated balance
    async with db.execute("SELECT balance FROM finance_accounts WHERE id = ?", (account_id,)) as b_cur:
        b_row = await b_cur.fetchone()
        updated_balance = b_row[0] if b_row else 0.0

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
        "spoken_response": f"Logged {payload.amount} rupees spent via {payload.payment_mode.upper()}. Your updated balance is {int(updated_balance)} rupees.",
        "remaining_balance": updated_balance
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
