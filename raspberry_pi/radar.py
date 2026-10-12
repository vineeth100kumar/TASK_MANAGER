"""
Radar, phase 1: Signals.

Every 15 minutes the Pi reads a handful of news feeds, tags each headline
(AI, Regulation, Fintech, ...) and guesses its region from the source and the
countries it names. Every 5 minutes in US or Indian market hours (hourly
otherwise) it fetches the last week of daily closes for a few markets from
Yahoo's chart data. Both are kept in cache tables in Sage's database that never sync: they
can always be fetched again, and headlines would swamp the Sheets backup.

The web app reads them through /api/radar/summary and /api/radar/signals.
Each source's last result is kept too, so a broken feed shows up as broken
(in Data & Sync and on the Radar page) instead of as a quiet, empty list.

Velocity says how busy a tag's news is: its headlines in the last 48 hours
divided by twice its usual daily count (up to 30 days back). 1x is normal,
2x or more is "rising". It needs a day of history before the last 48 hours,
so for the first few days after install it shows counts only.

India gets its own lane: a few Indian business, startup and tech feeds,
Nifty 50, Sensex, Nifty Bank and the rupee. Settings > Radar can switch them
off ("india"). The India filter shows headlines that name India plus
everything from the Indian sources, even a story about the Fed.

SAGE_RADAR=0 turns the background fetching off. SAGE_RADAR_FEEDS can replace
the feed list with JSON: [{"name": "...", "url": "...", "region": "Europe"}].
A feed with region "India" counts as an Indian source.
"""

import asyncio
import datetime
import email.utils
import hashlib
import html
import json
import os
import re
import sqlite3
import xml.etree.ElementTree as ET
from typing import Any, Awaitable, Callable, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter

ENABLED = os.getenv("SAGE_RADAR", "1").strip() != "0"

# Region is None when a source covers the whole world; the headline's own
# country names decide it then (see guess_region).
DEFAULT_FEEDS = [
    {"name": "TechCrunch", "url": "https://techcrunch.com/feed/", "region": None},
    {"name": "Hacker News", "url": "https://hnrss.org/frontpage", "region": None},
    {"name": "MIT Tech Review", "url": "https://www.technologyreview.com/feed/", "region": None},
    {"name": "The Economist", "url": "https://www.economist.com/business/rss.xml", "region": None},
    {"name": "Yahoo Finance", "url": "https://finance.yahoo.com/news/rssindex", "region": "Americas"},
    {"name": "BBC Business", "url": "https://feeds.bbci.co.uk/news/business/rss.xml", "region": "Europe"},
    {"name": "SCMP Business", "url": "https://www.scmp.com/rss/92/feed", "region": "Asia-Pacific"},
    {"name": "Rest of World", "url": "https://restofworld.org/feed/latest", "region": "Emerging"},
    {"name": "Economic Times", "url": "https://economictimes.indiatimes.com/rssfeedstopstories.cms", "region": "India"},
    {"name": "ET Tech", "url": "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms", "region": "India"},
    {"name": "Mint Markets", "url": "https://www.livemint.com/rss/markets", "region": "India"},
    {"name": "BusinessLine", "url": "https://www.thehindubusinessline.com/feeder/default.rss", "region": "India"},
    {"name": "Inc42", "url": "https://inc42.com/feed/", "region": "India"},
    {"name": "YourStory", "url": "https://yourstory.com/feed", "region": "India"},
]
INDIA = "India"

# (Yahoo symbol, label, unit). The unit tells the app how to show the price.
INDIA_QUOTES = [
    ("^NSEI", "Nifty 50", "index"),
    ("^BSESN", "Sensex", "index"),
    ("^NSEBANK", "Nifty Bank", "index"),
    ("INR=X", "USD/INR", "inr"),
]
QUOTES = [
    ("^GSPC", "S&P 500", "index"),
    ("^NDX", "Nasdaq 100", "index"),
    ("^TNX", "10Y yield", "pct"),
    ("CL=F", "Crude", "usd"),
    ("GC=F", "Gold", "usd"),
    ("SOXX", "Semis", "index"),
    ("BTC-USD", "Bitcoin", "usd"),
]
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

FEED_EVERY = datetime.timedelta(minutes=15)
QUOTES_EVERY_OPEN = datetime.timedelta(minutes=5)
QUOTES_EVERY_CLOSED = datetime.timedelta(minutes=60)
# A manual refresh can't hammer the sources.
MIN_MANUAL_GAP = datetime.timedelta(seconds=60)
KEEP_DAYS = 30
RECENT_HOURS = 48
RISING = 2.0
TIMEOUT = 15.0
# Yahoo refuses requests without a browser-like agent.
USER_AGENT = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 Sage-Radar"
NEW_YORK = ZoneInfo("America/New_York")
KOLKATA = ZoneInfo("Asia/Kolkata")

# A keyword with a capital letter matches case-sensitively ("US", not "us";
# "AI", not "ai" inside a name); the rest match whole words in any case.
TAGS: Dict[str, List[str]] = {
    "AI": [
        "AI", "A.I.", "artificial intelligence", "machine learning", "LLM", "LLMs", "OpenAI",
        "Anthropic", "ChatGPT", "GPT", "DeepMind", "chatbot", "chatbots", "generative",
        "Nvidia", "Copilot", "agentic", "AGI",
    ],
    "Regulation": [
        "regulation", "regulations", "regulator", "regulators", "regulatory", "lawmakers",
        "antitrust", "SEC", "FTC", "DOJ", "European Commission", "compliance", "fined",
        "lawsuit", "sued", "court", "ruling", "probe", "ban", "bans", "banned", "AI Act",
        "legislation", "sanctions", "tariff", "tariffs", "watchdog",
    ],
    "Fintech": [
        "fintech", "payments", "payment", "bank", "banks", "banking", "neobank", "stablecoin",
        "stablecoins", "crypto", "bitcoin", "lending", "loans", "payroll", "remittance",
        "remittances", "wallet", "Visa", "Mastercard", "Stripe", "PayPal", "insurtech", "BNPL",
    ],
    "Supply chain": [
        "supply chain", "supply chains", "shipping", "freight", "logistics", "container",
        "containers", "port", "ports", "tariff", "tariffs", "warehouse", "trucking",
        "manufacturing", "factory", "factories", "shortage", "shortages", "Red Sea",
    ],
    "Climate": [
        "climate", "emissions", "carbon", "solar", "wind farm", "wind power", "battery",
        "batteries", "EV", "EVs", "electric vehicle", "electric vehicles", "renewable",
        "renewables", "grid", "hydrogen", "nuclear", "heatwave", "wildfire", "wildfires",
        "drought", "flooding", "net zero",
    ],
    "Defense": [
        "defense", "defence", "military", "Pentagon", "NATO", "missile", "missiles", "drone",
        "drones", "army", "weapons", "arms", "warfare",
    ],
    "Health": [
        "health", "healthcare", "hospital", "hospitals", "FDA", "drug", "drugs", "pharma",
        "vaccine", "vaccines", "clinical", "patients", "medical", "biotech", "cancer",
        "obesity", "GLP-1", "Ozempic", "Wegovy",
    ],
}
TAG_ORDER = list(TAGS)

# India comes first, so a tie (an Indian headline naming the US) goes to India.
REGIONS: Dict[str, List[str]] = {
    "India": [
        "India", "Indian", "Indians", "New Delhi", "Delhi", "Mumbai", "Bengaluru", "Bangalore",
        "Hyderabad", "Chennai", "Pune", "Kolkata", "Gujarat", "Maharashtra", "Karnataka",
        "Tamil Nadu", "Kerala", "RBI", "Reserve Bank of India", "SEBI", "Sebi", "Sensex",
        "Nifty", "NSE", "BSE", "rupee", "UPI", "Modi", "Sitharaman", "Reliance", "Tata",
        "Infosys", "Wipro", "Adani", "Flipkart", "Zomato", "Swiggy", "Paytm", "Ola",
    ],
    "Americas": [
        "US", "U.S.", "USA", "America", "American", "Americans", "Canada", "Canadian",
        "Wall Street", "Fed", "Federal Reserve", "Silicon Valley", "California", "New York",
        "Texas", "Washington", "Trump", "White House", "Congress",
    ],
    "Europe": [
        "Europe", "European", "EU", "Brussels", "UK", "Britain", "British", "England",
        "London", "Germany", "German", "France", "French", "Paris", "Italy", "Italian",
        "Spain", "Spanish", "Netherlands", "Dutch", "Sweden", "Swedish", "Switzerland",
        "Swiss", "Poland", "Polish", "Ukraine", "ECB", "Bank of England",
    ],
    "Asia-Pacific": [
        "Asia", "Asian", "China", "Chinese", "Beijing", "Shanghai", "Shenzhen", "Hong Kong",
        "Japan", "Japanese", "Tokyo", "Korea", "Korean", "Seoul", "Taiwan", "Taiwanese",
        "Singapore", "Australia", "Australian", "Vietnam", "Vietnamese",
        "Indonesia", "Indonesian", "Philippines", "Thailand", "Malaysia", "New Zealand",
    ],
    "Emerging": [
        "Africa", "African", "Nigeria", "Nigerian", "Kenya", "Kenyan", "South Africa",
        "Egypt", "Middle East", "Saudi", "UAE", "Dubai", "Qatar", "Israel", "Israeli", "Iran",
        "Turkey", "Turkish", "Brazil", "Brazilian", "Mexico", "Mexican", "Argentina",
        "Chile", "Colombia", "Latin America", "Pakistan", "Bangladesh",
    ],
}
REGION_ORDER = list(REGIONS)


def _pattern(words: List[str]) -> List[re.Pattern]:
    out = []
    for word in words:
        flags = 0 if any(c.isupper() for c in word) else re.IGNORECASE
        out.append(re.compile(r"(?<![\w.])" + re.escape(word) + r"(?![\w])", flags))
    return out


_TAG_PATTERNS = {tag: _pattern(words) for tag, words in TAGS.items()}
_REGION_PATTERNS = {region: _pattern(words) for region, words in REGIONS.items()}

DB_PATH = "sage_sync.db"


# --- Storage ---

def connect(db_path: str) -> None:
    global DB_PATH
    DB_PATH = db_path
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS radar_signals (
            id TEXT PRIMARY KEY,
            source TEXT,
            title TEXT,
            link TEXT,
            published TEXT,
            seen_at TEXT,
            region TEXT,
            tags TEXT
        );
        CREATE INDEX IF NOT EXISTS radar_signals_published ON radar_signals (published);
        CREATE TABLE IF NOT EXISTS radar_quotes (
            symbol TEXT PRIMARY KEY,
            name TEXT,
            unit TEXT,
            price REAL,
            change_pct REAL,
            closes TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS radar_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS radar_sources (
            name TEXT PRIMARY KEY,
            kind TEXT,
            ok INTEGER,
            items INTEGER,
            error TEXT,
            checked_at TEXT,
            last_ok_at TEXT
        );
        """
    )
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _iso(moment: datetime.datetime) -> str:
    return moment.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: Optional[str]) -> Optional[datetime.datetime]:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(datetime.timezone.utc)
    except ValueError:
        return None


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _all_feeds() -> List[dict]:
    raw = os.getenv("SAGE_RADAR_FEEDS", "").strip()
    if raw:
        try:
            custom = json.loads(raw)
            if isinstance(custom, list) and all(isinstance(f, dict) and f.get("name") and f.get("url") for f in custom):
                return custom
        except ValueError:
            pass
        print("SAGE_RADAR_FEEDS is not a JSON list of {name, url}; using the default feeds.")
    return DEFAULT_FEEDS


def feeds() -> List[dict]:
    """The feeds to read now: without the Indian ones when India is switched off."""
    if get_settings()["india"]:
        return _all_feeds()
    return [f for f in _all_feeds() if f.get("region") != INDIA]


def india_sources() -> List[str]:
    return [f["name"] for f in _all_feeds() if f.get("region") == INDIA]


def quotes() -> list:
    """Indian markets first when India is on, then the world's."""
    return (INDIA_QUOTES if get_settings()["india"] else []) + QUOTES


# --- Tagging ---

def tag_title(title: str) -> List[str]:
    return [tag for tag in TAG_ORDER if any(p.search(title) for p in _TAG_PATTERNS[tag])]


def guess_region(title: str, source_region: Optional[str]) -> str:
    """The region a title names most, else the source's own, else Global."""
    best, best_hits = None, 0
    for region in REGION_ORDER:
        hits = sum(1 for p in _REGION_PATTERNS[region] if p.search(title))
        if hits > best_hits:
            best, best_hits = region, hits
    return best or source_region or "Global"


# --- Feed parsing ---

ATOM = "{http://www.w3.org/2005/Atom}"


def _text(node: Optional[ET.Element]) -> str:
    if node is None:
        return ""
    raw = "".join(node.itertext())
    raw = re.sub(r"<[^>]+>", "", html.unescape(raw))
    return re.sub(r"\s+", " ", raw).strip()


def _when(value: str, now: datetime.datetime) -> datetime.datetime:
    value = (value or "").strip()
    moment = None
    if value:
        try:
            moment = email.utils.parsedate_to_datetime(value)
        except (TypeError, ValueError):
            moment = _parse_iso(value)
    if moment is None:
        return now
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    # A feed with a clock in the future would otherwise stay on top for days.
    return min(moment.astimezone(datetime.timezone.utc), now)


def parse_feed(content: bytes, now: Optional[datetime.datetime] = None) -> List[dict]:
    """RSS 2.0 or Atom to [{title, link, published}]. Raises ValueError if it's neither."""
    now = now or _utcnow()
    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        raise ValueError(f"not a feed ({e})") from None
    items = []
    if root.tag == f"{ATOM}feed":
        for entry in root.findall(f"{ATOM}entry"):
            link = ""
            for candidate in entry.findall(f"{ATOM}link"):
                if candidate.get("rel", "alternate") == "alternate":
                    link = candidate.get("href", "")
                    break
            published = _text(entry.find(f"{ATOM}published")) or _text(entry.find(f"{ATOM}updated"))
            items.append({"title": _text(entry.find(f"{ATOM}title")), "link": link.strip(), "published": _when(published, now)})
    else:
        channel = root.find("channel")
        if channel is None:
            raise ValueError(f"not a feed (root is <{root.tag}>)")
        for item in channel.findall("item"):
            items.append({
                "title": _text(item.find("title")),
                "link": _text(item.find("link")) or _text(item.find("guid")),
                "published": _when(_text(item.find("pubDate")), now),
            })
    return [i for i in items if i["title"] and i["link"].startswith(("http://", "https://"))]


def _signal_id(link: str) -> str:
    return hashlib.sha1(link.encode()).hexdigest()[:16]


# --- Fetching ---

def _record_source(conn, name: str, kind: str, ok: bool, items: int, error: str, now: datetime.datetime) -> None:
    conn.execute(
        """
        INSERT INTO radar_sources (name, kind, ok, items, error, checked_at, last_ok_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            kind = excluded.kind, ok = excluded.ok, items = excluded.items, error = excluded.error,
            checked_at = excluded.checked_at,
            last_ok_at = COALESCE(excluded.last_ok_at, radar_sources.last_ok_at)
        """,
        (name, kind, int(ok), items, error, _iso(now), _iso(now) if ok else None),
    )


def _short_error(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        return f"HTTP {e.response.status_code}"
    if isinstance(e, httpx.TimeoutException):
        return "timed out"
    if isinstance(e, httpx.RequestError):
        return "can't reach it"
    return str(e)[:160] or e.__class__.__name__


async def _fetch_feed(client: httpx.AsyncClient, feed: dict, now: datetime.datetime):
    try:
        resp = await client.get(feed["url"])
        resp.raise_for_status()
        return feed, parse_feed(resp.content, now), ""
    except Exception as e:
        return feed, [], _short_error(e)


async def refresh_feeds(client: Optional[httpx.AsyncClient] = None, now: Optional[datetime.datetime] = None) -> int:
    """Fetch every feed; returns how many new headlines were stored."""
    now = now or _utcnow()
    own = client is None
    client = client or _client()
    try:
        results = await asyncio.gather(*[_fetch_feed(client, f, now) for f in feeds()])
    finally:
        if own:
            await client.aclose()
    added = 0
    conn = _db()
    try:
        for feed, items, error in results:
            # An empty feed is as suspicious as a failed one.
            ok = not error and bool(items)
            _record_source(conn, feed["name"], "news", ok, len(items), error or ("" if items else "no headlines"), now)
            for item in items:
                cur = conn.execute(
                    "INSERT OR IGNORE INTO radar_signals (id, source, title, link, published, seen_at, region, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        _signal_id(item["link"]), feed["name"], item["title"][:400], item["link"],
                        _iso(item["published"]), _iso(now),
                        guess_region(item["title"], feed.get("region")), json.dumps(tag_title(item["title"])),
                    ),
                )
                added += cur.rowcount
        conn.execute("DELETE FROM radar_signals WHERE seen_at < ?", (_iso(now - datetime.timedelta(days=KEEP_DAYS)),))
        conn.commit()
    finally:
        conn.close()
    return added


def parse_chart(data: dict) -> dict:
    """Yahoo's chart JSON to {price, changePct, closes}. Raises ValueError when empty."""
    try:
        result = data["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        error = (data.get("chart") or {}).get("error") if isinstance(data, dict) else None
        raise ValueError((error or {}).get("description") or "no chart data") from None
    closes = [c for c in ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [] if c is not None]
    meta = result.get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None and closes:
        price = closes[-1]
    if price is None:
        raise ValueError("no price")
    # The last daily bar is today's, so the one before it is the previous close.
    previous = closes[-2] if len(closes) >= 2 else meta.get("chartPreviousClose")
    change = (price - previous) / previous * 100 if previous else None
    return {"price": float(price), "changePct": None if change is None else round(change, 2), "closes": [round(c, 4) for c in closes[-7:]]}


async def _fetch_quote(client: httpx.AsyncClient, symbol: str):
    try:
        resp = await client.get(YAHOO_CHART.format(symbol=symbol), params={"range": "10d", "interval": "1d"})
        resp.raise_for_status()
        return symbol, parse_chart(resp.json()), ""
    except Exception as e:
        return symbol, None, _short_error(e)


async def refresh_quotes(client: Optional[httpx.AsyncClient] = None, now: Optional[datetime.datetime] = None) -> int:
    """Fetch every market; returns how many prices were updated."""
    now = now or _utcnow()
    own = client is None
    client = client or _client()
    try:
        markets = quotes()
        results = await asyncio.gather(*[_fetch_quote(client, symbol) for symbol, _, _ in markets])
    finally:
        if own:
            await client.aclose()
    labels = {symbol: (name, unit) for symbol, name, unit in markets}
    failed = [f"{labels[s][0]}: {err}" for s, quote, err in results if quote is None]
    updated = 0
    conn = _db()
    try:
        for symbol, quote, _ in results:
            if quote is None:
                continue  # keep the last good price rather than blanking it
            name, unit = labels[symbol]
            conn.execute(
                "INSERT OR REPLACE INTO radar_quotes (symbol, name, unit, price, change_pct, closes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (symbol, name, unit, quote["price"], quote["changePct"], json.dumps(quote["closes"]), _iso(now)),
            )
            updated += 1
        # Markets are one source: Yahoo. Half the symbols failing is still worth a warning.
        error = "; ".join(failed[:3]) + (f" (+{len(failed) - 3} more)" if len(failed) > 3 else "")
        _record_source(conn, "Yahoo markets", "markets", updated > 0, updated, error, now)
        conn.commit()
    finally:
        conn.close()
    return updated


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": USER_AGENT})


# --- Reading ---

def _velocity(conn, now: datetime.datetime) -> dict:
    recent_start = now - datetime.timedelta(hours=RECENT_HOURS)
    first = conn.execute("SELECT MIN(seen_at) FROM radar_signals").fetchone()[0]
    first_seen = _parse_iso(first)
    history_start = max(first_seen, now - datetime.timedelta(days=KEEP_DAYS)) if first_seen else recent_start
    baseline_days = (recent_start - history_start).total_seconds() / 86400
    learning = baseline_days < 1
    recent = {tag: 0 for tag in TAG_ORDER}
    baseline = {tag: 0 for tag in TAG_ORDER}
    rows = conn.execute(
        "SELECT published, tags FROM radar_signals WHERE published >= ?", (_iso(min(history_start, recent_start)),)
    ).fetchall()
    for row in rows:
        published = row["published"]
        bucket = recent if published >= _iso(recent_start) else baseline
        for tag in json.loads(row["tags"] or "[]"):
            if tag in bucket:
                bucket[tag] += 1
    tags = []
    for tag in TAG_ORDER:
        daily = baseline[tag] / baseline_days if not learning else 0
        speed = round(recent[tag] / (2 * daily), 1) if daily > 0 else None
        tags.append({"tag": tag, "recent": recent[tag], "velocity": speed})
    tags.sort(key=lambda t: (t["velocity"] is None, -(t["velocity"] or 0), -t["recent"]))
    ready_on = None
    if learning and first_seen:
        ready_on = _iso(first_seen + datetime.timedelta(hours=RECENT_HOURS, days=1))
    return {"learning": learning, "readyOn": ready_on, "tags": tags}


def _headline(velocity: dict, sources: List[dict], total: int) -> str:
    rising = [t for t in velocity["tags"] if (t["velocity"] or 0) >= RISING]
    down = [s["name"] for s in sources if not s["ok"]]
    if not sources and not total:
        return "Radar is fetching its first headlines and prices."
    if rising:
        top = rising[0]
        line = f"{top['tag']} news is running {top['velocity']:g}x its usual pace."
        if len(rising) > 1:
            line += f" {rising[1]['tag']} is up too."
    elif velocity["learning"]:
        line = "Radar is learning your usual news pace, so it shows counts for now."
    else:
        line = "News is at its usual pace today."
    if down:
        line += f" {len(down)} source{'s are' if len(down) > 1 else ' is'} down."
    return line


def summary(now: Optional[datetime.datetime] = None) -> dict:
    now = now or _utcnow()
    conn = _db()
    try:
        order = {symbol: i for i, (symbol, _, _) in enumerate(quotes())}
        ticker = sorted(
            (
                {
                    "symbol": r["symbol"], "name": r["name"], "unit": r["unit"], "price": r["price"],
                    "changePct": r["change_pct"], "closes": json.loads(r["closes"] or "[]"), "updatedAt": r["updated_at"],
                }
                for r in conn.execute("SELECT * FROM radar_quotes")
                if r["symbol"] in order
            ),
            key=lambda q: order[q["symbol"]],
        )
        known = {f["name"] for f in feeds()} | {"Yahoo markets", "Markets board"}
        sources = [
            {
                "name": r["name"], "kind": r["kind"], "ok": bool(r["ok"]), "items": r["items"],
                "error": r["error"] or "", "checkedAt": r["checked_at"], "lastOkAt": r["last_ok_at"],
            }
            for r in conn.execute("SELECT * FROM radar_sources ORDER BY kind DESC, name")
            if r["name"] in known
        ]
        velocity = _velocity(conn, now)
        new_24h = conn.execute(
            "SELECT COUNT(*) FROM radar_signals WHERE published >= ?", (_iso(now - datetime.timedelta(hours=24)),)
        ).fetchone()[0]
        total = conn.execute("SELECT COUNT(*) FROM radar_signals").fetchone()[0]
        checked = [s["checkedAt"] for s in sources if s["checkedAt"]]
    finally:
        conn.close()
    return {
        "success": True,
        "enabled": ENABLED,
        "updatedAt": max(checked) if checked else None,
        "headline": _headline(velocity, sources, total),
        "ticker": ticker,
        "velocity": velocity,
        "sources": sources,
        "new24h": new_24h,
        "regions": ["Global", *REGION_ORDER],
        "tags": TAG_ORDER,
    }


def signals(region: str = "", tag: str = "", limit: int = 60, now: Optional[datetime.datetime] = None) -> List[dict]:
    """Newest first. region "" or "Global" means every region."""
    now = now or _utcnow()
    limit = max(1, min(int(limit or 60), 200))
    conn = _db()
    try:
        rising_tags = {t["tag"] for t in _velocity(conn, now)["tags"] if (t["velocity"] or 0) >= RISING}
        sql = "SELECT * FROM radar_signals"
        args: list = []
        if region == INDIA:
            # Everything from an Indian source counts, whatever it names.
            names = india_sources()
            sql += f" WHERE region = ? OR source IN ({', '.join('?' * len(names))})" if names else " WHERE region = ?"
            args += [INDIA, *names]
        elif region and region != "Global":
            sql += " WHERE region = ?"
            args.append(region)
        sql += " ORDER BY published DESC"
        # With India off, what the Indian sources already sent is hidden too.
        hidden = set() if get_settings()["india"] else set(india_sources())
        out = []
        for r in conn.execute(sql, args):
            if r["source"] in hidden:
                continue
            tags = json.loads(r["tags"] or "[]")
            if tag and tag not in tags:
                continue
            out.append({
                "id": r["id"], "source": r["source"], "title": r["title"], "link": r["link"],
                "published": r["published"], "region": r["region"], "tags": tags,
                "rising": any(t in rising_tags for t in tags),
            })
            if len(out) >= limit:
                break
        return out
    finally:
        conn.close()


# --- Settings ---

# brief: the Radar card on Today (off until switched on). dailyCap: research runs
# a day. engine: which AI researches first, Groq (free) or Claude (paid).
# lumoLine: a Radar line on the desk clock's Tasks screen in the morning.
# india: Indian news sources and markets (on unless switched off).
DEFAULT_SETTINGS = {"brief": False, "dailyCap": 5, "engine": "groq", "lumoLine": False, "india": True}


def get_settings() -> dict:
    conn = _db()
    try:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM radar_settings")}
    finally:
        conn.close()
    out = dict(DEFAULT_SETTINGS)
    for key, raw in rows.items():
        if key in out:
            try:
                out[key] = json.loads(raw)
            except ValueError:
                pass
    return out


def update_settings(changes: dict) -> dict:
    """Only known keys, each checked; anything else is ignored."""
    clean = {}
    if isinstance(changes.get("brief"), bool):
        clean["brief"] = changes["brief"]
    if isinstance(changes.get("lumoLine"), bool):
        clean["lumoLine"] = changes["lumoLine"]
    if isinstance(changes.get("india"), bool):
        clean["india"] = changes["india"]
    if changes.get("engine") in ("groq", "claude"):
        clean["engine"] = changes["engine"]
    cap = changes.get("dailyCap")
    if isinstance(cap, (int, float)) and not isinstance(cap, bool):
        clean["dailyCap"] = max(0, min(50, int(cap)))
    if clean:
        conn = _db()
        try:
            conn.executemany(
                "INSERT OR REPLACE INTO radar_settings (key, value) VALUES (?, ?)",
                [(k, json.dumps(v)) for k, v in clean.items()],
            )
            conn.commit()
        finally:
            conn.close()
    return get_settings()


# --- Brief (Today card and the desk clock) ---

def brief(now: Optional[datetime.datetime] = None) -> dict:
    """Three signals worth a look today, the biggest market move and the
    hottest topic. Rising headlines come first, then the newest."""
    now = now or _utcnow()
    data = summary(now)
    day_ago = _iso(now - datetime.timedelta(hours=24))
    recent = [s for s in signals(limit=80, now=now) if s["published"] >= day_ago]
    picks = sorted(recent, key=lambda s: (not s["rising"], -len(s["tags"])))[:3]
    moves = [q for q in data["ticker"] if q["changePct"] is not None]
    move = max(moves, key=lambda q: abs(q["changePct"]), default=None)
    rising = [t for t in data["velocity"]["tags"] if (t["velocity"] or 0) >= RISING]
    return {
        "success": True,
        "enabled": get_settings()["brief"],
        "headline": data["headline"],
        "signals": picks,
        "move": move,
        "trend": rising[0] if rising else None,
    }


def lumo_line(now: Optional[datetime.datetime] = None) -> Optional[str]:
    """One short line for the clock, e.g. "Radar: Regulation 3.1x, Crude -1.2%"."""
    if not get_settings()["lumoLine"]:
        return None
    data = brief(now)
    parts = []
    if data["trend"]:
        parts.append(f"{data['trend']['tag']} {data['trend']['velocity']:g}x")
    move = data["move"]
    if move and move["changePct"] is not None:
        parts.append(f"{move['name']} {'+' if move['changePct'] >= 0 else ''}{move['changePct']:.1f}%")
    return "Radar: " + ", ".join(parts) if parts else None


# --- Background loop ---

class Collector:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.feeds_at: Optional[datetime.datetime] = None
        self.quotes_at: Optional[datetime.datetime] = None
        self.manual_at: Optional[datetime.datetime] = None
        self.broadcast: Optional[Callable[[dict], Awaitable[None]]] = None

    @staticmethod
    def market_open(now: datetime.datetime) -> bool:
        """New York's hours, or Mumbai's while India is on."""
        local = now.astimezone(NEW_YORK)
        if local.weekday() < 5 and datetime.time(9, 30) <= local.time() <= datetime.time(16, 0):
            return True
        india = now.astimezone(KOLKATA)
        return (
            india.weekday() < 5 and datetime.time(9, 15) <= india.time() <= datetime.time(15, 30)
            and get_settings()["india"]
        )

    async def tick(self, now: datetime.datetime, force: bool = False) -> bool:
        changed = False
        async with self.lock:
            if force or not self.feeds_at or now - self.feeds_at >= FEED_EVERY:
                self.feeds_at = now
                await refresh_feeds(now=now)
                changed = True
            every = QUOTES_EVERY_OPEN if self.market_open(now) else QUOTES_EVERY_CLOSED
            if force or not self.quotes_at or now - self.quotes_at >= every:
                self.quotes_at = now
                await refresh_quotes(now=now)
                changed = True
        if changed and self.broadcast:
            await self.broadcast({"type": "RADAR_UPDATED"})
        return changed

    async def refresh_now(self) -> bool:
        """For the Refresh button. False when the last one was under a minute ago."""
        now = _utcnow()
        if self.manual_at and now - self.manual_at < MIN_MANUAL_GAP:
            return False
        self.manual_at = now
        await self.tick(now, force=True)
        return True

    async def run(self, broadcast: Callable[[dict], Awaitable[None]]) -> None:
        self.broadcast = broadcast
        await asyncio.sleep(5)  # let the server finish starting first
        while True:
            try:
                await self.tick(_utcnow())
            except Exception as e:
                print(f"Radar fetch failed: {e}")
            await asyncio.sleep(30)


collector = Collector()


# --- Routes ---

router = APIRouter()


@router.get("/api/radar/summary")
def radar_summary():
    return summary()


@router.get("/api/radar/signals")
def radar_signals(region: str = "", tag: str = "", limit: int = 60):
    return {"success": True, "signals": signals(region, tag, limit)}


@router.get("/api/radar/brief")
def radar_brief():
    return brief()


@router.get("/api/radar/settings")
def radar_settings():
    return {"success": True, "settings": get_settings()}


@router.put("/api/radar/settings")
def radar_settings_update(changes: Dict[str, Any]):
    return {"success": True, "settings": update_settings(changes)}


@router.post("/api/radar/refresh")
async def radar_refresh():
    refreshed = await collector.refresh_now()
    return {**summary(), "refreshed": refreshed}
