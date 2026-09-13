import os
import asyncio
import aiosqlite
from typing import AsyncGenerator, Optional

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

-- High Performance Indexes for Raspberry Pi 5
CREATE INDEX IF NOT EXISTS idx_work_items_due_completed ON work_items(due_date, is_completed);
CREATE INDEX IF NOT EXISTS idx_work_items_entity_status ON work_items(entity_type, status);
CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority);
CREATE INDEX IF NOT EXISTS idx_work_items_milestone ON work_items(milestone_id);
CREATE INDEX IF NOT EXISTS idx_work_items_project ON work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_work_item ON subtasks(work_item_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_pos ON subtasks(position);
CREATE INDEX IF NOT EXISTS idx_finance_tx_account ON finance_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_finance_tx_date ON finance_transactions(date);
CREATE INDEX IF NOT EXISTS idx_finance_tx_category ON finance_transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_finance_tx_type_date ON finance_transactions(type, date);
"""

class SQLitePool:
    """Pre-warmed connection pool for high-throughput, low-latency async SQLite on Raspberry Pi 5."""
    def __init__(self, db_path: str, max_connections: int = 6):
        self.db_path = db_path
        self.max_connections = max_connections
        self._pool: Optional[asyncio.Queue] = None
        self._all_conns: list[aiosqlite.Connection] = []
        self._initialized = False
        self._lock = asyncio.Lock()

    async def init(self):
        async with self._lock:
            if self._initialized:
                return
            self._pool = asyncio.Queue(maxsize=self.max_connections)
            for _ in range(self.max_connections):
                conn = await aiosqlite.connect(self.db_path)
                conn.row_factory = aiosqlite.Row
                await conn.execute("PRAGMA synchronous = NORMAL;")
                await conn.execute("PRAGMA busy_timeout = 10000;")
                await conn.execute("PRAGMA foreign_keys = ON;")
                await conn.execute("PRAGMA cache_size = -64000;")
                self._all_conns.append(conn)
                await self._pool.put(conn)
            self._initialized = True

    async def acquire(self) -> aiosqlite.Connection:
        if not self._initialized:
            await self.init()
        assert self._pool is not None
        return await self._pool.get()

    async def release(self, conn: aiosqlite.Connection):
        if self._pool is not None:
            await self._pool.put(conn)

    async def close(self):
        async with self._lock:
            for conn in self._all_conns:
                try:
                    await conn.close()
                except Exception:
                    pass
            self._all_conns.clear()
            self._pool = None
            self._initialized = False

db_pool = SQLitePool(DB_PATH, max_connections=6)

async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency that provides an async SQLite connection from the pre-warmed pool."""
    conn = await db_pool.acquire()
    try:
        yield conn
    except Exception:
        try:
            await conn.rollback()
        except Exception:
            pass
        raise
    finally:
        await db_pool.release(conn)

async def init_database():
    """Run migrations, tune database pragmas, create indexes, and seed initial data."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        # WAL mode & memory optimizations for Pi
        await db.execute("PRAGMA journal_mode = WAL;")
        await db.execute("PRAGMA synchronous = NORMAL;")
        await db.execute("PRAGMA busy_timeout = 10000;")
        await db.execute("PRAGMA foreign_keys = ON;")
        await db.execute("PRAGMA temp_store = MEMORY;")
        await db.execute("PRAGMA mmap_size = 268435456;")
        await db.execute("PRAGMA cache_size = -64000;")
        await db.executescript(SCHEMA_SQL)
        await db.commit()

        # Seed default financial accounts if none exist
        async with db.execute("SELECT COUNT(*) FROM finance_accounts") as cursor:
            count = (await cursor.fetchone())[0]
            if count == 0:
                accounts = [
                    ("acc_bank_1", "Primary Bank Account", "bank", 0.0, "INR"),
                    ("acc_cash_1", "Cash in Hand", "cash", 0.0, "INR"),
                    ("acc_wallet_1", "UPI / Digital Wallet", "wallet", 0.0, "INR"),
                ]
                await db.executemany(
                    "INSERT INTO finance_accounts (id, name, account_type, balance, currency) VALUES (?, ?, ?, ?, ?)",
                    accounts,
                )

        # Automatically wipe legacy mock placeholder balances (25000 / 3500) if no transactions have been logged
        async with db.execute("SELECT COUNT(*) FROM finance_transactions") as tx_cursor:
            tx_count = (await tx_cursor.fetchone())[0]
            if tx_count == 0:
                await db.execute("UPDATE finance_accounts SET balance = 0.0 WHERE balance IN (25000.0, 3500.0, 1200.0)")

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

        # Auto-clean any accidental erroneous 11.3 baby naming expense transaction and restore account balance
        try:
            async with db.execute("SELECT id, account_id, amount FROM finance_transactions WHERE amount = 11.3 AND description LIKE '%baby naming%'") as err_cursor:
                err_tx = await err_cursor.fetchone()
                if err_tx:
                    tx_id = err_tx[0]
                    acc_id = err_tx[1]
                    amt = float(err_tx[2])
                    await db.execute("UPDATE finance_accounts SET balance = balance + ? WHERE id = ?", (amt, acc_id))
                    await db.execute("DELETE FROM finance_transactions WHERE id = ?", (tx_id,))
                    print(f"Auto-healed: refunded {amt} to account {acc_id} and deleted erroneous transaction.")

            # Ensure baby naming item is correctly categorized as an event
            await db.execute("UPDATE work_items SET entity_type = 'event', due_date = date('now') WHERE title LIKE '%baby naming%' AND entity_type = 'task'")
            await db.commit()
        except Exception as e:
            print(f"Auto-heal notice: {e}")
