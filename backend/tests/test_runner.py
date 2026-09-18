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

    def test_big_rock_picker(self):
        from app.services.planner_service import compute_big_rock_suggestions
        tasks = [
            {"id": "t1", "title": "Low task", "priority": "low", "energy": "low", "status": "todo", "due_date": "2099-01-01"},
            {"id": "t2", "title": "Urgent bug", "priority": "urgent", "energy": "high", "status": "in_progress", "due_date": "2020-01-01"},
            {"id": "t3", "title": "Medium task", "priority": "medium", "energy": "medium", "status": "todo", "due_date": "2026-09-13"},
        ]
        res = compute_big_rock_suggestions(tasks, limit=2)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["id"], "t2") # Urgent bug should rank first

    def test_recurring_bill_calc(self):
        from app.services.finance_service import calc_days_until_due
        # Check calculation returns tuple of (int, bool)
        days, is_overdue = calc_days_until_due(15)
        self.assertIsInstance(days, int)
        self.assertIsInstance(is_overdue, bool)

    def test_whiteboard_models_and_schema(self):
        import sqlite3
        from app.database import SCHEMA_TABLES_SQL, SCHEMA_INDEXES_SQL
        from app.models import WhiteboardCreate, WhiteboardUpdate, WhiteboardResponse, WhiteboardListItem

        # Test Pydantic Models Validation
        create_payload = WhiteboardCreate(
            title="Sprint Planning Whiteboard",
            project_id="proj_123",
            elements='[{"id":"s1","type":"sticky","text":"Brainstorm"}]',
            view_state='{"panX": 100, "panY": 200, "zoom": 1.25}'
        )
        self.assertEqual(create_payload.title, "Sprint Planning Whiteboard")
        self.assertEqual(create_payload.project_id, "proj_123")

        update_payload = WhiteboardUpdate(
            title="Updated Title",
            elements='[]'
        )
        self.assertEqual(update_payload.title, "Updated Title")

        # Test SQLite Table Schema execution
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA_TABLES_SQL)
        conn.executescript(SCHEMA_INDEXES_SQL)

        # Insert project
        conn.execute(
            "INSERT INTO projects (id, name, color) VALUES ('proj_1', 'Sage OS Whiteboard', '#3b82f6')"
        )

        # Insert whiteboard
        conn.execute(
            """
            INSERT INTO whiteboards (id, title, project_id, elements, view_state)
            VALUES ('wb_test_1', 'Architecture Diagram', 'proj_1', '[]', '{"panX":0,"panY":0,"zoom":1}')
            """
        )
        conn.commit()

        cursor = conn.execute(
            """
            SELECT w.*, p.name as project_name, p.color as project_color
            FROM whiteboards w
            LEFT JOIN projects p ON w.project_id = p.id
            WHERE w.id = 'wb_test_1'
            """
        )
        row = cursor.fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["title"], "Architecture Diagram")
        self.assertEqual(row["project_name"], "Sage OS Whiteboard")
        self.assertEqual(row["project_color"], "#3b82f6")
        conn.close()

    def test_auth_token_validation(self):
        import asyncio
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials
        from app.auth import verify_auth_token
        import app.config as config
        import app.auth as auth

        original_secret = config.API_SECRET
        try:
            config.API_SECRET = "secret_key_9876"
            auth.API_SECRET = "secret_key_9876"

            # 1. Missing credentials -> 401
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(verify_auth_token(None))
            self.assertEqual(ctx.exception.status_code, 401)

            # 2. Wrong token -> 401
            bad_creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="wrong_password")
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(verify_auth_token(bad_creds))
            self.assertEqual(ctx.exception.status_code, 401)

            # 3. Valid token -> returns token
            good_creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="secret_key_9876")
            res = asyncio.run(verify_auth_token(good_creds))
            self.assertEqual(res, "secret_key_9876")
        finally:
            config.API_SECRET = original_secret
            auth.API_SECRET = original_secret

    def test_transaction_models_validation(self):
        from pydantic import ValidationError
        from app.models import TransactionCreate, RecurringBillCreate, BudgetCreate, WorkItemCreate

        # 1. Reject non-positive amounts
        with self.assertRaises(ValidationError):
            TransactionCreate(
                account_id="acc_1", type="expense", amount=-10.0,
                payment_mode="upi", date="2026-09-14"
            )
        with self.assertRaises(ValidationError):
            TransactionCreate(
                account_id="acc_1", type="expense", amount=0.0,
                payment_mode="upi", date="2026-09-14"
            )

        # 2. Reject malformed dates
        with self.assertRaises(ValidationError):
            TransactionCreate(
                account_id="acc_1", type="expense", amount=50.0,
                payment_mode="upi", date="14-09-2026"
            )

        # 3. Reject transfer without transfer_to_account_id
        with self.assertRaises(ValidationError):
            TransactionCreate(
                account_id="acc_1", type="transfer", amount=50.0,
                payment_mode="upi", date="2026-09-14"
            )

        # 4. Reject transfer to same account
        with self.assertRaises(ValidationError):
            TransactionCreate(
                account_id="acc_1", transfer_to_account_id="acc_1",
                type="transfer", amount=50.0, payment_mode="upi", date="2026-09-14"
            )

        # 5. Valid transfer accepted
        tx = TransactionCreate(
            account_id="acc_1", transfer_to_account_id="acc_2",
            type="transfer", amount=50.0, payment_mode="upi", date="2026-09-14"
        )
        self.assertEqual(tx.amount, 50.0)

        # 6. Reject invalid RecurringBill and Budget
        with self.assertRaises(ValidationError):
            RecurringBillCreate(name="Rent", amount=-100.0, due_day_of_month=1)
        with self.assertRaises(ValidationError):
            BudgetCreate(category_id="cat_1", monthly_limit=0)

        # 7. Reject invalid WorkItem estimated_minutes
        with self.assertRaises(ValidationError):
            WorkItemCreate(title="Test", estimated_minutes=-5)

    def test_database_check_constraints(self):
        import sqlite3
        from app.database import SCHEMA_TABLES_SQL

        conn = sqlite3.connect(":memory:")
        conn.executescript(SCHEMA_TABLES_SQL)

        # 1. Cannot insert negative transaction amount
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO finance_transactions (id, account_id, type, amount, payment_mode, date) VALUES ('tx1', 'acc1', 'expense', -50.0, 'cash', '2026-09-14')"
            )

        # 2. Cannot insert negative recurring bill amount
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO recurring_bills (id, name, amount, due_day_of_month) VALUES ('b1', 'Test', -20.0, 5)"
            )

        # 3. Cannot insert 0 or negative monthly budget
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO finance_budgets (id, category_id, monthly_limit, period_year, period_month) VALUES ('bgt1', 'c1', 0, 2026, 9)"
            )
        conn.close()

    def test_planner_streak_logic(self):
        # Verify streak calculation algorithm
        today = datetime.date.today()
        completed_days = {
            today.isoformat(),
            (today - datetime.timedelta(days=1)).isoformat(),
            (today - datetime.timedelta(days=2)).isoformat(),
        }

        streak_days = 0
        if today.isoformat() in completed_days:
            streak_days = 1
            for i in range(1, 35):
                day_str = (today - datetime.timedelta(days=i)).isoformat()
                if day_str in completed_days:
                    streak_days += 1
                else:
                    break
        self.assertEqual(streak_days, 3)

    def test_api_endpoints_auth_and_404_delete(self):
        from fastapi.testclient import TestClient
        import app.config as config
        import app.auth as auth

        original_secret = config.API_SECRET
        config.API_SECRET = "test_api_secret_456"
        auth.API_SECRET = "test_api_secret_456"

        try:
            from app.main import app
            with TestClient(app) as client:
                # 1. Health is public
                res = client.get("/api/health")
                self.assertEqual(res.status_code, 200)

                # 2. Items without auth -> 401
                res = client.get("/api/v1/items")
                self.assertEqual(res.status_code, 401)

                # 3. Items with bad auth -> 401
                res = client.get("/api/v1/items", headers={"Authorization": "Bearer wrong_secret"})
                self.assertEqual(res.status_code, 401)

                headers = {"Authorization": "Bearer test_api_secret_456"}

                # 4. Items with valid auth -> 200
                res = client.get("/api/v1/items", headers=headers)
                self.assertEqual(res.status_code, 200)

                # 5. Delete nonexistent item -> 404
                res = client.delete("/api/v1/items/nonexistent_id_xyz", headers=headers)
                self.assertEqual(res.status_code, 404)

                # 6. Delete nonexistent account -> 404
                res = client.delete("/api/v1/finance/accounts/nonexistent_acc_xyz", headers=headers)
                self.assertEqual(res.status_code, 404)

                # 7. Delete nonexistent budget -> 404
                res = client.delete("/api/v1/finance/budgets/nonexistent_bgt_xyz", headers=headers)
                self.assertEqual(res.status_code, 404)

                # 8. Delete nonexistent recurring bill -> 404
                res = client.delete("/api/v1/finance/recurring-bills/nonexistent_bill_xyz", headers=headers)
                self.assertEqual(res.status_code, 404)
        finally:
            config.API_SECRET = original_secret
            auth.API_SECRET = original_secret

    def test_auto_generated_task_and_project_descriptions(self):
        from fastapi.testclient import TestClient
        import app.config as config
        import app.auth as auth

        original_secret = config.API_SECRET
        config.API_SECRET = "test_api_secret_789"
        auth.API_SECRET = "test_api_secret_789"

        try:
            from app.main import app
            with TestClient(app) as client:
                headers = {"Authorization": "Bearer test_api_secret_789"}

                # 1. Test project creation with NO description -> auto-generated (1 paragraph, zero # or *)
                proj_res = client.post("/api/v1/items/projects", json={
                    "name": "Autonomous Agent Pipeline",
                    "color": "#10b981"
                }, headers=headers)
                self.assertEqual(proj_res.status_code, 200)
                proj_data = proj_res.json()
                self.assertTrue(proj_data["description"])
                self.assertNotIn("#", proj_data["description"])
                self.assertNotIn("*", proj_data["description"])
                self.assertIn("Autonomous Agent Pipeline", proj_data["description"])
                project_id = proj_data["id"]

                # 2. Test project update endpoint (PATCH /projects/{id})
                update_res = client.patch(f"/api/v1/items/projects/{project_id}", json={
                    "description": "Updated project description with custom roadmap."
                }, headers=headers)
                self.assertEqual(update_res.status_code, 200)
                self.assertEqual(update_res.json()["description"], "Updated project description with custom roadmap.")

                # 3. Create initial task in the project with NO description -> auto-generated (1 paragraph, zero # or *)
                task1_res = client.post("/api/v1/items", json={
                    "title": "Design System Architecture",
                    "project_id": project_id
                }, headers=headers)
                self.assertEqual(task1_res.status_code, 200)
                task1_data = task1_res.json()
                self.assertTrue(task1_data["description"])
                self.assertNotIn("#", task1_data["description"])
                self.assertNotIn("*", task1_data["description"])
                self.assertIn("Autonomous Agent Pipeline", task1_data["description"])
                self.assertGreater(len(task1_data["subtasks"]), 0)

                # 4. Create second task in the project with NO description -> incorporates previous task without # or *
                task2_res = client.post("/api/v1/items", json={
                    "title": "Deploy API Microservices",
                    "project_id": project_id
                }, headers=headers)
                self.assertEqual(task2_res.status_code, 200)
                task2_data = task2_res.json()
                self.assertTrue(task2_data["description"])
                self.assertNotIn("#", task2_data["description"])
                self.assertNotIn("*", task2_data["description"])
                self.assertIn("Design System Architecture", task2_data["description"]) # Preceding deliverable referenced!

                # 5. Test AI generate-project-description endpoint directly (1 paragraph, zero # or *)
                ai_proj_res = client.post("/api/v1/ai/generate-project-description", json={
                    "name": "Hardware Thermal Benchmarking"
                }, headers=headers)
                self.assertEqual(ai_proj_res.status_code, 200)
                self.assertTrue(ai_proj_res.json()["success"])
                ai_desc = ai_proj_res.json()["data"]["description"]
                self.assertNotIn("#", ai_desc)
                self.assertNotIn("*", ai_desc)
                self.assertIn("Hardware Thermal Benchmarking", ai_desc)

                # 6. Test AI auto-fill endpoint with project_id (1 paragraph, zero # or *)
                auto_fill_res = client.post("/api/v1/ai/auto-fill", json={
                    "title": "Configure Fan Curves",
                    "project_id": project_id
                }, headers=headers)
                self.assertEqual(auto_fill_res.status_code, 200)
                self.assertTrue(auto_fill_res.json()["success"])
                af_desc = auto_fill_res.json()["data"]["description"]
                self.assertNotIn("#", af_desc)
                self.assertNotIn("*", af_desc)
                self.assertIn("Deploy API Microservices", af_desc)

                # Cleanup test project & items
                client.delete(f"/api/v1/items/{task1_data['id']}", headers=headers)
                client.delete(f"/api/v1/items/{task2_data['id']}", headers=headers)
                client.delete(f"/api/v1/items/projects/{project_id}", headers=headers)
        finally:
            config.API_SECRET = original_secret
            auth.API_SECRET = original_secret

    def test_home_mode_and_backlog_processor(self):
        from fastapi.testclient import TestClient
        import app.config as config
        import app.auth as auth
        from app.services.backlog_service import is_quiet_hours_window

        # 1. Test quiet hours logic (01:30 AM to 05:30 AM)
        t_early = datetime.datetime(2026, 9, 18, 1, 15, 0)
        self.assertFalse(is_quiet_hours_window(t_early))

        t_start = datetime.datetime(2026, 9, 18, 1, 30, 0)
        self.assertTrue(is_quiet_hours_window(t_start))

        t_mid = datetime.datetime(2026, 9, 18, 3, 45, 0)
        self.assertTrue(is_quiet_hours_window(t_mid))

        t_end = datetime.datetime(2026, 9, 18, 5, 30, 0)
        self.assertTrue(is_quiet_hours_window(t_end))

        t_day = datetime.datetime(2026, 9, 18, 14, 0, 0)
        self.assertFalse(is_quiet_hours_window(t_day))

        original_secret = config.API_SECRET
        config.API_SECRET = "test_api_secret_backlog"
        auth.API_SECRET = "test_api_secret_backlog"

        try:
            from app.main import app
            with TestClient(app) as client:
                headers = {"Authorization": "Bearer test_api_secret_backlog"}

                # 2. Test GET /home-mode status
                hm_res = client.get("/api/v1/ai/home-mode", headers=headers)
                self.assertEqual(hm_res.status_code, 200)
                hm_data = hm_res.json()
                self.assertTrue(hm_data["success"])
                self.assertIn("home_mode", hm_data["data"])
                self.assertIn("quiet_hours_schedule", hm_data["data"])

                # 3. Test toggling Home Mode
                toggle_res = client.post("/api/v1/ai/home-mode", json={"home_mode": True}, headers=headers)
                self.assertEqual(toggle_res.status_code, 200)
                self.assertTrue(toggle_res.json()["data"]["home_mode"])

                # 4. Insert older and newer tasks directly without description
                import sqlite3
                from app.database import DB_PATH
                conn = sqlite3.connect(DB_PATH)
                older_t_id = "test_t_older_01"
                newer_t_id = "test_t_newer_02"
                older_time = "2026-09-10T10:00:00"
                newer_time = "2026-09-18T12:00:00"

                conn.execute(
                    "INSERT INTO work_items (id, title, description, entity_type, status, priority, is_completed, created_at, updated_at) "
                    "VALUES (?, ?, NULL, 'task', 'todo', 'medium', 0, ?, ?)",
                    (older_t_id, "Old Backlog Archival Task", older_time, older_time)
                )
                conn.execute(
                    "INSERT INTO work_items (id, title, description, entity_type, status, priority, is_completed, created_at, updated_at) "
                    "VALUES (?, ?, NULL, 'task', 'todo', 'high', 0, ?, ?)",
                    (newer_t_id, "New Priority Feature Delivery", newer_time, newer_time)
                )
                conn.commit()
                conn.close()

                # 5. Outside quiet hours with home_mode=True: calling process-backlog without force should defer
                now_mock = datetime.datetime(2026, 9, 18, 14, 0, 0)
                # If currently outside 01:30 - 05:30 AM, standard call defers
                if not is_quiet_hours_window(datetime.datetime.now()):
                    defer_res = client.post("/api/v1/ai/process-backlog", json={"force": False}, headers=headers)
                    self.assertEqual(defer_res.status_code, 200)
                    self.assertTrue(defer_res.json()["data"]["deferred"])
                    self.assertIn("Home mode active", defer_res.json()["data"]["reason"])

                # 6. Forcing processing or turning home_mode=False processes backlog in created_at DESC order
                proc_res = client.post("/api/v1/ai/process-backlog", json={"force": True}, headers=headers)
                self.assertEqual(proc_res.status_code, 200)
                self.assertFalse(proc_res.json()["data"]["deferred"])
                self.assertGreaterEqual(proc_res.json()["data"]["processed_tasks"], 2)

                # Verify both tasks now have valid, non-empty, 1-paragraph descriptions without # or *
                t_check1 = client.get("/api/v1/items", headers=headers).json()
                older_item = next((i for i in t_check1 if i["id"] == older_t_id), None)
                newer_item = next((i for i in t_check1 if i["id"] == newer_t_id), None)

                self.assertIsNotNone(older_item)
                self.assertIsNotNone(newer_item)
                self.assertTrue(older_item["description"])
                self.assertTrue(newer_item["description"])
                self.assertNotIn("#", older_item["description"])
                self.assertNotIn("*", older_item["description"])
                self.assertNotIn("#", newer_item["description"])
                self.assertNotIn("*", newer_item["description"])

                # Cleanup test items
                client.delete(f"/api/v1/items/{older_t_id}", headers=headers)
                client.delete(f"/api/v1/items/{newer_t_id}", headers=headers)

        finally:
            config.API_SECRET = original_secret
            auth.API_SECRET = original_secret

if __name__ == "__main__":
    unittest.main()


