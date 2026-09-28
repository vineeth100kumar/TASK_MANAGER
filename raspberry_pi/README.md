# Sage server (Raspberry Pi)

`db_server.py` is Sage's server on the Pi. It keeps the task data in SQLite,
serves the built web app, streams changes to LUMO over `/ws`, and backs the
data up to Google Apps Script. Install and run it with `deploy/install_pi.sh`
(see the root README); systemd runs it as the `sage` service on port 8000.

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
