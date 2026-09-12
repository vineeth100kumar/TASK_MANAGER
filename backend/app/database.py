import os
import aiosqlite
from typing import AsyncGenerator

DB_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data"))
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "sage_life.db")

SCHEMA_SQL = """
-- Users & Security
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP
);

-- Projects & Milestones
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT CHECK(status IN ('pending', 'achieved', 'delayed')) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unified Work Items (Tasks, Events, Reminders)
CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    entity_type TEXT CHECK(entity_type IN ('task', 'event', 'reminder')) NOT NULL DEFAULT 'task',
    status TEXT CHECK(status IN ('inbox', 'todo', 'in_progress', 'done', 'blocked', 'archived')) DEFAULT 'todo',
    priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
    energy TEXT CHECK(energy IN ('low', 'medium', 'high')) DEFAULT 'medium',
    
    due_date TEXT,
    start_at TEXT,
    end_at TEXT,
    remind_at TEXT,
    
    repeat_rule TEXT,
    next_occurrence TEXT,
    
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
    estimated_minutes INTEGER DEFAULT 30,
    actual_minutes INTEGER DEFAULT 0,
    depends_on TEXT DEFAULT '[]',
    
    is_completed INTEGER DEFAULT 0,
    completed_at TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_completed INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily Performance & Review
CREATE TABLE IF NOT EXISTS daily_reviews (
    date TEXT PRIMARY KEY,
    tasks_planned INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    focus_minutes_logged INTEGER DEFAULT 0,
    productivity_score INTEGER DEFAULT 0,
    reflection_notes TEXT,
    ai_summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Finance Accounts, Categories, & Transactions
CREATE TABLE IF NOT EXISTS finance_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_type TEXT CHECK(account_type IN ('bank', 'cash', 'wallet', 'credit')) NOT NULL,
    balance REAL NOT NULL DEFAULT 0.0,
    currency TEXT DEFAULT 'INR',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    monthly_budget REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES finance_categories(id) ON DELETE SET NULL,
    type TEXT CHECK(type IN ('expense', 'income', 'transfer')) NOT NULL,
    amount REAL NOT NULL,
    payment_mode TEXT CHECK(payment_mode IN ('upi', 'debit_card', 'cash', 'net_banking', 'credit_card')) NOT NULL,
    description TEXT,
    transfer_to_account_id TEXT REFERENCES finance_accounts(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Push Subscriptions (iOS & PC Web Push)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    device_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency that provides an async SQLite connection with WAL mode."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode = WAL;")
        await db.execute("PRAGMA foreign_keys = ON;")
        await db.execute("PRAGMA synchronous = NORMAL;")
        yield db

async def init_database():
    """Run migrations and seed initial default data if empty."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA journal_mode = WAL;")
        await db.execute("PRAGMA foreign_keys = ON;")
        await db.execute("PRAGMA synchronous = NORMAL;")
        await db.executescript(SCHEMA_SQL)
        await db.commit()

        # Seed default financial accounts if none exist
        async with db.execute("SELECT COUNT(*) FROM finance_accounts") as cursor:
            count = (await cursor.fetchone())[0]
            if count == 0:
                accounts = [
                    ("acc_bank_1", "Primary Bank Account", "bank", 25000.0, "INR"),
                    ("acc_cash_1", "Cash in Hand", "cash", 3500.0, "INR"),
                    ("acc_wallet_1", "UPI / Digital Wallet", "wallet", 1200.0, "INR"),
                ]
                await db.executemany(
                    "INSERT INTO finance_accounts (id, name, account_type, balance, currency) VALUES (?, ?, ?, ?, ?)",
                    accounts,
                )

        # Seed default financial categories with budgets if none exist
        async with db.execute("SELECT COUNT(*) FROM finance_categories") as cursor:
            count = (await cursor.fetchone())[0]
            if count == 0:
                categories = [
                    ("cat_food", "Food & Dining", "Utensils", 8000.0),
                    ("cat_groceries", "Groceries", "ShoppingCart", 6000.0),
                    ("cat_transport", "Transport & Fuel", "Car", 3000.0),
                    ("cat_bills", "Utilities & Bills", "Zap", 4500.0),
                    ("cat_entertainment", "Entertainment & Subs", "Film", 2000.0),
                    ("cat_shopping", "Shopping", "Bag", 4000.0),
                ]
                await db.executemany(
                    "INSERT INTO finance_categories (id, name, icon, monthly_budget) VALUES (?, ?, ?, ?)",
                    categories,
                )

        await db.commit()
