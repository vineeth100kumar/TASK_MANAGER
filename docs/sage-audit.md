# Sage — Product & Architecture Audit
### What's missing, what's fragile, and how to fix it

Sage's *cognitive loop* framing and local-first sync engine are genuinely solid. The gaps aren't in ambition — they're in the last-mile details that make a tool feel trustworthy, calm, and actually zero-friction. Below is a prioritized breakdown.

---

## 🔴 Critical Gaps (block real-world usability)

### 1. There is no notification system
The entire product promises to "surface what matters," but nothing in the spec says how a reminder actually reaches the user outside the app. If Sage isn't open, a 4pm reminder is invisible.

**Fix:**
- Web Push API for browser/PWA notifications (works even when tab is closed, service-worker based).
- Optional daily digest email (morning brief) sent via Apps Script `MailApp`, since the backend already lives in Google's ecosystem.
- A lightweight local notification permission-request flow during onboarding — explain *why* before asking, don't just fire the browser permission prompt cold.
- Define escalation: if a time-bound reminder is missed, does it silently move to "Needs Attention" the next day, or badge the app icon? Right now this is undefined.

### 2. No onboarding / empty-state design
The spec jumps straight to a fully-populated system. First-run experience is undefined:
- What does a brand-new Inbox look like?
- Is there a guided "capture your first 5 things" flow?
- How does a user learn `C` is the capture hotkey without reading docs?

**Fix:** A 60-second onboarding: (1) one prompt to capture 3 open loops, (2) auto-run Quick Clarify on them live so the user *learns by doing*, (3) a persistent but dismissible hint chip ("Press `C` anytime") instead of a modal tutorial.

### 3. Google Sheets as the system of record is a scaling and reliability risk
This is the biggest architectural blind spot:
- Apps Script execution has a **6-minute per-execution limit** and daily quota caps — under real multi-device, multi-day usage this will eventually throttle or fail sync.
- `LockService` gives a **single global 15-second write lock** — this serializes *all* writes across *all* entities for *all* devices. As the workItems store grows (thousands of rows), Sheets read/write latency degrades noticeably, and this lock will become a real bottleneck, not a theoretical one.
- Sheets has a hard **10 million cell** limit per spreadsheet. A power user with years of tasks, subtasks, activities, and comments will hit this.
- No mention of what the user sees when the backend silently fails a sync for hours (quota exhaustion, transient Apps Script cold-start delays of 1-3s per call, etc.) beyond a buried diagnostics modal.

**Fix:** Either (a) explicitly scope Sheets as a v1 "good enough for single user, thousands of items" backend with a documented migration path to a real database (Firestore/Postgres) before scaling, or (b) shard by entity type across multiple sheets/spreadsheets to reduce lock contention. Either way, this constraint needs to be *stated*, not discovered by users.

### 4. No account/auth model
`clientId` is described as a **device ID**, not a user ID. That means:
- How does a second device (phone) know it belongs to the same "user" as the laptop?
- What stops any script with the Apps Script URL from writing to the sheet?
- Is there OAuth against the user's Google account, or is the deployment URL itself the only security boundary?

**Fix:** Tie sync to Google OAuth (the user already needs a Google account for Sheets). Use the authenticated user's email as the partition key server-side, not just a locally-generated `clientId`. Document the security model explicitly — right now anyone with the Apps Script web-app URL could potentially read/write the sheet.

### 5. Silent data-loss window
If a user makes offline changes and then clears browser storage / loses the device before the sync queue flushes, those mutations are gone — there's no server-side pending buffer, only local IndexedDB. For a tool explicitly positioned as an "executive operating system" holding commitments, this is a serious trust risk.

**Fix:** Surface unsynced-item count persistently in the UI (not just in a diagnostics modal), and warn before any action that could destroy local data (clear cache, uninstall PWA, "reset app").

---

## 🟠 High-Priority UX Gaps (undermine the "zero friction" promise)

### 6. Time estimates and quick-win tagging require manual entry
"Quick Wins (≤15 min)" is a great feature, but nothing says how a task gets that label. If it's a mandatory field at capture time, that *directly contradicts* the "zero mandatory fields" capture philosophy.

**Fix:** Make time estimate optional and inferable — let Sage suggest a bucket based on task title patterns ("email," "call," "reply" → short) and let the user confirm with one tap during Quick Clarify, never at capture.

### 7. Undo is completely absent
1-click completion, 1-click dismiss, 1-click "Got Reply" — all great for speed, terrible without a safety net. Fat-fingering "Complete" on the wrong card with no undo will erode trust fast.

**Fix:** Universal toast-based undo (5–8 second window) on every destructive or state-changing 1-click action, consistent with how Gmail/Trello handle this.

### 8. "Needs Attention" and "Smart Resurfacing" have no visible logic or user control
Two different systems decide what to nag the user about (overdue/multi-snoozed items, and >14-day-stale items), but:
- The 14-day threshold is hardcoded, not configurable.
- There's no explanation of *why* an item is surfaced, which undermines the "Sage suggests, you decide" framing — a suggestion without a visible reason feels like a demand.

**Fix:** Show the reason inline ("Snoozed 3 times," "Untouched 16 days") and let users tune sensitivity in settings (e.g., "resurface after: 7 / 14 / 30 days / never").

### 9. No relationship defined between Project, Area, Goal, and the Kanban "Blocked" column vs. "Waiting For"
These are overlapping concepts with no stated hierarchy:
- Can a Project belong to a Goal? Can an Area contain Projects?
- Is "Blocked" on the Kanban board the same thing as an item in the "Waiting For" tracker, or two disconnected states a user has to update separately?

**Fix:** Define a clear hierarchy (e.g., `Area → Project → WorkItem`, `Goal` as a cross-cutting link rather than a container), and merge "Blocked" and "Waiting For" into one concept — a blocked card should auto-populate a Waiting-For entry, not require double bookkeeping.

### 10. No recurring task engine described
Habits have a streak matrix, but there's no mention of recurring *tasks* ("pay rent on the 1st," "team sync every Monday"). This is a core life/executive-management need that's simply absent from the spec.

**Fix:** Add a recurrence rule (RRULE-style) to workItems, with completion spawning the next instance rather than requiring re-capture.

### 11. No calendar interoperability
A "Monthly Calendar" view exists, but there's no ICS export/import or Google Calendar sync. Most people already live in one calendar; a second, disconnected calendar view creates more mental load, not less — directly against the core philosophy.

**Fix:** At minimum, one-way ICS export/subscribe feed so external calendars can display Sage's scheduled items. Two-way Google Calendar sync is the stronger long-term fix given the Google-native backend.

---

## 🟡 Medium-Priority Gaps

### 12. Accessibility is unaddressed
No mention of screen-reader support, focus management in modals/drawers, color-contrast for status flags/priority colors, or keyboard-only completion of the full workflow (capture → clarify → complete). For a keyboard-shortcut-forward product, this is a notable omission.

### 13. No data portability beyond raw JSON backup
CSV/ICS export would let users leave or integrate with other tools without lock-in — important for trust in a personal-data product.

### 14. No conflict-resolution UI
The backend returns `applied / conflict / rejected` per operation, but nothing describes what the *user* sees when a conflict happens. Silently dropping a "rejected" write is a data-loss risk in disguise.

**Fix:** A lightweight "this changed elsewhere" toast with a one-tap "keep mine / keep theirs" resolution for conflicted items.

### 15. Goal progress is manual-only
Progress sliders aren't linked to underlying task/subtask completion. This is busywork that fights the "reduce mental load" premise — goal progress should be able to auto-derive from linked task completion percentage, with manual override available.

### 16. No theming / dark mode mentioned
Minor, but expected table-stakes for a daily-use productivity tool.

### 17. No migration path from existing tools
Todoist/Things/Notion/Google Tasks import would meaningfully lower adoption friction — currently the spec assumes users start from zero.

---

## ✅ What's Actually Well-Designed (keep these)

- The **local-first + durable sync queue + exponential backoff** pattern is genuinely robust engineering for an indie/solo-scale tool.
- **Multi-tab leader election** via `BroadcastChannel` is a thoughtful detail most task apps skip entirely.
- **Zero-timezone date normalization** solving the classic off-by-one bug shows real attention to a notoriously annoying class of issues.
- The **5-step cognitive loop** (Capture → Organize → Surface → Execute → Remember) is a strong, coherent mental model — the rest of the product should be audited against whether every feature clearly serves one of these five stages. Right now a few features (goal sliders, blocked columns) don't cleanly map to any step, which is a sign they need tighter integration.

---

## Suggested Fix Priority Order

1. Define the account/auth model and document the Sheets backend's real limits (security + trust foundation).
2. Ship a real notification system (push + digest) — without this, "reminders" don't function as reminders.
3. Add undo + surface unsynced-item count — baseline trust mechanics.
4. Design onboarding and empty states.
5. Resolve the Project/Area/Goal/Blocked/Waiting-For conceptual overlap.
6. Add recurring tasks and calendar interoperability.
7. Everything else (theming, import, accessibility polish) as ongoing refinement.

The core bones are good — this is a "tighten the last mile" problem, not a "rethink the architecture" problem, with the one real exception being the Google Sheets backend's ceiling, which is worth stating honestly rather than discovering under load.
