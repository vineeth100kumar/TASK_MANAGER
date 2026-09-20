import asyncio
import json
import os
import datetime
import aiosqlite
from typing import List, Dict, Any, Optional

# Empty when unset, rather than a placeholder that looks like a key.
#
# The defaults here used to be the strings "BN_DEMO_KEY_GENERATE_VIA_PYWEBPUSH"
# and "DEMO_PRIVATE_KEY", which the browser accepts as an applicationServerKey
# and the push service then rejects. That failed indistinguishably from working
# and left reminders quietly going nowhere. Empty means the app can tell it is
# not set up and say so.
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_CLAIMS = {
    "sub": os.environ.get("VAPID_CLAIM_EMAIL", "mailto:admin@raspberrypi.local")
}


def push_is_configured() -> bool:
    """True when this Pi actually has keys to sign a push with."""
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)

async def send_web_push(subscription: Dict[str, str], title: str, body: str, url: str = "/", tag: Optional[str] = None) -> bool:
    """
    Dispatches a Web Push notification to an iOS PWA or PC browser.

    pywebpush is synchronous and talks to a push service over the network, so
    it runs on a worker thread. Called directly it would block the event loop
    for the length of that request, per subscription -- on a Pi serving a
    reminder to three devices that is the whole API stalled.

    Returns False when the push service says this subscription no longer
    exists, so the caller can drop it. Every other failure returns True: a
    Pi that was briefly offline should not lose its phone.
    """
    if not push_is_configured():
        # Nothing to sign with. Say it once, clearly, rather than letting the
        # push service reject a placeholder key somewhere out of sight.
        print(
            "Web Push: no VAPID keys configured, so no notification was sent. "
            "Run deploy/generate_vapid_keys.sh on the Pi."
        )
        return True

    try:
        from pywebpush import webpush
        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": "/icons/icon-192.png",
            "badge": "/icons/icon-192.png",
            "data": {"url": url, "tag": tag or "sage"},
        })

        await asyncio.to_thread(
            webpush,
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": {
                    "p256dh": subscription["p256dh"],
                    "auth": subscription["auth"]
                }
            },
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            # A fresh copy each time. pywebpush writes "aud" and "exp" into the
            # dict it is handed, so a shared one keeps the first push service it
            # ever saw and the first hour it ever ran: pushes to a second
            # service, and every push a day later, come back 401.
            vapid_claims=dict(VAPID_CLAIMS),
        )
        return True
    except Exception as e:
        # 404 and 410 mean the browser threw this subscription away -- the app
        # was deleted, or notifications were turned off outside of Sage. It will
        # never work again, so say so and let the caller forget it.
        status = getattr(e, "status_code", None)
        if status is None:
            status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            print(f"Web Push: subscription gone ({status}), dropping it")
            return False
        # Anything else -- no VAPID keys yet, the Pi offline, the push service
        # having a bad minute -- is worth a line in the log and nothing more.
        print(f"Web Push dispatch notice: {e}")
        return True

async def check_due_reminders(db_path: str, ws_manager=None):
    """
    Periodic worker that checks for due reminders and dispatches notifications.
    Runs every 60 seconds.
    """
    now_iso = datetime.datetime.now().isoformat()
    try:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            # This connection is outside the pool, so it needs its own timeout
            # or it gives up the moment a write is in flight elsewhere.
            await db.execute("PRAGMA busy_timeout = 10000;")
            # Items whose reminder is due and has not already been sent. Without
            # the reminder_sent_at check every due reminder fired again on each
            # 60-second pass, for as long as the item stayed incomplete.
            query = """
                SELECT id, title, entity_type, remind_at
                FROM work_items
                WHERE is_completed = 0
                  AND remind_at IS NOT NULL
                  AND remind_at <= ?
                  AND reminder_sent_at IS NULL
            """
            async with db.execute(query, (now_iso,)) as cursor:
                due_items = await cursor.fetchall()

            if due_items:
                # Fetch all registered push subscriptions
                async with db.execute("SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions") as sub_cursor:
                    subs = await sub_cursor.fetchall()

                # Endpoints the push service has told us are dead. Collected
                # across every item, then deleted once at the end.
                stale: set = set()

                for item in due_items:
                    # Notify via WebPush
                    for sub in subs:
                        if sub["endpoint"] in stale:
                            continue
                        sub_dict = {
                            "endpoint": sub["endpoint"],
                            "p256dh": sub["p256dh_key"],
                            "auth": sub["auth_key"]
                        }
                        # The item's own title is the notification's title: on a
                        # lock screen that is the line people actually read. Tagging
                        # by item id means a retry replaces the earlier notification
                        # instead of stacking a second copy of it.
                        alive = await send_web_push(
                            sub_dict,
                            title=item["title"],
                            body="Now",
                            url="/tasks",
                            tag=f"item-{item['id']}"
                        )
                        if not alive:
                            stale.add(sub["endpoint"])

                    # Notify via active WebSockets
                    if ws_manager:
                        await ws_manager.broadcast({
                            "type": "REMINDER_TRIGGERED",
                            "data": {
                                "id": item["id"],
                                "title": item["title"],
                                "entity_type": item["entity_type"]
                            }
                        })

                    await db.execute(
                        "UPDATE work_items SET reminder_sent_at = ? WHERE id = ?",
                        (now_iso, item["id"])
                    )

                for endpoint in stale:
                    await db.execute(
                        "DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
                    )

                await db.commit()
    except Exception as e:
        print(f"Reminder worker error: {e}")
