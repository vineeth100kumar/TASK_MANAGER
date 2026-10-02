"""
Password gate for reaching Sage from outside the house.

When SAGE_ACCESS_PASSWORD_HASH is set, every page and API call needs either a
login cookie (from typing the password at /login) or the API key. Only the
PBKDF2 hash of the password is stored, in /etc/sage/sage.env, never the
password itself and never anything in the web app's bundle.

Create the hash on the Pi with deploy/set_access_password.sh, or print one:

    python3 raspberry_pi/access_gate.py
"""
import base64
import getpass
import hashlib
import hmac
import html
import os
import secrets
import sys
import time
from collections import deque
from typing import Deque, Dict, Optional

PASSWORD_HASH = os.getenv("SAGE_ACCESS_PASSWORD_HASH", "").strip()
COOKIE_NAME = "sage_session"
SESSION_DAYS = int(os.getenv("SAGE_SESSION_DAYS", "30"))

ITERATIONS = 300_000
# A short PIN is guessable, so wrong guesses are rationed: each device (and
# each address) gets PER_IP_LIMIT tries per WINDOW, and all together get
# GLOBAL_LIMIT, which makes trying all 10,000 four-digit PINs take about two
# weeks. The global cap is high enough that a few typos elsewhere don't lock
# out you, on a device that hasn't been guessing.
WINDOW = 60 * 60
PER_IP_LIMIT = 5
GLOBAL_LIMIT = 30
DEVICE_COOKIE = "sage_device"

enabled = bool(PASSWORD_HASH)


def hash_password(password: str, iterations: int = ITERATIONS) -> str:
    # ':' separators, not '$', so the value survives shells and systemd's
    # EnvironmentFile unquoted.
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "pbkdf2_sha256:{}:{}:{}".format(
        iterations, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


def verify_password(password: str, stored: str = "") -> bool:
    try:
        scheme, iterations, salt, digest = (stored or PASSWORD_HASH).split(":")
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(iterations))
        return hmac.compare_digest(candidate, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


# --- Login cookie ---
# "<expiry>.<signature>". The signing key comes from the password hash, so
# changing the password logs every device out.
def _session_key() -> bytes:
    return hashlib.sha256(("sage-session:" + PASSWORD_HASH).encode()).digest()


def new_session() -> str:
    expiry = str(int(time.time()) + SESSION_DAYS * 86400)
    signature = hmac.new(_session_key(), expiry.encode(), hashlib.sha256).hexdigest()
    return f"{expiry}.{signature}"


def session_valid(token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    expiry, signature = token.split(".", 1)
    expected = hmac.new(_session_key(), expiry.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected) and expiry.isdigit() and int(expiry) > time.time()


# --- Guess limits ---
_failures: Dict[str, Deque[float]] = {}
_all_failures: Deque[float] = deque()


def _trim(times: Deque[float], now: float) -> None:
    while times and times[0] <= now - WINDOW:
        times.popleft()


def locked_for(ip: str, device: str = "") -> int:
    """Seconds until this address or device may try again; 0 when it may try now.
    `device` is the id from the browser's sage_device cookie, so a wrong-PIN
    streak from one browser doesn't lock the others out."""
    now = time.time()
    _trim(_all_failures, now)
    waits = []
    for key in filter(None, (ip, device and f"device:{device}")):
        mine = _failures.get(key, deque())
        _trim(mine, now)
        if len(mine) >= PER_IP_LIMIT:
            waits.append(mine[0] + WINDOW - now)
    if len(_all_failures) >= GLOBAL_LIMIT:
        waits.append(_all_failures[0] + WINDOW - now)
    return int(max(waits)) + 1 if waits else 0


def record_failure(ip: str, device: str = "") -> None:
    now = time.time()
    for key in filter(None, (ip, device and f"device:{device}")):
        _failures.setdefault(key, deque()).append(now)
    _all_failures.append(now)


def clear_failures(ip: str, device: str = "") -> None:
    _failures.pop(ip, None)
    if device:
        _failures.pop(f"device:{device}", None)


def new_device_id() -> str:
    return secrets.token_urlsafe(12)


def client_ip(request) -> str:
    """The visitor's address. Behind the tunnel every request comes from
    cloudflared on this Pi, so Cloudflare's header is trusted only then."""
    host = request.client.host if request.client else ""
    if host in ("127.0.0.1", "::1"):
        forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return host


def is_https(request) -> bool:
    return (
        request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto", "") == "https"
        or '"https"' in request.headers.get("cf-visitor", "")
    )


def safe_next(target: Optional[str]) -> str:
    """Only same-site paths, so /login can't bounce someone to another site."""
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return "/"


def login_page(next_path: str = "/", message: str = "") -> str:
    error = f'<p class="error">{html.escape(message)}</p>' if message else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sage</title>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root {{ color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --text: #1c1b19; --muted: #6b6860; --line: #d9d6cf; --accent: #3b5bdb; --error: #c92a2a; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg: #141413; --card: #1f1e1c; --text: #eceae4; --muted: #9c998f; --line: #3a3834; --accent: #748ffc; --error: #ff8787; }} }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.4 system-ui, -apple-system, sans-serif; padding: 16px; }}
  form {{ width: 100%; max-width: 320px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 24px; text-align: center; }}
  h1 {{ margin: 0 0 4px; font-size: 22px; }}
  p {{ margin: 0 0 20px; color: var(--muted); font-size: 14px; }}
  input {{ width: 100%; font-size: 28px; letter-spacing: 0.4em; text-align: center; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: transparent; color: inherit; }}
  input:focus {{ outline: 2px solid var(--accent); border-color: transparent; }}
  button {{ width: 100%; margin-top: 16px; padding: 12px; font-size: 16px; font-weight: 600; border: 0; border-radius: 10px; background: var(--accent); color: #fff; cursor: pointer; }}
  .error {{ color: var(--error); margin: 12px 0 0; }}
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>Sage</h1>
  <p>Enter your password to continue.</p>
  <input type="password" name="password" inputmode="numeric" autocomplete="current-password" autofocus required aria-label="Password">
  <input type="hidden" name="next" value="{html.escape(next_path)}">
  {error}
  <button type="submit">Unlock</button>
</form>
</body>
</html>"""


if __name__ == "__main__":
    first = getpass.getpass("New Sage password: ")
    if not first:
        sys.exit("No password entered.")
    if getpass.getpass("Type it again: ") != first:
        sys.exit("The two entries didn't match.")
    print(hash_password(first))
