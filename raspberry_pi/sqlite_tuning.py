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
"""

import os
import sqlite3

SYNCHRONOUS = os.getenv("SAGE_SQLITE_SYNCHRONOUS", "NORMAL").upper()

_original_connect = sqlite3.connect


def _tune(conn) -> None:
    try:
        if SYNCHRONOUS in ("OFF", "NORMAL", "FULL", "EXTRA"):
            conn.execute(f"PRAGMA synchronous={SYNCHRONOUS}")
    except sqlite3.Error:
        pass


def connect(*args, **kwargs):
    conn = _original_connect(*args, **kwargs)
    _tune(conn)
    return conn


if not getattr(sqlite3.connect, "_sage_tuned", False):
    connect._sage_tuned = True
    sqlite3.connect = connect
