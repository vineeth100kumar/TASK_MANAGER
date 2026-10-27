"""
Drop: temporary public links for HTML reports and small static sites,
like Netlify Drop.

Drop an .html file, a folder or a .zip on the Drop page and the Pi keeps a
copy under DROP_DIR/<slug>/ and serves it at /d/<slug>/ until it expires
(1 hour to 30 days, a day by default). The slug is random and long, so a link
can't be guessed; anyone who has it can open the drop without Sage's password.
Everything else keeps needing the password and the key.

Sites built to live at a domain's root (Vite, Create React App and most
frameworks write "/assets/app.js" and "/images/x.webp") would look for those
files on Sage instead of in the drop. When a page, stylesheet or script is
served, a root-absolute reference that names a file in the same drop is
pointed at the drop ("/images/x.webp" becomes "/d/<slug>/images/x.webp"). Only
paths that really exist in the drop are touched, so nothing else changes.

Safety:
  - Files are only ever read and sent back. Nothing in a drop runs on the Pi,
    whatever its extension.
  - Every drop response carries a CSP sandbox without allow-same-origin, so a
    dropped page runs in an opaque origin: its scripts can't read Sage's
    cookies, storage or /api, even when you open your own link.
  - Paths are cleaned before they touch the disk ("..", absolute paths, drive
    letters and links inside zips are refused), and every served file must
    resolve inside its own drop folder.
  - MAX_MB per drop (zips are counted by what they unpack to), MAX_FILES files
    and MAX_ACTIVE live drops.

Drops live in a Pi-only table, like Radar's headlines: they are temporary, so
they don't sync and aren't in the Sheets backup. Expired drops are deleted by
run() every few minutes, and refused (410) straight away if one is asked for
before that.
"""

import asyncio
import html
import io
import re
import mimetypes
import os
import secrets
import shutil
import sqlite3
import stat
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel

import public_link

DB_PATH = "sage_sync.db"
DROP_DIR = Path(os.getenv("SAGE_DROP_DIR", "") or "drops")
MAX_MB = int(os.getenv("SAGE_DROP_MAX_MB", "50"))
MAX_BYTES = MAX_MB * 1024 * 1024
MAX_FILES = 1000
MAX_ACTIVE = 50
MAX_HOURS = 30 * 24
DEFAULT_HOURS = 24
SWEEP_SECONDS = 300
# Set by hand when the links should use another address than Settings'
# public link (say a second tunnel just for drops).
BASE_URL = os.getenv("SAGE_DROP_BASE_URL", "").strip().rstrip("/")
PREFIX = "/d/"

# Opaque origin: the page may run its own scripts, forms and pop-ups, but it is
# never same-origin with Sage.
SANDBOX_CSP = ("sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox "
               "allow-modals allow-downloads allow-pointer-lock allow-presentation")
SERVE_HEADERS = {
    "Content-Security-Policy": SANDBOX_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    # Revoking must work at once, so nothing (Cloudflare included) keeps a copy.
    "Cache-Control": "no-store",
    # The page's origin is opaque, so its module scripts and fonts come back
    # through CORS. It's all public anyway.
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
}
# Files a Mac or Windows adds to folders and zips; never part of the site.
JUNK = {".DS_Store", "Thumbs.db", "desktop.ini"}
EXTRA_TYPES = {
    ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
    ".json": "application/json", ".webp": "image/webp", ".avif": "image/avif", ".wasm": "application/wasm",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon", ".md": "text/plain",
    ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".webm": "video/webm",
}

# Files whose root-absolute references are pointed at the drop, and the biggest
# one read into memory to do it.
REWRITE_TYPES = {".html", ".htm", ".css", ".js", ".mjs"}
MAX_REWRITE_BYTES = 8 * 1024 * 1024
# A quote or "(" then "/path" (not "//host"), as in src="/a.js", '/img/x.png', url(/f.woff2).
ROOT_REF = re.compile(r"""(?P<q>["'`(])/(?P<p>[^\s"'`()<>?#\\/][^\s"'`()<>?#\\]*)""")
# A page that loads TypeScript or JSX straight from the project's source: not built.
SOURCE_SCRIPT = re.compile(r"""<script[^>]+src=["'][^"']+\.(?:tsx|ts|jsx)["']""", re.I)

router = APIRouter()
_files_cache: Dict[str, Set[str]] = {}
_base_cache: Tuple[float, dict] = (0.0, {})


class DropError(Exception):
    pass


def connect(db_path: str) -> None:
    global DB_PATH, DROP_DIR
    DB_PATH = db_path
    if not os.getenv("SAGE_DROP_DIR"):
        DROP_DIR = Path(db_path).resolve().parent / "drops"
    DROP_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS drops (
            id TEXT PRIMARY KEY,
            name TEXT,
            created_at REAL,
            expires_at REAL,
            entry TEXT,
            files INTEGER,
            bytes INTEGER,
            views INTEGER DEFAULT 0,
            last_view REAL,
            source TEXT
        );
        """
    )
    conn.commit()
    conn.close()


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# --- Paths ---

def clean_path(raw: str) -> Optional[str]:
    """A relative path that stays inside the drop, or None. Backslashes count
    as separators (Windows zips), and "..", drive letters, empty names and
    control characters are refused rather than repaired."""
    parts = []
    for part in str(raw).replace("\\", "/").split("/"):
        if part in ("", "."):
            continue
        if part == ".." or ":" in part or any(ord(c) < 32 for c in part) or len(part) > 200:
            return None
        parts.append(part)
    if not parts or len(parts) > 20:
        return None
    return "/".join(parts)


def _strip_common_folder(paths: List[str]) -> Tuple[List[str], str]:
    """A dropped folder or most zips put everything under one top folder
    (site/index.html); serve its contents at the root instead. Also returns
    the outermost folder's name."""
    folder = ""
    while paths and all("/" in p for p in paths):
        top = {p.split("/", 1)[0] for p in paths}
        if len(top) != 1:
            break
        folder = folder or top.pop()
        paths = [p.split("/", 1)[1] for p in paths]
    return paths, folder


def _is_junk(path: str) -> bool:
    parts = path.split("/")
    return parts[0] == "__MACOSX" or parts[-1] in JUNK or parts[-1].startswith("._")


def _find_entry(paths: List[str]) -> str:
    """index.html at the top, else the shallowest HTML page, else "" (a list of files)."""
    pages = [p for p in paths if p.lower().endswith((".html", ".htm"))]
    for p in pages:
        if p.lower() in ("index.html", "index.htm"):
            return p
    return min(pages, key=lambda p: (p.count("/"), p.lower()), default="")


# --- Making a drop ---

def _unzip(blob: bytes) -> List[Tuple[str, bytes]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise DropError("That .zip file can't be opened.")
    out, total = [], 0
    for info in archive.infolist():
        if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
            continue
        if info.flag_bits & 0x1:
            raise DropError("That .zip is password protected.")
        # The sizes in a zip can lie, so count what actually comes out.
        data = bytearray()
        with archive.open(info) as f:
            while chunk := f.read(65536):
                data += chunk
                if total + len(data) > MAX_BYTES:
                    raise DropError(f"That unpacks to more than {MAX_MB} MB.")
        total += len(data)
        out.append((info.filename, bytes(data)))
        if len(out) > MAX_FILES:
            raise DropError(f"That has more than {MAX_FILES} files.")
    return out


def prepare(files: List[Tuple[str, bytes]]) -> Tuple[List[Tuple[str, bytes]], str]:
    """Turns what was dropped (paths and contents) into the files to keep: a
    lone .zip is unpacked, junk is dropped, paths are cleaned and the common
    top folder goes. Also returns a name for it (the zip's or the folder's)."""
    label = ""
    if len(files) == 1 and files[0][0].lower().endswith(".zip"):
        label = files[0][0].replace("\\", "/").rsplit("/", 1)[-1][:-4]
        files = _unzip(files[0][1])
    kept: Dict[str, bytes] = {}
    for raw, data in files:
        path = clean_path(raw)
        if path is None:
            raise DropError(f"Can't use the file path {raw[:80]!r}.")
        if not _is_junk(path):
            kept[path] = data
    if not kept:
        raise DropError("There's nothing to share in that.")
    if len(kept) > MAX_FILES:
        raise DropError(f"That has more than {MAX_FILES} files.")
    if sum(len(d) for d in kept.values()) > MAX_BYTES:
        raise DropError(f"That's more than {MAX_MB} MB.")
    paths, folder = _strip_common_folder(list(kept))
    return list(zip(paths, kept.values())), label or folder


def create(files: List[Tuple[str, bytes]], name: str = "", hours: float = DEFAULT_HOURS, source: str = "") -> dict:
    files, label = prepare(files)
    hours = min(max(float(hours or DEFAULT_HOURS), 0.25), MAX_HOURS)
    sweep()
    conn = _db()
    try:
        active = conn.execute("SELECT COUNT(*) FROM drops").fetchone()[0]
        if active >= MAX_ACTIVE:
            raise DropError(f"You have {MAX_ACTIVE} live drops. Delete some first.")
        slug = secrets.token_urlsafe(16)
        root = DROP_DIR / slug
        root.mkdir(parents=True)
        try:
            for path, data in files:
                target = (root / path).resolve()
                if root.resolve() not in target.parents:
                    raise DropError(f"Can't use the file path {path!r}.")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        except Exception:
            shutil.rmtree(root, ignore_errors=True)
            raise
        paths = [p for p, _ in files]
        entry = _find_entry(paths)
        title = (name or "").strip()[:120] or label or _default_name(paths, entry)
        now = time.time()
        conn.execute(
            "INSERT INTO drops (id, name, created_at, expires_at, entry, files, bytes, views, source) VALUES (?,?,?,?,?,?,?,0,?)",
            (slug, title, now, now + hours * 3600, entry, len(files), sum(len(d) for _, d in files), source[:40]),
        )
        conn.commit()
        made = _shape(conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone())
        made["warnings"] = _warnings(files, entry)
        return made
    finally:
        conn.close()


def _warnings(files: List[Tuple[str, bytes]], entry: str) -> List[str]:
    """Things that make a shared site look blank, said while the person is still looking."""
    out = []
    page = next((data for path, data in files if path == entry), b"")
    if entry and SOURCE_SCRIPT.search(page.decode("utf-8", "ignore")):
        out.append("This looks like a project's source, not a built site: its page loads a .tsx/.ts file, "
                   "which browsers can't run, so the link will be blank. Run `npm run build` and drop the "
                   "`dist` folder instead.")
    return out


def _default_name(paths: List[str], entry: str) -> str:
    if len(paths) == 1:
        return paths[0].rsplit("/", 1)[-1]
    return entry.rsplit("/", 1)[-1] if entry and entry.lower() not in ("index.html", "index.htm") else f"{len(paths)} files"


def _shape(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "path": f"{PREFIX}{row['id']}/",
        "createdAt": row["created_at"],
        "expiresAt": row["expires_at"],
        "entry": row["entry"],
        "files": row["files"],
        "bytes": row["bytes"],
        "views": row["views"] or 0,
        "lastView": row["last_view"],
        "source": row["source"] or "",
    }


def list_drops() -> List[dict]:
    sweep()
    conn = _db()
    try:
        return [_shape(r) for r in conn.execute("SELECT * FROM drops ORDER BY created_at DESC")]
    finally:
        conn.close()


def remove(slug: str) -> bool:
    conn = _db()
    try:
        gone = conn.execute("DELETE FROM drops WHERE id = ?", (slug,)).rowcount
        conn.commit()
    finally:
        conn.close()
    _files_cache.pop(slug, None)
    if _safe_slug(slug):
        shutil.rmtree(DROP_DIR / slug, ignore_errors=True)
    return bool(gone)


def extend(slug: str, hours: float) -> Optional[dict]:
    hours = min(max(float(hours), 0.25), MAX_HOURS)
    conn = _db()
    try:
        conn.execute("UPDATE drops SET expires_at = ? WHERE id = ? AND expires_at > ?", (time.time() + hours * 3600, slug, time.time()))
        conn.commit()
        row = conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()
        return _shape(row) if row else None
    finally:
        conn.close()


def sweep(now: Optional[float] = None) -> int:
    """Deletes expired drops, and folders left behind without a row."""
    now = time.time() if now is None else now
    conn = _db()
    try:
        expired = [r[0] for r in conn.execute("SELECT id FROM drops WHERE expires_at <= ?", (now,))]
        conn.execute("DELETE FROM drops WHERE expires_at <= ?", (now,))
        conn.commit()
        live = {r[0] for r in conn.execute("SELECT id FROM drops")}
    finally:
        conn.close()
    for slug in expired:
        _files_cache.pop(slug, None)
        if _safe_slug(slug):
            shutil.rmtree(DROP_DIR / slug, ignore_errors=True)
    if DROP_DIR.is_dir():
        for folder in DROP_DIR.iterdir():
            # A folder younger than a minute may be a drop still being written.
            if folder.is_dir() and folder.name not in live and now - folder.stat().st_mtime > 60:
                shutil.rmtree(folder, ignore_errors=True)
    return len(expired)


async def run() -> None:
    while True:
        try:
            sweep()
        except Exception as e:
            print(f"Drop cleanup failed: {e}")
        await asyncio.sleep(SWEEP_SECONDS)


def _safe_slug(slug: str) -> bool:
    return bool(slug) and len(slug) <= 64 and all(c.isalnum() or c in "-_" for c in slug)


def base_url() -> dict:
    """Where links point: SAGE_DROP_BASE_URL, else Settings' public link (a
    tunnel), else nothing and the app uses the address it was opened at."""
    global _base_cache
    if BASE_URL:
        return {"url": BASE_URL, "kind": "custom"}
    at, found = _base_cache
    if time.time() - at > 60:
        found = public_link.find()
        _base_cache = (time.time(), found)
    return found


# --- Serving ---

def _page(title: str, text: str, status: int) -> HTMLResponse:
    body = (
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(title)}</title>"
        "<body style='margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;"
        "background:#f5f5f7;color:#1c1c1e'><div style='text-align:center;padding:24px'>"
        f"<h1 style='font-size:22px;margin:0 0 8px'>{html.escape(title)}</h1>"
        f"<p style='margin:0;color:#6b7280'>{html.escape(text)}</p></div>"
    )
    return HTMLResponse(body, status_code=status, headers=SERVE_HEADERS)


def _listing(row) -> HTMLResponse:
    root = DROP_DIR / row["id"]
    files = sorted(str(p.relative_to(root)).replace(os.sep, "/") for p in root.rglob("*") if p.is_file())
    items = "".join(f"<li><a href='{html.escape(f)}'>{html.escape(f)}</a></li>" for f in files)
    body = (
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(row['name'])}</title>"
        "<body style='font:15px system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px'>"
        f"<h1 style='font-size:20px'>{html.escape(row['name'])}</h1><ul style='line-height:1.8'>{items}</ul>"
    )
    return HTMLResponse(body, headers=SERVE_HEADERS)


def _media_type(path: Path) -> str:
    ext = path.suffix.lower()
    kind = EXTRA_TYPES.get(ext) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if kind.startswith("text/") or kind in ("application/json", "image/svg+xml", "application/manifest+json"):
        kind += "; charset=utf-8"
    return kind


@router.get(PREFIX.rstrip("/") + "/{slug}", include_in_schema=False)
def open_drop_root(slug: str):
    return RedirectResponse(f"{PREFIX}{slug}/", status_code=301)


@router.get(PREFIX + "{slug}/{path:path}", include_in_schema=False)
def serve(slug: str, path: str, request: Request):
    if not _safe_slug(slug):
        return _page("Not found", "There's no drop at this link.", 404)
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()
    finally:
        conn.close()
    if not row:
        return _page("Not found", "There's no drop at this link. It may have been deleted.", 404)
    if row["expires_at"] <= time.time():
        remove(slug)
        return _page("This link has expired", "Ask whoever shared it for a new one.", 410)
    root = (DROP_DIR / slug).resolve()
    if not path:
        if not row["entry"]:
            return _listing(row)
        if "/" in row["entry"]:
            # Relative links in the page only work from its own folder.
            return RedirectResponse(f"{PREFIX}{slug}/{row['entry']}", status_code=302, headers=SERVE_HEADERS)
        path = row["entry"]
    rel = clean_path(path)
    if rel is None:
        return _page("Not found", "That file isn't in this drop.", 404)
    target = (root / rel).resolve()
    if root not in target.parents:
        return _page("Not found", "That file isn't in this drop.", 404)
    if target.is_dir():
        if not path.endswith("/"):
            return RedirectResponse(f"{PREFIX}{slug}/{rel}/", status_code=301, headers=SERVE_HEADERS)
        target = target / "index.html"
    if not target.is_file():
        return _page("Not found", "That file isn't in this drop.", 404)
    if target.suffix.lower() in (".html", ".htm") and request.headers.get("sec-fetch-dest", "document") == "document":
        conn = _db()
        try:
            conn.execute("UPDATE drops SET views = COALESCE(views, 0) + 1, last_view = ? WHERE id = ?", (time.time(), slug))
            conn.commit()
        finally:
            conn.close()
    if target.suffix.lower() in (".html", ".htm") and target.stat().st_size <= MAX_REWRITE_BYTES \
            and SOURCE_SCRIPT.search(target.read_text(encoding="utf-8", errors="ignore")):
        # It would only come up blank, so say why instead.
        return _page("This is a project's source, not a built site",
                     "Its page loads a .tsx or .ts file, which browsers can't run. Ask whoever shared it to run "
                     "\"npm run build\" and share the \"dist\" folder instead.", 200)
    if target.suffix.lower() in REWRITE_TYPES and target.stat().st_size <= MAX_REWRITE_BYTES:
        fixed = _point_at_drop(slug, root, target)
        if fixed is not None:
            return Response(fixed, media_type=_media_type(target), headers=SERVE_HEADERS)
    return FileResponse(target, media_type=_media_type(target), headers=SERVE_HEADERS)


def _drop_files(slug: str, root: Path) -> Set[str]:
    """Every file of the drop, and every folder as "folder/", for matching references."""
    found = _files_cache.get(slug)
    if found is None:
        found = set()
        for p in root.rglob("*"):
            if p.is_file():
                rel = str(p.relative_to(root)).replace(os.sep, "/")
                found.add(rel)
                parts = rel.split("/")[:-1]
                found.update("/".join(parts[:i + 1]) + "/" for i in range(len(parts)))
        _files_cache[slug] = found
    return found


def _names_drop_file(ref: str, files: Set[str]) -> bool:
    """True for "images/a.webp" (a file here), "images/" (a folder here) and
    "images/${name}.webp" or "images/" + name (code building a name inside a
    folder here); the folder is what has to exist."""
    if ref in files:
        return True
    cut = ref.split("${")[0]
    return "/" in cut and cut.rsplit("/", 1)[0] + "/" in files if "${" in ref else False


def _point_at_drop(slug: str, root: Path, target: Path) -> Optional[bytes]:
    """The file with its root-absolute references to files in this drop made
    relative to the drop, or None when there is nothing to change."""
    try:
        text = target.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None
    files = _drop_files(slug, root)
    changed = False

    def fix(m):
        nonlocal changed
        if _names_drop_file(m.group("p"), files):
            changed = True
            return f"{m.group('q')}{PREFIX}{slug}/{m.group('p')}"
        return m.group(0)

    out = ROOT_REF.sub(fix, text)
    if target.suffix.lower() in (".html", ".htm") and 'href="/"' in out:
        # A "home" link goes to the site's own front page, not to Sage.
        out = out.replace('href="/"', f'href="{PREFIX}{slug}/"')
        changed = True
    return out.encode("utf-8") if changed else None


# --- The app's routes (behind the key and the password like any /api route) ---

class ExtendRequest(BaseModel):
    hours: float = DEFAULT_HOURS


@router.get("/api/drops")
async def drops_list():
    base = await asyncio.to_thread(base_url)
    return {"success": True, "drops": list_drops(), "base": base.get("url"), "baseKind": base.get("kind"),
            "maxMb": MAX_MB, "maxHours": MAX_HOURS}


@router.post("/api/drops")
async def drops_create(request: Request):
    """Multipart: one or more `files`, an optional `paths` per file (the
    folder-relative path), `name` and `hours`."""
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        return JSONResponse({"success": False, "error": "Upload size unknown."}, status_code=411)
    if int(length) > MAX_BYTES + 2 * 1024 * 1024:
        return JSONResponse({"success": False, "error": f"That's more than {MAX_MB} MB."}, status_code=413)
    try:
        form = await request.form(max_files=MAX_FILES + 1, max_fields=MAX_FILES + 10)
    except Exception:
        return JSONResponse({"success": False, "error": "Couldn't read the upload."}, status_code=400)
    uploads = [f for f in form.getlist("files") if hasattr(f, "read")]
    paths = [str(p) for p in form.getlist("paths")]
    if not uploads:
        return JSONResponse({"success": False, "error": "Drop a file, a folder or a .zip."}, status_code=400)
    files = []
    for i, up in enumerate(uploads):
        name = paths[i] if i < len(paths) and paths[i] else (up.filename or f"file-{i}")
        files.append((name, await up.read()))
        await up.close()
    try:
        hours = float(form.get("hours") or DEFAULT_HOURS)
    except ValueError:
        hours = DEFAULT_HOURS
    try:
        drop = await asyncio.to_thread(create, files, str(form.get("name") or ""), hours, str(form.get("source") or "upload"))
    except DropError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=400)
    base = await asyncio.to_thread(base_url)
    return {"success": True, "drop": drop, "base": base.get("url"), "warnings": drop.pop("warnings", [])}


@router.post("/api/drops/{slug}/extend")
def drops_extend(slug: str, req: ExtendRequest):
    drop = extend(slug, req.hours)
    if not drop or drop["expiresAt"] <= time.time():
        return JSONResponse({"success": False, "error": "That drop has expired."}, status_code=404)
    return {"success": True, "drop": drop}


@router.delete("/api/drops/{slug}")
def drops_delete(slug: str):
    if not remove(slug):
        return JSONResponse({"success": False, "error": "That drop is already gone."}, status_code=404)
    return {"success": True}
