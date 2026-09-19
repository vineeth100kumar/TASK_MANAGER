import uuid
import datetime
import aiosqlite
from fastapi import APIRouter, Depends
from ..database import get_db
from ..models import PushSubscriptionCreate
from ..services.push_service import VAPID_PUBLIC_KEY, push_is_configured, send_web_push

router = APIRouter(prefix="/api/v1/push", tags=["Push Notifications"])

@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """
    The VAPID public key a service worker subscribes with.

    `configured` is false when the Pi has no keys yet, which lets the app say
    reminders need setting up instead of subscribing against a placeholder and
    appearing to succeed.
    """
    return {"public_key": VAPID_PUBLIC_KEY, "configured": push_is_configured()}

@router.post("/subscribe")
async def subscribe(sub: PushSubscriptionCreate, db: aiosqlite.Connection = Depends(get_db)):
    """Registers a browser or iOS PWA subscription."""
    sub_id = f"sub_{uuid.uuid4().hex[:10]}"
    now_iso = datetime.datetime.now().isoformat()
    
    await db.execute("""
        INSERT INTO push_subscriptions (id, endpoint, p256dh_key, auth_key, device_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET 
            p256dh_key = excluded.p256dh_key,
            auth_key = excluded.auth_key,
            device_name = excluded.device_name
    """, (sub_id, sub.endpoint, sub.p256dh, sub.auth, sub.device_name, now_iso))
    await db.commit()
    
    # Send welcome / test notification
    # One notification straight away, so turning it on is visibly confirmed
    # rather than something you have to wait until tomorrow to trust.
    await send_web_push(
        {"endpoint": sub.endpoint, "p256dh": sub.p256dh, "auth": sub.auth},
        title="Reminders are on",
        body="This is what one looks like.",
        url="/",
        tag="sage-welcome"
    )
    
    return {"success": True, "id": sub_id}


@router.delete("/subscribe")
async def unsubscribe(endpoint: str, db: aiosqlite.Connection = Depends(get_db)):
    """
    Forgets a subscription.

    Without this, turning reminders off in the browser left the row behind and
    the Pi went on pushing to a dead endpoint every time a reminder fell due.
    """
    await db.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    await db.commit()
    return {"success": True}
