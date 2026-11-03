"""Free stock pictures for picture slides: search, pick, download, remember, credit.

Sources (all free; only official search APIs, no scraping, no Google Images):
  Wikimedia Commons  no key; only free licences (CC0, public domain, CC BY, CC BY-SA)
  Unsplash           free key in Settings (UNSPLASH_ACCESS_KEY)
  Pexels             free key in Settings (PEXELS_API_KEY)
  Pixabay            free key in Settings (PIXABAY_API_KEY)

A picture is saved into the app's images/ folder; its credit ("Photo by X on Pexels") is kept in
images/_credits.json so every deck that uses it shows the credit automatically, and the picture chosen
for a search phrase is remembered in images/_picks.json, so a deck rebuilds with the same picture.
Licences differ and change: the credit is added for you, but the licence on the photo's own page is the
authority, so check it before posting. People and logo/brand photos are hidden unless asked for, which is
a keyword heuristic and not a guarantee.
"""

import hashlib
import html as html_lib
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .. import settings

UA = "AutoContentPostBuilder/1.0 (local desktop app; free stock photo search)"
KEY_ENV = {"unsplash": "UNSPLASH_ACCESS_KEY", "pexels": "PEXELS_API_KEY", "pixabay": "PIXABAY_API_KEY"}
KEY_URL = {"unsplash": "https://unsplash.com/developers", "pexels": "https://www.pexels.com/api/",
           "pixabay": "https://pixabay.com/api/docs/"}
PROVIDER_NAMES = {"unsplash": "Unsplash", "pexels": "Pexels", "pixabay": "Pixabay", "wikimedia": "Wikimedia Commons"}
PROVIDER_ORDER = ("unsplash", "pexels", "pixabay", "wikimedia")
MIN_WIDTH = 1000          # smaller pictures look blurry on a 1080 px slide
MAX_DOWNLOAD = 20 * 1024 * 1024
MAX_RESULTS = 24
CACHE_SECONDS = 600
_PEOPLE = re.compile(r"\b(man|men|woman|women|person|people|portrait|face|faces|selfie|child|children|kid|kids|girl|girls|boy|boys|"
                     r"model|crowd|couple|family|baby|bride|groom|lady|guy|worker|workers|team|customer|customers|"
                     r"student|students|human)\b", re.I)
_BRAND = re.compile(r"\b(logo|logos|logotype|trademark|brand|branded|emblem|mascot|screenshot|poster|advertisement)\b", re.I)
_FREE_LICENSE = re.compile(r"^(cc0|cc[- ]?zero|public domain|pd\b|pdm|cc[- ]by(?![- ](nc|nd))(?:[- ]sa)?\b)", re.I)

_RECENT: Dict[str, Dict[str, Any]] = {}   # candidate id -> candidate, so a pick refers to what the search returned
_SEARCH_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}


class StockError(Exception):
    """A clear, user-facing reason a search or download did not work."""


# ---------- network (one place, so tests can replace it) ----------

def _fetch(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 20, max_bytes: int = MAX_DOWNLOAD) -> Tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read(max_bytes + 1)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise StockError(f"the service refused the request (HTTP {e.code}); the key may be wrong or expired") from None
        if e.code == 429:
            raise StockError("the service's free request limit is used up for now; try again in a while") from None
        raise StockError(f"the service answered HTTP {e.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise StockError(f"no internet connection ({getattr(e, 'reason', e)})") from None
    if len(data) > max_bytes:
        raise StockError("the file is too large")
    return data, ctype


def _json(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    data, _ = _fetch(url, headers, max_bytes=5 * 1024 * 1024)
    try:
        return json.loads(data.decode("utf-8", errors="replace"))
    except ValueError:
        raise StockError("the service sent a reply that could not be read") from None


# ---------- keys ----------

def key_for(provider: str) -> str:
    name = KEY_ENV.get(provider)
    return (settings.get_env_setting(name, "") if name else "").strip()


def provider_status() -> Dict[str, bool]:
    """Which sources can be used now (never the keys themselves)."""
    return {**{p: bool(key_for(p)) for p in KEY_ENV}, "wikimedia": True}


# ---------- candidates ----------

def _strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _cand(provider: str, raw_id: Any, **kw) -> Dict[str, Any]:
    c = {"id": f"{provider}:{raw_id}", "provider": provider, "provider_name": PROVIDER_NAMES[provider], "title": "",
         "author": "", "license": "", "text": "", "trigger": "", "width": 0, "height": 0}
    c.update(kw)
    return c


def _unsplash(q: str, n: int) -> List[Dict[str, Any]]:
    url = "https://api.unsplash.com/search/photos?" + urllib.parse.urlencode(
        {"query": q, "per_page": n, "orientation": "landscape", "content_filter": "high"})
    data = _json(url, {"Authorization": f"Client-ID {key_for('unsplash')}", "Accept-Version": "v1"})
    out = []
    for r in data.get("results", []):
        u, user = r.get("urls", {}), r.get("user", {})
        raw = u.get("raw") or u.get("regular") or ""
        out.append(_cand(
            "unsplash", r.get("id"), thumb_url=u.get("small", ""),
            download_url=(raw + ("&" if "?" in raw else "?") + "w=1600&fit=max&q=80") if u.get("raw") else raw,
            page_url=(r.get("links") or {}).get("html", ""), width=int(r.get("width") or 0), height=int(r.get("height") or 0),
            author=user.get("name", ""), credit=f"Photo by {user.get('name', 'unknown')} on Unsplash", license="Unsplash License",
            title=r.get("alt_description") or r.get("description") or "",
            text=" ".join(filter(None, [r.get("alt_description"), r.get("description")]
                                 + [t.get("title", "") for t in r.get("tags", []) if isinstance(t, dict)])),
            trigger=(r.get("links") or {}).get("download_location", "")))
    return out


def _pexels(q: str, n: int) -> List[Dict[str, Any]]:
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({"query": q, "per_page": n, "orientation": "landscape"})
    data = _json(url, {"Authorization": key_for("pexels")})
    out = []
    for r in data.get("photos", []):
        src = r.get("src", {})
        out.append(_cand(
            "pexels", r.get("id"), thumb_url=src.get("medium", ""), download_url=src.get("large2x") or src.get("large") or "",
            page_url=r.get("url", ""), width=int(r.get("width") or 0), height=int(r.get("height") or 0),
            author=r.get("photographer", ""), credit=f"Photo by {r.get('photographer', 'unknown')} on Pexels",
            license="Pexels License", title=r.get("alt") or "", text=r.get("alt") or ""))
    return out


def _pixabay(q: str, n: int) -> List[Dict[str, Any]]:
    url = "https://pixabay.com/api/?" + urllib.parse.urlencode(
        {"key": key_for("pixabay"), "q": q, "image_type": "photo", "orientation": "horizontal", "safesearch": "true",
         "per_page": max(3, n), "min_width": MIN_WIDTH})
    data = _json(url)
    out = []
    for r in data.get("hits", []):
        out.append(_cand(
            "pixabay", r.get("id"), thumb_url=r.get("webformatURL") or r.get("previewURL", ""),
            download_url=r.get("largeImageURL") or r.get("webformatURL", ""), page_url=r.get("pageURL", ""),
            width=int(r.get("imageWidth") or 0), height=int(r.get("imageHeight") or 0), author=r.get("user", ""),
            credit=f"Image by {r.get('user', 'unknown')} from Pixabay", license="Pixabay Content License",
            title=r.get("tags", ""), text=r.get("tags", "")))
    return out


def _wikimedia(q: str, n: int) -> List[Dict[str, Any]]:
    params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": f"filetype:bitmap {q}",
              "gsrnamespace": 6, "gsrlimit": min(50, n * 4), "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
              "iiurlwidth": 1600, "origin": "*",
              "iiextmetadatafilter": "LicenseShortName|Artist|ImageDescription|AttributionRequired|Categories|Credit"}
    data = _json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    pages = sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    out = []
    for p in pages:
        info = (p.get("imageinfo") or [{}])[0]
        meta = {k: _strip_html((v or {}).get("value", "")) for k, v in (info.get("extmetadata") or {}).items()}
        lic = meta.get("LicenseShortName", "")
        if info.get("mime") not in ("image/jpeg", "image/png", "image/webp") or not _FREE_LICENSE.match(lic):
            continue                                        # only pictures with a free licence
        title = re.sub(r"^File:|\.[A-Za-z]+$", "", p.get("title", "")).replace("_", " ")
        author = (meta.get("Artist") or meta.get("Credit") or "").strip()
        author = (author[:40].rsplit(" ", 1)[0] + "...") if len(author) > 44 else author
        credit = ", ".join(x for x in (author, lic, "Wikimedia Commons") if x)
        thumb = info.get("thumburl", "")
        out.append(_cand(
            "wikimedia", p.get("pageid"), thumb_url=re.sub(r"/\d+px-", "/500px-", thumb) if thumb else info.get("url", ""),   # Wikimedia refuses non-standard widths (400)
            download_url=thumb or info.get("url", ""), page_url=info.get("descriptionurl", ""),
            width=int(info.get("thumbwidth") or info.get("width") or 0), height=int(info.get("thumbheight") or info.get("height") or 0),
            author=author, credit=credit, license=lic, title=title,
            text=" ".join([title, meta.get("ImageDescription", ""), meta.get("Categories", "").replace("|", " ")])))
    return out


_PROVIDERS = {"unsplash": _unsplash, "pexels": _pexels, "pixabay": _pixabay, "wikimedia": _wikimedia}


def risky_reason(c: Dict[str, Any]) -> str:
    """'people' or 'logo' when the picture's own words suggest an identifiable person or a brand."""
    text = f"{c.get('title', '')} {c.get('text', '')}"
    if _PEOPLE.search(text):
        return "people"
    if _BRAND.search(text):
        return "logo or brand"
    return ""


# ---------- search ----------

def clean_query(q: str) -> str:
    q = re.sub(r"\s+", " ", re.sub(r"[^\w\s'-]", " ", q or "")).strip()
    return " ".join(q.split()[:10])[:80]


_STOP = set("""a an the of and or in on at to for with from by into over under near next about as is are was were be been it its this that
these those some any very more most up down out off than then there their his her our your my one two three set sets showing shows show
photo photos picture pictures image images shot view scene""".split())


def keywords_from(text: str, limit: int = 4) -> str:
    """The content words of a sentence or prompt, as a short search phrase."""
    words = [w for w in clean_query(text).split() if w.lower() not in _STOP and len(w) > 1]
    return " ".join(words[:limit])


def search(query: str, people: bool = False, per_provider: int = 8, providers: Optional[List[str]] = None) -> Dict[str, Any]:
    """Like _search_once, but a long query that finds nothing is retried with fewer keywords."""
    res = _search_once(query, people, per_provider, providers)
    if res["candidates"]:
        return res
    q = clean_query(query)
    tried = {q.lower()}
    words = keywords_from(q, 10).split()
    # Windows of 4, 3 then 2 content words, from the end of the phrase (where the nouns usually are) back to the start.
    # Never a single word: that finds unrelated pictures. A window must give at least 3 results.
    best: Optional[Dict[str, Any]] = None
    for n in (4, 3, 2):
        for start in range(len(words) - n, -1, -1):
            shorter = " ".join(words[start:start + n])
            if len(words) < n or shorter.lower() in tried:
                continue
            tried.add(shorter.lower())
            again = _search_once(shorter, people, per_provider, providers)
            if len(again["candidates"]) >= 3:
                again["notes"].insert(0, f"Nothing matched '{q}', so these are results for '{shorter}'.")
                return again
            if again["candidates"] and best is None:
                again["notes"].insert(0, f"Nothing matched '{q}', so these are results for '{shorter}'.")
                best = again
    return best or res


def _search_once(query: str, people: bool = False, per_provider: int = 8, providers: Optional[List[str]] = None) -> Dict[str, Any]:
    """Candidates from every usable source, interleaved, filtered for size, licence and (unless asked) people/logos.

    Returns {"candidates": [...], "providers": {name: "ok" | "no key" | "failed: reason"}, "notes": [...]}.
    Raises StockError when nothing can be searched at all (e.g. no internet)."""
    q = clean_query(query)
    if not q:
        raise StockError("Type a few keywords for the picture, like 'workshop 3d printer'.")
    allow_people = people or bool(_PEOPLE.search(q))
    status = provider_status()
    wanted = [p for p in PROVIDER_ORDER if (providers is None or p in providers)]
    cache_key = json.dumps([q, allow_people, per_provider, wanted, [p for p in wanted if status.get(p)]])
    hit = _SEARCH_CACHE.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]

    per: Dict[str, List[Dict[str, Any]]] = {}
    result_status: Dict[str, str] = {}
    errors: List[str] = []
    for p in wanted:
        if not status.get(p):
            result_status[p] = "no key"
            continue
        try:
            per[p] = _PROVIDERS[p](q, per_provider)
            result_status[p] = "ok"
        except StockError as e:
            result_status[p] = f"failed: {e}"
            errors.append(f"{PROVIDER_NAMES[p]}: {e}")
    if not per:
        offline = [e for e in errors if "no internet" in e]
        raise StockError("No internet connection, so pictures cannot be searched. Check the connection and try again."
                         if offline and len(offline) == len(errors) else
                         "No picture source could be searched. " + " ".join(errors))

    hidden = small = 0
    kept: Dict[str, List[Dict[str, Any]]] = {}
    for p, items in per.items():
        kept[p] = []
        for c in items:
            if not c.get("download_url"):
                continue
            if 0 < c["width"] < MIN_WIDTH:
                small += 1
                continue
            c["risk"] = risky_reason(c)
            if c["risk"] and not allow_people:
                hidden += 1
                continue
            kept[p].append(c)
    merged: List[Dict[str, Any]] = []
    seen = set()
    for i in range(max((len(v) for v in kept.values()), default=0)):
        for p in PROVIDER_ORDER:
            if i < len(kept.get(p, [])):
                c = kept[p][i]
                if c["id"] not in seen and len(merged) < MAX_RESULTS:
                    seen.add(c["id"])
                    merged.append(c)
    for c in merged:
        _RECENT[c["id"]] = c
    while len(_RECENT) > 400:
        _RECENT.pop(next(iter(_RECENT)))
    notes = [f"{PROVIDER_NAMES[p]}: {s.replace('no key', 'not used (add a free key in Settings)')}" for p, s in result_status.items() if s != "ok"]
    if hidden:
        notes.append(f"{hidden} picture{'s' if hidden != 1 else ''} that look like people or logos were hidden (tick 'include people' to see them).")
    if small:
        notes.append(f"{small} picture{'s' if small != 1 else ''} smaller than {MIN_WIDTH}px wide were left out.")
    if not merged:
        notes.append("Nothing suitable was found; try other or fewer keywords.")
    out = {"candidates": merged, "providers": result_status, "notes": notes, "query": q}
    _SEARCH_CACHE[cache_key] = (time.time(), out)
    return out


def clear_cache() -> None:
    _SEARCH_CACHE.clear()
    _RECENT.clear()


def candidate(cid: str) -> Optional[Dict[str, Any]]:
    return _RECENT.get(cid)


# ---------- the images folder: credits and picks ----------

def _images_dir() -> Path:
    return Path(settings.IMAGES_DIR)


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (ValueError, OSError):
        return {}


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def credit_info(name: str) -> Optional[Dict[str, Any]]:
    """The credit saved with a picture of the images folder (by file name), if it came from a stock source."""
    return _read_json(_images_dir() / "_credits.json").get(Path(name).name)


def credit_for(name: str) -> str:
    info = credit_info(name)
    return (info or {}).get("credit", "")


def _query_key(query: str) -> str:
    return clean_query(query).lower()


def pick_for(query: str) -> Optional[str]:
    """The file name chosen earlier for this search phrase (if it still exists)."""
    name = _read_json(_images_dir() / "_picks.json").get(_query_key(query))
    return name if name and (_images_dir() / name).is_file() else None


def set_pick(query: str, name: str) -> None:
    path = _images_dir() / "_picks.json"
    picks = _read_json(path)
    picks[_query_key(query)] = name
    _write_json(path, picks)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:36] or "photo"


def fetch_candidate(cand: Dict[str, Any], query: str = "") -> Dict[str, Any]:
    """Download one candidate into the images folder, record its credit and remember it for the query."""
    data, ctype = _fetch(cand["download_url"], max_bytes=MAX_DOWNLOAD)
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
            fmt = (im.format or "").upper()
    except Exception:
        raise StockError("the download was not a readable picture") from None
    if w < 800:
        raise StockError(f"the picture is only {w}px wide, too small for a slide")
    ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get(fmt)
    if ext is None:
        from PIL import Image
        buf = io.BytesIO()
        Image.open(io.BytesIO(data)).convert("RGB").save(buf, "JPEG", quality=92)
        data, ext = buf.getvalue(), ".jpg"
    raw_id = re.sub(r"[^A-Za-z0-9]+", "", str(cand["id"].split(":", 1)[-1]))[:10]
    name = f"{_slug(query or cand.get('title', ''))}_{cand['provider']}_{raw_id}{ext}"
    folder = _images_dir()
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(data)
    if cand.get("trigger"):     # Unsplash asks apps to report a download
        try:
            _fetch(cand["trigger"], {"Authorization": f"Client-ID {key_for('unsplash')}"}, max_bytes=100000)
        except StockError:
            pass
    credits = _read_json(folder / "_credits.json")
    credits[name] = {"credit": cand["credit"], "provider": cand["provider_name"], "author": cand.get("author", ""),
                     "license": cand.get("license", ""), "page_url": cand.get("page_url", ""), "query": query,
                     "fetched": time.strftime("%Y-%m-%d")}
    _write_json(folder / "_credits.json", credits)
    if query:
        set_pick(query, name)
    return {"name": name, "credit": cand["credit"], "license": cand.get("license", ""), "page_url": cand.get("page_url", ""),
            "width": w, "height": h}


def resolve_search(query: str, people: bool = False) -> Tuple[Optional[Dict[str, Any]], str]:
    """A picture for a `search:` slide: the remembered pick, else the best new candidate. (result, error)."""
    name = pick_for(query)
    if name:
        return {"name": name, "credit": credit_for(name)}, ""
    try:
        res = search(query, people=people)
        if not res["candidates"]:
            return None, f"no suitable free picture was found for '{clean_query(query)}'" + (" (" + res["notes"][-1] + ")" if res["notes"] else "")
        last = ""
        for cand in res["candidates"][:3]:
            try:
                return fetch_candidate(cand, query), ""
            except StockError as e:
                last = str(e)
        return None, f"the pictures found could not be downloaded ({last})"
    except StockError as e:
        return None, str(e)
