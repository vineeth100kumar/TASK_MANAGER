import uuid
import datetime
import aiosqlite
from fastapi import APIRouter, Depends
from ..database import get_db
from ..models import PushSubscriptionCreate
from ..services.push_service import VAPID_PUBLIC_KEY, send_web_push

router = APIRouter(prefix="/api/v1/push", tags=["Push Notifications"])

@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Returns the VAPID public key so client service workers can subscribe to Web Push."""
    return {"public_key": VAPID_PUBLIC_KEY}

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
    await send_web_push(
        {"endpoint": sub.endpoint, "p256dh": sub.p256dh, "auth": sub.auth},
        title="Sage Notifications Active",
        body="You will now receive recurring reminders and budget alerts here.",
        url="/dashboard"
    )
    
    return {"success": True, "id": sub_id}
