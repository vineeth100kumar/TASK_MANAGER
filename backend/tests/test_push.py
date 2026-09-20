"""
Regression tests for Web Push delivery.

Each test fails against the behaviour that was there before reminders could
actually reach a phone.
"""

import datetime

import aiosqlite
import pytest

from app import database
from app.services import push_service
from app.services.push_service import check_due_reminders, send_web_push


class _DeadSubscription(Exception):
    """What a push service raises once a browser has thrown a subscription away."""

    def __init__(self, status_code):
        super().__init__(f"{status_code} Gone")
        self.status_code = status_code


@pytest.fixture(autouse=True)
def _configured_vapid_keys(monkeypatch):
    """
    Give every test in this module keys to sign with.

    `send_web_push` returns early when the Pi has no VAPID keys, which is the
    right behaviour on a fresh install but means these tests would assert
    against a function that never got as far as the push service.
    """
    monkeypatch.setattr(push_service, "VAPID_PUBLIC_KEY", "test-public-key")
    monkeypatch.setattr(push_service, "VAPID_PRIVATE_KEY", "test-private-key")


async def _fresh_db(tmp_path, monkeypatch, name):
    db_path = str(tmp_path / name)
    monkeypatch.setattr(database, "DB_PATH", db_path)
    await database.init_database()
    return db_path


async def _add_subscription(db_path, endpoint):
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO push_subscriptions (id, endpoint, p256dh_key, auth_key, device_name, created_at) "
            "VALUES (?, ?, 'p256dh', 'auth', 'iPhone', ?)",
            (f"sub_{abs(hash(endpoint)) % 10**8}", endpoint, datetime.datetime.now().isoformat()),
        )
        await db.commit()


async def _add_due_item(db_path, item_id="item_1"):
    past = (datetime.datetime.now() - datetime.timedelta(minutes=5)).isoformat()
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "INSERT INTO work_items (id, title, entity_type, remind_at, is_completed) "
            "VALUES (?, 'Leave office', 'reminder', ?, 0)",
            (item_id, past),
        )
        await db.commit()


async def _endpoints(db_path):
    async with aiosqlite.connect(db_path) as db:
        async with db.execute("SELECT endpoint FROM push_subscriptions") as cursor:
            return [row[0] for row in await cursor.fetchall()]


def _stub_webpush(monkeypatch, behaviour):
    """Stands in for the real pywebpush, which would talk to Apple or Google."""
    import pywebpush

    calls = []

    def fake(**kwargs):
        calls.append(kwargs)
        return behaviour(kwargs)

    monkeypatch.setattr(pywebpush, "webpush", fake)
    return calls


# ---------------------------------------------------------------------------
# Each push signs for the service it is actually going to
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_each_push_gets_its_own_claims(monkeypatch):
    """
    pywebpush writes "aud" and "exp" into whatever claims dict it is handed.
    Handing it the module-level one meant the second push service, and every
    push twelve hours later, was signed for the wrong audience and refused.
    """
    def behaviour(kwargs):
        # What the real pywebpush does to the dict it is given.
        claims = kwargs["vapid_claims"]
        claims.setdefault("aud", kwargs["subscription_info"]["endpoint"].split("/")[2])
        claims.setdefault("exp", 1)

    calls = _stub_webpush(monkeypatch, behaviour)

    for host in ("web.push.apple.com", "fcm.googleapis.com"):
        await send_web_push(
            {"endpoint": f"https://{host}/x", "p256dh": "p", "auth": "a"},
            title="Leave office",
            body="Now",
        )

    assert [c["vapid_claims"]["aud"] for c in calls] == [
        "web.push.apple.com",
        "fcm.googleapis.com",
    ]
    # And the shared dict is still clean, so tomorrow's push is not signed with
    # yesterday's expiry.
    assert "aud" not in push_service.VAPID_CLAIMS
    assert "exp" not in push_service.VAPID_CLAIMS


# ---------------------------------------------------------------------------
# Subscriptions the browser has thrown away are forgotten
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_gone_subscription_is_deleted(tmp_path, monkeypatch):
    db_path = await _fresh_db(tmp_path, monkeypatch, "push_gone.db")
    await _add_subscription(db_path, "https://web.push.apple.com/dead")
    await _add_due_item(db_path)

    _stub_webpush(monkeypatch, lambda kwargs: (_ for _ in ()).throw(_DeadSubscription(410)))

    await check_due_reminders(db_path)

    assert await _endpoints(db_path) == []


@pytest.mark.asyncio
async def test_a_subscription_survives_an_ordinary_failure(tmp_path, monkeypatch):
    """
    A Pi that was offline for a minute, or a push service having a bad one,
    must not cost someone their phone.
    """
    db_path = await _fresh_db(tmp_path, monkeypatch, "push_flaky.db")
    await _add_subscription(db_path, "https://web.push.apple.com/alive")
    await _add_due_item(db_path)

    _stub_webpush(monkeypatch, lambda kwargs: (_ for _ in ()).throw(_DeadSubscription(503)))

    await check_due_reminders(db_path)

    assert await _endpoints(db_path) == ["https://web.push.apple.com/alive"]


@pytest.mark.asyncio
async def test_a_due_reminder_is_pushed_with_the_items_own_title(tmp_path, monkeypatch):
    db_path = await _fresh_db(tmp_path, monkeypatch, "push_title.db")
    await _add_subscription(db_path, "https://web.push.apple.com/ok")
    await _add_due_item(db_path)

    calls = _stub_webpush(monkeypatch, lambda kwargs: None)

    await check_due_reminders(db_path)

    assert len(calls) == 1
    import json

    payload = json.loads(calls[0]["data"])
    assert payload["title"] == "Leave office"
    # Tagged by item, so a repeat replaces the notification instead of stacking.
    assert payload["data"]["tag"] == "item-item_1"
    assert payload["data"]["url"] == "/tasks"
