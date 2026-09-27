# Sage Task Manager - Raspberry Pi AI Backend

This folder contains the Python server required to run **Qwen 2.5 (1.5B)** locally on your Raspberry Pi 5 (4GB) and expose it to your Sage Task Manager via a secure, hallucination-proof JSON API.

## Why Qwen 2.5 1.5B?
A Raspberry Pi 5 with 4GB RAM is hardware constrained. Qwen 2.5 (1.5B) leaves enough RAM (~2.5GB) for your operating system and Context Windows, completely avoiding the catastrophic slowdowns that happen when the Pi runs out of RAM and starts swapping. Furthermore, it is incredibly fast and has near-perfect JSON formatting adherence for its size.

## Requirements
- A Raspberry Pi 5 (4GB RAM is sufficient).
- Linux / Raspberry Pi OS.
- Python 3.

## How to Install and Run
1. Copy this entire folder (aspberry_pi) to your Raspberry Pi.
2. Open a terminal on your Pi and navigate to this folder.
3. Make the setup script executable:
   \chmod +x setup.sh\
4. Run the setup script:
   \./setup.sh\

The setup script will automatically install Ollama, download the Qwen 2.5 1.5B model, install the Python dependencies, and start the API server on port 8000.

## How it works (Hallucination-Proofing)
This Python server (FastAPI) acts as a middleman between your React app and Ollama. It relies on three layers of security to prevent hallucinations:
1. **Ollama's \ormat="json"\:** Forces the generation sequence to strictly abide by JSON grammar rules.
2. **Zero-Temperature constraints:** Disables model creativity to ensure maximum predictability.
3. **Safe Parse Fallback Regex:** A Python safe_parse_json utility that detects and automatically strips away any rogue Markdown formatting (json ...) that small 1.5B models occasionally accidentally output before returning the pure payload to the React app.

## Sync server settings

`db_server.py` reads these from the environment. On the Pi, `deploy/install_pi.sh` writes them to `/etc/sage/sage.env` and systemd loads that file for both Sage and LUMO.

| Variable | Default | What it does |
| --- | --- | --- |
| `API_SECRET` | empty | Key every `/api/` request and the `/ws` stream must present (`Authorization: Bearer <key>`). Empty turns the check off, which is only safe when the server can't be reached from outside the Pi. |
| `SAGE_DB_PATH` | `sage_sync.db` | SQLite file. |
| `SAGE_DIST_DIR` | `../dist` | Built web app, served at `/` when present. |
| `SAGE_CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the API from a browser. |
| `SAGE_GAS_URL` | the existing Apps Script URL | Where the 4-hourly backup goes. |

`/ws` is a live event stream. Send `{"type": "auth", "token": "<key>"}` as the first frame; after that each applied sync batch arrives as `{"type": "SYNC_APPLIED", "serverRevision": n, "changes": [...]}`. LUMO uses it to update the clock within a second of a change in the app.

In the web app, enter the same key under Settings > System > Raspberry Pi server key.
