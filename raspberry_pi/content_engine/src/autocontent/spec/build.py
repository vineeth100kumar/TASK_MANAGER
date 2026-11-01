"""Turn a parsed spec into a deck folder (slides.json, caption.txt, assets/) ready to render."""

import hashlib
import json
import re
import shutil
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..progress import report
from ..settings import OUTPUT_DIR, load_brand_config
from . import stock
from .checks import check_slides, check_caption, resolve_image, issues_summary
from .parser import SPEC_VERSION, ParsedSpec, SpecIssue, parse_spec, _image_dirs, image_to_text, plain

MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_SIDE = 2160


class SpecError(Exception):
    """The spec has errors; .issues lists them."""

    def __init__(self, issues: List[SpecIssue]):
        self.issues = issues
        errors = [i for i in issues if i.severity == "ERROR"]
        super().__init__(f"The post spec has {len(errors)} error(s):\n" + "\n".join(f"  - {e}" for e in errors))


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "post"


def auto_caption(slides: List[Dict[str, Any]], handle: str, hashtags: List[str]) -> str:
    """A plain caption from the slides when the spec has none: the hook, one line per slide, a CTA."""
    cover = next((s.get("headline", "") for s in slides if s.get("type") == "cover"), "")
    lines = [cover, ""] if cover else []
    points = []
    for s in slides:
        if s.get("type") in ("cover", "cta"):
            continue
        text = s.get("headline") or s.get("body") or ""
        if s.get("type") == "stat" and s.get("number"):
            text = f"{s['number']}: {s.get('body') or s.get('headline', '')}".strip(": ")
        if text:
            points.append(f"• {text}")
    if points:
        lines += ["Inside:"] + points + [""]
    lines.append(f"Save this for later and follow {handle} for more.")
    if hashtags:
        lines += ["", " ".join(hashtags)]
    return plain("\n".join(lines).strip()) + "\n"


def _final_caption(spec: ParsedSpec, slides: List[Dict[str, Any]], handle: str, default_tags: List[str]) -> str:
    tags = spec.hashtags or default_tags
    if spec.caption is None:
        return auto_caption(slides, handle, tags)
    text = spec.caption.strip()
    missing = [t for t in spec.hashtags if t.lower() not in text.lower()]
    if missing:
        text += "\n\n" + " ".join(missing)
    return text + "\n"


def _cache_dir() -> Path:
    return OUTPUT_DIR / "_cache" / "images"


def _download(url: str, dest_stem: Path = None) -> Path:
    """The picture behind a link, downloaded once and kept in output/_cache/images (so a link that
    later expires, or is offline, still works for decks built from it again)."""
    cache = _cache_dir()
    key = hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]
    hit = next(iter(sorted(cache.glob(key + ".*"))), None) if cache.is_dir() else None
    if hit is not None:
        report("Using the saved copy of the downloaded image")
        return hit
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (AutoContent post builder)"})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read(MAX_DOWNLOAD_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise ValueError(f"the site answered HTTP {e.code} (many sites block downloads, and generated-image links expire); "
                         "save the picture into the images folder and use its file name") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ValueError(f"the link could not be reached ({getattr(e, 'reason', e)}); check the internet connection, "
                         "or save the picture into the images folder") from None
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise ValueError("the file is larger than 20 MB")
    if ctype and not ctype.startswith("image/") and "octet-stream" not in ctype:
        raise ValueError(f"the link returned {ctype.split(';')[0]}, not a picture (it may be a web page that shows the picture)")
    from PIL import Image
    import io
    try:
        with Image.open(io.BytesIO(data)) as im:
            ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif", "BMP": ".bmp"}.get(im.format or "", ".img")
    except Exception:
        raise ValueError("the link did not return a readable picture") from None
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (key + ext)
    path.write_bytes(data)
    return path


def _store_image(src: Path, dest_stem: Path) -> Path:
    """Copy a picture into the deck's assets folder, scaled down to at most 2160px."""
    from PIL import Image, ImageOps
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if max(im.size) > MAX_IMAGE_SIDE:
            im.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
        has_alpha = im.mode in ("RGBA", "LA", "P") and ("transparency" in im.info or im.mode != "P")
        if has_alpha:
            dest = dest_stem.with_suffix(".png")
            im.convert("RGBA").save(dest, "PNG", optimize=True)
        else:
            dest = dest_stem.with_suffix(".jpg")
            im.convert("RGB").save(dest, "JPEG", quality=90)
    return dest


def _apply_credit(s: Dict[str, Any], file_name: str) -> None:
    """A picture from a stock source brings its credit; the slide's own source wins, a header default does not."""
    credit = stock.credit_for(file_name)
    if credit and (not s.get("source_note") or s.get("_source_default")):
        s["source_note"] = credit
        s.pop("_source_default", None)


def collect_images(slides: List[Dict[str, Any]], out_dir: Path, base_dirs: List[Path], fetch: bool = True) -> List[SpecIssue]:
    """Copy (or download) each image slide's picture into out_dir/assets and point the slide at it.
    A slide with `search:` and no picture gets a free stock photo (the remembered pick, else the best new
    one) when fetch is on; if that fails it keeps a placeholder and says why."""
    issues: List[SpecIssue] = []
    assets = out_dir / "assets"
    for n, s in enumerate(slides, start=1):
        ref = (s.get("image") or "").strip()
        if s.get("type") == "image" and not ref and s.get("image_search"):
            query = s["image_search"]
            if fetch or stock.pick_for(query):
                report(f"Finding a free picture for '{query}'...")
                found, why = stock.resolve_search(query)
            else:
                found, why = None, "automatic picture search is switched off"
            if found:
                ref = s["image"] = found["name"]
            else:
                # a search that was tried and failed becomes a text slide; switched-off search keeps the placeholder
                text_only = not s.get("image_prompt") and (fetch or stock.pick_for(query))
                if text_only:
                    image_to_text(s)
                issues.append(SpecIssue("WARN", "IMAGE_SEARCH_FAILED",
                                        f"No picture could be fetched for '{query}': {why}. "
                                        + ("The slide is drawn as a text slide." if text_only else "The slide shows a placeholder."),
                                        slide=n, field="search",
                                        hint="Check the internet connection, add a free key in Settings, or use Fetch pictures / your own file."))
        if s.get("type") != "image" or not ref:
            continue
        assets.mkdir(parents=True, exist_ok=True)
        stem = assets / f"slide_{n:02d}"
        try:
            if re.match(r"^https?://", ref, re.I):
                report(f"Getting the image for slide {n} from its link...")
                dest = _store_image(_download(ref), stem)
            else:
                src = resolve_image(ref, base_dirs)
                if src is None:
                    raise FileNotFoundError(f"file not found (looked in the spec's folder, its images folder and the app's images folder)")
                dest = _store_image(src, stem)
        except Exception as e:
            if s.get("image_prompt"):
                # No picture yet: the slide shows a placeholder with its prompt (the audit refuses to pass it)
                s["image_source"] = ref
                s["image"] = ""
                issues.append(SpecIssue("WARN", "IMAGE_PLACEHOLDER",
                                        f"Could not get the picture '{ref}' ({e}); the slide shows a placeholder with its prompt.",
                                        slide=n, field="image",
                                        hint="Put the picture in the images folder and write  image: <file name>."))
                continue
            image_to_text(s)
            issues.append(SpecIssue("WARN", "IMAGE_FAILED", f"Could not get the image {ref}: {e}. The slide is drawn as a text slide.",
                                    slide=n, field="image",
                                    hint="Check the path or link, or put the picture in the images folder and use its file name."))
            continue
        s["image_source"] = ref
        s["image"] = f"assets/{dest.name}"
        _apply_credit(s, src.name if not re.match(r"^https?://", ref, re.I) else "")
    return issues


def validate_spec_text(text: str, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Parse and check a spec without writing anything: the Create screen's Validate step."""
    spec = parse_spec(text, base_dir=base_dir)
    preview = []
    for n, s in enumerate(spec.slides, start=1):
        title = s.get("headline") or s.get("number") or s.get("body") or s.get("image") or ""
        extra = ""
        if s.get("type") == "chart":
            extra = f"{s.get('chart_kind', 'bar')} chart, {len(s.get('series') or [])} points"
        elif s.get("type") == "table":
            t = s.get("table") or {}
            extra = f"{len(t.get('columns') or [])} columns x {len(t.get('rows') or [])} rows"
        elif s.get("type") == "point" and s.get("bullets"):
            extra = f"{len(s['bullets'])} bullets"
        elif s.get("type") == "list":
            extra = f"{len(s.get('items') or [])} items"
        needs, query = False, ""
        if s.get("type") == "image":
            ref = (s.get("image") or "").strip()
            found = bool(ref) and (bool(re.match(r"^https?://", ref, re.I)) or resolve_image(ref, _image_dirs(base_dir)) is not None)
            if s.get("image_search") and not ref and stock.pick_for(s["image_search"]):
                found = True
            needs = not found and bool(s.get("image_prompt") or s.get("image_search") or ref)
            query = s.get("image_search") or stock.keywords_from(s.get("image_prompt") or "") or s.get("headline") or ""
        preview.append({"n": n, "type": s.get("type"), "title": str(title)[:90], "extra": extra,
                        "needs_picture": needs, "query": str(query)[:120], "has_search": bool(s.get("image_search")),
                        "line": spec.slide_lines[n - 1] if n <= len(spec.slide_lines) else None,
                        "errors": sum(1 for i in spec.issues if i.slide == n and i.severity == "ERROR"),
                        "warnings": sum(1 for i in spec.issues if i.slide == n and i.severity == "WARN")})
    brand = load_brand_config()
    caption = _final_caption(spec, spec.slides, spec.meta.get("handle") or brand.handle, brand.hashtags) if spec.slides else ""
    return {
        "ok": spec.ok,
        "summary": issues_summary(spec.issues),
        "errors": [i.to_dict() for i in spec.errors],
        "warnings": [i.to_dict() for i in spec.warnings],
        "slides": preview,
        "meta": {k: v for k, v in spec.meta.items() if not k.startswith("_")},
        "caption": caption,
        "caption_is_auto": spec.caption is None,
    }


def _assemble_deck(spec: ParsedSpec, slides: List[Dict[str, Any]], brand, title: str, timestamp: str,
                   source_name: str, style: Optional[str], canvas_format: Optional[str], tag: Optional[str]) -> Dict[str, Any]:
    """The slides.json dict for a parsed spec (slides already carry their pictures). Shared by the
    real build and the live preview."""
    meta = spec.meta
    deck_brand = {
        "page_name": meta.get("page_name") or brand.page_name,
        "handle": meta.get("handle") or brand.handle,
        "tag": meta.get("tag") or tag or brand.default_tag,
        "cta_pill": meta.get("cta_pill") or brand.cta_pill,
        "cta_pill_subtext": meta.get("cta_pill_subtext") or brand.cta_pill_subtext,
    }
    for s in slides:
        if s.get("type") == "cta":
            if not s.get("headline"):
                s["headline"] = brand.cta_headline
            # A cta slide's own pill text applies to the deck's pill
            for k in ("cta_pill", "cta_pill_subtext"):
                if s.get(k):
                    deck_brand[k] = s.pop(k)
    for n, s in enumerate(slides, start=1):
        s.pop("_source_default", None)
        s["n"] = n
        s["source_status"] = "user_spec"
        s.setdefault("claim_ids", [])

    data = {
        "post_id": f"{_slug(title)}_{timestamp}",
        "title": title,
        "brand": deck_brand,
        "style": meta.get("style") or style or "grid_pill",
        "canvas_format": meta.get("format") or canvas_format or "portrait",
        "seed": meta.get("seed") or int(datetime.now().strftime("%Y%m%d")),
        "mode_used": "spec",
        "spec_version": SPEC_VERSION,
        "source_file": source_name,
        "claims": [],
        "slides": slides,
    }
    if meta.get("accent"):
        data["colors"] = {"accent": meta["accent"]}
    return data


def build_from_spec(
    spec_path: Path,
    out_dir: Optional[Path] = None,
    style: Optional[str] = None,
    canvas_format: Optional[str] = None,
    tag: Optional[str] = None,
    require_marker: bool = True,
    fetch_images: bool = True,
) -> Tuple[Path, Dict[str, Any], List[SpecIssue]]:
    """Parse the spec file and write the deck folder. style/canvas_format/tag fill in only what
    the spec's front matter leaves out. Raises SpecError (writing nothing) if the spec has errors."""
    spec_path = Path(spec_path).resolve()
    report(f"Reading post spec {spec_path.name}...")
    text = spec_path.read_text(encoding="utf-8-sig", errors="replace")
    spec = parse_spec(text, base_dir=spec_path.parent, require_marker=require_marker)
    report(f"Spec checks: {len(spec.slides)} slides, {issues_summary(spec.issues)}")
    for issue in spec.issues:
        report(f"  {issue}")
    if not spec.ok:
        raise SpecError(spec.issues)

    brand = load_brand_config()
    meta = spec.meta
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    title = meta.get("title") or spec_path.stem
    target = Path(out_dir) if out_dir else OUTPUT_DIR / f"{_slug(title)}_{timestamp}"
    target.mkdir(parents=True, exist_ok=True)

    slides = [dict(s) for s in spec.slides]
    issues = list(spec.issues)
    img_issues = collect_images(slides, target, _image_dirs(spec.base_dir), fetch=fetch_images)
    if any(i.severity == "ERROR" for i in img_issues):
        raise SpecError(issues + img_issues)
    issues += img_issues

    data = _assemble_deck(spec, slides, brand, title, timestamp, spec_path.name, style, canvas_format, tag)
    deck_brand = data["brand"]
    caption = _final_caption(spec, slides, deck_brand["handle"], brand.hashtags)
    data["caption"] = caption

    if spec_path.parent.resolve() != target.resolve():
        shutil.copy2(spec_path, target / "post_spec.md")
    (target / "slides.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    (target / "caption.txt").write_text(caption, encoding="utf-8")
    (target / "spec_check.json").write_text(json.dumps(
        {"summary": issues_summary(issues), "issues": [i.to_dict() for i in issues]}, indent=2, ensure_ascii=False),
        encoding="utf-8")
    report(f"Deck written to {target}")
    return target, data, issues


def deck_checks(folder: Path, data: Dict[str, Any], caption: Optional[str] = None) -> List[SpecIssue]:
    """Spec checks for an existing spec deck folder (render, audit, editor)."""
    issues = check_slides(data.get("slides", []), base_dirs=[folder], allow_urls=False, placeholders="ERROR")
    if caption is None:
        cap_file = folder / "caption.txt"
        caption = cap_file.read_text(encoding="utf-8") if cap_file.exists() else ""
    issues += check_caption(caption)
    return issues


def preview_deck(text: str, base_dir: Optional[Path] = None) -> Tuple[ParsedSpec, Dict[str, Any]]:
    """Parse spec text and assemble the deck in memory (nothing written, no pictures fetched).
    The Write screen's live preview renders slides from this."""
    spec = parse_spec(text, base_dir=base_dir)
    brand = load_brand_config()
    slides = [dict(s) for s in spec.slides]
    data = _assemble_deck(spec, slides, brand, spec.meta.get("title") or "Untitled", "preview", "preview.md", None, None, None)
    data["caption"] = _final_caption(spec, slides, data["brand"]["handle"], brand.hashtags) if slides else ""
    return spec, data
