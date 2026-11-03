"""Where Sage keeps its live data, and a safe fallback when the SD card is out.

Sage's write-heavy files (the SQLite database and its WAL, sage.log, Drop sites
and clips, secrets, the desk clock's photos) all live next to the database, so
moving them is one setting: SAGE_DB_PATH. On the Pi that points at the fast SD
card, for example /mnt/sagedata/sage/sage_sync.db.

The card is mounted with ``nofail``, so the Pi still boots without it. In that
case /mnt/sagedata is just an empty folder on the slow boot drive. Writing a
new, empty database there would look like total data loss, so this module runs
first, before anything reads SAGE_DB_PATH, and picks the safe place:

  * SAGE_DATA_MOUNT   the card's mount point (for example /mnt/sagedata)
  * SAGE_DB_PATH      the database on the card
  * SAGE_DB_FALLBACK  the old database on the boot drive (left in place by the
                      migration until you delete it)

If the card isn't mounted, or the database hasn't been copied onto it yet,
SAGE_DB_PATH is switched to SAGE_DB_FALLBACK for this run, and status() says
why so health can show it. With none of these set (a laptop, the tests) nothing
changes.
"""
import os
import shutil
from pathlib import Path
from typing import Any, Dict

MOUNT = os.getenv("SAGE_DATA_MOUNT", "").strip()
CONFIGURED = os.getenv("SAGE_DB_PATH", "").strip()
FALLBACK = os.getenv("SAGE_DB_FALLBACK", "").strip()


def _choose() -> Dict[str, Any]:
    if not MOUNT:
        return {"mode": "plain", "using": CONFIGURED or "sage_sync.db", "reason": None}
    mounted = os.path.ismount(MOUNT)
    if not CONFIGURED:
        return {"mode": "plain", "using": "sage_sync.db", "reason": None}
    if not mounted:
        if FALLBACK:
            return {"mode": "fallback", "using": FALLBACK,
                    "reason": f"{MOUNT} is not mounted (SD card missing or failed); using the boot drive copy."}
        return {"mode": "unmounted", "using": CONFIGURED,
                "reason": f"{MOUNT} is not mounted and no fallback is set; writing to the boot drive."}
    if not Path(CONFIGURED).exists() and FALLBACK and Path(FALLBACK).exists():
        return {"mode": "fallback", "using": FALLBACK,
                "reason": "The SD card is mounted but the database has not been copied onto it yet "
                          "(run deploy/migrate_data_to_card.sh)."}
    return {"mode": "card", "using": CONFIGURED, "reason": None}


_state = _choose()
if _state["using"] != CONFIGURED and _state["mode"] != "plain":
    os.environ["SAGE_DB_PATH"] = _state["using"]


def _mount_options(mount: str) -> str:
    try:
        with open("/proc/mounts") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 4 and parts[1] == mount:
                    return parts[3]
    except OSError:
        pass
    return ""


def status() -> Dict[str, Any]:
    """Which disk Sage's data is on right now, and how the card is doing."""
    out: Dict[str, Any] = {
        "mode": _state["mode"],            # plain | card | fallback | unmounted
        "dataDir": str(Path(os.getenv("SAGE_DB_PATH", "sage_sync.db")).resolve().parent),
        "reason": _state["reason"],
    }
    if not MOUNT:
        return out
    out["mount"] = MOUNT
    out["mounted"] = os.path.ismount(MOUNT)
    if out["mounted"]:
        try:
            usage = shutil.disk_usage(MOUNT)
            out.update(totalBytes=usage.total, freeBytes=usage.free,
                       freePercent=round(100 * usage.free / usage.total, 1) if usage.total else None)
        except OSError as e:
            out["error"] = f"{e.__class__.__name__}: {e}"[:200]
        # ext4 flips to read-only after disk errors; a worn card does this.
        opts = _mount_options(MOUNT).split(",")
        out["readOnly"] = "ro" in opts
        out["writable"] = os.access(MOUNT, os.W_OK) and not out["readOnly"]
    return out

