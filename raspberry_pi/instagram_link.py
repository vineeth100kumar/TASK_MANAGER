"""Find a posted post or reel on Instagram and keep its link (S-201).

Marking a post or reel as posted starts a short search: pull the project's recent
Instagram media, see which one is this piece (social._match_sage matches by
project, date and the opening of the caption) and save its permalink on the piece.
Instagram can take a few minutes to list a new post, so the search retries on a
back-off and then stops; "Find on Instagram" in the app tries again by hand.

instagramCheck on the piece: looking | found | missed | offline (no page connected).
"""

import asyncio
from typing import Any, Awaitable, Callable, Dict, List, Optional

import logstore
import social

RETRY_MINUTES = (0.5, 2, 8, 30, 90)   # waits before each try
_running: Dict[str, "asyncio.Task"] = {}


def lookup(kind: str, item_id: str) -> Optional[dict]:
    """The Instagram media already matched to this piece, if any."""
    conn = social._db()
    try:
        row = conn.execute(
            "SELECT id, permalink FROM social_media WHERE sage_kind = ? AND sage_id = ?"
            " AND permalink != '' ORDER BY posted_at DESC LIMIT 1", (kind, item_id)).fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def connected(project_id: str) -> bool:
    row = social.account_row(project_id) if project_id else None
    return bool(row and row.get("token"))


async def try_once(kind: str, item: dict) -> bool:
    """One pull and look. True when the link was found and set on the piece."""
    project_id = str(item.get("projectId") or "")
    if not connected(project_id):
        item["instagramCheck"] = "offline"
        return False
    hit = lookup(kind, item["id"])
    if not hit:
        await social.pull(project_id)
        hit = lookup(kind, item["id"])
    if not hit:
        return False
    item["instagramUrl"], item["instagramId"], item["instagramCheck"] = hit["permalink"], hit["id"], "found"
    return True


async def _search(kind: str, item_id: str, load: Callable[[str], Optional[dict]],
                  save: Callable[[dict], Awaitable[None]], delays: tuple) -> None:
    try:
        for wait in delays:
            await asyncio.sleep(wait * 60)
            item = load(item_id)
            if not item or not item.get("posted") or item.get("instagramUrl"):
                return
            try:
                found = await try_once(kind, item)
            except Exception as e:  # Instagram down or rate limited: try later
                logstore.warn("instagram", f"Looking for {kind} {item_id} on Instagram: {e}")
                found = False
            if found or item.get("instagramCheck") == "offline":
                await save(item)
                return
        item = load(item_id)
        if item and item.get("posted") and not item.get("instagramUrl"):
            item["instagramCheck"] = "missed"
            await save(item)
    finally:
        _running.pop(f"{kind}:{item_id}", None)


async def start(kind: str, item: dict, load: Callable[[str], Optional[dict]],
                save: Callable[[dict], Awaitable[None]], delays: tuple = RETRY_MINUTES) -> None:
    """Mark the piece as looking and start the background search."""
    key = f"{kind}:{item['id']}"
    if key in _running and not _running[key].done():
        return
    if item.get("instagramUrl"):
        return
    item["instagramCheck"] = "offline" if not connected(str(item.get("projectId") or "")) else "looking"
    await save(item)
    if item["instagramCheck"] == "offline":
        return
    _running[key] = asyncio.create_task(_search(kind, item["id"], load, save, delays))


def clear(kind: str, item: dict) -> None:
    """Unposted: forget the link and any search."""
    for field in ("instagramUrl", "instagramId", "instagramCheck"):
        item.pop(field, None)
    task = _running.pop(f"{kind}:{item.get('id')}", None)
    if task:
        task.cancel()
