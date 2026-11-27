"""Once a post or reel is marked posted, keep the finished files and delete the working ones.

Reel: keeps out/reel.mp4, poster.jpg, caption.txt, reel.json and the script. Everything else in its folder
(leftover out/work, voice.wav, uploaded recording, extra renders) goes. Stock footage in the shared clip cache
goes too, unless another reel that isn't posted yet uses it (or one still being made has a `clip:` line).
Post: keeps slides, copies, ZIP, audit.md; drops contact_sheet.png and grounding_report.md.
Never raises. Un-posting does not bring the files back: a remake from the script does.
"""

import json
import re
import shutil
from pathlib import Path
from typing import Iterable, List

import logstore
import notifier

REEL_KEEP_OUT = {"reel.mp4", "poster.jpg", "caption.txt", "reel.json", "script.md"}
REEL_KEEP_TOP = {"script.md", "out"}
POST_DROP = ("contact_sheet.png", "grounding_report.md")
_CLIP_LINE = re.compile(r"^\s*(clip|broll|footage|bvideo)\s*:", re.I | re.M)
_FILE = notifier.DATA_DIR / "sage_posted_cleanup.json"


def _size(path: Path) -> int:
    try:
        if path.is_file():
            return path.stat().st_size
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    except OSError:
        return 0


def _remove(path: Path) -> int:
    n = _size(path)
    try:
        shutil.rmtree(path) if path.is_dir() else path.unlink()
    except OSError:
        return 0
    return n


def totals() -> dict:
    try:
        d = json.loads(_FILE.read_text())
        return {"freedBytes": int(d.get("freedBytes", 0)), "items": int(d.get("items", 0))}
    except (OSError, ValueError):
        return {"freedBytes": 0, "items": 0}


def _record(freed: int) -> None:
    if freed <= 0:
        return
    t = totals()
    try:
        _FILE.write_text(json.dumps({"freedBytes": t["freedBytes"] + freed, "items": t["items"] + 1}))
    except OSError:
        pass


def clean_reel(reel: dict, folder: Path, others: Iterable[dict], videos_dir: Path) -> int:
    """Delete a posted reel's working files. `others` = every other reel record."""
    freed = 0
    try:
        if not reel.get("posted") or not folder.is_dir():
            return 0
        out = folder / "out"
        if not (out / "reel.mp4").is_file():
            return 0  # nothing finished to keep: leave everything alone
        for p in list(folder.iterdir()):
            if p.name not in REEL_KEEP_TOP:
                freed += _remove(p)
        for p in list(out.iterdir()):
            if p.name not in REEL_KEEP_OUT:
                freed += _remove(p)
        freed += _prune_footage(reel, list(others), videos_dir)
        _record(freed)
    except Exception as e:  # never break marking as posted
        logstore.warn("posts", f"Posted cleanup of reel {reel.get('id')} failed: {e}")
    return freed


def _prune_footage(reel: dict, others: List[dict], videos_dir: Path) -> int:
    mine = set(reel.get("clips") or [])
    if not mine or not videos_dir.is_dir():
        return 0
    for o in others:
        if o.get("posted") or o.get("wontPost") or o.get("archived"):
            continue
        if set(o.get("clips") or []) & mine:
            mine -= set(o.get("clips") or [])
        if o.get("status") in ("queued", "running", "planned", "waiting") and _CLIP_LINE.search(o.get("script") or ""):
            return 0  # a reel not drawn yet may want any clip: keep them all
    freed = 0
    for name in mine:
        freed += _remove(videos_dir / Path(name).name)
    for fname in ("_vpicks.json", "_vcredits.json"):
        f = videos_dir / fname
        try:
            d = json.loads(f.read_text())
            d = {k: v for k, v in d.items() if (k if fname == "_vcredits.json" else v) not in mine}
            f.write_text(json.dumps(d, indent=2))
        except (OSError, ValueError):
            pass
    return freed


def clean_post(post: dict, folder: Path) -> int:
    freed = 0
    try:
        if not post.get("posted"):
            return 0
        for name in POST_DROP:
            p = folder / "out" / name
            if p.is_file():
                freed += _remove(p)
        _record(freed)
    except Exception as e:
        logstore.warn("posts", f"Posted cleanup of post {post.get('id')} failed: {e}")
    return freed
