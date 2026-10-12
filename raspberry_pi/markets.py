"""
Radar Markets: how every industry is doing, and why it moved.

The board covers three views:
  US      11 sectors (SPDR sector funds), each with 2-4 industry funds
  India   10 Nifty sector indices
  Global  10 country indices
plus 8 gauges per view (stocks, rates, the dollar or rupee, oil, gold, fear, bitcoin).

Prices come from Yahoo's chart data, like the rest of Radar. Each symbol keeps
about a year of daily closes in a cache table (`market_series`) that never
syncs. A full year is fetched once a day; in between only the last 5 days are
fetched and merged in. A view refreshes every 20 minutes while its market is
open and every 3 hours otherwise, a few symbols at a time, so Yahoo isn't
hammered. A symbol that fails keeps its last good closes.

Why it moved, in three layers:
  1. Math. Each sector's daily returns over the last year are fitted against
     the market, oil, the US 10-year yield and the dollar (plain least
     squares). A move is then split into those parts plus a leftover.
  2. Evidence. Radar's own headlines that match the sector in the same
     window, and the move of the sector's biggest company.
  3. Words. Rules turn the biggest parts into short reasons straight away.
     When an AI is set up (the same Groq -> Claude -> local chooser as
     Studio), it rewrites them using only the numbered evidence, at most once
     every 30 minutes for 1D (6 hours for longer ranges) and 40 times a day.
     A reason that cites a headline and a number is High confidence, one kind
     is Medium, timing alone is Low. A big leftover with no reason says
     "No clear reason yet" instead of guessing.

Weights are approximate shares of each market, kept here by hand; they size
the heat map and the "who added the points" list.
"""

import asyncio
import datetime
import json
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter

import radar

RANGES = ["1D", "1W", "1M", "YTD"]
# Trading days back for each range (YTD is worked out from the calendar).
RANGE_DAYS = {"1D": 1, "1W": 5, "1M": 21}
# The news window each range looks at, in hours (Radar keeps 30 days).
NEWS_HOURS = {"1D": 30, "1W": 7 * 24, "1M": 30 * 24, "YTD": 30 * 24}
# Below this move (in %) a sector doesn't need a reason; the whole market moves less, so its bar is lower.
QUIET = {"1D": 0.5, "1W": 1.0, "1M": 2.0, "YTD": 4.0}
MARKET_QUIET = {k: v / 2 for k, v in QUIET.items()}

HISTORY_EVERY = datetime.timedelta(hours=20)
OPEN_EVERY = datetime.timedelta(minutes=20)
CLOSED_EVERY = datetime.timedelta(hours=3)
AI_GAP = {"1D": datetime.timedelta(minutes=30)}
AI_GAP_LONG = datetime.timedelta(hours=6)
AI_DAILY_CAP = 40
CONCURRENCY = 3
KEEP_CLOSES = 300
MIN_FIT_DAYS = 60

# (symbol, label, unit)
GAUGES: Dict[str, List[Tuple[str, str, str]]] = {
    "US": [
        ("^GSPC", "S&P 500", "index"), ("^NDX", "Nasdaq 100", "index"), ("^TNX", "10Y yield", "pct"),
        ("DX-Y.NYB", "Dollar", "index"), ("CL=F", "Crude oil", "usd"), ("GC=F", "Gold", "usd"),
        ("^VIX", "VIX (fear)", "index"), ("BTC-USD", "Bitcoin", "usd"),
    ],
    "India": [
        ("^NSEI", "Nifty 50", "index"), ("^BSESN", "Sensex", "index"), ("^NSEBANK", "Nifty Bank", "index"),
        ("INR=X", "USD/INR", "inr"), ("^INDIAVIX", "India VIX", "index"), ("CL=F", "Crude oil", "usd"),
        ("GC=F", "Gold", "usd"), ("^TNX", "US 10Y", "pct"),
    ],
    "Global": [
        ("ACWI", "World (ACWI)", "usd"), ("^GSPC", "S&P 500", "index"), ("^TNX", "10Y yield", "pct"),
        ("DX-Y.NYB", "Dollar", "index"), ("CL=F", "Crude oil", "usd"), ("GC=F", "Gold", "usd"),
        ("^VIX", "VIX (fear)", "index"), ("BTC-USD", "Bitcoin", "usd"),
    ],
}

# The factors a view's moves are split by: (key, symbol, label).
FACTORS: Dict[str, List[Tuple[str, str, str]]] = {
    "US": [("market", "^GSPC", "the S&P 500"), ("oil", "CL=F", "oil"), ("rates", "^TNX", "the 10-year yield"), ("dollar", "DX-Y.NYB", "the dollar")],
    "India": [("market", "^NSEI", "the Nifty 50"), ("oil", "CL=F", "oil"), ("rates", "^TNX", "the US 10-year yield"), ("dollar", "INR=X", "the dollar against the rupee")],
    "Global": [("market", "ACWI", "world stocks"), ("oil", "CL=F", "oil"), ("rates", "^TNX", "the US 10-year yield"), ("dollar", "DX-Y.NYB", "the dollar")],
}
FACTOR_NAMES = {"market": "Market", "oil": "Oil", "rates": "Rates", "dollar": "Dollar"}

# name, symbol, weight %, Radar tag, words a headline can match, biggest company, industries [(name, symbol)]
US_SECTORS = [
    ("Technology", "XLK", 31, "AI", ["chip", "chips", "semiconductor", "software", "cloud", "Nvidia", "Apple", "Microsoft", "AI"], "NVDA",
     [("Semiconductors", "SOXX"), ("Software", "IGV"), ("Cybersecurity", "CIBR"), ("Cloud", "SKYY")]),
    ("Financials", "XLF", 13, "Fintech", ["bank", "banks", "lender", "lenders", "insurer", "insurers", "payments", "fintech", "JPMorgan", "deposit", "deposits"], "JPM",
     [("Banks", "KBE"), ("Regional banks", "KRE"), ("Insurance", "KIE"), ("Fintech", "FINX")]),
    ("Health care", "XLV", 10, "Health", ["drug", "drugs", "pharma", "biotech", "FDA", "hospital", "hospitals", "Eli Lilly", "obesity", "vaccine"], "LLY",
     [("Biotech", "XBI"), ("Pharma", "PPH"), ("Medical devices", "IHI")]),
    ("Consumer", "XLY", 10, "", ["retail", "retailer", "retailers", "shoppers", "Amazon", "Tesla", "airline", "airlines", "housing", "homebuilder", "homebuilders"], "AMZN",
     [("Retail", "XRT"), ("Homebuilders", "XHB"), ("Airlines", "JETS"), ("Autos", "CARZ")]),
    ("Communication", "XLC", 9, "", ["Meta", "Alphabet", "Google", "Netflix", "telecom", "streaming", "advertising", "gaming"], "META",
     [("Media", "PBS"), ("Telecom", "IYZ"), ("Gaming", "ESPO")]),
    ("Industrials", "XLI", 8.5, "Defense", ["defense", "aerospace", "Boeing", "airplane", "freight", "rail", "trucking", "infrastructure", "factory", "manufacturing"], "GE",
     [("Aerospace & defense", "ITA"), ("Transport", "IYT"), ("Infrastructure", "PAVE")]),
    ("Staples", "XLP", 5.5, "", ["grocery", "groceries", "food", "beverage", "Walmart", "Costco", "Procter", "consumer staples"], "COST",
     [("Food & beverage", "PBJ"), ("Agribusiness", "MOO")]),
    ("Energy", "XLE", 3.3, "Climate", ["oil", "crude", "OPEC", "gas", "Exxon", "Chevron", "refinery", "solar", "uranium", "Red Sea"], "XOM",
     [("Oil & gas", "XOP"), ("Oil services", "OIH"), ("Clean energy", "ICLN"), ("Uranium", "URA")]),
    ("Utilities", "XLU", 2.5, "Climate", ["utility", "utilities", "power grid", "electricity", "power demand"], "NEE",
     [("Power grid", "GRID"), ("Water", "PHO")]),
    ("Real estate", "XLRE", 2.2, "", ["real estate", "REIT", "REITs", "office", "landlord", "landlords", "mortgage", "data center", "data centers"], "PLD",
     [("Data centers", "SRVR"), ("Housing REITs", "REZ")]),
    ("Materials", "XLB", 1.9, "Supply chain", ["copper", "steel", "lithium", "mining", "miners", "metals", "chemicals", "gold"], "LIN",
     [("Metals & mining", "XME"), ("Gold miners", "GDX"), ("Lithium", "LIT")]),
]
INDIA_SECTORS = [
    ("Banks", "^NSEBANK", 28, "Fintech", ["bank", "banks", "RBI", "lender", "lenders", "HDFC", "ICICI", "SBI", "deposit"], "HDFCBANK.NS", []),
    ("IT", "^CNXIT", 13, "AI", ["IT", "Infosys", "TCS", "Wipro", "HCL", "software", "outsourcing", "AI"], "INFY.NS", []),
    ("Financial services", "NIFTY_FIN_SERVICE.NS", 12, "Fintech", ["NBFC", "Bajaj Finance", "insurer", "insurance", "fintech", "UPI", "SEBI"], "BAJFINANCE.NS", []),
    ("Energy", "^CNXENERGY", 11, "Climate", ["oil", "crude", "Reliance", "ONGC", "power", "gas", "solar"], "RELIANCE.NS", []),
    ("FMCG", "^CNXFMCG", 9, "", ["FMCG", "Hindustan Unilever", "ITC", "Nestle", "consumer", "rural demand"], "HINDUNILVR.NS", []),
    ("Auto", "^CNXAUTO", 8, "", ["auto", "car", "cars", "Maruti", "Tata Motors", "Mahindra", "EV", "two-wheeler"], "MARUTI.NS", []),
    ("Pharma", "^CNXPHARMA", 6, "Health", ["pharma", "drug", "drugs", "Sun Pharma", "Cipla", "USFDA", "FDA"], "SUNPHARMA.NS", []),
    ("Metal", "^CNXMETAL", 4, "Supply chain", ["steel", "metal", "metals", "Tata Steel", "JSW", "Hindalco", "copper", "aluminium"], "TATASTEEL.NS", []),
    ("Realty", "^CNXREALTY", 2, "", ["real estate", "realty", "housing", "DLF", "property"], "DLF.NS", []),
    ("Media", "^CNXMEDIA", 1, "", ["media", "Zee", "broadcaster", "streaming"], "", []),
]
GLOBAL_MARKETS = [
    ("United States", "^GSPC", 30, "", ["Wall Street", "Fed", "US stocks", "S&P"], "", []),
    ("Europe", "^STOXX", 14, "", ["Europe", "European", "ECB", "euro zone", "eurozone"], "", []),
    ("Japan", "^N225", 9, "", ["Japan", "Japanese", "Nikkei", "BOJ", "yen"], "", []),
    ("China", "000300.SS", 9, "", ["China", "Chinese", "Beijing", "yuan", "PBOC"], "", []),
    ("India", "^NSEI", 8, "", ["India", "Indian", "Nifty", "Sensex", "RBI", "rupee"], "", []),
    ("United Kingdom", "^FTSE", 6, "", ["UK", "Britain", "British", "FTSE", "Bank of England", "pound"], "", []),
    ("Emerging", "EEM", 5, "", ["emerging markets", "Brazil", "Mexico", "Indonesia", "South Africa"], "", []),
    ("Hong Kong", "^HSI", 5, "", ["Hong Kong", "Hang Seng"], "", []),
    ("South Korea", "^KS11", 4, "", ["Korea", "Korean", "KOSPI", "Samsung", "SK Hynix"], "", []),
    ("Brazil", "^BVSP", 3, "", ["Brazil", "Brazilian", "Bovespa", "real"], "", []),
]
VIEWS = {"US": US_SECTORS, "India": INDIA_SECTORS, "Global": GLOBAL_MARKETS}
NOUN = {"US": "sectors", "India": "sectors", "Global": "markets"}
# Market hours decide how often a view refreshes.
HOURS = {
    "US": (radar.NEW_YORK, datetime.time(9, 30), datetime.time(16, 0)),
    "India": (radar.KOLKATA, datetime.time(9, 15), datetime.time(15, 30)),
}

DB_PATH = "sage_sync.db"
_broadcast = None


# --- Which symbols ---

def regions() -> List[str]:
    """India's view only while India is on in Settings > Radar."""
    return [r for r in ("US", "India", "Global") if r != "India" or radar.get_settings()["india"]]


def view_symbols(region: str) -> List[str]:
    out = [s for s, _, _ in GAUGES[region]] + [s for _, s, _ in FACTORS[region]]
    for _, symbol, _, _, _, top, industries in VIEWS[region]:
        out.append(symbol)
        if top:
            out.append(top)
        out += [s for _, s in industries]
    return list(dict.fromkeys(out))


def is_open(region: str, now: datetime.datetime) -> bool:
    if region == "Global":
        return any(is_open(r, now) for r in HOURS if r in regions())
    zone, start, end = HOURS[region]
    local = now.astimezone(zone)
    return local.weekday() < 5 and start <= local.time() <= end


# --- Storage ---

def connect(db_path: str, broadcast=None) -> None:
    global DB_PATH, _broadcast
    DB_PATH, _broadcast = db_path, broadcast
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS market_series (
            symbol TEXT PRIMARY KEY,
            closes TEXT,
            updated_at TEXT,
            history_at TEXT,
            error TEXT
        );
        CREATE TABLE IF NOT EXISTS market_why (
            key TEXT PRIMARY KEY,
            payload TEXT,
            prices_at TEXT,
            written_at TEXT
        );
        """
    )
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def load_series(symbols: List[str]) -> Dict[str, List[Tuple[str, float]]]:
    conn = _db()
    try:
        marks = ", ".join("?" * len(symbols))
        rows = conn.execute(f"SELECT symbol, closes FROM market_series WHERE symbol IN ({marks})", symbols).fetchall()
    finally:
        conn.close()
    return {r["symbol"]: [(d, float(c)) for d, c in json.loads(r["closes"] or "[]")] for r in rows}


# --- Fetching ---

def parse_series(data: dict) -> List[Tuple[str, float]]:
    """Yahoo's chart JSON to [(YYYY-MM-DD, close)], oldest first, in the
    exchange's own days. The live price stands in for today's close."""
    try:
        result = data["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        error = (data.get("chart") or {}).get("error") if isinstance(data, dict) else None
        raise ValueError((error or {}).get("description") or "no chart data") from None
    meta = result.get("meta") or {}
    offset = int(meta.get("gmtoffset") or 0)
    stamps = result.get("timestamp") or []
    closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []

    def day(ts: int) -> str:
        return datetime.datetime.fromtimestamp(ts + offset, datetime.timezone.utc).date().isoformat()

    out: Dict[str, float] = {}
    for ts, close in zip(stamps, closes):
        if close is not None and ts is not None:
            out[day(int(ts))] = float(close)
    price, when = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
    if price is not None and when:
        out[day(int(when))] = float(price)
    if not out:
        raise ValueError("no prices")
    return sorted(out.items())


def merge(old: List[Tuple[str, float]], new: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    both = dict(old)
    both.update(dict(new))
    return sorted(both.items())[-KEEP_CLOSES:]


async def _fetch(client: httpx.AsyncClient, symbol: str, full: bool, gate: asyncio.Semaphore):
    async with gate:
        try:
            data = await radar.yahoo_chart(client, symbol, {"range": "1y" if full else "5d", "interval": "1d"})
            return symbol, parse_series(data), ""
        except Exception as e:
            return symbol, None, radar._short_error(e)


async def refresh(symbols: List[str], client: Optional[httpx.AsyncClient] = None, now: Optional[datetime.datetime] = None) -> int:
    """Fetch these symbols; a year of closes when the last full fetch is old,
    else the last 5 days. Returns how many updated."""
    now = now or radar._utcnow()
    conn = _db()
    try:
        known = {r["symbol"]: r for r in conn.execute("SELECT * FROM market_series")}
    finally:
        conn.close()

    def needs_history(symbol: str) -> bool:
        row = known.get(symbol)
        when = radar._parse_iso(row["history_at"]) if row else None
        return not when or now - when >= HISTORY_EVERY

    own = client is None
    client = client or radar._client()
    gate = asyncio.Semaphore(CONCURRENCY)
    try:
        results = await asyncio.gather(*[_fetch(client, s, needs_history(s), gate) for s in symbols])
    finally:
        if own:
            await client.aclose()
    updated = 0
    failed = []
    conn = _db()
    try:
        for symbol, series, error in results:
            row = known.get(symbol)
            if series is None:
                failed.append(f"{symbol}: {error}")
                conn.execute(
                    "INSERT INTO market_series (symbol, closes, updated_at, history_at, error) VALUES (?, '[]', NULL, NULL, ?) "
                    "ON CONFLICT(symbol) DO UPDATE SET error = excluded.error",
                    (symbol, error),
                )
                continue
            full = needs_history(symbol)
            old = [(d, c) for d, c in json.loads(row["closes"] or "[]")] if row else []
            closes = series[-KEEP_CLOSES:] if full else merge(old, series)
            conn.execute(
                "INSERT OR REPLACE INTO market_series (symbol, closes, updated_at, history_at, error) VALUES (?, ?, ?, ?, '')",
                (symbol, json.dumps(closes), radar._iso(now), radar._iso(now) if full else (row["history_at"] if row else None)),
            )
            updated += 1
        error = "; ".join(failed[:3]) + (f" (+{len(failed) - 3} more)" if len(failed) > 3 else "")
        radar._record_source(conn, "Markets board", "markets", updated > 0, updated, error, now)
        conn.commit()
    finally:
        conn.close()
    return updated


# --- Numbers ---

def change(series: List[Tuple[str, float]], rng: str) -> Optional[float]:
    """Percent change over a range, or None without enough closes."""
    if len(series) < 2:
        return None
    last = series[-1][1]
    if rng == "YTD":
        year = series[-1][0][:4]
        before = [c for d, c in series if d[:4] < year]
        if not before:
            return None
        base = before[-1]
    else:
        back = RANGE_DAYS[rng]
        if len(series) <= back:
            return None
        base = series[-1 - back][1]
    return round((last / base - 1) * 100, 2) if base else None


def returns(series: List[Tuple[str, float]]) -> Dict[str, float]:
    """Daily returns in %, keyed by the later day."""
    out = {}
    for (_, a), (d, b) in zip(series, series[1:]):
        if a:
            out[d] = (b / a - 1) * 100
    return out


def solve(matrix: List[List[float]], vector: List[float]) -> Optional[List[float]]:
    """Gaussian elimination with partial pivoting; None when singular."""
    n = len(vector)
    a = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            return None
        a[col], a[pivot] = a[pivot], a[col]
        for r in range(n):
            if r != col:
                k = a[r][col] / a[col][col]
                for c in range(col, n + 1):
                    a[r][c] -= k * a[col][c]
    return [a[i][n] / a[i][i] for i in range(n)]


def fit(target: Dict[str, float], factors: Dict[str, Dict[str, float]]) -> Optional[Dict[str, float]]:
    """Least-squares sensitivities of target to each factor over the days they
    share (last 250). A little ridge keeps close factors from fighting."""
    keys = list(factors)
    if not keys:
        return None
    days = sorted(set(target).intersection(*[set(f) for f in factors.values()]))[-250:]
    if len(days) < MIN_FIT_DAYS:
        return None
    rows = [[1.0] + [factors[k][d] for k in keys] for d in days]
    ys = [target[d] for d in days]
    size = len(keys) + 1
    xtx = [[sum(r[i] * r[j] for r in rows) + (0.01 * len(days) if i == j and i > 0 else 0) for j in range(size)] for i in range(size)]
    xty = [sum(r[i] * y for r, y in zip(rows, ys)) for i in range(size)]
    beta = solve(xtx, xty)
    if beta is None:
        return None
    return {k: round(b, 3) for k, b in zip(keys, beta[1:])}


def split(actual: float, betas: Optional[Dict[str, float]], factor_moves: Dict[str, Optional[float]]) -> List[dict]:
    """The move in parts: each factor's share, then what is left."""
    if actual is None or not betas:
        return []
    parts = []
    for key, beta in betas.items():
        move = factor_moves.get(key)
        if move is None or abs(beta * move) < 0.02:
            continue  # too small to show
        parts.append({"key": key, "name": FACTOR_NAMES[key], "value": round(beta * move, 2), "beta": beta, "factorMove": move})
    left = round(actual - sum(p["value"] for p in parts), 2)
    parts.append({"key": "left", "name": "Not explained", "value": left})
    return parts


# --- Evidence and reasons ---

def _words(words: List[str]) -> List[re.Pattern]:
    return radar._pattern(words)


def _in_view(signal: dict, region: str, indian: set) -> bool:
    """US reads non-Indian news, India reads Indian news, Global reads all."""
    india = signal["region"] == radar.INDIA or signal["source"] in indian
    return region == "Global" or (india if region == "India" else not india)


def matching_news(words: List[str], tag: str, rng: str, now: datetime.datetime, region: str = "Global", limit: int = 3) -> List[dict]:
    since = radar._iso(now - datetime.timedelta(hours=NEWS_HOURS[rng]))
    patterns = _words(words)
    indian = set(radar.india_sources())
    found = []
    for s in radar.signals(limit=200, now=now):
        if s["published"] < since:
            break
        if not _in_view(s, region, indian):
            continue
        hits = sum(1 for p in patterns if p.search(s["title"])) + (1 if tag and tag in s["tags"] else 0)
        if hits:
            found.append((hits, s))
    found.sort(key=lambda pair: -pair[0])  # stable: newest first among equals
    return [s for _, s in found[:limit]]


def _pct(value: float) -> str:
    return f"{'+' if value > 0 else '−' if value < 0 else ''}{abs(value):.2f}%"


def _pts(value: float) -> str:
    return f"{'+' if value > 0 else '−' if value < 0 else ''}{abs(value):.2f}"


def _verb(value: float) -> str:
    return "rose" if value > 0 else "fell"


def rule_reasons(name: str, actual: Optional[float], parts: List[dict], top: Optional[Tuple[str, float]],
                 news: List[dict], rng: str, factor_labels: Dict[str, str], quiet: Optional[float] = None) -> List[dict]:
    """Reasons from the numbers alone, biggest first. Same-sign parts only."""
    if actual is None or abs(actual) < (QUIET[rng] if quiet is None else quiet):
        return []
    out = []
    for p in sorted([p for p in parts if p["key"] != "left"], key=lambda p: -abs(p["value"])):
        if p["value"] * actual <= 0 or abs(p["value"]) < max(0.15, abs(actual) * 0.25):
            continue
        label = factor_labels[p["key"]]
        text = (f"{label[0].upper() + label[1:]} {_verb(p['factorMove'])} {abs(p['factorMove']):.2f}%. "
                f"{name} usually moves {abs(p['beta']):.2g}× {'with' if p['beta'] > 0 else 'against'} it, which accounts for {_pts(p['value'])} points.")
        out.append({"title": f"{FACTOR_NAMES[p['key']]} moved", "text": text, "confidence": "Medium",
                    "evidence": [{"kind": "number", "label": f"{FACTOR_NAMES[p['key']]} {_pct(p['factorMove'])}"}]})
    if top and top[1] is not None and abs(top[1]) >= QUIET[rng] * 3 and top[1] * actual > 0:
        out.append({"title": f"{top[0].split('.')[0]} {_verb(top[1])}", "text": f"{top[0].split('.')[0]}, its biggest company, {_verb(top[1])} {abs(top[1]):.2f}%.",
                    "confidence": "Medium", "evidence": [{"kind": "number", "label": f"{top[0].split('.')[0]} {_pct(top[1])}"}]})
    left = next((p["value"] for p in parts if p["key"] == "left"), actual)
    if news:
        s = news[0]
        backed = left * actual > 0 and abs(left) >= abs(actual) * 0.3
        out.append({"title": "In the news", "text": s["title"], "confidence": "Medium" if backed else "Low",
                    "evidence": [{"kind": "headline", "label": s["source"], "link": s["link"], "published": s["published"]}]})
    if not out and abs(left) >= abs(actual) * 0.5:
        out.append({"title": "No clear reason yet", "text": "No headline or market move explains this yet. Radar keeps looking as news comes in.",
                    "confidence": "Low", "evidence": []})
    return out[:3]


# --- The board ---

def _weights(items) -> Dict[str, float]:
    total = sum(i[2] for i in items) or 1
    return {i[0]: i[2] / total * 100 for i in items}


def board(region: str = "US", rng: str = "1D", now: Optional[datetime.datetime] = None) -> dict:
    now = now or radar._utcnow()
    region = region if region in regions() else "US"
    rng = rng if rng in RANGES else "1D"
    items = VIEWS[region]
    series = load_series(view_symbols(region))
    conn = _db()
    try:
        stamps = [r["updated_at"] for r in conn.execute("SELECT updated_at FROM market_series WHERE updated_at IS NOT NULL")]
        health = conn.execute("SELECT ok, error FROM radar_sources WHERE name = 'Markets board'").fetchone()
    finally:
        conn.close()

    def ch(symbol: Optional[str]) -> Optional[float]:
        return change(series.get(symbol, []), rng) if symbol else None

    def spark(symbol: str) -> List[float]:
        return [round(c, 4) for _, c in series.get(symbol, [])[-30:]]

    factor_rets = {k: returns(series.get(s, [])) for k, s, _ in FACTORS[region]}
    factor_moves = {k: ch(s) for k, s, _ in FACTORS[region]}
    labels = {k: label for k, _, label in FACTORS[region]}
    market_symbol = FACTORS[region][0][1]

    def explain(name: str, symbol: str, actual: Optional[float], words: List[str], tag: str, top: str, quiet: Optional[float] = None) -> dict:
        own = {k: v for k, v in factor_rets.items() if not (k == "market" and symbol == market_symbol)}
        betas = fit(returns(series.get(symbol, [])), {k: v for k, v in own.items() if v}) if actual is not None else None
        parts = split(actual, betas, factor_moves) if betas else []
        news = matching_news(words, tag, rng, now, region)
        top_move = (top, ch(top)) if top else None
        return {
            "parts": parts,
            "reasons": rule_reasons(name, actual, parts, top_move, news, rng, labels, quiet),
            "news": [{"title": s["title"], "source": s["source"], "link": s["link"], "published": s["published"]} for s in news],
            "top": {"symbol": top.split(".")[0], "change": top_move[1]} if top_move and top_move[1] is not None else None,
        }

    weights = _weights(items)
    sectors = []
    for name, symbol, _, tag, words, top, industries in items:
        actual = ch(symbol)
        sectors.append({
            "name": name, "symbol": symbol, "weight": round(weights[name], 1), "tag": tag, "change": actual,
            "closes": spark(symbol),
            "industries": [{"name": n, "symbol": s, "change": ch(s), "closes": spark(s)} for n, s in industries],
            "why": explain(name, symbol, actual, words, tag, top),
        })

    gauges = []
    for symbol, label, unit in GAUGES[region]:
        s = series.get(symbol, [])
        gauges.append({"symbol": symbol, "name": label, "unit": unit, "price": s[-1][1] if s else None, "change": ch(symbol), "closes": spark(symbol)})

    known = [s for s in sectors if s["change"] is not None]
    pool = ([{"name": i["name"], "symbol": i["symbol"], "change": i["change"]} for s in sectors for i in s["industries"] if i["change"] is not None]
            if region == "US" else [{"name": s["name"], "symbol": s["symbol"], "change": s["change"]} for s in known])
    ordered = sorted(pool, key=lambda p: -p["change"])
    up = sum(1 for p in pool if p["change"] > 0)

    market_move = ch(market_symbol)
    points = [] if region == "Global" else sorted(({"name": s["name"], "value": round(s["weight"] / 100 * s["change"], 2)} for s in known), key=lambda p: -abs(p["value"]))[:5]
    market_why = explain(next((label for s, label, _ in GAUGES[region] if s == market_symbol), "The market"), market_symbol, market_move,
                         ["stocks", "Wall Street", "market", "markets", "Fed", "inflation", "CPI", "jobs report", "payrolls", "rate cut", "rates"], "", "",
                         quiet=MARKET_QUIET[rng])
    if region != "Global" and points and market_move is not None and abs(market_move) >= MARKET_QUIET[rng]:
        lead = [p for p in points if p["value"] * market_move > 0][:2]
        if lead:
            # The sectors explain it, so "no clear reason" no longer applies.
            market_why["reasons"] = [r for r in market_why["reasons"] if r["title"] != "No clear reason yet"]
            market_why["reasons"].insert(0, {
                "title": f"{lead[0]['name']} did the most",
                "text": " and ".join(f"{p['name']} added {_pts(p['value'])}" for p in lead) + f" of the {_pct(market_move)} move.",
                "confidence": "High", "evidence": [{"kind": "number", "label": f"{p['name']} {_pct(next(s['change'] for s in known if s['name'] == p['name']))}"} for p in lead],
            })
            market_why["reasons"] = market_why["reasons"][:3]
    market_why["points"] = points
    market_why["change"] = market_move

    ai = cached_ai(region, rng)
    if ai:
        for s in sectors:
            if ai["reasons"].get(s["name"]):
                s["why"]["reasons"] = ai["reasons"][s["name"]]
        if ai["reasons"].get("Market"):
            market_why["reasons"] = ai["reasons"]["Market"]

    span = {"1D": "today", "1W": "this week", "1M": "this month", "YTD": "this year"}[rng]
    if len(known) >= 2:
        best, worst = max(known, key=lambda s: s["change"]), min(known, key=lambda s: s["change"])
        headline = (f"{best['name']} leads ({_pct(best['change'])}), {worst['name'][0].lower() + worst['name'][1:] if region != 'Global' else worst['name']} lags ({_pct(worst['change'])}). "
                    f"{sum(1 for s in known if s['change'] > 0)} of {len(known)} {NOUN[region]} up {span}.")
    elif not stamps and health and not health["ok"]:
        # Saying "fetching" forever hides that Yahoo keeps saying no.
        headline = f"Radar can't get prices: Yahoo answered {health['error'] or 'with nothing'}. It keeps trying."
    elif not stamps:
        headline = "Radar is fetching the first prices. This takes a minute."
    else:
        headline = "Not enough prices yet for this range."

    return {
        "success": True,
        "region": region, "range": rng, "regions": regions(), "ranges": RANGES,
        "updatedAt": max(stamps) if stamps else None,
        "open": is_open(region, now),
        "headline": headline,
        "gauges": gauges,
        "sectors": sectors,
        "breadth": {"up": up, "down": len(pool) - up, "of": len(pool), "unit": "industries" if region == "US" else NOUN[region]},
        "leaders": ordered[:5],
        "laggards": list(reversed(ordered[-5:])) if len(ordered) > 5 else [],
        "why": market_why,
        "writer": ai["engine"] if ai else "rules",
        "writtenAt": ai["writtenAt"] if ai else None,
    }


# --- The AI layer ---

def cached_ai(region: str, rng: str) -> Optional[dict]:
    conn = _db()
    try:
        row = conn.execute("SELECT payload FROM market_why WHERE key = ?", (f"{region}|{rng}",)).fetchone()
    finally:
        conn.close()
    return json.loads(row["payload"]) if row else None


def _ai_runs_today(now: datetime.datetime) -> int:
    conn = _db()
    try:
        row = conn.execute("SELECT payload FROM market_why WHERE key = 'runs'").fetchone()
    finally:
        conn.close()
    data = json.loads(row["payload"]) if row else {}
    return data.get("count", 0) if data.get("day") == now.date().isoformat() else 0


def evidence_for(data: dict) -> Tuple[List[dict], Dict[str, List[int]]]:
    """Number every clue once; return the list and which clues belong to which item."""
    clues: List[dict] = []
    owned: Dict[str, List[int]] = {}

    def add(owner: str, clue: dict) -> None:
        for i, c in enumerate(clues):
            if c["text"] == clue["text"]:
                owned.setdefault(owner, []).append(i + 1)
                return
        clues.append(clue)
        owned.setdefault(owner, []).append(len(clues))

    items = [("Market", data["why"], data["why"].get("change"))] + [
        (s["name"], s["why"], s["change"]) for s in sorted(data["sectors"], key=lambda s: -abs(s["change"] or 0))
        if s["change"] is not None and abs(s["change"]) >= QUIET[data["range"]]
    ][:6]
    for owner, why, move in items:
        if move is not None:
            add(owner, {"kind": "number", "text": f"{owner} {_pct(move)} ({data['range']})"})
        for p in why["parts"]:
            if p["key"] != "left" and abs(p["value"]) >= 0.1:
                add(owner, {"kind": "number", "text": f"{FACTOR_NAMES[p['key']]} {_pct(p['factorMove'])}; {owner} moves {p['beta']:.2g}× with it, so {_pts(p['value'])} points"})
        left = next((p["value"] for p in why["parts"] if p["key"] == "left"), None)
        if left is not None:
            add(owner, {"kind": "number", "text": f"{owner}: {_pts(left)} points not explained by the market, oil, rates or the dollar"})
        if why.get("top"):
            add(owner, {"kind": "number", "text": f"{why['top']['symbol']} (biggest company in {owner}) {_pct(why['top']['change'])}"})
        for n in why["news"]:
            add(owner, {"kind": "headline", "text": f"{n['source']}: {n['title']}", "link": n["link"], "source": n["source"]})
    return clues, owned


def prompt_reasons(data: dict, clues: List[dict], owned: Dict[str, List[int]]) -> str:
    lines = "\n".join(f"[{i + 1}] ({c['kind']}) {c['text']}" for i, c in enumerate(clues))
    owners = "\n".join(f"- {o}: clues {', '.join(map(str, nums))}" for o, nums in owned.items())
    return (
        f"Here you are explaining stock market moves ({data['region']}, range {data['range']}) to a busy founder.\n"
        f"Clues, numbered:\n{lines}\n\nItems to explain and their clues:\n{owners}\n\n"
        "For each item give up to 3 likely reasons, most important first. Each reason: a title of 2-4 words, "
        "a text of at most 30 words in plain English, and the clue numbers it relies on. Use only these clues. "
        "Don't state any number that isn't in a clue. Don't claim cause where a headline only coincides; say \"likely\". "
        "Skip an item you can't explain from the clues.\n"
        'Reply with only {"reasons": {"<item>": [{"title": "...", "text": "...", "cite": [1, 2]}]}}'
    )


def clean_reasons(raw: Any, clues: List[dict], owned: Dict[str, List[int]]) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    if not isinstance(raw, dict):
        return out
    for owner, reasons in raw.items():
        if owner not in owned or not isinstance(reasons, list):
            continue
        kept = []
        for r in reasons[:3]:
            if not isinstance(r, dict):
                continue
            cites = [n for n in r.get("cite") or [] if isinstance(n, int) and 1 <= n <= len(clues)]
            text = str(r.get("text") or "").strip()[:240]
            title = str(r.get("title") or "").strip()[:40]
            if not cites or not text:
                continue
            kinds = {clues[n - 1]["kind"] for n in cites}
            kept.append({
                "title": title or "Likely reason", "text": text,
                "confidence": "High" if kinds == {"number", "headline"} else "Medium",
                "evidence": [
                    {"kind": clues[n - 1]["kind"], "label": clues[n - 1].get("source") or clues[n - 1]["text"][:60], **({"link": clues[n - 1]["link"]} if clues[n - 1].get("link") else {})}
                    for n in dict.fromkeys(cites)
                ],
            })
        if kept:
            out[owner] = kept
    return out


_writing: set = set()
# When each view last asked the AI, so a failing AI isn't asked on every page load.
_asked: Dict[str, datetime.datetime] = {}


async def write_reasons(region: str, rng: str, now: Optional[datetime.datetime] = None) -> Optional[dict]:
    """Ask the AI for reasons and cache them. None when no AI could."""
    import radar_research

    now = now or radar._utcnow()
    key = f"{region}|{rng}"
    if key in _writing:
        return None
    _writing.add(key)
    _asked[key] = now
    try:
        data = board(region, rng, now)
        clues, owned = evidence_for(data)
        if not clues:
            return None
        prompt = prompt_reasons(data, clues, owned)
        for engine in radar_research.engines():
            try:
                raw = await radar_research._complete(engine, prompt, 1800)
            except Exception as e:  # no key, offline, Ollama not running
                print(f"Markets reasons: {engine} failed: {str(e)[:120]}")
                continue
            parsed = radar_research.parse_json(raw, "reasons")
            reasons = clean_reasons((parsed or {}).get("reasons"), clues, owned)
            if reasons:
                payload = {"reasons": reasons, "engine": engine, "writtenAt": radar._iso(now)}
                runs = _ai_runs_today(now) + 1
                conn = _db()
                try:
                    conn.execute("INSERT OR REPLACE INTO market_why (key, payload, prices_at, written_at) VALUES (?, ?, ?, ?)",
                                 (key, json.dumps(payload), data["updatedAt"], radar._iso(now)))
                    conn.execute("INSERT OR REPLACE INTO market_why (key, payload, prices_at, written_at) VALUES ('runs', ?, NULL, NULL)",
                                 (json.dumps({"day": now.date().isoformat(), "count": runs}),))
                    conn.commit()
                finally:
                    conn.close()
                if _broadcast:
                    await _broadcast({"type": "RADAR_MARKETS"})
                return payload
        return None
    finally:
        _writing.discard(key)


def ai_due(region: str, rng: str, now: datetime.datetime) -> bool:
    gap = AI_GAP.get(rng, AI_GAP_LONG)
    asked = _asked.get(f"{region}|{rng}")
    if _ai_runs_today(now) >= AI_DAILY_CAP or (asked and now - asked < gap):
        return False
    conn = _db()
    try:
        row = conn.execute("SELECT prices_at, written_at FROM market_why WHERE key = ?", (f"{region}|{rng}",)).fetchone()
        latest = conn.execute("SELECT MAX(updated_at) FROM market_series").fetchone()[0]
    finally:
        conn.close()
    if not latest:
        return False
    if not row:
        return True
    written = radar._parse_iso(row["written_at"])
    return row["prices_at"] != latest and (not written or now - written >= gap)


# --- Background loop ---

class Collector:
    def __init__(self):
        self.done_at: Dict[str, datetime.datetime] = {}
        self.lock = asyncio.Lock()

    async def tick(self, now: datetime.datetime, force: bool = False) -> bool:
        changed = False
        async with self.lock:
            for region in regions():
                every = OPEN_EVERY if is_open(region, now) else CLOSED_EVERY
                last = self.done_at.get(region)
                if force or not last or now - last >= every:
                    self.done_at[region] = now
                    if await refresh(view_symbols(region), now=now):
                        changed = True
        if changed and _broadcast:
            await _broadcast({"type": "RADAR_MARKETS"})
        return changed

    async def run(self) -> None:
        await asyncio.sleep(20)  # after Radar's own first fetch
        while True:
            try:
                await self.tick(radar._utcnow())
            except Exception as e:
                print(f"Markets fetch failed: {e}")
            await asyncio.sleep(60)


collector = Collector()


# --- Routes ---

router = APIRouter()


@router.get("/api/radar/markets")
async def markets_board(region: str = "US", range: str = "1D"):
    data = board(region, range)
    now = radar._utcnow()
    if ai_due(data["region"], data["range"], now):
        asyncio.get_running_loop().create_task(write_reasons(data["region"], data["range"]))
        data["writing"] = True
    return data
