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
| `SAGE_GAS_URL` | the existing Apps Script URL | Where the 4-hourly backup goes. |

`/ws` is a live event stream. Send `{"type": "auth", "token": "<key>"}` as the first frame; after that each applied sync batch arrives as `{"type": "SYNC_APPLIED", "serverRevision": n, "changes": [...]}`. LUMO and the web app use it to pick up a change from another device within a second.

In the web app, enter the same key under Settings > System > Raspberry Pi server key.

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
