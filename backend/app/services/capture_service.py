"""
Acting on a natural-language capture.

`capture_ai` works out *what* was said -- the local Ollama model reading the
note, checked against `capture_engine`'s deterministic parse. This module
writes the result down: work items, their reminders, and any expense that came
with them, inside one database transaction, and tells connected clients what
appeared.
"""

import datetime
import uuid
from typing import Any, Dict, List, Optional, Sequence

import aiosqlite

from .capture_ai import DEFAULT_TIMEOUT_SECONDS, understand
from .capture_engine import CapturedItem
from .ws_manager import ws_manager

async def load_projects(db: aiosqlite.Connection) -> List[Dict[str, Any]]:
    """Project names the parser can match `#tags` and plain mentions against."""
    async with db.execute("SELECT id, name FROM projects") as cursor:
        return [{"id": row["id"], "name": row["name"]} for row in await cursor.fetchall()]


async def read_capture(
    db: aiosqlite.Connection,
    text: str,
    now: Optional[datetime.datetime] = None,
    use_ai: bool = True,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> List[CapturedItem]:
    """
    Understand a capture without writing anything.

    With use_ai the local model does the reading; without it the deterministic
    parser answers on its own, which is what the type-ahead hints need.
    """
    projects = await load_projects(db)
    return await understand(
        text, now=now, projects=projects, use_ai=use_ai, timeout_seconds=timeout_seconds
    )


async def commit_capture(
    db: aiosqlite.Connection,
    text: str,
    now: Optional[datetime.datetime] = None,
    log_expenses: bool = True,
    use_ai: bool = True,
    items: Optional[Sequence[CapturedItem]] = None,
) -> Dict[str, Any]:
    """
    Parse a capture and create everything it describes.

    Every row is written on one connection and committed once, so a failure
    part way through leaves nothing behind.
    """
    now = now or datetime.datetime.now()
    items = list(items) if items is not None else await read_capture(db, text, now=now, use_ai=use_ai)
    if not items:
        return {"items": [], "created": [], "transactions": []}

    now_iso = now.isoformat()
    created: List[Dict[str, Any]] = []
    transactions: List[Dict[str, Any]] = []

    for item in items:
        item_id = f"item_{uuid.uuid4().hex[:12]}"
        await db.execute(
            """
            INSERT INTO work_items (
                id, title, description, entity_type, status, priority, energy,
                due_date, start_at, end_at, remind_at, repeat_rule,
                project_id, estimated_minutes, actual_minutes,
                depends_on, context_tags, is_completed, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', ?, 0, ?, ?)
            """,
            (
                item_id, item.title, item.description, item.entity_type,
                item.priority, item.energy, item.due_date, item.start_at,
                item.end_at, item.remind_at, item.repeat_rule, item.project_id,
                item.estimated_minutes, item.context_tags, now_iso, now_iso,
            ),
        )
        record = item.to_dict()
        record["id"] = item_id
        created.append(record)

        if log_expenses and item.expense and item.expense.get("amount", 0) > 0:
            transaction = await _log_expense(db, item, now)
            if transaction:
                transactions.append(transaction)

    await db.commit()

    for record in created:
        await ws_manager.broadcast({"type": "ITEM_CREATED", "data": record})
    for transaction in transactions:
        await ws_manager.broadcast({"type": "FINANCE_TRANSACTION_CREATED", "data": transaction})

    return {"items": [i.to_dict() for i in items], "created": created, "transactions": transactions}


async def _log_expense(
    db: aiosqlite.Connection,
    item: CapturedItem,
    now: datetime.datetime,
) -> Optional[Dict[str, Any]]:
    """Record a spend the capture mentioned, against the right account."""
    expense = item.expense or {}
    amount = float(expense.get("amount") or 0)
    if amount <= 0:
        return None

    mode = expense.get("payment_mode") or "upi"
    preferred_type = {"cash": "cash", "credit_card": "credit"}.get(mode, "bank")

    account = None
    async with db.execute(
        "SELECT id FROM finance_accounts WHERE account_type = ? ORDER BY is_upi_default DESC LIMIT 1",
        (preferred_type,),
    ) as cursor:
        account = await cursor.fetchone()
    if not account:
        async with db.execute("SELECT id FROM finance_accounts ORDER BY is_upi_default DESC LIMIT 1") as cursor:
            account = await cursor.fetchone()
    if not account:
        return None

    category_id = None
    if expense.get("category"):
        async with db.execute(
            "SELECT id FROM finance_categories WHERE name LIKE ? LIMIT 1",
            (f"%{expense['category']}%",),
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                category_id = row["id"]

    now_iso = now.isoformat()
    tx_id = f"tx_{uuid.uuid4().hex[:10]}"
    await db.execute(
        "UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?",
        (amount, now_iso, account["id"]),
    )
    await db.execute(
        """
        INSERT INTO finance_transactions (
            id, account_id, category_id, type, amount, payment_mode, description, date, created_at
        ) VALUES (?, ?, ?, 'expense', ?, ?, ?, ?, ?)
        """,
        (tx_id, account["id"], category_id, amount, mode,
         expense.get("description") or item.title,
         (item.due_date or now.strftime("%Y-%m-%d")), now_iso),
    )
    return {
        "id": tx_id,
        "account_id": account["id"],
        "amount": amount,
        "payment_mode": mode,
        "description": expense.get("description") or item.title,
    }
