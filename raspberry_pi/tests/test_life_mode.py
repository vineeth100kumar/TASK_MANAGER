"""Tests for life_mode.py: home/away picks Work or Chill, a hand-picked mode
lasts until you arrive or leave, and Chill holds work reminders until Work
mode is back.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import datetime
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import life_mode  # noqa: E402
import notifier  # noqa: E402

UTC = datetime.timezone.utc


class Presence:
    """Stands in for the phone link."""

    def __init__(self):
        self.known, self.home = True, False

    def __call__(self):
        return self.known, self.home


def reset_db():
    conn = sqlite3.connect(life_mode.DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("DELETE FROM metadata WHERE key IN ('lifeMode', 'lifeModeHeld', 'lifeModeArrival')")
    conn.commit()
    conn.close()


class ResolveTests(unittest.TestCase):
    """The pure rule, no database."""

    def settings(self, **extra):
        return {**life_mode.DEFAULTS, **extra}

    def test_home_is_chill_and_away_is_work(self):
        self.assertEqual(life_mode.resolve(self.settings(), True, True)[0]["mode"], "chill")
        self.assertEqual(life_mode.resolve(self.settings(), True, False)[0]["mode"], "work")

    def test_no_phone_link_stays_on_work(self):
        state, _ = life_mode.resolve(self.settings(), False, True)
        self.assertEqual(state["mode"], "work")
        self.assertEqual(state["source"], "no-phone")
        self.assertFalse(state["home"])

    def test_override_holds_until_home_changes(self):
        s = life_mode.choose(self.settings(), "work", True, True)  # at home, want Work
        state, kept = life_mode.resolve(s, True, True)
        self.assertEqual((state["mode"], state["source"]), ("work", "override"))
        self.assertEqual(kept, s)
        # Leave: Auto takes over (Work), override gone.
        state, kept = life_mode.resolve(s, True, False)
        self.assertEqual((state["mode"], state["source"]), ("work", "presence"))
        self.assertIsNone(kept["override"])
        # Back home later: Chill again, the old pick doesn't come back.
        self.assertEqual(life_mode.resolve(kept, True, True)[0]["mode"], "chill")

    def test_picking_what_auto_picks_clears_the_override(self):
        s = life_mode.choose(self.settings(), "chill", True, True)
        self.assertIsNone(s["override"])

    def test_auto_off_keeps_the_picked_mode(self):
        s = life_mode.choose(self.settings(auto=False), "chill", True, False)
        self.assertEqual(life_mode.resolve(s, True, False)[0], {
            "mode": "chill", "source": "manual", "auto": False, "known": True, "home": False, "urgentThrough": False})
        self.assertEqual(life_mode.resolve(s, True, True)[0]["mode"], "chill")

    def test_unknown_mode_is_refused(self):
        with self.assertRaises(ValueError):
            life_mode.choose(self.settings(), "party", True, True)

    def test_which_items_chill_hides(self):
        self.assertTrue(life_mode.hidden_in_chill({"lifeContext": "work"}))
        self.assertTrue(life_mode.hidden_in_chill({}))  # unset counts as work, like the web app
        self.assertFalse(life_mode.hidden_in_chill({"lifeContext": "personal"}))
        self.assertFalse(life_mode.hidden_in_chill({"lifeContext": "Life"}))
        self.assertFalse(life_mode.hidden_in_chill({"labels": ["alarm"]}))  # LUMO alarms always ring


class StoredModeTests(unittest.TestCase):
    def setUp(self):
        reset_db()
        self.addCleanup(reset_db)  # the database is shared with the other test files
        self.presence = Presence()
        patcher = mock.patch.object(life_mode, "presence", self.presence)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_arriving_and_leaving_switch_modes(self):
        self.assertEqual(life_mode.current()["mode"], "work")
        self.presence.home = True
        self.assertEqual(life_mode.current()["mode"], "chill")

    def test_manual_pick_is_saved_and_dropped_on_leaving(self):
        self.presence.home = True
        self.assertEqual(life_mode.set_mode("work")["source"], "override")
        self.assertEqual(life_mode.current()["mode"], "work")  # still, after a re-read
        self.presence.home = False
        life_mode.current()
        self.assertIsNone(life_mode.get_settings()["override"])

    def test_turning_auto_off_keeps_what_shows(self):
        self.presence.home = True
        state = life_mode.update_settings({"auto": False})
        self.assertEqual((state["mode"], state["source"]), ("chill", "manual"))
        self.presence.home = False
        self.assertEqual(life_mode.current()["mode"], "chill")

    def test_held_reminders(self):
        life_mode.hold({"id": "a", "title": "Send report"})
        life_mode.hold({"id": "a", "title": "Send report"})  # once per item
        life_mode.hold({"id": "b", "title": "Review PR"})
        self.assertEqual([h["id"] for h in life_mode.held()], ["a", "b"])
        life_mode.clear_held()
        self.assertEqual(life_mode.held(), [])


def put_items(*items) -> None:
    conn = sqlite3.connect(notifier.DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS entities (table_name TEXT, entity_id TEXT, revision INTEGER, payload TEXT, deleted INTEGER DEFAULT 0, server_revision INTEGER, PRIMARY KEY (table_name, entity_id))")
    conn.execute("DELETE FROM entities")
    for item in items:
        item = {"status": "todo", "entityType": "task", "priority": "medium", **item}
        conn.execute("INSERT INTO entities VALUES ('workItems', ?, 1, ?, 0, 1)", (item["id"], json.dumps(item)))
    conn.commit()
    conn.close()


class ChillRemindersTests(unittest.TestCase):
    """The notifier in Chill: work reminders wait, personal ones go out."""

    def setUp(self):
        notifier.init_tables()
        reset_db()
        self.addCleanup(reset_db)
        conn = sqlite3.connect(notifier.DB_PATH)
        conn.execute("DELETE FROM notification_log")
        conn.execute("DELETE FROM metadata WHERE key = 'notifyPrefs'")
        conn.execute("DELETE FROM push_subscriptions")
        conn.execute("INSERT INTO push_subscriptions VALUES ('https://push.example/1', '{}', 'iPhone', '', NULL)")
        conn.commit()
        conn.close()
        notifier.save_smtp_password("")
        notifier.save_prefs({"timezone": "UTC", "morningPlan": False, "eveningCheckIn": False, "playful": False})
        self.pushed = []
        p1 = mock.patch.object(notifier, "send_push", side_effect=lambda message, *a, **k: self.pushed.append(message) or [{"ok": True}])
        self.presence = Presence()
        self.presence.home = True  # Chill
        p2 = mock.patch.object(life_mode, "presence", self.presence)
        for p in (p1, p2):
            p.start()
            self.addCleanup(p.stop)
        put_items(
            {"id": "w", "title": "Send report", "lifeContext": "work", "remindAt": "2026-10-16T18:00", "dueDate": "2026-10-16"},
            {"id": "p", "title": "Call mum", "lifeContext": "personal", "remindAt": "2026-10-16T18:00", "dueDate": "2026-10-16"},
        )

    def test_work_reminder_waits_and_comes_back_in_work_mode(self):
        sent = notifier.run_once(datetime.datetime(2026, 10, 16, 18, 0, tzinfo=UTC))
        self.assertEqual(sent, ["remind:p:2026-10-16T18:00"])
        self.assertEqual([m["title"] for m in self.pushed], ["Call mum"])
        self.assertEqual([h["id"] for h in life_mode.held()], ["w"])
        # Not re-sent on the next pass, still in Chill.
        self.assertEqual(notifier.run_once(datetime.datetime(2026, 10, 16, 18, 1, tzinfo=UTC)), [])
        # Leave home: one push with what waited.
        self.presence.home = False
        sent = notifier.run_once(datetime.datetime(2026, 10, 16, 19, 0, tzinfo=UTC))
        self.assertEqual(len(sent), 1)
        self.assertEqual(self.pushed[-1]["title"], "1 work reminder from Chill")
        self.assertEqual(self.pushed[-1]["body"], "Send report")
        self.assertEqual(life_mode.held(), [])
        self.assertEqual(notifier.run_once(datetime.datetime(2026, 10, 16, 19, 1, tzinfo=UTC)), [])

    def test_work_mode_sends_everything(self):
        self.presence.home = False
        sent = notifier.run_once(datetime.datetime(2026, 10, 16, 18, 0, tzinfo=UTC))
        self.assertEqual(sorted(sent), ["remind:p:2026-10-16T18:00", "remind:w:2026-10-16T18:00"])

    def test_urgent_work_gets_through_when_allowed(self):
        put_items({"id": "u", "title": "Server down", "priority": "urgent", "remindAt": "2026-10-16T18:00"})
        notifier.run_once(datetime.datetime(2026, 10, 16, 18, 0, tzinfo=UTC))
        self.assertEqual(self.pushed, [])  # off by default
        put_items({"id": "u2", "title": "Server down", "priority": "urgent", "remindAt": "2026-10-16T18:05"})
        life_mode.update_settings({"urgentThrough": True})
        notifier.run_once(datetime.datetime(2026, 10, 16, 18, 5, tzinfo=UTC))
        self.assertEqual([m["title"] for m in self.pushed], ["Server down"])

    def test_finished_work_is_not_sent_later(self):
        notifier.run_once(datetime.datetime(2026, 10, 16, 18, 0, tzinfo=UTC))
        put_items({"id": "w", "title": "Send report", "status": "done", "remindAt": "2026-10-16T18:00"})
        self.presence.home = False
        self.pushed.clear()
        notifier.run_once(datetime.datetime(2026, 10, 16, 19, 0, tzinfo=UTC))
        self.assertEqual(self.pushed, [])
        self.assertEqual(life_mode.held(), [])

    def test_morning_plan_in_chill_lists_personal_only(self):
        notifier.save_prefs({"morningPlan": True, "morningTime": "08:00", "reminders": False, "playful": False})
        notifier.run_once(datetime.datetime(2026, 10, 16, 8, 0, tzinfo=UTC))
        self.assertEqual(self.pushed[0]["title"], "Today: 1 thing planned")
        self.assertEqual(self.pushed[0]["body"], "Call mum. 1 work task waits for Work mode.")


class ArrivalTests(unittest.TestCase):
    def setUp(self):
        reset_db()

    def test_back_after_a_while_is_an_arrival(self):
        w = life_mode.ArrivalWatch(away_minutes=15)
        self.assertFalse(w.update(True, True, 0))
        self.assertFalse(w.update(True, False, 100, last_seen=100))
        self.assertTrue(w.update(True, True, 100 + 20 * 60))
        self.assertFalse(w.update(True, True, 100 + 21 * 60))

    def test_a_short_trip_is_not(self):
        w = life_mode.ArrivalWatch(away_minutes=15)
        w.update(True, True, 0)
        w.update(True, False, 100, last_seen=100)
        self.assertFalse(w.update(True, True, 100 + 5 * 60))

    def test_arrival_welcomes_once_and_sets_chill(self):
        life_mode.update_settings({"mode": "work"})
        entry = life_mode.record_arrival(1000)
        self.assertEqual(life_mode.pending_welcome()["id"], entry["id"])
        life_mode.mark_welcomed(entry["id"])
        self.assertIsNone(life_mode.pending_welcome())

    def test_arrival_chill_with_auto_off(self):
        life_mode.update_settings({"auto": False, "mode": "work"})
        life_mode.record_arrival(1000)
        self.assertEqual(life_mode.get_settings()["mode"], "chill")


if __name__ == "__main__":
    unittest.main()
