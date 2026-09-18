"""
Tests for natural-language quick capture.

Two things are under test: that the deterministic parser reads ordinary
writing correctly, and that the local model's answer is checked before any of
it reaches the database.
"""

import datetime
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.services import capture_ai
from app.services.capture_ai import reconcile, understand
from app.services.capture_engine import parse_capture, split_segments

# Friday, 18 September 2026, 10:00 -- fixed so every expectation is exact.
NOW = datetime.datetime(2026, 9, 18, 10, 0, 0)


def parse(text, projects=None):
    return parse_capture(text, now=NOW, projects=projects or []).items


# ---------------------------------------------------------------------------
# The sentence this feature exists for
# ---------------------------------------------------------------------------

def test_outing_and_the_thing_you_must_do_first():
    items = parse("going out with cousins at 7.30pm so leave office by 6.30pm")

    assert len(items) == 2
    outing, leaving = items

    assert outing.entity_type == "event"
    assert outing.title == "Going out with cousins"
    assert outing.start_at == "2026-09-18T19:30:00"
    assert outing.remind_at == "2026-09-18T19:15:00"

    # "by 6.30pm" is a deadline, so it is a nudge rather than an appointment,
    # and it fires at the time itself.
    assert leaving.entity_type == "reminder"
    assert leaving.title == "Leave office"
    assert leaving.remind_at == "2026-09-18T18:30:00"


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("going out with cousins at 7.30pm so leave office by 6.30pm", 2),
    ("buy milk and eggs", 1),                       # a list, not two actions
    ("call the plumber and then review the deck", 2),
    ("finish the report", 1),
    ("grocery shopping on saturday, pick up laundry, and call the plumber", 3),
])
def test_segment_counts(text, expected):
    assert len(split_segments(text)) == expected


def test_a_list_keeps_the_words_it_was_typed_with():
    assert parse("buy milk and eggs")[0].title == "Buy milk and eggs"


# ---------------------------------------------------------------------------
# Times
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("call bob at 7.30pm", "19:30"),
    ("call bob at 7:30 pm", "19:30"),
    ("call bob at 19:30", "19:30"),
    ("call bob at 9am", "09:00"),
    ("call bob at noon", "12:00"),
    ("standup at half past nine", "09:30"),
])
def test_clock_times(text, expected):
    item = parse(text)[0]
    assert item.start_at.endswith(f"T{expected}:00")


def test_a_bare_hour_resolves_to_the_reading_still_ahead_today():
    # At 10:00, "by 6.30" can only sensibly mean half past six this evening.
    item = parse("leave office by 6.30")[0]
    assert item.remind_at == "2026-09-18T18:30:00"
    assert item.time_is_ambiguous is True


def test_a_time_already_past_rolls_to_tomorrow():
    item = parse("call the bank at 9:15am")[0]
    assert item.due_date == "2026-09-19"


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("submit the form tomorrow", "2026-09-19"),
    ("submit the form today", "2026-09-18"),
    ("submit the form day after tomorrow", "2026-09-20"),
    ("submit the form in 3 days", "2026-09-21"),
    ("submit the form on monday", "2026-09-21"),
    ("submit the form on 25 sep", "2026-09-25"),
    ("submit the form on sep 25", "2026-09-25"),
    ("submit the form 2026-10-02", "2026-10-02"),
])
def test_dates(text, expected):
    assert parse(text)[0].due_date == expected


def test_next_weekday_means_the_following_week():
    # Friday 18th -> "next friday" is the 25th, not today.
    assert parse("submit the form next friday")[0].due_date == "2026-09-25"


def test_a_weekday_abbreviation_needs_a_cue_word():
    # "sat" here is the verb, not Saturday.
    assert parse("write up where we sat down on pricing")[0].due_date is None


# ---------------------------------------------------------------------------
# Recurrence, priority, projects, tags, duration
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,rule", [
    ("take medicine every day at 9pm", "daily"),
    ("standup every weekday at 9:30am", "weekdays"),
    ("gym every monday and thursday", "weekly:mon,thu"),
    ("water the plants every 3 days", "custom:3d"),
    ("pay rent on the 1st of every month", "monthly:1"),
])
def test_recurrence(text, rule):
    assert parse(text)[0].repeat_rule == rule


def test_a_recurring_item_starts_on_a_day_its_rule_allows():
    # 9:30am on Friday has passed, and Saturday is not a weekday.
    item = parse("standup every weekday at 9:30am")[0]
    assert item.due_date == "2026-09-21"


@pytest.mark.parametrize("text,priority", [
    ("fix the login bug asap", "urgent"),
    ("renew the domain !high", "high"),
    ("read that article someday", "low"),
    ("tidy the desk", "medium"),
])
def test_priority(text, priority):
    assert parse(text)[0].priority == priority


def test_priority_words_leave_the_title():
    assert parse("fix the login bug asap")[0].title == "Fix the login bug"


def test_project_and_context_tags():
    item = parse("finish the quarterly report by monday #finance ~2h @computer",
                 projects=[{"id": "proj_1", "name": "Finance"}])[0]
    assert item.project_id == "proj_1"
    assert item.estimated_minutes == 120
    assert "@computer" in item.context_tags
    assert item.title == "Finish the quarterly report"


# ---------------------------------------------------------------------------
# Money, and the times that are not money
# ---------------------------------------------------------------------------

def test_an_amount_is_read_with_its_payment_method():
    item = parse("pay electricity bill Rs 2500 via upi !high")[0]
    assert item.expense["amount"] == 2500.0
    assert item.expense["payment_mode"] == "upi"
    assert item.title == "Pay electricity bill"


@pytest.mark.parametrize("text", [
    "baby naming ceremony at 11.30 am",
    "call the office at 9.15",
    "meeting at 2pm",
])
def test_a_clock_time_is_never_money(text):
    assert parse(text)[0].expense is None


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,entity_type", [
    ("team meeting at 3pm", "event"),
    ("dinner with sam tomorrow at 8", "event"),
    ("book flight tickets in 3 days", "task"),      # arranging it is not it
    ("call the plumber", "task"),                   # no time, so not an event
    ("remind me to take medicine at 9pm", "reminder"),
    ("submit the form by friday", "task"),          # a deadline, but no moment
    ("submit the form by 5pm", "reminder"),         # a moment to nudge at
    ("tidy the desk", "task"),
])
def test_classification(text, entity_type):
    assert parse(text)[0].entity_type == entity_type


# ---------------------------------------------------------------------------
# The local model, and the checks on it
# ---------------------------------------------------------------------------

def _baseline(text):
    return parse_capture(text, now=NOW).items


def test_the_model_supplies_the_title_and_the_type():
    text = "sort out the thing with the roof people at 4pm"
    ai_items = [{"title": "Call the roofers", "type": "event", "time": "16:00",
                 "date": "2026-09-18", "priority": "high", "minutes": 30}]

    item = reconcile(ai_items, _baseline(text), NOW)[0]

    assert item.title == "Call the roofers"
    assert item.entity_type == "event"
    assert item.priority == "high"
    assert item.start_at == "2026-09-18T16:00:00"


def test_a_hallucinated_date_is_replaced_by_the_parsed_one():
    text = "dentist tomorrow at 11am"
    # qwen2.5:1.5b reaches for last year's dates given half a chance.
    ai_items = [{"title": "Dentist", "type": "event", "date": "2025-01-11", "time": "11:00"}]

    item = reconcile(ai_items, _baseline(text), NOW)[0]

    assert item.due_date == "2026-09-19"
    assert item.start_at == "2026-09-19T11:00:00"


def test_a_malformed_date_is_replaced_by_the_parsed_one():
    text = "dentist tomorrow at 11am"
    ai_items = [{"title": "Dentist", "type": "event", "date": "next week sometime", "time": "11:00"}]

    assert reconcile(ai_items, _baseline(text), NOW)[0].due_date == "2026-09-19"


def test_the_model_cannot_invent_money():
    # The exact mistake the previous engine carried a hand-written patch for:
    # reading "11.30 am" as a spend of 11.30.
    text = "baby naming ceremony at 11.30 am"
    ai_items = [{"title": "Baby naming ceremony", "type": "event", "time": "11:30",
                 "date": "2026-09-18", "amount": 11.30, "payment_mode": "upi"}]

    assert reconcile(ai_items, _baseline(text), NOW)[0].expense is None


def test_an_amount_in_the_text_survives():
    text = "pay electricity bill Rs 2500 via upi"
    ai_items = [{"title": "Pay electricity bill", "type": "task", "amount": 2500, "payment_mode": "upi"}]

    expense = reconcile(ai_items, _baseline(text), NOW)[0].expense
    assert expense["amount"] == 2500.0
    assert expense["payment_mode"] == "upi"


def test_an_invalid_repeat_rule_falls_back_to_the_parsed_one():
    text = "take medicine every day at 9pm"
    ai_items = [{"title": "Take medicine", "type": "reminder", "repeat": "every single day"}]

    assert reconcile(ai_items, _baseline(text), NOW)[0].repeat_rule == "daily"


@pytest.mark.asyncio
async def test_understand_falls_back_when_ollama_is_unreachable(monkeypatch):
    # Nothing is listening on this port, which is what a stopped Ollama looks like.
    monkeypatch.setattr(capture_ai, "OLLAMA_HOST", "http://127.0.0.1:9")

    items = await understand("going out with cousins at 7.30pm so leave office by 6.30pm",
                             now=NOW, timeout_seconds=2.0)

    assert [i.entity_type for i in items] == ["event", "reminder"]
    assert items[1].remind_at == "2026-09-18T18:30:00"


@pytest.mark.asyncio
async def test_understand_keeps_the_richer_reading_when_the_model_merges_items(monkeypatch):
    async def one_item(*args, **kwargs):
        return [{"title": "Go out with cousins", "type": "event", "time": "19:30"}]

    monkeypatch.setattr(capture_ai, "extract_with_ollama", one_item)

    items = await understand("going out with cousins at 7.30pm so leave office by 6.30pm", now=NOW)

    assert len(items) == 2


# ---------------------------------------------------------------------------
# End to end against a stub Ollama
# ---------------------------------------------------------------------------

class _StubOllama(BaseHTTPRequestHandler):
    response_items: list = []

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        body = json.dumps({"response": json.dumps({"items": self.response_items})}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def stub_ollama():
    server = HTTPServer(("127.0.0.1", 0), _StubOllama)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


@pytest.mark.asyncio
async def test_a_real_request_to_the_model_is_read_back(monkeypatch, stub_ollama):
    _StubOllama.response_items = [
        {"title": "Drinks with the cousins", "type": "event", "date": "2026-09-18",
         "time": "19:30", "minutes": 120},
        {"title": "Leave the office", "type": "reminder", "date": "2026-09-18",
         "time": "18:30", "is_deadline": True},
    ]
    host, port = stub_ollama.server_address
    monkeypatch.setattr(capture_ai, "OLLAMA_HOST", f"http://{host}:{port}")

    items = await understand("going out with cousins at 7.30pm so leave office by 6.30pm",
                             now=NOW, timeout_seconds=5.0)

    assert [i.title for i in items] == ["Drinks with the cousins", "Leave the office"]
    assert items[0].start_at == "2026-09-18T19:30:00"
    assert items[0].estimated_minutes == 120
    assert items[1].remind_at == "2026-09-18T18:30:00"


# ---------------------------------------------------------------------------
# Writing it down
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_commit_capture_creates_the_items(tmp_path, monkeypatch):
    import aiosqlite
    from app import database
    from app.services.capture_service import commit_capture

    db_path = str(tmp_path / "capture.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        result = await commit_capture(
            db,
            "going out with cousins at 7.30pm so leave office by 6.30pm",
            now=NOW,
            use_ai=False,
        )

        assert len(result["created"]) == 2

        async with db.execute("SELECT * FROM work_items ORDER BY start_at") as cursor:
            rows = [dict(r) for r in await cursor.fetchall()]

    assert [r["entity_type"] for r in rows] == ["reminder", "event"]
    assert rows[0]["remind_at"] == "2026-09-18T18:30:00"
    assert rows[1]["start_at"] == "2026-09-18T19:30:00"


@pytest.mark.asyncio
async def test_commit_capture_logs_a_spend_against_an_account(tmp_path, monkeypatch):
    import aiosqlite
    from app import database
    from app.services.capture_service import commit_capture

    db_path = str(tmp_path / "capture_money.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        result = await commit_capture(db, "paid 250 for lunch via upi", now=NOW, use_ai=False)

        assert len(result["transactions"]) == 1

        async with db.execute("SELECT * FROM finance_transactions") as cursor:
            transactions = [dict(r) for r in await cursor.fetchall()]

    assert transactions[0]["amount"] == 250.0
    assert transactions[0]["payment_mode"] == "upi"
