"""Tests for uptime.py: the "Sage is back up" email after downtime.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import datetime
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ.setdefault("SAGE_DB_PATH", str(Path(TMP) / "test.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import notifier  # noqa: E402
import uptime  # noqa: E402

UTC = datetime.timezone.utc


def utc(*args) -> datetime.datetime:
    return datetime.datetime(*args, tzinfo=UTC)


class UptimeTests(unittest.TestCase):
    def setUp(self):
        self.state = Path(tempfile.mkdtemp()) / "sage_uptime.json"
        patcher = mock.patch.object(uptime, "STATE_FILE", self.state)
        patcher.start()
        self.addCleanup(patcher.stop)
        notifier.init_tables()
        conn = sqlite3.connect(notifier.DB_PATH)
        conn.execute("DELETE FROM metadata WHERE key = 'notifyPrefs'")
        conn.commit()
        conn.close()
        notifier.save_prefs({"timezone": "Asia/Kolkata", "playful": False})

    def run_until(self, start, stop=None, beat=None, commit="aaa1111"):
        uptime.on_start(now=start, commit=commit, booted=utc(2026, 10, 1))
        if beat:
            uptime.beat(now=beat)
        if stop:
            uptime.on_stop(now=stop)

    def test_first_start_sends_nothing(self):
        self.assertIsNone(uptime.on_start(now=utc(2026, 10, 30, 9), commit="aaa1111"))

    def test_update_is_named_with_the_gap(self):
        self.run_until(utc(2026, 10, 30, 8), stop=utc(2026, 10, 30, 9, 0, 0))
        outage = uptime.on_start(now=utc(2026, 10, 30, 9, 0, 40), commit="bbb2222", booted=utc(2026, 10, 1))
        self.assertEqual(outage["reasons"], [{"kind": "update", "from": "aaa1111", "to": "bbb2222"}])
        self.assertEqual(outage["fromCommit"], "aaa1111")
        with mock.patch.object(uptime, "changes", return_value=["Email when Sage is back up"]):
            mail = uptime.message(outage, notifier.get_prefs(), "bbb2222")
        self.assertEqual(mail["subject"], "Sage is back up (down 40 seconds)")
        self.assertIn("Updated to new code", mail["text"])
        self.assertIn("14:30", mail["text"])  # shown in the chosen time zone
        self.assertIn("Email when Sage is back up", mail["text"])

    def test_clean_restart_without_new_code(self):
        self.run_until(utc(2026, 10, 30, 8), stop=utc(2026, 10, 30, 9))
        outage = uptime.on_start(now=utc(2026, 10, 30, 9, 1), commit="aaa1111", booted=utc(2026, 10, 1))
        self.assertEqual(outage["reasons"][0]["kind"], "restart")

    def test_power_cut_counts_from_the_last_heartbeat(self):
        self.run_until(utc(2026, 10, 30, 8), beat=utc(2026, 10, 30, 8, 30))
        outage = uptime.on_start(now=utc(2026, 10, 30, 10), commit="aaa1111", booted=utc(2026, 10, 30, 9, 59))
        self.assertEqual(outage["reasons"][0]["kind"], "power")
        self.assertEqual(outage["downAt"], utc(2026, 10, 30, 8, 30).isoformat())
        mail = uptime.message(outage, {**notifier.get_prefs(), "playful": True}, "aaa1111")
        self.assertIn("power", mail["subject"])
        self.assertIn("1 h 30 min", mail["subject"])

    def test_crash_without_reboot(self):
        self.run_until(utc(2026, 10, 30, 8), beat=utc(2026, 10, 30, 8, 30))
        outage = uptime.on_start(now=utc(2026, 10, 30, 8, 30, 20), commit="aaa1111", booted=utc(2026, 10, 1))
        self.assertEqual(outage["reasons"][0]["kind"], "crash")

    def test_quick_restarts_merge_into_one_email(self):
        self.run_until(utc(2026, 10, 30, 8), stop=utc(2026, 10, 30, 9))
        uptime.on_start(now=utc(2026, 10, 30, 9, 0, 30), commit="bbb2222", booted=utc(2026, 10, 1))
        uptime.on_stop(now=utc(2026, 10, 30, 9, 0, 50))  # restarted again before settling
        outage = uptime.on_start(now=utc(2026, 10, 30, 9, 1, 10), commit="bbb2222", booted=utc(2026, 10, 1))
        self.assertEqual(outage["downAt"], utc(2026, 10, 30, 9).isoformat())
        self.assertEqual(outage["restarts"], 2)
        self.assertEqual(outage["fromCommit"], "aaa1111")
        self.assertEqual(uptime._main_reason(outage["reasons"]), "update")

    def test_sends_once_and_respects_the_toggle(self):
        self.run_until(utc(2026, 10, 30, 8), stop=utc(2026, 10, 30, 9))
        uptime.on_start(now=utc(2026, 10, 30, 9, 1), commit="aaa1111", booted=utc(2026, 10, 1))
        with mock.patch.object(notifier, "smtp_password", return_value="pw"), \
                mock.patch.object(notifier, "send_email") as send:
            self.assertEqual(uptime.send_pending(now=utc(2026, 10, 30, 9, 3)), "sent")
            self.assertEqual(uptime.send_pending(now=utc(2026, 10, 30, 9, 4)), "none")
            self.assertEqual(send.call_count, 1)

            notifier.save_prefs({"email": {"backUp": False}})
            uptime.on_stop(now=utc(2026, 10, 30, 10))
            uptime.on_start(now=utc(2026, 10, 30, 10, 1), commit="aaa1111", booted=utc(2026, 10, 1))
            self.assertEqual(uptime.send_pending(now=utc(2026, 10, 30, 10, 3)), "off")
            self.assertEqual(send.call_count, 1)

    def test_failed_send_stays_pending(self):
        self.run_until(utc(2026, 10, 30, 8), stop=utc(2026, 10, 30, 9))
        uptime.on_start(now=utc(2026, 10, 30, 9, 1), commit="aaa1111", booted=utc(2026, 10, 1))
        with mock.patch.object(notifier, "smtp_password", return_value="pw"), \
                mock.patch.object(notifier, "send_email", side_effect=OSError("no network")):
            with self.assertRaises(OSError):
                uptime.send_pending(now=utc(2026, 10, 30, 9, 3))
        self.assertIsNotNone(uptime.read_state()["pending"])

    def test_late_heartbeat_keeps_the_clean_stop(self):
        self.run_until(utc(2026, 10, 30, 8), stop=utc(2026, 10, 30, 9))
        uptime.beat(now=utc(2026, 10, 30, 9, 0, 5))
        self.assertTrue(uptime.read_state()["clean"])


if __name__ == "__main__":
    unittest.main()
