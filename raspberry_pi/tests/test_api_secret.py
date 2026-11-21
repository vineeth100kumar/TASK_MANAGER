"""Tests for /api/settings/api-secret: a new device can fetch the server key
without a terminal on the Pi, but only with the key, the login, or on the Pi itself.

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

SECRET = "s" * 40
PATH = "/api/settings/api-secret"
client = db_server = None


class ApiSecretTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global client, db_server
        if "db_server" not in sys.modules:
            os.environ["SAGE_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "secret.db")
            os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
        import db_server as _db_server
        db_server = _db_server
        client = TestClient(db_server.app)

    def setUp(self):
        p = mock.patch.object(db_server, "API_SECRET", SECRET)
        p.start()
        self.addCleanup(p.stop)

    def test_needs_the_key_or_the_pi_itself(self):
        self.assertEqual(client.get(PATH).status_code, 401)
        self.assertEqual(client.get(PATH, headers={"Authorization": "Bearer wrong"}).status_code, 401)
        res = client.get(PATH, headers={"Authorization": f"Bearer {SECRET}"})
        self.assertEqual((res.status_code, res.json()["secret"]), (200, SECRET))

    def test_key_without_the_word_bearer_is_accepted(self):
        # A Siri shortcut with the bare key in the Authorization field.
        res = client.get(PATH, headers={"Authorization": SECRET})
        self.assertEqual((res.status_code, res.json()["secret"]), (200, SECRET))
        self.assertEqual(client.get(PATH, headers={"Authorization": "nope"}).status_code, 401)

    def test_the_pis_own_screen_may_read_it(self):
        with mock.patch.object(db_server, "is_pi_itself", return_value=True):
            res = client.get(PATH)
        self.assertEqual((res.status_code, res.json()["secret"]), (200, SECRET))

    def test_is_pi_itself_ignores_the_tunnel_and_other_devices(self):
        def req(host, **headers):
            return mock.Mock(client=mock.Mock(host=host), headers=headers)
        self.assertTrue(db_server.is_pi_itself(req("127.0.0.1")))
        self.assertTrue(db_server.is_pi_itself(req("::1")))
        self.assertFalse(db_server.is_pi_itself(req("192.168.1.20")))
        # Through the tunnel the request arrives from 127.0.0.1 with a forwarding header.
        self.assertFalse(db_server.is_pi_itself(req("127.0.0.1", **{"cf-connecting-ip": "8.8.8.8"})))
        self.assertFalse(db_server.is_pi_itself(req("127.0.0.1", **{"x-forwarded-for": "8.8.8.8"})))

    def test_reports_when_no_key_is_set(self):
        with mock.patch.object(db_server, "API_SECRET", ""):
            res = client.get(PATH)
        self.assertEqual(res.json(), {"success": True, "set": False, "secret": ""})


if __name__ == "__main__":
    unittest.main()
