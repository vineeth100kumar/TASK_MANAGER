"""One piece of work, two views: a post or reel and its task in the content project.

posts.py / reels.py already move the task when the post or reel changes (Scripting while it is
written, Recording while it waits for a voice, Editing when made, Published when posted,
Incomplete when dropped). This is the other direction: when the task is moved on the project's
board, the post or reel follows, so there is a single record of where a piece stands and
neither side can disagree with the other.

Only the ends of the road are followed. Dragging a task to Published marks the piece posted,
to Incomplete drops it ("won't post"), and back to any working stage brings it back. Moving
between Idea, Scripting, Recording and Editing is the board's own business: the Pi has
nothing to change for those.

Every move is idempotent, because the post's own change moves the task again and that arrives
here a second time. A second pass finds nothing left to do and stops.
"""
import datetime
from typing import Optional, Tuple

import logstore
import posts
import reels

WORKING = {"idea", "scripting", "recording", "editing", "blocked"}


def _utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _piece(task: dict) -> Optional[Tuple[object, dict]]:
    """The module and the post or reel this task stands for, if it still exists."""
    for key, mod in (("postId", posts), ("reelId", reels)):
        item_id = task.get(key)
        if item_id:
            item = mod.get(str(item_id))
            return (mod, item) if item else None
    return None


async def follow_task(task: dict) -> Optional[str]:
    """Bring the post or reel in line with its task. Returns what it did, or None."""
    found = _piece(task)
    stage = str(task.get("stage") or "")
    if not found or not stage:
        return None   # not a post's or reel's task, or a project type with no stages
    mod, item = found

    if stage == "published":
        if item.get("posted") and not item.get("wontPost"):
            return None
        if item.get("status") != "done":
            # Only a finished piece can be posted: put the task back where the piece really is.
            await mod._move_task(item, *posts._task_stage(item))
            return "refused"
        item["posted"], item["postedAt"], item["wontPost"] = True, _utc(), False
        await mod.save_async(item)
        await mod._move_task(item, "published", "done")
        return "posted"

    if stage == "incomplete":
        if item.get("wontPost"):
            return None
        await posts.set_wont_post(item, True, mod.save_async)
        return "dropped"

    if stage in WORKING:
        if item.get("wontPost"):
            await posts.set_wont_post(item, False, mod.save_async)
            return "restored"
        if item.get("posted"):
            item["posted"], item["postedAt"] = False, None
            await mod.save_async(item)
            return "unposted"
    return None


async def follow_ids(task_ids) -> None:
    """Called after a batch of saved work items. Never raises: the board's move already happened."""
    import claude_api   # late: claude_api imports db_server's writer, which imports this
    for task_id in dict.fromkeys(task_ids):
        try:
            task = claude_api._find("workItems", task_id)
            if task:
                await follow_task(task)
        except Exception as e:
            logstore.warn("posts", f"Couldn't follow task {task_id} to its post or reel: {e}")
