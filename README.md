# Sage Life OS — Self-Hosted on Raspberry Pi 5 (PC & iOS)

A complete, local-first, privacy-respecting **Task, Life, and Finance Management System** designed to run on a **Raspberry Pi 5** and hosted 100% for free with zero port forwarding.

---

## 🌟 Key Features

### 1. Unified Tasks, Events, Milestones & Recurrence
- **Tasks, Events, Reminders & Milestones** in one unified temporal engine.
- **Recurring Engine**: Daily, Weekdays, Weekly on specific days (e.g. Mon, Wed), Monthly (e.g. 1st of month), and Custom day intervals.
- **Subtasks & Dependencies**: Multi-level checklists and task dependency mapping (`dependsOn`).
- **Views**: Full Kanban Board, Linear List view, and Milestones progress tracker.

### 2. Daily Performance Dashboard
- **Productivity Score (0–100%)** factoring in today's completed tasks, planned velocity, and focus minutes.
- **Today's Accomplishment Timeline**: Real-time chronological timeline recording every task completed today.
- **Focus Minutes & Streak Counter**: Continuous habit tracking and active day streaks.

### 3. Local AI Engine (100% Free & Private on Pi 5)
- Powered by **Ollama + Qwen 2.5 (1.5B/3B)** running directly on the Raspberry Pi 5.
- **Dynamic Context-Aware Greetings**: Personalized morning/afternoon/evening greetings factoring in time, temperature, remaining urgent tasks, and yesterday's productivity.
- **AI Brain Dump Capture (`Ctrl+K`)**: Translates unstructured stream-of-consciousness text or voice notes into structured tasks, deadlines, priorities, and expenses.
- **AI Auto-Fill Checklist**: Generates an actionable 4-step checklist and detailed Markdown description for any task title with one click.

### 4. Personal Finance Tracker (Multi-Account & Budgets)
- **Account Balances**: Track **Bank Account(s)**, **Cash in Hand**, and **Digital Wallets**.
- **Payment Modes**: Explicit tracking for **UPI**, **Debit Card**, **Cash**, and Net Banking.
- **Transfers**: ATM cash withdrawals or bank transfers with zero double counting.
- **Category Budgets**: Monthly spending limits (Food & Dining, Groceries, Utilities, etc.) with real-time visual progress bars and over-budget warnings.

### 5. Live Weather Integration
- Integrated with **Open-Meteo** (100% free, no API key needed, low latency) displaying temperature, weather condition, and rain forecast right on the dashboard.

### 6. Dual Platform Optimization (PC & iOS)
- **PC Desktop Experience**: Multi-pane layout, Command Palette (`Ctrl+K`), keyboard-first navigation, Kanban board, and Finance ledger.
- **iOS Mobile (iPhone/iPad)**:
  - **Standalone PWA**: Install to Home Screen from Safari; runs with zero URL bars.
  - **Apple Safe Areas**: Dynamic Island, notch, and Home indicator padding.
  - **Thumb-Zone Navigation**: Bottom tab bar and native bottom sheets (`Vaul`).
  - **Apple Shortcuts & Siri Voice Integration**:
    - *"Hey Siri, Quick Task"* -> Dictate any task naturally.
    - *"Hey Siri, Log Expense"* -> Say *"250 rupees lunch via UPI"*.
    - *"Hey Siri, Daily Status"* -> Spoken readout of today's score, remaining tasks, and bank balance.
  - **Web Push Notifications**: Lock Screen task alerts via VAPID (iOS 16.4+).

### 7. 100% Free Public Hosting & Pi 5 Resilience
- **Cloudflare Tunnel (`cloudflared`)**: Outbound-only tunnel bypassing CGNAT, automatic free SSL, and zero router port forwarding.
- **SQLite with WAL Mode**: Crash-proof against power loss with nightly encrypted cloud backups via `rclone`.

---

## 🚀 Quick Start (Local Development)

### 1. Backend (FastAPI + SQLite WAL)
```bash
cd backend
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```
Backend runs at `http://localhost:8000` (API docs at `http://localhost:8000/docs`).

### 2. Frontend (React 19 + Vite + Tailwind CSS)
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at `http://localhost:3000`.

---

## 🍓 Raspberry Pi 5 Production Deployment

1. Copy this repository to your Raspberry Pi 5:
   ```bash
   git clone <your-repo> sage-life-os
   cd sage-life-os
   ```
2. Run the automated setup script:
   ```bash
   chmod +x deploy/setup_pi.sh
   ./deploy/setup_pi.sh
   ```
3. Follow `CLOUDFLARE_TUNNEL_GUIDE.md` to connect your free Cloudflare tunnel and access your system from anywhere on your iPhone or PC!

---

## 🔑 The access key

Sage is reachable from the public internet through the tunnel, and one shared
token is what stands between that and your data. There is no default: the app
asks for the key once per browser and keeps it there.

Set one on the Pi, in a file the repository never sees:

```bash
sudo install -d -m 700 /etc/sage
printf 'API_SECRET=%s\n' "$(python3 -c 'import secrets; print(secrets.token_hex(24))')" \
  | sudo tee /etc/sage/sage.env > /dev/null
sudo chmod 600 /etc/sage/sage.env
sudo systemctl restart sage-backend
```

Then open Sage, paste the key into the screen it shows you, and that device is
connected. To change it later, or to sign a device out, use **Settings →
Connection → Forget key**.

If you skip this, the backend generates a random key on first boot and prints
where it saved it (`data/api_secret.txt`); the app will not talk to the Pi
until you paste that in.

**Siri Shortcuts** send the same key as a `Bearer` token in the `Authorization`
header. Any shortcut built before this change needs its header updated, since
the old shared constant is no longer accepted.

---

## Running the checks

```bash
cd backend && python -m pytest tests -q     # backend
cd frontend && npx tsc --noEmit && npm test  # frontend
cd frontend && npm run build                 # rebuild the committed bundle
```

`frontend/dist` is committed and nginx serves it straight from the checkout, so
any change to `frontend/src` needs `npm run build` committed alongside it. CI
rebuilds and fails if the two disagree.
