"""
Tests for the adaptive timeout, the busy signal, and the broadcast payload shape.
"""

import asyncio
import datetime

import aiosqlite
import pytest

from app import database
from app.services import ai_runtime
from app.services.item_serializer import load_item


@pytest.fixture(autouse=True)
def clean_runtime():
    ai_runtime.reset_for_tests()
    yield
    ai_runtime.reset_for_tests()


class _RecordingWs:
    def __init__(self):
        self.messages = []

    async def broadcast(self, message):
        self.messages.append(message)


# ---------------------------------------------------------------------------
# The budget learns from this Pi
# ---------------------------------------------------------------------------

def test_a_cold_model_gets_a_generous_budget():
    # Nothing observed yet: the weights may still be coming off the SD card.
    assert ai_runtime.adaptive_timeout() == ai_runtime.COLD_START_TIMEOUT_SECONDS


def test_the_budget_follows_observed_times():
    for _ in range(5):
        ai_runtime._stats.record_success(5.0)

    budget = ai_runtime.adaptive_timeout()

    # 5s typical, with headroom, and nowhere near the cold-start ceiling.
    assert budget == pytest.approx(5.0 * ai_runtime.TIMEOUT_SAFETY_FACTOR)
    assert budget < ai_runtime.COLD_START_TIMEOUT_SECONDS


def test_a_very_fast_model_still_gets_the_floor():
    # Headroom on a 1s response would be 2.5s, which is too tight to survive
    # the Pi being busy with anything else.
    for _ in range(5):
        ai_runtime._stats.record_success(1.0)

    assert ai_runtime.adaptive_timeout() == ai_runtime.MIN_TIMEOUT_SECONDS


def test_a_faster_pi_gets_a_shorter_budget_than_a_slower_one():
    for _ in range(5):
        ai_runtime._stats.record_success(1.0)
    fast = ai_runtime.adaptive_timeout()

    ai_runtime.reset_for_tests()
    for _ in range(5):
        ai_runtime._stats.record_success(8.0)
    slow = ai_runtime.adaptive_timeout()

    assert fast < slow


def test_one_slow_run_does_not_move_the_budget_much():
    for _ in range(6):
        ai_runtime._stats.record_success(2.0)
    steady = ai_runtime.adaptive_timeout()

    # The Pi was busy with something else for one call.
    ai_runtime._stats.record_success(12.0)

    # A median, not a mean, so a single outlier barely registers.
    assert ai_runtime.adaptive_timeout() == pytest.approx(steady, abs=1.5)


def test_a_long_note_gets_proportionally_longer():
    for _ in range(5):
        ai_runtime._stats.record_success(3.0)

    short = ai_runtime.adaptive_timeout(input_chars=40)
    long = ai_runtime.adaptive_timeout(input_chars=600)

    assert long > short


def test_the_budget_stays_inside_its_bounds():
    for _ in range(5):
        ai_runtime._stats.record_success(0.05)
    assert ai_runtime.adaptive_timeout() == ai_runtime.MIN_TIMEOUT_SECONDS

    ai_runtime.reset_for_tests()
    for _ in range(5):
        ai_runtime._stats.record_success(29.0)
    assert ai_runtime.adaptive_timeout(input_chars=5000) == ai_runtime.MAX_TIMEOUT_SECONDS


def test_repeated_failures_shorten_the_wait():
    for _ in range(5):
        ai_runtime._stats.record_success(6.0)
    healthy = ai_runtime.adaptive_timeout()

    ai_runtime._stats.record_failure("ConnectError")
    ai_runtime._stats.record_failure("ConnectError")

    # Ollama looks stopped; stop holding every capture open for the full budget.
    assert ai_runtime.adaptive_timeout() < healthy


# ---------------------------------------------------------------------------
# Telling everyone the Pi is thinking
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_an_inference_announces_its_start_and_finish(monkeypatch):
    ws = _RecordingWs()
    monkeypatch.setattr(ai_runtime, "ws_manager", ws)

    async with ai_runtime.inference(label="capture", input_chars=50):
        assert ai_runtime.status()["busy"] is True

    assert [m["type"] for m in ws.messages] == ["AI_BUSY", "AI_BUSY"]
    assert ws.messages[0]["data"]["busy"] is True
    assert ws.messages[1]["data"]["busy"] is False
    assert ws.messages[1]["data"]["elapsed_seconds"] >= 0
    assert ai_runtime.status()["busy"] is False


@pytest.mark.asyncio
async def test_only_one_inference_runs_at_a_time(monkeypatch):
    monkeypatch.setattr(ai_runtime, "ws_manager", _RecordingWs())
    concurrent = 0
    peak = 0

    async def run():
        nonlocal concurrent, peak
        async with ai_runtime.inference():
            concurrent += 1
            peak = max(peak, concurrent)
            await asyncio.sleep(0.05)
            concurrent -= 1

    await asyncio.gather(run(), run(), run())

    # Two captures at once on a Pi do not go twice as fast.
    assert peak == 1


@pytest.mark.asyncio
async def test_a_failed_inference_is_recorded_and_still_releases(monkeypatch):
    monkeypatch.setattr(ai_runtime, "ws_manager", _RecordingWs())

    with pytest.raises(RuntimeError):
        async with ai_runtime.inference():
            raise RuntimeError("ollama fell over")

    assert ai_runtime.status()["busy"] is False
    assert ai_runtime.status()["consecutive_failures"] == 1

    # The lock was handed back, so the next call still runs.
    async with ai_runtime.inference():
        pass


@pytest.mark.asyncio
async def test_a_broken_socket_never_fails_the_capture(monkeypatch):
    class _Broken:
        async def broadcast(self, message):
            raise ConnectionError("no listeners")

    monkeypatch.setattr(ai_runtime, "ws_manager", _Broken())

    async with ai_runtime.inference():
        pass  # telling the UI is a courtesy, not a requirement


def test_status_reports_what_the_ui_needs():
    for _ in range(3):
        ai_runtime._stats.record_success(2.5)

    reported = ai_runtime.status()

    assert reported["busy"] is False
    assert reported["warm"] is True
    assert reported["typical_seconds"] == 2.5
    assert reported["next_timeout_seconds"] > 0
    assert reported["samples"] == 3


# ---------------------------------------------------------------------------
# What goes on the wire has to be a whole item
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_captured_item_is_broadcast_in_the_shape_the_ui_stores(tmp_path, monkeypatch):
    from app.services.capture_service import commit_capture

    db_path = str(tmp_path / "broadcast.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()

    ws = _RecordingWs()
    import app.services.capture_service as capture_service
    monkeypatch.setattr(capture_service, "ws_manager", ws)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        await commit_capture(
            db,
            "going out with cousins at 7.30pm so leave office by 6.30pm",
            now=datetime.datetime(2026, 9, 18, 10, 0, 0),
            use_ai=False,
        )

    broadcasts = [m for m in ws.messages if m["type"] == "ITEM_CREATED"]
    assert len(broadcasts) == 2

    # The frontend casts event.data straight to WorkItem and puts it in the
    # list, so every field it later reads has to be present. subtasks is the
    # sharp one: the subtask-toggle handler maps over it for every item held.
    required = {
        "id", "title", "description", "entity_type", "status", "priority",
        "energy", "due_date", "start_at", "end_at", "remind_at", "repeat_rule",
        "next_occurrence", "project_id", "milestone_id", "estimated_minutes",
        "actual_minutes", "depends_on", "context_tags", "is_completed",
        "completed_at", "created_at", "updated_at", "subtasks",
    }
    for message in broadcasts:
        assert required <= set(message["data"]), required - set(message["data"])
        assert isinstance(message["data"]["subtasks"], list)
        assert isinstance(message["data"]["depends_on"], list)
        assert isinstance(message["data"]["is_completed"], bool)


@pytest.mark.asyncio
async def test_load_item_returns_subtasks_with_the_item(tmp_path, monkeypatch):
    db_path = str(tmp_path / "serialize.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, status, priority, energy, "
            "created_at, updated_at) VALUES ('i1', 'Thing', 'task', 'todo', 'high', 'medium', 'n', 'n')"
        )
        await db.execute(
            "INSERT INTO subtasks (id, work_item_id, title, is_completed, position, created_at) "
            "VALUES ('s1', 'i1', 'Step one', 0, 0, 'n')"
        )
        await db.commit()

        item = await load_item(db, "i1")
        assert await load_item(db, "nope") is None

    assert item["priority"] == "high"
    assert item["subtasks"][0]["title"] == "Step one"
    assert item["subtasks"][0]["is_completed"] is False
    assert item["depends_on"] == []


@pytest.mark.asyncio
async def test_a_fast_failure_is_not_learned_as_a_fast_model(monkeypatch):
    monkeypatch.setattr(ai_runtime, "ws_manager", _RecordingWs())

    # A stopped Ollama refuses the connection in milliseconds. Recording that
    # as a 0.01s generation would drop the budget to the floor and then time
    # out the first real one.
    async with ai_runtime.inference() as run:
        run.record_failure("ConnectError")

    reported = ai_runtime.status()
    assert reported["samples"] == 0
    assert reported["warm"] is False
    assert reported["consecutive_failures"] == 1
    assert ai_runtime.adaptive_timeout() == ai_runtime.COLD_START_TIMEOUT_SECONDS
