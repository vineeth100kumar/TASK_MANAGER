"""
A capture must never create the same thing twice.

Two separate ways it could: the local model returning an item it already
returned, and the same capture reaching the Pi more than once (a retry, a
double tap, a phone resending after it woke up).
"""

import datetime

import aiosqlite
import pytest
import pytest_asyncio

from app import database
from app.services.capture_ai import reconcile
from app.services.capture_engine import dedupe_items, parse_capture
from app.services.capture_service import (
    claim_capture,
    commit_capture,
    release_capture,
    remember_capture,
)

NOW = datetime.datetime(2026, 9, 18, 10, 0, 0)


# ---------------------------------------------------------------------------
# The model repeating itself
# ---------------------------------------------------------------------------

def test_a_model_that_repeats_itself_creates_one_of_each():
    text = "going out with cousins at 7.30 so finish and leave office by 6.30pm"
    baseline = parse_capture(text, now=NOW).items

    # qwen2.5:1.5b asked for a list will sometimes emit each item twice.
    doubled = [
        {"title": "Going out with cousins", "type": "event", "time": "19:30"},
        {"title": "Leave office", "type": "reminder", "time": "18:30", "is_deadline": True},
        {"title": "Going out with cousins", "type": "event", "time": "19:30"},
        {"title": "Leave office", "type": "reminder", "time": "18:30", "is_deadline": True},
    ]

    items = reconcile(doubled, baseline, NOW)

    titles = [i.title for i in items]
    assert titles == ["Going out with cousins", "Leave office"]


def test_the_same_title_at_different_times_is_two_things():
    # "call mum at 5 and again at 8" is genuinely two calls, not one repeated.
    baseline = parse_capture("call mum at 5pm and call mum at 8pm", now=NOW).items
    ai_items = [
        {"title": "Call mum", "type": "task", "time": "17:00"},
        {"title": "Call mum", "type": "task", "time": "20:00"},
    ]

    items = reconcile(ai_items, baseline, NOW)

    assert len(items) == 2
    assert items[0].start_at != items[1].start_at


def test_dedupe_keeps_the_first_reading():
    items = parse_capture("buy milk and buy milk", now=NOW).items
    assert len(dedupe_items(items + items)) == len(dedupe_items(items))


# ---------------------------------------------------------------------------
# The stray fragment
# ---------------------------------------------------------------------------

def test_a_dangling_verb_is_not_a_task():
    # "so finish and leave office" splits on "and", stranding "finish". On its
    # own it is a word, not something to do.
    items = parse_capture(
        "going out with cousins at 7.30 so finish and leave office by 6.30pm", now=NOW
    ).items

    assert [i.title for i in items] == ["Going out with cousins", "Leave office"]


def test_a_verb_with_an_object_survives():
    items = parse_capture("finish the tax return and leave office by 6.30pm", now=NOW).items
    assert "Finish the tax return" in [i.title for i in items]


def test_a_bare_verb_with_a_time_survives():
    items = parse_capture("call at 5pm", now=NOW).items
    assert len(items) == 1


# ---------------------------------------------------------------------------
# The same capture arriving twice
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "capture.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()
    async with aiosqlite.connect(db_path) as connection:
        connection.row_factory = aiosqlite.Row
        yield connection


@pytest.mark.asyncio
async def test_only_the_first_attempt_owns_a_capture(db):
    mine, previous = await claim_capture(db, "req-1", now=NOW)
    assert mine is True and previous is None

    # The retry does not get to create anything.
    mine_again, previous = await claim_capture(db, "req-1", now=NOW)
    assert mine_again is False
    # Nothing recorded yet, so the first attempt is still working.
    assert previous is None


@pytest.mark.asyncio
async def test_a_repeat_is_answered_with_what_the_first_attempt_created(db):
    await claim_capture(db, "req-2", now=NOW)
    await remember_capture(db, "req-2", {"success": True, "items": [{"id": "item_abc"}]})

    mine, previous = await claim_capture(db, "req-2", now=NOW)

    assert mine is False
    assert previous == {"success": True, "items": [{"id": "item_abc"}]}


@pytest.mark.asyncio
async def test_a_failed_attempt_hands_the_capture_back(db):
    await claim_capture(db, "req-3", now=NOW)
    await release_capture(db, "req-3")

    # The retry has to be able to do the work the failed attempt did not.
    mine, _ = await claim_capture(db, "req-3", now=NOW)
    assert mine is True


@pytest.mark.asyncio
async def test_a_stale_claim_is_forgotten(db):
    await claim_capture(db, "req-4", now=NOW - datetime.timedelta(days=2))

    mine, _ = await claim_capture(db, "req-4", now=NOW)

    assert mine is True


@pytest.mark.asyncio
async def test_committing_twice_under_one_id_writes_one_set_of_rows(db):
    text = "dinner with sam tomorrow at 8pm"

    mine, _ = await claim_capture(db, "req-5", now=NOW)
    assert mine
    first = await commit_capture(db, text, now=NOW, use_ai=False)
    await remember_capture(db, "req-5", {"items": first["created"]})

    mine_again, previous = await claim_capture(db, "req-5", now=NOW)
    assert mine_again is False
    assert previous["items"] == first["created"]

    async with db.execute("SELECT COUNT(*) AS n FROM work_items") as cursor:
        row = await cursor.fetchone()
    assert row["n"] == len(first["created"])


# ---------------------------------------------------------------------------
# End to end, through the endpoint the app actually calls
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_posting_the_same_capture_twice_creates_one_set(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, main
    from app.database import db_pool

    db_path = str(tmp_path / "e2e.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()
    monkeypatch.setattr(db_pool, "db_path", db_path)

    app = main.app
    headers = {"Authorization": f"Bearer {config.API_SECRET}"}
    body = {
        "text": "dinner with sam tomorrow at 8pm so leave by 7.15pm",
        "use_ai": False,
        "request_id": "same-note",
    }

    with TestClient(app) as client:
        first = client.post("/api/v1/ai/capture", json=body, headers=headers).json()
        second = client.post("/api/v1/ai/capture", json=body, headers=headers).json()

        assert first["committed"] is True
        assert len(first["items"]) >= 2

        # The retry is answered, not acted on.
        assert second.get("duplicate") is True
        assert [i["id"] for i in second["items"]] == [i["id"] for i in first["items"]]

        listed = client.get("/api/v1/items", headers=headers).json()

    assert len(listed) == len(first["items"])
