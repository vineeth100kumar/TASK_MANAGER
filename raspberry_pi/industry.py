"""
Radar industry search: type an industry ("3D printing"), get a brief built
from public data, not from an AI.

The search box at the top of Radar starts a brief on the Pi. Four steps, each
with a time limit, each from sources that publish real data:

  1. Read Radar          - Radar's own headlines that name the industry, and
                           the Markets board fund closest to it (cached prices)
  2. Wikipedia, Wikidata - what the industry is (the article's intro, with its
                           link), and the companies Wikidata lists for it:
                           country, stock ticker and exchange, employees,
                           founding year, website
  3. Filings, research   - SEC EDGAR annual revenue (10-K) for the US-listed
                           ones, and OpenAlex's count of research papers a year
                           as a measure of how active the field is
  4. Web numbers, news   - market size, forecast and growth rate as reported by
                           research firms in search results, each figure kept
                           with the sentence and page it came from (no
                           guessing: a summary is the median of what was
                           found); Google News for the latest stories

An AI is used only when asked: the "Ask AI" button adds trends, risks,
openings, the India angle and the fit with My edge, written from the data
already gathered (Groq first, like Studio and Lab), at most AI_PER_DAY a day.

Briefs live in a Pi-only table: the same industry searched again within a day
opens the saved brief (Refresh makes a new one). "Save to Notes" turns one
into a synced Note.
"""

import asyncio
import datetime
import html
import json
import os
import re
import sqlite3
import statistics
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import markets
import radar
import radar_research as rr

VERSION = 2  # briefs from before (AI-written) are made again on the next search
DB_PATH = "sage_sync.db"
STEPS = ["Read Radar", "Wikipedia & Wikidata", "Filings & research", "Web numbers & news"]
STEP_LIMITS = [5, 40, 45, 60]  # seconds
MAX_QUERY = 80
DAILY_CAP = 30          # new briefs a day (no AI in them); opening a saved one is free
AI_PER_DAY = 10
FRESH_FOR = datetime.timedelta(hours=24)
MAX_COMPANIES = 25
SEC_LOOKUPS = 10
NEWS_ITEMS = 8
PAGES_TO_READ = 6
KEEP = 60

WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json"
SEC_CONCEPT = "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/{concept}.json"
SEC_REVENUE = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"]
OPENALEX = "https://api.openalex.org/works"
# Wikimedia, SEC and OpenAlex ask callers to say who they are.
OPEN_UA = "SageRadar/1.0 (personal dashboard; https://github.com/vineeth100kumar/TASK_MANAGER)"
US_EXCHANGES = ("nasdaq", "new york stock exchange", "nyse")

_broadcast: Optional[Callable[[dict], Awaitable[None]]] = None
_lock = asyncio.Lock()
_tasks: set = set()


def connect(db_path: str, broadcast=None) -> None:
    global DB_PATH, _broadcast
    DB_PATH, _broadcast = db_path, broadcast
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS radar_industries (id TEXT PRIMARY KEY, key TEXT, created_at TEXT, status TEXT, payload TEXT);
        CREATE INDEX IF NOT EXISTS radar_industries_key ON radar_industries (key);
        CREATE TABLE IF NOT EXISTS radar_industry_cache (name TEXT PRIMARY KEY, fetched_at TEXT, payload TEXT);
        CREATE TABLE IF NOT EXISTS radar_industry_ai (at TEXT);
        """
    )
    # A brief (or its AI part) that was running when the server stopped will never finish now.
    for brief_id, payload in conn.execute("SELECT id, payload FROM radar_industries").fetchall():
        brief = json.loads(payload)
        changed = False
        if brief.get("status") in ("queued", "running"):
            brief.update(status="failed", error="Sage restarted while this was being made. Search again.")
            changed = True
        if brief.get("aiStatus") == "running":
            brief.update(aiStatus="failed", aiError="Sage restarted while the AI was writing. Ask again.")
            changed = True
        if changed:
            conn.execute("UPDATE radar_industries SET status = ?, payload = ? WHERE id = ?", (brief["status"], json.dumps(brief), brief_id))
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def key_of(query: str) -> str:
    """Same industry, same key: "3D Printing", "3d-printing " and "3D printing industry" match."""
    words = re.findall(r"[a-z0-9&]+", query.lower())
    return " ".join(w for w in words if w not in ("industry", "industries", "sector", "market", "the"))


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
        conn.execute("DELETE FROM radar_industries WHERE id NOT IN (SELECT id FROM radar_industries ORDER BY created_at DESC LIMIT ?)", (KEEP,))
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
        if b["key"] in seen or b.get("version") != VERSION:
            continue
        seen.add(b["key"])
        out.append({
            "id": b["id"], "query": b["query"], "name": b.get("name") or b["query"], "status": b["status"],
            "createdAt": b["createdAt"], "oneLiner": b.get("oneLiner", ""),
        })
        if len(out) >= limit:
            break
    return out


def _since_midnight() -> str:
    local = rr._now_local()
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(datetime.timezone.utc)
    return midnight.strftime("%Y-%m-%dT%H:%M:%S")


def made_today() -> int:
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM radar_industries WHERE created_at >= ?", (_since_midnight(),)).fetchone()[0]
    finally:
        conn.close()


def ai_today() -> int:
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM radar_industry_ai WHERE at >= ?", (_since_midnight(),)).fetchone()[0]
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
    if old and old.get("version") == VERSION:
        if old["status"] in ("queued", "running"):
            return old
        made = radar._parse_iso(old["createdAt"])
        if not fresh and made and now - made < FRESH_FOR:
            return old
    if made_today() >= DAILY_CAP:
        raise LimitReached(f"That's today's {DAILY_CAP} industry briefs. Saved ones still open; new ones again after midnight.")
    brief = {
        "id": str(uuid.uuid4()),
        "version": VERSION,
        "key": key,
        "query": query,
        "status": "queued",
        "step": 0,
        "steps": [{"name": n, "status": "todo", "detail": "", "seconds": None} for n in STEPS],
        "error": "",
        "createdAt": radar._iso(now),
        "finishedAt": None,
        "name": "",
        "oneLiner": "",
        "wiki": None,
        "companies": [],
        "research": None,
        "figures": [],
        "market": None,
        "news": [],
        "board": None,
        "sources": [],
        "ai": None,
        "aiStatus": "",
        "aiError": "",
        "engine": None,
        "noteId": None,
    }
    save(brief)
    _spawn(_run(brief))
    return brief


def _spawn(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _run(brief: dict) -> None:
    async with _lock:  # one brief at a time on the Pi
        brief["status"] = "running"
        await _announce(brief)
        try:
            await Builder(brief).run()
        except Exception as e:  # anything unexpected still ends the brief cleanly
            brief["status"] = "partial" if brief["wiki"] or brief["news"] else "failed"
            brief["error"] = str(e)[:300] or e.__class__.__name__
            for step in brief["steps"]:
                if step["status"] == "run":
                    step["status"] = "failed"
        brief["finishedAt"] = rr._utc()
        await _announce(brief)


# --- Radar's own data ---

def board_candidates() -> List[dict]:
    """Every industry and sector on the Markets board, with the words that point at it."""
    out = []
    regions = ["US"] + (["India"] if radar.get_settings()["india"] else [])
    for region in regions:
        for name, symbol, _, _, words, _, industries in markets.VIEWS[region]:
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
        "region": candidate["region"], "name": candidate["name"], "sector": candidate["sector"], "symbol": candidate["symbol"],
        "changes": {r: markets.change(series, r) for r in ("1D", "1M", "YTD")},
        "closes": [c for _, c in series[-60:]],
    }


def radar_news(query: str) -> List[dict]:
    return [
        {"title": h["title"], "url": h["link"], "source": h["source"], "published": h["published"], "kind": "radar"}
        for h in rr.matching_headlines(query, limit=NEWS_ITEMS)
    ]


# --- Wikipedia and Wikidata ---

async def wikipedia(client: httpx.AsyncClient, query: str) -> Optional[dict]:
    """The best-matching article: its intro as plain text, link, picture and Wikidata id."""
    res = await client.get(WIKI_API, params={"action": "query", "list": "search", "srsearch": query, "srlimit": 3, "format": "json"}, headers={"User-Agent": OPEN_UA})
    res.raise_for_status()
    hits = (res.json().get("query") or {}).get("search") or []
    if not hits:
        return None
    res = await client.get(WIKI_API, headers={"User-Agent": OPEN_UA}, params={
        "action": "query", "prop": "extracts|pageprops|info|pageimages|description", "exintro": 1, "explaintext": 1,
        "inprop": "url", "piprop": "thumbnail", "pithumbsize": 480, "redirects": 1, "titles": hits[0]["title"], "format": "json",
    })
    res.raise_for_status()
    pages = list(((res.json().get("query") or {}).get("pages") or {}).values())
    if not pages or "missing" in pages[0]:
        return None
    page = pages[0]
    extract = re.sub(r"\n{2,}", "\n", page.get("extract") or "").strip()
    return {
        "title": page.get("title", ""),
        "url": page.get("fullurl") or f"https://en.wikipedia.org/wiki/{page.get('title', '').replace(' ', '_')}",
        "description": page.get("description", ""),
        "extract": extract[:2500],
        "thumbnail": (page.get("thumbnail") or {}).get("source", ""),
        "qid": (page.get("pageprops") or {}).get("wikibase_item", ""),
    }


def sparql_companies(qid: str) -> str:
    """Companies whose industry, or product, is this Wikidata item; still operating."""
    return f"""
SELECT ?c ?cLabel ?countryLabel ?exLabel ?ticker ?emp ?inception ?web WHERE {{
  {{ ?c wdt:P452 wd:{qid} }} UNION {{ ?c wdt:P1056 wd:{qid} }}
  ?c wdt:P31/wdt:P279* wd:Q4830453 .
  FILTER NOT EXISTS {{ ?c wdt:P576 ?ended }}
  OPTIONAL {{ ?c p:P414 ?listing . ?listing ps:P414 ?ex . OPTIONAL {{ ?listing pq:P249 ?ticker }} }}
  OPTIONAL {{ ?c wdt:P17 ?country }}
  OPTIONAL {{ ?c wdt:P1128 ?emp }}
  OPTIONAL {{ ?c wdt:P571 ?inception }}
  OPTIONAL {{ ?c wdt:P856 ?web }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}} LIMIT 400"""


def parse_companies(data: dict) -> List[dict]:
    """SPARQL rows (one per company x listing x value) into one record per company:
    listed ones first, then by employees."""
    by_id: Dict[str, dict] = {}
    for row in (data.get("results") or {}).get("bindings") or []:
        def val(k: str) -> str:
            return (row.get(k) or {}).get("value", "")
        qid = val("c").rsplit("/", 1)[-1]
        name = val("cLabel")
        if not qid or not name or re.fullmatch(r"Q\d+", name):
            continue  # no English name
        c = by_id.setdefault(qid, {"qid": qid, "name": name, "country": "", "ticker": "", "exchange": "", "employees": None, "founded": None, "website": ""})
        c["country"] = c["country"] or val("countryLabel")
        if val("ticker") and not c["ticker"]:
            c["ticker"], c["exchange"] = val("ticker").upper(), val("exLabel")
        elif val("exLabel") and not c["exchange"]:
            c["exchange"] = val("exLabel")
        try:
            emp = int(float(val("emp"))) if val("emp") else None
        except ValueError:
            emp = None
        if emp and emp > (c["employees"] or 0):
            c["employees"] = emp
        year = val("inception")[:4]
        if year.isdigit():
            c["founded"] = min(c["founded"] or 9999, int(year))
        c["website"] = c["website"] or val("web")
    out = list(by_id.values())
    out.sort(key=lambda c: (not c["ticker"], -(c["employees"] or 0), c["name"]))
    return out[:MAX_COMPANIES]


async def wikidata_companies(client: httpx.AsyncClient, qid: str) -> List[dict]:
    res = await client.get(WIKIDATA_SPARQL, params={"query": sparql_companies(qid), "format": "json"},
                           headers={"User-Agent": OPEN_UA, "Accept": "application/sparql-results+json"}, timeout=30)
    res.raise_for_status()
    return parse_companies(res.json())


# --- SEC filings and OpenAlex ---

def _cache_get(name: str, max_age: datetime.timedelta) -> Optional[Any]:
    conn = _db()
    try:
        row = conn.execute("SELECT fetched_at, payload FROM radar_industry_cache WHERE name = ?", (name,)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    at = radar._parse_iso(row["fetched_at"])
    return json.loads(row["payload"]) if at and radar._utcnow() - at < max_age else None


def _cache_put(name: str, payload: Any) -> None:
    conn = _db()
    try:
        conn.execute("INSERT OR REPLACE INTO radar_industry_cache (name, fetched_at, payload) VALUES (?, ?, ?)",
                     (name, radar._iso(radar._utcnow()), json.dumps(payload)))
        conn.commit()
    finally:
        conn.close()


def _sec_headers() -> dict:
    # SEC wants a contact; SAGE_SEC_CONTACT (an email) can be set in sage.env.
    contact = os.getenv("SAGE_SEC_CONTACT", "").strip()
    return {"User-Agent": f"{OPEN_UA} {contact}".strip()}


async def sec_tickers(client: httpx.AsyncClient) -> Dict[str, int]:
    """Ticker -> CIK for every SEC filer, refreshed weekly."""
    cached = _cache_get("sec_tickers", datetime.timedelta(days=7))
    if cached:
        return cached
    res = await client.get(SEC_TICKERS, headers=_sec_headers())
    res.raise_for_status()
    out = {str(v["ticker"]).upper(): int(v["cik_str"]) for v in res.json().values() if v.get("ticker")}
    _cache_put("sec_tickers", out)
    return out


def annual_revenue(data: dict) -> Optional[dict]:
    """Latest full-year revenue from a 10-K in a companyconcept answer, and the
    change from the year before."""
    years: Dict[str, Tuple[str, float]] = {}
    for f in (data.get("units") or {}).get("USD") or []:
        if f.get("form") not in ("10-K", "10-K/A") or not f.get("start") or not f.get("end"):
            continue
        try:
            days = (datetime.date.fromisoformat(f["end"]) - datetime.date.fromisoformat(f["start"])).days
        except ValueError:
            continue
        if not 350 <= days <= 380:
            continue  # quarters reported inside the 10-K
        end = f["end"]
        if end not in years or f.get("filed", "") > years[end][0]:
            years[end] = (f.get("filed", ""), float(f["val"]))
    if not years:
        return None
    ends = sorted(years)
    last = years[ends[-1]][1]
    prev = years[ends[-2]][1] if len(ends) > 1 else None
    return {
        "revenueUsd": last,
        "revenueYear": int(ends[-1][:4]),
        "revenueGrowthPct": round((last / prev - 1) * 100, 1) if prev else None,
    }


async def sec_revenue(client: httpx.AsyncClient, cik: int) -> Optional[dict]:
    for concept in SEC_REVENUE:
        try:
            res = await client.get(SEC_CONCEPT.format(cik=cik, concept=concept), headers=_sec_headers())
        except httpx.HTTPError:
            return None
        if res.status_code == 404:
            continue
        if res.status_code != 200:
            return None
        found = annual_revenue(res.json())
        # Older filings may use another concept; only take a recent year.
        if found and found["revenueYear"] >= radar._utcnow().year - 3:
            return found
    return None


def _us_listed(c: dict) -> bool:
    return bool(c["ticker"]) and any(x in c["exchange"].lower() for x in US_EXCHANGES)


async def openalex_years(client: httpx.AsyncClient, query: str) -> Optional[dict]:
    """Research papers a year on the topic (titles and abstracts), last 10 full years."""
    res = await client.get(OPENALEX, params={"filter": f"title_and_abstract.search:{query}", "group_by": "publication_year"},
                           headers={"User-Agent": OPEN_UA})
    res.raise_for_status()
    this_year = radar._utcnow().year
    counts = {}
    for g in res.json().get("group_by") or []:
        key = str(g.get("key", ""))
        if key.isdigit() and this_year - 10 <= int(key) < this_year:
            counts[int(key)] = int(g.get("count") or 0)
    if not counts:
        return None
    last, five = counts.get(this_year - 1, 0), counts.get(this_year - 6, 0)
    return {
        "years": [{"year": y, "count": counts.get(y, 0)} for y in range(this_year - 10, this_year)],
        "lastYear": last,
        "growth5yPct": round((last / five - 1) * 100) if five else None,
        "url": f"https://openalex.org/works?filter=title_and_abstract.search:{query.replace(' ', '%20')}",
    }


# --- Market size from what research firms publish ---

MONEY = re.compile(r"(?:US\$|USD|\$)\s?(\d{1,4}(?:[.,]\d{1,3})?)\s?(trillion|billion|million|bn|tn|mn|[BMT])\b", re.I)
YEAR = re.compile(r"\b(20[1-4]\d)\b")
CAGR = re.compile(
    r"(?:CAGR|compound annual growth rate)[^0-9%]{0,25}?(\d{1,2}(?:\.\d{1,2})?)\s?%"
    r"|(\d{1,2}(?:\.\d{1,2})?)\s?%\s*(?:CAGR|compound annual growth)",
    re.I,
)
FUTURE = re.compile(r"\b(by|reach|reaching|projected|expected|forecast|will|anticipated)\b", re.I)
UNITS = {"trillion": 1000, "tn": 1000, "t": 1000, "billion": 1, "bn": 1, "b": 1, "million": 0.001, "mn": 0.001, "m": 0.001}


def _sentences(text: str) -> List[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z$])", re.sub(r"\s+", " ", text)) if 20 < len(s.strip()) < 500]


def _amount(raw: str) -> float:
    # "1,250" is a thousands comma; "24,8" is a decimal comma.
    if "," in raw and len(raw.split(",")[1]) != 3:
        return float(raw.replace(",", "."))
    return float(raw.replace(",", ""))


def market_figures(sources: List[dict], query: str, now_year: int) -> List[dict]:
    """Every market size and growth rate stated in the search results, with the
    sentence and the page it came from. A sentence must name the market."""
    words = [w.lower() for w in re.findall(r"[A-Za-z0-9]+", query) if len(w) > 2] or [query.lower()]
    words = [w[:-1] if w.endswith("s") and len(w) > 4 else w for w in words]  # "drones" matches "drone market"
    out, seen = [], set()
    for s in sources:
        for sentence in _sentences(f"{s.get('snippet', '')} {s.get('text', '')}"):
            low = sentence.lower()
            if "market" not in low or not any(w in low for w in words):
                continue
            base = {"sentence": sentence[:300], "url": s["url"], "site": rr._site(s["url"])}
            for m in MONEY.finditer(sentence):
                unit = m.group(2).lower()
                if len(m.group(2)) == 1 and not m.group(2).isupper():
                    continue  # "$5 m" alone is too loose; B/M/T only in capitals
                usd_b = round(_amount(m.group(1)) * UNITS[unit], 3)
                after = sentence[m.end():m.end() + 40]
                before = sentence[max(0, m.start() - 40):m.start()]
                year_m = YEAR.search(after) or ([*YEAR.finditer(before)] or [None])[-1]
                year = int(year_m.group(1)) if year_m else None
                future = bool(year and (year > now_year or (year == now_year and FUTURE.search(before[-30:]))))
                key = (round(usd_b, 1), year, base["site"])
                if key in seen or usd_b <= 0:
                    continue
                seen.add(key)
                out.append({**base, "kind": "forecast" if future else "size", "usdB": usd_b, "year": year, "text": m.group(0)})
            for m in CAGR.finditer(sentence):
                pct = float(m.group(1) or m.group(2))
                key = ("cagr", pct, base["site"])
                if key in seen or not 0 < pct < 100:
                    continue
                seen.add(key)
                out.append({**base, "kind": "cagr", "pct": pct, "text": m.group(0)})
    return out


def market_summary(figures: List[dict], now_year: int) -> Optional[dict]:
    """The middle of what was reported, and how many sites said it. Sizes are
    kept to the last three years; the forecast is the median near the furthest year given."""
    sizes = [f for f in figures if f["kind"] == "size" and f["year"] and now_year - 3 <= f["year"] <= now_year]
    forecasts = [f for f in figures if f["kind"] == "forecast" and f["year"]]
    rates = [f for f in figures if f["kind"] == "cagr"]
    if not sizes and not forecasts and not rates:
        return None
    out = {"sizeUsdB": None, "sizeYear": None, "sizeSites": 0, "low": None, "high": None,
           "forecastUsdB": None, "forecastYear": None, "forecastSites": 0, "cagrPct": None, "cagrSites": 0}
    if sizes:
        out.update(
            sizeUsdB=round(statistics.median(f["usdB"] for f in sizes), 2),
            sizeYear=int(statistics.median_high(f["year"] for f in sizes)),
            sizeSites=len({f["site"] for f in sizes}),
            low=min(f["usdB"] for f in sizes), high=max(f["usdB"] for f in sizes),
        )
    if forecasts:
        far = max(f["year"] for f in forecasts)
        near = [f for f in forecasts if f["year"] >= far - 2]
        out.update(
            forecastUsdB=round(statistics.median(f["usdB"] for f in near), 2),
            forecastYear=int(statistics.median_high(f["year"] for f in near)),
            forecastSites=len({f["site"] for f in near}),
        )
    if rates:
        out.update(cagrPct=round(statistics.median(f["pct"] for f in rates), 1), cagrSites=len({f["site"] for f in rates}))
    return out


def queries(query: str, india: bool) -> List[str]:
    out = [f"{query} market size billion", f"{query} market CAGR forecast", f"{query} industry market report"]
    if india:
        out.append(f"{query} market size India")
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
        title, _, publisher = i["title"].rpartition(" - ")  # Google News titles end with " - Publisher"
        published = i["published"]
        out.append({
            "title": title or i["title"], "url": i["link"], "source": publisher or "Google News",
            "published": radar._iso(published) if isinstance(published, datetime.datetime) else str(published or ""), "kind": "web",
        })
    return out


# --- The builder ---

class StepFailed(Exception):
    pass


class Builder:
    def __init__(self, brief: dict, client: Optional[httpx.AsyncClient] = None):
        self.brief = brief
        self.client = client
        self.problems: List[str] = []

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
            step["status"], step["detail"] = "failed", f"Took longer than {STEP_LIMITS[index]} s"
            self.problems.append(f"{step['name']} took too long")
        except Exception as e:  # one source down doesn't stop the others
            step["status"], step["detail"] = "failed", (str(e) or e.__class__.__name__)[:160]
            self.problems.append(f"{step['name']}: {step['detail']}")
        finally:
            step["seconds"] = round(time.monotonic() - started, 1)
            await _announce(self.brief)

    async def run(self) -> None:
        own = self.client is None
        self.client = self.client or httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": radar.USER_AGENT})
        try:
            await self.step(0, self.read_radar)
            await self.step(1, self.wiki)
            await self.step(2, self.filings)
            await self.step(3, self.web)
        finally:
            if own:
                await self.client.aclose()
        b = self.brief
        b["error"] = "; ".join(self.problems)
        has = b["wiki"] or b["companies"] or b["market"] or b["news"]
        b["status"] = ("partial" if self.problems else "done") if has else "failed"
        if not has and not b["error"]:
            b["error"] = "Nothing found for this name. Try another word for the industry."

    async def read_radar(self) -> str:
        q = self.brief["query"]
        self.brief["news"] = radar_news(q)
        self.brief["board"] = board_line(match_board(q, board_candidates()))
        n = len(self.brief["news"])
        return f"{n} Radar headline{'s' if n != 1 else ''}" + (f", on the board as {self.brief['board']['name']}" if self.brief["board"] else "")

    async def wiki(self) -> str:
        b = self.brief
        page = await wikipedia(self.client, b["query"])
        if not page:
            raise StepFailed("No Wikipedia article found")
        b["wiki"] = page
        b["name"] = page["title"]
        first = _sentences(page["extract"])[:1]
        b["oneLiner"] = first[0] if first else page["description"]
        self._source("Wikipedia", page["title"], page["url"])
        if not page["qid"]:
            return f"Article “{page['title']}” (no Wikidata link)"
        try:
            b["companies"] = await wikidata_companies(self.client, page["qid"])
        except Exception as e:
            raise StepFailed(f"Wikipedia found; Wikidata failed ({str(e)[:80] or e.__class__.__name__})")
        if b["companies"]:
            self._source("Wikidata", f"Companies in {page['title']}", f"https://www.wikidata.org/wiki/{page['qid']}")
        listed = sum(1 for c in b["companies"] if c["ticker"])
        return f"“{page['title']}”, {len(b['companies'])} companies ({listed} listed)"

    async def filings(self) -> str:
        b = self.brief
        notes = []
        us = [c for c in b["companies"] if _us_listed(c)][:SEC_LOOKUPS]
        if us:
            try:
                ciks = await sec_tickers(self.client)
                known = [c for c in us if c["ticker"] in ciks]
                results = await asyncio.gather(*[sec_revenue(self.client, ciks[c["ticker"]]) for c in known])
                found = 0
                for c, rev in zip(known, results):
                    if rev:
                        c.update(rev, secUrl=f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={ciks[c['ticker']]}&type=10-K")
                        found += 1
                if found:
                    self._source("SEC EDGAR", "Annual revenue from 10-K filings", "https://www.sec.gov/edgar/search/")
                notes.append(f"{found} SEC revenue{'s' if found != 1 else ''}")
            except Exception as e:
                notes.append(f"SEC down ({str(e)[:60] or e.__class__.__name__})")
        try:
            b["research"] = await openalex_years(self.client, b["query"])
            if b["research"]:
                self._source("OpenAlex", "Research papers a year", b["research"]["url"])
                notes.append(f"{b['research']['lastYear']:,} papers last year")
        except Exception as e:
            notes.append(f"OpenAlex down ({str(e)[:60] or e.__class__.__name__})")
        return ", ".join(notes) or "No US-listed companies to look up"

    async def web(self) -> str:
        b = self.brief
        india = radar.get_settings()["india"]
        batches = await asyncio.gather(google_news(self.client, b["query"], india), *[rr.search_web(self.client, q) for q in queries(b["query"], india)])
        news, results = batches[0], batches[1:]
        seen = {n["url"] for n in b["news"]}
        for n in news:
            if n["url"] not in seen:
                seen.add(n["url"])
                b["news"].append(n)
        b["news"].sort(key=lambda n: n["published"], reverse=True)
        b["news"] = b["news"][:NEWS_ITEMS * 2]
        pages, urls = [], set()
        for batch in results:
            for r in batch:
                if r["url"] not in urls:
                    urls.add(r["url"])
                    pages.append(r)
        await asyncio.gather(*[rr.read_page(self.client, p) for p in pages[:PAGES_TO_READ]])
        year = radar._utcnow().year
        b["figures"] = market_figures(pages, b["query"], year)[:30]
        b["market"] = market_summary(b["figures"], year)
        for f in b["figures"]:
            self._source(f["site"], "Market figures", f["url"])
        sites = len({f["site"] for f in b["figures"]})
        return f"{len(b['figures'])} market figures from {sites} site{'s' if sites != 1 else ''}, {len(news)} news stories"

    def _source(self, name: str, title: str, url: str) -> None:
        if not any(s["url"] == url for s in self.brief["sources"]):
            self.brief["sources"].append({"name": name, "title": title, "url": url, "site": rr._site(url)})


# --- Optional AI ---

def prompt_ai(brief: dict, edge: List[str], india: bool) -> str:
    wiki = (brief.get("wiki") or {}).get("extract", "")[:1500]
    companies = ", ".join(f"{c['name']}{' (' + c['ticker'] + ')' if c['ticker'] else ''}" for c in brief["companies"][:15]) or "(none listed)"
    m = brief.get("market") or {}
    market = "; ".join(x for x in (
        f"reported size ${m['sizeUsdB']}B ({m['sizeYear']})" if m.get("sizeUsdB") else "",
        f"forecast ${m['forecastUsdB']}B by {m['forecastYear']}" if m.get("forecastUsdB") else "",
        f"growth {m['cagrPct']}% a year" if m.get("cagrPct") else "",
    ) if x)
    news = "\n".join(f"[{i}] {n['title']} ({n['source']}, {n['published'][:10]})" for i, n in enumerate(brief["news"][:12], 1)) or "(none)"
    founder = ("The reader (rate fit for this person):\n" + "\n".join(edge) + "\n\n") if edge else ""
    return (
        f'Industry: "{brief.get("name") or brief["query"]}"\n\nWhat it is (Wikipedia): {wiki}\n\nCompanies: {companies}\n\n'
        f"Market: {market or '(no figures found)'}\n\nLatest news (numbered):\n{news}\n\n{founder}"
        "Using only the facts above, write JSON. Cite a news number where a point comes from one:\n"
        "{\n"
        '  "trends": [{"title": "short", "text": "1-2 sentences", "news": 2}],\n'
        '  "risks": [{"title": "short", "text": "1 sentence", "severity": "High | Medium | Low"}],\n'
        '  "openings": [{"idea": "a small business a solo founder could start", "buyer": "who pays first", "why": "the gap"}]'
        + (',\n  "india": "2 sentences on India, only from the facts above, or empty"' if india else "")
        + (',\n  "fit": {"score": 6, "why": "one sentence", "firstStep": "one thing to do this week"}' if edge else "")
        + "\n}\n3-5 trends, 3-4 risks, 3 openings."
    )


def clean_ai(raw: dict, news_count: int, edge: bool, india: bool) -> dict:
    def items(key: str, limit: int) -> List[dict]:
        value = raw.get(key)
        return [i for i in value if isinstance(i, dict)][:limit] if isinstance(value, list) else []

    def ref(v: Any) -> Optional[int]:
        refs = rr._refs(v, news_count)
        return refs[0] if refs else None

    def severity(v: Any) -> str:
        return next((s for s in ("High", "Medium", "Low") if s.lower() == rr._text(v, 10).lower()), "Medium")

    fit = raw.get("fit")
    return {
        "trends": [{"title": rr._text(t.get("title"), 70), "text": rr._text(t.get("text"), 320), "news": ref(t.get("news"))} for t in items("trends", 5) if t.get("title")],
        "risks": [{"title": rr._text(r.get("title"), 70), "text": rr._text(r.get("text"), 260), "severity": severity(r.get("severity"))} for r in items("risks", 4) if r.get("title")],
        "openings": [{"idea": rr._text(o.get("idea"), 140), "buyer": rr._text(o.get("buyer"), 120), "why": rr._text(o.get("why"), 240)} for o in items("openings", 3) if o.get("idea")],
        "india": rr._text(raw.get("india"), 600) if india else "",
        "fit": {"score": int(rr._num(fit.get("score"), 0, 10, 5)), "why": rr._text(fit.get("why"), 240), "firstStep": rr._text(fit.get("firstStep"), 200)}
        if edge and isinstance(fit, dict) and fit.get("why") else None,
    }


async def write_ai(brief: dict) -> None:
    try:
        edge = rr._edge()
        india = radar.get_settings()["india"]
        data, _ = await rr.ask_json(brief, prompt_ai(brief, edge, india), "trends", 2500)
        if not data:
            raise rr.AIError("The AI didn't answer in a form Radar can read")
        brief["ai"] = clean_ai(data, len(brief["news"][:12]), bool(edge), india)
        brief["aiStatus"], brief["aiError"] = "done", ""
    except Exception as e:
        brief["aiStatus"], brief["aiError"] = "failed", str(e)[:300] or e.__class__.__name__
    await _announce(brief)


def start_ai(brief: dict) -> dict:
    if brief["status"] not in ("done", "partial"):
        raise ValueError("The brief isn't finished yet")
    if brief.get("aiStatus") == "running":
        return brief
    if ai_today() >= AI_PER_DAY:
        raise LimitReached(f"That's today's {AI_PER_DAY} AI write-ups. The data part still works; AI again after midnight.")
    conn = _db()
    try:
        conn.execute("INSERT INTO radar_industry_ai (at) VALUES (?)", (radar._iso(radar._utcnow()),))
        conn.commit()
    finally:
        conn.close()
    brief["aiStatus"], brief["aiError"] = "running", ""
    save(brief)
    _spawn(write_ai(brief))
    return brief


# --- Save to Notes ---

def _money(usd: float) -> str:
    return f"${usd / 1e9:,.1f}B" if usd >= 1e9 else f"${usd / 1e6:,.0f}M"


def note_html(brief: dict) -> str:
    e = html.escape
    out = [f"<h1>{e(brief.get('name') or brief['query'])}</h1>",
           f"<p><i>Radar industry brief, {e(brief['createdAt'][:10])}. From Wikipedia, Wikidata, SEC EDGAR, OpenAlex, published market figures and news.</i></p>"]
    w = brief.get("wiki")
    if w:
        out.append(f"<p>{e(w['extract'][:1200])} <a href=\"{e(w['url'])}\">Wikipedia</a></p>")
    m = brief.get("market")
    if m:
        bits = []
        if m.get("sizeUsdB"):
            bits.append(f"${m['sizeUsdB']:,.1f}B in {m['sizeYear']} (median of {m['sizeSites']} sites)")
        if m.get("forecastUsdB"):
            bits.append(f"${m['forecastUsdB']:,.1f}B by {m['forecastYear']}")
        if m.get("cagrPct"):
            bits.append(f"{m['cagrPct']}% a year")
        out.append(f"<h2>Market (as reported)</h2><p>{e('; '.join(bits))}</p><ul>" + "".join(
            f"<li>{e(f['text'])}{' (' + str(f['year']) + ')' if f.get('year') else ''}: <a href=\"{e(f['url'])}\">{e(f['site'])}</a></li>"
            for f in brief.get("figures", [])[:12]) + "</ul>")
    if brief.get("companies"):
        rows = []
        for c in brief["companies"]:
            bits = [f"<b>{e(c['name'])}</b>"]
            if c["ticker"]:
                bits.append(f"({e(c['ticker'])}, {e(c['exchange'])})")
            if c["country"]:
                bits.append(e(c["country"]))
            if c.get("employees"):
                bits.append(f"{c['employees']:,} employees")
            if c.get("revenueUsd"):
                bits.append(f"revenue {_money(c['revenueUsd'])} ({c['revenueYear']})")
            rows.append("<li>" + ", ".join(bits) + "</li>")
        out.append("<h2>Companies</h2><ul>" + "".join(rows) + "</ul>")
    r = brief.get("research")
    if r:
        growth = f", {r['growth5yPct']:+d}% over 5 years" if r.get("growth5yPct") is not None else ""
        out.append(f"<h2>Research</h2><p>{r['lastYear']:,} papers last year{growth} (OpenAlex).</p>")
    if brief.get("news"):
        out.append("<h2>News</h2><ul>" + "".join(f"<li><a href=\"{e(n['url'])}\">{e(n['title'])}</a> ({e(n['source'])}, {e(n['published'][:10])})</li>" for n in brief["news"][:10]) + "</ul>")
    ai = brief.get("ai")
    if ai:
        out.append("<h2>AI notes</h2><p><i>Written by AI from the data above.</i></p><ul>"
                   + "".join(f"<li><b>Trend: {e(t['title'])}</b>. {e(t['text'])}</li>" for t in ai["trends"])
                   + "".join(f"<li><b>Risk ({t['severity']}): {e(t['title'])}</b>. {e(t['text'])}</li>" for t in ai["risks"])
                   + "".join(f"<li><b>Opening: {e(o['idea'])}</b> (buyer: {e(o['buyer'])}). {e(o['why'])}</li>" for o in ai["openings"])
                   + "</ul>")
    if brief.get("sources"):
        out.append("<h2>Sources</h2><ol>" + "".join(f"<li><a href=\"{e(s['url'])}\">{e(s['name'])}: {e(s['title'])}</a></li>" for s in brief["sources"]) + "</ol>")
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


def _missing() -> JSONResponse:
    return JSONResponse({"success": False, "error": "No such industry brief"}, status_code=404)


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
    return {"success": True, "recent": recent(), "madeToday": made_today(), "dailyCap": DAILY_CAP, "aiToday": ai_today(), "aiPerDay": AI_PER_DAY}


@router.get("/api/radar/industry/{brief_id}")
def industry_get(brief_id: str):
    brief = get(brief_id)
    if not brief:
        return _missing()
    return {"success": True, "brief": brief, "aiLeft": max(0, AI_PER_DAY - ai_today())}


@router.post("/api/radar/industry/{brief_id}/ai")
async def industry_ai(brief_id: str):
    brief = get(brief_id)
    if not brief:
        return _missing()
    try:
        brief = start_ai(brief)
    except ValueError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=409)
    except LimitReached as e:
        return JSONResponse({"success": False, "error": str(e), "limit": True}, status_code=429)
    return {"success": True, "brief": brief}


@router.post("/api/radar/industry/{brief_id}/note")
async def industry_note(brief_id: str):
    brief = get(brief_id)
    if not brief:
        return _missing()
    if brief["status"] not in ("done", "partial"):
        return JSONResponse({"success": False, "error": "The brief isn't finished yet"}, status_code=409)
    try:
        brief = await save_note(brief)
    except RuntimeError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
    return {"success": True, "brief": brief}
