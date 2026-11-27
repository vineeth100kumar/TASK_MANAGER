"""Free stock VIDEO (b-roll) for reel scenes: search, pick, download, remember, credit.

Mirrors spec/stock.py, for moving pictures. Sources (official search APIs only, no scraping):
  Pexels Videos   the same free key as photos (PEXELS_API_KEY)
  Pixabay Videos  the same free key as photos (PIXABAY_API_KEY)

A clip is saved into images/videos/; its credit is kept in _vcredits.json and the clip chosen for a
search phrase in _vpicks.json, so a rebuilt reel reuses the same footage. The smallest adequate file
is taken (about 1080 px tall, never 4k) because the Pi decodes it and composites over it.
People and logo/brand footage are hidden unless the phrase asks for them (a keyword heuristic).
"""

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .. import settings
from ..spec import stock
from ..spec.stock import StockError, clean_query, keywords_from, key_for, risky_reason, _PEOPLE

MAX_VIDEO_DOWNLOAD = 60 * 1024 * 1024
MAX_RESULTS = 12
WANT_HEIGHT = 1080         # the smallest file at least this tall is taken
MAX_SIDE = 2200            # nothing bigger on either side: no 4k (bandwidth and decode on a Pi)
PROVIDER_ORDER = ("pexels", "pixabay")
PROVIDER_NAMES = {"pexels": "Pexels", "pixabay": "Pixabay"}


# ---------- network (one place, so tests can replace it) ----------

def _fetch(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 40, max_bytes: int = MAX_VIDEO_DOWNLOAD):
    return stock._fetch(url, headers, timeout=timeout, max_bytes=max_bytes)


def _json(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    data, _ = _fetch(url, headers, timeout=20, max_bytes=5 * 1024 * 1024)
    try:
        return json.loads(data.decode("utf-8", errors="replace"))
    except ValueError:
        raise StockError("the service sent a reply that could not be read") from None


def provider_status() -> Dict[str, bool]:
    return {p: bool(key_for(p)) for p in PROVIDER_ORDER}


# ---------- candidates ----------

def pick_file(files: List[Tuple[int, int, str]]) -> Optional[Tuple[int, int, str]]:
    """The right file of a clip's renditions (width, height, url): the smallest that is at least 1080 tall,
    else the biggest there is, and never one over MAX_SIDE on a side (4k)."""
    ok = [f for f in files if f[2] and 0 < max(f[0], f[1]) <= MAX_SIDE]
    if not ok:
        return None
    tall = sorted((f for f in ok if f[1] >= WANT_HEIGHT), key=lambda f: (f[1], f[0]))
    return tall[0] if tall else max(ok, key=lambda f: (f[1], f[0]))


def _cand(provider: str, raw_id: Any, f: Tuple[int, int, str], **kw) -> Dict[str, Any]:
    c = {"id": f"{provider}:{raw_id}", "provider": provider, "provider_name": PROVIDER_NAMES[provider],
         "title": "", "author": "", "license": "", "text": "", "width": f[0], "height": f[1], "download_url": f[2],
         "page_url": "", "credit": ""}
    c.update(kw)
    return c


def _pexels(q: str, n: int) -> List[Dict[str, Any]]:
    url = "https://api.pexels.com/videos/search?" + stock.urllib.parse.urlencode(
        {"query": q, "per_page": n, "orientation": "portrait", "size": "medium"})
    data = _json(url, {"Authorization": key_for("pexels")})
    out = []
    for r in data.get("videos", []):
        files = [(int(v.get("width") or 0), int(v.get("height") or 0), v.get("link") or "")
                 for v in r.get("video_files", []) if (v.get("file_type") or "video/mp4") == "video/mp4"]
        best = pick_file(files)
        if not best:
            continue
        user = (r.get("user") or {}).get("name") or "unknown"
        # the page's own words: the URL slug carries the title ("/video/aerial-view-of-city-123/")
        slug = re.sub(r"[-_/]+", " ", re.sub(r"\d+/?$", "", str(r.get("url") or "").rstrip("/").rsplit("/", 1)[-1]))
        out.append(_cand("pexels", r.get("id"), best, page_url=r.get("url", ""), author=user,
                         credit=f"Footage by {user} on Pexels", license="Pexels License",
                         title=slug, text=slug, duration=float(r.get("duration") or 0)))
    return out


def _pixabay(q: str, n: int) -> List[Dict[str, Any]]:
    url = "https://pixabay.com/api/videos/?" + stock.urllib.parse.urlencode(
        {"key": key_for("pixabay"), "q": q, "safesearch": "true", "per_page": max(3, n)})
    data = _json(url)
    out = []
    for r in data.get("hits", []):
        files = [(int(v.get("width") or 0), int(v.get("height") or 0), v.get("url") or "")
                 for v in (r.get("videos") or {}).values() if isinstance(v, dict)]
        best = pick_file(files)
        if not best:
            continue
        user = r.get("user") or "unknown"
        out.append(_cand("pixabay", r.get("id"), best, page_url=r.get("pageURL", ""), author=user,
                         credit=f"Footage by {user} from Pixabay", license="Pixabay Content License",
                         title=r.get("tags", ""), text=r.get("tags", ""), duration=float(r.get("duration") or 0)))
    return out


_PROVIDERS = {"pexels": _pexels, "pixabay": _pixabay}


# ---------- search ----------

def _search_once(query: str, people: bool = False, per_provider: int = 8) -> Dict[str, Any]:
    """Candidates from every usable source, portrait first, people/logos hidden unless asked.
    Raises StockError when nothing can be searched at all."""
    q = clean_query(query)
    if not q:
        raise StockError("Type a few keywords for the footage, like 'city skyline night'.")
    allow_people = people or bool(_PEOPLE.search(q))
    status = provider_status()
    per: Dict[str, List[Dict[str, Any]]] = {}
    notes: List[str] = []
    errors: List[str] = []
    for p in PROVIDER_ORDER:
        if not status.get(p):
            notes.append(f"{PROVIDER_NAMES[p]}: not used (add a free key in Settings)")
            continue
        try:
            per[p] = _PROVIDERS[p](q, per_provider)
        except StockError as e:
            errors.append(f"{PROVIDER_NAMES[p]}: {e}")
    if not per:
        offline = [e for e in errors if "no internet" in e]
        if not errors:
            raise StockError("No footage source is set up: add a free Pexels or Pixabay key in Settings.")
        raise StockError("No internet connection, so footage cannot be searched." if offline and len(offline) == len(errors)
                         else "No footage source could be searched. " + " ".join(errors))
    kept: Dict[str, List[Dict[str, Any]]] = {}
    hidden = 0
    for p, items in per.items():
        kept[p] = []
        for c in items:
            c["risk"] = risky_reason(c)
            if c["risk"] and not allow_people:
                hidden += 1
                continue
            kept[p].append(c)
        kept[p].sort(key=lambda c: c["height"] < c["width"])      # stable: portrait before landscape
    merged: List[Dict[str, Any]] = []
    for i in range(max((len(v) for v in kept.values()), default=0)):
        for p in PROVIDER_ORDER:
            if i < len(kept.get(p, [])) and len(merged) < MAX_RESULTS:
                merged.append(kept[p][i])
    if hidden:
        notes.append(f"{hidden} clip{'s' if hidden != 1 else ''} that look like people or logos were hidden.")
    return {"candidates": merged, "notes": notes, "query": q}


def search(query: str, people: bool = False, per_provider: int = 8) -> Dict[str, Any]:
    """Like _search_once, but a long phrase that finds nothing is retried with fewer keywords (as for photos)."""
    res = _search_once(query, people, per_provider)
    if res["candidates"]:
        return res
    q = clean_query(query)
    tried = {q.lower()}
    words = keywords_from(q, 10).split()
    for n in (4, 3, 2):
        for start in range(len(words) - n, -1, -1):
            shorter = " ".join(words[start:start + n])
            if len(words) < n or shorter.lower() in tried:
                continue
            tried.add(shorter.lower())
            again = _search_once(shorter, people, per_provider)
            if again["candidates"]:
                again["notes"].insert(0, f"Nothing matched '{q}', so these are results for '{shorter}'.")
                return again
    return res


# ---------- the footage folder: credits and picks ----------

def _videos_dir() -> Path:
    return Path(settings.VIDEOS_DIR)


def _read_json(path: Path) -> Dict[str, Any]:
    return stock._read_json(path)


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    stock._write_json(path, data)


def credit_info(name: str) -> Optional[Dict[str, Any]]:
    return _read_json(_videos_dir() / "_vcredits.json").get(Path(name).name)


def pick_for(query: str) -> Optional[str]:
    """The clip chosen earlier for this phrase, if the file is still there."""
    name = _read_json(_videos_dir() / "_vpicks.json").get(clean_query(query).lower())
    return name if name and (_videos_dir() / name).is_file() else None


def set_pick(query: str, name: str) -> None:
    path = _videos_dir() / "_vpicks.json"
    picks = _read_json(path)
    picks[clean_query(query).lower()] = name
    _write_json(path, picks)


def fetch_candidate(cand: Dict[str, Any], query: str = "") -> Dict[str, Any]:
    """Download one clip into the footage folder, record its credit and remember it for the phrase."""
    data, ctype = _fetch(cand["download_url"], max_bytes=MAX_VIDEO_DOWNLOAD)
    if len(data) < 1000 or data[4:8] != b"ftyp":        # every mp4 opens with its ftyp box
        raise StockError("the download was not a readable video")
    raw_id = re.sub(r"[^A-Za-z0-9]+", "", str(cand["id"].split(":", 1)[-1]))[:10]
    name = f"{stock._slug(query or cand.get('title', '')) or 'clip'}_{cand['provider']}_{raw_id}.mp4"
    folder = _videos_dir()
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / (name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, folder / name)
    credits = _read_json(folder / "_vcredits.json")
    credits[name] = {"credit": cand["credit"], "provider": cand["provider_name"], "author": cand.get("author", ""),
                     "license": cand.get("license", ""), "page_url": cand.get("page_url", ""), "query": query,
                     "fetched": time.strftime("%Y-%m-%d")}
    _write_json(folder / "_vcredits.json", credits)
    if query:
        set_pick(query, name)
    return {"name": name, "path": str(folder / name), "credit": cand["credit"], "page_url": cand.get("page_url", ""),
            "provider": cand["provider_name"]}


def resolve_clip(query: str) -> Tuple[Optional[Dict[str, Any]], str]:
    """Footage for a scene's `clip:` phrase: the remembered pick, else the best new candidate.
    Returns ({"name", "path", "credit", "page_url"}, "") or (None, why)."""
    name = pick_for(query)
    if name:
        info = credit_info(name) or {}
        return {"name": name, "path": str(_videos_dir() / name), "credit": info.get("credit", ""),
                "page_url": info.get("page_url", ""), "provider": info.get("provider", "")}, ""
    try:
        res = search(query)
        if not res["candidates"]:
            return None, f"no suitable free footage was found for '{clean_query(query)}'" + (" (" + res["notes"][-1] + ")" if res["notes"] else "")
        last = ""
        for cand in res["candidates"][:3]:
            try:
                return fetch_candidate(cand, query), ""
            except StockError as e:
                last = str(e)
        return None, f"the footage found could not be downloaded ({last})"
    except StockError as e:
        return None, str(e)
