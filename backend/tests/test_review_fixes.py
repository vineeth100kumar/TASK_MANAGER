"""
Regression tests for the problems found in the September 2026 review.

Each test fails against the code as it stood before that pass.
"""

import ast
import asyncio
import datetime
import pathlib

import aiosqlite
import pytest
from fastapi.testclient import TestClient

from app import auth, config, database
from app.services import ai_engine, ai_runtime, backlog_service


SECRET = "test_secret_for_review_fixes"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(config, "API_SECRET", SECRET)
    monkeypatch.setattr(auth, "API_SECRET", SECRET)
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def headers():
    return {"Authorization": f"Bearer {SECRET}"}


# --------------------------------------------------------------------------
# The backlog worker could never have run.
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_the_backlog_worker_actually_runs(tmp_path, monkeypatch):
    """
    `run_backlog_worker` called `aiosqlite.connect` while main.py never
    imported aiosqlite, so every fifteen-minute tick raised NameError into a
    swallowed except. Nothing surfaced; the feature simply never ran once.

    The worker catches its own exceptions, so the proof is that the body it
    guards is reached at all.
    """
    from app import main as main_module

    db_path = str(tmp_path / "worker.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    monkeypatch.setattr(database, "DB_DIR", str(tmp_path))
    await database.init_database()

    reached = {}

    async def _record(db, **kwargs):
        reached["db"] = db
        return {"processed_projects": 0, "processed_tasks": 0}

    monkeypatch.setattr(main_module, "process_backlog_items", _record)

    class _Manager:
        async def broadcast(self, message):
            pass

    await main_module.run_backlog_worker(db_path, _Manager())

    assert "db" in reached, "the worker never got as far as opening the database"


# --------------------------------------------------------------------------
# The published secret is gone.
# --------------------------------------------------------------------------

def test_the_published_shortcuts_secret_is_no_longer_accepted(client):
    """
    "sage_rpi5_secret_ios_key_2026" was a constant in a public repository,
    accepted on every route. Anyone who knew the address was already inside.
    """
    res = client.get(
        "/api/v1/items",
        headers={"Authorization": "Bearer sage_rpi5_secret_ios_key_2026"},
    )
    assert res.status_code == 401


def test_no_source_file_still_carries_the_old_secret():
    repo = pathlib.Path(__file__).resolve().parents[2]
    offenders = []
    for path in list(repo.glob("backend/**/*.py")) + list(repo.glob("frontend/src/**/*.ts")) \
            + list(repo.glob("frontend/src/**/*.tsx")):
        # Tests name the retired secret on purpose, to assert it is refused.
        if "__tests__" in path.parts or path.name.startswith("test_") \
                or ".test." in path.name:
            continue
        if "sage_rpi5_secret_ios_key_2026" in path.read_text(encoding="utf-8", errors="ignore"):
            offenders.append(str(path.relative_to(repo)))
    assert not offenders, f"the old secret is still in: {offenders}"


def test_a_request_with_no_token_is_rejected(client):
    assert client.get("/api/v1/items").status_code == 401


def test_cors_does_not_default_to_every_origin():
    """It defaulted to "*", which let any site on the internet script this API."""
    assert "*" not in config.ALLOWED_ORIGINS


# --------------------------------------------------------------------------
# The websocket no longer takes its token from the URL.
# --------------------------------------------------------------------------

def test_websocket_rejects_a_token_in_the_query_string(client):
    """
    A query string is written to nginx's access log and to every proxy in
    between, so the one secret guarding this data ended up in plain text.
    """
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws?token={SECRET}") as ws:
            ws.receive_text()


def test_websocket_accepts_the_handshake_frame(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_text(f'{{"type": "auth", "token": "{SECRET}"}}')
        assert ws.receive_json() == {"type": "AUTH_OK"}


def test_websocket_rejects_a_wrong_handshake_token(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws") as ws:
            ws.send_text('{"type": "auth", "token": "not-the-key"}')
            ws.receive_text()


# --------------------------------------------------------------------------
# Creating things no longer waits on the model.
# --------------------------------------------------------------------------

def test_creating_a_task_does_not_wait_on_the_model(client, headers, monkeypatch):
    """
    `create_item` called auto_fill_task_details inline, so every capture sat
    on a local model generation before the task existed.
    """
    called = False

    async def _should_not_run(*args, **kwargs):
        nonlocal called
        called = True
        return {"description": "", "subtasks": []}

    monkeypatch.setattr("app.routers.items.schedule_description_fill", lambda *a, **k: None)
    monkeypatch.setattr(ai_engine, "auto_fill_task_details", _should_not_run)

    res = client.post("/api/v1/items", json={"title": "Buy milk"}, headers=headers)
    assert res.status_code == 200
    assert not called, "task creation is still generating a description inline"


def test_creating_a_task_invents_no_subtasks(client, headers, monkeypatch):
    """Five checklist items nobody asked for is not a feature."""
    monkeypatch.setattr("app.routers.items.schedule_description_fill", lambda *a, **k: None)
    res = client.post("/api/v1/items", json={"title": "Call the dentist"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["subtasks"] == []


def test_a_user_supplied_subtask_is_still_kept(client, headers, monkeypatch):
    monkeypatch.setattr("app.routers.items.schedule_description_fill", lambda *a, **k: None)
    res = client.post(
        "/api/v1/items",
        json={"title": "Pack", "subtasks": ["Passport", "Charger"]},
        headers=headers,
    )
    assert [s["title"] for s in res.json()["subtasks"]] == ["Passport", "Charger"]


@pytest.mark.asyncio
async def test_the_background_fill_writes_a_description(tmp_path, monkeypatch):
    db_path = str(tmp_path / "fill.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    monkeypatch.setattr(database, "DB_DIR", str(tmp_path))
    await database.init_database()

    now = datetime.datetime.now().isoformat()
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, created_at, updated_at) "
            "VALUES ('item_fill', 'Renew the passport', 'task', ?, ?)",
            (now, now),
        )
        await db.commit()

    sent = []

    async def _broadcast(message):
        sent.append(message)

    await backlog_service._fill_description(db_path, "item_fill", _broadcast)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT description FROM work_items WHERE id = 'item_fill'") as cur:
            row = await cur.fetchone()

    assert row["description"]
    assert sent and sent[0]["type"] == "ITEM_UPDATED"


@pytest.mark.asyncio
async def test_the_background_fill_never_overwrites_what_the_user_wrote(tmp_path, monkeypatch):
    db_path = str(tmp_path / "keep.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    monkeypatch.setattr(database, "DB_DIR", str(tmp_path))
    await database.init_database()

    now = datetime.datetime.now().isoformat()
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO work_items (id, title, description, entity_type, created_at, updated_at) "
            "VALUES ('item_keep', 'Renew the passport', 'Mine, thanks', 'task', ?, ?)",
            (now, now),
        )
        await db.commit()

    await backlog_service._fill_description(db_path, "item_keep", None)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT description FROM work_items WHERE id = 'item_keep'") as cur:
            row = await cur.fetchone()
    assert row["description"] == "Mine, thanks"


# --------------------------------------------------------------------------
# Every model call is governed by the runtime built for it.
# --------------------------------------------------------------------------

def test_ai_engine_makes_no_ungoverned_model_calls():
    """
    ai_engine reached for httpx directly with fixed timeouts, skipping the
    semaphore, the learned budget and the busy signal in ai_runtime. Two
    generations at once on a Pi 5 are roughly four times slower than one.
    """
    source = pathlib.Path(ai_engine.__file__).read_text()
    # Exactly one place may open a client: the helper that holds the lock.
    assert source.count("httpx.AsyncClient") == 1
    assert "ai_runtime.inference" in source


@pytest.mark.asyncio
async def test_generate_holds_the_inference_lock(monkeypatch):
    """A generation must be inside the runtime's lock while it runs."""
    ai_runtime.reset_for_tests()
    seen = {}

    class _FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"response": "a paragraph"}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            seen["busy_during_call"] = ai_runtime.status()["busy"]
            return _FakeResponse()

    monkeypatch.setattr(ai_engine.httpx, "AsyncClient", _FakeClient)

    result = await ai_engine.generate("hello", label="test")
    assert result == "a paragraph"
    assert seen["busy_during_call"] is True
    assert ai_runtime.status()["busy"] is False


@pytest.mark.asyncio
async def test_an_unreachable_model_is_not_learned_as_a_fast_success(monkeypatch):
    ai_runtime.reset_for_tests()

    class _DeadClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            raise ConnectionError("ollama is not running")

    monkeypatch.setattr(ai_engine.httpx, "AsyncClient", _DeadClient)

    assert await ai_engine.generate("hello", label="test") is None
    assert ai_runtime.status()["samples"] == 0


# --------------------------------------------------------------------------
# The item list is bounded.
# --------------------------------------------------------------------------

def test_listing_items_is_bounded(client, headers, monkeypatch):
    """It returned every row the database had ever held, on every load."""
    monkeypatch.setattr("app.routers.items.schedule_description_fill", lambda *a, **k: None)
    res = client.get("/api/v1/items?limit=1", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) <= 1

    too_many = client.get("/api/v1/items?limit=100000", headers=headers)
    assert too_many.status_code == 422


def test_long_finished_items_are_left_out_by_default(client, headers, monkeypatch):
    monkeypatch.setattr("app.routers.items.schedule_description_fill", lambda *a, **k: None)

    created = client.post(
        "/api/v1/items", json={"title": "Ancient history"}, headers=headers
    ).json()
    long_ago = (datetime.datetime.now() - datetime.timedelta(days=365)).isoformat()
    client.patch(
        f"/api/v1/items/{created['id']}",
        json={"is_completed": True},
        headers=headers,
    )

    async def _backdate():
        async with aiosqlite.connect(database.DB_PATH) as db:
            await db.execute(
                "UPDATE work_items SET completed_at = ?, is_completed = 1 WHERE id = ?",
                (long_ago, created["id"]),
            )
            await db.commit()

    asyncio.run(_backdate())

    ids = [i["id"] for i in client.get("/api/v1/items", headers=headers).json()]
    assert created["id"] not in ids

    all_ids = [
        i["id"]
        for i in client.get("/api/v1/items?completed_within_days=0", headers=headers).json()
    ]
    assert created["id"] in all_ids


# --------------------------------------------------------------------------
# Push says so when it is not set up.
# --------------------------------------------------------------------------

def test_push_reports_itself_unconfigured_without_keys(client, headers, monkeypatch):
    """
    The defaults were the strings "BN_DEMO_KEY_GENERATE_VIA_PYWEBPUSH" and
    "DEMO_PRIVATE_KEY", which a browser accepts and a push service rejects,
    so reminders failed in a way that looked exactly like working.
    """
    from app.services import push_service
    monkeypatch.setattr(push_service, "VAPID_PUBLIC_KEY", "")
    monkeypatch.setattr(push_service, "VAPID_PRIVATE_KEY", "")

    body = client.get("/api/v1/push/vapid-public-key", headers=headers).json()
    assert body["configured"] is False
