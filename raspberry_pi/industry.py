"""
Radar industry search: type an industry ("3D printing"), get a full brief.

The search box at the top of Radar starts a brief on the Pi. Each one runs
three steps, each with a time limit:

  1. Read Radar      - Radar's own headlines that name the industry, and the
                       Markets board industry or sector closest to it (no AI)
  2. Search the web  - fixed searches (overview, market size, top companies,
                       trends, India when India is on, latest news), through
                       the same DuckDuckGo / Google News path as Studio; the
                       best few pages are read
  3. Write the brief - one AI call (Groq first, like Studio and Lab) turns the
                       numbered sources into: what it is, how money is made,
                       market size and growth, segments, value chain, key
                       companies with tickers, trends, risks, openings for a
                       small founder, the India angle and the fit with My edge

Numbers the AI gives are estimates and cite a source number, so the app can
link them. When the AI fails, the brief still keeps the news and the Markets
match, with the reason it stopped.

Briefs live in a Pi-only table: they can be made again, and the same industry
searched again within a day opens the saved brief instead of spending an AI
call (Refresh makes a new one). "Save to Notes" turns one into a synced Note.
"""

import asyncio
import datetime
import html
import json
import re
import sqlite3
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import markets
import radar
import radar_research as rr

DB_PATH = "sage_sync.db"
STEPS = ["Read Radar", "Search the web", "Write the brief"]
STEP_LIMITS = [5, 60, 180]  # seconds
MAX_QUERY = 80
DAILY_CAP = 20         # new briefs a day; opening a saved one is free
FRESH_FOR = datetime.timedelta(hours=24)
MAX_WEB = 14
PAGES_TO_READ = 6
NEWS_ITEMS = 8
KEEP = 60              # briefs kept on the Pi, newest first
OUTLOOKS = ("Booming", "Growing", "Steady", "Shrinking", "Hyped")
SEVERITIES = ("High", "Medium", "Low")

_broadcast: Optional[Callable[[dict], Awaitable[None]]] = None
_lock = asyncio.Lock()
_tasks: set = set()


def connect(db_path: str, broadcast=None) -> None:
    global DB_PATH, _broadcast
    DB_PATH, _broadcast = db_path, broadcast
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS radar_industries (id TEXT PRIMARY KEY, key TEXT, created_at TEXT, status TEXT, payload TEXT)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS radar_industries_key ON radar_industries (key)")
    # A brief that was being written when the server stopped will never finish now.
    for brief_id, payload in conn.execute("SELECT id, payload FROM radar_industries WHERE status IN ('queued', 'running')").fetchall():
        brief = json.loads(payload)
        brief.update(status="failed", error="Sage restarted while this was being written. Search again.")
        conn.execute("UPDATE radar_industries SET status = 'failed', payload = ? WHERE id = ?", (json.dumps(brief), brief_id))
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def key_of(query: str) -> str:
    """Same industry, same key: "3D Printing", "3d-printing " and "3D printing industry" match."""
    words = re.findall(r"[a-z0-9&]+", query.lower())
    words = [w for w in words if w not in ("industry", "industries", "sector", "market", "the")]
    return " ".join(words)


def clean_query(query: str) -> str:
    return re.sub(r"\s+", " ", query or "").strip()[:MAX_QUERY]


# --- Storage ---

def save(brief: dict) -> None:
    conn = _db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO radar_industries (id, key, created_at, status, payload) VALUES (?, ?, ?, ?, ?)",
            (brief["id"], brief["key"], brief["createdAt"], brief["status"], json.dumps(brief)),
        )
        conn.execute(
            "DELETE FROM radar_industries WHERE id NOT IN (SELECT id FROM radar_industries ORDER BY created_at DESC LIMIT ?)",
            (KEEP,),
        )
        conn.commit()
    finally:
        conn.close()


def get(brief_id: str) -> Optional[dict]:
    conn = _db()
    try:
        row = conn.execute("SELECT payload FROM radar_industries WHERE id = ?", (brief_id,)).fetchone()
    finally:
        conn.close()
    return json.loads(row["payload"]) if row else None


def latest_for(key: str) -> Optional[dict]:
    conn = _db()
    try:
        row = conn.execute(
            "SELECT payload FROM radar_industries WHERE key = ? AND status IN ('done', 'partial', 'queued', 'running') ORDER BY created_at DESC LIMIT 1",
            (key,),
        ).fetchone()
    finally:
        conn.close()
    return json.loads(row["payload"]) if row else None


def recent(limit: int = 12) -> List[dict]:
    """One line per industry (its newest brief), for the search box's list."""
    conn = _db()
    try:
        rows = conn.execute("SELECT payload FROM radar_industries ORDER BY created_at DESC LIMIT 60").fetchall()
    finally:
        conn.close()
    out, seen = [], set()
    for r in rows:
        b = json.loads(r["payload"])
        if b["key"] in seen:
            continue
        seen.add(b["key"])
        out.append({
            "id": b["id"], "query": b["query"], "name": b.get("name") or b["query"], "status": b["status"],
            "createdAt": b["createdAt"], "oneLiner": b.get("oneLiner", ""), "outlook": b.get("outlook", {}).get("stance", ""),
        })
        if len(out) >= limit:
            break
    return out


def made_today() -> int:
    local = rr._now_local()
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(datetime.timezone.utc)
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM radar_industries WHERE created_at >= ?", (midnight.strftime("%Y-%m-%dT%H:%M:%S"),)).fetchone()[0]
    finally:
        conn.close()


async def _announce(brief: dict) -> None:
    save(brief)
    if _broadcast:
        await _broadcast({"type": "RADAR_INDUSTRY", "id": brief["id"], "status": brief["status"]})


# --- Starting a brief ---

class LimitReached(Exception):
    pass


def start(query: str, fresh: bool = False, now: Optional[datetime.datetime] = None) -> dict:
    """The saved brief when it is under a day old (unless fresh), else a new one."""
    query = clean_query(query)
    key = key_of(query)
    if len(key) < 2:
        raise ValueError('Type an industry, e.g. "3D printing" or "EV batteries".')
    now = now or radar._utcnow()
    old = latest_for(key)
    if old and old["status"] in ("queued", "running"):
        return old
    if old and not fresh:
        made = radar._parse_iso(old["createdAt"])
        if made and now - made < FRESH_FOR:
            return old
    if made_today() >= DAILY_CAP:
        raise LimitReached(f"That's today's {DAILY_CAP} industry briefs. Saved ones still open; new ones again after midnight.")
    brief = {
        "id": str(uuid.uuid4()),
        "key": key,
        "query": query,
        "status": "queued",
        "step": 0,
        "steps": [{"name": n, "status": "todo", "detail": "", "seconds": None} for n in STEPS],
        "engine": None,
        "error": "",
        "createdAt": radar._iso(now),
        "finishedAt": None,
        "news": [],
        "board": None,
        "sources": [],
        "noteId": None,
    }
    save(brief)
    task = asyncio.get_running_loop().create_task(_run(brief))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return brief


async def _run(brief: dict) -> None:
    async with _lock:  # one brief at a time on the Pi
        brief["status"] = "running"
        await _announce(brief)
        try:
            await Builder(brief).run()
        except Exception as e:  # anything unexpected still ends the brief cleanly
            brief["status"] = "partial" if brief.get("name") or brief["news"] else "failed"
            brief["error"] = str(e)[:300] or e.__class__.__name__
            for step in brief["steps"]:
                if step["status"] == "run":
                    step["status"] = "failed"
        brief["finishedAt"] = rr._utc()
        await _announce(brief)


# --- Step 1: what Radar already has ---

def board_candidates() -> List[dict]:
    """Every industry and sector on the Markets board, with the words that point at it."""
    out = []
    regions = ["US"] + (["India"] if radar.get_settings()["india"] else [])
    for region in regions:
        for name, symbol, _, tag, words, _, industries in markets.VIEWS[region]:
            out.append({"region": region, "name": name, "symbol": symbol, "sector": name, "words": [name, *words]})
            for ind_name, ind_symbol in industries:
                out.append({"region": region, "name": ind_name, "symbol": ind_symbol, "sector": name, "words": [ind_name]})
    return out


def match_board(query: str, candidates: List[dict]) -> Optional[dict]:
    """The board line whose name or words appear in the query (or the other way
    round). Industries beat sectors, longer matches beat shorter ones."""
    q = query.lower()
    best, best_len = None, 0
    for c in candidates:
        for w in c["words"]:
            wl = w.lower()
            if len(wl) < 3:
                continue
            stem = wl[:-1] if wl.endswith("s") and len(wl) > 4 else wl
            hit = re.search(r"\b" + re.escape(stem) + r"s?\b", q) or (len(q) >= 4 and re.search(r"\b" + re.escape(q) + r"\b", wl))
            if hit:
                length = len(wl) + (5 if c["name"] != c["sector"] else 0)
                if length > best_len:
                    best, best_len = c, length
    return best


def board_line(candidate: Optional[dict]) -> Optional[dict]:
    """Price moves of the matched board line from the Markets cache (no fetching here)."""
    if not candidate:
        return None
    series = markets.load_series([candidate["symbol"]]).get(candidate["symbol"], [])
    return {
        "region": candidate["region"],
        "name": candidate["name"],
        "sector": candidate["sector"],
        "symbol": candidate["symbol"],
        "changes": {r: markets.change(series, r) for r in ("1D", "1M", "YTD")},
        "closes": [c for _, c in series[-60:]],
    }


def radar_news(query: str) -> List[dict]:
    return [
        {"title": h["title"], "url": h["link"], "source": h["source"], "published": h["published"], "kind": "radar"}
        for h in rr.matching_headlines(query, limit=NEWS_ITEMS)
    ]


# --- Step 2: the web ---

def queries(query: str, india: bool) -> List[str]:
    out = [
        f"{query} industry overview",
        f"{query} market size CAGR forecast",
        f"{query} top companies stocks",
        f"{query} industry trends 2026",
    ]
    if india:
        out.append(f"{query} industry India")
    return out


async def google_news(client: httpx.AsyncClient, query: str, india: bool) -> List[dict]:
    params = {"q": query, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"} if india else {"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"}
    try:
        res = await client.get(rr.GOOGLE_NEWS, params=params)
        res.raise_for_status()
        items = radar.parse_feed(res.content)
    except Exception:
        return []
    out = []
    for i in items[:NEWS_ITEMS]:
        # Google News titles end with " - Publisher".
        title, _, publisher = i["title"].rpartition(" - ")
        published = i["published"]
        out.append({
            "title": title or i["title"], "url": i["link"], "source": publisher or "Google News",
            "published": radar._iso(published) if isinstance(published, datetime.datetime) else str(published or ""), "kind": "web",
        })
    return out


# --- Step 3: the AI ---

def prompt_brief(query: str, sources: List[dict], news: List[dict], candidates: List[dict], edge: List[str], india: bool) -> str:
    board = ", ".join(f"{c['symbol']} ({c['name']})" for c in candidates)
    headlines = "\n".join(f"- {n['title']} ({n['source']}, {n['published'][:10]})" for n in news[:12]) or "- (none)"
    founder = ("The reader (rate fit for this person):\n" + "\n".join(edge) + "\n\n") if edge else ""
    india_line = '  "india": "2-3 sentences: the industry in India today, its size there, main Indian companies and policies",\n' if india else ""
    fit_line = '  "fit": {"score": 6, "why": "one sentence on how it suits the reader", "firstStep": "one concrete thing to do this week"},\n' if edge else ""
    return (
        f'Industry: "{query}"\n\nSources:\n{rr._sources_block(sources)}\n\nLatest headlines:\n{headlines}\n\n{founder}'
        "Write a complete industry brief for a founder and investor who is new to this industry. "
        "Use numbers from the sources and cite the source number; when a number is your estimate, give no source. "
        "Name real companies only; give stock tickers only for listed companies (empty for private ones). JSON:\n"
        "{\n"
        '  "name": "the industry\'s usual name",\n'
        '  "oneLiner": "one sentence: what it is in plain words",\n'
        '  "whatItIs": "3-4 sentences: what the industry makes or does, and who uses it",\n'
        '  "howMoney": "2 sentences: how companies in it make money (hardware, services, subscriptions...)",\n'
        '  "outlook": {"stance": "Booming | Growing | Steady | Shrinking | Hyped", "text": "one sentence why"},\n'
        '  "market": {"sizeUsdB": 20.5, "year": 2025, "cagrPct": 18, "forecastUsdB": 60, "forecastYear": 2032, "source": 3, "note": "how much estimates differ"},\n'
        '  "keyNumbers": [{"label": "short label", "value": "e.g. 35% or $2.1B", "source": 2}],\n'
        '  "segments": [{"name": "Hardware", "sharePct": 45}],\n'
        '  "valueChain": [{"layer": "e.g. Materials", "players": "who is big there", "gap": "what is left undone"}],\n'
        '  "players": [{"name": "Stratasys", "ticker": "SSYS", "exchange": "NASDAQ", "country": "US", "type": "Listed | Private | Startup", "role": "what they do here", "note": "why they matter"}],\n'
        '  "trends": [{"title": "short", "text": "1-2 sentences", "source": 4}],\n'
        '  "risks": [{"title": "short", "text": "1 sentence", "severity": "High | Medium | Low"}],\n'
        '  "openings": [{"idea": "a small business a solo founder could start", "buyer": "who pays first", "why": "why the gap exists"}],\n'
        + india_line + fit_line +
        f'  "board": "the closest symbol from this list, or empty: {board}"\n'
        "}\n"
        "3-4 key numbers, 3-6 segments whose shares add up to about 100, 3-5 value-chain layers, 6-10 players "
        "(the leaders first, mixing listed companies and notable startups, Indian ones too when relevant), "
        "4-6 trends, 3-5 risks, 3 openings."
    )


def _source_ref(value: Any, count: int) -> Optional[int]:
    refs = rr._refs(value, count)
    return refs[0] if refs else None


def _pick(value: Any, allowed, default: str) -> str:
    text = rr._text(value, 20).lower()
    return next((a for a in allowed if a.lower() == text), default)


def clean_brief(raw: dict, count: int, candidates: List[dict], edge: bool, india: bool) -> dict:
    """Only what the app can show safely: bounded text, numbers in range, lists capped."""
    def items(key: str, limit: int) -> List[dict]:
        value = raw.get(key)
        return [i for i in value if isinstance(i, dict)][:limit] if isinstance(value, list) else []

    market = raw.get("market") if isinstance(raw.get("market"), dict) else {}
    outlook = raw.get("outlook") if isinstance(raw.get("outlook"), dict) else {}
    out = {
        "name": rr._text(raw.get("name"), 80),
        "oneLiner": rr._text(raw.get("oneLiner"), 240),
        "whatItIs": rr._text(raw.get("whatItIs"), 900),
        "howMoney": rr._text(raw.get("howMoney"), 500),
        "outlook": {"stance": _pick(outlook.get("stance"), OUTLOOKS, ""), "text": rr._text(outlook.get("text"), 240)},
        "market": {
            "sizeUsdB": rr._num(market.get("sizeUsdB"), 0, 100000),
            "year": int(rr._num(market.get("year"), 2000, 2100, 0) or 0) or None,
            "cagrPct": rr._num(market.get("cagrPct"), -50, 200),
            "forecastUsdB": rr._num(market.get("forecastUsdB"), 0, 1000000),
            "forecastYear": int(rr._num(market.get("forecastYear"), 2000, 2100, 0) or 0) or None,
            "source": _source_ref(market.get("source"), count),
            "note": rr._text(market.get("note"), 200),
        },
        "keyNumbers": [
            {"label": rr._text(n.get("label"), 60), "value": rr._text(n.get("value"), 30), "source": _source_ref(n.get("source"), count)}
            for n in items("keyNumbers", 4) if n.get("label") and n.get("value")
        ],
        "segments": [
            {"name": rr._text(s.get("name"), 50), "sharePct": rr._num(s.get("sharePct"), 0, 100, 0)}
            for s in items("segments", 6) if s.get("name")
        ],
        "valueChain": [
            {"layer": rr._text(l.get("layer"), 80), "players": rr._text(l.get("players"), 200), "gap": rr._text(l.get("gap"), 240)}
            for l in items("valueChain", 5) if l.get("layer")
        ],
        "players": [
            {
                "name": rr._text(p.get("name"), 60),
                "ticker": re.sub(r"[^A-Z0-9.\-^&]", "", rr._text(p.get("ticker"), 16).upper()),
                "exchange": rr._text(p.get("exchange"), 20).upper(),
                "country": rr._text(p.get("country"), 30),
                "type": _pick(p.get("type"), ("Listed", "Private", "Startup"), "Private"),
                "role": rr._text(p.get("role"), 140),
                "note": rr._text(p.get("note"), 200),
            }
            for p in items("players", 10) if p.get("name")
        ],
        "trends": [
            {"title": rr._text(t.get("title"), 70), "text": rr._text(t.get("text"), 320), "source": _source_ref(t.get("source"), count)}
            for t in items("trends", 6) if t.get("title")
        ],
        "risks": [
            {"title": rr._text(r.get("title"), 70), "text": rr._text(r.get("text"), 260), "severity": _pick(r.get("severity"), SEVERITIES, "Medium")}
            for r in items("risks", 5) if r.get("title")
        ],
        "openings": [
            {"idea": rr._text(o.get("idea"), 140), "buyer": rr._text(o.get("buyer"), 120), "why": rr._text(o.get("why"), 240)}
            for o in items("openings", 3) if o.get("idea")
        ],
        "india": rr._text(raw.get("india"), 700) if india else "",
        "fit": None,
    }
    for p in out["players"]:
        if p["ticker"]:
            p["type"] = "Listed"
        elif p["type"] == "Listed":
            p["exchange"] = ""
    # A forecast earlier than the size's year is a mix-up; drop it rather than draw it backwards.
    m = out["market"]
    if m["year"] and m["forecastYear"] and m["forecastYear"] <= m["year"]:
        m["forecastUsdB"], m["forecastYear"] = None, None
    total = sum(s["sharePct"] for s in out["segments"])
    if total > 0 and abs(total - 100) > 2:
        for s in out["segments"]:
            s["sharePct"] = round(s["sharePct"] * 100 / total, 1)
    fit = raw.get("fit")
    if edge and isinstance(fit, dict) and fit.get("why"):
        out["fit"] = {"score": int(rr._num(fit.get("score"), 0, 10, 5)), "why": rr._text(fit.get("why"), 240), "firstStep": rr._text(fit.get("firstStep"), 200)}
    pick = rr._text(raw.get("board"), 30).upper()
    out["boardPick"] = next((c for c in candidates if c["symbol"].upper() == pick), None)
    return out


class StepFailed(Exception):
    pass


class Builder:
    def __init__(self, brief: dict, client: Optional[httpx.AsyncClient] = None):
        self.brief = brief
        self.client = client
        self.web: List[dict] = []
        self.candidates: List[dict] = []

    async def step(self, index: int, work: Callable[[], Awaitable[str]]) -> None:
        step = self.brief["steps"][index]
        self.brief["step"] = index + 1
        step["status"] = "run"
        await _announce(self.brief)
        started = time.monotonic()
        try:
            step["detail"] = await asyncio.wait_for(work(), STEP_LIMITS[index])
            step["status"] = "done"
        except asyncio.TimeoutError:
            step["status"] = "failed"
            step["detail"] = f"Took longer than {STEP_LIMITS[index]} s"
            raise StepFailed(f"{step['name']} took too long")
        except (StepFailed, rr.AIError) as e:
            step["status"] = "failed"
            step["detail"] = str(e)[:200]
            raise StepFailed(str(e))
        finally:
            step["seconds"] = round(time.monotonic() - started, 1)
            await _announce(self.brief)

    async def run(self) -> None:
        own = self.client is None
        self.client = self.client or httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": radar.USER_AGENT})
        try:
            await self.step(0, self.read_radar)
            await self.step(1, self.search)
            await self.step(2, self.write)
            self.brief["status"] = "done"
        except StepFailed as e:
            self.brief["error"] = str(e)
            # News and the Markets match are still worth showing.
            self.brief["status"] = "partial" if self.brief["news"] or self.brief["sources"] else "failed"
        finally:
            if own:
                await self.client.aclose()

    async def read_radar(self) -> str:
        query = self.brief["query"]
        self.brief["news"] = radar_news(query)
        self.candidates = board_candidates()
        self.brief["board"] = board_line(match_board(query, self.candidates))
        found = f"{len(self.brief['news'])} Radar headline{'s' if len(self.brief['news']) != 1 else ''}"
        return found + (f", on the board as {self.brief['board']['name']}" if self.brief["board"] else "")

    async def search(self) -> str:
        query = self.brief["query"]
        india = radar.get_settings()["india"]
        batches = await asyncio.gather(
            google_news(self.client, query, india),
            *[rr.search_web(self.client, q) for q in queries(query, india)],
        )
        news, results = batches[0], batches[1:]
        seen = {n["url"] for n in self.brief["news"]}
        for n in news:
            if n["url"] not in seen:
                seen.add(n["url"])
                self.brief["news"].append(n)
        self.brief["news"].sort(key=lambda n: n["published"], reverse=True)
        self.brief["news"] = self.brief["news"][:NEWS_ITEMS * 2]
        for batch in results:
            for r in batch:
                if r["url"] not in seen and len(self.web) < MAX_WEB:
                    seen.add(r["url"])
                    self.web.append(r)
        await asyncio.gather(*[rr.read_page(self.client, s) for s in self.web[:PAGES_TO_READ]])
        read = sum(1 for s in self.web if s.get("text"))
        self.brief["sources"] = self._sources()
        return f"{len(self.web)} results, {read} pages read, {len(news)} news stories"

    def _sources(self) -> List[dict]:
        out = [{"title": s["title"], "url": s["url"], "kind": s.get("kind", "web"), "snippet": s.get("snippet", ""), "text": s.get("text", "")} for s in self.web]
        out += [{"title": n["title"], "url": n["url"], "kind": "news", "snippet": f"{n['source']}, {n['published'][:10]}"} for n in self.brief["news"][:8]]
        return out

    async def write(self) -> str:
        sources = self.brief["sources"]
        if not sources:
            raise StepFailed("Nothing found on the web for this industry. Try another name for it.")
        india = radar.get_settings()["india"]
        edge = rr._edge()
        data, _ = await rr.ask_json(self.brief, prompt_brief(self.brief["query"], sources, self.brief["news"], self.candidates, edge, india), "whatItIs", 5000)
        if not data:
            raise StepFailed("The AI didn't return the brief in a form Radar can read")
        clean = clean_brief(data, len(sources), self.candidates, bool(edge), india)
        pick = clean.pop("boardPick")
        if not self.brief["board"] and pick:
            self.brief["board"] = board_line(pick)
        self.brief.update(clean)
        # The app doesn't need page text; keep the stored brief small.
        self.brief["sources"] = [{"title": s["title"], "url": s["url"], "kind": s["kind"], "site": rr._site(s["url"])} for s in sources]
        return f"{len(clean['players'])} companies, {len(clean['trends'])} trends, {len(clean['risks'])} risks"


# --- Save to Notes ---

def note_html(brief: dict) -> str:
    e = html.escape
    src = brief.get("sources", [])

    def cite(n: Optional[int]) -> str:
        return f' <a href="{e(src[n - 1]["url"])}">[{n}]</a>' if n and 0 < n <= len(src) else ""

    out = [f"<h1>{e(brief.get('name') or brief['query'])}</h1>",
           f"<p><i>Radar industry brief, {e(brief['createdAt'][:10])}. AI: {e(brief.get('engine') or '')}. Numbers are estimates.</i></p>"]
    if brief.get("oneLiner"):
        out.append(f"<p><b>{e(brief['oneLiner'])}</b></p>")
    if brief.get("whatItIs"):
        out.append(f"<p>{e(brief['whatItIs'])}</p>")
    if brief.get("howMoney"):
        out.append(f"<p><b>How money is made:</b> {e(brief['howMoney'])}</p>")
    m = brief.get("market") or {}
    if m.get("sizeUsdB"):
        line = f"${m['sizeUsdB']:,.1f}B" + (f" in {m['year']}" if m.get("year") else "")
        if m.get("cagrPct") is not None:
            line += f", growing {m['cagrPct']:.0f}% a year"
        if m.get("forecastUsdB"):
            line += f", ${m['forecastUsdB']:,.0f}B by {m.get('forecastYear') or '?'}"
        out.append(f"<h2>Market</h2><p>{e(line)}{cite(m.get('source'))}</p>")
    if brief.get("players"):
        out.append("<h2>Key companies</h2><ul>" + "".join(
            f"<li><b>{e(p['name'])}</b>{' (' + e(p['ticker']) + ')' if p.get('ticker') else ''}, {e(p['country'])}: {e(p['role'])}</li>"
            for p in brief["players"]) + "</ul>")
    for key, title in (("trends", "Trends"), ("risks", "Risks")):
        if brief.get(key):
            out.append(f"<h2>{title}</h2><ul>" + "".join(
                f"<li><b>{e(t['title'])}</b>: {e(t['text'])}{cite(t.get('source'))}</li>" for t in brief[key]) + "</ul>")
    if brief.get("openings"):
        out.append("<h2>Openings</h2><ul>" + "".join(
            f"<li><b>{e(o['idea'])}</b> (buyer: {e(o['buyer'])}). {e(o['why'])}</li>" for o in brief["openings"]) + "</ul>")
    if brief.get("india"):
        out.append(f"<h2>India</h2><p>{e(brief['india'])}</p>")
    if brief.get("fit"):
        out.append(f"<h2>Fit for you: {brief['fit']['score']}/10</h2><p>{e(brief['fit']['why'])} <b>First step:</b> {e(brief['fit']['firstStep'])}</p>")
    if src:
        out.append("<h2>Sources</h2><ol>" + "".join(f'<li><a href="{e(s["url"])}">{e(s["title"])}</a> ({e(s.get("site", ""))})</li>' for s in src) + "</ol>")
    return "".join(out)


def note_record(brief: dict, now: str) -> dict:
    body = note_html(brief)
    text = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<(br|/p|/li|/h\d)>", "\n", body)))
    text = re.sub(r"[ \t]+", " ", text).strip()
    parts = max(1, -(-len(body) // rr.CELL_LIMIT))
    record = {
        "id": brief.get("noteId") or str(uuid.uuid4()),
        "title": f"Industry: {brief.get('name') or brief['query']}"[:120],
        "content": text[:40000],
        "lifeContext": "work",
        "bodyParts": parts,
        "createdAt": now,
        "updatedAt": now,
    }
    for i in range(parts):
        record[f"body{i}"] = "~" + body[i * rr.CELL_LIMIT:(i + 1) * rr.CELL_LIMIT]
    return record


async def save_note(brief: dict) -> dict:
    if rr._apply is None:
        raise RuntimeError("Radar isn't connected to Sage's database")
    record = note_record(brief, rr._utc())
    result = await rr._apply([rr._op("notes", record)])
    refused = [r for r in result.get("results", []) if r.get("status") != "applied"]
    if refused:
        raise RuntimeError(f"Sage refused to save the note: {refused[0].get('reason')}")
    brief["noteId"] = record["id"]
    save(brief)
    return brief


# --- Routes ---

router = APIRouter()


class Search(BaseModel):
    query: str
    fresh: bool = False


@router.post("/api/radar/industry")
async def industry_start(body: Search):
    try:
        brief = start(body.query, body.fresh)
    except ValueError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=400)
    except LimitReached as e:
        return JSONResponse({"success": False, "error": str(e), "limit": True}, status_code=429)
    return {"success": True, "brief": brief}


@router.get("/api/radar/industry")
def industry_list():
    return {"success": True, "recent": recent(), "madeToday": made_today(), "dailyCap": DAILY_CAP}


@router.get("/api/radar/industry/{brief_id}")
def industry_get(brief_id: str):
    brief = get(brief_id)
    if not brief:
        return JSONResponse({"success": False, "error": "No such industry brief"}, status_code=404)
    return {"success": True, "brief": brief}


@router.post("/api/radar/industry/{brief_id}/note")
async def industry_note(brief_id: str):
    brief = get(brief_id)
    if not brief:
        return JSONResponse({"success": False, "error": "No such industry brief"}, status_code=404)
    if brief["status"] not in ("done", "partial"):
        return JSONResponse({"success": False, "error": "The brief isn't finished yet"}, status_code=409)
    try:
        brief = await save_note(brief)
    except RuntimeError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
    return {"success": True, "brief": brief}
