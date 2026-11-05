"""Make a post's thumbnail, preview and share JPEGs, and its ZIP.

Kept free of Sage's other modules so Sage can run it as its own small, low
priority process (python posts_copies.py <out folder>) instead of encoding two
dozen images on threads inside the web server. posts.py also calls make_copy()
directly for the occasional single missing copy.

Layout, as posts.py expects it: out/slide_NN.png ->
out/thumb/slide_NN.jpg, out/preview/slide_NN.jpg and out/share/slide_NN.jpg,
plus out/post.zip (every PNG, the caption, the script and the audit).

They are made once, when the post finishes drawing, and then served as plain
files (posts.py /media/posts/...): no image is encoded and no ZIP is built
while someone waits for it.
"""

import os
import sys
import threading
import zipfile
from pathlib import Path
from typing import Dict, Tuple

# kind -> (max width, JPEG quality, chroma subsampling)
PREVIEW = (540, 82, 2)    # the post page shows slides ~330 px wide; 540 stays sharp on 2x screens
SHARE = (10_000, 92, 0)   # full size: Instagram lists itself for JPEGs, not always for big PNGs
THUMB = (240, 74, 2)      # the Posts list shows the cover ~48 px wide; a few KB each
KINDS: Dict[str, Tuple[int, int, int]] = {"thumb": THUMB, "preview": PREVIEW, "share": SHARE}
ZIP_NAME = "post.zip"


def make_copy(src: Path, dest: Path, width: int, quality: int, subsampling: int) -> bool:
    """A JPEG copy of src at dest, made once. Written to a temp name and
    renamed, so a reader never sees half a file. True if it was (re)made."""
    if dest.is_file() and dest.stat().st_mtime >= src.stat().st_mtime:
        return False
    from PIL import Image
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".{dest.stem}.{os.getpid()}.{threading.get_ident()}.tmp")
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im.save(tmp, "JPEG", quality=quality, optimize=True, subsampling=subsampling)
    os.replace(tmp, dest)
    return True


def make_zip(out_dir: Path) -> bool:
    """out/post.zip: the slides as PNGs, caption.txt, script.md and audit.md.
    Made once (again only when a slide is newer), written to a temp name and
    renamed. Stored, not compressed: PNGs don't shrink. True if it was (re)made."""
    pngs = sorted(out_dir.glob("slide_*.png"))
    dest = out_dir / ZIP_NAME
    if not pngs:
        return False
    if dest.is_file() and dest.stat().st_mtime >= max(p.stat().st_mtime for p in pngs):
        return False
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        for png in pngs:
            z.write(png, png.name)
        caption = out_dir / "caption.txt"
        z.writestr("caption.txt", caption.read_text(encoding="utf-8", errors="replace") if caption.is_file() else "")
        script = out_dir.parent / "script.md"
        z.writestr("script.md", script.read_text(encoding="utf-8", errors="replace") if script.is_file() else "")
        if (out_dir / "audit.md").is_file():
            z.write(out_dir / "audit.md", "audit.md")
    os.replace(tmp, dest)
    return True


def make_all(out_dir: Path) -> int:
    """Every missing copy of the slides in out_dir, and the ZIP. Returns how many files were made."""
    made = 0
    for png in sorted(out_dir.glob("slide_*.png")):
        for kind, (width, quality, subsampling) in KINDS.items():
            if make_copy(png, out_dir / kind / f"{png.stem}.jpg", width, quality, subsampling):
                made += 1
    if make_zip(out_dir):
        made += 1
    return made


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: posts_copies.py <out folder>", file=sys.stderr)
        sys.exit(2)
    print(make_all(Path(sys.argv[1])))
