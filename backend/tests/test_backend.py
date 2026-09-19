import pytest
import datetime
from app.services.recurrence import calculate_next_occurrence

def test_recurrence_daily():
    base = datetime.datetime(2026, 9, 12, 10, 0, 0)
    next_date = calculate_next_occurrence("daily", base)
    assert next_date == datetime.datetime(2026, 9, 13, 10, 0, 0)

def test_recurrence_weekdays():
    # Friday 2026-09-11 -> next weekday should be Monday 2026-09-14
    base = datetime.datetime(2026, 9, 11, 10, 0, 0) # Friday
    next_date = calculate_next_occurrence("weekdays", base)
    assert next_date.weekday() == 0 # Monday
    assert next_date == datetime.datetime(2026, 9, 14, 10, 0, 0)

def test_recurrence_weekly_specific():
    # Saturday 2026-09-12 -> next Mon
    base = datetime.datetime(2026, 9, 12, 10, 0, 0) # Saturday
    next_date = calculate_next_occurrence("weekly:mon,wed", base)
    assert next_date.weekday() in [0, 2] # Monday or Wednesday
    assert next_date == datetime.datetime(2026, 9, 14, 10, 0, 0)

def test_recurrence_custom_days():
    base = datetime.datetime(2026, 9, 12, 10, 0, 0)
    next_date = calculate_next_occurrence("custom:10d", base)
    assert next_date == datetime.datetime(2026, 9, 22, 10, 0, 0)

@pytest.mark.asyncio
async def test_database_and_finance_workflow(tmp_path, monkeypatch):
    import os
    import aiosqlite
    from app import database
    
    # Use temporary DB for test
    test_db_path = str(tmp_path / "test_sage.db")
    monkeypatch.setattr(database, "DB_PATH", test_db_path)
    
    await database.init_database()
    
    async with aiosqlite.connect(test_db_path) as db:
        db.row_factory = aiosqlite.Row
        
        # Verify default accounts seeded
        async with db.execute("SELECT * FROM finance_accounts WHERE account_type = 'bank'") as cursor:
            bank = await cursor.fetchone()
            assert bank is not None
            initial_balance = bank["balance"]
            
        # Simulate an expense transaction (e.g. ₹500 via UPI)
        expense_amount = 500.0
        new_balance = initial_balance - expense_amount
        await db.execute("UPDATE finance_accounts SET balance = ? WHERE id = ?", (new_balance, bank["id"]))
        await db.execute("""
            INSERT INTO finance_transactions (id, account_id, type, amount, payment_mode, description, date)
            VALUES ('tx_1', ?, 'expense', ?, 'upi', 'Lunch', '2026-09-12')
        """, (bank["id"], expense_amount))
        await db.commit()
        
        # Verify account updated
        async with db.execute("SELECT balance FROM finance_accounts WHERE id = ?", (bank["id"],)) as cursor:
            updated_bank = await cursor.fetchone()
            assert updated_bank["balance"] == initial_balance - 500.0
            
        # Verify transaction logged
        async with db.execute("SELECT * FROM finance_transactions WHERE id = 'tx_1'") as cursor:
            tx = await cursor.fetchone()
            assert tx["payment_mode"] == "upi"
            assert tx["amount"] == 500.0

@pytest.mark.asyncio
async def test_ai_task_improvisation():
    from app.services.ai_engine import improve_task_data, synthesize_domain_task
    
    # 1. Test Running improvisation (Zero robotic boilerplate)
    run_res = await improve_task_data("Go for a Run")
    assert "efficiently with high quality" not in run_res["description"]
    assert "associated checklist items" not in run_res["description"]
    # The assertions here used to look for "Pacing", a markdown heading that
    # was deliberately removed when descriptions became one plain paragraph.
    # What actually matters is that the text is about running rather than
    # generic filler, so check for that instead of a formatting artefact.
    assert "pacing" in run_res["description"].lower()
    assert "cadence" in run_res["description"]
    assert "#" not in run_res["description"]
    assert "*" not in run_res["description"]
    assert len(run_res["subtasks"]) >= 3
    assert run_res["category"] == "Health"
    
    # 2. Test Finance improvisation
    bill_res = synthesize_domain_task("pay electricity bill")
    assert bill_res["category"] == "Finance"
    assert "payment" in bill_res["description"].lower() or "receipt" in bill_res["description"].lower()
    assert len(bill_res["subtasks"]) >= 3
