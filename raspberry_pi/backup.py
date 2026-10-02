"""
Local copies of the Sage database on the Pi.

The database is one SQLite file. A copy is taken once a night, and just before
the data is cleared, using SQLite's own backup call so it is safe while the
server is writing. The newest KEEP copies are kept in SAGE_BACKUP_DIR (by
default a "backups" folder beside the database). Copy that folder somewhere
off the Pi now and then, since a dead SD card takes both with it.

To restore: stop sage, copy a backup over the database file, start sage.
"""

import asyncio
import datetime
import os
import sqlite3
from pathlib import Path
from typing import List, Optional

DB_PATH = os.getenv("SAGE_DB_PATH", "sage_sync.db")
BACKUP_DIR = Path(os.getenv("SAGE_BACKUP_DIR", str(Path(DB_PATH).resolve().parent / "backups")))
KEEP = int(os.getenv("SAGE_BACKUP_KEEP", "14"))
# Local time of the nightly copy, "HH:MM".
BACKUP_TIME = os.getenv("SAGE_BACKUP_TIME", "03:00")
CHECK_EVERY_SECONDS = 300
PREFIX = "sage-"
SUFFIX = ".db"


def _stamp(now: Optional[datetime.datetime] = None) -> str:
    return (now or datetime.datetime.now(datetime.timezone.utc)).strftime("%Y%m%d-%H%M%S")


def list_backups() -> List[Path]:
    """Backups, newest first."""
    if not BACKUP_DIR.is_dir():
        return []
    return sorted(BACKUP_DIR.glob(f"{PREFIX}*{SUFFIX}"), reverse=True)


def make_backup(reason: str = "nightly", now: Optional[datetime.datetime] = None) -> Path:
    """Copies the database into BACKUP_DIR and trims old copies. Raises on failure."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    tag = "" if reason == "nightly" else f"-{reason}"
    target = BACKUP_DIR / f"{PREFIX}{_stamp(now)}{tag}{SUFFIX}"
    partial = target.with_suffix(".partial")
    source = sqlite3.connect(DB_PATH)
    try:
        dest = sqlite3.connect(partial)
        try:
            source.backup(dest)
        finally:
            dest.close()
    finally:
        source.close()
    os.chmod(partial, 0o600)
    partial.replace(target)
    prune()
    return target


def prune() -> None:
    # Copies made before a clear are kept as long as the nightly ones.
    for old in list_backups()[KEEP:]:
        try:
            old.unlink()
        except OSError:
            pass


def status() -> dict:
    backups = list_backups()
    last = None
    if backups:
        last = datetime.datetime.fromtimestamp(backups[0].stat().st_mtime, datetime.timezone.utc).isoformat()
    return {
        "lastBackupAt": last,
        "count": len(backups),
        "keep": KEEP,
        "time": BACKUP_TIME,
        "folder": str(BACKUP_DIR),
    }


def due(now_local: datetime.datetime, last_utc: Optional[datetime.datetime]) -> bool:
    """True once today's backup time has passed and no copy was taken since then."""
    hour, minute = (int(x) for x in BACKUP_TIME.split(":"))
    scheduled = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now_local < scheduled:
        return False
    return last_utc is None or last_utc.astimezone(now_local.tzinfo) < scheduled


async def scheduler(local_now) -> None:
    """local_now() returns the current time in the user's time zone."""
    while True:
        try:
            backups = list_backups()
            last = datetime.datetime.fromtimestamp(backups[0].stat().st_mtime, datetime.timezone.utc) if backups else None
            if due(local_now(), last):
                path = await asyncio.to_thread(make_backup)
                print(f"Database backup written: {path.name}")
        except Exception as e:
            print(f"Database backup failed: {e}")
        await asyncio.sleep(CHECK_EVERY_SECONDS)
