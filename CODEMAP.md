# Code map

A quick guide for finding code in this repo. Checked against the code on
2026-10-26 (LUMO firmware 2.20.0). Update it when you add a folder, module,
endpoint or feature.

**Branches:** `main` is behind. The Pi deploys the branch set in
`SAGE_BRANCH` (`/etc/sage/sage.env`, read by `deploy/auto_sync.sh`), which is
`claude/project-thread-clc1ti`. Open PRs against that branch.

## Top level

| Path | What it is |
| --- | --- |
| `src/` | Sage web app (React 19 + Vite 8 + Tailwind 4, TypeScript) |
| `public/` | Static files: icons, `sw.js` (push service worker), manifest |
| `index.html`, `vite.config.ts` | Vite entry and config (blanks `VITE_GAS_AUTH_KEY` in Pi builds) |
| `raspberry_pi/` | Sage server, FastAPI on :8000 (`db_server.py`) |
| `raspberry_pi/desk/` | LUMO clock driver, run inside Sage's server; clock websocket on :8765 |
| `lumo/esp32_client/` | LUMO firmware (ESP32-C3, Arduino) |
| `lumo/rpi_server/` | Old LUMO server, retired (Sage does its jobs). Only its tests still run in CI |
| `lumo/tools/` | Generators: `make_aa_fonts.py` → `aa_fonts.h`, `alarm_sounds.py` → `tones.h` |
| `google-apps-script/Code.gs` | Backup sync target (Google Sheets), used with no Pi or as the Pi's backup |
| `deploy/` | Pi installer, systemd units, auto-sync, tunnel, password and Claude access scripts |
| `docs/` | `claude-access.md` (Claude's API + MCP), old audits |
| `.github/workflows/` | `ci.yml` (typecheck, build, Python tests), `lumo-firmware.yml` (builds firmware for OTA) |

## Data flow

```
 Browser / iPhone PWA
   │  IndexedDB (db.ts) ◀─ api.ts (store) ◀─ views
   │  syncEngine.ts queue ──POST /api/sync/operations──▶┐
   │  liveStream.ts ◀──── /ws  SYNC_APPLIED ────────────┤
   ▼                                                    │
 Sage server :8000  (raspberry_pi/db_server.py, SQLite sage_sync.db)
   ├─ notifier.py ──▶ Web Push (sw.js) + SMTP email; IMAP email capture
   ├─ backup.py   ──▶ nightly local DB copies
   ├─ GAS backup loop ──▶ Apps Script ──▶ Google Sheets
   ├─ Groq / Ollama ◀── chat_capture, canvas_thinker, radar*, sparks, industry
   ├─ claude_api.py ◀── Claude (REST /api/claude/*, MCP /mcp/{token})
   ├─ phone_link.py ◀── iPhone over BLE (notifications, now playing)
   └─ desk/ ──ws :8765 (pairing code)──▶ LUMO ESP32 clock
                         ▲ OTA: GitHub Actions build → desk/ota.py → clock
```

No Pi configured (`VITE_PI_BACKEND_URL` empty): `syncEngine.ts` talks to
Apps Script directly.

## Frontend `src/`

| Path | What it does |
| --- | --- |
| `main.tsx`, `App.tsx` | Entry; `App.tsx` owns `activeView` and picks the view |
| `components/views/lazyViews.tsx` | Lazy loading and prefetch of the heavy views and modals |
| `components/layout/` | `Sidebar.tsx` (nav, projects, areas, goals), `Header.tsx`, `MobileTabBar.tsx` |
| `services/api.ts` | The domain store: every create/update/delete, then `persist()` |
| `services/db.ts` | IndexedDB tables |
| `services/syncEngine.ts` | Durable sync queue to the Pi (or Apps Script) |
| `services/liveStream.ts` | Pi `/ws` stream, so other devices' changes arrive live |
| `services/tabSync.ts` | Multi-tab leader election |
| `services/items.ts` | One shape for every work item (`normalizeItem`, `selectItems`, `statusOf`). All views read items through it |
| `services/types.ts`, `constants.ts` | Types; fixed lists (types, statuses, priorities) |
| `services/projectTypes.ts` | Project types with their own statuses and icons |
| `services/placement.ts` | Every task gets a project or area |
| `services/lifeMode.ts` | Work / Chill modes |
| `services/piBackend.ts` | Pi URL and key (env or Settings) |
| `services/aiEngine.ts` | Client for the Pi's AI routes |
| `services/pushNotifications.ts` | Push subscribe; `notificationService.ts` = in-tab reminders without a Pi |
| `services/lumo.ts` | LUMO page client (`/api/desk/*`) |
| `services/radar.ts`, `ideaProject.ts` | Radar client; turn an idea into a project |
| `services/bluetooth.ts` | Pi Bluetooth from Settings |
| `services/planProject.ts` | Save a plan from the Chat tab |
| `services/sampleData.ts` | Seed data, `npm run dev` only |
| `utils/` | Parsers and rules: `quickAddParser`, `chatCapture`, `chatCommands`, `projectPlan`, `recurrence`, `reminders`, `habits`, `taskLists` (Today/Inbox rules), `titles`, `dateUtils`, `calendarExport`, `dataImporter`, `imageExport`, `progress` |
| `hooks/` | `useCompletion`, `useDataChanges`, `useCachedState`, `useEscapeKey`, `useIsMobile` |
| `context/ToastContext.tsx` | Toasts |

### Views (`activeView` in `App.tsx`)

| `activeView` | Screen | File |
| --- | --- | --- |
| `dashboard` | Today | `views/DashboardView.tsx` |
| `inbox` | Inbox | `views/InboxView.tsx`, `InboxTriage.tsx` |
| `focus` | Focus | `views/FocusView.tsx` |
| `waiting` | Waiting for | `views/WaitingForView.tsx` |
| `tasks` | All items / project, as list, board, table, calendar, timeline, branches | `views/ListView`, `BoardView`, `TableView`, `CalendarView`, `TimelineView`, `branches/ProjectBranchesView.tsx`, `ProjectTypeBar.tsx` |
| `notes` | Notes | `views/NotesView.tsx` + `components/notes/` |
| `canvas` | Canvas | `views/CanvasView.tsx` + `components/canvas/` |
| `radar` | Radar | `views/RadarView.tsx` + `components/radar/` |
| `lumo` | LUMO clock page | `views/LumoView.tsx` + `components/lumo/` |

## Where each feature lives

| Feature | Frontend | Pi server |
| --- | --- | --- |
| New Item (Form / Chat) | `tasks/CreateTaskModal.tsx`, `tasks/ChatCapture.tsx`, `tasks/PlanCard.tsx`, `utils/chatCapture.ts`, `utils/chatCommands.ts` | `chat_capture.py` (Groq) |
| Quick add line | `common/QuickAddLine.tsx`, `utils/quickAddParser.ts` | `quick_add.py` (Python port), `POST /api/quick-add` |
| Siri / Shortcuts / email capture | `modals/CaptureGuide.tsx` (Settings > Shortcuts) | `/api/quick-add`, `notifier.check_email_inbox` |
| Item detail | `tasks/TaskInspector.tsx` | `item_actions.py` (done / snooze / tomorrow) |
| Task row, tick | `common/TaskRow.tsx`, `CompleteButton.tsx`, `SpinnerCheck.tsx`, `SwipeRow.tsx` | |
| Repeats, reminders | `utils/recurrence.ts`, `utils/reminders.ts`, `common/RepeatSelect.tsx` | `notifier.py` |
| Push and email | `modals/NotificationSettings.tsx`, `services/pushNotifications.ts`, `public/sw.js` | `notifier.py` (VAPID push, SMTP, scheduler) |
| Habits, goals | `habits/HabitViews.tsx`, `utils/habits.ts`, Sidebar growth panel | `notifier.py` (habit reminders), `item_shape.py` |
| Projects, types, branches | `services/projectTypes.ts`, `common/ProjectTypePicker.tsx`, `common/ProjectFront.tsx`, `branches/` | `item_shape.py`, `placement.py` |
| Work / Chill modes | `services/lifeMode.ts`, `common/ModeSwitch.tsx`, `modals/ModeSettings.tsx` | `life_mode.py` |
| Notes, lock, thought maps | `notes/RichNoteEditor`, `NotesLock`, `ThoughtMapView`, `ThoughtTree`, `thoughtMap.ts`, `ReportNoteView`, `reportFrame.ts` | `claude_api.py` (`/maps`, `/notes/push`) |
| Canvas | `canvas/ExcalidrawBoard.tsx`, `ThinkPanel.tsx`, `boardEdits.ts`, `boardTemplates.ts`, `markdownChart.ts` | `canvas_thinker.py` (Groq, Claude or Ollama) |
| Radar Signals / brief | `radar/SignalsTab`, `RadarBriefCard`, `modals/RadarSettings.tsx` | `radar.py`, `prices.py` |
| Radar Markets | `radar/MarketsTab.tsx` | `markets.py` |
| Radar research, Studio, Vault | `radar/StudioTab`, `VaultTab`, `IdeasTab`, `IdeaPage` | `radar_research.py` |
| Radar Lab (sparks, My edge) | `radar/LabTab.tsx`, `EdgeEditor.tsx` | `sparks.py` |
| Radar industry search | `radar/IndustrySearch.tsx`, `IndustryPage.tsx` | `industry.py` |
| LUMO page | `components/lumo/*Tab.tsx`, `DepthFacePanel`, `ScreenFitPanel`, `alarmSounds.ts` | `desk/` (see below) |
| Bluetooth, phone link | `modals/BluetoothSettings.tsx`, `common/PhoneCorner.tsx` | `bluetooth_control.py`, `phone_link.py` |
| Password gate | `notes/NotesLock.tsx` | `access_gate.py` |
| Claude access | | `claude_api.py`, `docs/claude-access.md`, `deploy/claude_access.sh` |
| Health check | `modals/SyncDiagnosticsModal.tsx` | `system_health.py` (`/api/claude/health`) |
| Rituals | `modals/MorningPickThree`, `EveningShutdown`, `WeeklyReview` | |
| Trash, import, export | `modals/TrashModal.tsx`, `utils/dataImporter.ts`, `calendarExport.ts`, `imageExport.ts` | |

## Pi server `raspberry_pi/`

| File | What it does |
| --- | --- |
| `db_server.py` | FastAPI app: sync, `/ws`, settings, notifications, phone, Bluetooth, desk routes; mounts routers and the built web app |
| `access_gate.py` | Password gate and login cookie for outside access |
| `notifier.py` | Push, email, email capture, `scheduler()` started at startup |
| `backup.py` | Nightly DB copies (`SAGE_BACKUP_*`) |
| `claude_api.py` | `/api/claude/*` REST and `/mcp/{token}` MCP server |
| `item_shape.py`, `placement.py` | Python copies of `items.ts` and `placement.ts` |
| `item_actions.py`, `quick_add.py` | One-item changes; quick-add parser |
| `chat_capture.py`, `canvas_thinker.py` | AI for Chat capture and Canvas |
| `radar.py`, `radar_research.py`, `markets.py`, `prices.py`, `sparks.py`, `industry.py` | Radar (each has its own `router`) |
| `life_mode.py`, `phone_link.py`, `bluetooth_control.py`, `public_link.py`, `system_health.py` | Modes, iPhone BLE, Bluetooth, public URL, health report |
| `desk/run.py` | Starts the clock from `db_server.py` startup |
| `desk/link.py` | Clock websocket :8765, pairing, `cmd` out / `evt` in |
| `desk/desk.py`, `controller.py` | What the clock shows and what buttons do |
| `desk/settings.py`, `alarm_store.py`, `alarms.py`, `tools.py` | Clock settings, alarms, timer and stopwatch |
| `desk/song.py`, `art.py`, `ambient.py`, `today.py` | Now playing, album art, weather and vitals, Tasks screen |
| `desk/depth.py`, `gallery.py` | Depth clock face; away gallery and photo frame |
| `desk/ota.py` | Firmware updates over Wi-Fi |

Clock protocol (`desk/link.py`): clock sends `evt` HELLO, READY, STATUS,
BTN, TRIAL, OFFLINE, DEPTH_NEED. Pi sends `cmd` such as CLOCK, SCREEN,
SHOW_TASKS, ALARMS, ALARM_RING, NOTIF, SONG_INFO, LIGHTS, HAPTIC, TONE,
WEATHER, FIT, OTA, REBOOT.

## LUMO firmware `lumo/esp32_client/`

| File | What it does |
| --- | --- |
| `esp32_client.ino` | Setup and main loop |
| `config.h` | Pins, constants, `FW_VERSION` |
| `secrets.example.h` | Copy to `secrets.h` (gitignored): Wi-Fi, Pi address |
| `ws_client.cpp`, `lumo_socket.cpp` | Link to Sage: parses `cmd`, sends `evt`; own websocket client |
| `display.cpp` | Screens, classic faces, screen fit |
| `faces.cpp`, `aa_text.cpp`, `aa_fonts.h` | Premium faces, smooth text, generated fonts |
| `peripherals.cpp`, `tones.h` | Buttons, LEDs, haptic engine (buzzer + motor), alarm sounds |
| `clockkeeper.cpp`, `store.cpp` | Free-running clock; settings kept in flash |
| `ota.cpp`, `perf.cpp`, `anim.h` | OTA with trial boot; frame meter; easing |

## HTTP API (Pi :8000)

| Area | Routes |
| --- | --- |
| Login | `GET/POST /login`, `POST /api/unlock`, `GET /logout` |
| Live | `WS /ws` (auth frame, then `SYNC_APPLIED` / `SYNC_CLEARED`) |
| Sync | `GET /api/health`, `GET /api/sync/all`, `GET /api/sync/changes`, `POST /api/sync/operations`, `POST /api/sync/clear` |
| Backup | `GET /api/backup/status`, `POST /api/backup/run` |
| Items | `POST /api/quick-add`, `POST /api/items/{id}/done`, `/snooze`, `/tomorrow`, `POST /api/parse-task` |
| AI | `GET/POST /api/canvas/think`, `GET/POST /api/chat-capture`, `GET/POST /api/settings/groq-key`, `GET/POST /api/settings/prices-key` |
| Notifications | `GET /api/notifications`, `POST .../subscribe`, `.../unsubscribe`, `PUT .../prefs`, `POST .../email-password`, `POST .../test` |
| Email capture | `GET /api/email-capture`, `POST .../password`, `PUT .../prefs`, `POST .../test` |
| Modes | `GET/PUT /api/life-mode`, `POST /api/life-mode/welcomed` |
| Phone | `GET /api/phone`, `POST /api/phone/notifications`, `DELETE /api/phone/notifications/{id}`, `POST /api/phone/media` |
| Bluetooth | `GET /api/bluetooth`, `POST .../power`, `.../pairing`, `.../scan`, `.../name`, `.../confirm`, `.../devices/{address}/{action}` |
| Desk clock | `GET /api/desk`, `GET/PUT /api/desk/settings`, `POST .../settings/reset`, `POST /api/desk/press`, `GET/POST /api/desk/alarms`, `PUT/DELETE .../alarms/{id}`, `POST /api/desk/ringing`, `.../timer`, `.../stopwatch`, `.../device`, `.../firmware` |
| Depth face | `GET/PUT/DELETE /api/desk/depth`, `POST .../depth/photo`, `.../depth/cutout` |
| Gallery | `GET/POST /api/desk/gallery/photos`, `POST .../photos/upload`, `DELETE .../photos/{name}`, `POST /api/desk/gallery/preview` |
| Radar | `GET /api/radar/summary`, `/signals`, `/brief`, `GET/PUT /api/radar/settings`, `POST /api/radar/refresh`, `GET /api/radar/markets` |
| Radar research | `POST/GET /api/radar/research`, `GET .../research/{job_id}` |
| Radar Lab | `GET /api/radar/sparks`, `POST .../sparks/make`, `POST .../sparks/{id}/keep`, `/research`, `/dismiss` |
| Industry | `POST/GET /api/radar/industry`, `GET .../industry/{id}`, `POST .../{id}/ai`, `POST .../{id}/note` |
| Claude | `GET /api/claude/overview`, `/health`, `/history`, `POST /quick-add`, `GET /maps`, `/maps/{ref}`, `POST /maps/{ref}/thoughts`, `POST /notes/push`, CRUD `/api/claude/{table}[/{id}]`; MCP `/mcp/{token}` |
| Other | `GET /api/public-url`; `/` serves the built web app |

Sync tables are whitelisted in `SYNC_TABLES` (`db_server.py`). A new table
needs adding there and in `db.ts`.

## Config

| Where | What |
| --- | --- |
| `.env` (from `.env.template`) | `VITE_PI_BACKEND_URL`, `VITE_PI_API_KEY`, `VITE_GAS_URL`, `VITE_GAS_AUTH_KEY` |
| `/etc/sage/sage.env` on the Pi (written by `deploy/install_pi.sh`) | `API_SECRET`, `SAGE_*` (bind, DB path, branch, backups, email, Groq models, desk, OTA, phone, Radar), `GROQ_API_KEY`, `ANTHROPIC_API_KEY` |
| `raspberry_pi/README.md` | Explains the server settings |
| `lumo/esp32_client/secrets.h` | Clock Wi-Fi and Pi address |
| Settings in the app | Groq and prices keys: saved on the Pi via `/api/settings/*`. Server key: browser only (`piBackend.ts`, `sage.piApiKey`) |

## Tests

| What | Where | Run |
| --- | --- | --- |
| Web unit tests | `src/**/*.test.ts` | `npm test` (vitest) |
| Types | whole `src/` | `npm run typecheck` |
| Pi server | `raspberry_pi/tests/test_*.py`, `raspberry_pi/test_quick_add.py` | `cd raspberry_pi && python -m unittest discover -s tests` |
| Old LUMO server | `lumo/rpi_server/tests/` | `cd lumo/rpi_server && python -m unittest discover -s tests` |
| Firmware build | `.github/workflows/lumo-firmware.yml` | CI on push |

## Deploy

| File | What it does |
| --- | --- |
| `deploy/install_pi.sh` | Installs venv, builds the web app, writes `sage.env`, installs units, prints pairing code |
| `deploy/auto_sync.sh` + `systemd/sage-autosync.service` | Pulls `SAGE_BRANCH` every 30 s, rebuilds, restarts what changed |
| `deploy/systemd/sage.service` | The Sage server |
| `deploy/setup_tunnel.sh`, `cloudflared/`, `sage-tunnel.service`, `sage-quicktunnel.service` | Cloudflare tunnel |
| `deploy/set_access_password.sh` | Outside-access password |
| `deploy/claude_access.sh` | Claude token and MCP address |
| `deploy/install_depth.sh` | Optional depth-face packages |

## If you want to change X, look at Y

| Change | Look at |
| --- | --- |
| How an item is read or counted on any page | `src/services/items.ts` and `raspberry_pi/item_shape.py` (keep both in step) |
| Saving data | `src/services/api.ts` → `db.ts` → `syncEngine.ts` |
| Sync rules on the server | `db_server.py` `/api/sync/*`, `SYNC_TABLES` |
| Live updates between devices | `db_server.py` `/ws`, `src/services/liveStream.ts` |
| Today or Inbox contents | `src/utils/taskLists.ts`, `views/DashboardView.tsx`, `InboxView.tsx` |
| Quick-add wording | `src/utils/quickAddParser.ts` and `raspberry_pi/quick_add.py` (tests in both) |
| Chat capture prompts | `raspberry_pi/chat_capture.py`, `src/utils/chatCapture.ts` |
| A notification's timing or text | `raspberry_pi/notifier.py` |
| A new API route | `db_server.py` or a module's `router`, then a client in `src/services/` |
| A Settings tab | `src/components/modals/SettingsModal.tsx` (tabs list at top) |
| A new view | `App.tsx`, `views/lazyViews.tsx`, `layout/Sidebar.tsx`, `MobileTabBar.tsx` |
| What the clock shows or a button does | `raspberry_pi/desk/controller.py`, `desk.py` |
| A clock setting | `desk/settings.py`, `src/components/lumo/`, firmware `ws_client.cpp` |
| Clock drawing | `lumo/esp32_client/display.cpp`, `faces.cpp` |
| Clock lights, buzzer, motor | `lumo/esp32_client/peripherals.cpp`, `tones.h` |
| Firmware release | bump `FW_VERSION` in `config.h`; CI builds it and `desk/ota.py` delivers it |
| Radar data sources | `raspberry_pi/radar.py` (`SAGE_RADAR_FEEDS`), `prices.py` |
| What Claude can do in Sage | `raspberry_pi/claude_api.py` |
| Pi install or deploy | `deploy/install_pi.sh`, `deploy/auto_sync.sh` |
