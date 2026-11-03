"""
Fewer waits on a slow disk for every SQLite connection Sage opens.

Sage's Pi can run from a USB pen drive, where each forced flush to disk
(fsync) can take seconds. With SQLite's default synchronous=FULL every commit
waits for one, so a busy minute (sync, notifier, posts, radar) stalled the
app and the page sat on its splash.

In WAL mode (init_db turns it on) synchronous=NORMAL is the setting SQLite
recommends: commits no longer wait for the disk, only checkpoints do, and the
database can't be corrupted by a power cut. At worst the last second or so
of saves before a power cut is lost.

synchronous is a per-connection setting, and Sage opens connections in many
modules with plain ``sqlite3.connect``. Importing this module (db_server does,
first) wraps that function once for the whole process, so every connection
gets it. SAGE_SQLITE_SYNCHRONOUS=FULL in /etc/sage/sage.env turns it back.

Keeping the database hot in RAM
-------------------------------
The Pi has plenty of memory (about 3.3 GB free) and a tiny database (under
10 MB), but it can boot from a slow USB drive where every read that misses
the OS cache costs a few milliseconds. Two per-connection PRAGMAs keep all of
Sage's tasks, items and post metadata in RAM so reads never wait on the drive:

* ``mmap_size`` memory-maps the database file. Pages are then read straight
  from RAM (served by the OS page cache) with no ``read()`` syscall. The whole
  file fits in the default 64 MB, so once it is warm it stays warm.
* ``cache_size`` is each connection's own page cache, set in MiB.

Both are bounded and safe: mmap is read-only here in effect (WAL still owns
writes), and losing power can't corrupt the database. Set SAGE_SQLITE_MMAP_MB=0
to turn mmap off, or SAGE_SQLITE_CACHE_MB to resize the per-connection cache.
"""

import os
import sqlite3

SYNCHRONOUS = os.getenv("SAGE_SQLITE_SYNCHRONOUS", "NORMAL").upper()


def _mb(name: str, default: int) -> int:
    try:
        return max(0, int(float(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


# 64 MiB maps the whole <10 MB database with headroom for growth; 16 MiB of
# per-connection page cache covers the working set of a single request.
MMAP_BYTES = _mb("SAGE_SQLITE_MMAP_MB", 64) * 1024 * 1024
CACHE_MB = _mb("SAGE_SQLITE_CACHE_MB", 16)

_original_connect = sqlite3.connect


def _tune(conn) -> None:
    try:
        if SYNCHRONOUS in ("OFF", "NORMAL", "FULL", "EXTRA"):
            conn.execute(f"PRAGMA synchronous={SYNCHRONOUS}")
        if MMAP_BYTES:
            conn.execute(f"PRAGMA mmap_size={MMAP_BYTES}")
        if CACHE_MB:
            # A negative cache_size is read as KiB rather than a page count.
            conn.execute(f"PRAGMA cache_size={-CACHE_MB * 1024}")
    except sqlite3.Error:
        pass


def connect(*args, **kwargs):
    conn = _original_connect(*args, **kwargs)
    _tune(conn)
    return conn


if not getattr(sqlite3.connect, "_sage_tuned", False):
    connect._sage_tuned = True
    sqlite3.connect = connect
