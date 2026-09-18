import asyncio
import json
import os
import datetime
import aiosqlite
from typing import List, Dict, Any, Optional

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "BN_DEMO_KEY_GENERATE_VIA_PYWEBPUSH")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "DEMO_PRIVATE_KEY")
VAPID_CLAIMS = {"sub": "mailto:admin@raspberrypi.local"}

async def send_web_push(subscription: Dict[str, str], title: str, body: str, url: str = "/"):
    """
    Dispatches a Web Push notification to an iOS PWA or PC browser.

    pywebpush is synchronous and talks to a push service over the network, so
    it runs on a worker thread. Called directly it would block the event loop
    for the length of that request, per subscription -- on a Pi serving a
    reminder to three devices that is the whole API stalled.
    """
    try:
        from pywebpush import webpush
        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": "/icons/icon-192x192.png",
            "badge": "/icons/icon-192x192.png",
            "data": {"url": url}
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
            vapid_claims=VAPID_CLAIMS
        )
    except Exception as e:
        # In demo / unconfigured VAPID mode, log gracefully
        print(f"Web Push dispatch notice: {e}")

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

                for item in due_items:
                    # Notify via WebPush
                    for sub in subs:
                        sub_dict = {
                            "endpoint": sub["endpoint"],
                            "p256dh": sub["p256dh_key"],
                            "auth": sub["auth_key"]
                        }
                        await send_web_push(
                            sub_dict,
                            title=f"Reminder: {item['title']}",
                            body=f"Your {item['entity_type']} is scheduled for right now.",
                            url="/tasks"
                        )

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

                await db.commit()
    except Exception as e:
        print(f"Reminder worker error: {e}")
