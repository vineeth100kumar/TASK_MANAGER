"""
Radar Lab: Sparks, business ideas that come to you.

Each morning (from 7:00 in Sage's time zone) the Pi turns the last day of
Radar's headlines and the biggest sector moves on the Markets board into a few
"sparks": the change behind a clue, one business idea it opens, the first
buyer, and how well it fits "My edge" (Settings > Radar: what the user knows,
already has, where they are, their budget and hours). One AI call makes the
whole batch, through the same engines as research (Groq first by default).

A spark can be:
  - kept      - saved as an idea at stage "spark" (a synced `ideas` record),
  - researched - handed to the research pipeline as a theme (uses a run),
  - dismissed - with a reason ("Not my field", "Too big", "Seen it"); the
                next batch is told to stay away from those.

Sparks themselves live in a Pi-only table, like Radar's headlines: they can
be made again, and only the kept ones matter enough to sync.

The Make new button can ask for a fresh batch a few times a day
(MANUAL_PER_DAY). A failed morning batch is tried again an hour later, up to
three times a day.
"""

import asyncio
import datetime
import json
import re
import sqlite3
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import markets
import radar
import radar_research as rr

DB_PATH = "sage_sync.db"
MORNING_HOUR = 7
MANUAL_PER_DAY = 3
AUTO_TRIES = 3
RETRY_AFTER = datetime.timedelta(hours=1)
MAX_CLUES = 30
PER_SOURCE = 6
MARKET_MOVE = 1.0  # % in a day before a sector counts as a clue
KEEP_DAYS = 30
REASONS = ("Not my field", "Too big", "Seen it", "Not now")

_broadcast: Optional[Callable[[dict], Awaitable[None]]] = None


def connect(db_path: str, broadcast=None) -> None:
    global DB_PATH, _broadcast
    DB_PATH, _broadcast = db_path, broadcast
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS radar_sparks (
            id TEXT PRIMARY KEY,
            day TEXT,
            created_at TEXT,
            state TEXT,
            payload TEXT
        );
        CREATE INDEX IF NOT EXISTS radar_sparks_day ON radar_sparks (day);
        CREATE TABLE IF NOT EXISTS radar_spark_runs (
            id TEXT PRIMARY KEY,
            day TEXT,
            kind TEXT,
            at TEXT,
            ok INTEGER,
            error TEXT
        );
        """
    )
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _local_now() -> datetime.datetime:
    try:
        return rr._now_local()
    except Exception:  # research not connected (tests): UTC is good enough
        return datetime.datetime.now(datetime.timezone.utc)


def _today() -> str:
    return _local_now().strftime("%Y-%m-%d")


def _entities(table: str) -> List[dict]:
    conn = _db()
    try:
        rows = conn.execute("SELECT payload FROM entities WHERE table_name = ? AND deleted = 0", (table,)).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()
    out = []
    for r in rows:
        try:
            record = json.loads(r["payload"])
        except ValueError:
            continue
        if isinstance(record, dict) and not record.get("deletedAt"):
            out.append(record)
    return out


# --- My edge ---

def edge_lines() -> List[str]:
    """What the AI is told about the user. Their projects stand in when
    My edge is empty, so the first batch already leans their way."""
    settings = radar.get_settings()
    edge = settings["edge"]
    labels = {"skills": "Skills", "assets": "Already has", "place": "Based in", "budget": "Budget", "hours": "Time"}
    lines = []
    for key, label in labels.items():
        value = edge.get(key, "").strip()
        if value:
            lines.append(f"- {label}: {value}{' hours a week' if key == 'hours' and value.isdigit() else ''}")
    if not any(edge.get(k) for k in ("skills", "assets")):
        names = [p.get("name") for p in _entities("projects") if p.get("name") and p.get("id") != "inbox"]
        if names:
            lines.append(f"- Works on: {', '.join(names[:6])}")
    if not edge.get("place") and settings["india"]:
        lines.append("- Based in: India")
    return lines


# --- Clues ---

def news_clues(now: datetime.datetime) -> List[dict]:
    """The day's headlines most likely to hide an idea: rising topics,
    new rules and Indian news first, a few per source so one feed can't
    take over."""
    day_ago = radar._iso(now - datetime.timedelta(hours=24))
    india_on = radar.get_settings()["india"]
    indian = set(radar.india_sources())
    recent = [s for s in radar.signals(limit=200, now=now) if s["published"] >= day_ago]

    def weight(s: dict) -> float:
        w = len(s["tags"]) * 0.5
        w += 2 if s["rising"] else 0
        w += 1 if "Regulation" in s["tags"] else 0
        w += 1 if india_on and (s["region"] == radar.INDIA or s["source"] in indian) else 0
        return w

    per_source: Dict[str, int] = {}
    out = []
    for s in sorted(recent, key=lambda s: -weight(s)):
        if per_source.get(s["source"], 0) >= PER_SOURCE:
            continue
        per_source[s["source"]] = per_source.get(s["source"], 0) + 1
        bits = [s["source"], *s["tags"][:2]]
        if s["rising"]:
            bits.append("rising")
        out.append({"kind": "news", "label": " · ".join(bits), "title": s["title"], "link": s["link"], "tags": s["tags"]})
        if len(out) >= MAX_CLUES:
            break
    return out


def market_clues(now: datetime.datetime) -> List[dict]:
    """Sectors that moved at least MARKET_MOVE% today, with the likely reason."""
    regions = (["India"] if radar.get_settings()["india"] else []) + ["US"]
    out = []
    for region in regions:
        try:
            data = markets.board(region, "1D", now)
        except Exception as e:  # no prices yet, or the board broke: news alone still works
            print(f"Sparks: no {region} market clues ({e})")
            continue
        moved = [s for s in data["sectors"] if s["change"] is not None and abs(s["change"]) >= MARKET_MOVE]
        for s in sorted(moved, key=lambda s: -abs(s["change"]))[:2]:
            reason = next((r for r in s["why"]["reasons"] if r.get("title") != "No clear reason yet"), None)
            why = f" Likely reason: {reason['title']}." if reason else ""
            news = s["why"]["news"][0] if s["why"]["news"] else None
            out.append({
                "kind": "market",
                "label": f"Markets · {region} {s['name']} {'+' if s['change'] >= 0 else ''}{s['change']:.1f}%",
                "title": f"{s['name']} stocks ({region}) moved {'+' if s['change'] >= 0 else ''}{s['change']:.1f}% today.{why}",
                "link": news["link"] if news else "",
                "tags": [s["tag"]] if s.get("tag") else [],
            })
    return out


def avoid_lines() -> List[str]:
    """Ideas already in Sage and sparks turned down lately, so a batch doesn't repeat them."""
    lines = [f"- {i['name']}: {i.get('oneLiner', '')[:100]}" for i in _entities("ideas") if i.get("name")][:15]
    since = (_local_now() - datetime.timedelta(days=14)).strftime("%Y-%m-%d")
    conn = _db()
    try:
        rows = conn.execute("SELECT payload FROM radar_sparks WHERE state = 'dismissed' AND day >= ? ORDER BY created_at DESC LIMIT 15", (since,)).fetchall()
    finally:
        conn.close()
    for r in rows:
        spark = json.loads(r["payload"])
        lines.append(f"- {spark['idea']} (turned down: {spark.get('reason') or 'no reason'})")
    return lines


# --- The AI ---

def prompt_sparks(count: int, edge: List[str], clues: List[dict], avoid: List[str]) -> str:
    listing = "\n".join(f"[{i}] ({c['label']}) {c['title']}" for i, c in enumerate(clues, 1))
    return (
        "About the founder (fit the ideas to this person):\n" + ("\n".join(edge) or "- (nothing given)") + "\n\n"
        f"Clues from the last day of news and markets:\n{listing}\n\n"
        + ("Already seen or turned down, so don't repeat these:\n" + "\n".join(avoid) + "\n\n" if avoid else "")
        + f"Write {count} sparks. Each starts from one clue: say in one sentence what is changing, then give one "
        "small business this founder could start because of it, who would pay first, and the angle in 2 to 4 words. "
        "Use a different clue for each spark. Prefer ideas that use what the founder already knows or has. "
        "Rate fit 0-10 for this founder, honestly, with a short reason. JSON:\n"
        '{"sparks": [{"clue": 3, "change": "...", "idea": "short name", "pitch": "what it does, for whom, in one sentence", '
        '"buyer": "...", "angle": "...", "fit": 7, "fitWhy": "..."}]}'
    )


def clean_sparks(raw: Any, clues: List[dict], count: int) -> List[dict]:
    out, used = [], set()
    for item in (raw or []) if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        n = rr._num(item.get("clue"), -1e9, 1e9)
        if n is None or not 1 <= n <= len(clues) or int(n) in used:
            continue
        idea = rr._text(item.get("idea"), 70)
        pitch = rr._text(item.get("pitch"), 240)
        if not idea or not pitch:
            continue
        used.add(int(n))
        out.append({
            "clue": clues[int(n) - 1],
            "change": rr._text(item.get("change"), 240),
            "idea": idea,
            "pitch": pitch,
            "buyer": rr._text(item.get("buyer"), 160),
            "angle": rr._text(item.get("angle"), 40),
            "fit": int(rr._num(item.get("fit"), 0, 10, 5)),
            "fitWhy": rr._text(item.get("fitWhy"), 200),
        })
    out.sort(key=lambda s: -s["fit"])
    return out[:count]


class NoClues(Exception):
    pass


async def make(kind: str = "auto", now: Optional[datetime.datetime] = None) -> List[dict]:
    """One batch. Raises when there is nothing to work from or no AI answers;
    the try is logged either way, so the morning loop and the button can count."""
    now = now or radar._utcnow()
    day = _today()
    count = radar.get_settings()["sparksPerDay"]
    error = ""
    try:
        clues = market_clues(now) + news_clues(now)
        if not clues:
            raise NoClues("No headlines from the last day yet, so there's nothing to spark from.")
        prompt = prompt_sparks(count, edge_lines(), clues, avoid_lines())
        data, _ = await rr.ask_json({}, prompt, "sparks", 2500)
        sparks = clean_sparks((data or {}).get("sparks"), clues, count)
        if not sparks:
            raise rr.AIError("The AI didn't return sparks in a form Radar can read")
    except Exception as e:
        error = str(e)[:300] or e.__class__.__name__
        raise
    finally:
        _log_run(day, kind, not error, error)
    stamp = radar._iso(now)
    conn = _db()
    try:
        for spark in sparks:
            spark.update(id=str(uuid.uuid4()), day=day, createdAt=stamp, state="new", reason="", ideaId=None, jobId=None)
            conn.execute(
                "INSERT INTO radar_sparks (id, day, created_at, state, payload) VALUES (?, ?, ?, ?, ?)",
                (spark["id"], day, stamp, "new", json.dumps(spark)),
            )
        cutoff = (_local_now() - datetime.timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
        conn.execute("DELETE FROM radar_sparks WHERE day < ? AND state IN ('new', 'dismissed')", (cutoff,))
        conn.execute("DELETE FROM radar_spark_runs WHERE day < ?", (cutoff,))
        conn.commit()
    finally:
        conn.close()
    await _announce()
    return sparks


def _log_run(day: str, kind: str, ok: bool, error: str) -> None:
    conn = _db()
    try:
        conn.execute(
            "INSERT INTO radar_spark_runs (id, day, kind, at, ok, error) VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), day, kind, radar._iso(radar._utcnow()), int(ok), error),
        )
        conn.commit()
    finally:
        conn.close()


def _runs(day: str) -> List[sqlite3.Row]:
    conn = _db()
    try:
        return conn.execute("SELECT * FROM radar_spark_runs WHERE day = ? ORDER BY at", (day,)).fetchall()
    finally:
        conn.close()


async def _announce() -> None:
    if _broadcast:
        await _broadcast({"type": "RADAR_SPARKS"})


# --- Reading and acting ---

def get(spark_id: str) -> Optional[dict]:
    conn = _db()
    try:
        row = conn.execute("SELECT payload FROM radar_sparks WHERE id = ?", (spark_id,)).fetchone()
    finally:
        conn.close()
    return json.loads(row["payload"]) if row else None


def _save(spark: dict) -> None:
    conn = _db()
    try:
        conn.execute("UPDATE radar_sparks SET state = ?, payload = ? WHERE id = ?", (spark["state"], json.dumps(spark), spark["id"]))
        conn.commit()
    finally:
        conn.close()


def listing() -> dict:
    """Open sparks from today and yesterday (best fit first), and the last
    month's kept or researched ones."""
    today = _today()
    yesterday = (_local_now() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    conn = _db()
    try:
        rows = conn.execute("SELECT payload FROM radar_sparks WHERE day >= ? ORDER BY created_at DESC", (yesterday,)).fetchall()
        done = conn.execute("SELECT payload FROM radar_sparks WHERE state IN ('kept', 'researched') ORDER BY created_at DESC LIMIT 30").fetchall()
    finally:
        conn.close()
    fresh = [json.loads(r["payload"]) for r in rows]
    open_ = sorted((s for s in fresh if s["state"] == "new"), key=lambda s: (s["day"] != today, -s["fit"]))
    runs = _runs(today)
    last = runs[-1] if runs else None
    manual = sum(1 for r in runs if r["kind"] == "manual")
    settings = radar.get_settings()
    return {
        "success": True,
        "sparks": open_,
        "kept": [json.loads(r["payload"]) for r in done],
        "today": today,
        "madeToday": any(r["ok"] for r in runs),
        "lastRun": {"at": last["at"], "ok": bool(last["ok"]), "error": last["error"] or ""} if last else None,
        "running": _making.locked(),
        "manualLeft": max(0, MANUAL_PER_DAY - manual),
        "perDay": settings["sparksPerDay"],
        "edge": settings["edge"],
        "edgeUsed": edge_lines(),
        "reasons": list(REASONS),
    }


def idea_record(spark: dict) -> dict:
    """A light idea at stage "spark": no score yet, research fills that in."""
    now = rr._utc()
    return {
        "id": str(uuid.uuid4()),
        "dossierId": "",
        "stage": "spark",
        "sparkId": spark["id"],
        "name": spark["idea"],
        "oneLiner": spark["pitch"],
        "icp": spark["buyer"],
        "pain": "",
        "whyNow": spark["change"],
        "acvUsd": None, "grossMarginPct": None, "paybackMonths": None, "salesCycleWeeks": None,
        "moat": {k: 0 for k in rr.MOAT_KEYS},
        "ratings": {"whyNow": 0, "pain": 0, "money": 0, "fit": spark["fit"]},
        "score": 0,
        "scoreParts": {"whyNow": 0, "pain": 0, "money": 0, "moat": 0, "safety": 0},
        "fit": spark["fit"],
        "fitWhy": spark["fitWhy"],
        "angle": spark["angle"],
        "clue": {"label": spark["clue"]["label"], "title": spark["clue"]["title"], "link": spark["clue"]["link"]},
        "risks": [],
        "playbook": [],
        "tags": [t for t in spark["clue"].get("tags", []) if t in radar.TAG_ORDER][:2],
        "sources": [],
        "starred": False,
        "projectId": None,
        "lifeContext": "work",
        "createdAt": now,
        "updatedAt": now,
    }


async def keep(spark: dict) -> dict:
    if spark.get("ideaId"):
        return spark
    record = idea_record(spark)
    if rr._apply is None:
        raise RuntimeError("Sparks aren't connected to Sage's database")
    result = await rr._apply([rr._op("ideas", record)])
    refused = [r for r in result.get("results", []) if r.get("status") != "applied"]
    if refused:
        raise RuntimeError(f"Sage refused to save the idea: {refused[0].get('reason')}")
    spark.update(state="kept", ideaId=record["id"])
    _save(spark)
    await _announce()
    return spark


async def research(spark: dict) -> dict:
    theme = f"{spark['idea']}: {spark['pitch']}"[:rr.MAX_THEME]
    job = rr.start(rr.ResearchRequest(theme=theme))
    spark.update(state="researched", jobId=job["id"])
    _save(spark)
    await _announce()
    return {"spark": spark, "job": job}


async def dismiss(spark: dict, reason: str) -> dict:
    spark.update(state="dismissed", reason=reason if reason in REASONS else "")
    _save(spark)
    await _announce()
    return spark


# --- Background loop ---

_making = asyncio.Lock()


def morning_due(now_local: datetime.datetime, runs: List[Any], now_utc: datetime.datetime) -> bool:
    """After 7:00, once a day; a failed try waits an hour, three tries at most."""
    if now_local.hour < MORNING_HOUR:
        return False
    auto = [r for r in runs if r["kind"] == "auto"]
    if any(r["ok"] for r in runs):
        return False
    if len(auto) >= AUTO_TRIES:
        return False
    if auto:
        last = radar._parse_iso(auto[-1]["at"])
        if last and now_utc - last < RETRY_AFTER:
            return False
    return True


async def run() -> None:
    await asyncio.sleep(60)  # let the first headlines arrive after a restart
    while True:
        try:
            if morning_due(_local_now(), _runs(_today()), radar._utcnow()) and not _making.locked():
                async with _making:
                    await make("auto")
        except Exception as e:
            print(f"Sparks: morning batch failed: {e}")
        await asyncio.sleep(600)


# --- Routes ---

router = APIRouter()


class Dismissal(BaseModel):
    reason: str = ""


@router.get("/api/radar/sparks")
def sparks_list():
    return listing()


@router.post("/api/radar/sparks/make")
async def sparks_make():
    if _making.locked():
        return JSONResponse({"success": False, "error": "Sparks are already being made."}, status_code=409)
    if listing()["manualLeft"] == 0:
        return JSONResponse({"success": False, "error": f"That's today's {MANUAL_PER_DAY} extra batches. Tomorrow's arrive at 7:00.", "limit": True}, status_code=429)
    try:
        async with _making:
            await make("manual")
    except (NoClues, rr.AIError) as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=503)
    return listing()


def _found(spark_id: str) -> Optional[dict]:
    return get(spark_id)


@router.post("/api/radar/sparks/{spark_id}/keep")
async def sparks_keep(spark_id: str):
    spark = _found(spark_id)
    if not spark:
        return JSONResponse({"success": False, "error": "No such spark"}, status_code=404)
    try:
        spark = await keep(spark)
    except RuntimeError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
    return {"success": True, "spark": spark}


@router.post("/api/radar/sparks/{spark_id}/research")
async def sparks_research(spark_id: str):
    spark = _found(spark_id)
    if not spark:
        return JSONResponse({"success": False, "error": "No such spark"}, status_code=404)
    try:
        out = await research(spark)
    except rr.LimitReached as e:
        return JSONResponse({"success": False, "error": str(e), "limit": True}, status_code=429)
    return {"success": True, **out}


@router.post("/api/radar/sparks/{spark_id}/dismiss")
async def sparks_dismiss(spark_id: str, body: Dismissal):
    spark = _found(spark_id)
    if not spark:
        return JSONResponse({"success": False, "error": "No such spark"}, status_code=404)
    return {"success": True, "spark": await dismiss(spark, body.reason)}
