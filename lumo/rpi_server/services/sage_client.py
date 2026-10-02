"""
Lumo's one connection to Sage.

Lumo keeps no tasks or alarms of its own. They live in Sage, and Lumo is one
more client of Sage's sync protocol, the same one the web app uses:

    GET  /api/sync/all          every record, to rebuild the local cache
    POST /api/sync/operations   save / patch changes, tagged with Lumo's clientId
    WS   /ws                    SYNC_APPLIED events, so the clock updates at once
    POST /api/parse-task        Sage's AI turns "call mum at 6" into a task

Sage stores work items in its own camelCase shape (entityType, dueDate,
remindAt, status, labels). The rest of Lumo was written against the older
snake_case API (entity_type, due_date, remind_at, is_completed, context_tags),
so this module translates in both directions and nothing else has to know.
That translation lives in to_lumo() and to_sage() below and nowhere else.
"""

import asyncio
import datetime
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import httpx
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import websockets

from config import (
    SAGE_API_KEY,
    SAGE_API_URL,
    SAGE_ENV_FILE,
    SAGE_REQUEST_TIMEOUT,
    SAGE_SECRET_FILE,
)

logger = logging.getLogger("SageClient")

# Times in Sage are wall-clock times ("2026-10-02T18:00") in the time zone chosen
# in Sage's settings, the same one the phone notifications use. Lumo reads that
# zone from Sage on every pull and uses it for "now", so an alarm rings when the
# phone would, whatever zone the Pi's own clock was left in. Until Sage has
# answered, the Pi's own zone is used.
_tz: Optional[ZoneInfo] = None


def set_timezone(name: Optional[str]) -> None:
    global _tz
    try:
        _tz = ZoneInfo(name) if name else None
    except (ZoneInfoNotFoundError, ValueError):
        _tz = None


def now_local() -> datetime.datetime:
    """The current time as naive wall-clock time in Sage's time zone."""
    if _tz is None:
        return datetime.datetime.now()
    return datetime.datetime.now(_tz).replace(tzinfo=None)


def to_local_naive(when: datetime.datetime) -> datetime.datetime:
    """A time from Sage as naive wall-clock time. Ones with an offset ("...Z") are converted."""
    if when.tzinfo is None:
        return when
    return when.astimezone(_tz).replace(tzinfo=None) if _tz else when.astimezone().replace(tzinfo=None)


def _key_from_env_file(path: str) -> str:
    """Read API_SECRET out of Sage's environment file, if it is readable."""
    try:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == "API_SECRET":
                return value.strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def find_secret_files() -> list:
    """
    Every place Sage's generated key file might be, best guess first.

    Sage writes a random key into its data directory when API_SECRET was never
    configured, which is the common case. That directory sits inside whatever
    the checkout was called, under whichever account runs it, so the checkout
    name is not worth guessing at: one level under the home directory covers
    it whatever it is called.
    """
    found = [Path(SAGE_SECRET_FILE)]
    try:
        found.extend(sorted(Path.home().glob("*/data/api_secret.txt")))
    except Exception:
        pass
    return found


def resolve_api_key() -> str:
    """
    Find Sage's key without ever storing a second copy of it.

    Sage keeps it in /etc/sage/sage.env, which is root-owned and unreadable by
    the account either service runs as. Under systemd that is not a problem:
    Lumo's unit carries the same EnvironmentFile line Sage's does, so systemd
    reads the file as root and hands the value down. Run by hand, none of that
    applies, so the generated key file is looked for and SAGE_API_KEY in .env
    is always the last word.
    """
    for candidate in (SAGE_API_KEY, os.environ.get("API_SECRET", "")):
        if candidate and candidate.strip():
            return candidate.strip()

    from_file = _key_from_env_file(SAGE_ENV_FILE)
    if from_file:
        logger.info(f"Using the Sage key from {SAGE_ENV_FILE}")
        return from_file

    for candidate in find_secret_files():
        try:
            key = candidate.read_text(encoding="utf-8").strip()
        except Exception:
            continue
        if key:
            logger.info(f"Using the Sage key from {candidate}")
            return key
    return ""


def key_search_report() -> str:
    """The places that were looked in, for the warning when none turned up."""
    places = [f"SAGE_API_KEY or API_SECRET in the environment or .env", SAGE_ENV_FILE]
    places.extend(str(p) for p in find_secret_files())
    return "; ".join(places)

# Sage's sync table for tasks, events, reminders and milestones.
WORK_ITEMS = "workItems"
CLIENT_ID = "lumo"

# Lumo field -> Sage field, for the fields that only change their name.
_RENAMED = {
    "title": "title",
    "description": "description",
    "priority": "priority",
    "entity_type": "entityType",
    "due_date": "dueDate",
    "start_at": "startAt",
    "remind_at": "remindAt",
}


def _sage_time(value: Optional[str]) -> Optional[str]:
    """Sage's app stores local times as YYYY-MM-DDTHH:MM; keep to that."""
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value).strftime("%Y-%m-%dT%H:%M")
    except (TypeError, ValueError):
        return value


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def to_lumo(item: dict) -> dict:
    """A Sage work item, in the shape Lumo's services read."""
    labels = item.get("labels") or []
    return {
        "id": item.get("id", ""),
        "title": item.get("title") or "",
        "description": item.get("description") or "",
        "priority": item.get("priority") or "medium",
        "entity_type": item.get("entityType") or "task",
        "due_date": item.get("dueDate"),
        "start_at": item.get("startAt"),
        "remind_at": item.get("remindAt"),
        "is_completed": item.get("status") == "done" or bool(item.get("completedAt")),
        "context_tags": ",".join(str(label) for label in labels),
    }


def to_sage(changes: dict) -> dict:
    """Lumo-shaped changes, as the Sage fields they set."""
    out: dict = {}
    for lumo_name, sage_name in _RENAMED.items():
        if lumo_name in changes:
            value = changes[lumo_name]
            if lumo_name in ("start_at", "remind_at"):
                value = _sage_time(value)
            out[sage_name] = value
    if "is_completed" in changes:
        done = bool(changes["is_completed"])
        out["status"] = "done" if done else "todo"
        out["completedAt"] = _utc_now() if done else None
    if "context_tags" in changes:
        tags = changes["context_tags"] or ""
        out["labels"] = [t.strip() for t in tags.split(",") if t.strip()]
    return out


class SageClient:
    """Lumo as a client of Sage's sync protocol."""

    def __init__(self, base_url: str = SAGE_API_URL):
        self.base_url = base_url.rstrip("/")
        self.api_key = resolve_api_key()
        self.online = False
        self.last_error = ""
        self._client: Optional[httpx.AsyncClient] = None
        # Last full copy of Sage's work items, by id. Updates need the current
        # version number, and it spares a round trip for every lookup.
        self.items: dict[str, dict] = {}

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    @property
    def ws_url(self) -> str:
        scheme = "wss" if self.base_url.startswith("https") else "ws"
        host = self.base_url.split("://", 1)[-1]
        return f"{scheme}://{host}/ws"

    def status(self) -> dict:
        return {
            "configured": self.is_configured,
            "online": self.online,
            "url": self.base_url,
            "last_error": self.last_error,
        }

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=SAGE_REQUEST_TIMEOUT,
                headers=headers,
            )
        return self._client

    async def request(self, method: str, path: str, **kwargs) -> Any:
        """
        One call to Sage. Returns None rather than raising when Sage is down,
        so a restarting server leaves the desk companion showing its last
        known list instead of an error.
        """
        try:
            client = await self._get_client()
            response = await client.request(method, path, **kwargs)
            response.raise_for_status()
            self.online = True
            self.last_error = ""
            if response.status_code == 204 or not response.content:
                return {}
            return response.json()
        except httpx.HTTPStatusError as exc:
            self.online = True
            self.last_error = f"{exc.response.status_code} from Sage on {path}"
            if exc.response.status_code == 401:
                self.last_error = (
                    "Sage rejected Lumo's API key" if self.api_key
                    else "Sage wants an API key and Lumo has none"
                )
            logger.error(self.last_error)
            return None
        except Exception as exc:
            self.online = False
            self.last_error = f"Sage unreachable: {exc}"
            logger.warning(self.last_error)
            return None

    # ---------------- Sync protocol ----------------

    async def pull(self) -> bool:
        """Replace the cache with Sage's current work items."""
        data = await self.request("GET", "/api/sync/all")
        if not isinstance(data, dict) or not data.get("success"):
            return False
        rows = (data.get("data") or {}).get(WORK_ITEMS) or []
        self.items = {row["id"]: row for row in rows if isinstance(row, dict) and row.get("id")}
        await self._refresh_timezone()
        return True

    async def _refresh_timezone(self) -> None:
        try:
            config = await self.request("GET", "/api/notifications")
            set_timezone(((config or {}).get("prefs") or {}).get("timezone"))
        except Exception as exc:  # an older Sage without the endpoint: keep the Pi's zone
            logger.debug(f"Couldn't read Sage's time zone: {exc}")

    async def _save(self, item_id: str, payload: dict, revision: int) -> bool:
        body = {
            "action": "processOperations",
            "clientId": CLIENT_ID,
            "operations": [{
                "operationId": str(uuid.uuid4()),
                "clientId": CLIENT_ID,
                "entityType": WORK_ITEMS,
                "entityId": item_id,
                "operation": "save",
                "revision": revision,
                "payload": payload,
            }],
        }
        result = await self.request("POST", "/api/sync/operations", json=body)
        if not isinstance(result, dict) or not result.get("success"):
            return False
        outcome = (result.get("results") or [{}])[0]
        if outcome.get("status") != "applied":
            self.last_error = f"Sage did not apply Lumo's change: {outcome.get('reason') or outcome.get('status')}"
            logger.error(self.last_error)
            return False
        return True

    # ---------------- Work items, in Lumo's shape ----------------

    async def list_items(self, entity_type: Optional[str] = None, **_ignored) -> list[dict]:
        """
        Open and recently touched items of one type. Items in Sage's trash
        (deletedAt set) are left out, as the app leaves them out.
        """
        if not await self.pull():
            return []
        rows = [
            row for row in self.items.values()
            if not row.get("deletedAt")
            and (entity_type is None or (row.get("entityType") or "task") == entity_type)
        ]
        return [to_lumo(row) for row in rows]

    async def create_item(self, payload: dict) -> Optional[dict]:
        """Create a work item from Lumo-shaped fields, filled in the way the app would."""
        now = _utc_now()
        fields = to_sage(payload)
        entity_type = fields.get("entityType") or "task"
        count = sum(1 for row in self.items.values() if str(row.get("key", "")).startswith("LUMO-"))
        item = {
            "id": str(uuid.uuid4()),
            "key": f"LUMO-{count + 1}",
            "title": "Untitled Item",
            "description": "",
            "entityType": entity_type,
            "lifeContext": "personal",
            "type": "reminder" if entity_type == "reminder" else "task",
            "status": "todo",
            "priority": "medium",
            "projectId": None,
            "areaId": None,
            "startDate": None,
            "dueDate": None,
            "startAt": None,
            "endAt": None,
            "remindAt": None,
            "repeatRule": None,
            "labels": [],
            "customFields": {"source": "lumo"},
            "isInbox": entity_type == "task",
            "isFocus": False,
            "snoozeCount": 0,
            "version": 1,
            "completedAt": None,
            "deletedAt": None,
            "createdAt": now,
            "updatedAt": now,
            "lastTouchedAt": now,
        }
        item.update(fields)
        if not await self._save(item["id"], item, 1):
            return None
        self.items[item["id"]] = item
        return to_lumo(item)

    async def update_item(self, item_id: str, payload: dict) -> Optional[dict]:
        """Apply Lumo-shaped changes. Sage merges them field by field."""
        existing = self.items.get(item_id)
        if existing is None:
            await self.pull()
            existing = self.items.get(item_id)
        if existing is None:
            self.last_error = f"Sage has no item {item_id}"
            return None
        version = int(existing.get("version") or 1) + 1
        now = _utc_now()
        changes = {**to_sage(payload), "version": version, "updatedAt": now, "lastTouchedAt": now}
        if not await self._save(item_id, changes, version):
            return None
        merged = {**existing, **changes}
        self.items[item_id] = merged
        return to_lumo(merged)

    async def delete_item(self, item_id: str) -> bool:
        """
        Move an item to Sage's trash, as deleting it in the app does. A soft
        delete also reaches other devices through their normal change pull.
        """
        existing = self.items.get(item_id) or {}
        version = int(existing.get("version") or 1) + 1
        now = _utc_now()
        changes = {"deletedAt": now, "version": version, "updatedAt": now}
        if not await self._save(item_id, changes, version):
            return False
        if item_id in self.items:
            self.items[item_id] = {**existing, **changes}
        return True

    async def capture(self, text: str) -> Optional[dict]:
        """
        Turn a line of ordinary speech into tasks with Sage's own parser, so
        "call mum tomorrow" said to Lumo lands the way it would typed into the
        app. When the parser is unavailable the line is saved as it was said.
        """
        parsed = await self.request(
            "POST", "/api/parse-task", json={"natural_language": text}, timeout=45.0
        )
        drafts = parsed.get("data") if isinstance(parsed, dict) and parsed.get("success") else None
        if isinstance(drafts, dict):
            drafts = drafts.get("tasks") or [drafts]
        if not isinstance(drafts, list) or not drafts:
            drafts = [{"title": text}]

        first = None
        for draft in drafts:
            if not isinstance(draft, dict) or not (draft.get("title") or "").strip():
                continue
            due = draft.get("dueDate")
            created = await self.create_item({
                "title": draft["title"].strip(),
                "priority": draft.get("priority") if draft.get("priority") in ("low", "medium", "high", "urgent") else "medium",
                "due_date": due if isinstance(due, str) and len(due) == 10 else None,
            })
            first = first or created
        return first

    # ---------------- Live events ----------------

    async def listen(self, handler: Callable[[dict], Awaitable[None]]) -> None:
        """
        Follow Sage's event stream forever, reconnecting when it drops.

        Every batch any client applies arrives here as a SYNC_APPLIED event
        within the second, so Lumo never has to poll for changes.
        """
        backoff = 2
        while True:
            try:
                async with websockets.connect(self.ws_url) as socket:
                    # The socket is accepted before it is trusted: the first
                    # frame has to be the key, or Sage closes the connection.
                    await socket.send(json.dumps({"type": "auth", "token": self.api_key}))
                    logger.info(f"Connected to Sage event stream at {self.ws_url}")
                    backoff = 2
                    self.online = True
                    async for raw in socket:
                        try:
                            event = json.loads(raw)
                        except (ValueError, TypeError):
                            continue
                        if not isinstance(event, dict) or not event.get("type"):
                            continue
                        try:
                            await handler(event)
                        except Exception as exc:
                            logger.error(f"Error handling Sage event: {exc}")
            except Exception as exc:
                self.online = False
                logger.warning(f"Sage event stream lost ({exc}); retrying in {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
