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


# --- One page load per password ---
# The login cookie above keeps the open app's data calls working, but opening
# or reloading the app itself needs the password again. A good password also
# sets a short-lived ticket cookie, and loading a page spends it, so the next
# visit (a new tab, a reload, reopening the home-screen app) goes to /login.
OPEN_COOKIE = "sage_open"
OPEN_SECONDS = 120
_spent_tickets: Dict[str, float] = {}


def new_open_ticket() -> str:
    body = f"{int(time.time()) + OPEN_SECONDS}.{secrets.token_urlsafe(12)}"
    signature = hmac.new(_session_key(), ("open:" + body).encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def spend_open_ticket(token: Optional[str]) -> bool:
    """True once for each ticket from a good password, then never again."""
    try:
        expiry, nonce, signature = (token or "").split(".")
    except ValueError:
        return False
    expected = hmac.new(_session_key(), f"open:{expiry}.{nonce}".encode(), hashlib.sha256).hexdigest()
    now = time.time()
    for spent, until in list(_spent_tickets.items()):
        if until <= now:
            del _spent_tickets[spent]
    if not (hmac.compare_digest(signature, expected) and expiry.isdigit() and int(expiry) > now):
        return False
    if nonce in _spent_tickets:
        return False
    _spent_tickets[nonce] = int(expiry)
    return True


def is_page_load(request) -> bool:
    """A browser opening the app itself, as opposed to its scripts, icons or
    data. Browsers say so in Sec-Fetch-Dest; the path covers older ones."""
    dest = request.headers.get("sec-fetch-dest", "")
    if dest:
        return dest in ("document", "iframe", "frame")
    path = request.url.path
    return path == "/" or path.endswith(".html")


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


def login_page(next_path: str = "/", message: str = "", font_url: str = "") -> str:
    """The password page, drawn to match the app: Inter, the Sage logo, the
    app's black/white buttons, and whichever theme the app was last left in
    (it saves that as sage-theme in this browser)."""
    error = f'<p class="error" role="alert">{html.escape(message)}</p>' if message else ""
    font = (
        f'@font-face {{ font-family: "Inter Variable"; font-style: normal; font-display: swap; '
        f'font-weight: 100 900; src: url("{html.escape(font_url)}") format("woff2-variations"); }}'
        if font_url else ""
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sage">
<title>Sage</title>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<script>
  try {{
    if (localStorage.getItem("sage-theme") === "dark") {{
      document.documentElement.classList.add("dark");
      document.querySelector('meta[name="theme-color"]').content = "#0a0a0b";
    }}
  }} catch (e) {{}}
</script>
<style>
  {font}
  :root {{
    color-scheme: light;
    --bg: #ffffff; --card: #ffffff; --text: #111827; --muted: #6b7280; --faint: #9ca3af;
    --line: rgba(0,0,0,0.06); --field: #f5f5f7; --field-line: #e5e7eb; --ring: rgba(17,24,39,0.12);
    --btn-from: #1f2937; --btn-to: #030712; --btn-text: #ffffff; --error: #dc2626; --error-bg: #fef2f2;
    --glow: radial-gradient(60rem 30rem at 50% -10%, rgba(99,102,241,0.08), transparent 60%);
  }}
  html.dark {{
    color-scheme: dark;
    --bg: #0a0a0b; --card: #1c1c1e; --text: #f3f4f6; --muted: #9ca3af; --faint: #6b7280;
    --line: rgba(255,255,255,0.06); --field: rgba(255,255,255,0.05); --field-line: rgba(255,255,255,0.1); --ring: rgba(255,255,255,0.18);
    --btn-from: #ffffff; --btn-to: #e5e7eb; --btn-text: #000000; --error: #f87171; --error-bg: rgba(248,113,113,0.1);
    --glow: radial-gradient(60rem 30rem at 50% -10%, rgba(129,140,248,0.10), transparent 60%);
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ height: 100%; }}
  body {{
    margin: 0; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
    background: var(--glow), var(--bg); color: var(--text);
    font-family: "Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-feature-settings: "cv11", "ss01", "ss03", "cv05";
    -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  }}
  .wrap {{ width: 100%; max-width: 360px; animation: rise .5s cubic-bezier(0.16, 1, 0.3, 1) both; }}
  .logo {{ display: flex; justify-content: center; margin-bottom: 28px; }}
  .logo img {{ height: 40px; width: auto; user-select: none; }}
  .logo .dark-only {{ display: none; }}
  html.dark .logo .light-only {{ display: none; }}
  html.dark .logo .dark-only {{ display: block; }}
  form {{
    background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 28px 24px 24px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 12px 32px -12px rgba(0,0,0,0.12); text-align: center;
  }}
  html.dark form {{ box-shadow: 0 12px 40px -16px rgba(0,0,0,0.6); }}
  h1 {{ margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }}
  .sub {{ margin: 6px 0 22px; color: var(--muted); font-size: 14px; }}
  input[type=password] {{
    width: 100%; height: 56px; font: inherit; font-size: 26px; letter-spacing: 0.5em; text-indent: 0.5em; text-align: center;
    border: 1px solid var(--field-line); border-radius: 14px; background: var(--field); color: inherit;
    transition: box-shadow .2s, border-color .2s, background .2s;
  }}
  input[type=password]::placeholder {{ color: var(--faint); letter-spacing: 0.5em; }}
  input[type=password]:focus {{ outline: none; border-color: transparent; box-shadow: 0 0 0 3px var(--ring); background: var(--card); }}
  .error {{
    margin: 12px 0 0; padding: 8px 12px; border-radius: 12px; font-size: 13.5px; font-weight: 500;
    color: var(--error); background: var(--error-bg);
  }}
  button {{
    width: 100%; height: 46px; margin-top: 16px; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
    border: 0; border-radius: 14px; color: var(--btn-text);
    background: linear-gradient(to bottom, var(--btn-from), var(--btn-to));
    box-shadow: 0 1px 2px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.1);
    transition: transform .15s, filter .15s;
  }}
  button:hover {{ filter: brightness(1.12); }}
  html.dark button:hover {{ filter: brightness(1.04); }}
  button:active {{ transform: scale(0.97); }}
  .foot {{ margin-top: 18px; text-align: center; color: var(--faint); font-size: 12.5px; }}
  .shake form {{ animation: shake .4s cubic-bezier(.36,.07,.19,.97) both; }}
  @keyframes rise {{ from {{ opacity: 0; transform: translateY(8px); }} to {{ opacity: 1; transform: none; }} }}
  @keyframes shake {{ 20%, 60% {{ transform: translateX(-6px); }} 40%, 80% {{ transform: translateX(6px); }} }}
  @media (prefers-reduced-motion: reduce) {{ .wrap, .shake form {{ animation: none; }} }}
</style>
</head>
<body>
<main class="wrap{' shake' if message else ''}">
  <div class="logo">
    <img class="light-only" src="/logo-light.png" alt="Sage" draggable="false">
    <img class="dark-only" src="/logo-dark.png" alt="Sage" draggable="false">
  </div>
  <form method="post" action="/login">
    <h1>Welcome back</h1>
    <p class="sub">Enter your password to open Sage.</p>
    <input type="password" name="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" autofocus required aria-label="Password">
    <input type="hidden" name="next" value="{html.escape(next_path)}">
    {error}
    <button type="submit">Unlock</button>
  </form>
  <p class="foot">Sage asks for this each time it opens.</p>
</main>
</body>
</html>"""


if __name__ == "__main__":
    first = getpass.getpass("New Sage password: ")
    if not first:
        sys.exit("No password entered.")
    if getpass.getpass("Type it again: ") != first:
        sys.exit("The two entries didn't match.")
    print(hash_password(first))
