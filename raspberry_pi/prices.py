"""
Where Radar's prices come from. Each symbol has a list of sources, tried in
order; the first that answers wins, and the board says which one it was.

  twelve  Twelve Data (free key, set in Settings > Radar). US funds and stocks,
          forex, gold and bitcoin. Free plan: 8 calls a minute, 800 a day, so
          calls are spaced out and each symbol is fetched at most hourly.
          Indices come as the fund that tracks them (S&P 500 as SPY).
  nse     NSE India's own index list. No key; one call covers every Nifty
          index. Gives today's level and yesterday's close, so a longer
          history builds up day by day on top of what's already stored.
  fred    The St. Louis Fed's free daily series (10-year yield, VIX, oil,
          S&P 500, Nasdaq 100, bitcoin). No key; a day behind.
  yahoo   Yahoo's chart data, last. After Yahoo answers 429 it is left alone
          for an hour, so a block isn't made worse by asking again.

Symbols keep Yahoo's names inside Radar; ROUTES maps each to its sources.
"""

import asyncio
import csv
import datetime
import io
import json
import time
from typing import Dict, List, Optional, Tuple

import httpx

import canvas_thinker
import radar

Series = List[Tuple[str, float]]

TWELVE_URL = "https://api.twelvedata.com/time_series"
TWELVE_PER_MINUTE = 8
TWELVE_PER_DAY = 780  # a little under the plan's 800, for the Settings check
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
FRED_TIMEOUT = 45  # FRED's CSV is slow from the Pi; the shared 15s timeout kept missing
FRED_TRIES = 2
NSE_HOME = "https://www.nseindia.com/"
NSE_INDICES = "https://www.nseindia.com/api/allIndices"
YAHOO_REST = 60 * 60  # seconds Yahoo is left alone after a 429
HISTORY_POINTS = 300

# How long a symbol's prices from each source stay fresh (open market, closed).
FRESH = {
    "twelve": (datetime.timedelta(minutes=60), datetime.timedelta(hours=12)),
    "fred": (datetime.timedelta(hours=6), datetime.timedelta(hours=6)),
    "nse": (datetime.timedelta(minutes=15), datetime.timedelta(hours=3)),
    "yahoo": (datetime.timedelta(minutes=20), datetime.timedelta(hours=3)),
}
# Sources quoting the real level (not a fund), so their closes can be merged.
SAME_LEVEL = {"nse", "fred", "yahoo"}
LABELS = {"twelve": "Twelve Data", "nse": "NSE", "fred": "FRED", "yahoo": "Yahoo"}

NSE_NAMES = {
    "^NSEI": "NIFTY 50", "^NSEBANK": "NIFTY BANK", "^CNXIT": "NIFTY IT",
    "NIFTY_FIN_SERVICE.NS": "NIFTY FINANCIAL SERVICES", "^CNXENERGY": "NIFTY ENERGY",
    "^CNXFMCG": "NIFTY FMCG", "^CNXAUTO": "NIFTY AUTO", "^CNXPHARMA": "NIFTY PHARMA",
    "^CNXMETAL": "NIFTY METAL", "^CNXREALTY": "NIFTY REALTY", "^CNXMEDIA": "NIFTY MEDIA",
    "^INDIAVIX": "INDIA VIX", "NIFTY_MIDCAP_100.NS": "NIFTY MIDCAP 100",
}
FRED_IDS = {
    "^TNX": "DGS10", "^VIX": "VIXCLS", "CL=F": "DCOILWTICO", "^GSPC": "SP500",
    "^NDX": "NASDAQ100", "BTC-USD": "CBBTCUSD", "^N225": "NIKKEI225",
}
# Twelve Data names where they differ: an index becomes the fund that tracks it.
TWELVE_NAMES = {
    "^GSPC": "SPY", "^NDX": "QQQ", "DX-Y.NYB": "UUP", "GC=F": "XAU/USD",
    "BTC-USD": "BTC/USD", "INR=X": "USD/INR", "^STOXX": "FEZ", "^N225": "EWJ",
    "000300.SS": "MCHI", "^FTSE": "EWU", "^HSI": "EWH", "^KS11": "EWY", "^BVSP": "EWZ",
}
# CL=F is left off on purpose: the only free stand-in is the USO fund, whose
# price (about $70-160) isn't a barrel of crude, so oil comes from FRED/Yahoo.
# Symbols Twelve Data's free plan doesn't carry under any name.
NOT_ON_TWELVE = {"^TNX", "^VIX", "^INDIAVIX"}


def routes(symbol: str) -> List[Tuple[str, str]]:
    """(source, that source's name for it), best first."""
    out: List[Tuple[str, str]] = []
    if symbol in NSE_NAMES:
        out.append(("nse", NSE_NAMES[symbol]))
    elif symbol in FRED_IDS and symbol in ("^TNX", "^VIX"):
        out.append(("fred", FRED_IDS[symbol]))
    plain_stock = not symbol.startswith("^") and not symbol.endswith((".NS", ".SS", "=X", "=F"))
    if symbol in TWELVE_NAMES or (plain_stock and symbol not in NOT_ON_TWELVE and "." not in symbol and "-" not in symbol):
        out.append(("twelve", TWELVE_NAMES.get(symbol, symbol)))
    if symbol in FRED_IDS and ("fred", FRED_IDS[symbol]) not in out:
        out.append(("fred", FRED_IDS[symbol]))
    out.append(("yahoo", symbol))
    return out


class SourceError(Exception):
    pass


# --- Twelve Data ---

def twelve_key() -> str:
    return str(canvas_thinker._saved_secrets().get("TWELVEDATA_API_KEY", "")).strip()


def save_twelve_key(key: str) -> None:
    secrets = canvas_thinker._saved_secrets()
    if key.strip():
        secrets["TWELVEDATA_API_KEY"] = key.strip()
    else:
        secrets.pop("TWELVEDATA_API_KEY", None)
    canvas_thinker.SECRETS_FILE.touch(mode=0o600, exist_ok=True)
    canvas_thinker.SECRETS_FILE.write_text(json.dumps(secrets))


def twelve_status() -> dict:
    key = twelve_key()
    return {"set": bool(key), "last4": key[-4:] if key else None, "usedToday": _twelve["used"], "perDay": TWELVE_PER_DAY}


_twelve = {"day": "", "used": 0, "next_at": 0.0}
_twelve_lock = asyncio.Lock()


async def _twelve_turn() -> None:
    """Wait for a free call under 8 a minute; refuse past the day's budget."""
    async with _twelve_lock:
        today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        if _twelve["day"] != today:
            _twelve.update(day=today, used=0)
        if _twelve["used"] >= TWELVE_PER_DAY:
            raise SourceError("today's Twelve Data calls are used up")
        wait = _twelve["next_at"] - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _twelve["next_at"] = time.monotonic() + 60 / TWELVE_PER_MINUTE
        _twelve["used"] += 1


def parse_twelve(data: dict) -> Series:
    if not isinstance(data, dict) or data.get("status") == "error":
        message = (data or {}).get("message") if isinstance(data, dict) else None
        code = (data or {}).get("code") if isinstance(data, dict) else None
        raise SourceError(f"{code or 'error'}: {str(message or 'no data')[:120]}")
    out = []
    for row in data.get("values") or []:
        try:
            out.append((str(row["datetime"])[:10], float(row["close"])))
        except (KeyError, TypeError, ValueError):
            continue
    if not out:
        raise SourceError("no prices")
    return sorted(dict(out).items())


async def from_twelve(client: httpx.AsyncClient, name: str) -> Series:
    key = twelve_key()
    if not key:
        raise SourceError("no key")
    await _twelve_turn()
    resp = await client.get(TWELVE_URL, params={"symbol": name, "interval": "1day", "outputsize": HISTORY_POINTS, "apikey": key})
    resp.raise_for_status()
    return parse_twelve(resp.json())


# --- FRED ---

def parse_fred(text: str) -> Series:
    rows = list(csv.reader(io.StringIO(text)))
    out = []
    for row in rows[1:]:
        if len(row) >= 2:
            try:
                out.append((row[0][:10], float(row[1])))
            except ValueError:
                continue  # "." marks a day with no value
    if not out:
        raise SourceError("no prices")
    return out[-HISTORY_POINTS:]


async def from_fred(client: httpx.AsyncClient, series_id: str) -> Series:
    start = (datetime.date.today() - datetime.timedelta(days=450)).isoformat()
    for attempt in range(FRED_TRIES):
        try:
            resp = await client.get(FRED_URL, params={"id": series_id, "cosd": start}, timeout=FRED_TIMEOUT)
            resp.raise_for_status()
            return parse_fred(resp.text)
        except httpx.TransportError:
            if attempt == FRED_TRIES - 1:
                raise


# --- NSE ---

_nse = {"at": 0.0, "data": None}
_nse_lock = asyncio.Lock()


def parse_nse(data: dict, name: str) -> Series:
    """Today's level and the previous close for one index."""
    rows = {str(r.get("index", "")).upper(): r for r in (data or {}).get("data") or [] if isinstance(r, dict)}
    row = rows.get(name.upper())
    if not row:
        raise SourceError(f"NSE has no {name}")
    try:
        last = float(str(row["last"]).replace(",", ""))
        previous = float(str(row["previousClose"]).replace(",", ""))
    except (KeyError, TypeError, ValueError):
        raise SourceError(f"NSE gave no level for {name}") from None
    stamp = str((data or {}).get("timestamp") or "")
    try:
        day = datetime.datetime.strptime(stamp[:11], "%d-%b-%Y").date()
    except ValueError:
        day = datetime.datetime.now(radar.KOLKATA).date()
    before = day - datetime.timedelta(days=1)
    while before.weekday() >= 5:
        before -= datetime.timedelta(days=1)
    return [(before.isoformat(), previous), (day.isoformat(), last)]


async def from_nse(client: httpx.AsyncClient, name: str) -> Series:
    # One call covers every index; it's shared for a minute.
    async with _nse_lock:
        if _nse["data"] is None or time.monotonic() - _nse["at"] > 60:
            headers = {"Accept": "application/json,text/html", "Accept-Language": "en-US,en;q=0.9", "Referer": NSE_HOME}
            try:
                await client.get(NSE_HOME, headers=headers)  # sets the cookies NSE's API wants
            except httpx.HTTPError:
                pass
            resp = await client.get(NSE_INDICES, headers=headers)
            resp.raise_for_status()
            _nse.update(at=time.monotonic(), data=resp.json())
    return parse_nse(_nse["data"], name)


# --- Yahoo ---

_yahoo_rest_until = 0.0


async def from_yahoo(client: httpx.AsyncClient, symbol: str) -> Series:
    global _yahoo_rest_until
    if time.monotonic() < _yahoo_rest_until:
        raise SourceError("resting after HTTP 429")
    import markets  # markets imports this module; parse_series lives there
    try:
        data = await radar.yahoo_chart(client, symbol, {"range": "1y", "interval": "1d"})
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            _yahoo_rest_until = time.monotonic() + YAHOO_REST
        raise
    return markets.parse_series(data)


FETCH = {"twelve": from_twelve, "nse": from_nse, "fred": from_fred, "yahoo": from_yahoo}


async def fetch(client: httpx.AsyncClient, symbol: str) -> Tuple[Series, str, str]:
    """(closes, source, that source's name). Raises SourceError naming every failure."""
    errors = []
    for source, name in routes(symbol):
        try:
            return await FETCH[source](client, name), source, name
        except SourceError as e:
            if str(e) != "no key":
                errors.append(f"{LABELS[source]} {e}")
        except Exception as e:
            errors.append(f"{LABELS[source]} {radar._short_error(e)}")
    raise SourceError("; ".join(errors) or "no source")


def fresh(source: Optional[str], updated_at: Optional[datetime.datetime], now: datetime.datetime, market_open: bool) -> bool:
    if not source or not updated_at or source not in FRESH:
        return False
    return now - updated_at < FRESH[source][0 if market_open else 1]


def combine(old: Series, old_source: Optional[str], new: Series, source: str, keep: int) -> Series:
    """A full history replaces what's stored; a couple of days from a source
    quoting the same level are merged into it."""
    if len(new) >= 30 or not (old_source in SAME_LEVEL and source in SAME_LEVEL):
        return new[-keep:]
    both = dict(old)
    both.update(dict(new))
    return sorted(both.items())[-keep:]


def forget() -> None:
    """For tests: start from nothing."""
    global _yahoo_rest_until, _twelve_lock, _nse_lock
    _yahoo_rest_until = 0.0
    _twelve.update(day="", used=0, next_at=0.0)
    _nse.update(at=0.0, data=None)
    _twelve_lock = asyncio.Lock()
    _nse_lock = asyncio.Lock()
