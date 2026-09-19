"""
Regression tests for the backend bugs fixed alongside quick capture.

Each test fails against the behaviour that was there before.
"""

import datetime

import aiosqlite
import pytest

from app import database
from app.services.planner_service import compute_big_rock_suggestions
from app.services.push_service import check_due_reminders


class _RecordingWs:
    def __init__(self):
        self.messages = []

    async def broadcast(self, message):
        self.messages.append(message)


async def _fresh_db(tmp_path, monkeypatch, name):
    db_path = str(tmp_path / name)
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()
    return db_path


# ---------------------------------------------------------------------------
# Reminders fired once, not once a minute forever
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_due_reminder_fires_once_and_not_again(tmp_path, monkeypatch):
    db_path = await _fresh_db(tmp_path, monkeypatch, "reminders.db")
    past = (datetime.datetime.now() - datetime.timedelta(minutes=5)).isoformat()

    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, remind_at, is_completed) "
            "VALUES ('item_1', 'Leave office', 'reminder', ?, 0)",
            (past,),
        )
        await db.commit()

    ws = _RecordingWs()
    await check_due_reminders(db_path, ws)
    assert len(ws.messages) == 1

    # The worker runs every 60 seconds. Before reminder_sent_at existed, this
    # second pass notified again, and so did every pass after it.
    await check_due_reminders(db_path, ws)
    assert len(ws.messages) == 1


@pytest.mark.asyncio
async def test_moving_a_reminder_lets_it_fire_again(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    db_path = await _fresh_db(tmp_path, monkeypatch, "reschedule.db")
    past = (datetime.datetime.now() - datetime.timedelta(minutes=5)).isoformat()

    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, remind_at, is_completed) "
            "VALUES ('item_1', 'Leave office', 'reminder', ?, 0)",
            (past,),
        )
        await db.commit()

    ws = _RecordingWs()
    await check_due_reminders(db_path, ws)
    assert len(ws.messages) == 1

    from app import config, main
    from app.database import db_pool

    monkeypatch.setattr(db_pool, "db_path", db_path)
    with TestClient(main.app) as client:
        client.patch(
            "/api/v1/items/item_1",
            json={"remind_at": (datetime.datetime.now() - datetime.timedelta(minutes=1)).isoformat()},
            headers={"Authorization": f"Bearer {config.API_SECRET}"},
        )

    await check_due_reminders(db_path, ws)
    assert len(ws.messages) == 2


# ---------------------------------------------------------------------------
# A recurring task comes back
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_completing_a_recurring_task_creates_the_next_one(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, main
    from app.database import db_pool

    db_path = await _fresh_db(tmp_path, monkeypatch, "recurring.db")
    monkeypatch.setattr(db_pool, "db_path", db_path)

    with TestClient(main.app) as client:
        headers = {"Authorization": f"Bearer {config.API_SECRET}"}
        created = client.post(
            "/api/v1/items",
            json={"title": "Take medicine", "entity_type": "reminder",
                  "repeat_rule": "daily", "due_date": "2026-09-18",
                  "subtasks": ["Morning dose"]},
            headers=headers,
        ).json()

        client.patch(f"/api/v1/items/{created['id']}", json={"is_completed": True}, headers=headers)

        items = client.get("/api/v1/items", headers=headers).json()

    # The completed one stays as history, and the next cycle is a new open item.
    assert len(items) == 2
    done = [i for i in items if i["is_completed"]]
    pending = [i for i in items if not i["is_completed"]]
    assert len(done) == 1 and len(pending) == 1
    assert pending[0]["title"] == "Take medicine"
    assert pending[0]["repeat_rule"] == "daily"
    assert pending[0]["due_date"] > done[0]["due_date"]
    # Its checklist comes back unticked.
    assert [s["is_completed"] for s in pending[0]["subtasks"]] == [False]


# ---------------------------------------------------------------------------
# Ordering and counting
# ---------------------------------------------------------------------------

def test_overdue_outranks_due_today():
    today = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

    ranked = compute_big_rock_suggestions([
        {"id": "today", "title": "Due today", "priority": "medium", "due_date": today},
        {"id": "overdue", "title": "Overdue", "priority": "medium", "due_date": yesterday},
    ], limit=2)

    assert ranked[0]["id"] == "overdue"


@pytest.mark.asyncio
async def test_debrief_counts_only_the_tasks_it_moved(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, main
    from app.database import db_pool

    db_path = await _fresh_db(tmp_path, monkeypatch, "debrief.db")
    monkeypatch.setattr(db_pool, "db_path", db_path)
    today = datetime.date.today().isoformat()
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, status, due_date, is_completed) "
            "VALUES ('unfinished', 'Unfinished', 'task', 'todo', ?, 0)", (today,))
        # Already scheduled for tomorrow, so it was never migrated.
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, status, due_date, is_completed) "
            "VALUES ('already', 'Already tomorrow', 'task', 'todo', ?, 0)", (tomorrow,))
        await db.commit()

    with TestClient(main.app) as client:
        result = client.post("/api/v1/planner/debrief", json={"date": today},
                             headers={"Authorization": f"Bearer {config.API_SECRET}"}).json()

    assert result["migrated_to_tomorrow"] == 1
