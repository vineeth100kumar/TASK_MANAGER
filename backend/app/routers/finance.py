import uuid
import datetime
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any, Optional

from ..database import get_db
from ..models import (
    FinanceAccountCreate, FinanceAccountResponse, FinanceAccountUpdate,
    FinanceCategoryCreate, FinanceCategoryResponse,
    TransactionCreate, TransactionResponse,
    BudgetCreate, BudgetResponse,
    RecurringBillCreate, RecurringBillResponse
)
from ..services.ws_manager import ws_manager
from ..services.finance_service import calc_days_until_due

router = APIRouter(prefix="/api/v1/finance", tags=["Finance Tracker"])

@router.get("/summary")
async def get_finance_summary(db: aiosqlite.Connection = Depends(get_db)):
    """Computes total bank balance, cash in hand, digital wallets, today's spend, and monthly budget stats."""
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    month_prefix = datetime.datetime.now().strftime("%Y-%m")
    
    # 1. Account Balances
    accounts = []
    total_bank = 0.0
    total_cash = 0.0
    total_wallet = 0.0
    
    async with db.execute("SELECT * FROM finance_accounts ORDER BY account_type ASC") as cursor:
        for row in await cursor.fetchall():
            acc = dict(row)
            accounts.append(acc)
            if acc["account_type"] == "bank":
                total_bank += acc["balance"]
            elif acc["account_type"] == "cash":
                total_cash += acc["balance"]
            elif acc["account_type"] == "wallet":
                total_wallet += acc["balance"]

    # 2. Today's Spend
    today_spend = 0.0
    today_upi = 0.0
    today_debit = 0.0
    today_cash_spend = 0.0
    
    query_today = "SELECT amount, payment_mode FROM finance_transactions WHERE date = ? AND type = 'expense'"
    async with db.execute(query_today, (today_str,)) as cursor:
        for row in await cursor.fetchall():
            amt = row["amount"]
            mode = row["payment_mode"]
            today_spend += amt
            if mode == "upi":
                today_upi += amt
            elif mode == "debit_card":
                today_debit += amt
            elif mode == "cash":
                today_cash_spend += amt

    # 3. Monthly Spend & Budgets (Batch aggregated in 2 fast queries)
    spend_by_category: Dict[str, float] = {}
    async with db.execute(
        "SELECT category_id, SUM(amount) as spent FROM finance_transactions WHERE date LIKE ? AND type = 'expense' AND category_id IS NOT NULL GROUP BY category_id",
        (f"{month_prefix}%",)
    ) as spend_cursor:
        for r in await spend_cursor.fetchall():
            cid = r["category_id"]
            spend_by_category[cid] = r["spent"] or 0.0

    total_monthly_spend = 0.0
    total_monthly_budget = 0.0
    categories = []
    
    async with db.execute("SELECT * FROM finance_categories ORDER BY name ASC") as cat_cursor:
        for cat in await cat_cursor.fetchall():
            cat_id = cat["id"]
            mb = cat["monthly_budget"] or 0.0
            total_monthly_budget += mb
            spent = spend_by_category.get(cat_id, 0.0)
            total_monthly_spend += spent
            pct = int((spent / mb) * 100) if mb > 0 else 0
            categories.append({
                "id": cat["id"],
                "name": cat["name"],
                "icon": cat["icon"],
                "monthly_budget": mb,
                "spent_this_month": round(spent, 2),
                "budget_percentage": pct
            })

    return {
        "accounts": accounts,
        "net_worth": round(total_bank + total_cash + total_wallet, 2),
        "total_bank": round(total_bank, 2),
        "total_cash": round(total_cash, 2),
        "total_wallet": round(total_wallet, 2),
        "today_spend": round(today_spend, 2),
        "today_breakdown": {
            "upi": round(today_upi, 2),
            "debit_card": round(today_debit, 2),
            "cash": round(today_cash_spend, 2)
        },
        "monthly_spend": round(total_monthly_spend, 2),
        "monthly_budget": round(total_monthly_budget, 2),
        "categories": categories
    }

@router.get("/accounts", response_model=List[FinanceAccountResponse])
async def list_accounts(db: aiosqlite.Connection = Depends(get_db)):
    accounts = []
    async with db.execute("SELECT * FROM finance_accounts ORDER BY balance DESC") as cursor:
        for row in await cursor.fetchall():
            accounts.append(FinanceAccountResponse(
                id=row["id"],
                name=row["name"],
                account_type=row["account_type"],
                balance=row["balance"],
                currency=row["currency"],
                updated_at=row["updated_at"]
            ))
    return accounts

@router.post("/accounts", response_model=FinanceAccountResponse)
async def create_account(acc: FinanceAccountCreate, db: aiosqlite.Connection = Depends(get_db)):
    acc_id = f"acc_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()
    await db.execute(
        "INSERT INTO finance_accounts (id, name, account_type, balance, currency, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (acc_id, acc.name, acc.account_type, acc.balance, acc.currency, now_iso)
    )
    await db.commit()
    res = FinanceAccountResponse(
        id=acc_id, name=acc.name, account_type=acc.account_type, balance=acc.balance, currency=acc.currency, updated_at=now_iso
    )
    await ws_manager.broadcast({"type": "FINANCE_ACCOUNT_UPDATED", "data": res.model_dump()})
    return res

@router.patch("/accounts/{account_id}", response_model=FinanceAccountResponse)
async def update_account(account_id: str, updates: FinanceAccountUpdate, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT * FROM finance_accounts WHERE id = ?", (account_id,)) as cursor:
        existing = await cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Account not found")

    now_iso = datetime.datetime.now().isoformat()
    fields = []
    values = []

    update_dict = updates.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        fields.append(f"{k} = ?")
        values.append(v)

    if fields:
        fields.append("updated_at = ?")
        values.append(now_iso)
        values.append(account_id)
        sql = f"UPDATE finance_accounts SET {', '.join(fields)} WHERE id = ?"
        await db.execute(sql, values)
        await db.commit()

    async with db.execute("SELECT * FROM finance_accounts WHERE id = ?", (account_id,)) as cursor:
        updated = await cursor.fetchone()

    res = FinanceAccountResponse(
        id=updated["id"],
        name=updated["name"],
        account_type=updated["account_type"],
        balance=updated["balance"],
        currency=updated["currency"],
        updated_at=updated["updated_at"]
    )
    await ws_manager.broadcast({"type": "FINANCE_ACCOUNT_UPDATED", "data": res.model_dump()})
    return res

@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM finance_accounts WHERE id = ?", (account_id,))
    await db.commit()
    await ws_manager.broadcast({"type": "FINANCE_ACCOUNT_DELETED", "data": {"id": account_id}})
    return {"success": True, "id": account_id}


@router.get("/transactions", response_model=List[TransactionResponse])
async def list_transactions(limit: int = 50, db: aiosqlite.Connection = Depends(get_db)):
    query = """
        SELECT t.*, 
               a.name as account_name,
               c.name as category_name,
               ta.name as transfer_to_account_name
        FROM finance_transactions t
        LEFT JOIN finance_accounts a ON t.account_id = a.id
        LEFT JOIN finance_categories c ON t.category_id = c.id
        LEFT JOIN finance_accounts ta ON t.transfer_to_account_id = ta.id
        ORDER BY t.date DESC, t.created_at DESC
        LIMIT ?
    """
    transactions = []
    async with db.execute(query, (limit,)) as cursor:
        for row in await cursor.fetchall():
            transactions.append(TransactionResponse(
                id=row["id"],
                account_id=row["account_id"],
                account_name=row["account_name"],
                category_id=row["category_id"],
                category_name=row["category_name"],
                type=row["type"],
                amount=row["amount"],
                payment_mode=row["payment_mode"],
                description=row["description"],
                transfer_to_account_id=row["transfer_to_account_id"],
                transfer_to_account_name=row["transfer_to_account_name"],
                date=row["date"],
                created_at=row["created_at"]
            ))
    return transactions

@router.post("/transactions", response_model=TransactionResponse)
async def create_transaction(tx: TransactionCreate, db: aiosqlite.Connection = Depends(get_db)):
    # 1. Verify source account exists
    async with db.execute("SELECT * FROM finance_accounts WHERE id = ?", (tx.account_id,)) as cursor:
        src_acc = await cursor.fetchone()
        if not src_acc:
            raise HTTPException(status_code=404, detail="Source account not found")

    tx_id = f"tx_{uuid.uuid4().hex[:10]}"
    now_iso = datetime.datetime.now().isoformat()

    # 2. Process account balance adjustment
    if tx.type == "expense":
        new_balance = src_acc["balance"] - tx.amount
        await db.execute("UPDATE finance_accounts SET balance = ?, updated_at = ? WHERE id = ?", (new_balance, now_iso, tx.account_id))
    elif tx.type == "income":
        new_balance = src_acc["balance"] + tx.amount
        await db.execute("UPDATE finance_accounts SET balance = ?, updated_at = ? WHERE id = ?", (new_balance, now_iso, tx.account_id))
    elif tx.type == "transfer":
        if not tx.transfer_to_account_id:
            raise HTTPException(status_code=400, detail="Transfer requires a destination account")
        async with db.execute("SELECT * FROM finance_accounts WHERE id = ?", (tx.transfer_to_account_id,)) as dst_cursor:
            dst_acc = await dst_cursor.fetchone()
            if not dst_acc:
                raise HTTPException(status_code=404, detail="Destination account not found")
        # Deduct from source, add to destination
        await db.execute("UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?", (tx.amount, now_iso, tx.account_id))
        await db.execute("UPDATE finance_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?", (tx.amount, now_iso, tx.transfer_to_account_id))

    # 3. Record transaction
    query = """
        INSERT INTO finance_transactions (
            id, account_id, category_id, type, amount, payment_mode, description, transfer_to_account_id, date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    await db.execute(query, (
        tx_id, tx.account_id, tx.category_id, tx.type, tx.amount, tx.payment_mode, tx.description, tx.transfer_to_account_id, tx.date, now_iso
    ))
    await db.commit()

    # 4. Fetch details for response
    cat_name = None
    if tx.category_id:
        async with db.execute("SELECT name FROM finance_categories WHERE id = ?", (tx.category_id,)) as c_cur:
            c_row = await c_cur.fetchone()
            if c_row:
                cat_name = c_row["name"]

    res = TransactionResponse(
        id=tx_id,
        account_id=tx.account_id,
        account_name=src_acc["name"],
        category_id=tx.category_id,
        category_name=cat_name,
        type=tx.type,
        amount=tx.amount,
        payment_mode=tx.payment_mode,
        description=tx.description,
        transfer_to_account_id=tx.transfer_to_account_id,
        date=tx.date,
        created_at=now_iso
    )

    await ws_manager.broadcast({"type": "FINANCE_TRANSACTION_CREATED", "data": res.model_dump()})
    return res

@router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Reverts balance effects and removes the transaction."""
    async with db.execute("SELECT * FROM finance_transactions WHERE id = ?", (tx_id,)) as cursor:
        tx = await cursor.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
            
    now_iso = datetime.datetime.now().isoformat()
    if tx["type"] == "expense":
        await db.execute("UPDATE finance_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?", (tx["amount"], now_iso, tx["account_id"]))
    elif tx["type"] == "income":
        await db.execute("UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?", (tx["amount"], now_iso, tx["account_id"]))
    elif tx["type"] == "transfer" and tx["transfer_to_account_id"]:
        await db.execute("UPDATE finance_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?", (tx["amount"], now_iso, tx["account_id"]))
        await db.execute("UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?", (tx["amount"], now_iso, tx["transfer_to_account_id"]))

    await db.execute("DELETE FROM finance_transactions WHERE id = ?", (tx_id,))
    await db.commit()
    await ws_manager.broadcast({"type": "FINANCE_TRANSACTION_DELETED", "data": {"id": tx_id}})
    return {"success": True, "id": tx_id}

# ========================================================
# BUDGET GUARDRAILS
# ========================================================

@router.get("/budgets", response_model=List[BudgetResponse])
async def list_budgets(year: Optional[int] = None, month: Optional[int] = None, db: aiosqlite.Connection = Depends(get_db)):
    """Retrieves all category budget guardrails with current spent amounts and threshold statuses."""
    now = datetime.datetime.now()
    cur_year = year or now.year
    cur_month = month or now.month
    month_prefix = f"{cur_year:04d}-{cur_month:02d}"

    spend_by_cat: Dict[str, float] = {}
    async with db.execute(
        "SELECT category_id, SUM(amount) as spent FROM finance_transactions WHERE date LIKE ? AND type = 'expense' AND category_id IS NOT NULL GROUP BY category_id",
        (f"{month_prefix}%",)
    ) as cursor:
        for r in await cursor.fetchall():
            spend_by_cat[r["category_id"]] = r["spent"] or 0.0

    query = """
        SELECT b.id, b.category_id, b.monthly_limit, b.period_year, b.period_month, b.created_at,
               c.name as category_name
        FROM finance_budgets b
        JOIN finance_categories c ON b.category_id = c.id
        WHERE b.period_year = ? AND b.period_month = ?
        ORDER BY c.name ASC
    """
    budgets = []
    found_cat_ids = set()
    async with db.execute(query, (cur_year, cur_month)) as cursor:
        for row in await cursor.fetchall():
            cid = row["category_id"]
            found_cat_ids.add(cid)
            limit = row["monthly_limit"]
            spent = spend_by_cat.get(cid, 0.0)
            pct = int((spent / limit) * 100) if limit > 0 else 0
            status = "ok"
            if pct >= 100:
                status = "exceeded"
            elif pct >= 90:
                status = "danger"
            elif pct >= 70:
                status = "warning"
            budgets.append(BudgetResponse(
                id=row["id"],
                category_id=cid,
                category_name=row["category_name"],
                monthly_limit=limit,
                period_year=row["period_year"],
                period_month=row["period_month"],
                spent_this_month=round(spent, 2),
                budget_percentage=pct,
                status=status,
                created_at=row["created_at"]
            ))

    async with db.execute("SELECT id, name, monthly_budget, created_at FROM finance_categories WHERE monthly_budget > 0 ORDER BY name ASC") as cat_cursor:
        for cat in await cat_cursor.fetchall():
            cid = cat["id"]
            if cid not in found_cat_ids:
                limit = cat["monthly_budget"]
                spent = spend_by_cat.get(cid, 0.0)
                pct = int((spent / limit) * 100) if limit > 0 else 0
                status = "ok"
                if pct >= 100:
                    status = "exceeded"
                elif pct >= 90:
                    status = "danger"
                elif pct >= 70:
                    status = "warning"
                budgets.append(BudgetResponse(
                    id=f"default_{cid}",
                    category_id=cid,
                    category_name=cat["name"],
                    monthly_limit=limit,
                    period_year=cur_year,
                    period_month=cur_month,
                    spent_this_month=round(spent, 2),
                    budget_percentage=pct,
                    status=status,
                    created_at=cat["created_at"]
                ))
    return budgets

@router.post("/budgets", response_model=BudgetResponse)
async def set_budget(b: BudgetCreate, db: aiosqlite.Connection = Depends(get_db)):
    """Sets or updates a monthly budget guardrail for a category."""
    now = datetime.datetime.now()
    year = b.period_year or now.year
    month = b.period_month or now.month
    b_id = f"bgt_{uuid.uuid4().hex[:10]}"
    now_iso = now.isoformat()

    async with db.execute("SELECT name FROM finance_categories WHERE id = ?", (b.category_id,)) as cursor:
        cat = await cursor.fetchone()
        if not cat:
            raise HTTPException(status_code=404, detail="Category not found")
        cat_name = cat["name"]

    async with db.execute(
        "SELECT id FROM finance_budgets WHERE category_id = ? AND period_year = ? AND period_month = ?",
        (b.category_id, year, month)
    ) as cursor:
        existing = await cursor.fetchone()

    if existing:
        b_id = existing["id"]
        await db.execute("UPDATE finance_budgets SET monthly_limit = ? WHERE id = ?", (b.monthly_limit, b_id))
    else:
        await db.execute(
            "INSERT INTO finance_budgets (id, category_id, monthly_limit, period_year, period_month, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (b_id, b.category_id, b.monthly_limit, year, month, now_iso)
        )
    await db.execute("UPDATE finance_categories SET monthly_budget = ? WHERE id = ?", (b.monthly_limit, b.category_id))
    await db.commit()

    month_prefix = f"{year:04d}-{month:02d}"
    spent = 0.0
    async with db.execute(
        "SELECT SUM(amount) as spent FROM finance_transactions WHERE date LIKE ? AND type = 'expense' AND category_id = ?",
        (f"{month_prefix}%", b.category_id)
    ) as sc:
        sr = await sc.fetchone()
        if sr and sr["spent"]:
            spent = sr["spent"]

    pct = int((spent / b.monthly_limit) * 100) if b.monthly_limit > 0 else 0
    status = "ok"
    if pct >= 100:
        status = "exceeded"
    elif pct >= 90:
        status = "danger"
    elif pct >= 70:
        status = "warning"

    res = BudgetResponse(
        id=b_id, category_id=b.category_id, category_name=cat_name, monthly_limit=b.monthly_limit,
        period_year=year, period_month=month, spent_this_month=round(spent, 2), budget_percentage=pct,
        status=status, created_at=now_iso
    )
    await ws_manager.broadcast({"type": "FINANCE_BUDGET_UPDATED", "data": res.model_dump()})
    return res

@router.delete("/budgets/{budget_id}")
async def delete_budget(budget_id: str, db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM finance_budgets WHERE id = ?", (budget_id,))
    await db.commit()
    return {"success": True, "id": budget_id}

# ========================================================
# RECURRING BILLS & SUBSCRIPTION RADAR
# ========================================================

@router.get("/recurring-bills", response_model=List[RecurringBillResponse])
async def list_recurring_bills(db: aiosqlite.Connection = Depends(get_db)):
    """Returns active recurring bills and subscriptions with computed days until due."""
    bills = []
    async with db.execute("SELECT * FROM recurring_bills WHERE is_active = 1 ORDER BY due_day_of_month ASC") as cursor:
        for row in await cursor.fetchall():
            r = dict(row)
            due_day = r["due_day_of_month"]
            days_until, is_overdue = calc_days_until_due(due_day)
            bills.append(RecurringBillResponse(
                id=r["id"],
                name=r["name"],
                amount=r["amount"],
                due_day_of_month=due_day,
                account_id=r.get("account_id"),
                category=r.get("category", "Utilities & Bills"),
                icon=r.get("icon", "Receipt"),
                color=r.get("color", "#6366f1"),
                is_active=bool(r.get("is_active", 1)),
                days_until_due=days_until,
                is_overdue=is_overdue,
                created_at=r["created_at"]
            ))
    bills.sort(key=lambda b: (0 if b.is_overdue else 1, b.days_until_due))
    return bills

@router.post("/recurring-bills", response_model=RecurringBillResponse)
async def create_recurring_bill(bill: RecurringBillCreate, db: aiosqlite.Connection = Depends(get_db)):
    b_id = f"bill_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()
    await db.execute(
        """INSERT INTO recurring_bills (id, name, amount, due_day_of_month, account_id, category, icon, color, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)""",
        (b_id, bill.name, bill.amount, bill.due_day_of_month, bill.account_id, bill.category, bill.icon, bill.color, now_iso)
    )
    await db.commit()
    days_until, is_overdue = calc_days_until_due(bill.due_day_of_month)
    res = RecurringBillResponse(
        id=b_id, name=bill.name, amount=bill.amount, due_day_of_month=bill.due_day_of_month,
        account_id=bill.account_id, category=bill.category, icon=bill.icon, color=bill.color,
        is_active=True, days_until_due=days_until, is_overdue=is_overdue, created_at=now_iso
    )
    await ws_manager.broadcast({"type": "RECURRING_BILL_CREATED", "data": res.model_dump()})
    return res

@router.delete("/recurring-bills/{bill_id}")
async def delete_recurring_bill(bill_id: str, db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM recurring_bills WHERE id = ?", (bill_id,))
    await db.commit()
    await ws_manager.broadcast({"type": "RECURRING_BILL_DELETED", "data": {"id": bill_id}})
    return {"success": True, "id": bill_id}
