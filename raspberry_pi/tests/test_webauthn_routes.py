"""Tests for the trusted-device routes in db_server: which ones an unlogged-in
browser may reach (status and the login flow) and which need a password session
(making and managing passkeys). The WebAuthn crypto is passkeys.py's job and is
tested there; here we check the wiring and the gate.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

client = db_server = access_gate = passkeys = None
PASSWORD = "1234"


class WebauthnRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global client, db_server, access_gate, passkeys
        if "db_server" not in sys.modules:
            os.environ["SAGE_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "webauthn.db")
            os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
        import access_gate as _ag
        import passkeys as _pk
        import db_server as _db
        access_gate, passkeys, db_server = _ag, _pk, _db
        client = TestClient(db_server.app)

    def setUp(self):
        # Turn the password gate on with a known password, and no API key, so we
        # exercise the browser path exactly.
        self._hash = access_gate.hash_password(PASSWORD)
        for target, attr, value in (
            (access_gate, "PASSWORD_HASH", self._hash),
            (access_gate, "enabled", True),
            (db_server, "API_SECRET", ""),
        ):
            p = mock.patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)
        passkeys.revoke_all()

    def _login(self):
        c = TestClient(db_server.app)
        r = c.post("/login", data={"password": PASSWORD, "next": "/"}, follow_redirects=False)
        self.assertIn(r.status_code, (302, 303))
        return c

    # --- Open to anyone (the login flow must work before there is a session) ---
    def test_status_is_open(self):
        r = client.get("/api/webauthn/status")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["available"])
        self.assertTrue(body["gate"])
        self.assertFalse(body["hasDevices"])

    def test_auth_begin_without_devices(self):
        r = client.post("/api/webauthn/auth/begin")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(r.json()["success"])

    def test_auth_begin_offers_options_when_a_device_exists(self):
        self._store_fake_device()
        r = client.post("/api/webauthn/auth/begin")
        self.assertEqual(r.status_code, 200)
        opts = r.json()
        self.assertIn("challenge", opts)
        self.assertIn("sageSession", opts)

    # --- Behind the password gate (must be logged in) ---
    def test_register_begin_needs_login(self):
        r = client.post("/api/webauthn/register/begin", follow_redirects=False)
        # The gate turns an unlogged-in /api call away.
        self.assertIn(r.status_code, (401, 303))

    def test_register_begin_when_logged_in(self):
        c = self._login()
        r = c.post("/api/webauthn/register/begin")
        self.assertEqual(r.status_code, 200)
        opts = r.json()
        self.assertEqual(opts["rp"]["id"], "testserver")
        self.assertIn("challenge", opts)
        self.assertIn("sageSession", opts)
        self.assertEqual(opts["authenticatorSelection"]["userVerification"], "required")

    def test_devices_list_needs_login(self):
        r = client.get("/api/webauthn/devices", follow_redirects=False)
        self.assertIn(r.status_code, (401, 303))

    def test_devices_list_and_revoke_when_logged_in(self):
        self._store_fake_device(name="iPhone")
        c = self._login()
        r = c.get("/api/webauthn/devices")
        self.assertEqual(r.status_code, 200)
        devices = r.json()["devices"]
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]["name"], "iPhone")

        r2 = c.post("/api/webauthn/devices/revoke", json={"id": devices[0]["id"]})
        self.assertTrue(r2.json()["success"])
        self.assertEqual(passkeys.count(), 0)

    def _store_fake_device(self, name="Trusted device"):
        import time
        conn = passkeys._db()
        conn.execute(
            "INSERT INTO passkeys (credential_id, public_key, sign_count, name, created_at) VALUES (?,?,?,?,?)",
            (f"cred-{name}", b"PUBKEY", 0, name, time.time()),
        )
        conn.commit()
        conn.close()


if __name__ == "__main__":
    unittest.main()
