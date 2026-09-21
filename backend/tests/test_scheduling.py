"""
Recurrence beyond the five fixed options, and hand-sorted order.

The engine already understood more than the interface ever offered. What was
genuinely missing was an interval, a weekday-of-month rule, and any way for a
repeat to stop.
"""

import datetime

import pytest

from app.services.recurrence import (
    calculate_next_occurrence,
    describe_rule,
    recurrence_has_ended,
)


# --- intervals -------------------------------------------------------------

def test_daily_interval():
    base = datetime.datetime(2026, 9, 12, 10, 0)
    assert calculate_next_occurrence("daily:3", base) == datetime.datetime(2026, 9, 15, 10, 0)


def test_every_other_tuesday_skips_a_week():
    # Tuesday 2026-09-15. Every other Tuesday is 2026-09-29, not the 22nd.
    base = datetime.datetime(2026, 9, 15, 9, 0)
    assert calculate_next_occurrence("weekly:2:tue", base) == datetime.datetime(2026, 9, 29, 9, 0)


def test_weekly_without_an_interval_is_unchanged():
    # The old syntax has to keep meaning what it meant.
    base = datetime.datetime(2026, 9, 12, 10, 0)  # Saturday
    assert calculate_next_occurrence("weekly:mon,wed", base) == datetime.datetime(2026, 9, 14, 10, 0)


def test_monthly_day_lands_this_month_when_it_is_still_ahead():
    base = datetime.datetime(2026, 9, 3, 8, 30)
    assert calculate_next_occurrence("monthly:15", base) == datetime.datetime(2026, 9, 15, 8, 30)


def test_monthly_day_rolls_over_when_it_has_passed():
    base = datetime.datetime(2026, 9, 20, 8, 30)
    assert calculate_next_occurrence("monthly:15", base) == datetime.datetime(2026, 10, 15, 8, 30)


def test_monthly_day_clamps_to_a_short_month():
    base = datetime.datetime(2026, 1, 31, 9, 0)
    assert calculate_next_occurrence("monthly:31", base) == datetime.datetime(2026, 2, 28, 9, 0)


# --- weekday of month ------------------------------------------------------

def test_third_tuesday_of_the_month():
    # September 2026 starts on a Tuesday, so its third Tuesday is the 15th.
    base = datetime.datetime(2026, 9, 1, 12, 0)
    assert calculate_next_occurrence("monthly:3rd-tue", base) == datetime.datetime(2026, 9, 15, 12, 0)


def test_last_friday_of_the_month():
    base = datetime.datetime(2026, 9, 1, 12, 0)
    found = calculate_next_occurrence("monthly:last-fri", base)
    assert found.weekday() == 4
    assert found.month == 9
    # The last Friday leaves fewer than seven days in the month behind it.
    assert (datetime.date(2026, 9, 30) - found.date()).days < 7


def test_a_fifth_weekday_falls_back_to_the_last_one():
    base = datetime.datetime(2026, 9, 1, 12, 0)
    found = calculate_next_occurrence("monthly:4th-tue", base)
    assert found.weekday() == 1


# --- yearly ----------------------------------------------------------------

def test_yearly_keeps_the_date():
    base = datetime.datetime(2026, 3, 9, 7, 0)
    assert calculate_next_occurrence("yearly", base) == datetime.datetime(2027, 3, 9, 7, 0)


def test_yearly_from_a_leap_day_clamps():
    base = datetime.datetime(2028, 2, 29, 7, 0)
    assert calculate_next_occurrence("yearly", base) == datetime.datetime(2029, 2, 28, 7, 0)


# --- when a repeat stops ---------------------------------------------------

def test_a_repeat_with_no_end_never_ends():
    later = datetime.datetime(2030, 1, 1)
    assert recurrence_has_ended(None, None, 99, later) is False


def test_a_count_stops_it():
    later = datetime.datetime(2026, 10, 1)
    assert recurrence_has_ended(None, 10, 9, later) is False
    assert recurrence_has_ended(None, 10, 10, later) is True


def test_an_end_date_stops_it():
    assert recurrence_has_ended("2026-10-31", None, 0, datetime.datetime(2026, 10, 30)) is False
    assert recurrence_has_ended("2026-10-31", None, 0, datetime.datetime(2026, 11, 1)) is True


def test_the_end_date_itself_still_counts():
    assert recurrence_has_ended("2026-10-31", None, 0, datetime.datetime(2026, 10, 31, 23, 0)) is False


def test_a_malformed_end_date_does_not_stop_everything():
    # Better to keep repeating than to silently swallow the rule.
    assert recurrence_has_ended("not a date", None, 0, datetime.datetime(2026, 10, 1)) is False


# --- how a rule reads ------------------------------------------------------

@pytest.mark.parametrize(
    "rule,expected",
    [
        (None, "One-time"),
        ("daily", "Every day"),
        ("daily:2", "Every other day"),
        ("daily:5", "Every 5 days"),
        ("weekdays", "Every weekday"),
        ("weekly:mon,fri", "Every Mon, Fri"),
        ("weekly:2:tue", "Every other week on Tue"),
        ("monthly:15", "Day 15 of the month"),
        ("monthly:3rd-tue", "The 3rd Tue of the month"),
        ("monthly:last-fri", "The last Fri of the month"),
        ("yearly", "Every year"),
        ("custom:10d", "Every 10 days"),
    ],
)
def test_describe_rule(rule, expected):
    assert describe_rule(rule) == expected


# --- ordering --------------------------------------------------------------

@pytest.mark.asyncio
async def test_reorder_places_an_item_between_two_others(tmp_path, monkeypatch):
    import os

    import aiosqlite

    from app import database

    monkeypatch.setattr(database, "DB_PATH", os.path.join(tmp_path, "test.db"))
    await database.init_database()

    async with aiosqlite.connect(database.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        now = datetime.datetime.now().isoformat()
        for index, name in enumerate(["first", "second", "third"]):
            await db.execute(
                "INSERT INTO work_items (id, title, position, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (name, name.title(), (index + 1) * 1024.0, now, now),
            )
        await db.commit()

        # Drop "third" between "first" and "second".
        async with db.execute(
            "SELECT position FROM work_items WHERE id IN ('first', 'second') ORDER BY position"
        ) as cursor:
            above, below = [row["position"] for row in await cursor.fetchall()]

        await db.execute(
            "UPDATE work_items SET position = ? WHERE id = ?", ((above + below) / 2, "third")
        )
        await db.commit()

        async with db.execute(
            "SELECT id FROM work_items ORDER BY position ASC"
        ) as cursor:
            order = [row["id"] for row in await cursor.fetchall()]

    assert order == ["first", "third", "second"]


@pytest.mark.asyncio
async def test_new_columns_exist_after_migration(tmp_path, monkeypatch):
    import os

    import aiosqlite

    from app import database

    monkeypatch.setattr(database, "DB_PATH", os.path.join(tmp_path, "test.db"))
    await database.init_database()

    async with aiosqlite.connect(database.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("PRAGMA table_info(work_items)") as cursor:
            columns = {row["name"] for row in await cursor.fetchall()}

    assert {"location", "is_all_day", "position", "repeat_until", "repeat_count", "repeat_done"} <= columns


@pytest.mark.asyncio
async def test_migration_backfills_position_on_an_existing_database(tmp_path, monkeypatch):
    """A database that predates the column still ends up with a usable order."""
    import os

    import aiosqlite

    from app import database

    db_path = os.path.join(tmp_path, "legacy.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)

    # A work_items table as it was before this change: no position column.
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "CREATE TABLE work_items ("
            "id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, "
            "entity_type TEXT DEFAULT 'task', status TEXT DEFAULT 'todo', "
            "priority TEXT DEFAULT 'medium', energy TEXT DEFAULT 'medium', "
            "due_date TEXT, start_at TEXT, end_at TEXT, remind_at TEXT, "
            "repeat_rule TEXT, next_occurrence TEXT, project_id TEXT, milestone_id TEXT, "
            "estimated_minutes INTEGER DEFAULT 30, actual_minutes INTEGER DEFAULT 0, "
            "depends_on TEXT DEFAULT '[]', is_completed INTEGER DEFAULT 0, completed_at TEXT, "
            "created_at TIMESTAMP, updated_at TIMESTAMP)"
        )
        for index, name in enumerate(["old_a", "old_b", "old_c"]):
            stamp = f"2026-09-0{index + 1}T09:00:00"
            await db.execute(
                "INSERT INTO work_items (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (name, name, stamp, stamp),
            )
        await db.commit()

    await database.init_database()

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, position FROM work_items ORDER BY position ASC"
        ) as cursor:
            rows = [(row["id"], row["position"]) for row in await cursor.fetchall()]

    assert [row[0] for row in rows] == ["old_a", "old_b", "old_c"]
    assert all(row[1] is not None for row in rows)
