# Sage Life OS — Complete Master System Summary & Architecture Guide
**Current Version:** `v2.7.0` (Microsoft Whiteboard Canvas & Pro Task Manager)  
**Deployment Target:** Raspberry Pi 5 Home Server (`http://192.168.0.149/`)  
**Stack:** FastAPI (Python 3.13) + SQLite + WebSockets + React 18 + TypeScript + Vite + TailwindCSS + Canvas 2D + Framer Motion + Vitest

---

## Executive Summary

**Sage Life OS** is an offline-first, private personal operating system designed to eliminate digital fatigue and replace fragmented subscription tools (Things 3, Todoist, Notion, Splitwise, Apple Reminders) with a unified, high-craft platform hosted on a local Raspberry Pi 5.

Over several evolutionary milestones, the system has grown from a core task manager into an **integrated life management operating system** encompassing:
1. **Core Productivity Engine** (Tasks, Events, Reminders, Kanban, and Daily Timeline Time-Blocking).
2. **Projects & Milestones Hub** (Multi-week initiatives, linked deliverables, and progress tracking).
3. **Personal Finance Hub** (Bank/Cash accounts, UPI unifier, category budget guardrails, recurring bills).
4. **AI Assistants & Natural Language Engines** (Local 0ms NLP parser, AI Brain Dump, AI Task Polish, Executive Board Organizer, and Weather Greeting).
5. **Behavioral Psychology Loop** (Morning Kickoff, Evening Debrief with guilt-free task migration, and "All Clear" celebration micro-interactions).
6. **Native iOS & Touch Experience** (Physics-based swipe gestures, safe haptics, pull-to-refresh, virtual keyboard viewport handling, and Siri Shortcuts).
7. **Trust, Safety & Resilience** (Universal `<ConfirmDialog>`, 30-action Undo/Redo history stack, optimistic UI updates with auto-rollback, and error retry toasts).
8. **Power User Tooling** (Global `Cmd/Ctrl+K` Command Palette, Vim-style `j`/`k` navigation, and floating bulk action bar).

---

## 1. System Architecture & Tech Stack

```mermaid
graph TD
    subgraph Client Layer [Frontend PWA / iOS Touch / Desktop]
        A1[React 18 + TypeScript + TailwindCSS]
        A2[Framer Motion Drag Gestures & Animations]
        A3[0ms Local NLP Parser quickAddParser.ts]
        A4[Global Search & Command Palette Cmd+K]
        A5[Optimistic State Management & History Stack]
    end

    subgraph Transport Layer
        B1[HTTP REST Client fetchJson with Retries]
        B2[WebSocket Real-Time Live Sync useLiveSync]
    end

    subgraph Server Layer [Raspberry Pi 5 @ 192.168.0.149]
        C1[FastAPI Application Python 3.13]
        C2[SQLite Database with WAL Mode & Auto-Migrations]
        C3[Local / Cloud AI LLM Router Qwen / Claude / OpenAI]
        C4[Open-Meteo Direct Weather Engine]
    end

    Client Layer --> Transport Layer
    Transport Layer --> Server Layer
```

### Key Technical Characteristics
- **Zero Cloud Lock-in**: All personal data, finances, tasks, and reflections live locally in SQLite on your Raspberry Pi 5.
- **Optimistic UI (0ms Instant Feel)**: User interactions (toggling tasks, reordering Kanban cards, rescheduling) apply instantly to React state. Network synchronization runs asynchronously in the background with auto-rollback if persistent errors occur.
- **Bi-Directional Live Sync**: WebSockets broadcast updates between devices (phone, laptop, desktop) with debounced reconciliation so background sync never causes layout jitter.
- **Strict Backward Compatibility**: Database schema updates are written to run safely without breaking existing records.

---

## 2. Core Feature Pillars

### Pillar 1: Advanced Tasks, Events & Reminders
* **Unified WorkItem Model**: Supports `task`, `event`, and `reminder` entities with `priority` (Urgent, High, Medium, Low), `energy` level, estimated vs. actual minutes, and GTD context tags (`@errands`, `@computer`, `@phone`, `@home`, `@deep-work`).
* **Recurrence Engine**: Automated recurring tasks (`daily`, `weekdays`, `weekly:mon`, `monthly:1`) that auto-advance upon completion.
* **Task Dependency Graph**: Tasks can declare dependencies (`depends_on`). Blocked tasks display lock icons with blocker tooltips and automatically unlock once predecessors are completed.
* **Three Dynamic View Modes**:
  1. **Smart List View**: Features Things 3-style **Smart Date Grouping**:
     - 🔴 **Overdue**: Immediate visual urgency with collapsible count badge.
     - ☀️ **Today**: Focal tasks for the current day.
     - 📅 **Upcoming**: Lookahead for the next 7 days.
     - 📥 **No Date / Backlog**: Low-pressure holding tank.
  2. **Kanban Board**: 4 status columns (`To Do`, `In Progress`, `Blocked`, `Completed`) with **HTML5 drag-and-drop** cards and column drop targets.
  3. **Daily Timeline Calendar**: 6 AM – 11 PM hourly interactive grid. Users can drag tasks into open time-blocks or 1-tap schedule directly into open slots.

---

### Pillar 2: Projects & Milestones Hub
* **Hierarchical Organization**: Break large initiatives into Projects (e.g. *"Pi Home Lab Setup"*, *"Half Marathon Prep"*, *"Q4 Tax Planning"*).
* **Visual Identities**: Custom hex color identities, total task counters, completed task counters, and real-time completion percentage bars.
* **Milestone Tracking**: Project milestones with target due dates, status badges (`pending`, `achieved`, `delayed`), and auto-computed task completion progress.
* **Direct Task Assignment**: Tasks can be created and linked directly to projects and milestones from any view.

---

### Pillar 3: Personal Finance Hub & UPI Unifier
* **Multi-Account Tracking**: Bank accounts, Cash, Digital Wallets, and Credit cards with net worth auto-calculation.
* **Unified UPI Architecture**:
  - Solve the common Indian banking dilemma: bank balance vs. digital wallet.
  - Option to **Unify UPI directly with Bank Account** (treating UPI as direct bank debits) or **Split into a distinct Digital Wallet**.
* **Transactions Ledger**: Log expenses, income, and transfers with payment mode tags (`upi`, `debit_card`, `cash`, `credit_card`, `net_banking`).
* **Budget Guardrails**: Monthly category budgets with live visual spending bars and dynamic status chips (`OK`, `Warning`, `Danger`, `Exceeded`).
* **Recurring Bills & Subscriptions**: Track monthly utilities, subscriptions, and recurring payments with overdue detection and days-until-due countdowns.

---

### Pillar 4: AI Intelligence & Natural Language Engines
* **0ms Local Natural-Language Quick Add (`QuickAddBar`)**:
  - Deterministic client-side regex/NLP parser running in **0ms** (zero network wait).
  - Detects date/time (`tomorrow 5pm`), priority (`!urgent` / `p1`), project fuzzy matching (`#work`), context tags (`@phone`), and time estimates (`~30m`).
  - Renders live interactive token preview pills as you type; pressing `Enter` creates the task instantly.
* **AI Brain Dump Quick Capture (`BrainDumpModal`)**:
  - Multi-line unstructured dump modal (`Cmd/Ctrl+B`) sending messy paragraphs to the Raspberry Pi LLM to extract multiple structured tasks, due dates, and categories.
* **AI Polish & Auto-Fill**:
  - Refines cryptic task titles into crisp action items.
  - Automatically generates recommended 3–5 step subtask checklists and duration estimates.
* **Executive Board Organizer**:
  - AI analysis of the board state: generates an executive workload synthesis, surfaces the Top 3 High-Leverage Big Rocks, and proposes title improvements with 1-click "Apply All".
* **Contextual Weather & Greeting**:
  - Real-time weather integration (temperature, condition, rain probability, wind speed) paired with intelligent, context-aware morning/afternoon/evening greetings.

---

### Pillar 5: Behavioral Psychology & Habit Formation
* **Morning Kickoff Wizard (7:30 AM – 9:30 AM)**:
  - 60-second morning ritual: check weather forecast, review today's schedule, and commit to your **Top 3 Strategic Big Rocks**.
* **Evening Debrief Wizard (8:30 PM – 10:30 PM)**:
  - Closes the mental loop before sleep: celebrate today's completed wins, **auto-migrate undone tasks to tomorrow with zero guilt**, and log a 1-line daily reflection and mood.
* **"All Clear" Celebration Micro-Interaction (`CelebrationModal`)**:
  - Completing the final task of Today triggers a celebratory ripple animation, festive haptic sequence, and an *"All clear for today! ☕"* banner with an active streak counter.

---

### Pillar 6: iOS / Touch Native Ergonomics
* **`<ListRow>` Physics-Based Swipe Gestures**:
  - Built with `framer-motion` (`drag="x"`, `dragElastic={0.4}`):
    - **Swipe Right**: Reveals emerald background with `<Check>` icon; marks complete with `haptics.medium()`.
    - **Swipe Left**: Reveals rose background with `<Trash2>` icon; initiates delete with `haptics.warning()`.
* **Tap Target Audit**: Every button, tab, and icon adheres to the ≥44×44pt touch standard.
* **iOS Virtual Keyboard Viewport Adaptation (`useVisualViewport`)**:
  - Subscribes to `window.visualViewport.resize` to calculate virtual keyboard height.
  - Dynamically updates `--keyboard-offset` so bottom sheets, modals, and floating action bars smoothly translate above the software keyboard.
* **Pull-to-Refresh (`PullToRefresh`)**: Native touch pull-down gesture at scroll offset 0 with rotating spinner and haptic release.
* **1-Tap Quick Reschedule Popover (`ReschedulePopover`)**: 1-tap due date shifting (`Today`, `Tomorrow`, `This Weekend`, `Next Week`, `Clear Date`).
* **iOS Siri Shortcuts Hub**: Pre-configured Siri shortcut triggers for quick voice capture directly from iPhone/Apple Watch.

---

### Pillar 7: Trust, Safety & Design System Primitives
* **Universal `<ConfirmDialog>`**: Replaced native browser `window.confirm` with accessible, keyboard-trapped (`Escape`/`Enter`) confirmation dialogs.
* **Global 30-Action History Stack (Undo/Redo)**:
  - Full Undo/Redo across: Task creation, completion toggle, deletion, Milestone CRUD, Project CRUD, Account CRUD, and Transaction CRUD.
  - Floating action notification with 1-click `[Undo]` button and auto-dismiss.
* **Error Retry Toasts (`errorWithRetry`)**: User-facing toasts for network/AI failures with 1-click `[Retry]` buttons instead of silent console errors.
* **Shimmering `<Skeleton>` Loaders**: Differentiates between initial load and true empty states across all views, eliminating empty-state flashing.
* **Reusable Modal Shell (`<Modal>`)**: Bottom sheet on mobile, centered dialog on desktop, with focus management and **unsaved changes discard protection**.

---

### Pillar 8: Power User Workflows
* **Global Command & Search Palette (`<SearchModal>` on `Cmd/Ctrl+K`)**: Fast instant search across all Tasks, Projects, Financial accounts/transactions, and Quick Navigation Actions.
* **Desktop & iPad Keyboard Shortcuts (`useKeyboardShortcuts`)**:
  - `j` / `k` (or `↓` / `↑`): Move row selection up and down.
  - `Space` or `x`: Toggle highlighted task completed.
  - `e`: Open item details drawer.
  - `d` or `Backspace`: Delete item.
  - `t`: Reschedule to Today; `m`: Reschedule to Tomorrow.
* **Multi-Select & Floating Bulk Actions Bar (`<BulkActionBar>`)**: Select multiple tasks to perform batch operations (Mark Complete, Set Priority, Set Due Date, Delete).

---

## 3. Comprehensive Verification & Test Summary

| Test Category | Suite / Runner | Results | Status |
| :--- | :--- | :--- | :--- |
| **Frontend Unit & Component Tests** | `vitest run` (6 test files) | **21 passed / 21 tests** (9.55s) | 🟢 **100% Passing** |
| • Haptic Fallbacks | `haptics.test.ts` | 2 passed | 🟢 Pass |
| • Smart Date Grouping | `dateHelpers.test.ts` | 5 passed | 🟢 Pass |
| • Natural Language Parser | `quickAddParser.test.ts` | 7 passed | 🟢 Pass |
| • Persisted LocalStorage Hook | `usePersistedState.test.ts` | 2 passed | 🟢 Pass |
| • Modal Accessibility & Traps | `Modal.test.tsx` | 3 passed | 🟢 Pass |
| • Floating Bulk Action Bar | `BulkActionBar.test.tsx` | 2 passed | 🟢 Pass |
| **TypeScript Compilation** | `npx tsc --noEmit` | **0 errors** | 🟢 **100% Clean** |
| **Vite Production Bundler** | `npm run build` | **Built in 7.06s** (`dist/`) | 🟢 **Production Ready** |
| **Backend Regression Suite** | `python -m unittest tests.test_runner` | **8 passed / 8 tests** (3.81s) | 🟢 **100% Passing** |

---

## 4. File Structure & Codebase Map

```text
vibrant-hubble/
├── backend/
│   ├── app/
│   │   ├── api/routes/          # FastAPI REST endpoints (tasks, finance, projects, AI, planner)
│   │   ├── routers/             # Specialized routers: whiteboards.py
│   │   ├── database.py          # SQLite database connection & schema tables (including whiteboards)
│   │   ├── models/              # Pydantic schemas and database models (WhiteboardCreate, Response, etc.)
│   │   └── services/            # Recurrence, weather, AI router, finance business logic
│   └── tests/
│       └── test_runner.py       # Backend regression and unit test suite (9 tests passing)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/          # Shared Primitives: ListRow, Modal, Button, Badge, Skeleton, Toast, ConfirmDialog, PullToRefresh, CelebrationModal
│   │   │   ├── dashboard/       # DashboardView (stats, weather greeting, today tasks, timeline)
│   │   │   ├── finance/         # FinanceView (accounts, transactions, budgets, recurring bills)
│   │   │   ├── layout/          # Consolidated Navbar (with Whiteboard tab), BrainDumpModal
│   │   │   ├── planner/         # MorningEveningWizard (kickoff, debrief)
│   │   │   ├── projects/        # ProjectsHub (projects, milestones, linked tasks, 1-click whiteboard launcher)
│   │   │   ├── search/          # SearchModal (Cmd+K global command palette)
│   │   │   ├── shortcuts/       # ShortcutsModal (iOS Siri configuration hub)
│   │   │   ├── tasks/           # TasksView, TimeBlockingCalendar, QuickAddBar, BulkActionBar, ReschedulePopover
│   │   │   └── whiteboard/      # WhiteboardView, WhiteboardCanvas (Canvas 2D vector engine), WhiteboardToolbar, WhiteboardHeader, StickyNoteOverlay
│   │   ├── context/             # ToastContext (unified error, retry, action toasts)
│   │   ├── hooks/               # usePersistedState, useVisualViewport, useKeyboardShortcuts
│   │   ├── services/            # api.ts (HTTP client with Whiteboards CRUD), websocket.ts (real-time live sync)
│   │   ├── utils/               # quickAddParser.ts, dateHelpers.ts, haptics.ts
│   │   ├── types/               # TypeScript interfaces (WorkItem, Project, Whiteboard, StickyElement, etc.)
│   │   ├── App.tsx              # Root application container, optimistic sync, history stack, whiteboard routing
│   │   └── version.ts           # App versioning (v2.7.0)
│   ├── dist/                    # Compiled production build assets
│   ├── package.json             # React, Vite, Framer Motion, Vitest, Tailwind dependencies
│   └── vite.config.ts           # Vite and Vitest configuration
└── README.md
```


---

## 5. Summary of Releases

* **v1.0.0 – v2.0.0**: Initial system architecture, FastAPI backend on Raspberry Pi 5, basic tasks, Kanban, daily performance scoring, and initial SQLite schemas.
* **v2.1.0 – v2.3.0**: Added Morning Kickoff & Evening Debrief wizards, Daily Timeline calendar (6 AM–11 PM), Projects & Milestones Hub, Finance Tracker, and iOS Siri Shortcuts.
* **v2.4.0**: Added UPI Unification engine (unify with bank account or split as digital wallet), budget guardrails, and recurring bills.
* **v2.5.0**: UX Design System & Safety Release — Universal `<ConfirmDialog>`, global 30-action Undo/Redo everywhere, `<ToastProvider>`, loading `<Skeleton>` placeholders, accessible `<Modal>`, and WCAG zoom accessibility.
* **v2.6.0**: **Pro Task Manager & iOS Touch Overhaul** — Physics-based swipe gestures (`<ListRow>`), 0ms local natural-language quick add (`<QuickAddBar>`), global Command Palette (`<SearchModal>` on `Cmd+K`), Things 3 Smart Date Grouping, 1-tap reschedule popover, floating multi-select `<BulkActionBar>`, desktop `j`/`k` shortcuts, Kanban drag-and-drop, "All Clear" celebration micro-reward, and full Vitest test harness.
* **v2.7.0**: **Microsoft Whiteboard Vector Canvas & Sticky Notes Engine** — Infinite zoomable dotted grid canvas, sub-pixel quadratic Bezier curve inking with pressure sensitivity, signature bottom floating pill toolbar, translucent chisel highlighter, stroke eraser, pastel sticky notes with 1-click "⚡ Convert to Task" directly into Sage OS, multi-board SQLite persistence on Raspberry Pi, project linking, and PNG/SVG export.
