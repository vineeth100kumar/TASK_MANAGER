"""
A capture with a time in it has to remind at that time.

"finish work by 18:30" is worth nothing as a reminder if the 18:30 is lost
between the words and the notification.
"""

import datetime

import aiosqlite
import pytest

from app import database
from app.services.capture_engine import parse_capture
from app.services.capture_service import commit_capture
from app.services.push_service import check_due_reminders

NOW = datetime.datetime(2026, 9, 18, 10, 0, 0)


@pytest.mark.parametrize(
    "text",
    [
        "finish work by 18:30",
        "finish work by 6.30pm",
        "finish work by 18.30",
    ],
)
def test_a_deadline_keeps_its_time_however_it_is_written(text):
    item = parse_capture(text, now=NOW).items[0]

    assert item.due_date == "2026-09-18"
    assert item.remind_at == "2026-09-18T18:30:00"


@pytest.mark.asyncio
async def test_the_time_survives_being_written_down(tmp_path, monkeypatch):
    db_path = str(tmp_path / "times.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        await commit_capture(db, "finish work by 18:30", now=NOW, use_ai=False)

        async with db.execute("SELECT due_date, remind_at FROM work_items") as cursor:
            row = await cursor.fetchone()

    assert row["due_date"] == "2026-09-18"
    assert row["remind_at"] == "2026-09-18T18:30:00"


@pytest.mark.asyncio
async def test_the_reminder_fires_at_that_time_and_not_before(tmp_path, monkeypatch):
    db_path = str(tmp_path / "fires.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()

    # A reminder due in five minutes' time.
    soon = datetime.datetime.now() + datetime.timedelta(minutes=5)
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, remind_at, is_completed) "
            "VALUES ('item_soon', 'Finish work', 'reminder', ?, 0)",
            (soon.isoformat(),),
        )
        await db.commit()

    await check_due_reminders(db_path)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT reminder_sent_at FROM work_items WHERE id = 'item_soon'") as cursor:
            row = await cursor.fetchone()
    assert row["reminder_sent_at"] is None, "fired before its time"

    # Now move it into the past and it should go.
    past = datetime.datetime.now() - datetime.timedelta(minutes=1)
    async with aiosqlite.connect(db_path) as db:
        await db.execute("UPDATE work_items SET remind_at = ? WHERE id = 'item_soon'", (past.isoformat(),))
        await db.commit()

    await check_due_reminders(db_path)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT reminder_sent_at FROM work_items WHERE id = 'item_soon'") as cursor:
            row = await cursor.fetchone()
    assert row["reminder_sent_at"] is not None
