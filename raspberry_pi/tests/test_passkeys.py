"""Tests for passkeys.py: the Pi-only store of trusted-device credentials, the
single-use login challenges, and how the request's host becomes the passkey's
scope. The WebAuthn crypto itself is the `webauthn` library's job; here we
check our storage, our replay protection and our wiring into it.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import json
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import passkeys  # noqa: E402


class FakeURL:
    def __init__(self, netloc="sage.example.ts.net", scheme="https"):
        self.netloc = netloc
        self.scheme = scheme


class FakeRequest:
    def __init__(self, host="sage.example.ts.net", https=True, ua="Mozilla/5.0 (iPhone)"):
        self.headers = {"host": host, "user-agent": ua}
        if https:
            self.headers["x-forwarded-proto"] = "https"
        self.url = FakeURL(netloc=host, scheme="https" if https else "http")


def fresh_db():
    path = Path(tempfile.mkdtemp()) / "sage_test.db"
    conn = sqlite3.connect(path)
    # passkeys leans on db_server's metadata table for the user handle.
    conn.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
    conn.commit()
    conn.close()
    passkeys.connect(str(path))
    return str(path)


class ChallengeStoreTest(unittest.TestCase):
    def test_single_use(self):
        store = passkeys._Challenges()
        token = store.issue(b"abc", "auth")
        self.assertEqual(store.take(token, "auth"), b"abc")
        # Spent: a replay with the same token gets nothing.
        self.assertIsNone(store.take(token, "auth"))

    def test_kind_must_match(self):
        store = passkeys._Challenges()
        token = store.issue(b"abc", "register")
        self.assertIsNone(store.take(token, "auth"))

    def test_expiry(self):
        store = passkeys._Challenges()
        token = store.issue(b"abc", "auth")
        store._items[token] = (b"abc", "auth", time.time() - 1)
        self.assertIsNone(store.take(token, "auth"))

    def test_unknown_token(self):
        store = passkeys._Challenges()
        self.assertIsNone(store.take("nope", "auth"))
        self.assertIsNone(store.take(None, "auth"))

    def test_bounded(self):
        store = passkeys._Challenges()
        for _ in range(passkeys.MAX_PENDING + 20):
            store.issue(b"x", "auth")
        self.assertLessEqual(len(store._items), passkeys.MAX_PENDING)


class ScopeTest(unittest.TestCase):
    def test_rp_id_strips_port(self):
        self.assertEqual(passkeys.rp_id_for(FakeRequest(host="192.168.1.9:8000")), "192.168.1.9")
        self.assertEqual(passkeys.rp_id_for(FakeRequest(host="sage.example.ts.net")), "sage.example.ts.net")

    def test_origin(self):
        self.assertEqual(passkeys.origin_for(FakeRequest(host="sage.example.ts.net")), "https://sage.example.ts.net")
        self.assertEqual(passkeys.origin_for(FakeRequest(host="localhost:8000", https=False)), "http://localhost:8000")

    def test_secure_context(self):
        self.assertTrue(passkeys._looks_secure(FakeRequest(host="sage.example.ts.net", https=True)))
        self.assertTrue(passkeys._looks_secure(FakeRequest(host="localhost:8000", https=False)))
        # Plain http on the LAN is not a secure context, so no passkeys there.
        self.assertFalse(passkeys._looks_secure(FakeRequest(host="192.168.1.9:8000", https=False)))

    def test_default_name_from_ua(self):
        self.assertEqual(passkeys._default_name(FakeRequest(ua="... iPhone ...")), "iPhone")
        self.assertEqual(passkeys._default_name(FakeRequest(ua="Windows NT 10")), "Windows PC")
        self.assertEqual(passkeys._default_name(FakeRequest(ua="something else")), "Trusted device")


class StorageTest(unittest.TestCase):
    def setUp(self):
        fresh_db()

    def _add(self, cid, name, public=b"pk", count=0):
        conn = passkeys._db()
        now = time.time()
        conn.execute(
            "INSERT INTO passkeys (credential_id, public_key, sign_count, name, created_at, last_used_at) "
            "VALUES (?,?,?,?,?,?)",
            (cid, public, count, name, now, now),
        )
        conn.commit()
        conn.close()

    def test_count_list_rename_revoke(self):
        self.assertEqual(passkeys.count(), 0)
        self._add("cred-a", "iPhone")
        self._add("cred-b", "Mac")
        self.assertEqual(passkeys.count(), 2)
        names = {d["name"] for d in passkeys.list_devices()}
        self.assertEqual(names, {"iPhone", "Mac"})

        self.assertTrue(passkeys.rename("cred-a", "My phone"))
        self.assertIn("My phone", {d["name"] for d in passkeys.list_devices()})
        self.assertFalse(passkeys.rename("missing", "x"))

        self.assertTrue(passkeys.revoke("cred-a"))
        self.assertFalse(passkeys.revoke("cred-a"))
        self.assertEqual(passkeys.count(), 1)

        self.assertEqual(passkeys.revoke_all(), 1)
        self.assertEqual(passkeys.count(), 0)

    def test_user_handle_is_stable(self):
        first = passkeys._user_handle()
        again = passkeys._user_handle()
        self.assertEqual(first, again)
        self.assertEqual(len(first), 16)

    def test_status_reports_devices(self):
        s = passkeys.status(FakeRequest(), password_gate_on=True)
        self.assertTrue(s["available"])
        self.assertTrue(s["gate"])
        self.assertTrue(s["secure"])
        self.assertFalse(s["hasDevices"])
        self._add("cred-a", "iPhone")
        self.assertTrue(passkeys.status(FakeRequest(), True)["hasDevices"])


class VerifyWiringTest(unittest.TestCase):
    """verify_* should pull the right challenge, call the library with the
    request's scope, and write what the library returns — checked with the
    library's verify functions stubbed, so no real authenticator is needed."""

    def setUp(self):
        fresh_db()

    def test_registration_stores_credential(self):
        from webauthn.helpers import bytes_to_base64url

        class FakeReg:
            credential_id = b"\x01\x02\x03"
            credential_public_key = b"PUBKEY"
            sign_count = 7
            credential_backed_up = True

        captured = {}

        def fake_verify(**kw):
            captured.update(kw)
            return FakeReg()

        orig = passkeys.verify_registration_response
        passkeys.verify_registration_response = fake_verify
        try:
            token = passkeys._challenges.issue(b"the-challenge", "register")
            result = passkeys.verify_registration(
                FakeRequest(host="sage.example.ts.net"),
                json.dumps({"id": "x"}),
                token,
                "My iPhone",
            )
        finally:
            passkeys.verify_registration_response = orig

        self.assertEqual(captured["expected_rp_id"], "sage.example.ts.net")
        self.assertEqual(captured["expected_origin"], "https://sage.example.ts.net")
        self.assertEqual(captured["expected_challenge"], b"the-challenge")
        self.assertTrue(captured["require_user_verification"])
        self.assertEqual(result["name"], "My iPhone")
        self.assertEqual(result["id"], bytes_to_base64url(b"\x01\x02\x03"))
        self.assertEqual(passkeys.count(), 1)
        self.assertTrue(passkeys.list_devices()[0]["synced"])

    def test_registration_rejects_spent_challenge(self):
        with self.assertRaises(ValueError):
            passkeys.verify_registration(FakeRequest(), json.dumps({"id": "x"}), "bad-token", "n")

    def test_authentication_bumps_sign_count(self):
        from webauthn.helpers import bytes_to_base64url

        raw = b"\x09\x08\x07"
        cid = bytes_to_base64url(raw)
        conn = passkeys._db()
        conn.execute(
            "INSERT INTO passkeys (credential_id, public_key, sign_count, name, created_at) VALUES (?,?,?,?,?)",
            (cid, b"PUBKEY", 3, "iPhone", time.time()),
        )
        conn.commit()
        conn.close()

        class FakeAuth:
            new_sign_count = 4

        def fake_verify(**kw):
            self.assertEqual(kw["credential_public_key"], b"PUBKEY")
            self.assertEqual(kw["credential_current_sign_count"], 3)
            self.assertEqual(kw["expected_rp_id"], "sage.example.ts.net")
            return FakeAuth()

        orig = passkeys.verify_authentication_response
        passkeys.verify_authentication_response = fake_verify
        try:
            token = passkeys._challenges.issue(b"chal", "auth")
            ok = passkeys.verify_authentication(
                FakeRequest(), json.dumps({"rawId": cid, "id": cid}), token
            )
        finally:
            passkeys.verify_authentication_response = orig

        self.assertTrue(ok)
        conn = passkeys._db()
        row = conn.execute("SELECT sign_count, last_used_at FROM passkeys WHERE credential_id = ?", (cid,)).fetchone()
        conn.close()
        self.assertEqual(row[0], 4)
        self.assertIsNotNone(row[1])

    def test_authentication_unknown_device(self):
        token = passkeys._challenges.issue(b"chal", "auth")
        with self.assertRaises(ValueError):
            passkeys.verify_authentication(FakeRequest(), json.dumps({"rawId": "unknown", "id": "unknown"}), token)

    def test_authentication_rejects_spent_challenge(self):
        with self.assertRaises(ValueError):
            passkeys.verify_authentication(FakeRequest(), json.dumps({"rawId": "x", "id": "x"}), "bad")


if __name__ == "__main__":
    unittest.main()
