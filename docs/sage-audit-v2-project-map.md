# Sage — Audit v2 & Project Map Feature Spec

## 1. Audit of the updated spec

### Fixed since v1
| Issue | Status | Notes |
|---|---|---|
| No notification system | ✅ Fixed | Native desktop notifications, 30s poll, missed-reminder escalation into Needs Attention |
| No onboarding | ✅ Fixed | 60s guided capture + live Quick Clarify |
| No undo | ✅ Fixed | 8s toast, rolls back local + in-flight sync op |
| Blocked/Waiting-For overlap | ✅ Fixed | Kanban "Blocked" now auto-populates Waiting-For |
| No calendar interoperability | ✅ Fixed | RFC 5545 `.ics` export |
| No migration path | ✅ Fixed | CSV importer for Todoist/Notion/Google Tasks |
| Manual time-estimate friction | ✅ Fixed | Quick Wins now auto-infers duration from keywords |
| Smart Resurfacing not configurable | ✅ Fixed | 7/14/21/30-day sensitivity |
| No factory reset / data control | ✅ New | `CLEAR`-safeguarded wipe |

### Still open
1. **Google Sheets backend ceiling.** Since this is single-user, single-device usage, the lock-contention concern doesn't apply — a solo device is never fighting itself for the 15s `LockService` lock. The remaining relevant limit is the ~10M cell hard limit and Apps Script's daily quota caps, both of which are years away at personal-task-list volume. **No fix needed now** — just worth knowing the ceiling exists if the item count ever grows into the tens of thousands (subtasks, comments, and activity-log rows count toward the cell total too, so that's the one to watch, not raw task count).
2. **Account/auth model — lower priority than previously framed.** With one user on one device, cross-device identity and multi-user access control aren't live concerns. The one thing still worth having is a lightweight secret (e.g., a token in the Apps Script URL or a simple key check) so the endpoint isn't fully open to anyone who finds the URL — a minor hardening step, not an architectural gap.
3. **No visible unsynced-item indicator** outside the diagnostics modal — still a trust gap if a device is offline for a while.
4. **No recurring task engine** (distinct from habits) — "pay rent on the 1st," "team sync every Monday."
5. **No conflict-resolution UI** for the user-facing side of `applied/conflict/rejected` — currently invisible to the user.
6. **No accessibility spec** — screen reader, focus management, contrast, full keyboard-only flow.

### New risk introduced by this update
**"Continuous queue drain loop without idle waiting."** Dispatching queued operations back-to-back with no idle interval between *successful* operations (as opposed to backoff after *failures*, which is still fine) means:
- Constant network activity — bad for mobile battery and data usage.
- Higher chance of tripping Apps Script's per-day execution/URL-fetch quotas under normal use, not just under load.

**Fix:** Batch-drain in small windows (e.g., collect operations for 2–3 seconds, or up to N operations, then send as one batch) rather than firing each queued mutation immediately and sequentially. Reserve true exponential backoff for actual failures.

---

## 2. Project Map (gap finder) — full spec

### Purpose
Answer a question Sage doesn't currently answer: *"Is anything missing from this project's plan?"* Turns the task list into a lightweight dependency graph and surfaces structural gaps without requiring the user to maintain the graph manually.

### Data model
```ts
// Addition to workItems
interface WorkItem {
  // ...existing fields
  dependsOn?: string[];   // IDs of items this depends on
}

// Addition to projects
interface Project {
  // ...existing fields
  flowLayout?: {
    [nodeId: string]: { x: number; y: number };
  };
}
```
- `dependsOn` drives both the graph edges and the gap-detection heuristics.
- `flowLayout` is purely cosmetic (node position) — safe under plain field-level LWW, no OCC needed, since simultaneous repositioning by two devices is low-stakes and rare.

### Gap detection rules (all advisory, all dismissible, never blocking)
1. **Orphan node** — a task/subtask with zero incoming and zero outgoing `dependsOn` links inside a project where ≥70% of other items *are* connected. (Below that connectivity threshold, don't flag — the project just isn't using the map yet.)
2. **Dead-end milestone** — a milestone within 7 days of its due date with no completed or in-progress task in its dependency chain.
3. **Unbroken long chain** — 6+ sequentially dependent tasks with no milestone/checkpoint between them. Suggestion only: "Consider adding a checkpoint here."
4. **Stale blocker** — a Blocked-column item whose linked Waiting-For entry has had no response for more than 2x that person's historical average response time (falls back to 7 days if no history).

Each flag renders as a dismissible banner + highlighted node, never a hard stop. Dismissing a specific flag suppresses it for that node until the node's dependencies change.

### Interaction model — desktop
- Click-drag from a node's edge to another node to create a `dependsOn` link.
- Click a node to open its full item detail in a side panel (no navigation away from the map).
- Auto-layout on first load (simple top-to-bottom or left-to-right topological sort); manual repositioning persists via `flowLayout`.

### Interaction model — mobile (critical, not an afterthought)
Do **not** ship a shrunk version of the desktop canvas. Node-graphs are a poor fit for touch:
- Default to an **outline view**: same nodes and edges, rendered as an indented, ordered list with status icons (mirrors the mockup shown above).
- "Connect to…" becomes a menu action (tap node → "Link to" → search/select target) instead of a drag gesture.
- Gap flags render as inline list rows with a warning icon, tappable to see the reason and dismiss.
- A single toggle switches between graph and outline on tablet/larger screens where the graph is still usable; on phone-width viewports, default to outline and hide the graph toggle entirely rather than offering a broken experience.

### Where it fits in the cognitive loop
This is a **Surface**-stage feature — it doesn't ask the user to organize more (no mandatory dependency-mapping at capture time). It's opt-in per project, and gap flags only ever *suggest*, consistent with "Sage suggests; you decide."

---

## 3. Updated fix priority order

1. Batch the sync drain loop (mobile battery/quota fix)
2. Ship Project Map with mobile-first outline view
3. Visible unsynced-item indicator
4. Recurring tasks
5. Conflict-resolution UI, accessibility pass
6. Optional: lightweight endpoint secret for the Apps Script URL
7. Keep an eye on the Sheets cell-count ceiling as data grows (no action needed yet)
