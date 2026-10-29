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

The clipboard: paste text or a snippet and it gets the same kind of link,
shown as a plain page with a Copy button (and /raw for the bare text). Clips
are always temporary, a week at most, and can't be made permanent.

A clip can also carry images, as many as fit in CLIP_IMAGES_MB (100 MB) per
clip. The app makes the clip first, then sends each image as its own request
(POST /api/drops/<slug>/images), which is written to disk as it arrives, so
the Pi never holds an image in memory and a big set never becomes one giant
upload. The app also sends a small JPEG thumbnail of each image it can decode,
so the clip's page shows a light grid without the Pi resizing anything. The
page links each image and offers them all as one .zip, which is streamed file
by file rather than built first. Images live in the clip's folder, so they
count in the storage panel and go when the clip expires or is deleted.

A site link can be made permanent (it never expires until it's deleted or
made temporary again), and any link, site or clip, can be turned off at once
and back on: a turned-off link shows "This link is turned off" (403) while
its files stay put.

Drops live in a Pi-only table, like Radar's headlines: they don't sync and
aren't in the Sheets backup. Expired drops are deleted by run() every few
minutes, and refused (410) straight away if one is asked for before that.
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
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
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
# Clips are temporary only.
CLIP_MAX_HOURS = 7 * 24
MAX_CLIP_BYTES = 1024 * 1024
CLIP_FILE = "clip.txt"
# Images on a clip: the total per clip, how many, and the thumbnails the app sends.
CLIP_IMAGES_MB = int(os.getenv("SAGE_CLIP_IMAGES_MB", "100"))
CLIP_IMAGES_BYTES = CLIP_IMAGES_MB * 1024 * 1024
MAX_CLIP_IMAGES = 500
MAX_THUMB_BYTES = 512 * 1024
IMAGE_DIR = "images"
THUMB_DIR = "thumbs"
IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".heic", ".heif", ".bmp", ".svg", ".tif", ".tiff"}
# Uploads stop before they'd leave the Pi's card with less than this free.
KEEP_FREE_BYTES = 512 * 1024 * 1024
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
    ".heic": "image/heic", ".heif": "image/heif",
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
# One image upload at a time: keeps the quota check honest and the SD card calm.
_image_lock = asyncio.Lock()
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
    # Columns added after the first version of the table.
    have = {r[1] for r in conn.execute("PRAGMA table_info(drops)")}
    for column, kind in (("kind", "TEXT DEFAULT 'site'"), ("permanent", "INTEGER DEFAULT 0"), ("disabled", "INTEGER DEFAULT 0")):
        if column not in have:
            conn.execute(f"ALTER TABLE drops ADD COLUMN {column} {kind}")
    conn.commit()
    conn.close()


# A permanent drop never expires, whatever its expires_at says.
EXPIRED = "COALESCE(permanent, 0) = 0 AND expires_at <= ?"


def _expired(row, now: Optional[float] = None) -> bool:
    return not row["permanent"] and row["expires_at"] <= (time.time() if now is None else now)


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
        "kind": row["kind"] or "site",
        "permanent": bool(row["permanent"]),
        "disabled": bool(row["disabled"]),
        **(_clip_extras(row["id"]) if row["kind"] == "clip" else {}),
    }


def _clip_extras(slug: str) -> dict:
    images = _clip_images(DROP_DIR / slug)
    return {"preview": _clip_preview(slug), "images": len(images), "imageBytes": sum(size for _, size in images)}


def _clip_images(root: Path) -> List[Tuple[Path, int]]:
    """A clip's images, in the order they were added, with their sizes."""
    folder = root / IMAGE_DIR
    if not folder.is_dir():
        return []
    found = []
    for p in folder.iterdir():
        if p.is_file() and not p.name.startswith("."):
            st = p.stat()
            found.append((st.st_mtime_ns, p.name, p, st.st_size))
    return [(p, size) for _, _, p, size in sorted(found)]


def _clip_preview(slug: str) -> str:
    try:
        with open(DROP_DIR / slug / CLIP_FILE, encoding="utf-8", errors="replace") as f:
            return f.read(240)
    except OSError:
        return ""


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
    conn = _db()
    try:
        row = conn.execute("SELECT kind FROM drops WHERE id = ?", (slug,)).fetchone()
        top = CLIP_MAX_HOURS if row and row["kind"] == "clip" else MAX_HOURS
        hours = min(max(float(hours), 0.25), top)
        conn.execute(f"UPDATE drops SET expires_at = ? WHERE id = ? AND NOT ({EXPIRED})", (time.time() + hours * 3600, slug, time.time()))
        conn.commit()
        row = conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()
        return _shape(row) if row else None
    finally:
        conn.close()


def replace_page(slug: str, page: bytes, name: str = "") -> dict:
    """Swaps a site drop's files for one new page (index.html), keeping its
    link, expiry and on/off state, so a revised report reuses the same URL."""
    if not _safe_slug(slug):
        raise DropError("No drop has that id.")
    if len(page) > MAX_BYTES:
        raise DropError(f"That's more than {MAX_MB} MB.")
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()
        if not row or _expired(row):
            raise DropError("No live drop has that id.")
        if row["kind"] == "clip":
            raise DropError("That's a clipboard link, not a page.")
        root = DROP_DIR / slug
        fresh = DROP_DIR / f".{slug}.new"
        shutil.rmtree(fresh, ignore_errors=True)
        fresh.mkdir(parents=True)
        (fresh / "index.html").write_bytes(page)
        shutil.rmtree(root, ignore_errors=True)
        fresh.rename(root)
        _files_cache.pop(slug, None)
        conn.execute("UPDATE drops SET name = ?, entry = 'index.html', files = 1, bytes = ? WHERE id = ?",
                     ((name or "").strip()[:120] or row["name"], len(page), slug))
        conn.commit()
        return _shape(conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone())
    finally:
        conn.close()


def set_permanent(slug: str, on: bool) -> dict:
    """Makes a site link permanent, or temporary again (a day from now)."""
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()
        if not row or _expired(row):
            raise DropError("That drop has expired.")
        if on and row["kind"] == "clip":
            raise DropError("Clipboard links are always temporary.")
        if on:
            conn.execute("UPDATE drops SET permanent = 1 WHERE id = ?", (slug,))
        else:
            conn.execute("UPDATE drops SET permanent = 0, expires_at = ? WHERE id = ?", (time.time() + DEFAULT_HOURS * 3600, slug))
        conn.commit()
        return _shape(conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone())
    finally:
        conn.close()


def set_enabled(slug: str, on: bool) -> dict:
    """Turns a link off at once (visitors see "turned off"), or back on."""
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()
        if not row or _expired(row):
            raise DropError("That drop has expired.")
        conn.execute("UPDATE drops SET disabled = ? WHERE id = ?", (0 if on else 1, slug))
        conn.commit()
        return _shape(conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone())
    finally:
        conn.close()


def create_clip(text: str, name: str = "", hours: float = DEFAULT_HOURS, images: int = 0) -> dict:
    """Shares a piece of text (a note, a snippet, a list) as a temporary link.
    With images (how many the app is about to send), the text may be empty."""
    text = str(text or "")
    images = max(0, int(images or 0))
    if not text.strip() and not images:
        raise DropError("Paste some text or add images to share.")
    if images > MAX_CLIP_IMAGES:
        raise DropError(f"A clip can have up to {MAX_CLIP_IMAGES} images.")
    data = text.encode("utf-8")
    if len(data) > MAX_CLIP_BYTES:
        raise DropError(f"That's more than {MAX_CLIP_BYTES // 1024} KB of text.")
    hours = min(max(float(hours or DEFAULT_HOURS), 0.25), CLIP_MAX_HOURS)
    sweep()
    conn = _db()
    try:
        if conn.execute("SELECT COUNT(*) FROM drops").fetchone()[0] >= MAX_ACTIVE:
            raise DropError(f"You have {MAX_ACTIVE} live drops. Delete some first.")
        slug = secrets.token_urlsafe(16)
        root = DROP_DIR / slug
        root.mkdir(parents=True)
        if text.strip():
            (root / CLIP_FILE).write_bytes(data)
        first = next((line.strip() for line in text.splitlines() if line.strip()), "")
        title = (name or "").strip()[:120] or (first[:60] + ("…" if len(first) > 60 else "")) \
            or f"{images} image{'' if images == 1 else 's'}"
        now = time.time()
        conn.execute(
            "INSERT INTO drops (id, name, created_at, expires_at, entry, files, bytes, views, source, kind) "
            "VALUES (?,?,?,?,?,?,?,0,'clipboard','clip')",
            (slug, title, now, now + hours * 3600, CLIP_FILE, int(bool(text.strip())), len(data) if text.strip() else 0),
        )
        conn.commit()
        return _shape(conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone())
    finally:
        conn.close()


def image_name(raw: str) -> Optional[str]:
    """The file name an image is kept under, or None for one that isn't an image."""
    base = str(raw or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    base = re.sub(r"[^\w.\- ()+]", "_", base)[-120:].lstrip(". ")
    if not base or Path(base).suffix.lower() not in IMAGE_TYPES or clean_path(base) != base:
        return None
    return base


def _clip_for_images(slug: str):
    if not _safe_slug(slug):
        raise DropError("There's no clip at that link.")
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()
    finally:
        conn.close()
    if not row or row["kind"] != "clip":
        raise DropError("There's no clip at that link.")
    if _expired(row):
        raise DropError("That clip has expired.")
    return row


class ImageTooBig(DropError):
    pass


async def add_image(slug: str, raw_name: str, length: int, chunks, thumb_for: str = "") -> dict:
    """Writes one image (or, with thumb_for, the thumbnail of an image already
    on the clip) to disk as its chunks arrive, refusing it as soon as it goes
    past what the clip has room for. Returns the clip and the name kept."""
    async with _image_lock:
        row = await asyncio.to_thread(_clip_for_images, slug)
        root = DROP_DIR / slug
        images = await asyncio.to_thread(_clip_images, root)
        if thumb_for:
            name = image_name(thumb_for)
            if not name or not (root / IMAGE_DIR / name).is_file():
                raise DropError("That image isn't on this clip.")
            folder, final, room = root / THUMB_DIR, f"{name}.jpg", MAX_THUMB_BYTES
            too_big = "That thumbnail is too big."
        else:
            name = image_name(raw_name)
            if not name:
                raise DropError(f"{str(raw_name)[:80]!r} isn't an image Drop can share.")
            if len(images) >= MAX_CLIP_IMAGES:
                raise DropError(f"A clip can have up to {MAX_CLIP_IMAGES} images.")
            used = sum(size for _, size in images)
            room = CLIP_IMAGES_BYTES - used
            too_big = (f"That image would take this clip past {CLIP_IMAGES_MB} MB "
                       f"({used / 1048576:.1f} MB used).")
            folder = root / IMAGE_DIR
            taken = {p.name for p, _ in images}
            stem, ext, final, n = Path(name).stem, Path(name).suffix, name, 2
            while final in taken:
                final, n = f"{stem}-{n}{ext}", n + 1
        if length > room:
            raise ImageTooBig(too_big)
        free = await asyncio.to_thread(lambda: shutil.disk_usage(DROP_DIR).free)
        if free - length < KEEP_FREE_BYTES:
            raise ImageTooBig("The Pi is nearly out of space. Delete some links first.")
        folder.mkdir(parents=True, exist_ok=True)
        part = folder / f".part-{secrets.token_hex(6)}"
        written = 0
        try:
            with open(part, "wb") as f:
                async for chunk in chunks:
                    written += len(chunk)
                    if written > room or written > length:
                        raise ImageTooBig(too_big if written > room else "The upload was bigger than it said.")
                    await asyncio.to_thread(f.write, chunk)
            if not written:
                raise DropError("That image is empty.")
            os.replace(part, folder / final)
        finally:
            if part.exists():
                part.unlink()
        await asyncio.to_thread(_recount, slug)
        conn = _db()
        try:
            return {"drop": _shape(conn.execute("SELECT * FROM drops WHERE id = ?", (slug,)).fetchone()), "name": final}
        finally:
            conn.close()


def _recount(slug: str) -> None:
    """Brings a clip's files and bytes up to date with what's on disk."""
    root = DROP_DIR / slug
    images = _clip_images(root)
    conn = _db()
    try:
        conn.execute("UPDATE drops SET files = ?, bytes = ? WHERE id = ?",
                     ((root / CLIP_FILE).is_file() + len(images), _folder_bytes(root), slug))
        conn.commit()
    finally:
        conn.close()


def usage() -> dict:
    """What Drop keeps on the Pi, for Settings' storage panel."""
    conn = _db()
    try:
        rows = conn.execute("SELECT kind, COUNT(*), COALESCE(SUM(bytes), 0), COALESCE(SUM(permanent), 0) FROM drops GROUP BY kind").fetchall()
    finally:
        conn.close()
    sites = next((r for r in rows if (r[0] or "site") == "site"), None)
    clips = next((r for r in rows if r[0] == "clip"), None)
    return {
        "bytes": _folder_bytes(DROP_DIR),
        "sites": sites[1] if sites else 0,
        "clips": clips[1] if clips else 0,
        "permanent": sites[3] if sites else 0,
        "folder": str(DROP_DIR),
    }


def _folder_bytes(folder: Path) -> int:
    total = 0
    for dirpath, _, names in os.walk(folder):
        for n in names:
            try:
                total += os.lstat(os.path.join(dirpath, n)).st_size
            except OSError:
                pass
    return total


def sweep(now: Optional[float] = None) -> int:
    """Deletes expired drops, and folders left behind without a row."""
    now = time.time() if now is None else now
    conn = _db()
    try:
        expired = [r[0] for r in conn.execute(f"SELECT id FROM drops WHERE {EXPIRED}", (now,))]
        conn.execute(f"DELETE FROM drops WHERE {EXPIRED}", (now,))
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
    if _expired(row):
        remove(slug)
        return _page("This link has expired", "Ask whoever shared it for a new one.", 410)
    if row["disabled"]:
        return _page("This link is turned off", "Whoever shared it has switched it off for now.", 403)
    root = (DROP_DIR / slug).resolve()
    if row["kind"] == "clip":
        return _serve_clip(row, root, path, request)
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
        _count_view(slug)
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


def _count_view(slug: str) -> None:
    conn = _db()
    try:
        conn.execute("UPDATE drops SET views = COALESCE(views, 0) + 1, last_view = ? WHERE id = ?", (time.time(), slug))
        conn.commit()
    finally:
        conn.close()


def _serve_clip(row, root: Path, path: str, request: Request):
    """A clip's page (the text with a Copy button, and its images), the bare
    text at raw, an image (or its thumbnail) and every image as one .zip."""
    target = root / CLIP_FILE
    images = _clip_images(root)
    path = path.strip("/")
    if path in ("raw", CLIP_FILE):
        if not target.is_file():
            return _page("Not found", "This clip has no text.", 404)
        return FileResponse(target, media_type="text/plain; charset=utf-8", headers=SERVE_HEADERS)
    if path == "images.zip":
        if not images:
            return _page("Not found", "This clip has no images.", 404)
        return StreamingResponse(_zip_stream(images), media_type="application/zip",
                                 headers={**SERVE_HEADERS, "Content-Disposition": _attachment(f"{row['name'] or 'images'}.zip")})
    folder, _, name = path.partition("/")
    if folder in (IMAGE_DIR, THUMB_DIR) and name and "/" not in name:
        file = root / folder / name
        if name.startswith(".") or not file.is_file() or file.resolve().parent != (root / folder).resolve():
            return _page("Not found", "That isn't part of this clip.", 404)
        headers = dict(SERVE_HEADERS)
        if folder == IMAGE_DIR and request.query_params.get("download"):
            headers["Content-Disposition"] = _attachment(name)
        return FileResponse(file, media_type=_media_type(file), headers=headers)
    if path:
        return _page("Not found", "That isn't part of this clip.", 404)
    if not target.is_file() and not images:
        return _page("Not found", "There's nothing at this link.", 404)
    if request.headers.get("sec-fetch-dest", "document") == "document":
        _count_view(row["id"])
    text = target.read_text(encoding="utf-8", errors="replace") if target.is_file() else ""
    name = html.escape(row["name"] or "Shared text")
    buttons = ""
    if len(images) > 1:
        total = sum(size for _, size in images)
        buttons += f"<a class=btn href='images.zip' title='{_size(total)} as a .zip'>Download all ({len(images)})</a>"
    if text:
        buttons += f"<a class=btn href='raw' download='{name}.txt'>Download text</a><button id=copy>Copy</button>"
    thumbs = {p.name[:-4] for p in (root / THUMB_DIR).iterdir()} if (root / THUMB_DIR).is_dir() else set()
    tiles = "".join(_image_tile(p.name, size, p.name in thumbs) for p, size in images)
    body = (
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{name}</title>"
        "<style>:root{color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--ink:#1c1c1e;--muted:#6b7280;--line:rgba(0,0,0,.08)}"
        "@media (prefers-color-scheme:dark){:root{--bg:#111113;--card:#1c1c1e;--ink:#f2f2f7;--muted:#9ca3af;--line:rgba(255,255,255,.1)}}"
        "body{margin:0;background:var(--bg);color:var(--ink);font:15px system-ui,sans-serif}"
        "main{max-width:980px;margin:0 auto;padding:28px 16px}"
        "header{display:flex;align-items:center;gap:8px 12px;margin-bottom:12px;flex-wrap:wrap}"
        "h1{font-size:19px;margin:0;flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
        "button,a.btn{font:600 14px system-ui,sans-serif;border:0;border-radius:12px;padding:9px 16px;cursor:pointer;text-decoration:none}"
        "button{background:#2563eb;color:#fff}a.btn{background:var(--line);color:var(--ink)}"
        "pre{margin:0 0 16px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;"
        "white-space:pre-wrap;word-break:break-word;font:13.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}"
        ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}"
        "figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column}"
        "figure>a.pic{display:block;aspect-ratio:1;background:var(--line);position:relative}"
        "figure img{width:100%;height:100%;object-fit:cover;display:block}"
        "figure .none{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:12px;padding:8px;text-align:center}"
        "figcaption{display:flex;align-items:center;gap:6px;padding:8px 8px 8px 10px;font-size:12px}"
        "figcaption span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
        "figcaption small{color:var(--muted);display:block}"
        "figcaption a{flex:none;font-weight:600;font-size:12px;color:#2563eb;text-decoration:none;padding:6px 8px;border-radius:9px;background:rgba(37,99,235,.1)}"
        "p.foot{color:var(--muted);font-size:12.5px;margin:14px 4px 0}</style>"
        f"<main><header><h1>{name}</h1>{buttons}</header>"
        + (f"<pre id=text>{html.escape(text)}</pre>" if text else "")
        + (f"<div class=grid>{tiles}</div>" if tiles else "")
        + "<p class=foot>Shared from Sage Drop. This link is temporary and switches itself off.</p></main>"
        "<script>var c=document.getElementById('copy');if(c)c.onclick=async function(){var b=this,t=document.getElementById('text');"
        "try{await navigator.clipboard.writeText(t.textContent)}catch(e){var r=document.createRange();r.selectNodeContents(t);"
        "var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy')}catch(_){}}"
        "b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)};"
        # An image the browser can't show (a HEIC on Chrome, say) becomes its name, still downloadable.
        "document.querySelectorAll('figure img').forEach(function(i){i.onerror=function(){var d=document.createElement('span');"
        "d.className='none';d.textContent='No preview';i.replaceWith(d)}})</script>"
    )
    return HTMLResponse(body, headers=SERVE_HEADERS)


def _image_tile(name: str, size: int, has_thumb: bool) -> str:
    url = f"{IMAGE_DIR}/{quote(name)}"
    src = f"{THUMB_DIR}/{quote(name)}.jpg" if has_thumb else url
    label = html.escape(name)
    return (f"<figure><a class=pic href='{url}' target=_blank rel=noopener><img src='{src}' alt='{label}' loading=lazy decoding=async></a>"
            f"<figcaption><span title='{label}'>{label}<small>{_size(size)}</small></span>"
            f"<a href='{url}?download=1' download='{label}'>Download</a></figcaption></figure>")


def _size(n: int) -> str:
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{max(1, round(n / 1024))} KB"


def _attachment(filename: str) -> str:
    ascii_name = re.sub(r'[^\w.\- ]', "_", filename).encode("ascii", "replace").decode().replace("?", "_") or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


class _ZipSink:
    """A write-only file for zipfile that hands back what was written so far."""

    def __init__(self):
        self.buf = bytearray()
        self.pos = 0

    def write(self, b) -> int:
        self.buf += b
        self.pos += len(b)
        return len(b)

    def tell(self) -> int:
        return self.pos

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        out, self.buf = bytes(self.buf), bytearray()
        return out


def _zip_stream(images: List[Tuple[Path, int]]):
    """Every image as one .zip, written as it's sent: stored, not squeezed
    (photos are compressed already), so the Pi only ever holds one chunk."""
    sink = _ZipSink()
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED) as archive:
        for path, size in images:
            info = zipfile.ZipInfo(path.name, date_time=time.localtime(path.stat().st_mtime)[:6])
            info.file_size = size
            try:
                with open(path, "rb") as src, archive.open(info, "w") as dest:
                    while chunk := src.read(256 * 1024):
                        dest.write(chunk)
                        if len(sink.buf) >= 256 * 1024:
                            yield sink.take()
            except OSError:
                continue
            if sink.buf:
                yield sink.take()
    if sink.buf:
        yield sink.take()


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


class ClipRequest(BaseModel):
    text: str = ""
    name: str = ""
    hours: float = DEFAULT_HOURS
    # How many images the app will send next (POST /api/drops/<slug>/images).
    images: int = 0


class ToggleRequest(BaseModel):
    on: bool


@router.get("/api/drops")
async def drops_list():
    base = await asyncio.to_thread(base_url)
    return {"success": True, "drops": list_drops(), "base": base.get("url"), "baseKind": base.get("kind"),
            "maxMb": MAX_MB, "maxHours": MAX_HOURS, "clipMaxHours": CLIP_MAX_HOURS, "clipMaxKb": MAX_CLIP_BYTES // 1024,
            "clipImagesMb": CLIP_IMAGES_MB, "clipMaxImages": MAX_CLIP_IMAGES}


@router.post("/api/drops/clip")
async def drops_clip(req: ClipRequest):
    try:
        clip = await asyncio.to_thread(create_clip, req.text, req.name, req.hours, req.images)
    except DropError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=400)
    base = await asyncio.to_thread(base_url)
    return {"success": True, "drop": clip, "base": base.get("url")}


@router.post("/api/drops/{slug}/images")
async def drops_clip_image(slug: str, request: Request, name: str = "", thumb: str = ""):
    """The raw bytes of one image for a clip (?name=photo.jpg), or of the
    thumbnail of one it already has (?thumb=photo.jpg). Streamed to disk."""
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        return JSONResponse({"success": False, "error": "Upload size unknown."}, status_code=411)
    try:
        made = await add_image(slug, name, int(length), request.stream(), thumb_for=thumb)
    except ImageTooBig as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=413)
    except DropError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=400)
    return {"success": True, **made}


@router.post("/api/drops/{slug}/permanent")
def drops_permanent(slug: str, req: ToggleRequest):
    try:
        return {"success": True, "drop": set_permanent(slug, req.on)}
    except DropError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=400)


@router.post("/api/drops/{slug}/enabled")
def drops_enabled(slug: str, req: ToggleRequest):
    try:
        return {"success": True, "drop": set_enabled(slug, req.on)}
    except DropError as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=400)


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
    if not drop or (not drop["permanent"] and drop["expiresAt"] <= time.time()):
        return JSONResponse({"success": False, "error": "That drop has expired."}, status_code=404)
    return {"success": True, "drop": drop}


@router.delete("/api/drops/{slug}")
def drops_delete(slug: str):
    if not remove(slug):
        return JSONResponse({"success": False, "error": "That drop is already gone."}, status_code=404)
    return {"success": True}
