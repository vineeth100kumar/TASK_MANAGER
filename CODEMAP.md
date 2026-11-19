# Code map

A guide for finding code in this repo. Rebuilt from the code on 2026-11-16
(LUMO firmware 2.24.1). Update it when you add a folder, module, endpoint or
feature.

**Branches:** `main` is behind. The Pi deploys the branch set in `SAGE_BRANCH`
(`/etc/sage/sage.env`, read by `deploy/auto_sync.sh`), which is
`claude/project-thread-clc1ti`. Open PRs against that branch. Deploy by hand:
`cd ~/sage-os && git pull && sudo deploy/install_pi.sh --only server,web`
(add `audio`, `services` when those changed).

The separate `lumo-pi-system` repo is a frozen early copy of LUMO. Everything
current lives here (`lumo/` and `raspberry_pi/desk/`).

## Top level

| Path | What it is |
| --- | --- |
| `src/` | Sage web app (React 19, Vite 8, Tailwind 4, TypeScript) |
| `public/` | Static files: icons, `sw.js` (push service worker), manifest, `lumo-faces/` |
| `index.html`, `vite.config.ts` | Vite entry and config (blanks `VITE_GAS_AUTH_KEY` in Pi builds) |
| `raspberry_pi/` | Sage server, FastAPI on :8000 (`db_server.py`) |
| `raspberry_pi/desk/` | LUMO clock driver, run inside Sage's server; clock websocket on :8765 |
| `raspberry_pi/content_engine/` | Slide and reel maker (`autocontent` package) used by `posts.py` and `reels.py` |
| `raspberry_pi/sage_posts/` | Made posts and their slides (data kept in git, written by the server) |
| `raspberry_pi/audio/` | `sage_surround.c`, the ALSA surround plugin for the soundbar |
| `lumo/esp32_client/` | LUMO firmware (ESP32-C3, Arduino) |
| `lumo/rpi_server/` | Old LUMO server, retired (Sage does its jobs now). Only its tests still run in CI |
| `lumo/tools/` | Generators: `make_aa_fonts.py` makes `aa_fonts.h`, `alarm_sounds.py` makes `tones.h` |
| `google-apps-script/Code.gs` | Backup sync target (Google Sheets), used with no Pi or as the Pi's backup |
| `deploy/` | Pi installer, systemd units, auto-sync, tunnel, password and Claude access scripts |
| `docs/` | `claude-access.md` (Claude's API + MCP), `sd-card-data.md`, old audits, screenshots |
| `.github/workflows/` | `ci.yml` (typecheck, build, Python tests), `lumo-firmware.yml` (builds firmware for OTA) |

## Data flow

```
 Browser / iPhone PWA
   |  IndexedDB (db.ts) <- api.ts (store) <- views
   |  syncEngine.ts queue --POST /api/sync/operations--> |
   |  liveStream.ts <---- /ws  SYNC_APPLIED ------------ |
   v                                                     |
 Sage server :8000  (raspberry_pi/db_server.py, SQLite sage_sync.db, writes via db_writer.py)
   +- notifier.py --> Web Push (sw.js) + SMTP email; IMAP email capture
   +- backup.py   --> nightly local DB copies;  GAS loop --> Apps Script --> Sheets
   +- Groq (Ollama only if SAGE_LOCAL_AI=1) <-- chat_capture, canvas_thinker, radar*, sparks, industry, voice_command
   +- claude_api.py <-- Claude (REST /api/claude/*, MCP /mcp/{token})
   +- phone_link.py <-- iPhone over BLE (notifications, now playing, calls)
   +- speaker.py (Herald voice) + spotify.py + room_music.py --> Bluetooth soundbar / USB audio
   +- posts.py, reels.py --> content_engine --> slides / video
   +- desk/ --ws :8765 (pairing code)--> LUMO ESP32 clock
                         ^ OTA: GitHub Actions build -> desk/ota.py -> clock
```

No Pi configured (`VITE_PI_BACKEND_URL` empty): `syncEngine.ts` talks to Apps
Script directly.

## Frontend `src/`

| Path | What it does |
| --- | --- |
| `main.tsx`, `App.tsx` | Entry; `App.tsx` owns `activeView` and picks the view |
| `components/views/lazyViews.tsx` | Lazy loading and prefetch of heavy views and modals |
| `components/layout/` | `Sidebar.tsx` (nav, projects, areas, goals), `Header`, `MobileTabBar`, `RingingBanner`, `VoiceAssistant` |
| `services/api.ts` | The domain store: every create/update/delete, then `persist()` |
| `services/db.ts` | IndexedDB tables |
| `services/syncEngine.ts` | Durable sync queue to the Pi (or Apps Script) |
| `services/liveStream.ts`, `tabSync.ts` | Pi `/ws` stream; multi-tab leader election |
| `services/items.ts` | One shape for every work item (`normalizeItem`, `selectItems`, `statusOf`). All views read items through it |
| `services/types.ts`, `constants.ts` | Types; fixed lists (statuses, priorities) |
| `services/projectTypes.ts`, `placement.ts`, `lifeMode.ts` | Project types and statuses; every task has a project or area; Work/Chill modes |
| `services/piBackend.ts`, `aiEngine.ts` | Pi URL and key; client for the Pi's AI routes |
| `services/pushNotifications.ts`, `notificationService.ts` | Push subscribe; in-tab reminders without a Pi |
| `services/passkeys.ts` | Trusted devices (Face ID / screen lock sign-in) |
| `services/lumo.ts`, `spotify.ts`, `speaker.ts`, `bluetooth.ts` | Clients for `/api/desk`, `/api/spotify`, `/api/speaker`, `/api/bluetooth` |
| `services/radar.ts`, `ideaProject.ts`, `planProject.ts` | Radar client; idea to project; save a plan from Chat |
| `services/posts.ts`, `reels.ts`, `recordings.ts`, `drop.ts` | Clients for Posts, Reels, Recordings, Drop |
| `services/voiceCommands.ts`, `voiceListener.ts` | In-app voice commands and the listener |
| `services/sampleData.ts` | Seed data, `npm run dev` only |
| `utils/` | Parsers and rules: `quickAddParser`, `chatCapture`, `chatCommands`, `projectPlan`, `recurrence`, `reminders`, `doses`, `habits`, `holidays`, `taskLists` (Today/Inbox rules), `titles`, `dateUtils`, `calendarExport`, `dataImporter`, `imageExport`, `progress` |
| `hooks/` | `useCompletion`, `useDataChanges`, `useCachedState`, `useEscapeKey`, `useIsMobile` |
| `data/holidays_in.json` | India holidays (read-only layer) |
| `context/ToastContext.tsx` | Toasts |

### Views (`activeView` in `App.tsx`; nav in `layout/Sidebar.tsx`)

| `activeView` | Screen | File |
| --- | --- | --- |
| `dashboard` | Today | `views/DashboardView.tsx` |
| `inbox` | Inbox | `views/InboxView.tsx`, `InboxTriage.tsx` |
| `focus`, `waiting_for` | Focus; Waiting for | `views/FocusView.tsx`, `WaitingForView.tsx` |
| `tasks` | All items or one project: list, board, table, calendar, timeline, branches | `ListView`, `BoardView`, `TableView`, `CalendarView`, `TimelineView`, `branches/ProjectBranchesView.tsx`, `ProjectTypeBar.tsx` |
| `notes` | Notes and docs | `views/NotesView.tsx` + `components/notes/` |
| `canvas` | Canvas | `views/CanvasView.tsx` + `components/canvas/` |
| `radar` | Radar (work only) | `views/RadarView.tsx` + `components/radar/` |
| `lumo` | LUMO clock page | `views/LumoView.tsx` + `components/lumo/` |
| `drop` | Drop share links | `views/DropView.tsx` |
| `posts`, `reels` | Instagram carousels; vertical videos (work only) | `views/PostsView.tsx`, `ReelsView.tsx` + `components/posts/`, `components/reels/` |
| `hidden` | Hidden tasks, password-locked | `views/HiddenView.tsx` |
| `recordings` | Mic recordings, **parked** (nav entry commented out) | `views/RecordingsView.tsx` |

Settings tabs are listed at the top of `modals/SettingsModal.tsx`
(Notifications, Modes, Holidays, Shortcuts, Sign-in, Bluetooth, Desk Clock,
Radar, Data and Migration, Server and Reset).

## Where each feature lives

| Feature | Frontend | Pi server |
| --- | --- | --- |
| New Item (Form / Chat) | `tasks/CreateTaskModal`, `ChatCapture`, `PlanCard`, `utils/chatCapture.ts`, `chatCommands.ts` | `chat_capture.py` (Groq) |
| Quick add line | `common/QuickAddLine.tsx`, `utils/quickAddParser.ts` | `quick_add.py` (Python port), `POST /api/quick-add` |
| Siri, Shortcuts, email capture | `modals/CaptureGuide.tsx`, `SiriSetupDemo`, `ShortcutSheet` | `voice_command.py` (one Siri shortcut), `/api/quick-add`, `notifier.check_email_inbox` |
| In-app voice | `layout/VoiceAssistant.tsx`, `services/voiceListener.ts` | `voice_assistant.py`, `voice_stt.py` (Groq Whisper), `/api/voice/*` |
| Item detail, task row | `tasks/TaskInspector`, `common/TaskRow`, `CompleteButton`, `SwipeRow`, `SpinnerCheck` | `item_actions.py` (done, snooze, tomorrow) |
| Repeats, reminders, doses | `utils/recurrence.ts`, `reminders.ts`, `doses.ts`, `common/RepeatSelect`, `DoseTimesPicker` | `notifier.py` |
| Push and email | `modals/NotificationSettings`, `public/sw.js` | `notifier.py` (VAPID push, SMTP, scheduler) |
| Habits, goals | `habits/HabitViews.tsx`, `utils/habits.ts` | `notifier.py`, `item_shape.py` |
| Projects, types, branches | `projectTypes.ts`, `common/ProjectTypePicker`, `ProjectFront`, `branches/` | `item_shape.py`, `placement.py` |
| Work / Chill modes | `lifeMode.ts`, `common/ModeSwitch`, `ModePrompt`, `modals/ModeSettings` | `life_mode.py` |
| Hidden tasks | `views/HiddenView`, `common/HiddenWorkLine`, `services/items.ts` | `item_shape.py`, `claude_api.py` |
| Holidays | `utils/holidays.ts`, `modals/HolidaySettings`, `common/HolidayTag` | |
| Rituals | `modals/MorningPickThree`, `EveningShutdown`, `WeeklyReview` | |
| Notes, lock, thought maps | `notes/RichNoteEditor`, `NotesLock`, `ThoughtMapView`, `ThoughtTree`, `thoughtMap.ts`, `ReportNoteView`, `reportFrame.ts`, `DrawingPad` | `claude_api.py` (`/maps`, `/notes/push`) |
| Canvas | `canvas/ExcalidrawBoard`, `ThinkPanel`, `boardEdits`, `boardTemplates`, `markdownChart` | `canvas_thinker.py` |
| Radar: Signals, brief | `radar/SignalsTab`, `RadarBriefCard`, `modals/RadarSettings` | `radar.py`, `prices.py` |
| Radar: Markets | `radar/MarketsTab` | `markets.py` |
| Radar: research, Studio, Vault, Ideas | `radar/StudioTab`, `VaultTab`, `IdeasTab`, `IdeaPage` | `radar_research.py` |
| Radar: Lab | `radar/LabTab`, `EdgeEditor` | `sparks.py` |
| Radar: industry search | `radar/IndustrySearch`, `IndustryPage` | `industry.py` |
| LUMO page | `components/lumo/*Tab.tsx`, `DepthFacePanel`, `ScreenFitPanel`, `alarmSounds.ts`, `modals/DeskClockSettings` | `desk/` (below) |
| Bluetooth, phone link | `modals/BluetoothSettings`, `common/PhoneCorner`, `PresenceCard` | `bluetooth_control.py`, `phone_link.py` |
| Herald (voice on the soundbar) | `modals/SpeakerCard` | `speaker.py`, `herald_extras.py`, `herald_journal.py`, `speak_worker.py`, `/api/speaker/*`, `/api/herald/presence` |
| Spotify and arrival music | `modals/SpotifyCard` | `spotify.py` (Soloist, PipeWire bridge), `room_music.py`, `audio_probe.py`, `/api/spotify/*` |
| Drop share links | `views/DropView`, `services/drop.ts`, Notes share menu | `drop.py` |
| Content pipeline (ideas, scripts, posts, reels, schedule) | `views/ProjectPipeline.tsx` (Pipeline button in `ProjectTypeBar`, mode `pipeline` in `App.tsx`); week plan `views/ContentCalendar.tsx` (Board/Week toggle in the Pipeline, and `views/ContentWeekView.tsx` = sidebar "Content week" for every project); shared helpers `services/contentPieces.ts`; status line + empty-week nudge `views/ContentSummary.tsx` | `posts.py` / `reels.py` `scheduledFor` + `POST .../schedule` |
| Posts (carousels) | `views/PostsView`, `components/posts/`, `modals/PostPictureKeys` | `posts.py`, `posts_copies.py`, `lowprio.py`, `content_engine/` |
| Reels (videos) | `views/ReelsView`, `components/reels/` | `reels.py`, `content_engine/src/autocontent/reel/`, `deploy/install_reels.sh` |
| Recordings (parked) | `views/RecordingsView`, `services/recordings.ts` | `recorder.py` (routes need `SAGE_MIC=1`) |
| Sign-in | `notes/NotesLock`, `modals/SecuritySettings`, `common/TrustDevicePrompt`, `services/passkeys.ts` | `access_gate.py`, `passkeys.py` |
| Claude access | | `claude_api.py`, `docs/claude-access.md`, `deploy/claude_access.sh` |
| Health, logs, outages | `modals/SyncDiagnosticsModal` | `system_health.py`, `logstore.py`, `diagnostics.py`, `uptime.py` |
| Trash, import, export | `modals/TrashModal`, `utils/dataImporter`, `calendarExport`, `imageExport` | |

## Pi server `raspberry_pi/`

| File | What it does |
| --- | --- |
| `db_server.py` | FastAPI app: sync, `/ws`, settings, notifications, phone, Bluetooth, Herald, desk routes; mounts routers and the built web app |
| `db_writer.py`, `sqlite_tuning.py`, `data_dir.py`, `web_files.py` | Single DB writer thread; SQLite pragmas for slow disks; SD card data dir with fallback; fast static serving |
| `access_gate.py`, `passkeys.py` | Password gate and cookie; trusted-device sign-in |
| `notifier.py` | Push, email, email capture, `scheduler()` |
| `backup.py` | Nightly DB copies (`SAGE_BACKUP_*`) |
| `claude_api.py` | `/api/claude/*` REST and `/mcp/{token}` MCP server (tools `sage_*`) |
| `item_shape.py`, `placement.py` | Python copies of `items.ts` and `placement.ts` |
| `item_actions.py`, `quick_add.py` | One-item changes; quick-add parser |
| `chat_capture.py`, `canvas_thinker.py`, `voice_command.py`, `voice_assistant.py`, `voice_stt.py` | AI for Chat, Canvas, Siri and voice |
| `radar.py`, `radar_research.py`, `markets.py`, `prices.py`, `sparks.py`, `industry.py` | Radar (most have their own `router`) |
| `drop.py`, `posts.py`, `posts_copies.py`, `reels.py`, `recorder.py` | Drop, Posts, Reels, Recordings routers |
| `content_schedule.py` | Background loop (every minute): a post/reel saved with a date (status `planned`) is drawn 1 hour before its slot, or earlier when the Pi is idle and the slot is within 24 h; Herald says when it is ready (`speaker.on_content_ready`). Env `SAGE_CONTENT_LEAD_MINUTES`, `SAGE_CONTENT_EARLY_HOURS` |
| `life_mode.py`, `phone_link.py`, `bluetooth_control.py`, `public_link.py` | Modes, iPhone BLE, Bluetooth, public URL |
| `speaker.py`, `speak_worker.py`, `herald_extras.py`, `herald_journal.py`, `room_music.py`, `spotify.py`, `audio_probe.py` | Herald, music, audio diagnostics |
| `system_health.py`, `logstore.py`, `diagnostics.py`, `uptime.py`, `lowprio.py` | Health report, capped log, blackout probe, "back up" emails, nice/ionice for heavy jobs |

### Desk clock `raspberry_pi/desk/`

| File | What it does |
| --- | --- |
| `run.py` | Starts the clock from `db_server.py` startup |
| `link.py` | Clock websocket :8765, pairing, `cmd` out and `evt` in |
| `desk.py`, `controller.py` | What the clock shows and what buttons do |
| `settings.py`, `alarm_store.py`, `alarms.py`, `tools.py` | Clock settings, alarms, timer and stopwatch |
| `song.py`, `art.py`, `ambient.py`, `today.py` | Now playing, album art, weather and vitals, Tasks screen |
| `depth.py`, `gallery.py` | Depth clock face; away gallery and photo frame |
| `ota.py` | Firmware updates over Wi-Fi |

Clock protocol: the clock sends `evt` HELLO, READY, STATUS, BTN, TRIAL, OFFLINE,
DEPTH_NEED. The Pi sends `cmd` such as CLOCK, SCREEN, SHOW_TASKS, ALARMS,
ALARM_RING, NOTIF, SONG_INFO, LIGHTS, HAPTIC, TONE, WEATHER, FIT, OTA, REBOOT.

### Content engine `raspberry_pi/content_engine/`

`src/autocontent/`: `spec/` (script parser and checks), `pipeline/` (extract,
compose, verify), `validators/`, `render/` (slides, charts, halftone), `reel/`
(timing, voice, captions, compose), `llm/` (groq, gemini, ollama, fake),
`ingest/`. `POST_FORMAT.md` and `REEL_FORMAT.md` are the script formats Claude
reads; `config/` holds brand and AI tuning; `styles/` and `assets/` are artwork.

## LUMO firmware `lumo/esp32_client/`

| File | What it does |
| --- | --- |
| `esp32_client.ino` | Setup and main loop |
| `config.h` | Pins, constants, `FW_VERSION` |
| `secrets.example.h` | Copy to `secrets.h` (gitignored): Wi-Fi, Pi address |
| `ws_client.cpp`, `lumo_socket.cpp` | Link to Sage: parses `cmd`, sends `evt` |
| `display.cpp` | Screens, classic faces, screen fit |
| `faces.cpp`, `aa_text.cpp`, `aa_fonts.h` | Premium faces, smooth text, generated fonts |
| `peripherals.cpp`, `tones.h` | Buttons, LEDs, haptic engine, alarm sounds |
| `clockkeeper.cpp`, `store.cpp` | Free-running clock; settings kept in flash |
| `ota.cpp`, `perf.cpp`, `anim.h`, `partitions.csv` | OTA with trial boot; frame meter; easing; flash layout |

## HTTP API (Pi :8000)

| Area | Routes |
| --- | --- |
| Login | `GET/POST /login`, `POST /api/unlock`, `GET /logout`, `/api/webauthn/*` (status, register, auth, devices, rename, revoke) |
| Live | `WS /ws` (auth frame, then `SYNC_APPLIED` / `SYNC_CLEARED`) |
| Sync | `GET /api/health`, `/api/health/services`, `/api/sync/all`, `/api/sync/changes`, `POST /api/sync/operations`, `POST /api/sync/clear` |
| Backup, storage | `GET /api/backup/status`, `POST /api/backup/run`, `GET /api/storage` |
| Items | `POST /api/quick-add`, `/api/items/{id}/done`, `/snooze`, `/tomorrow`, `POST /api/parse-task` |
| Voice | `GET/POST /api/voice`, `POST /api/voice/transcribe`, `/api/voice/command` |
| AI and keys | `GET/POST /api/canvas/think`, `/api/chat-capture`, `/api/settings/groq-key`, `/api/settings/prices-key`, `/api/settings/logs` |
| Logs | `GET /api/logs`, `/api/logs/slow`, `POST /api/logs/clear` |
| Notifications | `GET /api/notifications`, `POST .../subscribe`, `.../unsubscribe`, `PUT .../prefs`, `POST .../email-password`, `.../test` |
| Email capture | `GET /api/email-capture`, `POST .../password`, `PUT .../prefs`, `POST .../test` |
| Modes | `GET/PUT /api/life-mode`, `POST .../welcomed`, `.../leave` |
| Phone | `GET /api/phone`, `POST /api/phone/notifications`, `DELETE .../{id}`, `POST /api/phone/media` |
| Bluetooth | `GET /api/bluetooth`, `POST .../power`, `.../pairing`, `.../scan`, `.../name`, `.../confirm`, `.../devices/{address}/{action}` |
| Herald, speaker | `GET /api/herald/presence`, `GET /api/speaker`, `POST .../settings`, `.../say`, `.../announce`, `.../wifi`, `.../{action}` |
| Spotify | `GET /api/spotify`, `POST .../settings`, `.../volume`, `.../shuffle`, `.../call-over`, `.../arrival-test`, `.../{action}` |
| Desk clock | `GET /api/desk`, `GET/PUT .../settings`, `POST .../settings/reset`, `.../press`, `GET/POST .../alarms`, `PUT/DELETE .../alarms/{id}`, `POST .../ringing`, `.../timer`, `.../stopwatch`, `.../device`, `.../firmware` |
| Depth, gallery | `GET/PUT/DELETE /api/desk/depth`, `POST .../depth/photo`, `.../depth/cutout`; `GET/POST /api/desk/gallery/photos`, `POST .../photos/upload`, `DELETE .../photos/{name}`, `POST .../gallery/preview` |
| Radar | `GET /api/radar/summary`, `/signals`, `/brief`, `/markets`, `GET/PUT /settings`, `POST /refresh`; research `POST/GET /api/radar/research[/{job_id}]`; Lab `/sparks`, `/sparks/make`, `/sparks/{id}/keep|research|dismiss`; industry `/api/radar/industry[/{id}[/ai|/note]]` |
| Drop | `GET/POST /api/drops`, `POST .../clip`, `.../{slug}/images`, `/permanent`, `/enabled`, `/extend`, `DELETE .../{slug}` |
| Posts | `/api/posts` (list, create, `status`, `pictures`, `check`, `format`), `/api/posts/{id}` (get, `rerender`, `posted`, `schedule`, `review`, `restore`, `send`, delete, `slides/{n}`, `preview/{n}`, `zip`, `qr.svg`) |
| Reels | `/api/reels` (list, create, `format`, `status`, `check`), `/api/reels/{id}` (get, `voice`, `remake`, `posted`, `schedule`, `review`, `restore`, `send`, delete, `qr.svg`) |
| Recordings | `/api/recordings/*`: parked, only live with `SAGE_MIC=1` |
| Claude | `GET /api/claude/overview`, `/health`, `/history`, `/diagnostics`, `/maps`, `/maps/{ref}`, `POST /quick-add`, `/maps/{ref}/thoughts`, `/notes/push`, Drop, Posts and Reels helpers, CRUD `/api/claude/{table}[/{id}]`; MCP `/mcp/{token}` |
| Other | `GET /api/public-url`; `/` serves the built web app |

Sync tables are whitelisted in `SYNC_TABLES` (`db_server.py`). A new table
needs adding there and in `db.ts`.

## Config

| Where | What |
| --- | --- |
| `.env` (from `.env.template`) | `VITE_PI_BACKEND_URL`, `VITE_PI_API_KEY`, `VITE_GAS_URL`, `VITE_GAS_AUTH_KEY` |
| `/etc/sage/sage.env` on the Pi (written by `deploy/install_pi.sh`) | `API_SECRET`, `SAGE_*` (bind, DB path, branch, backups, email, Groq models, desk, OTA, phone, Radar, Herald, Spotify, Drop, Posts, Reels, diagnostics, SQLite), `GROQ_API_KEY`, `ANTHROPIC_API_KEY` |
| `raspberry_pi/README.md` | Explains the server settings |
| `lumo/esp32_client/secrets.h` | Clock Wi-Fi and Pi address |
| Settings in the app | Groq and prices keys saved on the Pi via `/api/settings/*`. Server key: browser only (`piBackend.ts`, `sage.piApiKey`) |

## Parked options (kept on purpose, not dead code)

| Option | How it is parked |
| --- | --- |
| Mic Recordings | Sidebar entry commented out in `Sidebar.tsx`; routes only work with `SAGE_MIC=1`; code in `recorder.py`, `RecordingsView.tsx` |
| Pi as a phone speaker | Off unless `SAGE_PHONE_SPEAKER=1` (phone pass-through hidden) |
| Local Ollama AI | Off unless `SAGE_LOCAL_AI=1` (`canvas_thinker`, `chat_capture`, `radar_research`, `voice_command`); also a `content_engine` provider |
| Old LUMO server | `lumo/rpi_server/`, retired; its tests still run in CI |

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
| `deploy/install_pi.sh` | Installs venv, builds the web app, writes `sage.env`, installs units; `--only server,web,audio,services` limits it |
| `deploy/auto_sync.sh` + `systemd/sage-autosync.service` | Pulls `SAGE_BRANCH` every 30 s, rebuilds, restarts what changed |
| `deploy/systemd/` | `sage.service`, `lumo.service`, `lumo-obex.service`, tunnel and autosync units |
| `deploy/setup_tunnel.sh`, `cloudflared/` | Cloudflare tunnel |
| `deploy/set_access_password.sh`, `claude_access.sh` | Outside-access password; Claude token and MCP address |
| `deploy/install_depth.sh`, `install_reels.sh` | Optional depth-face and reel packages |
| `deploy/tune_pi_storage.sh`, `migrate_data_to_card.sh` | SD card data and storage tuning |
| `deploy/alsa/`, `update_server.py`, `update-screen.html` | Surround config; update page while the server swaps |

## If you want to change X, look at Y

| Change | Look at |
| --- | --- |
| How an item is read or counted on any page | `src/services/items.ts` and `raspberry_pi/item_shape.py` (keep both in step) |
| Saving data | `src/services/api.ts` -> `db.ts` -> `syncEngine.ts` |
| Sync rules on the server | `db_server.py` `/api/sync/*`, `SYNC_TABLES` |
| Live updates between devices | `db_server.py` `/ws`, `src/services/liveStream.ts` |
| Today or Inbox contents | `src/utils/taskLists.ts`, `views/DashboardView.tsx`, `InboxView.tsx` |
| Quick-add wording | `src/utils/quickAddParser.ts` and `raspberry_pi/quick_add.py` (tests in both) |
| A notification's timing or text | `raspberry_pi/notifier.py` |
| What Herald says (Groq writes every line in an honest Alfred/Jarvis voice; templates are only the fallback) | `raspberry_pi/speaker.py`, `herald_extras.py`, `herald_journal.py` |
| A new API route | `db_server.py` or a module's `router`, then a client in `src/services/` |
| A Settings tab | `src/components/modals/SettingsModal.tsx` |
| A new view | `App.tsx`, `views/lazyViews.tsx`, `layout/Sidebar.tsx`, `MobileTabBar.tsx` |
| What the clock shows or a button does | `raspberry_pi/desk/controller.py`, `desk.py` |
| A clock setting | `desk/settings.py`, `src/components/lumo/`, firmware `ws_client.cpp` |
| Clock drawing, lights, buzzer | `lumo/esp32_client/display.cpp`, `faces.cpp`, `peripherals.cpp`, `tones.h` |
| Firmware release | bump `FW_VERSION` in `config.h`; CI builds it and `desk/ota.py` delivers it |
| Radar data sources | `raspberry_pi/radar.py` (`SAGE_RADAR_FEEDS`), `prices.py` |
| Slide or reel look | `raspberry_pi/content_engine/src/autocontent/render/`, `reel/`, `styles/` |
| What Claude can do in Sage | `raspberry_pi/claude_api.py` |
| Pi install or deploy | `deploy/install_pi.sh`, `deploy/auto_sync.sh` |
