import unittest
import datetime
from app.services.recurrence import calculate_next_occurrence

class TestSageBackend(unittest.TestCase):
    def test_recurrence_daily(self):
        base = datetime.datetime(2026, 9, 12, 10, 0, 0)
        next_date = calculate_next_occurrence("daily", base)
        self.assertEqual(next_date, datetime.datetime(2026, 9, 13, 10, 0, 0))

    def test_recurrence_weekdays(self):
        # Friday -> Monday
        base = datetime.datetime(2026, 9, 11, 10, 0, 0)
        next_date = calculate_next_occurrence("weekdays", base)
        self.assertEqual(next_date.weekday(), 0)
        self.assertEqual(next_date, datetime.datetime(2026, 9, 14, 10, 0, 0))

    def test_recurrence_weekly_specific(self):
        base = datetime.datetime(2026, 9, 12, 10, 0, 0)
        next_date = calculate_next_occurrence("weekly:mon,wed", base)
        self.assertIn(next_date.weekday(), [0, 2])
        self.assertEqual(next_date, datetime.datetime(2026, 9, 14, 10, 0, 0))

    def test_recurrence_monthly(self):
        base = datetime.datetime(2026, 9, 12, 10, 0, 0)
        next_date = calculate_next_occurrence("monthly:1", base)
        self.assertEqual(next_date.month, 10)
        self.assertEqual(next_date.day, 1)

    def test_recurrence_custom_days(self):
        base = datetime.datetime(2026, 9, 12, 10, 0, 0)
        next_date = calculate_next_occurrence("custom:14d", base)
        self.assertEqual(next_date, datetime.datetime(2026, 9, 26, 10, 0, 0))

    def test_ai_task_improvisation(self):
        import asyncio
        from app.services.ai_engine import improve_task_data, synthesize_domain_task

        # Test running domain output (zero generic robotic boilerplate)
        run_res = asyncio.run(improve_task_data("Go for a Run"))
        self.assertNotIn("efficiently with high quality", run_res["description"])
        self.assertNotIn("associated checklist items", run_res["description"])
        self.assertIn("Pacing", run_res["description"])
        self.assertIn("cadence", run_res["description"])
        self.assertGreaterEqual(len(run_res["subtasks"]), 3)
        self.assertEqual(run_res["category"], "Health")

        # Test finance domain output
        bill_res = synthesize_domain_task("pay electricity bill")
        self.assertEqual(bill_res["category"], "Finance")
        self.assertTrue("payment" in bill_res["description"].lower() or "receipt" in bill_res["description"].lower())
        self.assertGreaterEqual(len(bill_res["subtasks"]), 3)

if __name__ == "__main__":
    unittest.main()
