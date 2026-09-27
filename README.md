# Sage + LUMO

One repository for Sage, the task manager, and LUMO, the desk clock that shows
Sage's tasks and rings its alarms. Both run on the same Raspberry Pi 5 as two
separate services, so a crash in one never takes the other down.

| Folder | What it is |
| --- | --- |
| `src/`, `public/`, `index.html` | Sage web app (React + Vite). Data lives in the browser and syncs to the Pi. |
| `raspberry_pi/` | Sage server (`db_server.py`, port 8000): sync API, `/ws` event stream, AI routes, and it serves the built web app. |
| `google-apps-script/` | Backup sync target, used when no Pi is configured. |
| `lumo/rpi_server/` | LUMO server (ports 8080, 8081, 8765): dashboard, clock link, Bluetooth music, weather, Jarvis voice, memories. |
| `lumo/esp32_client/` | LUMO clock firmware (ESP32-C3). |
| `deploy/` | Pi installer, systemd units, and the auto-sync that deploys `main`. |

LUMO came from `vineeth100kumar/lumo-pi-system`; its history is kept under
`lumo/` (use `git log -- lumo/` or `git log --follow`).

```
iPhone ──Bluetooth──▶ LUMO :8080 ◀──ws :8765── ESP32 clock
                         │
                         │ /api/sync + /ws, with API_SECRET
                         ▼
browser ──/api/sync──▶ Sage :8000 (SQLite + Ollama) ──backup──▶ Apps Script
```

## Install on the Pi

```bash
git clone https://github.com/vineeth100kumar/TASK_MANAGER.git
cd TASK_MANAGER
sudo deploy/install_pi.sh            # --no-lumo, --no-autosync, --user <name>
```

The installer writes `/etc/sage/sage.env` (with a new `API_SECRET` if there
isn't one), creates both venvs, builds the web app, and installs the `sage`,
`lumo`, `lumo-obex` and `sage-autosync` units. Open `http://<pi>:8000`, then
enter the key from `sudo grep API_SECRET /etc/sage/sage.env` under
Settings > System.

`sage-autosync` pulls `main` every 30 seconds and restarts only the service
whose folder changed, so merge through pull requests rather than pushing
straight to `main`.

## Develop the web app

```bash
npm install
npm run build        # or: npx vite
```

Set `VITE_PI_BACKEND_URL` in `.env` to the Pi's address (see `.env.template`).

## Flash the clock

Copy `lumo/esp32_client/secrets.example.h` to `secrets.h`, fill in your Wi-Fi
and the Pi's address, and follow `lumo/README.md`. `secrets.h` is gitignored.
