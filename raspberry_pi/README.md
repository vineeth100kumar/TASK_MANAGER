# Sage server (Raspberry Pi)

`db_server.py` is Sage's server on the Pi. It keeps the task data in SQLite,
serves the built web app, streams changes to LUMO over `/ws`, and backs the
data up to Google Apps Script. Install and run it with `deploy/install_pi.sh`
(see the root README); systemd runs it as the `sage` service on port 8000.

## Sync server settings

`db_server.py` reads these from the environment. On the Pi, `deploy/install_pi.sh` writes them to `/etc/sage/sage.env` and systemd loads that file for both Sage and LUMO.

| Variable | Default | What it does |
| --- | --- | --- |
| `API_SECRET` | empty | Key every `/api/` request and the `/ws` stream must present (`Authorization: Bearer <key>`). Empty turns the check off, which is only safe when the server can't be reached from outside the Pi. |
| `SAGE_DB_PATH` | `sage_sync.db` | SQLite file. |
| `SAGE_DIST_DIR` | `../dist` | Built web app, served at `/` when present. |
| `SAGE_CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the API from a browser. |
| `SAGE_GAS_URL` | the Apps Script URL | Where synced changes are backed up. |
| `SAGE_GAS_AUTH_KEY` | empty | The key set as `SAGE_AUTH_KEY` in the Apps Script's Script Properties. Sent with every backup. Set it on both sides, otherwise anyone who finds the script's address can read or wipe the Sheet. |
| `SAGE_GAS_BACKUP_INTERVAL` | `300` | Seconds between backups to Apps Script. |
| `SAGE_BIND` | `127.0.0.1` | Address Sage listens on (set by `sage.service`). Only this Pi can reach it, so the tunnel, Tailscale and LUMO work while plain http on the home network can't expose the PIN. Set `0.0.0.0` in `/etc/sage/sage.env` to open it to the LAN. |
| `SAGE_BACKUP_DIR` | `backups/` beside the database | Where nightly copies of the database go. |
| `SAGE_BACKUP_KEEP` | `14` | How many copies to keep. |
| `SAGE_BACKUP_TIME` | `03:00` | Local time of the nightly copy (in the time zone chosen in Settings > Notifications). |
| `SAGE_ACCESS_PASSWORD_HASH` | empty | Turns on the password page (below). Set it with `deploy/set_access_password.sh`. |
| `SAGE_SESSION_DAYS` | `30` | How long a browser stays logged in after typing the password. |
| `GROQ_API_KEY` | empty | Canvas's "Think with me" panel uses Groq when this is set, here or in `lumo/rpi_server/.env` (LUMO's key works). Easier: paste it in the app under Settings > Server & Reset, which saves it to `sage_secrets.json` next to the database and takes priority. |
| `SAGE_CANVAS_GROQ_MODEL` | LUMO's `GROQ_LLM_MODEL`, else `qwen/qwen3.8-27b` | Groq model for the Canvas panel. Falls back to `openai/gpt-oss-20b` when it's busy. |
| `ANTHROPIC_API_KEY` | empty | Without a Groq key, lets the Canvas panel use Claude, which reads both the board's text and a picture of it. With neither, the panel uses the local Ollama model, which is slow. |
| `SAGE_CANVAS_MODEL` | `claude-opus-5-5` | Claude model for the Canvas panel. |
| `SAGE_PUBLIC_URL` | found automatically | The public link Settings shows. Normally found on its own (named tunnel, quick tunnel or Tailscale Funnel); set it only to override. |

### Backups

A copy of the database is taken every night, and just before everything is cleared (the clear itself needs `{"confirm": "DELETE"}`). Settings > Server & Reset shows when the last copy was made and has a "Back up now" button. Copies live on the same SD card as the database, so now and then copy `raspberry_pi/backups/` somewhere else. To restore: `sudo systemctl stop sage`, copy a file from `backups/` over `sage_sync.db`, `sudo systemctl start sage`.

### Time zone

One time zone, set in Settings > Notifications, is used by reminders, the morning plan, the nightly backup and LUMO's alarms. The first device to turn notifications on sets it; after that no device's clock moves it.

### Running outside the venv

`pywebpush` can't be installed into Debian's system Python (it refuses system-wide pip installs). Use the venv that `install_pi.sh` creates: `raspberry_pi/venv/bin/pip install -r requirements.txt`.

`/ws` is a live event stream. Send `{"type": "auth", "token": "<key>"}` as the first frame; after that each applied sync batch arrives as `{"type": "SYNC_APPLIED", "serverRevision": n, "changes": [...]}`. LUMO and the web app use it to pick up a change from another device within a second.

In the web app, enter the same key under Settings > Server & Reset > Raspberry Pi server key.

## Reach Sage from anywhere

A Cloudflare Tunnel gives Sage a public `https://` address without opening
any port on your router: `cloudflared` on the Pi dials out to Cloudflare and
carries the web app, `/api` and `/ws` back to `localhost:8000`.

You need a domain whose DNS is on Cloudflare (a free account is enough). On
the Pi, from the checkout:

```bash
git pull
sudo deploy/setup_tunnel.sh tasks.example.com   # your hostname
```

The script asks for the password first if none is set, then prints a
Cloudflare link: open it on any device, log in, and pick the domain. After
that it creates a tunnel named `sage`, points the hostname at it, and starts
the `sage-tunnel` service, which comes back after a reboot. Run it again any
time; it reuses what already exists.

No domain? Run `sudo deploy/setup_tunnel.sh` with no hostname. It starts a free
quick tunnel as the `sage-quicktunnel` service, which comes back after a reboot
with a new random `trycloudflare.com` address. Settings > Server & Reset shows
the current address, so you don't have to look it up.

### The password

With `SAGE_ACCESS_PASSWORD_HASH` set, every page and API call needs either
the login cookie a browser gets from typing the password at `/login`, or the
`API_SECRET` key. LUMO and scripts keep using the key; browsers only need the
password, and stay logged in for `SAGE_SESSION_DAYS`. `/api/health` stays open.

```bash
sudo deploy/set_access_password.sh   # set or change it; logs every browser out
```

Only a salted PBKDF2 hash is stored, in `/etc/sage/sage.env`; nothing about
the password is in the web app's bundle or the repo. A four-digit PIN is easy
to guess, so wrong tries are rationed: 5 per hour from one address and 10 per
hour from everyone together, with each wrong try logged to `journalctl -u sage`.
A longer password is still safer. To turn the lock off, delete the
`SAGE_ACCESS_PASSWORD_HASH` line and `sudo systemctl restart sage`.

Useful checks:

```bash
systemctl status sage-tunnel
journalctl -u sage-tunnel -n 50
journalctl -u sage | grep "Wrong Sage password"
```

To take Sage off the internet: `sudo systemctl disable --now sage-tunnel`.

## Notifications

The Pi sends task notifications itself (`notifier.py`), so they arrive while Sage is closed:

- **Reminders** at the time set on a task, event or reminder.
- **Morning plan** at a chosen time: what's due today and what's overdue. Skipped on an empty day.
- **Evening check-in** at a chosen time, only when something due today is still open.

Everything is set up in the app under **Settings > Notifications**. Times follow the timezone of the device that last opened Sage with notifications on.

**Push.** Works in Chrome, Edge, Firefox and Safari, and on iPhone/iPad (iOS 16.4+) only from the Home Screen: open Sage in Safari, tap Share > Add to Home Screen, open it from the icon, then tap **Turn on reminders** on Today. Push needs HTTPS, which Tailscale Funnel or a tunnel provides. The Pi makes its push keys on first start (`sage_vapid_private.pem` next to the database); deleting that file means every device has to turn notifications on again.

**Email.** Uses any SMTP account. It's set up to send from reminder.vk@gmail.com to vineeth100kumar@gmail.com; change either under Settings > Notifications > Email. For Gmail, sign in to the sending account, turn on 2-Step Verification, make an app password at https://myaccount.google.com/apppasswords, and paste it under Settings > Notifications > Email, then use **Send a test email**. The password is kept in `sage_secrets.json` on the Pi (or set `SAGE_SMTP_PASSWORD` in `/etc/sage/sage.env`), never in the database or the Apps Script backup.

Optional settings in `/etc/sage/sage.env`:

| Setting | Default | What it does |
| --- | --- | --- |
| `SAGE_VAPID_SUBJECT` | the email address, else the public link | Contact address push services see (`mailto:` or `https://`) |
| `SAGE_EMAIL_FROM` | reminder.vk@gmail.com | Account that sends the email (the app password belongs to this one) |
| `SAGE_EMAIL_TO` | vineeth100kumar@gmail.com | Where email goes |
| `SAGE_SMTP_PASSWORD` | empty | SMTP password, if you'd rather not enter it in the app |

Tests: `cd raspberry_pi && python -m unittest discover -s tests`.

## Optional: AI endpoints

Two endpoints use a local model through [Ollama](https://ollama.com):

- `POST /api/parse-task` turns text like "call mum at 6" into tasks (LUMO's voice assistant uses it).
- `POST /api/daily-briefing` writes the Dashboard's morning briefing.

Everything else works without them. The installer does not set up Ollama; to
enable these endpoints, install it and pull the model once:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:1.5b
```

The model is small enough to leave room on a 4 GB Pi 5. Requests use JSON mode
at low temperature, and `safe_parse_json` strips stray Markdown fences before
the reply is parsed.
