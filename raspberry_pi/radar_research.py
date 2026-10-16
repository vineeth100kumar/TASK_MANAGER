"""
Radar research: turn a theme into a dossier and three scored startup ideas.

Pressing Research in the app (Studio tab) starts a job on the Pi. One job runs
at a time; others wait in line. Each job runs five steps, each with a time limit:

  1. Read the news    - Radar's own headlines that match the theme (no AI)
  2. Search the web   - the AI writes 5 search queries; DuckDuckGo (or Google
                        News when DuckDuckGo refuses) finds pages, and the
                        best few are read
  3. Mine pain points - Hacker News comments and Ask HN posts about the theme,
                        kept when they sound like a complaint (no AI)
  4. Draft theses     - the AI writes the market picture (macro, why now, value
                        chain), then three ideas with numbers, a moat profile
                        and a 90-day playbook
  5. Red-team them    - the AI lists the three biggest risks of each idea and
                        how to blunt them

Every claim points at a numbered source, so the app can link it. Numbers the
AI gives are estimates and the app labels them so.

The results are ordinary synced records, written through Sage's sync path:
one `dossiers` record, three `ideas` records and a Note with the write-up, so
the phone sees them and they're in the nightly backup. Progress streams to the
app over /ws as RADAR_PROGRESS events.

Which AI answers: Groq first by default (free, with the key in Settings), or
Claude first when chosen in Settings (needs ANTHROPIC_API_KEY); then the other
one; then the Pi's local Ollama model as a last resort.
"""

import asyncio
import datetime
import html
import json
import re
import sqlite3
import time
import uuid
from html.parser import HTMLParser
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

import canvas_thinker
import radar

STEPS = ["Read the news", "Search the web", "Mine pain points", "Draft theses", "Red-team them"]
STEP_LIMITS = [5, 60, 20, 180, 120]  # seconds; AI steps get room for a slow engine
MAX_THEME = 200
QUERIES = 5
RESULTS_PER_QUERY = 3
MAX_WEB_SOURCES = 12
PAGES_TO_READ = 6
PAGE_CHARS = 2500
MAX_PAIN = 15
# What the AI is shown of the sources, so a big dossier stays within a free Groq request.
SOURCE_BUDGET = 14000
CELL_LIMIT = 45000  # a Google Sheets cell holds 50,000 characters
SOURCE = "radar"
DUCKDUCKGO = "https://html.duckduckgo.com/html/"
GOOGLE_NEWS = "https://news.google.com/rss/search"
HN_SEARCH = "https://hn.algolia.com/api/v1/search"

PAIN_WORDS = re.compile(
    r"\b(pain|painful|frustrat\w*|hate|annoying|wish|struggl\w*|nightmare|expensive|manual(ly)?|"
    r"spreadsheets?|no good way|hard to|impossible|broken|waste|slow|tedious|can't find|cannot find|"
    r"too much|overpriced|lack of|missing)\b",
    re.IGNORECASE,
)

SYSTEM = (
    "You are a venture analyst writing for one founder who will act on what you say. "
    "Be specific and concrete: name customers, numbers, laws, companies and dates. "
    "Base claims on the numbered sources you are given and cite them by number; "
    "when you estimate, say so. Never invent a source. "
    "Reply with only the JSON object asked for: no prose before or after it, no code fences."
)

# Filled in by connect() from db_server, which owns the sync path.
_apply: Optional[Callable[[List[dict]], Awaitable[dict]]] = None
_broadcast: Optional[Callable[[dict], Awaitable[None]]] = None
_now_local: Callable[[], datetime.datetime] = lambda: datetime.datetime.now().astimezone()
DB_PATH = "sage_sync.db"


def connect(db_path: str, apply, broadcast, now_local) -> None:
    global DB_PATH, _apply, _broadcast, _now_local
    DB_PATH, _apply, _broadcast, _now_local = db_path, apply, broadcast, now_local
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS radar_jobs (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT)")
    # A job that was running when the server stopped will never finish now.
    for job_id, payload in conn.execute("SELECT id, payload FROM radar_jobs").fetchall():
        job = json.loads(payload)
        if job.get("status") in ("queued", "running"):
            job.update(status="failed", error="Sage restarted while this was running. Run it again.")
            conn.execute("UPDATE radar_jobs SET payload = ? WHERE id = ?", (json.dumps(job), job_id))
    conn.commit()
    conn.close()


def _utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# --- Jobs ---

def _save_job(job: dict) -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT OR REPLACE INTO radar_jobs (id, created_at, payload) VALUES (?, ?, ?)",
            (job["id"], job["createdAt"], json.dumps(job)),
        )
        conn.commit()
    finally:
        conn.close()


def get_job(job_id: str) -> Optional[dict]:
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute("SELECT payload FROM radar_jobs WHERE id = ?", (job_id,)).fetchone()
    finally:
        conn.close()
    return json.loads(row[0]) if row else None


def recent_jobs(limit: int = 10) -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute("SELECT payload FROM radar_jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    finally:
        conn.close()
    return [json.loads(r[0]) for r in rows]


def runs_today() -> int:
    """Jobs started since local midnight (in Sage's time zone). Failed ones count:
    they may still have cost an AI call."""
    local = _now_local()
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(datetime.timezone.utc)
    since = midnight.strftime("%Y-%m-%dT%H:%M:%S")
    conn = sqlite3.connect(DB_PATH)
    try:
        return conn.execute("SELECT COUNT(*) FROM radar_jobs WHERE created_at >= ?", (since,)).fetchone()[0]
    finally:
        conn.close()


class ResearchRequest(BaseModel):
    theme: str
    depth: str = "brief"  # brief | memo


class LimitReached(Exception):
    pass


_lock = asyncio.Lock()
_tasks: set = set()


def start(req: ResearchRequest) -> dict:
    theme = re.sub(r"\s+", " ", req.theme or "").strip()[:MAX_THEME]
    if len(theme) < 3:
        raise ValueError("Give the theme a few words, e.g. \"Cross-border payroll in Southeast Asia\".")
    cap = radar.get_settings()["dailyCap"]
    if runs_today() >= cap:
        raise LimitReached(
            f"That's today's {cap} research run{'s' if cap != 1 else ''}. "
            "It resets at midnight, or raise the limit in Settings > Radar."
        )
    job = {
        "id": str(uuid.uuid4()),
        "theme": theme,
        "depth": "memo" if req.depth == "memo" else "brief",
        "status": "queued",
        "step": 0,
        "steps": [{"name": n, "status": "todo", "detail": "", "seconds": None} for n in STEPS],
        "engine": None,
        "error": "",
        "ideaIds": [],
        "noteId": None,
        "createdAt": _utc(),
        "finishedAt": None,
    }
    _save_job(job)
    task = asyncio.get_running_loop().create_task(_run(job))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job


async def _announce(job: dict) -> None:
    _save_job(job)
    if _broadcast:
        await _broadcast({"type": "RADAR_PROGRESS", "job": job})


async def _run(job: dict) -> None:
    async with _lock:  # one job at a time on the Pi
        job["status"] = "running"
        await _announce(job)
        try:
            await Pipeline(job).run()
        except Exception as e:  # anything unexpected still ends the job cleanly
            job["status"] = "failed"
            job["error"] = str(e)[:300] or e.__class__.__name__
            for step in job["steps"]:
                if step["status"] == "run":
                    step["status"] = "failed"
        job["finishedAt"] = _utc()
        await _announce(job)


# --- The AI ---

class AIError(Exception):
    pass


def engines() -> List[str]:
    """Usable engines, in the order Settings asks for."""
    first = radar.get_settings()["engine"]
    have = {"groq": bool(canvas_thinker.groq_key()), "claude": canvas_thinker.claude_available()}
    order = ["claude", "groq"] if first == "claude" else ["groq", "claude"]
    return [e for e in order if have[e]] + ["local"]


async def _groq(prompt: str, max_tokens: int) -> str:
    primary = canvas_thinker._setting("SAGE_RADAR_GROQ_MODEL") or canvas_thinker._setting("GROQ_LLM_MODEL") or canvas_thinker.GROQ_DEFAULT_MODEL
    last = ""
    async with httpx.AsyncClient(timeout=90) as client:
        for model in dict.fromkeys([primary, canvas_thinker.GROQ_FALLBACK_MODEL]):
            try:
                res = await client.post(
                    canvas_thinker.GROQ_URL,
                    headers={"Authorization": f"Bearer {canvas_thinker.groq_key()}"},
                    json={
                        "model": model,
                        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
                        "temperature": 0.4,
                        "max_tokens": max_tokens,
                    },
                )
            except httpx.HTTPError as e:
                last = f"couldn't reach Groq ({e.__class__.__name__})"
                continue
            if res.status_code == 401:
                raise AIError("Groq rejected the API key (Settings > Server & Reset).")
            if res.status_code != 200:
                last = f"Groq said {res.status_code}"
                continue
            return res.json()["choices"][0]["message"].get("content") or ""
    raise AIError(last or "Groq gave no answer")


def _claude(prompt: str, max_tokens: int) -> str:
    import anthropic

    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=canvas_thinker.CLAUDE_MODEL,
        max_tokens=max_tokens + 8000,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        thinking={"type": "adaptive"},
        output_config={"effort": "medium"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise AIError("Claude declined this theme")
    return "".join(block.text for block in response.content if block.type == "text")


def _local(prompt: str, max_tokens: int) -> str:
    import ollama

    response = ollama.generate(
        model=canvas_thinker.LOCAL_MODEL,
        prompt=f"{SYSTEM}\n\n{prompt}",
        format="json",
        options={"temperature": 0.4, "num_predict": max_tokens},
    )
    return response["response"]


async def _complete(engine: str, prompt: str, max_tokens: int) -> str:
    if engine == "groq":
        return await _groq(prompt, max_tokens)
    if engine == "claude":
        return await asyncio.to_thread(_claude, prompt, max_tokens)
    return await asyncio.to_thread(_local, prompt, max_tokens)


def parse_json(text: str, key: str) -> Optional[dict]:
    """The last JSON object in text that has `key`, forgiving fences, chatter
    and a reasoning model's <think> block."""
    text = re.sub(r"<think>.*?(</think>|$)", "", text or "", flags=re.S)
    decoder = json.JSONDecoder()
    found = None
    for match in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text, match.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and key in obj:
            found = obj
    return found


async def ask_json(job: dict, prompt: str, key: str, max_tokens: int = 3000) -> Tuple[Optional[dict], str]:
    """Ask the engines in order until one answers with the JSON asked for; each
    gets a second try when its answer isn't JSON. Returns (data, raw text), or
    (None, the last raw text) when every engine answered but none in JSON."""
    errors = []
    raw = ""
    answered = False
    for engine in engines():
        try:
            raw = await _complete(engine, prompt, max_tokens)
            data = parse_json(raw, key)
            if data is None:
                raw = await _complete(
                    engine,
                    prompt + f'\n\nYour last answer was not valid JSON. Reply again with only the JSON object, starting with {{"{key}":',
                    max_tokens,
                )
                data = parse_json(raw, key)
            answered = True
            if data is not None:
                if not job.get("engine"):
                    job["engine"] = engine
                elif engine not in job["engine"]:
                    job["engine"] = f"{job['engine']} + {engine}"
                return data, raw
        except AIError as e:
            errors.append(str(e))
        except Exception as e:  # missing package, Ollama not running, network
            errors.append(f"{engine}: {str(e)[:120] or e.__class__.__name__}")
    if answered:
        return None, raw
    raise AIError("No AI could answer. " + "; ".join(errors))


# --- Web, news and Hacker News ---

class _TextExtractor(HTMLParser):
    """Readable text of a page: paragraphs, headings and list items, without
    scripts, menus and footers."""

    SKIP = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg"}
    KEEP = {"p", "h1", "h2", "h3", "li", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.keep = 0
        self.parts: List[str] = []
        self.current: List[str] = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.KEEP:
            self.keep += 1
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag in self.KEEP and self.keep:
            self.keep -= 1
            text = re.sub(r"\s+", " ", "".join(self.current)).strip()
            if len(text) > 40:
                self.parts.append(text)
            self.current = []
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self.keep and not self.skip:
            self.current.append(data)


def page_text(content: str) -> Tuple[str, str]:
    parser = _TextExtractor()
    try:
        parser.feed(content)
    except Exception:
        pass
    return re.sub(r"\s+", " ", parser.title).strip(), "\n".join(parser.parts)[:PAGE_CHARS]


def parse_duckduckgo(content: str) -> List[dict]:
    """Results from DuckDuckGo's HTML page: [{title, url, snippet}]."""
    out = []
    # Each result starts at its title link; its snippet follows before the next one.
    for chunk in content.split('class="result__a"')[1:]:
        link = re.search(r'href="([^"]+)"[^>]*>(.*?)</a>', chunk, flags=re.S)
        if not link:
            continue
        url = html.unescape(link.group(1))
        if "uddg=" in url:
            url = unquote(parse_qs(urlparse(url).query).get("uddg", [""])[0])
        if url.startswith("//"):
            url = "https:" + url
        if not url.startswith("http") or "duckduckgo.com" in urlparse(url).netloc:
            continue  # ads and DuckDuckGo's own links
        snippet = re.search(r'class="result__snippet"[^>]*>(.*?)</(a|div|td)>', chunk, flags=re.S)
        out.append({"title": _clean(link.group(2)), "url": url, "snippet": _clean(snippet.group(1)) if snippet else ""})
    return out


def _clean(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment or ""))).strip()


def _site(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


async def search_web(client: httpx.AsyncClient, query: str) -> List[dict]:
    """DuckDuckGo first; Google News when DuckDuckGo refuses or finds nothing."""
    try:
        res = await client.post(DUCKDUCKGO, data={"q": query})
        if res.status_code == 200:
            results = parse_duckduckgo(res.text)
            if results:
                return [{**r, "kind": "web"} for r in results[:RESULTS_PER_QUERY]]
    except httpx.HTTPError:
        pass
    try:
        res = await client.get(GOOGLE_NEWS, params={"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"})
        res.raise_for_status()
        items = radar.parse_feed(res.content)
    except Exception:
        return []
    return [{"title": i["title"], "url": i["link"], "snippet": "", "kind": "news"} for i in items[:RESULTS_PER_QUERY]]


async def read_page(client: httpx.AsyncClient, source: dict) -> None:
    if source["url"].lower().endswith(".pdf") or "news.google.com" in source["url"]:
        return
    try:
        res = await client.get(source["url"], timeout=10)
        if res.status_code != 200 or "html" not in res.headers.get("content-type", ""):
            return
        title, text = page_text(res.text[:600_000])
        if text:
            source["text"] = text
            source["title"] = source["title"] or title
    except httpx.HTTPError:
        pass


def _keywords(theme: str) -> List[str]:
    stop = {"the", "and", "for", "with", "from", "into", "in", "of", "on", "to", "a", "an", "or", "by", "at", "how", "why", "what"}
    return [w for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9\-]+", theme) if w.lower() not in stop]


async def mine_hn(client: httpx.AsyncClient, theme: str) -> List[dict]:
    """Complaints from Hacker News comments and Ask HN posts about the theme."""
    words = _keywords(theme)
    # Algolia matches every word, so a long theme finds nothing; widen if so.
    attempts = [" ".join(words), " ".join(sorted(words, key=len, reverse=True)[:3]), " ".join(sorted(words, key=len, reverse=True)[:2])]
    hits = []
    for query in dict.fromkeys(a for a in attempts if a):
        for tags in ("comment", "ask_hn"):
            try:
                res = await client.get(HN_SEARCH, params={"query": query, "tags": tags, "hitsPerPage": 50})
                res.raise_for_status()
                hits.extend(res.json().get("hits") or [])
            except (httpx.HTTPError, ValueError):
                continue
        if len(hits) >= 20:
            break
    pains, seen = [], set()
    for hit in hits:
        text = _clean(hit.get("comment_text") or hit.get("story_text") or "")
        title = _clean(hit.get("title") or hit.get("story_title") or "")
        body = text or title
        object_id = hit.get("objectID")
        if not body or object_id in seen:
            continue
        seen.add(object_id)
        score = len(PAIN_WORDS.findall(body)) + (1 if (hit.get("title") or "").lower().startswith("ask hn") else 0)
        if score:
            pains.append({
                "score": score,
                "text": body[:320] + ("…" if len(body) > 320 else ""),
                "title": f"Hacker News: {title[:90] or 'comment'}",
                "url": f"https://news.ycombinator.com/item?id={object_id}",
            })
    pains.sort(key=lambda p: -p["score"])
    return pains[:MAX_PAIN]


def matching_headlines(theme: str, limit: int = 15) -> List[dict]:
    words = [w.lower() for w in _keywords(theme) if len(w) > 2]
    if not words:
        return []
    scored = []
    for s in radar.signals(limit=200):
        title = s["title"].lower()
        hits = sum(1 for w in words if re.search(r"\b" + re.escape(w), title))
        if hits:
            scored.append((hits, s))
    scored.sort(key=lambda pair: -pair[0])
    return [s for _, s in scored[:limit]]


# --- Cleaning what the AI sends ---

def _num(value: Any, low: float, high: float, default: Optional[float] = None) -> Optional[float]:
    if isinstance(value, str):
        value = re.sub(r"[^0-9.\-]", "", value.replace("k", "000")) or None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _text(value: Any, limit: int = 600) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _refs(value: Any, count: int) -> List[int]:
    if not isinstance(value, list):
        value = [value]
    out = []
    for v in value:
        n = _num(v, -1e9, 1e9)
        # A number that isn't one of the sources is dropped, never moved to the nearest one.
        if n is not None and 1 <= n <= count and int(n) not in out:
            out.append(int(n))
    return out[:4]


SEVERITIES = {"high": "High", "medium": "Medium", "low": "Low"}
MOAT_KEYS = ["network", "switching", "data", "cost", "regulatory"]


def clean_idea(raw: dict, source_count: int) -> dict:
    economics = raw.get("economics") if isinstance(raw.get("economics"), dict) else raw
    moat = raw.get("moat") if isinstance(raw.get("moat"), dict) else {}
    ratings = raw.get("ratings") if isinstance(raw.get("ratings"), dict) else {}
    playbook = []
    for phase in (raw.get("playbook") or [])[:4]:
        if not isinstance(phase, dict):
            continue
        weeks = phase.get("weeks") if isinstance(phase.get("weeks"), list) else []
        start = int(_num(weeks[0] if weeks else phase.get("startWeek"), 1, 12, 1))
        end = int(_num(weeks[1] if len(weeks) > 1 else phase.get("endWeek"), start, 13, start + 1))
        steps = [_text(s, 160) for s in (phase.get("steps") or []) if _text(s, 160)][:6]
        if steps:
            playbook.append({"name": _text(phase.get("name"), 80) or f"Weeks {start}-{end}", "startWeek": start, "endWeek": end, "steps": steps})
    tags = [t for t in (raw.get("tags") or []) if t in radar.TAG_ORDER][:3]
    return {
        "name": _text(raw.get("name"), 60) or "Untitled idea",
        "oneLiner": _text(raw.get("oneLiner"), 200),
        "icp": _text(raw.get("icp"), 240),
        "pain": _text(raw.get("pain"), 400),
        "whyNow": _text(raw.get("whyNow"), 300),
        "acvUsd": _num(economics.get("acvUsd"), 0, 10_000_000),
        "grossMarginPct": _num(economics.get("grossMarginPct"), 0, 100),
        "paybackMonths": _num(economics.get("paybackMonths"), 0, 120),
        "salesCycleWeeks": _num(economics.get("salesCycleWeeks"), 0, 104),
        "moat": {k: int(_num(moat.get(k), 0, 10, 0)) for k in MOAT_KEYS},
        "ratings": {k: int(_num(ratings.get(k), 0, 10, 5)) for k in ("whyNow", "pain", "money", "fit") if k != "fit" or k in ratings},
        "tags": tags,
        "sources": _refs(raw.get("sources"), source_count),
        "playbook": playbook,
    }


def clean_risks(raw: Any) -> List[dict]:
    out = []
    for risk in (raw or [])[:3] if isinstance(raw, list) else []:
        if not isinstance(risk, dict):
            continue
        out.append({
            "kind": _text(risk.get("kind") or risk.get("type"), 40) or "Risk",
            "detail": _text(risk.get("detail"), 300),
            "severity": SEVERITIES.get(str(risk.get("severity", "")).lower(), "Medium"),
            "mitigation": _text(risk.get("mitigation"), 300),
        })
    return out


def score(idea: dict) -> Tuple[int, dict]:
    """Out of 100: why now 25, pain 20, money 20, moat 20, safety 15 (less 3
    per High risk). The parts are kept so the Idea page can show them.

    With a fit rating (how well it suits My edge, see sparks.py) fit takes 15:
    why now 20, pain 20, money 15, moat 15, safety 15 (less 3 per High), fit 15."""
    r = idea["ratings"]
    moat_avg = sum(idea["moat"].values()) / len(MOAT_KEYS)
    highs = sum(1 for risk in idea.get("risks", []) if risk["severity"] == "High")
    if "fit" in r:
        parts = {
            "whyNow": round(r["whyNow"] * 2.0, 1),
            "pain": round(r["pain"] * 2.0, 1),
            "money": round(r["money"] * 1.5, 1),
            "moat": round(moat_avg * 1.5, 1),
            "safety": max(0, 15 - 3 * highs),
            "fit": round(r["fit"] * 1.5, 1),
        }
        return int(round(min(100, sum(parts.values())))), parts
    parts = {
        "whyNow": round(r["whyNow"] * 2.5, 1),
        "pain": round(r["pain"] * 2.0, 1),
        "money": round(r["money"] * 2.0, 1),
        "moat": round(moat_avg * 2.0, 1),
        "safety": max(0, 15 - 3 * highs),
    }
    return int(round(min(100, sum(parts.values())))), parts


# --- Prompts ---

def _sources_block(sources: List[dict], budget: int = SOURCE_BUDGET) -> str:
    lines, used = [], 0
    for i, s in enumerate(sources, 1):
        body = s.get("text") or s.get("snippet") or ""
        entry = f"[{i}] {s['title']} ({_site(s['url'])})" + (f"\n{body[:900]}" if body else "")
        if used + len(entry) > budget:
            entry = f"[{i}] {s['title']} ({_site(s['url'])})"
        used += len(entry)
        lines.append(entry)
    return "\n\n".join(lines)


def prompt_queries(theme: str, headlines: List[dict]) -> str:
    news = "\n".join(f"- {h['title']}" for h in headlines[:8]) or "- (none yet)"
    return (
        f'Theme to research: "{theme}"\n\nRecent headlines on it:\n{news}\n\n'
        f"Write {QUERIES} web search queries that together cover: market size and growth, who buys "
        "and what they pay, the main incumbents and startups, regulation or deadlines that change "
        "things soon, and complaints from people doing this work today. Short queries, like a person types.\n"
        '{"queries": ["...", "..."]}'
    )


def prompt_market(theme: str, depth: str, sources: List[dict], pains: List[dict]) -> str:
    length = "6-8 sentences" if depth == "memo" else "3-4 sentences"
    pain_lines = "\n".join(f"- {p['text']}" for p in pains[:8]) or "- (none found)"
    return (
        f'Theme: "{theme}"\n\nSources:\n{_sources_block(sources)}\n\n'
        f"What practitioners complain about (Hacker News):\n{pain_lines}\n\n"
        "Write the market picture as JSON:\n"
        "{\n"
        '  "summary": "2 sentences: the opportunity in plain words",\n'
        f'  "macro": "{length}: what is changing and how big it is, with numbers",\n'
        '  "whyNow": "1-2 sentences: the specific change (law, price drop, technology, deadline) that makes this the moment, with its date",\n'
        '  "valueChain": [{"layer": "e.g. Payroll engines", "players": "who wins today", "gap": "what they leave undone"}],\n'
        '  "claims": [{"text": "one fact with a number", "source": 3}]\n'
        "}\n"
        "3 to 5 value-chain layers, 4 to 6 claims, each citing one source number from the list."
    )


def prompt_ideas(theme: str, market: dict, pains: List[dict], sources: List[dict], edge: Optional[List[str]] = None) -> str:
    founder = ("The founder (rate fit for this person):\n" + "\n".join(edge) + "\n\n") if edge else ""
    chain = "\n".join(f"- {l.get('layer')}: {l.get('players')} (gap: {l.get('gap')})" for l in market.get("valueChain", []))
    pain_lines = "\n".join(f"- {p['text'][:200]}" for p in pains[:8]) or "- (none found)"
    titles = "\n".join(f"[{i}] {s['title']}" for i, s in enumerate(sources, 1))
    tags = ", ".join(radar.TAG_ORDER)
    return (
        f'Theme: "{theme}"\n\nMarket: {market.get("macro", "")}\nWhy now: {market.get("whyNow", "")}\n'
        f"Value chain:\n{chain}\n\nComplaints:\n{pain_lines}\n\nSources:\n{titles}\n\n{founder}"
        "Propose 3 distinct startup ideas a solo founder could start in 90 days, each attacking a "
        "different gap. Numbers are your best estimates for a B2B product. Ratings and moat scores "
        "are 0-10 and must differ between ideas where the ideas differ. JSON:\n"
        "{\n"
        '  "ideas": [{\n'
        '    "name": "short brand-like name", "oneLiner": "what it does, for whom, in one sentence",\n'
        '    "icp": "the first buyer: role, company type, size", "pain": "the pain in their words",\n'
        '    "whyNow": "why this idea works now", "sources": [2, 5],\n'
        f'    "tags": ["one or two of: {tags}"],\n'
        '    "economics": {"acvUsd": 18000, "grossMarginPct": 70, "paybackMonths": 7, "salesCycleWeeks": 4},\n'
        '    "moat": {"network": 0, "switching": 0, "data": 0, "cost": 0, "regulatory": 0},\n'
        + ('    "ratings": {"whyNow": 0, "pain": 0, "money": 0, "fit": 0},\n' if edge else '    "ratings": {"whyNow": 0, "pain": 0, "money": 0},\n') +
        '    "playbook": [\n'
        '      {"name": "Customer discovery", "weeks": [1, 2], "steps": ["Interview 10 ...", "..."]},\n'
        '      {"name": "...", "weeks": [3, 6], "steps": ["..."]},\n'
        '      {"name": "...", "weeks": [7, 12], "steps": ["..."]}\n'
        "    ]\n"
        "  }]\n"
        "}\n"
        "Each playbook phase has 3 to 5 concrete steps that start with a verb."
    )


def prompt_red_team(theme: str, ideas: List[dict]) -> str:
    listing = "\n".join(f"- {i['name']}: {i['oneLiner']} (buyer: {i['icp']})" for i in ideas)
    return (
        f'Theme: "{theme}"\n\nIdeas:\n{listing}\n\n'
        "Red-team each idea like a skeptical investor: its 3 biggest risks (for example distribution, "
        "an incumbent copying it, regulation, unit economics, technical), how severe each is, and the "
        "most practical way to blunt it. Be honest; a weak idea should get High risks. JSON:\n"
        '{"reviews": [{"idea": "exact idea name", "risks": [{"kind": "Distribution", "detail": "...", '
        '"severity": "High" | "Medium" | "Low", "mitigation": "..."}]}]}'
    )


# --- The write-up as a Note ---

def note_html(dossier: dict, ideas: List[dict]) -> str:
    e = html.escape
    src = dossier["sources"]

    def cite(refs) -> str:
        links = [f'<a href="{e(src[n - 1]["url"])}">[{n}]</a>' for n in refs if 0 < n <= len(src)]
        return " " + " ".join(links) if links else ""

    out = [f"<h1>{e(dossier['theme'])}</h1>", f"<p><i>Radar research, {e(dossier['createdAt'][:10])}. AI: {e(dossier['engine'] or '')}. Numbers are estimates.</i></p>"]
    if dossier.get("summary"):
        out.append(f"<p><b>{e(dossier['summary'])}</b></p>")
    out.append("<h2>Market</h2>")
    out.append(f"<p>{e(dossier.get('macro', ''))}</p>")
    if dossier.get("whyNow"):
        out.append(f"<p><b>Why now:</b> {e(dossier['whyNow'])}</p>")
    if dossier.get("claims"):
        out.append("<ul>" + "".join(f"<li>{e(c['text'])}{cite([c['source']] if c.get('source') else [])}</li>" for c in dossier["claims"]) + "</ul>")
    if dossier.get("valueChain"):
        out.append("<h2>Value chain</h2><ul>")
        out.extend(f"<li><b>{e(l['layer'])}</b>: {e(l['players'])}. Gap: {e(l['gap'])}</li>" for l in dossier["valueChain"])
        out.append("</ul>")
    for idea in ideas:
        out.append(f"<h2>{e(idea['name'])} ({idea['score']}/100)</h2>")
        out.append(f"<p>{e(idea['oneLiner'])}{cite(idea['sources'])}</p>")
        out.append(f"<p><b>Buyer:</b> {e(idea['icp'])}<br><b>Pain:</b> {e(idea['pain'])}<br><b>Why now:</b> {e(idea['whyNow'])}</p>")
        nums = [
            ("ACV", f"${idea['acvUsd']:,.0f}" if idea["acvUsd"] is not None else "?"),
            ("Gross margin", f"{idea['grossMarginPct']:.0f}%" if idea["grossMarginPct"] is not None else "?"),
            ("Payback", f"{idea['paybackMonths']:.0f} months" if idea["paybackMonths"] is not None else "?"),
            ("Sales cycle", f"{idea['salesCycleWeeks']:.0f} weeks" if idea["salesCycleWeeks"] is not None else "?"),
        ]
        out.append("<p>" + " · ".join(f"<b>{k}:</b> {v}" for k, v in nums) + " (estimates)</p>")
        if idea["risks"]:
            out.append("<p><b>Risks</b></p><ul>" + "".join(
                f"<li><b>{e(r['kind'])} ({r['severity']})</b>: {e(r['detail'])} <i>Mitigation: {e(r['mitigation'])}</i></li>" for r in idea["risks"]
            ) + "</ul>")
        if idea["playbook"]:
            out.append("<p><b>90-day playbook</b></p><ul>" + "".join(
                f"<li><b>Weeks {p['startWeek']}-{p['endWeek']}: {e(p['name'])}</b><ul>" + "".join(f"<li>{e(s)}</li>" for s in p["steps"]) + "</ul></li>"
                for p in idea["playbook"]
            ) + "</ul>")
    if src:
        out.append("<h2>Sources</h2><ol>" + "".join(f'<li><a href="{e(s["url"])}">{e(s["title"])}</a> ({e(_site(s["url"]))})</li>' for s in src) + "</ol>")
    return "".join(out)


def note_record(note_id: str, dossier: dict, ideas: List[dict], now: str) -> dict:
    body = note_html(dossier, ideas)
    text = re.sub(r"\s+\n", "\n", re.sub(r"<(br|/p|/li|/h\d)>", "\n", body))
    text = html.unescape(re.sub(r"<[^>]+>", "", text)).strip()
    parts = max(1, -(-len(body) // CELL_LIMIT))
    record = {
        "id": note_id,
        "title": f"Radar: {dossier['theme']}"[:120],
        "content": text[:40000],
        "lifeContext": "work",
        "bodyParts": parts,
        "createdAt": now,
        "updatedAt": now,
    }
    for i in range(parts):
        record[f"body{i}"] = "~" + body[i * CELL_LIMIT:(i + 1) * CELL_LIMIT]
    return record


# --- The pipeline ---

class StepFailed(Exception):
    pass


class Pipeline:
    def __init__(self, job: dict, client: Optional[httpx.AsyncClient] = None):
        self.job = job
        self.client = client
        self.headlines: List[dict] = []
        self.web: List[dict] = []
        self.pains: List[dict] = []
        self.sources: List[dict] = []
        self.market: dict = {}
        self.ideas: List[dict] = []
        self.raw: List[str] = []
        self.review = False

    async def step(self, index: int, work: Callable[[], Awaitable[str]]) -> None:
        step = self.job["steps"][index]
        self.job["step"] = index + 1
        step["status"] = "run"
        await _announce(self.job)
        started = time.monotonic()
        try:
            step["detail"] = await asyncio.wait_for(work(), STEP_LIMITS[index])
            step["status"] = "done"
        except asyncio.TimeoutError:
            step["status"] = "failed"
            step["detail"] = f"Took longer than {STEP_LIMITS[index]} s"
            raise StepFailed(f"{step['name']} took too long")
        except StepFailed:
            step["status"] = "failed"
            raise
        except AIError as e:
            step["status"] = "failed"
            step["detail"] = str(e)[:200]
            raise StepFailed(str(e))
        finally:
            step["seconds"] = round(time.monotonic() - started, 1)
            await _announce(self.job)

    async def run(self) -> None:
        own = self.client is None
        self.client = self.client or httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": radar.USER_AGENT})
        try:
            await self.step(0, self.read_news)
            await self.step(1, self.search_web)
            await self.step(2, self.mine_pain)
            await self.step(3, self.draft)
            await self.step(4, self.red_team)
            await self.save("needs_review" if self.review else "done")
        except StepFailed as e:
            self.job["error"] = str(e)
            # Whatever was found so far is still worth keeping when the AI got that far.
            if self.market or self.ideas:
                await self.save("needs_review")
            else:
                self.job["status"] = "failed"
        finally:
            if own:
                await self.client.aclose()

    async def read_news(self) -> str:
        self.headlines = matching_headlines(self.job["theme"])
        return f"{len(self.headlines)} headline{'s' if len(self.headlines) != 1 else ''} matched"

    async def search_web(self) -> str:
        data, raw = await ask_json(self.job, prompt_queries(self.job["theme"], self.headlines), "queries", 600)
        queries = [_text(q, 120) for q in (data or {}).get("queries", []) if _text(q, 120)][:QUERIES]
        if not queries:
            queries = [self.job["theme"], f"{self.job['theme']} market size", f"{self.job['theme']} startups"]
        results = await asyncio.gather(*[search_web(self.client, q) for q in queries])
        seen = {h["link"] for h in self.headlines}
        for batch in results:
            for r in batch:
                if r["url"] not in seen and len(self.web) < MAX_WEB_SOURCES:
                    seen.add(r["url"])
                    self.web.append(r)
        await asyncio.gather(*[read_page(self.client, s) for s in self.web[:PAGES_TO_READ]])
        read = sum(1 for s in self.web if s.get("text"))
        return f"{len(queries)} queries, {len(self.web)} results, {read} pages read"

    async def mine_pain(self) -> str:
        self.pains = await mine_hn(self.client, self.job["theme"])
        return f"{len(self.pains)} complaint{'s' if len(self.pains) != 1 else ''} on Hacker News"

    def _all_sources(self) -> List[dict]:
        out = [{"title": h["title"], "url": h["link"], "kind": "news", "snippet": f"{h['source']}, {h['published'][:10]}"} for h in self.headlines[:8]]
        out += self.web
        out += [{"title": p["title"], "url": p["url"], "kind": "hn", "snippet": p["text"]} for p in self.pains[:6]]
        return out

    async def draft(self) -> str:
        self.sources = self._all_sources()
        if not self.sources:
            raise StepFailed("No sources found for this theme. Try wording it differently.")
        data, raw = await ask_json(self.job, prompt_market(self.job["theme"], self.job["depth"], self.sources, self.pains), "macro", 3000)
        if data is None:
            self.raw.append(raw)
            self.review = True
            data = {"macro": _text(raw, 3000)}
        count = len(self.sources)
        self.market = {
            "summary": _text(data.get("summary"), 400),
            "macro": _text(data.get("macro"), 3000),
            "whyNow": _text(data.get("whyNow"), 500),
            "valueChain": [
                {"layer": _text(l.get("layer"), 80), "players": _text(l.get("players"), 200), "gap": _text(l.get("gap"), 240)}
                for l in (data.get("valueChain") or [])[:6] if isinstance(l, dict) and l.get("layer")
            ],
            "claims": [
                {"text": _text(c.get("text"), 300), "source": (_refs(c.get("source"), count) or [None])[0]}
                for c in (data.get("claims") or [])[:8] if isinstance(c, dict) and c.get("text")
            ],
        }
        await _announce(self.job)

        data, raw = await ask_json(self.job, prompt_ideas(self.job["theme"], self.market, self.pains, self.sources, _edge()), "ideas", 5000)
        ideas = [clean_idea(i, count) for i in (data or {}).get("ideas", []) if isinstance(i, dict)][:3]
        if not ideas:
            self.raw.append(raw)
            raise StepFailed("The AI didn't return ideas in a form Radar can read")
        self.ideas = ideas
        return f"{len(ideas)} theses, {len(self.market['claims'])} sourced claims"

    async def red_team(self) -> str:
        data, raw = await ask_json(self.job, prompt_red_team(self.job["theme"], self.ideas), "reviews", 3000)
        reviews = (data or {}).get("reviews") or []
        by_name = {str(r.get("idea", "")).strip().lower(): r for r in reviews if isinstance(r, dict)}
        found = 0
        for i, idea in enumerate(self.ideas):
            review = by_name.get(idea["name"].lower()) or (reviews[i] if i < len(reviews) and isinstance(reviews[i], dict) else {})
            idea["risks"] = clean_risks(review.get("risks"))
            found += len(idea["risks"])
        if not found:
            self.raw.append(raw)
            self.review = True
        highs = sum(1 for idea in self.ideas for r in idea["risks"] if r["severity"] == "High")
        return f"{found} risks, {highs} high"

    async def save(self, status: str) -> None:
        now = _utc()
        job = self.job
        for idea in self.ideas:
            idea.setdefault("risks", [])
            idea["score"], idea["scoreParts"] = score(idea)
        self.ideas.sort(key=lambda i: -i["score"])
        dossier = {
            "id": job["id"],
            "theme": job["theme"],
            "depth": job["depth"],
            "engine": job["engine"],
            "status": status,
            "error": job.get("error", ""),
            **{k: self.market.get(k, [] if k in ("valueChain", "claims") else "") for k in ("summary", "macro", "whyNow", "valueChain", "claims")},
            "painPoints": [{"text": p["text"], "url": p["url"]} for p in self.pains[:8]],
            "sources": [{"title": s["title"], "url": s["url"], "kind": s["kind"], "site": _site(s["url"])} for s in self.sources],
            "steps": [{"name": s["name"], "detail": s["detail"], "seconds": s["seconds"]} for s in job["steps"]],
            "starred": False,
            "lifeContext": "work",
            "createdAt": job["createdAt"],
            "updatedAt": now,
        }
        if self.raw:
            dossier["raw"] = "\n\n---\n\n".join(self.raw)[:CELL_LIMIT]
        idea_records = []
        for idea in self.ideas:
            idea_records.append({
                "id": str(uuid.uuid4()),
                "dossierId": job["id"],
                **idea,
                "starred": False,
                "projectId": None,
                "lifeContext": "work",
                "createdAt": now,
                "updatedAt": now,
            })
        dossier["ideaIds"] = [i["id"] for i in idea_records]
        note_id = str(uuid.uuid4())
        dossier["noteId"] = note_id
        note = note_record(note_id, dossier, idea_records, now)

        ops = [_op("dossiers", dossier), *(_op("ideas", i) for i in idea_records), _op("notes", note)]
        if _apply is None:
            raise RuntimeError("Radar research isn't connected to Sage's database")
        result = await _apply(ops)
        refused = [r for r in result.get("results", []) if r.get("status") != "applied"]
        if refused:
            raise RuntimeError(f"Sage refused to save the results: {refused[0].get('reason')}")
        job.update(status=status, ideaIds=dossier["ideaIds"], noteId=note_id)


def _edge() -> List[str]:
    import sparks  # sparks imports this module, so not at the top

    try:
        return sparks.edge_lines()
    except Exception:
        return []


def _op(table: str, record: dict) -> dict:
    return {
        "operationId": str(uuid.uuid4()),
        "clientId": SOURCE,
        "entityType": table,
        "entityId": record["id"],
        "operation": "save",
        "revision": 1,
        "payload": record,
    }


# --- Routes ---

router = APIRouter()


@router.post("/api/radar/research")
async def research_start(req: ResearchRequest):
    from fastapi.responses import JSONResponse

    try:
        job = start(req)
    except ValueError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=400)
    except LimitReached as e:
        return JSONResponse({"success": False, "error": str(e), "limit": True}, status_code=429)
    return {"success": True, "job": job}


@router.get("/api/radar/research")
def research_list():
    settings = radar.get_settings()
    return {
        "success": True,
        "jobs": recent_jobs(),
        "runsToday": runs_today(),
        "dailyCap": settings["dailyCap"],
        "engines": [e for e in engines() if e != "local"] or ["local"],
    }


@router.get("/api/radar/research/{job_id}")
def research_get(job_id: str):
    from fastapi.responses import JSONResponse

    job = get_job(job_id)
    if not job:
        return JSONResponse({"success": False, "error": "No such research run"}, status_code=404)
    return {"success": True, "job": job}
