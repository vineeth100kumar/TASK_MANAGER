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


# The Sage logo mark (the S with its arrow) the loading screen draws itself into,
# over and over. Shared
# by the login page here and the app's first-paint splash in index.html, so the
# animation runs unbroken across the sign-in -> app hand-off. Each is a few
# single strokes on a 24x24 grid in the app's rounded line style.
SAGE_LOADER_ICONS_JS = (
    "[['M11.9,5.7C8.1,5.1 5.7,7 5.9,9.4C6.1,12.5 9.9,14.7 13.7,14.5','M5.7,16.3C6.3,19.6 10.2,19.9 14,19.6C17.5,19.3 18.8,15.8 16.9,12.5C15.9,10.9 14.3,10.2 12.4,10.1L9.8,10.4','M12.7,9.8L18.4,4.1','M14.5,4.5L18.4,4.1L18.1,8.1']]"
)


def loader_css() -> str:
    """Styles for the morphing loading screen, injected into the login page's
    stylesheet. Mirrored by index.html's first-paint splash."""
    return """
  .loader { display: flex; flex-direction: column; align-items: center; text-align: center; animation: rise .4s cubic-bezier(.16,1,.3,1) both; }
  .loader .mark { color: var(--text); }
  .loader .mark svg { width: 84px; height: 84px; overflow: visible; transform-origin: 50% 50%; }
  .loader .mark svg path { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; }
  .loader-label { margin: 22px 0 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); }
  .loader .bar { margin-top: 16px; width: 92px; height: 4px; border-radius: 999px; background: var(--field); overflow: hidden; }
  .loader .bar i { display: block; width: 45%; height: 100%; border-radius: 999px; background: var(--text); animation: slide 1.1s ease-in-out infinite; }
  .loader-quote { margin: 20px 0 0; max-width: 300px; font: italic 14px/1.4 Georgia, 'Times New Roman', serif; color: var(--muted); }
  .loader .link { width: auto; height: auto; margin-top: 20px; padding: 6px 10px; background: none; border: 0; box-shadow: none; color: var(--muted); font-size: 13px; font-weight: 500; cursor: pointer; }
  .loader .link:hover { filter: none; color: var(--text); }
  @keyframes slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(260%); } }
  @media (prefers-reduced-motion: reduce) { .loader .bar i { animation: none; } }
"""


def loader_html(label: str, hidden: bool = False) -> str:
    attr = " hidden" if hidden else ""
    return f"""<div id="loader" class="loader"{attr}>
    <div class="mark"><svg id="glyph-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g id="glyph"></g></svg></div>
    <p class="loader-label" id="loader-label">{html.escape(label)}</p>
    <div class="bar"><i></i></div>
    <p class="loader-quote" id="loader-quote"></p>
    <button type="button" id="to-password" class="link" hidden>Use password instead</button>
  </div>"""


def login_script(next_path: str, has_error: bool) -> str:
    """The login page's brain. Once a device is trusted, opening Sage unlocks it
    automatically with the device's own Face ID / fingerprint / PIN (the primary
    path); the password is the manual fallback. The loading animation covers the
    whole wait — the trusted-device check, the sign-in, and the app loading."""
    import json
    next_js = json.dumps(next_path)
    has_error_js = "true" if has_error else "false"
    return (
        """
window.SageLoader = (function () {
  var ICONS = __ICONS__;
  var HOLD = 650, DRAW = 460, OUT = 240, NS = 'http://www.w3.org/2000/svg';
  var QUOTES = ['Good things come to those who wait.','Great things take a little time.','Patience is bitter, but its fruit is sweet.','Slow and steady. Your day is coming together.','Almost there. Worth the wait.'];
  var running = false, idx = 0;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function glyph() { return document.getElementById('glyph'); }
  function svg() { return document.getElementById('glyph-svg'); }
  function setPaths(ps) {
    var g = glyph(); if (!g) return [];
    g.textContent = '';
    return ps.map(function (d, k) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d); p.setAttribute('pathLength', '1');
      p.style.strokeDashoffset = '1'; p.style.opacity = '0';
      p.style.transition = reduce ? 'none' : ('stroke-dashoffset ' + DRAW + 'ms ease ' + (k * 55) + 'ms, opacity 200ms ' + (k * 55) + 'ms');
      g.appendChild(p); return p;
    });
  }
  async function loop() {
    while (running) {
      var g = glyph(), s = svg();
      if (!g || !s) { running = false; break; }
      if (!reduce) { s.style.transition = 'none'; s.style.transform = 'rotate(-5deg) scale(.92)'; }
      var q = document.getElementById('loader-quote'); if (q && idx % 3 === 0) q.textContent = QUOTES[(idx / 3) % QUOTES.length];
      var nodes = setPaths(ICONS[idx % ICONS.length]);
      await wait(20);
      if (!running) break;
      if (!reduce) s.style.transition = 'transform ' + DRAW + 'ms cubic-bezier(.16,1,.3,1)';
      s.style.transform = 'rotate(0deg) scale(1)';
      nodes.forEach(function (p) { p.style.strokeDashoffset = '0'; p.style.opacity = '1'; });
      await wait(reduce ? 1200 : HOLD + DRAW);
      if (!running) break;
      if (!reduce) {
        nodes.forEach(function (p) { p.style.strokeDashoffset = '1'; p.style.opacity = '0'; });
        s.style.transform = 'rotate(5deg) scale(.92)';
        await wait(OUT);
      }
      idx++;
    }
  }
  return {
    start: function () { if (running) return; running = true; idx = 0; loop(); },
    stop: function () { running = false; },
    label: function (t) { var el = document.getElementById('loader-label'); if (el) el.textContent = t; }
  };
})();

(function () {
  var NEXT = __NEXT__, HAS_ERROR = __HAS_ERROR__;
  var loader = document.getElementById('loader');
  var form = document.getElementById('form');
  var foot = document.getElementById('foot');
  var pkBtn = document.getElementById('passkey-btn');
  var pkMsg = document.getElementById('passkey-msg');
  var toPw = document.getElementById('to-password');
  var pwInput = form.querySelector('input[type=password]');
  var supported = !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials && navigator.credentials.get);

  function b64urlToBuf(v) {
    v = v.replace(/-/g, '+').replace(/_/g, '/');
    while (v.length % 4) v += '=';
    var s = atob(v), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  function bufToB64url(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  function showForm(focus) {
    if (window.SageLoader) SageLoader.stop();
    loader.hidden = true; form.hidden = false; foot.hidden = false;
    if (focus && pwInput) { try { pwInput.focus(); } catch (e) {} }
  }
  function showLoader(label) {
    form.hidden = true; foot.hidden = true; loader.hidden = false;
    if (window.SageLoader) { SageLoader.label(label); SageLoader.start(); }
  }

  async function doPasskey() {
    var r = await fetch('/api/webauthn/auth/begin', { method: 'POST', credentials: 'include' });
    var opts = await r.json();
    if (!r.ok) throw new Error(opts.error || 'No trusted device.');
    var session = opts.sageSession; delete opts.sageSession;
    opts.challenge = b64urlToBuf(opts.challenge);
    opts.allowCredentials = (opts.allowCredentials || []).map(function (c) { c.id = b64urlToBuf(c.id); return c; });
    var cred = await navigator.credentials.get({ publicKey: opts });
    var resp = cred.response;
    var payload = {
      id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
      response: {
        clientDataJSON: bufToB64url(resp.clientDataJSON),
        authenticatorData: bufToB64url(resp.authenticatorData),
        signature: bufToB64url(resp.signature),
        userHandle: resp.userHandle ? bufToB64url(resp.userHandle) : null
      },
      clientExtensionResults: cred.getClientExtensionResults(),
      authenticatorAttachment: cred.authenticatorAttachment
    };
    var cr = await fetch('/api/webauthn/auth/complete', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: payload, session: session })
    });
    var cd = await cr.json();
    if (!cr.ok || !cd.success) throw new Error(cd.error || "That didn't work.");
    return true;
  }

  async function unlockWithDevice() {
    if (pkMsg) pkMsg.textContent = '';
    showLoader('Unlocking Sage');
    if (toPw) toPw.hidden = false;
    try {
      await doPasskey();
      if (toPw) toPw.hidden = true;
      if (window.SageLoader) SageLoader.label('Opening Sage');
      window.location.href = NEXT;
    } catch (e) {
      showForm(true);
      if (pkBtn) pkBtn.hidden = false;
      var benign = e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
      if (pkMsg) pkMsg.textContent = benign ? '' : ((e && e.message) || "That didn't work.");
    }
  }

  if (toPw) toPw.addEventListener('click', function () { showForm(true); if (pkBtn) pkBtn.hidden = false; });
  if (pkBtn) pkBtn.addEventListener('click', function () { unlockWithDevice(); });

  // Typing the password: keep the animation up through sign-in and the app load.
  form.addEventListener('submit', function () { showLoader('Opening Sage'); });

  function offerDeviceButton() {
    fetch('/api/webauthn/status', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { if (s && s.available && s.gate && s.secure && s.hasDevices && pkBtn) pkBtn.hidden = false; })
      .catch(function () {});
  }

  if (HAS_ERROR) {
    // A wrong-password reload: the form is already up. Still offer the device.
    if (supported) offerDeviceButton();
    return;
  }
  // No error: the loader is the first thing on screen. Start it, then decide.
  if (window.SageLoader) { SageLoader.label('Opening Sage'); SageLoader.start(); }
  if (!supported) { showForm(true); return; }
  fetch('/api/webauthn/status', { credentials: 'include' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (s && s.available && s.gate && s.secure && s.hasDevices) unlockWithDevice();
      else showForm(true);
    })
    .catch(function () { showForm(true); });
})();
"""
        .replace("__ICONS__", SAGE_LOADER_ICONS_JS)
        .replace("__NEXT__", next_js)
        .replace("__HAS_ERROR__", has_error_js)
    )


def login_page(next_path: str = "/", message: str = "", font_url: str = "") -> str:
    """The password page, drawn to match the app: Inter, the loader mark, the
    app's black/white buttons, and whichever theme the app was last left in
    (it saves that as sage-theme in this browser)."""
    error = f'<p class="error" role="alert">{html.escape(message)}</p>' if message else ""
    # With a server message (a wrong-password reload) the form shows at once and
    # takes focus; otherwise the loader shows first and the script decides whether
    # to auto-unlock with a trusted device or fall back to the form.
    form_hidden = "" if message else " hidden"
    autofocus = "autofocus " if message else ""
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
  .or {{ display: flex; align-items: center; gap: 10px; margin: 18px 2px 14px; color: var(--faint); font-size: 12px; }}
  .or::before, .or::after {{ content: ""; flex: 1; height: 1px; background: var(--field-line); }}
  button.ghost {{
    background: var(--field); color: var(--text); border: 1px solid var(--field-line);
    box-shadow: none; display: flex; align-items: center; justify-content: center; gap: 9px; margin-top: 0;
  }}
  button.ghost:hover {{ filter: none; background: var(--card); border-color: var(--ring); }}
  .pk-msg {{ margin: 10px 0 0; min-height: 0; font-size: 12.5px; color: var(--error); }}
  .pk-msg:empty {{ margin: 0; }}
  .shake form {{ animation: shake .4s cubic-bezier(.36,.07,.19,.97) both; }}
  @keyframes rise {{ from {{ opacity: 0; transform: translateY(8px); }} to {{ opacity: 1; transform: none; }} }}
  @keyframes shake {{ 20%, 60% {{ transform: translateX(-6px); }} 40%, 80% {{ transform: translateX(6px); }} }}
  @media (prefers-reduced-motion: reduce) {{ .wrap, .shake form {{ animation: none; }} }}
  {loader_css()}
</style>
</head>
<body>
<main class="wrap" id="wrap">
  {loader_html("Opening Sage", bool(message))}

  <form id="form" method="post" action="/login"{form_hidden}>
    <h1>Welcome back</h1>
    <p class="sub" id="form-sub">Enter your password to open Sage.</p>
    <input type="password" name="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" {autofocus}required aria-label="Password">
    <input type="hidden" name="next" value="{html.escape(next_path)}">
    {error}
    <button type="submit">Unlock</button>
    <button type="button" id="passkey-btn" class="ghost" hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 11a3 3 0 0 0-3 3c0 1.5-.3 2.5-.8 3.3"/><path d="M12 11a3 3 0 0 1 3 3c0 2-.4 3.5-1 4.8"/><path d="M6.5 9a6 6 0 0 1 9-1.3"/><path d="M9 20.5c.6-1.3 1-3 1-6.5"/><path d="M14.7 20a16 16 0 0 0 .3-6 3 3 0 0 0-3-3"/></svg>
      <span>Unlock with this device</span>
    </button>
    <p id="passkey-msg" class="pk-msg" role="status"></p>
  </form>
  <p class="foot" id="foot">Sage asks for this each time it opens.</p>
</main>
<script>{login_script(next_path, bool(message))}</script>
</body>
</html>"""


if __name__ == "__main__":
    first = getpass.getpass("New Sage password: ")
    if not first:
        sys.exit("No password entered.")
    if getpass.getpass("Type it again: ") != first:
        sys.exit("The two entries didn't match.")
    print(hash_password(first))
