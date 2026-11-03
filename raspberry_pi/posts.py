"""
Posts: paste or upload a script, the Pi draws the Instagram carousel, and an
email says when it is done.

The slide maker is the Auto Content engine, copied into content_engine/ and run
as a separate process (python -m autocontent run), so its Chromium never lives
inside the Sage server. One post is drawn at a time. No AI is involved: the
script is built exactly as written (see content_engine/POST_FORMAT.md) and a
code-only audit checks the result.

  POST /api/posts/check      check a script, with line numbers, no drawing
  POST /api/posts            save a script and queue the drawing
  GET  /api/posts            recent posts + whether the slide maker is ready
  GET  /api/posts/{id}       one post: progress log, slides, caption, audit
  POST /api/posts/{id}/rerender, /posted, /send ; DELETE /api/posts/{id}
  GET  /api/posts/{id}/slides/{n}.png (or .jpg for sharing), /zip, /qr.svg

Posts live in a Pi-only table; the PNGs live in sage_posts/<id>/ next to the
database (so they are in the nightly backup, and never sync to other devices).
A post can belong to a project that has Use Auto Content switched on: it then
appears there as a normal task that moves Script > Ready > Posted.
"""

import asyncio
import datetime
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import threading
import time
import uuid
import zipfile
from collections import OrderedDict
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

import item_shape
import logstore
import notifier
import web_files

DB_PATH = "sage_sync.db"
ENGINE_DIR = Path(__file__).resolve().parent / "content_engine"
POSTS_DIR = notifier.DATA_DIR / "sage_posts"
STYLES = ("grid_pill", "beige_grain")
FORMATS = ("portrait", "square")
MAX_SCRIPT = 60_000          # characters
MAX_QUEUE = 5                # posts waiting or drawing at once
RENDER_TIMEOUT = 900         # seconds; a Pi 5 needs about 30
KEEP = 100                   # posts kept
LOG_LINES = 120
THUMB_WIDTH = 420
EMAIL_THUMBS = 10

_broadcast: Optional[Callable[[dict], Awaitable[None]]] = None
_create_record: Optional[Callable[..., Awaitable[dict]]] = None
_update_record: Optional[Callable[..., Awaitable[dict]]] = None
_find_record: Optional[Callable[[str, str], Optional[dict]]] = None
_lock = asyncio.Lock()
_tasks: set = set()

PROGRESS = re.compile(r"^\[\s*([\d.]+)s \|\s*\+([\d.]+)s\]\s*(.*)$")
SLIDE_STEP = re.compile(r"Rendering slide (\d+) of (\d+)")


# --- This week's slides, kept hot in RAM ---
#
# The Pi has memory to spare but can read its slides off a slow USB drive, so
# the first open of a post waits while a dozen images come off the disk. We
# keep this week's slide images in a bounded in-process cache: served straight
# from RAM, so reads never touch the drive. Older posts aren't cached -- they
# stay on disk and load on demand ("this week ready, older waits in storage").
#
# The cache holds the small derived images the Posts page actually fetches
# (540 px previews and the share JPEGs) plus the full PNGs, all keyed by post.
# It is capped by size (SAGE_HOT_CACHE_MB, default 150 MB) and evicts least-
# recently-used entries first; set it to 0 to turn the cache off entirely.


def _hot_days() -> int:
    """Posts newer than this many days are kept hot; 0 disables the window."""
    try:
        return max(0, int(float(os.getenv("SAGE_HOT_DAYS", "7"))))
    except (TypeError, ValueError):
        return 7


def _hot_cap_bytes() -> int:
    try:
        return max(0, int(float(os.getenv("SAGE_HOT_CACHE_MB", "150")))) * 1024 * 1024
    except (TypeError, ValueError):
        return 150 * 1024 * 1024


class HotImageCache:
    """A thread-safe, size-bounded LRU cache of image bytes.

    FastAPI serves these images from its sync threadpool, so every method is
    guarded by a lock. Entries are keyed ``"<post_id>/<kind>/<n>"`` so a whole
    post can be dropped at once when it is remade or deleted.
    """

    def __init__(self, cap_bytes: int):
        self.cap = cap_bytes
        self._store: "OrderedDict[str, bytes]" = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            data = self._store.get(key)
            if data is None:
                self.misses += 1
                return None
            self._store.move_to_end(key)
            self.hits += 1
            return data

    def put(self, key: str, data: bytes) -> None:
        if self.cap <= 0 or not data or len(data) > self.cap:
            return
        with self._lock:
            old = self._store.pop(key, None)
            if old is not None:
                self._bytes -= len(old)
            self._store[key] = data
            self._bytes += len(data)
            while self._bytes > self.cap and self._store:
                _, evicted = self._store.popitem(last=False)
                self._bytes -= len(evicted)

    def invalidate(self, post_id: str) -> None:
        prefix = f"{post_id}/"
        with self._lock:
            for key in [k for k in self._store if k.startswith(prefix)]:
                self._bytes -= len(self._store.pop(key))

    def stats(self) -> dict:
        with self._lock:
            return {
                "entries": len(self._store),
                "bytes": self._bytes,
                "capBytes": self.cap,
                "hits": self.hits,
                "misses": self.misses,
            }


_hot = HotImageCache(_hot_cap_bytes())


def _hot_key(post_id: str, kind: str, n: int) -> str:
    return f"{post_id}/{kind}/{n}"


def _is_fresh(post: dict) -> bool:
    """True while a post is young enough to keep its slides hot in RAM."""
    days = _hot_days()
    if days == 0:
        return True
    created = str(post.get("createdAt") or "")
    try:
        when = datetime.datetime.strptime(created[:19], "%Y-%m-%dT%H:%M:%S")
        when = when.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return False
    age = datetime.datetime.now(datetime.timezone.utc) - when
    return age <= datetime.timedelta(days=days)


def _serve_file(post: dict, path: Path, kind: str, n: int, media_type: str, request=None) -> Response:
    """Serve an image from RAM when its post is in this week's window, reading
    the file (and caching it) only on the first miss. Older posts are streamed
    straight off disk and never fill the cache, except the tiny cover
    thumbnails, which always stay in RAM so the list never waits on the drive.

    A picture never changes for a given post and finish time, so the app asks
    for it with ?v=<finish time> and the browser keeps it for a year; a second
    visit then doesn't touch the Pi at all. The ETag lets it re-check cheaply."""
    versioned = bool(request is not None and request.query_params.get("v"))
    cache = "private, max-age=31536000, immutable" if versioned else "private, max-age=86400"
    etag = '"%s-%s-%s-%s"' % (post["id"], kind, n, post.get("finishedAt") or "")
    headers = {"Cache-Control": cache, "ETag": etag}
    if request is not None and etag in request.headers.get("if-none-match", ""):
        return Response(status_code=304, headers=headers)
    keep_hot = kind == "thumb" or _is_fresh(post)
    if _hot.cap <= 0 or not keep_hot:
        return FileResponse(path, media_type=media_type, headers=headers)
    key = _hot_key(post["id"], kind, n)
    data = _hot.get(key)
    if data is None:
        try:
            data = path.read_bytes()
        except OSError:
            return FileResponse(path, media_type=media_type, headers=headers)
        _hot.put(key, data)
    return Response(data, media_type=media_type, headers=headers)


def warm_cache() -> None:
    """Fill the cache with this week's slides in the background, at low
    priority so it never slows the boot. Runs once, shortly after start."""
    if _hot.cap <= 0:
        return
    try:
        os.nice(15)
    except (OSError, AttributeError):
        pass
    time.sleep(8)  # let the server finish coming up first
    loaded = warmed_bytes = 0
    try:
        posts = [p for p in recent(limit=0) if _is_fresh(p)]
    except Exception as e:  # a cold cache is never worth crashing a thread over
        logstore.warn("posts", f"Couldn't list posts to warm the cache: {e}")
        return
    # Every post's cover thumbnail (a few KB each) goes in, fresh or not, so the list is instant.
    try:
        for row in recent(limit=0):
            if not row.get("hasCover"):
                continue
            full = get(row["id"])
            path = thumb_jpeg(full, 1) if full else None
            if path and Path(path).is_file():
                _hot.put(_hot_key(row["id"], "thumb", 1), Path(path).read_bytes())
    except Exception as e:
        logstore.warn("posts", f"Couldn't warm the cover thumbnails: {e}")
    for summary_row in posts:
        post = get(summary_row["id"])
        if not post:
            continue
        try:
            prepare_copies(post)  # make the preview/share JPEGs if missing
        except Exception:
            pass
        for n in range(1, len(post.get("slides") or []) + 1):
            for kind, maker, mt in (
                ("preview", preview_jpeg, "image/jpeg"),
                ("share", share_jpeg, "image/jpeg"),
                ("png", slide_path, "image/png"),
            ):
                if warmed_bytes >= _hot.cap:
                    break
                try:
                    path = maker(post, n) if kind != "png" else slide_path(post, n)
                except Exception:
                    path = None
                if not path or not Path(path).is_file():
                    continue
                try:
                    data = Path(path).read_bytes()
                except OSError:
                    continue
                _hot.put(_hot_key(post["id"], kind, n), data)
                warmed_bytes += len(data)
                loaded += 1
        if warmed_bytes >= _hot.cap:
            break
    logstore.info(
        "posts",
        f"Warmed {loaded} slide images ({warmed_bytes // 1024} KB) for {len(posts)} recent posts into RAM",
    )


def _utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect(db_path: str, broadcast=None, create_record=None, update_record=None, find_record=None) -> None:
    global DB_PATH, _broadcast, _create_record, _update_record, _find_record
    DB_PATH, _broadcast = db_path, broadcast
    _create_record, _update_record, _find_record = create_record, update_record, find_record
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, created_at TEXT, status TEXT, payload TEXT)")
    # A post that was being drawn when the server stopped will never finish now.
    for post_id, payload in conn.execute("SELECT id, payload FROM posts").fetchall():
        post = json.loads(payload)
        if post.get("status") in ("queued", "running"):
            post.update(status="failed", error="Sage restarted while this was being made. Press Make again.")
            conn.execute("UPDATE posts SET status = ?, payload = ? WHERE id = ?", (post["status"], json.dumps(post), post_id))
    conn.commit()
    conn.close()
    # Pull this week's slides into RAM after the server is up, off the main
    # thread and at low priority so booting stays quick.
    if _hot.cap > 0:
        threading.Thread(target=warm_cache, name="posts-warm-cache", daemon=True).start()


# --- Storage ---

def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def save(post: dict) -> None:
    _write((post["id"], post["createdAt"], post["status"], json.dumps(post)))


async def save_async(post: dict) -> None:
    """save() for code on the event loop: the post is turned into JSON here, so
    nothing changes it mid-write, and the write itself runs on a thread, so a
    busy database can't freeze every other request while it waits."""
    await asyncio.to_thread(_write, (post["id"], post["createdAt"], post["status"], json.dumps(post)))


def _write(row: tuple) -> None:
    conn = _db()
    try:
        conn.execute("INSERT OR REPLACE INTO posts (id, created_at, status, payload) VALUES (?, ?, ?, ?)", row)
        old = conn.execute("SELECT id FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created_at DESC LIMIT ?)", (KEEP,)).fetchall()
        for row in old:
            shutil.rmtree(POSTS_DIR / row["id"], ignore_errors=True)
        conn.execute("DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created_at DESC LIMIT ?)", (KEEP,))
        conn.commit()
    finally:
        conn.close()
    _mem_clear()


def get(post_id: str) -> Optional[dict]:
    if not re.fullmatch(r"[0-9a-f]{12}", post_id or ""):
        return None
    conn = _db()
    try:
        row = conn.execute("SELECT payload FROM posts WHERE id = ?", (post_id,)).fetchone()
    finally:
        conn.close()
    return json.loads(row["payload"]) if row else None


# Read-only copies kept in memory. A post page asks for a dozen images in a
# row and every request used to read and parse the whole post (script, log and
# all) off the database first; the list did the same for all 60 posts. Any
# write drops everything here, so a reader never sees stale data. Callers get
# the shared dict and must not change it -- code that edits a post uses get().
_mem_lock = threading.Lock()
_mem_posts: "OrderedDict[str, dict]" = OrderedDict()
_mem_rows: Optional[List[dict]] = None   # every post's list row, newest first
_MEM_POSTS_MAX = 64


def _mem_clear() -> None:
    global _mem_rows
    with _mem_lock:
        _mem_posts.clear()
        _mem_rows = None


def get_shared(post_id: str) -> Optional[dict]:
    """get() for read-only use (serving images): answered from memory when it can."""
    with _mem_lock:
        post = _mem_posts.get(post_id)
        if post is not None:
            _mem_posts.move_to_end(post_id)
            return post
    post = get(post_id)
    if post is not None:
        with _mem_lock:
            _mem_posts[post_id] = post
            while len(_mem_posts) > _MEM_POSTS_MAX:
                _mem_posts.popitem(last=False)
    return post


def _all_rows() -> List[dict]:
    global _mem_rows
    with _mem_lock:
        if _mem_rows is not None:
            return _mem_rows
    conn = _db()
    try:
        rows = conn.execute("SELECT payload FROM posts ORDER BY created_at DESC").fetchall()
    finally:
        conn.close()
    built = [summary(json.loads(row["payload"])) for row in rows]
    with _mem_lock:
        _mem_rows = built
    return built


def recent(project_id: str = "", limit: int = 60) -> List[dict]:
    """The list rows, newest first. Built once and kept in memory until a post
    changes, so opening Posts doesn't re-read every post off the drive."""
    out = [r for r in _all_rows() if not project_id or r.get("projectId") == project_id]
    return out[:limit] if limit else list(out)


# Fields the list row never needs: the heavy or per-slide parts. The app loads
# the full post (GET /api/posts/{id}) when you open one.
_ROW_DROP = ("script", "log", "caption", "slides", "auditNote")


def summary(post: dict) -> dict:
    """The list row: light metadata only (title, status, counts, stage).
    The script, log, caption and the per-slide list are left for the open view;
    slide images are served from disk only when a post is opened."""
    keep = {k: v for k, v in post.items() if k not in _ROW_DROP}
    keep["captionStart"] = (post.get("caption") or "")[:140]
    keep["slides"] = []  # kept for the Post type; filled in by the open view
    keep["hasCover"] = bool(post.get("status") == "done" and post.get("slides"))
    return keep


async def _announce(post: dict) -> None:
    if _broadcast:
        try:
            await _broadcast({
                "type": "POST_PROGRESS", "id": post["id"], "status": post["status"],
                "done": post.get("progress", {}).get("done", 0), "total": post.get("progress", {}).get("total", 0),
            })
        except Exception:
            pass


# --- Is the slide maker ready? ---

def chromium_path() -> str:
    """The browser to draw with: AUTOCONTENT_CHROMIUM, else the one Playwright
    installed, else the system's (apt chromium). Empty means Playwright's own."""
    explicit = os.environ.get("AUTOCONTENT_CHROMIUM", "").strip()
    if explicit:
        return explicit if Path(explicit).exists() else ""
    return ""


def _playwright_browser_present() -> bool:
    root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / ".cache" / "ms-playwright")
    return root.is_dir() and any(root.glob("chromium*"))


def status() -> dict:
    """What the New post screen needs to know before it offers Make."""
    import importlib.util
    problems = []
    if not (ENGINE_DIR / "src" / "autocontent").is_dir():
        problems.append("The slide engine (content_engine/) is missing from this install.")
    for module, hint in (("playwright", "playwright"), ("jinja2", "jinja2"), ("numpy", "numpy"), ("PIL", "pillow")):
        if importlib.util.find_spec(module) is None:
            problems.append(f"Python module {hint} is not installed (pip install -r requirements.txt).")
    explicit = os.environ.get("AUTOCONTENT_CHROMIUM", "").strip()
    if explicit and not Path(explicit).exists():
        problems.append(f"AUTOCONTENT_CHROMIUM points at {explicit}, which doesn't exist.")
    elif not explicit and not _playwright_browser_present():
        system = shutil.which("chromium") or shutil.which("chromium-browser")
        if not system:
            problems.append("No Chromium found. Run: playwright install chromium (or sudo apt install chromium).")
    prefs = notifier.get_prefs()
    link = notifier._app_link()
    try:
        import segno  # noqa: F401
        qr = True
    except ImportError:
        qr = False
    return {
        "ready": not problems,
        "problems": problems,
        "styles": list(STYLES),
        "formats": list(FORMATS),
        "emailReady": notifier.email_ready(prefs),
        "emailOn": bool(prefs["email"].get("postReady", True)),
        "emailTo": prefs["email"].get("to") or "",
        "link": link,
        "secureLink": link.startswith("https://"),
        "qr": qr,
        "queued": queue_length(),
        "maxScript": MAX_SCRIPT,
        "pictureSources": picture_sources(),
        "hotCache": _hot.stats(),
    }


def queue_length() -> int:
    conn = _db()
    try:
        return conn.execute("SELECT COUNT(*) FROM posts WHERE status IN ('queued', 'running')").fetchone()[0]
    finally:
        conn.close()


# --- Checking a script ---

def _engine_on_path() -> None:
    src = str(ENGINE_DIR / "src")
    if src not in sys.path:
        sys.path.insert(0, src)


def check(script: str) -> dict:
    """Parse the script the way the engine will: every error and warning with its
    line and slide number, plus the slides, caption and hashtags it found."""
    _engine_on_path()
    from autocontent.spec import parse_spec  # the engine's own parser
    spec = parse_spec(script, base_dir=str(ENGINE_DIR), require_marker=False)
    issues = [{
        "severity": i.severity, "code": i.code, "message": i.message, "line": i.line,
        "slide": i.slide, "hint": i.hint or "",
    } for i in spec.issues]
    slides = []
    for n, s in enumerate(spec.slides, start=1):
        slides.append({
            "n": n, "type": s.get("type"),
            "title": str(s.get("headline") or s.get("number") or s.get("body") or s.get("image") or "")[:90],
        })
    meta = dict(spec.meta or {})
    return {
        "ok": bool(spec.ok),
        "errors": sum(1 for i in issues if i["severity"] == "ERROR"),
        "warnings": sum(1 for i in issues if i["severity"] != "ERROR"),
        "issues": issues,
        "slides": slides,
        "caption": spec.caption or "",
        "hashtags": list(spec.hashtags or []),
        "title": str(meta.get("title") or (slides[0]["title"] if slides else "")).strip(),
        "style": str(meta.get("style") or ""),
        "format": str(meta.get("format") or ""),
    }


# --- Making a post ---

class Busy(Exception):
    pass


def _clean_script(script: str) -> str:
    return (script or "").replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")


def start(script: str, title: str = "", style: str = "", fmt: str = "", project_id: str = "") -> dict:
    script = _clean_script(script)
    if not script.strip():
        raise ValueError("Paste a script first.")
    if len(script) > MAX_SCRIPT:
        raise ValueError(f"That script is {len(script):,} characters; the limit is {MAX_SCRIPT:,}.")
    if style and style not in STYLES:
        raise ValueError(f"Style must be one of {', '.join(STYLES)}.")
    if fmt and fmt not in FORMATS:
        raise ValueError(f"Size must be one of {', '.join(FORMATS)}.")
    report = check(script)
    if not report["ok"]:
        first = next((i for i in report["issues"] if i["severity"] == "ERROR"), None)
        where = f" (line {first['line']})" if first and first.get("line") else ""
        raise ValueError(f"The script has {report['errors']} error(s); fix them first. {first['message'] if first else ''}{where}".strip())
    if queue_length() >= MAX_QUEUE:
        raise Busy(f"{MAX_QUEUE} posts are already waiting. Try again in a minute.")
    post = {
        "id": uuid.uuid4().hex[:12],
        "createdAt": _utc(),
        "title": (title or report["title"] or "Untitled post").strip()[:120],
        "script": script,
        "style": style or report["style"] or "grid_pill",
        "format": fmt or report["format"] or "portrait",
        "projectId": project_id or None,
        "taskId": None,
        "status": "queued",
        "error": "",
        "log": [],
        "progress": {"done": 0, "total": len(report["slides"])},
        "slideCount": 0,
        "slides": [],
        "caption": report["caption"],
        "hashtags": report["hashtags"],
        "audit": None,
        "auditNote": "",
        "seconds": None,
        "finishedAt": None,
        "posted": False,
        "postedAt": None,
        "emailed": False,
        "emailError": "",
    }
    save(post)
    _spawn(_run(post))
    return post


def restart(post: dict, script: str = "", style: str = "", fmt: str = "") -> dict:
    """Draw the same post again, optionally with an edited script."""
    if post["status"] in ("queued", "running"):
        raise ValueError("This post is still being made.")
    if script:
        script = _clean_script(script)
        if len(script) > MAX_SCRIPT:
            raise ValueError(f"That script is {len(script):,} characters; the limit is {MAX_SCRIPT:,}.")
        report = check(script)
        if not report["ok"]:
            raise ValueError(f"The script has {report['errors']} error(s); fix them first.")
        post["script"] = script
        post["caption"], post["hashtags"] = report["caption"], report["hashtags"]
        post["progress"] = {"done": 0, "total": len(report["slides"])}
    if style in STYLES:
        post["style"] = style
    if fmt in FORMATS:
        post["format"] = fmt
    if queue_length() >= MAX_QUEUE:
        raise Busy(f"{MAX_QUEUE} posts are already waiting. Try again in a minute.")
    post.update(status="queued", error="", log=[], audit=None, auditNote="", seconds=None, finishedAt=None,
                emailed=False, emailError="", posted=False, postedAt=None)
    post["progress"]["done"] = 0
    _hot.invalidate(post["id"])  # the slides are about to be redrawn
    save(post)
    _spawn(_run(post))
    return post


def _spawn(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


# Free picture sources. Wikimedia Commons needs no key; the others use a free key saved from Settings
# (kept in sage_secrets.json beside the database, handed to the slide engine's environment).
PICTURE_KEYS = {"unsplash": "UNSPLASH_ACCESS_KEY", "pexels": "PEXELS_API_KEY", "pixabay": "PIXABAY_API_KEY"}


def picture_keys() -> Dict[str, str]:
    secrets = notifier._secrets()
    return {name: str(secrets.get(env) or os.getenv(env, "")).strip() for name, env in PICTURE_KEYS.items()}


def picture_sources() -> dict:
    """Which picture sources are on, never the keys themselves."""
    keys = picture_keys()
    out = {name: {"set": bool(k), "last4": k[-4:] if len(k) >= 8 else ""} for name, k in keys.items()}
    out["wikimedia"] = {"set": True, "last4": ""}
    return out


def save_picture_key(name: str, value: str) -> None:
    env = PICTURE_KEYS[name]
    secrets = notifier._secrets()
    value = "".join(value.split())
    if value:
        secrets[env] = value
    else:
        secrets.pop(env, None)
    notifier.SECRETS_FILE.touch(mode=0o600, exist_ok=True)
    notifier.SECRETS_FILE.write_text(json.dumps(secrets))


def _engine_env() -> Dict[str, str]:
    env = dict(os.environ)
    for name, key in picture_keys().items():
        if key:
            env[PICTURE_KEYS[name]] = key
    env["PYTHONPATH"] = str(ENGINE_DIR / "src") + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    # The Sage service has no user namespaces to spare for Chromium's sandbox.
    env.setdefault("AUTOCONTENT_NO_SANDBOX", "1")
    if not env.get("AUTOCONTENT_CHROMIUM") and not _playwright_browser_present():
        system = shutil.which("chromium") or shutil.which("chromium-browser")
        if system:
            env["AUTOCONTENT_CHROMIUM"] = system
    env.pop("GROQ_API_KEY", None)  # script mode never calls an AI
    return env


def _note(post: dict, text: str) -> None:
    post["log"].append({"at": _utc(), "text": text[:300]})
    del post["log"][:-LOG_LINES]


async def _run(post: dict) -> None:
    async with _lock:  # one post at a time on the Pi
        folder = POSTS_DIR / post["id"]
        shutil.rmtree(folder, ignore_errors=True)
        (folder / "out").mkdir(parents=True, exist_ok=True)
        script_file = folder / "script.md"
        script_file.write_text(post["script"], encoding="utf-8")
        post["status"] = "running"
        post["slides"], post["slideCount"] = [], 0
        _note(post, "Started")
        await save_async(post)
        await _announce(post)
        await _ensure_task(post)
        code = None
        try:
            code = await _draw(post, folder, script_file)
        except asyncio.TimeoutError:
            post["status"], post["error"] = "failed", f"Drawing took longer than {RENDER_TIMEOUT // 60} minutes and was stopped."
        except Exception as e:
            post["status"], post["error"] = "failed", str(e)[:300] or e.__class__.__name__
        _finish(post, folder, code)
        post["finishedAt"] = _utc()
        await save_async(post)
        await _announce(post)
        if post["status"] == "done":
            await asyncio.to_thread(prepare_copies, post)
            await _after_done(post)
        else:
            logstore.warn("posts", f"Post {post['id']} failed: {post['error']}")


# Drawing a post runs Chromium, which can take every core of the Pi for a
# minute or more. At normal priority the web server waited behind it, so Sage
# opened slowly or stalled on its splash while a post was being made. The
# engine and the Chromium it starts run at a low CPU priority (nice 15),
# so the app always gets served first; the post just takes a little longer.
ENGINE_NICE = int(os.environ.get("SAGE_POSTS_NICE", "15"))


def _lower_priority() -> None:
    try:
        os.nice(ENGINE_NICE)
    except OSError:
        pass


async def _draw(post: dict, folder: Path, script_file: Path) -> int:
    argv = [sys.executable, "-m", "autocontent", "run", str(script_file), "--spec",
            "-o", str(folder / "out"), "--style", post["style"], "--format", post["format"]]
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=str(ENGINE_DIR), env=_engine_env(),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        preexec_fn=_lower_priority if os.name == "posix" else None,
    )
    errors: List[str] = []
    last_save = [0.0]

    async def read() -> None:
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                return
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            m = PROGRESS.match(line)
            text = m.group(3) if m else line
            if not m and not re.search(r"error|fail|warn|AUDIT|problem|not found|Traceback", line, re.I):
                continue  # keep the log to the engine's progress lines and anything alarming
            errors.append(text)
            del errors[:-12]
            step = SLIDE_STEP.search(text)
            if step:
                post["progress"] = {"done": int(step.group(1)) - 1, "total": int(step.group(2))}
            _note(post, text)
            # Save on each new slide, or at most once a second: the engine prints
            # many lines, and each save is a database write.
            now = time.monotonic()
            if step or now - last_save[0] >= 1.0:
                last_save[0] = now
                await save_async(post)
                await _announce(post)

    started = datetime.datetime.now()
    try:
        await asyncio.wait_for(asyncio.gather(read(), proc.wait()), timeout=RENDER_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise
    post["seconds"] = round((datetime.datetime.now() - started).total_seconds(), 1)
    if proc.returncode not in (0, 2):
        post["error"] = _plain_error(errors)
    return proc.returncode or 0


def _plain_error(lines: List[str]) -> str:
    useful = [l for l in lines if not l.startswith("Rendering")]
    if any("Executable doesn't exist" in l or "playwright install" in l for l in lines):
        return "Chromium isn't installed on the Pi. Run: playwright install chromium"
    return (useful[-1] if useful else "The slide maker stopped without saying why.")[:300]


def _finish(post: dict, folder: Path, code: Optional[int]) -> None:
    out = folder / "out"
    pngs = sorted(out.glob("slide_*.png"))
    post["slides"] = [p.name for p in pngs]
    post["slideCount"] = len(pngs)
    if post["status"] == "failed":
        return
    if code in (0, 2) and pngs:
        post["status"] = "done"
        post["progress"] = {"done": len(pngs), "total": len(pngs)}
        post["audit"] = "fail" if code == 2 else "pass"
        audit = out / "audit.md"
        post["auditNote"] = _audit_note(audit) if code == 2 and audit.exists() else ""
        caption = out / "caption.txt"
        if caption.exists():
            post["caption"] = caption.read_text(encoding="utf-8", errors="replace").strip()
    else:
        post["status"] = "failed"
        post["error"] = post["error"] or "No slides came out."


def _audit_note(path: Path) -> str:
    """The first few lines of audit.md that say what is wrong."""
    lines = [l.strip(" -*#") for l in path.read_text(encoding="utf-8", errors="replace").splitlines()]
    bad = [l for l in lines if re.search(r"fail|error|too long|missing|overflow", l, re.I)]
    return " | ".join(bad[:3])[:400]


# --- Linking to the project's task ---

def _project(post: dict) -> Optional[dict]:
    if not post.get("projectId") or not _find_record:
        return None
    return _find_record("projects", post["projectId"])


def _stage_fields(post: dict, stage: str, status: str) -> dict:
    project = _project(post)
    if project and str(project.get("type") or "") == "content" and stage in item_shape.TYPE_STAGES["content"]:
        return {"status": status, "stage": stage}
    return {"status": status}


async def _ensure_task(post: dict) -> None:
    """A post in a project is a task there: Script while drawing, Ready when done."""
    if not post.get("projectId") or not _create_record or not _project(post) or post.get("taskId"):
        return
    try:
        item = await _create_record("workItems", {
            "title": f"Post: {post['title']}", "projectId": post["projectId"], "entityType": "task",
            "labels": ["post"], "postId": post["id"],
            "description": "Made with Auto Content. Open the post from Sage > Posts.",
            **_stage_fields(post, "scripting", "in_progress"),
        })
        post["taskId"] = item.get("id")
        await save_async(post)
    except Exception as e:
        logstore.warn("posts", f"Couldn't add the task for post {post['id']}: {e}")


async def _move_task(post: dict, stage: str, status: str) -> None:
    if not post.get("taskId") or not _update_record:
        return
    try:
        await _update_record("workItems", post["taskId"], _stage_fields(post, stage, status))
    except Exception as e:
        logstore.warn("posts", f"Couldn't move the task for post {post['id']}: {e}")


async def _after_done(post: dict) -> None:
    await _move_task(post, "editing", "in_progress")
    await _email(post)


# --- Email ---

def post_link(post: dict) -> str:
    return notifier._view_link(f"post={post['id']}")


def thumbnails(post: dict, limit: int = EMAIL_THUMBS) -> List[bytes]:
    from PIL import Image
    out = []
    for name in post["slides"][:limit]:
        path = POSTS_DIR / post["id"] / "out" / name
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                im.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 2))
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=78, optimize=True)
                out.append(buf.getvalue())
        except OSError:
            continue
    return out


def build_email(post: dict, thumbs: List[bytes], *, to_phone: bool = False):
    link = post_link(post)
    count = post["slideCount"]
    failed_audit = post.get("audit") == "fail"
    heading = f"Your post is ready: {post['title']}" if not failed_audit else f"Your post is ready, but check it: {post['title']}"
    intro = f"{count} slides" + (f" in {post['seconds']:.0f} seconds" if post.get("seconds") else "") + ". "
    intro += "Open it on your phone and tap Share to send the slides to Instagram." if link else "Open Sage > Posts to share it."
    if failed_audit and post.get("auditNote"):
        intro += f" The audit flagged: {post['auditNote']}"
    cids = [f"slide{n + 1}" for n in range(len(thumbs))]
    strip = "".join(
        f'<a href="{link or "#"}"><img src="cid:{cid}" alt="Slide {n + 1}" width="{THUMB_WIDTH // 2}" '
        f'style="width:48%;max-width:{THUMB_WIDTH // 2}px;border-radius:8px;margin:0 1% 8px 0;border:1px solid #e6e6ec"></a>'
        for n, cid in enumerate(cids)
    )
    more = f'<p style="color:#888;font-size:13px;margin:0 0 8px">+ {count - len(thumbs)} more in Sage</p>' if count > len(thumbs) else ""
    caption = post.get("caption") or ""
    caption_html = (
        '<h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin:22px 0 6px">Caption (press and hold to copy)</h2>'
        f'<div style="font-size:15px;line-height:1.5;white-space:pre-wrap;background:#f4f4f7;border-radius:10px;padding:12px">{_esc(caption)}</div>'
        if caption else ""
    )
    extra = f'<div style="margin-top:14px">{strip}{more}</div>{caption_html}'
    cta = "Share to Instagram" if link else "Open Sage"
    html_body = notifier.email_html(heading, intro, [], link, cta=cta, preheader=intro, extra_html=extra)
    text = notifier.email_text(heading, intro, [], link, cta=cta)
    if caption:
        text += "\n\nCAPTION\n" + caption
    return heading, text, html_body, dict(zip(cids, thumbs))


def _esc(value: str) -> str:
    import html
    return html.escape(value)


async def _email(post: dict, *, force: bool = False) -> bool:
    prefs = await asyncio.to_thread(notifier.get_prefs)
    if not force and not prefs["email"].get("postReady", True):
        return False
    if not notifier.email_ready(prefs):
        post["emailError"] = "Email isn't set up yet (Settings > Notifications)."
        await save_async(post)
        return False
    try:
        thumbs = await asyncio.to_thread(thumbnails, post)
        heading, text, html_body, images = build_email(post, thumbs)
        await asyncio.to_thread(notifier.send_email, prefs, heading, text, html_body, images)
        post["emailed"], post["emailError"] = True, ""
        logstore.info("posts", f"Emailed post {post['id']} ({post['slideCount']} slides)")
    except Exception as e:
        post["emailed"], post["emailError"] = False, str(e)[:200] or e.__class__.__name__
        logstore.warn("posts", f"Email for post {post['id']} failed: {post['emailError']}")
    await save_async(post)
    await _announce(post)
    return post["emailed"]


# --- Files ---

def slide_path(post: dict, n: int) -> Optional[Path]:
    if 1 <= n <= len(post["slides"]):
        path = POSTS_DIR / post["id"] / "out" / post["slides"][n - 1]
        return path if path.is_file() else None
    return None


def zip_bytes(post: dict) -> bytes:
    out = POSTS_DIR / post["id"] / "out"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:  # PNGs don't compress
        for name in post["slides"]:
            if (out / name).is_file():
                z.write(out / name, name)
        z.writestr("caption.txt", post.get("caption") or "")
        z.writestr("script.md", post.get("script") or "")
        if (out / "audit.md").is_file():
            z.write(out / "audit.md", "audit.md")
    return buf.getvalue()


def qr_svg(url: str) -> str:
    import segno
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#17171a", light="#ffffff", xmldecl=False)
    return buf.getvalue().decode("utf-8")


def delete(post_id: str) -> bool:
    conn = _db()
    try:
        cur = conn.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        conn.commit()
    finally:
        conn.close()
    _hot.invalidate(post_id)
    _mem_clear()
    shutil.rmtree(POSTS_DIR / post_id, ignore_errors=True)
    return cur.rowcount > 0


# --- Routes ---

router = APIRouter()


class CheckBody(BaseModel):
    script: str


class NewPost(BaseModel):
    script: str
    title: str = ""
    style: str = ""
    format: str = ""
    projectId: str = ""


class Again(BaseModel):
    script: str = ""
    style: str = ""
    format: str = ""


def _missing() -> JSONResponse:
    return JSONResponse({"success": False, "error": "No such post"}, status_code=404)


def _bad(message: str, code: int = 400) -> JSONResponse:
    return JSONResponse({"success": False, "error": message}, status_code=code)


@router.get("/api/posts")
def posts_list(request: Request, projectId: str = "", limit: int = 60):
    return web_files.json_maybe_gzip(request, {"success": True, "status": status(), "posts": recent(projectId, max(1, min(limit, 100)))})


@router.get("/api/posts/status")
def posts_status():
    return {"success": True, "status": status()}


class PictureKeys(BaseModel):
    unsplash: Optional[str] = None
    pexels: Optional[str] = None
    pixabay: Optional[str] = None


@router.get("/api/posts/pictures")
def posts_pictures():
    return {"success": True, "sources": picture_sources()}


@router.put("/api/posts/pictures")
def posts_pictures_save(body: PictureKeys):
    """A key is replaced when sent, removed when sent empty, and left alone when left out."""
    for name in PICTURE_KEYS:
        value = getattr(body, name)
        if value is not None:
            if len(value) > 200:
                return _bad("That key is too long to be right.")
            save_picture_key(name, value)
    return {"success": True, "sources": picture_sources()}


@router.post("/api/posts/check")
def posts_check(body: CheckBody):
    if len(body.script) > MAX_SCRIPT:
        return _bad(f"That script is {len(body.script):,} characters; the limit is {MAX_SCRIPT:,}.")
    try:
        return {"success": True, "check": check(_clean_script(body.script))}
    except Exception as e:
        return _bad(f"Couldn't read that script: {str(e)[:200]}")


@router.post("/api/posts")
async def posts_create(body: NewPost):
    if not status()["ready"]:
        return _bad("The slide maker isn't ready on this Pi. " + " ".join(status()["problems"]), 503)
    try:
        post = start(body.script, body.title, body.style, body.format, body.projectId)
    except ValueError as e:
        return _bad(str(e))
    except Busy as e:
        return _bad(str(e), 429)
    return {"success": True, "post": post}


@router.get("/api/posts/{post_id}")
def posts_get(post_id: str):
    post = get(post_id)
    return {"success": True, "post": post, "status": status()} if post else _missing()


@router.post("/api/posts/{post_id}/rerender")
async def posts_rerender(post_id: str, body: Again):
    post = get(post_id)
    if not post:
        return _missing()
    try:
        post = restart(post, body.script, body.style, body.format)
    except ValueError as e:
        return _bad(str(e), 409)
    except Busy as e:
        return _bad(str(e), 429)
    return {"success": True, "post": post}


@router.post("/api/posts/{post_id}/posted")
async def posts_posted(post_id: str, undo: bool = False):
    post = get(post_id)
    if not post:
        return _missing()
    if post["status"] != "done":
        return _bad("Only a finished post can be marked as posted.", 409)
    post["posted"] = not undo
    post["postedAt"] = None if undo else _utc()
    await save_async(post)
    if undo:
        await _move_task(post, "editing", "in_progress")
    else:
        await _move_task(post, "published", "done")
    return {"success": True, "post": post}


@router.post("/api/posts/{post_id}/send")
async def posts_send(post_id: str):
    """Email this post to the address in Settings (the "Send to my phone" button)."""
    post = get(post_id)
    if not post:
        return _missing()
    if post["status"] != "done":
        return _bad("This post isn't finished yet.", 409)
    sent = await _email(post, force=True)
    if not sent:
        return _bad(post.get("emailError") or "The email couldn't be sent.", 502)
    return {"success": True, "post": post}


@router.delete("/api/posts/{post_id}")
def posts_delete(post_id: str):
    post = get(post_id)
    if not post:
        return _missing()
    if post["status"] in ("queued", "running"):
        return _bad("Wait for it to finish, then delete it.", 409)
    delete(post_id)
    return {"success": True}


@router.get("/api/posts/{post_id}/slides/{n}.png")
def posts_slide(post_id: str, n: int, request: Request):
    post = get_shared(post_id)
    path = slide_path(post, n) if post else None
    if not path:
        return _missing()
    return _serve_file(post, path, "png", n, "image/png", request)


PREVIEW_WIDTH = 540  # the post page shows slides about 330 px wide; 540 stays sharp on 2x screens


def _jpeg_copy(post: dict, n: int, kind: str, width: int, quality: int, subsampling: int) -> Optional[Path]:
    """A JPEG copy of slide n, made once and kept in out/<kind>/. Written to a
    temp name and renamed, so two requests making it at once can't serve half a file."""
    src = slide_path(post, n)
    if not src:
        return None
    dest = POSTS_DIR / post["id"] / "out" / kind / f"{src.stem}.jpg"
    if not dest.is_file() or dest.stat().st_mtime < src.stat().st_mtime:
        from PIL import Image
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(f".{dest.stem}.{os.getpid()}.{threading.get_ident()}.tmp")
        with Image.open(src) as im:
            im = im.convert("RGB")
            if im.width > width:
                im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
            im.save(tmp, "JPEG", quality=quality, optimize=True, subsampling=subsampling)
        os.replace(tmp, dest)
    return dest


def share_jpeg(post: dict, n: int) -> Optional[Path]:
    """The slide as a JPEG for the phone's share sheet. Instagram lists itself
    for JPEG pictures, and several phones leave it out for large PNGs, so Share
    sends these. Made once, kept beside the PNGs, and the ZIP keeps the PNGs."""
    return _jpeg_copy(post, n, "share", 10_000, 92, 0)


def preview_jpeg(post: dict, n: int) -> Optional[Path]:
    """A small JPEG of the slide (540 px wide, a few dozen KB) for the post
    page. The full PNGs are a few MB together, so showing those made the page
    sit on grey boxes over a slow link."""
    return _jpeg_copy(post, n, "preview", PREVIEW_WIDTH, 82, 2)


THUMB_WIDTH = 160  # the list shows a cover about 40 px wide; 160 stays sharp on 3x screens


def thumb_jpeg(post: dict, n: int = 1) -> Optional[Path]:
    """A tiny JPEG (about 160 px wide, a few KB) of a slide for the Posts list.
    Made once: when a post finishes, or on first request for older posts."""
    return _jpeg_copy(post, n, "thumb", THUMB_WIDTH, 72, 2)


def prepare_copies(post: dict) -> None:
    """Make every preview and share JPEG ahead of time, so the first visit to
    the post page doesn't wait for the Pi to encode 2 x 12 images."""
    for n in range(1, len(post.get("slides") or []) + 1):
        try:
            if n == 1:
                thumb_jpeg(post, 1)  # first, so the list can show the cover soonest
            preview_jpeg(post, n)
            share_jpeg(post, n)
        except OSError as e:
            logstore.warn("posts", f"Couldn't make the JPEG copies of slide {n} of post {post['id']}: {e}")


@router.get("/api/posts/{post_id}/thumb.jpg")
def posts_thumb(post_id: str, request: Request):
    post = get_shared(post_id)
    path = thumb_jpeg(post, 1) if post else None
    if not path:
        return _missing()
    return _serve_file(post, path, "thumb", 1, "image/jpeg", request)


@router.get("/api/posts/{post_id}/preview/{n}.jpg")
def posts_slide_preview(post_id: str, n: int, request: Request):
    post = get_shared(post_id)
    path = preview_jpeg(post, n) if post else None
    if not path:
        return _missing()
    return _serve_file(post, path, "preview", n, "image/jpeg", request)


@router.get("/api/posts/{post_id}/slides/{n}.jpg")
def posts_slide_jpeg(post_id: str, n: int, request: Request):
    post = get_shared(post_id)
    path = share_jpeg(post, n) if post else None
    if not path:
        return _missing()
    return _serve_file(post, path, "share", n, "image/jpeg", request)


@router.get("/api/posts/{post_id}/zip")
def posts_zip(post_id: str):
    post = get(post_id)
    if not post or not post["slides"]:
        return _missing()
    name = re.sub(r"[^A-Za-z0-9]+", "-", post["title"]).strip("-")[:40] or "post"
    return Response(zip_bytes(post), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{name}.zip"'})


@router.get("/api/posts/{post_id}/qr.svg")
def posts_qr(post_id: str):
    post = get(post_id)
    link = post_link(post) if post else ""
    if not post or not link:
        return _missing()
    try:
        return Response(qr_svg(link), media_type="image/svg+xml")
    except ImportError:
        return _missing()
