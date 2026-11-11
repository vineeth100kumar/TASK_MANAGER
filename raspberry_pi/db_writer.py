"""
One thread that does every database write, so the web server never waits.

Before this, handlers and workers opened their own ``sqlite3.connect`` and
committed inline. On the Pi's slow disk each commit can take a while, and
while it ran the whole event loop stood still: no request was answered.

Now a write is a small function handed to ``submit()``. It runs on a single
writer thread with its own connection, in the order it was submitted, and the
caller gets a future back. From async code ``await write(fn)`` leaves the event
loop free while the commit happens.

The function receives the writer's connection. It does not commit: the writer
commits when the function returns and rolls back if it raises, so one batch
is one transaction. Reads stay as they are; WAL lets them carry on while the
writer saves.

Only the core process writes to the database, so one writer is enough and
there is no contention between processes. See raspberry_pi/README.md.
"""

import asyncio
import queue
import sqlite3
import threading
from concurrent.futures import Future
from typing import Any, Callable, Optional

import logstore

_STOP = object()


class DbWriter:
    def __init__(self, path: str):
        self.path = path
        self._queue: "queue.Queue" = queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self.done = 0
        self.failed = 0

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def waiting(self) -> int:
        """Writes queued and not yet started (shown in the health report)."""
        return self._queue.qsize()

    def start(self) -> None:
        with self._lock:
            if self.running:
                return
            self._thread = threading.Thread(target=self._run, name="sage-db-writer", daemon=True)
            self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """Finish what is queued, then stop. Called on shutdown."""
        with self._lock:
            thread = self._thread
        if thread is None or not thread.is_alive():
            return
        self._queue.put(_STOP)
        thread.join(timeout)

    def submit(self, fn: Callable[[sqlite3.Connection], Any]) -> Future:
        """Queue ``fn(conn)``; the future holds its return value or its error."""
        if not self.running:
            self.start()
        future: Future = Future()
        self._queue.put((fn, future))
        return future

    async def write(self, fn: Callable[[sqlite3.Connection], Any]) -> Any:
        """``await`` a write from async code without blocking the event loop."""
        return await asyncio.wrap_future(self.submit(fn))

    def _run(self) -> None:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        try:
            while True:
                item = self._queue.get()
                if item is _STOP:
                    break
                fn, future = item
                if not future.set_running_or_notify_cancel():
                    continue
                try:
                    result = fn(conn)
                    conn.commit()
                    self.done += 1
                    future.set_result(result)
                except BaseException as e:  # the caller decides what to do with it
                    self.failed += 1
                    try:
                        conn.rollback()
                    except sqlite3.Error:
                        pass
                    if not isinstance(e, sqlite3.OperationalError):
                        logstore.warn("db", f"A queued write failed: {e!r}")
                    future.set_exception(e)
        finally:
            conn.close()


writer: Optional[DbWriter] = None


def connect(path: str) -> DbWriter:
    """Create the process-wide writer for this database and start it."""
    global writer
    if writer is not None:
        writer.stop()
    writer = DbWriter(path)
    writer.start()
    return writer


def get(path: str) -> DbWriter:
    """The writer for this database, made and started on first use.

    Callers use this instead of connect() so a write works without waiting for
    server startup (tests) and follows DB_PATH if it is changed."""
    global writer
    if writer is None or writer.path != path:
        return connect(path)
    if not writer.running:
        writer.start()
    return writer


def submit(fn: Callable[[sqlite3.Connection], Any]) -> Future:
    if writer is None:
        raise RuntimeError("db_writer.connect(path) has not been called")
    return writer.submit(fn)


async def write(fn: Callable[[sqlite3.Connection], Any]) -> Any:
    if writer is None:
        raise RuntimeError("db_writer.connect(path) has not been called")
    return await writer.write(fn)


def stop() -> None:
    if writer is not None:
        writer.stop()
