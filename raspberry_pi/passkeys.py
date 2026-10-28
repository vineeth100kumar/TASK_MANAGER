"""
Trusted devices for Sage: unlock with the device's own screen lock (Face ID,
Touch ID, Windows Hello, a device PIN) instead of typing the password.

This is WebAuthn. After a normal password login a device can be "trusted":
the browser makes a passkey with its platform authenticator, and from then on
that device can log in with a fingerprint or face instead of the password. The
password stays as the fallback and the recovery path, so a trusted device is a
convenience on top of the gate, never a replacement for it.

What the Pi keeps, and where:

  * Only the credential's *public* key, its id and a signature counter, in a
    `passkeys` table in the same SQLite file. The table is NOT in
    db_server.SYNC_TABLES, so it never leaves the Pi and never reaches LUMO or
    another device. The private key never leaves the authenticator.
  * A short-lived challenge per login attempt, in memory only (see
    `_Challenges`), single-use, so a captured assertion can't be replayed.

The signing material for sessions still comes from the password hash
(access_gate.py), so changing the password logs trusted devices out too. All
the real crypto is done by the `webauthn` library, not hand-rolled here.

WebAuthn needs a secure context: HTTPS (the public tunnel link) or localhost
(the Pi's own screen). On a plain-http LAN address the browser won't offer it,
so the app explains that and keeps the password working. See `status()`.
"""
from __future__ import annotations

import os
import sqlite3
import time
import secrets
from typing import Dict, List, Optional, Tuple

try:
    from webauthn import (
        generate_registration_options,
        generate_authentication_options,
        verify_registration_response,
        verify_authentication_response,
        options_to_json,
    )
    from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        AuthenticatorAttachment,
        ResidentKeyRequirement,
        UserVerificationRequirement,
        AttestationConveyancePreference,
        PublicKeyCredentialDescriptor,
    )
    AVAILABLE = True
    IMPORT_ERROR = ""
except Exception as exc:  # pragma: no cover - only when the library is missing
    AVAILABLE = False
    IMPORT_ERROR = str(exc)


RP_NAME = "Sage"
# One user, so one stable handle. It is not a secret; it only ties the stored
# passkeys to "this Sage". Kept in the db so it survives restarts.
_USER_NAME = "sage"
_USER_DISPLAY = "Sage"

# A login attempt has to finish quickly; the challenge dies with it.
CHALLENGE_TTL = 300
# Don't hoard more than a sane number of unfinished attempts in memory.
MAX_PENDING = 64

DB_PATH = "sage_sync.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def connect(db_path: str) -> None:
    global DB_PATH
    DB_PATH = db_path
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS passkeys (
            credential_id TEXT PRIMARY KEY,
            public_key BLOB NOT NULL,
            sign_count INTEGER NOT NULL DEFAULT 0,
            rp_id TEXT,
            name TEXT,
            created_at REAL,
            last_used_at REAL,
            transports TEXT,
            backed_up INTEGER DEFAULT 0
        );
        """
    )
    conn.commit()
    conn.close()


# --- The one user handle ---
def _user_handle() -> bytes:
    """A stable per-install id for the single Sage user. Stored once so every
    passkey is made for the same user and discoverable logins resolve to it."""
    conn = _db()
    try:
        row = conn.execute(
            "SELECT value FROM metadata WHERE key = 'passkeyUserHandle'"
        ).fetchone()
        if row and row["value"]:
            return base64url_to_bytes(row["value"])
        handle = secrets.token_bytes(16)
        conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('passkeyUserHandle', ?)",
            (bytes_to_base64url(handle),),
        )
        conn.commit()
        return handle
    finally:
        conn.close()


# --- Challenge store (in memory, single-use) ---
class _Challenges:
    def __init__(self) -> None:
        self._items: Dict[str, Tuple[bytes, str, float]] = {}

    def _sweep(self, now: float) -> None:
        dead = [cid for cid, (_, _, exp) in self._items.items() if exp <= now]
        for cid in dead:
            self._items.pop(cid, None)

    def issue(self, challenge: bytes, kind: str) -> str:
        now = time.time()
        self._sweep(now)
        # If someone is spamming begins, drop the oldest so memory stays bounded.
        while len(self._items) >= MAX_PENDING:
            oldest = min(self._items, key=lambda k: self._items[k][2])
            self._items.pop(oldest, None)
        token = secrets.token_urlsafe(18)
        self._items[token] = (challenge, kind, now + CHALLENGE_TTL)
        return token

    def take(self, token: Optional[str], kind: str) -> Optional[bytes]:
        """Return the challenge for this token once, then forget it."""
        if not token:
            return None
        self._sweep(time.time())
        entry = self._items.pop(token, None)
        if not entry:
            return None
        challenge, want, exp = entry
        if want != kind or exp <= time.time():
            return None
        return challenge


_challenges = _Challenges()


# --- Origin / RP id from the request ---
def _host(request) -> str:
    # The browser (and the tunnel) tell us the host it thinks it reached; that
    # is what the passkey is bound to. Fall back to the URL for odd clients.
    return (request.headers.get("host") or request.url.netloc or "").strip().lower()


def rp_id_for(request) -> str:
    """The domain a passkey is scoped to: the host without its port."""
    return _host(request).split(":")[0]


def origin_for(request) -> str:
    from access_gate import is_https
    scheme = "https" if is_https(request) else request.url.scheme or "http"
    return f"{scheme}://{_host(request)}"


# --- Stored credentials ---
def list_devices() -> List[dict]:
    conn = _db()
    try:
        rows = conn.execute(
            "SELECT credential_id, name, created_at, last_used_at, backed_up "
            "FROM passkeys ORDER BY COALESCE(last_used_at, created_at) DESC"
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "id": r["credential_id"],
            "name": r["name"] or "Trusted device",
            "createdAt": r["created_at"],
            "lastUsedAt": r["last_used_at"],
            "synced": bool(r["backed_up"]),
        }
        for r in rows
    ]


def count() -> int:
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM passkeys").fetchone()[0]
    finally:
        conn.close()


def _existing_descriptors() -> List["PublicKeyCredentialDescriptor"]:
    conn = _db()
    try:
        rows = conn.execute("SELECT credential_id FROM passkeys").fetchall()
    finally:
        conn.close()
    return [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["credential_id"]))
        for r in rows
    ]


def rename(credential_id: str, name: str) -> bool:
    name = (name or "").strip()[:60] or "Trusted device"
    conn = _db()
    try:
        cur = conn.execute(
            "UPDATE passkeys SET name = ? WHERE credential_id = ?", (name, credential_id)
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def revoke(credential_id: str) -> bool:
    conn = _db()
    try:
        cur = conn.execute(
            "DELETE FROM passkeys WHERE credential_id = ?", (credential_id,)
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def revoke_all() -> int:
    conn = _db()
    try:
        cur = conn.execute("DELETE FROM passkeys")
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


# --- Registration (make a passkey on an already-logged-in device) ---
def registration_options(request) -> str:
    """Options JSON for navigator.credentials.create(). The caller must already
    be logged in with the password."""
    options = generate_registration_options(
        rp_id=rp_id_for(request),
        rp_name=RP_NAME,
        user_id=_user_handle(),
        user_name=_USER_NAME,
        user_display_name=_USER_DISPLAY,
        # Only the device's own built-in authenticator, and it must check the
        # person (face, fingerprint or PIN), never just presence.
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        attestation=AttestationConveyancePreference.NONE,
        exclude_credentials=_existing_descriptors(),
    )
    token = _challenges.issue(options.challenge, "register")
    return _with_session(options_to_json(options), token)


def verify_registration(request, credential_json: str, session_token: str, name: str) -> dict:
    """Check the authenticator's answer and store the new passkey. Raises
    ValueError on anything that doesn't verify."""
    challenge = _challenges.take(session_token, "register")
    if challenge is None:
        raise ValueError("This request expired. Try trusting the device again.")
    verification = verify_registration_response(
        credential=credential_json,
        expected_challenge=challenge,
        expected_rp_id=rp_id_for(request),
        expected_origin=origin_for(request),
        require_user_verification=True,
    )
    credential_id = bytes_to_base64url(verification.credential_id)
    now = time.time()
    label = (name or "").strip()[:60] or _default_name(request)
    conn = _db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO passkeys "
            "(credential_id, public_key, sign_count, rp_id, name, created_at, last_used_at, backed_up) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                credential_id,
                verification.credential_public_key,
                verification.sign_count,
                rp_id_for(request),
                label,
                now,
                now,
                1 if getattr(verification, "credential_backed_up", False) else 0,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": credential_id, "name": label}


def _default_name(request) -> str:
    ua = (request.headers.get("user-agent") or "").lower()
    for needle, label in (
        ("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android phone"),
        ("mac", "Mac"), ("windows", "Windows PC"), ("linux", "Linux"), ("cros", "Chromebook"),
    ):
        if needle in ua:
            return label
    return "Trusted device"


# --- Authentication (log in with the passkey instead of the password) ---
def authentication_options(request) -> Optional[str]:
    """Options JSON for navigator.credentials.get(), or None when no device is
    trusted yet. Discoverable, so the browser offers its own passkey; we don't
    hand an unauthenticated caller the list of credential ids."""
    if count() == 0:
        return None
    options = generate_authentication_options(
        rp_id=rp_id_for(request),
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    token = _challenges.issue(options.challenge, "auth")
    return _with_session(options_to_json(options), token)


def verify_authentication(request, credential_json: str, session_token: str) -> bool:
    """True when the assertion checks out against a stored passkey. Bumps the
    signature counter so a cloned authenticator is caught. Raises ValueError on
    a bad or expired request."""
    challenge = _challenges.take(session_token, "auth")
    if challenge is None:
        raise ValueError("This request expired. Try again.")
    import json as _json
    try:
        raw_id = _json.loads(credential_json).get("rawId") or _json.loads(credential_json).get("id")
    except Exception:
        raise ValueError("Malformed passkey response.")
    conn = _db()
    try:
        row = conn.execute(
            "SELECT public_key, sign_count FROM passkeys WHERE credential_id = ?", (raw_id,)
        ).fetchone()
        if not row:
            raise ValueError("This device is not trusted.")
        verification = verify_authentication_response(
            credential=credential_json,
            expected_challenge=challenge,
            expected_rp_id=rp_id_for(request),
            expected_origin=origin_for(request),
            credential_public_key=row["public_key"],
            credential_current_sign_count=row["sign_count"],
            require_user_verification=True,
        )
        conn.execute(
            "UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?",
            (verification.new_sign_count, time.time(), raw_id),
        )
        conn.commit()
        return True
    finally:
        conn.close()


# --- What the UI needs to know before it offers any of this ---
def status(request, password_gate_on: bool) -> dict:
    return {
        "available": AVAILABLE,
        "gate": password_gate_on,
        # WebAuthn only works in a secure context; the browser decides, but we
        # can tell the obvious plain-http-LAN case so the UI can explain it.
        "secure": _looks_secure(request),
        "hasDevices": AVAILABLE and count() > 0,
        "rpId": rp_id_for(request) if AVAILABLE else "",
    }


def _looks_secure(request) -> bool:
    from access_gate import is_https
    host = rp_id_for(request)
    return is_https(request) or host in ("localhost", "127.0.0.1", "::1")


def _with_session(options_json: str, token: str) -> str:
    """Tuck the one-time challenge token into the options we send the browser so
    it comes back with the finishing call. It is not a secret; the challenge it
    points at is single-use and server-side."""
    import json as _json
    data = _json.loads(options_json)
    data["sageSession"] = token
    return _json.dumps(data)
