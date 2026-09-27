#!/usr/bin/env python3
"""
Check Lumo's connection to Sage, the shared task manager.

Run this on the Pi after installing both services:

    cd lumo/rpi_server
    sudo systemctl status sage lumo
    sudo -E env $(sudo cat /etc/sage/sage.env | xargs) venv/bin/python test_sage.py

It reads the real lists, then does a full round trip through Sage's sync
protocol: adds a task, sees it on the list and on the event stream, completes
it, sets an alarm, and moves both to Sage's trash again.
"""

import asyncio
import sys

from services.sage_client import SageClient, key_search_report
from services.tasks import TaskService
from services.alarms import AlarmManager


async def main() -> int:
    sage = SageClient()
    print(f"Sage at {sage.base_url}")

    if sage.is_configured:
        print(f"Key found, ending in ...{sage.api_key[-4:]}")
    else:
        print("No API key found; carrying on in case Sage runs without one. Looked in:")
        for place in key_search_report().split("; "):
            print(f"    {place}")

    tasks = TaskService(sage)
    alarms = AlarmManager(sage)
    seen: list = []
    listener = asyncio.create_task(sage.listen(lambda e: _note(seen, e)))

    await tasks.refresh()
    if not sage.online:
        print(f"\nCould not reach Sage: {sage.last_error}")
        print("  Is it running?  sudo systemctl status sage")
        listener.cancel()
        return 1
    if sage.last_error:
        print(f"\n{sage.last_error}")
        listener.cancel()
        return 1

    open_tasks = tasks.get_tasks()
    print(f"\n{len(open_tasks)} open task(s):")
    for title in open_tasks[:5]:
        print(f"  - {title}")

    await alarms.refresh()
    print(f"\n{len(alarms.list_alarms())} alarm(s):")
    for a in alarms.list_alarms():
        print(f"  - {a['h']:02d}:{a['m']:02d}  {a['label']}  {'on' if a['enabled'] else 'off'}")

    await asyncio.sleep(1)
    if not any(e.get("type") == "AUTH_OK" for e in seen):
        print("\nThe event stream did not accept Lumo. Changes from the app will be up to "
              "two minutes late on the clock.")
        listener.cancel()
        await sage.close()
        return 1
    print("\nEvent stream connected and authenticated")

    failures = 0
    print("\nRound trip:")
    created = await sage.create_item({"title": "Lumo connection test", "entity_type": "task"})
    if created is None:
        print(f"  Could not write to Sage: {sage.last_error}")
        listener.cancel()
        return 1
    await tasks.refresh()
    ok = any(i["id"] == created["id"] for i in tasks.get_items())
    failures += not ok
    print(f"  {'ok ' if ok else 'BAD'} task created and listed")

    await asyncio.sleep(1)
    ok = any(
        e.get("type") == "SYNC_APPLIED" and any(c.get("entityId") == created["id"] for c in e.get("changes") or [])
        for e in seen
    )
    failures += not ok
    print(f"  {'ok ' if ok else 'BAD'} change announced on the event stream")

    ok = await tasks.complete_task(created["id"]) and not any(i["id"] == created["id"] for i in tasks.get_items())
    failures += not ok
    print(f"  {'ok ' if ok else 'BAD'} task completed and off the list")

    probe = await alarms.add_alarm(4, 44, "Lumo connection test")
    ok = probe is not None and any(a["id"] == probe.id for a in alarms.list_alarms())
    failures += not ok
    print(f"  {'ok ' if ok else 'BAD'} alarm set for 04:44")

    await tasks.delete_task(created["id"])
    if probe is not None:
        await alarms.delete_alarm(probe.id)
    ok = probe is None or not any(a["id"] == probe.id for a in alarms.list_alarms())
    failures += not ok
    print(f"  {'ok ' if ok else 'BAD'} test task and alarm moved to Sage's trash")

    listener.cancel()
    await sage.close()
    if failures:
        print(f"\n{failures} check(s) failed. Last error: {sage.last_error or 'none'}")
        return 1
    print("\nAll good. Lumo and Sage are sharing one list.")
    return 0


async def _note(seen: list, event: dict) -> None:
    seen.append(event)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
