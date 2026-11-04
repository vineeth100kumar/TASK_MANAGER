"""The single database writer: every write lands, in order, off the event loop."""
import asyncio
import sqlite3
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db_writer  # noqa: E402


def fresh_db() -> str:
    path = str(Path(tempfile.mkdtemp()) / "writer.db")
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (n INTEGER, who TEXT)")
    conn.commit()
    conn.close()
    return path


def count(path: str) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT COUNT(*) FROM t").fetchone()[0]
    finally:
        conn.close()


class DbWriterTests(unittest.TestCase):
    def setUp(self):
        self.path = fresh_db()
        self.w = db_writer.DbWriter(self.path)
        self.w.start()

    def tearDown(self):
        self.w.stop()

    def test_500_concurrent_writes_all_land(self):
        def one(i):
            return self.w.submit(lambda c: c.execute("INSERT INTO t VALUES (?, ?)", (i, threading.current_thread().name)))

        with ThreadPoolExecutor(max_workers=32) as pool:
            futures = list(pool.map(one, range(500)))
        for f in futures:
            f.result(timeout=10)  # raises on "database is locked"
        self.assertEqual(count(self.path), 500)
        self.assertEqual(self.w.failed, 0)

    def test_writes_run_on_one_thread_in_order(self):
        seen, order = set(), []

        def job(i):
            def run(conn):
                seen.add(threading.current_thread().name)
                order.append(i)
            return run

        futures = [self.w.submit(job(i)) for i in range(100)]
        for f in futures:
            f.result(timeout=10)
        self.assertEqual(seen, {"sage-db-writer"})
        self.assertEqual(order, list(range(100)))

    def test_a_failed_write_rolls_back_and_the_next_still_runs(self):
        def bad(conn):
            conn.execute("INSERT INTO t VALUES (1, 'half')")
            raise ValueError("boom")

        with self.assertRaises(ValueError):
            self.w.submit(bad).result(timeout=5)
        self.w.submit(lambda c: c.execute("INSERT INTO t VALUES (2, 'ok')")).result(timeout=5)
        self.assertEqual(count(self.path), 1)  # only the good one
        self.assertEqual(self.w.failed, 1)
        self.assertTrue(self.w.running)

    def test_async_write_leaves_the_event_loop_free(self):
        async def main():
            ticks = 0

            async def ticker():
                nonlocal ticks
                while True:
                    ticks += 1
                    await asyncio.sleep(0)

            task = asyncio.create_task(ticker())

            def slow(conn):
                import time
                time.sleep(0.2)
                conn.execute("INSERT INTO t VALUES (9, 'slow')")
                return "saved"

            result = await self.w.write(slow)
            task.cancel()
            return result, ticks

        result, ticks = asyncio.run(main())
        self.assertEqual(result, "saved")
        self.assertGreater(ticks, 50)  # the loop kept turning during the 200 ms write

    def test_stop_finishes_queued_writes(self):
        futures = [self.w.submit(lambda c, i=i: c.execute("INSERT INTO t VALUES (?, 'q')", (i,))) for i in range(50)]
        self.w.stop()
        for f in futures:
            f.result(timeout=1)
        self.assertEqual(count(self.path), 50)
        self.assertFalse(self.w.running)

    def test_submit_restarts_a_stopped_writer(self):
        self.w.stop()
        self.w.submit(lambda c: c.execute("INSERT INTO t VALUES (1, 'again')")).result(timeout=5)
        self.assertEqual(count(self.path), 1)


if __name__ == "__main__":
    unittest.main()
