"""Word-by-word captions, drawn by the same Chromium that draws the slides.

Each phrase (a few words, never across a slide change) is drawn once per spoken word: the word being
said sits on a brand-red marker, the rest in plain ink. The compositor shows the right picture at
the right moment, so the caption follows the voice like the captions people expect on Reels.
Colours follow the slide behind them (dark text on light slides, white text on dark and accent ones).
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

from .align import Timed

CENTER_Y = 1590        # where the caption's middle sits (below the footer, above Instagram's own caption area)
MAX_WORDS = 4
MAX_CHARS = 24
BREAK_GAP = 0.45       # a pause this long starts a new phrase

THEMES = {
    # text, active word's text, active word's marker
    "light": ("#111111", "#FFFFFF", "#EE4425"),
    "dark": ("#FFFFFF", "#FFFFFF", "#EE4425"),
    "accent": ("#FFFFFF", "#FFFFFF", "#111111"),
}


@dataclass
class Phrase:
    scene: int
    words: List[Timed]
    pictures: List[Path] = field(default_factory=list)    # one per word: that word highlighted
    box: Tuple[int, int] = (0, 0)                         # (x, y) of the pictures' top-left on the canvas
    size: Tuple[int, int] = (0, 0)

    @property
    def start(self) -> float:
        return self.words[0].start

    @property
    def end(self) -> float:
        return self.words[-1].end


_LETTER = re.compile(r"^([A-Z])([.,!?;:\"')\u201d\u2019\u2026-]*)$")


def join_spelled(words: List[Timed]) -> List[Timed]:
    """Put a spelled-out abbreviation back together for the caption.

    A narration says "N X P" so the voice reads the letters rather than a word, but on screen the
    viewer should read NXP. Any run of two or more single capital letters becomes one caption word,
    spanning from the first letter's start to the last one's end, so it is still highlighted at the
    moment it is being said. Lower-case letters are left alone, so "a" and "I" in ordinary writing
    are never swallowed."""
    out: List[Timed] = []
    i = 0
    while i < len(words):
        run = []
        j = i
        while j < len(words):
            m = _LETTER.match(words[j].text)
            if not m or (run and run[-1][1]):      # punctuation ends the abbreviation
                if m and not run:
                    run.append(m.groups())
                    j += 1
                break
            run.append(m.groups())
            j += 1
        if len(run) >= 2:
            out.append(Timed("".join(a for a, _ in run) + run[-1][1], words[i].start, words[j - 1].end))
            i = j
        else:
            out.append(words[i])
            i += 1
    return out


def make_phrases(scene_words: Sequence[Tuple[int, List[Timed]]]) -> List[Phrase]:
    """Cut each slide's words into short phrases at sentence ends, commas, pauses and a length limit."""
    phrases: List[Phrase] = []
    for scene, words in scene_words:
        words = join_spelled(words)
        cur: List[Timed] = []
        for i, w in enumerate(words):
            cur.append(w)
            text = " ".join(x.text for x in cur)
            ends_sentence = w.text.rstrip("\"')”").endswith((".", "!", "?", "…"))
            ends_clause = w.text.rstrip("\"')”").endswith((",", ";", ":", "—"))
            nxt = words[i + 1] if i + 1 < len(words) else None
            gap = (nxt.start - w.end) if nxt else 9.0
            next_too_long = nxt is not None and len(text) + 1 + len(nxt.text) > MAX_CHARS
            if (ends_sentence or gap > BREAK_GAP or len(cur) >= MAX_WORDS or next_too_long
                    or (ends_clause and len(cur) >= 2) or nxt is None):
                phrases.append(Phrase(scene, cur))
                cur = []
        if cur:
            phrases.append(Phrase(scene, cur))
    return phrases


def _html(font_url: str, words: List[str], active: int, colors: Tuple[str, str, str], size: int) -> str:
    ink, active_ink, marker = colors
    spans = []
    for i, w in enumerate(words):
        esc = w.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if i == active:
            spans.append(f'<span class="w a">{esc}</span>')
        else:
            spans.append(f'<span class="w">{esc}</span>')
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: 'League Spartan'; src: url({font_url}) format('truetype'); font-weight: 100 900; }}
html, body {{ margin: 0; background: transparent; }}
#cap {{ position: absolute; left: 0; top: 0; display: inline-flex; gap: 0 {int(size * 0.22)}px; align-items: center; white-space: nowrap;
        font-family: 'League Spartan', sans-serif; font-weight: 800; font-size: {size}px; line-height: 1;
        text-transform: uppercase; letter-spacing: 0.01em; padding: 10px 18px; }}
.w {{ color: {ink}; padding: {int(size * 0.14)}px {int(size * 0.2)}px {int(size * 0.1)}px; border-radius: {int(size * 0.2)}px;
      text-shadow: none; }}
.a {{ color: {active_ink}; background: {marker}; transform: skewX(-6deg); }}
</style></head><body><div id="cap">{''.join(spans)}</div></body></html>"""


def render_phrases(page, phrases: List[Phrase], themes: Dict[int, str], font_url: str, out_dir: Path,
                   canvas_w: int = 1080, max_w: int = 980, base_size: int = 72) -> None:
    """Draw every phrase's pictures (RGBA PNGs) into out_dir and set their positions."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for pi, ph in enumerate(phrases):
        texts = [w.text for w in ph.words]
        colors = THEMES.get(themes.get(ph.scene, "light"), THEMES["light"])
        size = base_size
        while True:
            page.set_content(_html(font_url, texts, 0, colors, size), wait_until="load")
            page.evaluate("document.fonts.ready")
            w = page.evaluate("document.getElementById('cap').getBoundingClientRect().width")
            if w <= max_w or size <= 40:
                break
            size -= 4
        # every word has the same padding, so the highlight moving never changes the width
        rect = page.evaluate("(() => { const r = document.getElementById('cap').getBoundingClientRect(); return [r.width, r.height]; })()")
        width, height = int(rect[0]) + 8, int(rect[1]) + 8
        for k in range(len(texts)):
            page.set_content(_html(font_url, texts, k, colors, size), wait_until="load")
            page.evaluate("document.fonts.ready")
            path = out_dir / f"cap_{pi:03d}_{k}.png"
            page.screenshot(path=str(path), clip={"x": 0, "y": 0, "width": width, "height": height}, omit_background=True)
            ph.pictures.append(path)
        ph.size = (width, height)
        ph.box = (int((canvas_w - width) / 2), int(CENTER_Y - height / 2))
