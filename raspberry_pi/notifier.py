"""
Task notifications: Web Push to installed copies of the app (iPhone home
screen, Android, desktop browsers) and email through any SMTP account.

The Pi decides when to notify, so alerts arrive while the app is closed:
  - reminders: an item's remindAt time (set from "Remind me" or a reminder's
    own time), at most once per item per time
  - morning plan: what's due today and what's overdue, at the time chosen in
    Settings
  - evening check-in: what's still open from today, only when something is

Times without an offset ("2026-10-01T09:00", what the app stores) are read in
the timezone the app last reported, so a reminder fires at the wall-clock
time the person picked, whatever timezone the Pi itself is set to.

Push keys (VAPID) are made on first use and kept next to the database. The
SMTP password is kept in sage_secrets.json beside it, never in the database
or Apps Script backup.
"""

import asyncio
import datetime
import html
import json
import os
import smtplib
import sqlite3
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
DATA_DIR = Path(DB_PATH).resolve().parent
VAPID_KEY_FILE = DATA_DIR / "sage_vapid_private.pem"
SECRETS_FILE = DATA_DIR / "sage_secrets.json"
CHECK_EVERY_SECONDS = 30
# A reminder whose time passed while the Pi was off still goes out if it is
# this recent; older ones are skipped rather than arriving hours late.
REMINDER_GRACE = datetime.timedelta(minutes=15)
# Same for the morning plan and evening check-in.
DIGEST_GRACE = datetime.timedelta(hours=3)

DEFAULT_PREFS: Dict[str, Any] = {
    "timezone": "UTC",
    "reminders": True,
    "morningPlan": True,
    "morningTime": "08:00",
    "eveningCheckIn": True,
    "eveningTime": "18:00",
    "email": {
        "enabled": False,
        "to": "",
        "morningPlan": True,
        "reminders": False,
        "smtpHost": "smtp.gmail.com",
        "smtpPort": 587,
        "smtpUser": "",
    },
}

PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3}


# --- Storage ---

def _connect() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def init_tables() -> None:
    conn = _connect()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            endpoint TEXT PRIMARY KEY,
            subscription TEXT NOT NULL,
            label TEXT,
            created_at TEXT,
            last_success_at TEXT
        )
    ''')
    # One row per notification sent, so a restart never sends one twice.
    conn.execute('''
        CREATE TABLE IF NOT EXISTS notification_log (
            dedupe_key TEXT PRIMARY KEY,
            sent_at TEXT
        )
    ''')
    conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
    conn.commit()
    conn.close()


def _merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for key, value in (extra or {}).items():
        if key not in base:
            continue  # ignore unknown fields
        if isinstance(base[key], dict) and isinstance(value, dict):
            out[key] = _merge(base[key], value)
        else:
            out[key] = value
    return out


def get_prefs() -> dict:
    conn = _connect()
    row = conn.execute("SELECT value FROM metadata WHERE key = 'notifyPrefs'").fetchone()
    conn.close()
    try:
        saved = json.loads(row[0]) if row else {}
    except ValueError:
        saved = {}
    return _merge(DEFAULT_PREFS, saved)


def _valid_time(value: Any) -> bool:
    try:
        datetime.time.fromisoformat(str(value))
        return len(str(value)) == 5
    except ValueError:
        return False


def save_prefs(update: dict) -> dict:
    prefs = _merge(get_prefs(), update or {})
    try:
        ZoneInfo(str(prefs["timezone"]))
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"Unknown timezone: {prefs['timezone']}")
    for key in ("morningTime", "eveningTime"):
        if not _valid_time(prefs[key]):
            raise ValueError(f"{key} must look like 08:00")
    email = prefs["email"]
    email["to"] = str(email.get("to") or "").strip()
    email["smtpUser"] = str(email.get("smtpUser") or "").strip()
    email["smtpHost"] = str(email.get("smtpHost") or "").strip()
    try:
        email["smtpPort"] = int(email.get("smtpPort") or 587)
    except (TypeError, ValueError):
        raise ValueError("SMTP port must be a number")
    if email["enabled"] and "@" not in email["to"]:
        raise ValueError("Enter the email address to send to")
    conn = _connect()
    conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('notifyPrefs', ?)", (json.dumps(prefs),))
    conn.commit()
    conn.close()
    return prefs


def _secrets() -> dict:
    try:
        return json.loads(SECRETS_FILE.read_text())
    except (OSError, ValueError):
        return {}


def smtp_password() -> str:
    return str(_secrets().get("SMTP_PASSWORD") or os.getenv("SAGE_SMTP_PASSWORD", "")).strip()


def save_smtp_password(password: str) -> None:
    secrets = _secrets()
    # App passwords are shown with spaces ("abcd efgh ..."); Gmail wants them without.
    password = "".join(password.split())
    if password:
        secrets["SMTP_PASSWORD"] = password
    else:
        secrets.pop("SMTP_PASSWORD", None)
    SECRETS_FILE.touch(mode=0o600, exist_ok=True)
    SECRETS_FILE.write_text(json.dumps(secrets))


def _already_sent(conn: sqlite3.Connection, key: str) -> bool:
    return conn.execute("SELECT 1 FROM notification_log WHERE dedupe_key = ?", (key,)).fetchone() is not None


def _mark_sent(conn: sqlite3.Connection, key: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO notification_log (dedupe_key, sent_at) VALUES (?, ?)",
        (key, datetime.datetime.now(datetime.timezone.utc).isoformat()),
    )
    conn.commit()


# --- Web Push ---

def push_available() -> bool:
    try:
        import pywebpush  # noqa: F401
        return True
    except ImportError:
        return False


def _vapid():
    from py_vapid import Vapid02
    if VAPID_KEY_FILE.is_file():
        return Vapid02.from_file(str(VAPID_KEY_FILE))
    vapid = Vapid02()
    vapid.generate_keys()
    vapid.save_key(str(VAPID_KEY_FILE))
    os.chmod(VAPID_KEY_FILE, 0o600)
    return vapid


def vapid_public_key() -> Optional[str]:
    if not push_available():
        return None
    from cryptography.hazmat.primitives import serialization
    from py_vapid.utils import b64urlencode
    raw = _vapid().public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return b64urlencode(raw)


def _vapid_subject(prefs: dict) -> str:
    """Apple rejects pushes whose contact isn't a real mailto: or https: address."""
    explicit = os.getenv("SAGE_VAPID_SUBJECT", "").strip()
    if explicit:
        return explicit
    to = prefs["email"].get("to") or ""
    if "@" in to and not to.endswith("localhost"):
        return f"mailto:{to}"
    # Push services only accept a bare https origin here, not a full URL.
    link = _app_link()
    if link.startswith("https://"):
        return "https://" + link[len("https://"):].split("/")[0]
    return "https://github.com"


def save_subscription(subscription: dict, label: str) -> None:
    endpoint = str(subscription.get("endpoint") or "")
    keys = subscription.get("keys") or {}
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("That isn't a valid push subscription")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    conn = _connect()
    conn.execute(
        '''INSERT INTO push_subscriptions (endpoint, subscription, label, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, label = excluded.label''',
        (endpoint, json.dumps({"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]}}), label[:80], now),
    )
    conn.commit()
    conn.close()


def remove_subscription(endpoint: str) -> None:
    conn = _connect()
    conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    conn.commit()
    conn.close()


def list_devices() -> List[dict]:
    conn = _connect()
    rows = conn.execute("SELECT endpoint, label, created_at, last_success_at FROM push_subscriptions ORDER BY created_at").fetchall()
    conn.close()
    return [{"endpoint": e, "label": l, "createdAt": c, "lastSuccessAt": s} for e, l, c, s in rows]


def send_push(message: dict, only_endpoint: Optional[str] = None, prefs: Optional[dict] = None) -> List[dict]:
    """Send one notification to every saved device (or just one). Devices the
    push service says are gone (404/410) are forgotten. Returns one result per
    device."""
    if not push_available():
        return []
    from pywebpush import webpush, WebPushException
    prefs = prefs or get_prefs()
    vapid = _vapid()
    subject = _vapid_subject(prefs)
    conn = _connect()
    rows = conn.execute("SELECT endpoint, subscription, label FROM push_subscriptions").fetchall()
    results = []
    for endpoint, sub_json, label in rows:
        if only_endpoint and endpoint != only_endpoint:
            continue
        try:
            webpush(
                subscription_info=json.loads(sub_json),
                data=json.dumps(message),
                vapid_private_key=vapid,
                # A fresh dict each time: webpush fills in "aud" for the endpoint.
                vapid_claims={"sub": subject},
                ttl=message.get("ttl", 3600),
                headers={"Urgency": message.get("urgency", "normal")},
                timeout=15,
            )
            conn.execute(
                "UPDATE push_subscriptions SET last_success_at = ? WHERE endpoint = ?",
                (datetime.datetime.now(datetime.timezone.utc).isoformat(), endpoint),
            )
            results.append({"label": label, "ok": True})
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):
                conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
                results.append({"label": label, "ok": False, "error": "This device turned notifications off, so it was removed."})
            else:
                body = getattr(e.response, "text", "") or ""
                print(f"Push to {label} failed ({status}): {body[:200] or e}")
                results.append({"label": label, "ok": False, "error": f"The push service said {status}: {body[:120] or e}"})
        except Exception as e:  # network errors and the like
            print(f"Push to {label} failed: {e}")
            results.append({"label": label, "ok": False, "error": str(e)})
    conn.commit()
    conn.close()
    return results


# --- Email ---

def email_ready(prefs: dict) -> bool:
    email = prefs["email"]
    return bool(email["enabled"] and email["to"] and email["smtpHost"] and smtp_password())


def send_email(prefs: dict, subject: str, text: str, html_body: str) -> None:
    email = prefs["email"]
    user = email["smtpUser"] or email["to"]
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr(("Sage", user))
    msg["To"] = email["to"]
    msg["Message-ID"] = make_msgid(domain=user.split("@")[-1] if "@" in user else None)
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    context = ssl.create_default_context()
    port = int(email["smtpPort"])
    if port == 465:
        with smtplib.SMTP_SSL(email["smtpHost"], port, context=context, timeout=20) as smtp:
            smtp.login(user, smtp_password())
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(email["smtpHost"], port, timeout=20) as smtp:
            smtp.ehlo()
            if smtp.has_extn("starttls"):
                smtp.starttls(context=context)
                smtp.ehlo()
            smtp.login(user, smtp_password())
            smtp.send_message(msg)


_link_cache: Dict[str, Any] = {"url": "", "at": 0.0}


def _app_link() -> str:
    """The address Sage is reachable at from outside (Tailscale Funnel, a
    tunnel or SAGE_PUBLIC_URL), looked up at most every 10 minutes."""
    import time
    if time.time() - _link_cache["at"] > 600:
        try:
            import public_link
            _link_cache["url"] = public_link.find().get("url") or ""
        except Exception:
            _link_cache["url"] = ""
        _link_cache["at"] = time.time()
    return _link_cache["url"]


def email_html(heading: str, intro: str, sections: List[Tuple[str, List[str]]], link: str) -> str:
    parts = [
        '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1c1e">',
        f'<h1 style="font-size:22px;margin:0 0 6px">{html.escape(heading)}</h1>',
        f'<p style="font-size:15px;color:#555;margin:0 0 20px">{html.escape(intro)}</p>',
    ]
    for title, lines in sections:
        if not lines:
            continue
        parts.append(f'<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin:20px 0 8px">{html.escape(title)}</h2>')
        parts.append('<ul style="padding-left:18px;margin:0">')
        parts.extend(f'<li style="font-size:15px;margin:0 0 6px">{html.escape(line)}</li>' for line in lines)
        parts.append('</ul>')
    if link:
        parts.append(
            f'<p style="margin:28px 0 0"><a href="{html.escape(link)}" style="background:#2b275a;color:#fff;text-decoration:none;'
            'padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px">Open Sage</a></p>'
        )
    parts.append('<p style="font-size:12px;color:#aaa;margin-top:28px">You can change or turn off these emails in Sage under Settings &gt; Notifications.</p></div>')
    return "".join(parts)


def email_text(heading: str, intro: str, sections: List[Tuple[str, List[str]]], link: str) -> str:
    lines = [heading, intro, ""]
    for title, items in sections:
        if items:
            lines.append(title.upper())
            lines.extend(f"  - {item}" for item in items)
            lines.append("")
    if link:
        lines.append(f"Open Sage: {link}")
    return "\n".join(lines)


# --- Reading tasks ---

def _tz(prefs: dict) -> ZoneInfo:
    try:
        return ZoneInfo(prefs["timezone"])
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def parse_when(value: Any, tz: ZoneInfo) -> Optional[datetime.datetime]:
    """An ISO date-time from the app. Without an offset it is local wall time."""
    if not value or not isinstance(value, str) or len(value) < 16:
        return None
    try:
        when = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.replace(tzinfo=tz) if when.tzinfo is None else when


def open_items() -> List[dict]:
    conn = _connect()
    rows = conn.execute("SELECT payload FROM entities WHERE table_name = 'workItems' AND deleted = 0").fetchall()
    conn.close()
    items = []
    for (payload,) in rows:
        try:
            item = json.loads(payload)
        except ValueError:
            continue
        if item.get("deletedAt") or item.get("status") == "done" or item.get("completedAt"):
            continue
        items.append(item)
    return items


def _is_snoozed(item: dict, now: datetime.datetime, tz: ZoneInfo) -> bool:
    until = parse_when(item.get("snoozedUntil"), tz)
    return bool(until and until > now)


def plan_for_today(items: List[dict], now: datetime.datetime, tz: ZoneInfo) -> Tuple[List[dict], List[dict]]:
    """(due today, overdue), matching what Today shows."""
    today = now.date().isoformat()
    due, overdue = [], []
    for item in items:
        if _is_snoozed(item, now, tz):
            continue
        due_date = item.get("dueDate") or ""
        start = parse_when(item.get("startAt"), tz)
        start_date = item.get("startDate") or ""
        if due_date == today or (start and start.astimezone(tz).date().isoformat() == today) or (
            start_date and due_date and start_date <= today <= due_date
        ):
            due.append(item)
        elif due_date and due_date < today and item.get("entityType") != "event":
            overdue.append(item)

    def order(item):
        start = parse_when(item.get("startAt"), tz)
        return (start is None, start or now, PRIORITY_RANK.get(item.get("priority"), 2), item.get("title") or "")

    due.sort(key=order)
    overdue.sort(key=lambda i: (i.get("dueDate") or "", PRIORITY_RANK.get(i.get("priority"), 2)))
    return due, overdue


def _clock(when: datetime.datetime) -> str:
    return when.strftime("%I:%M %p").lstrip("0")


def _describe(item: dict, tz: ZoneInfo, now: datetime.datetime) -> str:
    start = parse_when(item.get("startAt"), tz)
    if start and start.astimezone(tz).date() == now.date():
        return f"{_clock(start.astimezone(tz))} · {item.get('title') or 'Untitled'}"
    return item.get("title") or "Untitled"


def _list_titles(items: List[dict], limit: int = 3) -> str:
    titles = [i.get("title") or "Untitled" for i in items[:limit]]
    extra = len(items) - len(titles)
    if extra > 0:
        return f"{', '.join(titles)} and {extra} more"
    if len(titles) > 1:
        return f"{', '.join(titles[:-1])} and {titles[-1]}"
    return titles[0] if titles else ""


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def reminder_message(item: dict, tz: ZoneInfo, now: datetime.datetime) -> dict:
    title = item.get("title") or "Reminder"
    start = parse_when(item.get("startAt"), tz)
    today = now.date().isoformat()
    tomorrow = (now.date() + datetime.timedelta(days=1)).isoformat()
    if item.get("entityType") == "event" and start:
        start = start.astimezone(tz)
        minutes = round((start - now).total_seconds() / 60)
        when = "Starting now" if minutes <= 1 else f"Starts in {minutes} min" if minutes < 60 else f"Starts at {_clock(start)}"
        body = f"{when} · {item['location']}" if item.get("location") else when
    elif item.get("dueDate") == today:
        body = "Due today"
    elif item.get("dueDate") == tomorrow:
        body = "Due tomorrow"
    elif item.get("dueDate") and item["dueDate"] < today:
        body = "Overdue"
    else:
        body = "Reminder"
    if item.get("description") and body == "Reminder":
        body = str(item["description"])[:120]
    return {
        "title": title,
        "body": body,
        "tag": f"item-{item.get('id')}",
        "url": f"/?open={item.get('id')}",
        "urgency": "high",
        "ttl": 3600,
    }


# --- The scheduler ---

def _today_at(now: datetime.datetime, hhmm: str) -> datetime.datetime:
    hour, minute = (int(x) for x in hhmm.split(":"))
    return now.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _deliver(prefs: dict, message: dict, email: Optional[Tuple[str, str, str]]) -> None:
    send_push(message, prefs=prefs)
    if email and email_ready(prefs):
        try:
            send_email(prefs, *email)
        except Exception as e:
            print(f"Sage email failed: {e}")


def run_once(now_utc: Optional[datetime.datetime] = None) -> List[str]:
    """One pass of the scheduler. Returns the dedupe keys it sent (for tests)."""
    prefs = get_prefs()
    tz = _tz(prefs)
    now = (now_utc or datetime.datetime.now(datetime.timezone.utc)).astimezone(tz)
    has_devices = bool(list_devices())
    wants_email = email_ready(prefs)
    if not has_devices and not wants_email:
        return []
    items = open_items()
    sent: List[str] = []
    conn = _connect()
    try:
        if prefs["reminders"]:
            for item in items:
                when = parse_when(item.get("remindAt"), tz)
                if not when or not (when <= now < when + REMINDER_GRACE):
                    continue
                key = f"remind:{item.get('id')}:{item.get('remindAt')}"
                if _already_sent(conn, key):
                    continue
                _mark_sent(conn, key)  # first, so a slow or failing send never repeats
                message = reminder_message(item, tz, now)
                email = None
                if prefs["email"]["reminders"]:
                    link = _app_link()
                    email = (
                        f"Reminder: {message['title']}",
                        email_text(message["title"], message["body"], [], link),
                        email_html(message["title"], message["body"], [], link),
                    )
                _deliver(prefs, message, email)
                sent.append(key)

        due, overdue = plan_for_today(items, now, tz)
        day = now.date().isoformat()

        morning = _today_at(now, prefs["morningTime"])
        key = f"morning:{day}"
        if prefs["morningPlan"] and morning <= now < morning + DIGEST_GRACE and not _already_sent(conn, key):
            _mark_sent(conn, key)
            if due or overdue:
                title = f"Today: {_plural(len(due), 'thing')} planned" if due else f"{_plural(len(overdue), 'thing')} overdue"
                body = _list_titles(due or overdue)
                if due and overdue:
                    body += f". Plus {len(overdue)} overdue."
                message = {"title": title, "body": body, "tag": "morning-plan", "url": "/", "ttl": 6 * 3600}
                email = None
                if prefs["email"]["morningPlan"]:
                    link = _app_link()
                    sections = [("Due today", [_describe(i, tz, now) for i in due]), ("Overdue", [i.get("title") or "Untitled" for i in overdue])]
                    intro = "Here's what's on your plate. Pick one and start there."
                    heading = now.strftime("%A, %B %-d")
                    email = (f"Your plan for {now.strftime('%A')}: {title.split(': ')[-1]}", email_text(heading, intro, sections, link), email_html(heading, intro, sections, link))
                _deliver(prefs, message, email)
                sent.append(key)

        evening = _today_at(now, prefs["eveningTime"])
        key = f"evening:{day}"
        if prefs["eveningCheckIn"] and evening <= now < evening + DIGEST_GRACE and not _already_sent(conn, key):
            _mark_sent(conn, key)
            # Only things due today: overdue items already had their nudge this morning.
            still_open = [i for i in due if i.get("entityType") != "event"]
            if still_open:
                message = {
                    "title": f"{_plural(len(still_open), 'thing')} still open from today",
                    "body": f"{_list_titles(still_open)}. Finish one, or move it to tomorrow.",
                    "tag": "evening-check-in",
                    "url": "/",
                    "ttl": 3 * 3600,
                }
                _deliver(prefs, message, None)
                sent.append(key)

        cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)).isoformat()
        conn.execute("DELETE FROM notification_log WHERE sent_at < ?", (cutoff,))
        conn.commit()
    finally:
        conn.close()
    return sent


async def scheduler() -> None:
    init_tables()
    if not push_available():
        print("pywebpush is not installed, so push notifications are off (pip install -r requirements.txt).")
    while True:
        try:
            await asyncio.to_thread(run_once)
        except Exception as e:
            print(f"Notification scheduler error: {e}")
        await asyncio.sleep(CHECK_EVERY_SECONDS)
