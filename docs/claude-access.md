# Claude's access to Sage

Claude can read and change the live Sage data on the Pi, and open the real web
app to check a change, with a token of its own. The token is not `API_SECRET`:
it reaches the synced data (tasks, projects, areas, goals, habits, notes,
comments, subtasks, boards) and the web app's files, and nothing else. Settings,
saved passwords, email, Bluetooth, the phone link, backups and clear-all still
need the owner's key or the password.

Every change Claude makes goes through the same sync path as a device, tagged
`claude`, so an open copy of Sage updates straight away and
`/api/claude/history` lists what Claude changed. A deleted record keeps its last
copy on the Pi.

## Turn it on (on the Pi)

```bash
git pull
sudo deploy/claude_access.sh          # prints the token, the MCP address and the env vars
sudo deploy/claude_access.sh --off    # take it away again
```

Running it again makes a new token and cuts off the old one. Sage needs a
public address first (`deploy/setup_tunnel.sh`). A named tunnel on your own
domain keeps the same address; a free `trycloudflare.com` one changes after
each restart, so Claude's settings would need the new address each time.

Then give Claude the token one of two ways (both is fine):

- **As a connector** (works in every Claude chat and project thread, nothing to
  allow on the network): Claude settings > Connectors > Add custom connector,
  with the `https://<sage>/mcp/<token>` address the script printed. Claude gets
  tools named `sage_overview`, `sage_list`, `sage_get`, `sage_create`,
  `sage_update`, `sage_delete`, `sage_quick_add` and `sage_history`.
- **In a Claude Code cloud environment** (lets a thread use plain HTTP and open
  the app in a browser): add the environment variables `SAGE_URL` and
  `SAGE_CLAUDE_TOKEN`, and add Sage's hostname under Allowed domains in the
  environment's network access.

The token never goes in this repo or in a chat message.

## HTTP API

All routes take `Authorization: Bearer $SAGE_CLAUDE_TOKEN` and answer JSON with
`success`. Tables: `workItems`, `projects`, `areas`, `goals`, `habits`, `notes`,
`comments`, `subtasks`, `activities`, `boards` (field shapes are in
`src/services/types.ts`).

| Route | What it does |
| --- | --- |
| `GET /api/claude/overview` | Today's date, counts, open items due today or overdue, focus, inbox, projects |
| `GET /api/claude/{table}?q=&status=&due_by=&limit=` | Records, newest first; long values shortened |
| `GET /api/claude/{table}/{id}` | One full record (notes add `bodyHtml`, boards `sceneJson`) |
| `POST /api/claude/{table}` | Create; body is the fields. Work items need a `title` |
| `PATCH /api/claude/{table}/{id}` | Change the fields sent, keep the rest |
| `DELETE /api/claude/{table}/{id}` | Delete |
| `POST /api/claude/quick-add` | `{"text": "Call the bank tomorrow 5pm !high"}`, parsed like Siri quick add |
| `GET /api/claude/history` | What Claude changed, newest first |

```bash
H="Authorization: Bearer $SAGE_CLAUDE_TOKEN"
curl -s "$SAGE_URL/api/claude/overview" -H "$H"
curl -s "$SAGE_URL/api/claude/workItems?status=todo,in_progress&q=bank" -H "$H"
curl -s -X PATCH "$SAGE_URL/api/claude/workItems/ID" -H "$H" -H 'Content-Type: application/json' -d '{"status":"done"}'
```

A `409` means the change wasn't applied (the record was deleted on a device,
or a device saved a newer copy); read it again and retry.

## Open the real app

The token also lets a browser load the web app and its sync calls past the
password page, so a thread can look at Sage as it is now:

```js
// node look.mjs  (Playwright is installed globally in Claude's cloud container)
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PW);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 860 },
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.SAGE_CLAUDE_TOKEN}` },
});
await page.goto(process.env.SAGE_URL, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'sage.png' });
await browser.close();
```

Run it with `PW=$(npm root -g)/playwright node look.mjs`. Panels that need
the owner's key (the phone link, Bluetooth, settings) stay empty in that view.
