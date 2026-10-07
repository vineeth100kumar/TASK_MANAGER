"""
item_actions.py - small changes to one work item, made on the Pi.

The notification buttons (Done, Snooze, Tomorrow) and the desk clock change
items without going through a client's sync queue. Each change is written the
way a sync save is, a new version and server revision plus a line in the
operations ledger, so every client picks it up on its next pull. The caller
announces it on /ws with change_event().
"""

import datetime
import json
import os
import sqlite3
from typing import Callable, Optional, Tuple

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def next_revision(cursor) -> int:
    cursor.execute("SELECT value FROM metadata WHERE key = 'serverRevision'")
    row = cursor.fetchone()
    next_rev = (int(row[0]) if row else 1) + 1
    cursor.execute("UPDATE metadata SET value = ? WHERE key = 'serverRevision'", (str(next_rev),))
    return next_rev


def change_event(rev: int, item_id: str, source: str) -> dict:
    """The /ws event for one changed item, in the shape sync batches use."""
    return {
        "type": "SYNC_APPLIED",
        "serverRevision": rev,
        "changes": [{"entityType": "workItems", "entityId": item_id, "operation": "save", "clientId": source}],
    }


def update_item(item_id: str, change: Callable[[dict], None], source: str, label: str) -> Optional[Tuple[dict, int]]:
    """Apply change(item) and save it. None when there is no such item."""
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT payload FROM entities WHERE table_name = 'workItems' AND entity_id = ? AND deleted = 0",
            (item_id,),
        ).fetchone()
        if not row:
            return None
        item = json.loads(row[0])
        change(item)
        item["updatedAt"] = utc_now().isoformat()
        item["version"] = (item.get("version") or 1) + 1
        rev = next_revision(cursor)
        cursor.execute(
            "UPDATE entities SET payload = ?, revision = revision + 1, server_revision = ? WHERE table_name = 'workItems' AND entity_id = ?",
            (json.dumps(item), rev, item_id),
        )
        cursor.execute(
            "INSERT INTO sync_operations (operation_id, client_id, entity_type, entity_id, operation) VALUES (?, ?, ?, ?, ?)",
            (f"{label}-{item_id}-{rev}", source, "workItems", item_id, "save"),
        )
        conn.commit()
        return item, rev
    finally:
        conn.close()


def mark_done(item_id: str, source: str) -> Optional[Tuple[dict, int]]:
    def change(item: dict) -> None:
        item["status"] = "done"
        item["completedAt"] = utc_now().isoformat()
    return update_item(item_id, change, source, "notif-done")


def snooze(item_id: str, source: str, minutes: int = 60) -> Optional[Tuple[dict, int]]:
    def change(item: dict) -> None:
        item["snoozedUntil"] = (utc_now() + datetime.timedelta(minutes=minutes)).isoformat()
        item["snoozeCount"] = (item.get("snoozeCount") or 0) + 1
    return update_item(item_id, change, source, "notif-snooze")


def move_to_tomorrow(item_id: str, source: str, today: datetime.date) -> Optional[Tuple[dict, int]]:
    def change(item: dict) -> None:
        item["dueDate"] = (today + datetime.timedelta(days=1)).isoformat()
        item["snoozedUntil"] = None
    return update_item(item_id, change, source, "notif-tomorrow")


def set_fields(item_id: str, fields: dict, source: str) -> Optional[Tuple[dict, int]]:
    return update_item(item_id, lambda item: item.update(fields), source, f"{source}-edit")
