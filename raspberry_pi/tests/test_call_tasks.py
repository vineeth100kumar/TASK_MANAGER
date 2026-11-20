import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("SAGE_DB_PATH", str(Path(tempfile.mkdtemp()) / "test.db"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import call_tasks  # noqa: E402
import item_shape  # noqa: E402


class CallTasksTest(unittest.TestCase):
    def test_who_earns_a_task(self):
        self.assertTrue(call_tasks.should_make_task("Sansa", 0, 10_000))
        self.assertFalse(call_tasks.should_make_task("", 0, 10_000))
        self.assertFalse(call_tasks.should_make_task("+91 98765 43210", 0, 10_000))
        self.assertFalse(call_tasks.should_make_task("Sansa", 10_000 - 60, 10_000))
        self.assertTrue(call_tasks.should_make_task("Sansa", 10_000 - call_tasks.CALL_TASK_GAP_S, 10_000))

    def test_payload_is_a_plain_task(self):
        p = call_tasks.task_payload("Sansa", "2026-11-20", "2026-11-20T06:30:00+00:00")
        self.assertEqual(p["title"], "Call Sansa back")
        self.assertEqual(p["dueDate"], "2026-11-20")
        self.assertEqual(item_shape.kind_of(p), "task")
        self.assertNotEqual(p["id"], call_tasks.task_payload("Sansa", "2026-11-20", "2026-11-20T06:30:00+00:00")["id"])


if __name__ == "__main__":
    unittest.main()
