"""Make a post's preview and share JPEGs.

Kept free of Sage's other modules so Sage can run it as its own small, low
priority process (python posts_copies.py <out folder>) instead of encoding two
dozen images on threads inside the web server. posts.py also calls make_copy()
directly for the occasional single missing copy.

Layout, as posts.py expects it: out/slide_NN.png ->
out/preview/slide_NN.jpg and out/share/slide_NN.jpg.
"""

import os
import sys
import threading
from pathlib import Path
from typing import Dict, Tuple

# kind -> (max width, JPEG quality, chroma subsampling)
PREVIEW = (540, 82, 2)    # the post page shows slides ~330 px wide; 540 stays sharp on 2x screens
SHARE = (10_000, 92, 0)   # full size: Instagram lists itself for JPEGs, not always for big PNGs
KINDS: Dict[str, Tuple[int, int, int]] = {"preview": PREVIEW, "share": SHARE}


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


def make_all(out_dir: Path) -> int:
    """Every missing preview and share copy of the slides in out_dir. Returns how many were made."""
    made = 0
    for png in sorted(out_dir.glob("slide_*.png")):
        for kind, (width, quality, subsampling) in KINDS.items():
            if make_copy(png, out_dir / kind / f"{png.stem}.jpg", width, quality, subsampling):
                made += 1
    return made


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: posts_copies.py <out folder>", file=sys.stderr)
        sys.exit(2)
    print(make_all(Path(sys.argv[1])))
