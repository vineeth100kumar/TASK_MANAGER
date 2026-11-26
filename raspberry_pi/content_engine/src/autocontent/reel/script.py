"""Read a reel script: a post spec with extra per-slide lines.

The slide part is handed, unchanged, to the post spec parser (so a reel's slides get exactly the
same reading, spelling help and checks as a post's). The reel-only lines are lifted out first and
replaced by blank lines, so every line number the parser reports still points at the author's file.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..spec import parse_spec, SpecIssue, ParsedSpec
from .objects import parse_objects, object_problems, SceneObject
from .diagram import Diagram, DiagramError, KEYS as DIAGRAM_KEYS, parse_diagram

_MARKER = re.compile(r"^(\s*autocontent\s*:\s*['\"]?)(?:reel|reels|video)\b", re.I)
_FENCE = re.compile(r"^\s*(```|~~~)")

HEADER_KEYS = {
    "aspect": "aspect", "ratio": "aspect", "fps": "fps", "quality": "quality", "voice": "voice", "voiceover": "voice",
    "speed": "speed", "captions": "captions", "caption_style": "captions", "subtitles": "captions",
    "music": "music", "transition": "transition", "end_hold": "end_hold",
    "format": "format", "size": "format",
    "cold_open": "cold_open", "coldopen": "cold_open", "hero_open": "cold_open",
    "pace": "pace", "pauses": "pauses", "breaths": "pauses", "polish": "polish", "sound": "polish",
    "loudness": "loudness", "lufs": "loudness", "pronounce": "pronounce", "say_as": "pronounce",
    "pronunciation": "pronounce",
}
SCENE_KEYS = {
    "say": "say", "vo": "say", "voiceover": "say", "narration": "say", "speak": "say",
    "show": "show", "cue": "show", "cues": "show",
    "motion": "motion", "animation": "motion", "animate": "motion",
    "duration": "duration", "hold": "duration", "pause": "pause",
    "speed": "speed", "tone": "tone", "delivery": "tone", "voice": "voice",
    "objects": "objects", "overlay": "objects", "overlays": "objects", "obj": "objects",
    "diagram": "diagram", "figure": "diagram",
}
# How a slide is delivered: a speed multiplier on top of the reel's own speed.
TONES = {"hook": 1.08, "fast": 1.1, "excited": 1.1, "energetic": 1.08, "normal": 1.0, "neutral": 1.0,
         "calm": 0.95, "warm": 0.96, "emphasis": 0.92, "slow": 0.9, "serious": 0.93, "dramatic": 0.88}
# `pace: auto` (default) gives these slide types a tone when the script doesn't name one.
AUTO_TONE_BY_TYPE = {"stat": "emphasis", "quote": "calm", "cta": "emphasis"}
PAUSE_STYLES = {"tight": 0.7, "short": 0.7, "natural": 1.0, "normal": 1.0, "relaxed": 1.35, "long": 1.35, "slow": 1.35}
QUALITIES = ("standard", "high", "max")      # the encode: quick, slow and finer, slowest and finest
POLISH_STYLES = ("natural", "warm", "bright", "clean", "off")
# Inline marks inside `say:` that are not spoken: [pause], [pause 0.6], [breath], [beat]
PAUSE_MARK = re.compile(r"\[\s*(pause|breath|beat)(?:\s+(\d+(?:\.\d+)?)\s*s?)?\s*\]", re.I)


def strip_marks(text: str) -> str:
    return re.sub(r"\s+", " ", PAUSE_MARK.sub(" ", text)).strip()


def parse_pronounce(value: str) -> Dict[str, str]:
    """`NXP = N X P; lakh = laakh` → {"NXP": "N X P", "lakh": "laakh"}."""
    out: Dict[str, str] = {}
    for part in re.split(r"\s*[;,]\s*", value or ""):
        m = re.match(r"^\s*(.+?)\s*(?:=|->|→|:)\s*(.+?)\s*$", part)
        if m:
            out[m.group(1)] = m.group(2)
    return out
MOTIONS = ("rise", "pop", "stagger", "wipe", "kenburns", "fade")
MOTION_ALIASES = {"slide": "rise", "up": "rise", "rise": "rise", "pop": "pop", "zoom": "pop", "bounce": "pop",
                  "stagger": "stagger", "cascade": "stagger", "one-by-one": "stagger", "sequence": "stagger",
                  "wipe": "wipe", "reveal": "wipe", "kenburns": "kenburns", "ken-burns": "kenburns", "pan": "kenburns",
                  "drift": "kenburns", "fade": "fade", "none": "fade", "plain": "fade"}
# What a slide does when the author doesn't say
DEFAULT_MOTION = {"cover": "rise", "point": "stagger", "list": "stagger", "stat": "pop", "quote": "rise",
                  "table": "wipe", "chart": "wipe", "image": "kenburns", "statement": "rise", "compare": "wipe",
                  "cta": "pop"}
VOICE_MINE = ("mine", "my", "my own", "own", "upload", "recording", "recorded", "me", "self")
DEFAULT_VOICE = "af_heart"
WORDS_PER_SECOND = 2.55      # a calm spoken pace, for the length estimate before any voice exists
MAX_SECONDS = 90.0           # a reel longer than this loses most viewers
LONG_SCENE_WORDS = 55
# How much text one reel slide can carry and still be read on a phone. A reel sets type far
# larger than a feed slide, so the room runs out much sooner; these are the numbers the fitter
# can still honour without shrinking the slide back to feed size.
SLIDE_WORDS_ROOMY = 26       # over this, the slide is set smaller than it should be
SLIDE_WORDS_FULL = 40        # over this, something has to go
BULLETS_FULL = 4
HEADLINE_WORDS = 9
KICKER_CHARS = 28
DIAGRAM_SLIDE_WORDS = 16      # text a slide may carry beside a diagram


def _slide_text(slide: Dict[str, Any]) -> Tuple[List[str], int]:
    """Everything that is set on the slide itself: the pieces of text, and the total word count."""
    parts: List[str] = []
    for key in ("headline", "body", "number", "subtext", "text", "quote", "author", "kicker", "pill"):
        v = slide.get(key)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
    for key in ("bullets", "items", "numbered", "left", "right", "points"):
        v = slide.get(key)
        if isinstance(v, list):
            parts += [str(x) for x in v if str(x).strip()]
        elif isinstance(v, dict):
            parts += [str(x) for x in v.values() if str(x).strip()]
    return parts, sum(len(re.findall(r"\S+", p)) for p in parts)


def expected_pieces(slide: Dict[str, Any], style: str = "grid_pill") -> Optional[int]:
    """How many pieces (things that arrive one after another) the slide will be cut into, the way
    layers.GROUPS cuts it, or None when it can't be told before drawing. Used to check `show:`."""
    t = slide.get("type", "")
    grid = style != "beige_grain"
    has = lambda k: bool(str(slide.get(k) or "").strip())
    if t == "cover":
        if not grid:
            return 1
        pill = str(slide.get("pill") or "").strip().lower()
        head = str(slide.get("headline") or "")
        if pill in ("none", "no", "off", "-") or ("==" in head and not pill) or len(head.split()) < 2:
            return 1
        return 2
    if t == "point":
        return 1 + has("body") + len(slide.get("bullets") or [])
    if t == "list":
        return 1 + len(slide.get("items") or [])
    if t == "stat":
        return has("headline") + 1 + (1 if grid else has("body"))
    if t == "quote":
        return 1 + has("author")
    if t == "statement":
        return 1 + has("body")
    if t == "compare":
        return 3
    if t in ("chart", "table"):
        return 2
    if t == "image":
        return 2 + (has("body") or bool(slide.get("bullets")))
    if t == "cta":
        return 3 if grid else None
    return None


def pill_fits(headline: str, pill: str) -> bool:
    """True when a cover's `pill:` is how its headline ends, which is the only way the renderer uses it
    (otherwise the headline's last word goes in the pill instead). Mirrors renderer._pill_split."""
    strip = lambda s: re.sub(r"[\s?!.,:;…”’\"')]+$", "", re.sub(r"==|\*\*", "", s or "")).strip().lower()
    head, want = strip(headline), strip(pill)
    return bool(want) and head.endswith(want) and len(want) < len(head)


@dataclass
class Scene:
    n: int                              # 1-based, the slide it belongs to
    slide: Dict[str, Any]
    line: int = 0
    say: str = ""                       # what is spoken and captioned (inline marks removed)
    say_raw: str = ""                   # as written, with any [pause] marks
    speed: Optional[float] = None       # this slide's own speed multiplier (`speed:` or `tone:`)
    tone: str = ""
    voice: str = ""                     # this slide's own voice, when it differs from the reel's
    show: List[str] = field(default_factory=list)   # cue phrases, one per thing that appears, in order
    motion: str = "rise"
    motion_given: bool = False      # the author named it, so every piece of the slide uses it
    duration: Optional[float] = None    # seconds to hold a scene that has no narration
    pause: float = 0.0                  # extra silence after the narration, seconds
    objects: List[SceneObject] = field(default_factory=list)   # overlay objects on this slide
    diagram: Optional[Diagram] = None   # the explainer diagram drawn on this slide (see diagram.py)

    @property
    def words(self) -> List[str]:
        return self.say.split()


@dataclass
class ReelScript:
    meta: Dict[str, Any] = field(default_factory=dict)
    scenes: List[Scene] = field(default_factory=list)
    caption: Optional[str] = None
    hashtags: List[str] = field(default_factory=list)
    issues: List[SpecIssue] = field(default_factory=list)
    spec: Optional[ParsedSpec] = None
    post_text: str = ""                 # the script as a plain post spec (what the slide renderer reads)
    choice: Optional[Tuple[str, str]] = None   # the closing slide's `choice: A | B`, for the pinned first comment

    @property
    def errors(self) -> List[SpecIssue]:
        return [i for i in self.issues if i.severity == "ERROR"]

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def uses_own_voice(self) -> bool:
        return str(self.meta.get("voice", "")).strip().lower() in VOICE_MINE

    @property
    def narration(self) -> str:
        return " ".join(s.say for s in self.scenes if s.say)

    def estimate_seconds(self) -> float:
        speed = float(self.meta.get("speed") or 1.0)
        total = 0.0
        for s in self.scenes:
            n = len(s.words)
            total += (n / (WORDS_PER_SECOND * speed * (s.speed or 1.0)) if n else (s.duration or 2.5)) + 0.45 + s.pause
        total += float(self.meta.get("end_hold") or 1.2) + (COLD_OPEN_SECONDS if cold_open_text(self) else 0.0)
        return round(total, 1)


def is_reel_text(text: str) -> bool:
    """True when the text opens with front matter containing `autocontent: reel`."""
    head = text.lstrip("﻿").replace("\r\n", "\n").split("\n")[:60]
    if not head or head[0].strip() != "---":
        return False
    for line in head[1:]:
        if line.strip() in ("---", "..."):
            return False
        if _MARKER.match(line):
            return True
    return False


def _clean(value: str) -> str:
    value = re.sub(r"\s+#\s.*$", "", value)          # trailing "# comment"
    return re.sub(r"\s+", " ", value.replace("**", "").replace("==", "")).strip(" \t\"“”")


def _split(text: str, scene_keys: Optional[Dict[str, str]] = None, header_too: bool = True
           ) -> Tuple[Dict[str, Tuple[str, int]], Dict[int, Dict[str, Tuple[str, int]]], str]:
    """Lift the reel-only lines out. Returns (header values, per-section values keyed by the line
    of the section's `##` heading, the remaining text as a post spec).

    A post spec uses the same reader for just its explainer lines (`objects:` and `diagram:`):
    spec/overlays.py passes those keys and header_too=False, which leaves the header alone."""
    scene_keys = SCENE_KEYS if scene_keys is None else scene_keys
    lines = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = list(lines)
    header: Dict[str, Tuple[str, int]] = {}
    sections: Dict[int, Dict[str, Tuple[str, int]]] = {}
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    in_front = header_too and i < len(lines) and lines[i].strip() == "---"
    in_fence = False
    section_line = 0
    current: Optional[Tuple[Dict[str, Tuple[str, int]], str]] = None   # where an indented continuation goes
    for idx, raw in enumerate(lines):
        ln = idx + 1
        if in_front and idx > i:
            if raw.strip() in ("---", "..."):
                in_front = False
                current = None
                continue
            m = re.match(r"^\s*([A-Za-z_]+)\s*:\s*(.*)$", raw)
            if m and m.group(1).lower() in HEADER_KEYS:
                key = HEADER_KEYS[m.group(1).lower()]
                header[key] = (_clean(m.group(2)), ln)
                out[idx] = ""
                current = (header, key)
            elif _MARKER.match(raw):
                out[idx] = _MARKER.sub(r"\1post", raw)
                current = None
            continue
        if _FENCE.match(raw):
            in_fence = not in_fence
        if in_fence:
            continue
        if re.match(r"^\s{0,3}#{1,6}\s+\S", raw):
            section_line = ln
            sections.setdefault(section_line, {})
            current = None
            continue
        m = re.match(r"^\s*([A-Za-z_]+)\s*:\s*(.*)$", raw)
        if m and m.group(1).lower() in scene_keys and section_line:
            key = scene_keys[m.group(1).lower()]
            sections[section_line][key] = (m.group(2).strip(), ln)
            out[idx] = ""
            current = (sections[section_line], key)
            continue
        in_diagram = bool(current) and current[1] == "diagram" and bool(re.match(r"^\s*([A-Za-z_][\w-]*)\s*:", raw)) and (
            raw[:1] in (" ", "\t") or re.match(r"^\s*([A-Za-z_][\w-]*)", raw).group(1).lower().replace("-", "_") in DIAGRAM_KEYS)
        if current and (raw[:2].strip() == "" or in_diagram) and raw.strip() and not raw.lstrip().startswith(("-", "|", "*")) \
                and not re.match(r"^\s*\d+[.)]", raw):
            store, key = current
            # a diagram is a block of `key: value` lines, so its lines stay lines
            store[key] = (store[key][0] + ("\n" if key == "diagram" else " ") + raw.strip(), store[key][1])
            out[idx] = ""
            continue
        if raw.strip():
            current = None
    return header, sections, "\n".join(out)


def _number(value: str, lo: float, hi: float, name: str, line: int, issues: List[SpecIssue], default: Optional[float]) -> Optional[float]:
    try:
        n = float(re.sub(r"[^0-9.]", "", value) or "x")
    except ValueError:
        issues.append(SpecIssue("WARN", f"{name.upper()}_UNREADABLE", f"'{value}' is not a number for {name}; ignored.", line=line))
        return default
    if not lo <= n <= hi:
        issues.append(SpecIssue("WARN", f"{name.upper()}_RANGE", f"{name} {n:g} is outside {lo:g} to {hi:g}; using {min(max(n, lo), hi):g}.", line=line))
    return min(max(n, lo), hi)


_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+\S")
_RECAP_HEAD = re.compile(r"^(\s{0,3}#{1,6}\s+)recap\s*$", re.I)
_CTA_HEAD = re.compile(r"^\s{0,3}#{1,6}\s+cta\s*$", re.I)
_BULLET = re.compile(r"^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$")
_FIELD = re.compile(r"^\s*([A-Za-z_]+)\s*:\s*(.*)$")


def expand_sugar(text: str) -> Tuple[str, List[int], List[Tuple[str, str]]]:
    """Two reel-only shortcuts, turned into plain post slides before the spec is read.

    `## recap` (rows of `- number | label`) becomes a dark `list` slide with a SAVE THIS label: the card people screenshot.
    `choice: Debt | Growth` on the `cta` becomes its `subtext:` (COMMENT DEBT OR GROWTH).
    Returns (text, the new-text line numbers of lines it inserted, the choices found). Line numbers in issues are
    mapped back with `back_line`."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: List[str] = []
    inserted: List[int] = []
    choices: List[Tuple[str, str]] = []
    i = 0
    fence = False
    while i < len(lines):
        raw = lines[i]
        if re.match(r"^\s*(```|~~~)", raw):
            fence = not fence
        end = next((j for j in range(i + 1, len(lines)) if _HEADING.match(lines[j])), len(lines))
        if not fence and _RECAP_HEAD.match(raw):
            body = lines[i + 1:end]
            have = {m.group(1).lower() for l in body for m in [_FIELD.match(l)] if m}
            out.append(_RECAP_HEAD.sub(r"\1list", raw))
            for key, val in (("headline", "3 numbers to keep"), ("kicker", "SAVE THIS"), ("theme", "dark")):
                if key not in have:
                    out.append(f"{key}: {val}")
                    inserted.append(len(out))
            n = 0
            for l in body:
                m = _BULLET.match(l)
                if m:
                    n += 1
                    out.append(f"{n}. " + re.sub(r"\s*\|\s*", " — ", m.group(1), count=1))
                else:
                    out.append(l)
            i = end
            continue
        if not fence and _CTA_HEAD.match(raw):
            body = lines[i + 1:end]
            have = {m.group(1).lower() for l in body for m in [_FIELD.match(l)] if m}
            out.append(raw)
            for l in body:
                m = _FIELD.match(l)
                if m and m.group(1).lower() in ("choice", "choices"):
                    parts = [w.strip() for w in re.split(r"\s*(?:\||/|\bor\b)\s*", m.group(2)) if w.strip()]
                    if len(parts) == 2:
                        choices.append((parts[0], parts[1]))
                        out.append("" if "subtext" in have else f"subtext: COMMENT {parts[0].upper()} OR {parts[1].upper()}")
                    else:
                        out.append(l)      # left alone; the checker says what is wrong
                else:
                    out.append(l)
            i = end
            continue
        out.append(raw)
        i += 1
    return "\n".join(out), inserted, choices


def first_comment(reel: "ReelScript") -> str:
    """A ready first comment for the creator to pin, so the thread is never empty. Built only from the script:
    the choice on the closing slide, else a plain invitation."""
    if reel.choice:
        a, b = reel.choice
        return f"My pick: {a}. What's yours, {a} or {b}? 👇"
    return "What's your take? Tell me below 👇 And save this one for later."


def parse_reel(text: str, base_dir: Optional[Path] = None) -> ReelScript:
    """Parse a reel script. Never raises for bad content: problems come back as issues with line numbers."""
    reel = ReelScript()
    inserted: List[int] = []
    if is_reel_text(text):
        text, inserted, choices = expand_sugar(text)
        reel.choice = choices[-1] if choices else None
    header, sections, post_text = _split(text)
    if not is_reel_text(text):
        reel.issues.append(SpecIssue(
            "ERROR", "NOT_A_REEL", "This file does not start with the reel header.", line=1,
            hint="Start the file with three lines:  ---  /  autocontent: reel  /  ---  (see REEL_FORMAT.md)."))
        return reel
    spec = parse_spec(post_text, base_dir=base_dir, require_marker=True)
    reel.spec = spec
    reel.issues = list(spec.issues)
    reel.caption, reel.hashtags = spec.caption, spec.hashtags
    meta = dict(spec.meta)
    meta["format"] = "reel"
    for key, (value, line) in header.items():
        if key == "fps":
            meta[key] = int(_number(value, 24, 60, "fps", line, reel.issues, 30) or 30)
        elif key == "quality":
            v = value.strip().lower()
            if v not in QUALITIES:
                reel.issues.append(SpecIssue("WARN", "QUALITY_UNKNOWN", f"Unknown quality '{value}'; using standard.", line=line,
                                             hint=f"Use one of: {', '.join(QUALITIES)}."))
                v = "standard"
            meta[key] = v
        elif key == "speed":
            meta[key] = _number(value, 0.6, 1.4, "speed", line, reel.issues, 1.0)
        elif key == "end_hold":
            meta[key] = _number(value, 0.0, 6.0, "end_hold", line, reel.issues, 1.2)
        elif key == "captions":
            v = value.lower()
            meta[key] = "off" if v in ("off", "no", "none", "false", "0") else "on"
        elif key == "aspect":
            if value.replace(" ", "").lower() not in ("9:16", "9x16", "1080x1920", "reel", "vertical", ""):
                reel.issues.append(SpecIssue("WARN", "ASPECT_FIXED", f"A reel is always 9:16 (1080x1920); '{value}' is ignored.", line=header[key][1]))
        elif key == "format":
            reel.issues.append(SpecIssue("WARN", "FORMAT_FIXED", f"A reel is always 9:16 (1080x1920); 'format: {value}' is ignored.", line=header[key][1]))
        elif key == "music":
            reel.issues.append(SpecIssue("WARN", "MUSIC_IGNORED", "Music isn't added by the Pi; add trending audio in Instagram. The line is ignored.", line=header[key][1]))
        elif key == "pace":
            v = value.lower()
            meta[key] = "steady" if v in ("steady", "flat", "off", "even", "none") else "auto"
        elif key == "pauses":
            v = value.lower()
            if v in PAUSE_STYLES:
                meta[key] = PAUSE_STYLES[v]
            else:
                meta[key] = _number(value, 0.3, 2.5, "pauses", line, reel.issues, 1.0)
        elif key == "polish":
            v = value.lower()
            if v in ("no", "none", "false", "0", "raw"):
                v = "off"
            if v not in POLISH_STYLES:
                reel.issues.append(SpecIssue("WARN", "POLISH_UNKNOWN", f"Unknown polish '{value}'; using natural.", line=line,
                                             hint=f"Use one of: {', '.join(POLISH_STYLES)}."))
                v = "natural"
            meta[key] = v
        elif key == "loudness":
            meta[key] = -abs(_number(value, 9, 23, "loudness", line, reel.issues, 14) or 14)
        elif key == "pronounce":
            meta[key] = parse_pronounce(value)
        elif key == "transition":
            meta[key] = value.lower() or "fade"
        elif key == "cold_open":
            v = value.strip().strip("\"'")
            meta[key] = "off" if v.lower() in ("", "off", "no", "none", "false", "0") else \
                ("auto" if v.lower() in ("on", "yes", "true", "auto", "1") else v[:24])
        else:
            meta[key] = value
    meta.setdefault("fps", 30)
    meta.setdefault("quality", "standard")
    meta.setdefault("captions", "on")
    meta.setdefault("voice", DEFAULT_VOICE)
    meta.setdefault("speed", 1.0)
    meta.setdefault("end_hold", 1.2)
    meta.setdefault("cold_open", "off")
    meta.setdefault("pace", "auto")
    meta.setdefault("pauses", 1.0)
    meta.setdefault("polish", "natural")
    meta.setdefault("loudness", -14.0)
    meta.setdefault("pronounce", {})
    meta["voice"] = str(meta["voice"]).strip() or DEFAULT_VOICE
    reel.meta = meta

    for i, slide in enumerate(spec.slides):
        line = spec.slide_lines[i] if i < len(spec.slide_lines) else 0
        sec = sections.get(line, {})
        scene = Scene(n=i + 1, slide=slide, line=line)
        if "say" in sec:
            scene.say_raw = _clean(sec["say"][0])
            scene.say = strip_marks(scene.say_raw)
        if "voice" in sec:
            scene.voice = _clean(sec["voice"][0])
        if "tone" in sec:
            t = sec["tone"][0].strip().lower()
            if t in TONES:
                scene.tone, scene.speed = t, TONES[t]
            else:
                reel.issues.append(SpecIssue("WARN", "TONE_UNKNOWN", f"Unknown tone '{t}' on slide {i + 1}; ignored.",
                                             slide=i + 1, line=sec["tone"][1], hint=f"Use one of: {', '.join(TONES)}."))
        if "speed" in sec:
            scene.speed = _number(sec["speed"][0], 0.7, 1.3, "speed", sec["speed"][1], reel.issues, 1.0)
        if scene.speed is None and meta["pace"] == "auto" and scene.say:
            auto = "hook" if i == 0 else AUTO_TONE_BY_TYPE.get(slide.get("type", ""))
            if auto:
                scene.tone, scene.speed = auto, TONES[auto]
        if "show" in sec:
            scene.show = [p.strip() for p in re.split(r"\s*(?:\||;|->|→)\s*", _clean(sec["show"][0])) if p.strip()]
        raw_motion = (sec.get("motion", ("", 0))[0]).strip().lower()
        motion = MOTION_ALIASES.get(raw_motion)
        if raw_motion and not motion:
            reel.issues.append(SpecIssue("WARN", "MOTION_UNKNOWN", f"Unknown motion '{raw_motion}'; using the slide's usual one.",
                                         slide=i + 1, line=sec["motion"][1], hint=f"Use one of: {', '.join(MOTIONS)}."))
        scene.motion = motion or DEFAULT_MOTION.get(slide.get("type", "point"), "rise")
        scene.motion_given = bool(motion)
        if "duration" in sec:
            scene.duration = _number(sec["duration"][0], 1.0, 30.0, "duration", sec["duration"][1], reel.issues, None)
        if "pause" in sec:
            scene.pause = _number(sec["pause"][0], 0.0, 5.0, "pause", sec["pause"][1], reel.issues, 0.0) or 0.0
        if "objects" in sec:
            scene.objects = parse_objects(sec["objects"][0])
            for problem in object_problems(sec["objects"][0]):
                reel.issues.append(SpecIssue("WARN", "OBJECT_IGNORED", f"Slide {i + 1}'s objects: {problem}.",
                                             slide=i + 1, line=sec["objects"][1],
                                             hint="Write each as `name @ x,y size colour animation`, with a built-in shape name."))
        if "diagram" in sec:
            try:
                scene.diagram = parse_diagram(sec["diagram"][0])
                if not scene.diagram.placed:         # it will be fitted to the room under the slide's text: check it fits there too
                    parse_diagram(sec["diagram"][0], box=(100, 0, 880, 380))
            except DiagramError as e:
                reel.issues.append(SpecIssue("ERROR", "DIAGRAM_BAD", f"Slide {i + 1}'s diagram: {e}",
                                             slide=i + 1, line=sec["diagram"][1], hint=e.hint or None))
        reel.scenes.append(scene)
    reel.post_text = post_text
    reel.issues += check_reel(reel)
    if inserted:
        back = lambda n: n - sum(1 for k in inserted if k < n)
        for issue in reel.issues:
            if issue.line:
                issue.line = back(issue.line)
        for sc in reel.scenes:
            if sc.line:
                sc.line = back(sc.line)
    return reel

HOOK_WORDS_MAX = 12          # a spoken hook longer than this loses the scroll
HOOK_WEAK_BELOW = 50         # under this score the cover's narration gets a warning
_CAPS = re.compile(r"\b[A-Z][a-zA-Z]+\b")
_OPENERS = {"a", "an", "the", "this", "that", "these", "those", "it", "its", "i", "we", "you", "your", "my", "our", "their",
            "he", "she", "they", "why", "what", "how", "when", "where", "who", "which", "can", "could", "would", "should",
            "will", "do", "does", "did", "is", "are", "was", "were", "have", "has", "had", "if", "so", "but", "and", "or",
            "nine", "ten", "one", "two", "three", "four", "five", "six", "seven", "eight", "every", "most", "many", "some",
            "no", "not", "just", "here", "there", "now", "then", "once", "still", "same", "more", "less", "last", "next"}
_SAVE_ASK = re.compile(r"\b(save|bookmark|share|send (this|it)|tag (a|someone)|screenshot|keep this|follow)\b", re.I)


def hook_score(say: str) -> Tuple[int, Dict[str, bool]]:
    """0 to 100 for a cover's narration: a question, a number, a named company or person, a short line.
    These are the traits behind the best reach on the page (named company + a rupee figure + a question)."""
    text = (say or "").strip()
    words = text.split()
    parts = {
        "question": "?" in text,
        "number": bool(re.search(r"\d|₹|%|\$", text)),
        "entity": any(w.lower() not in _OPENERS for w in _CAPS.findall(text)) or bool(re.search(r"\b[A-Z]{2,}\b", text)),
        "short": 0 < len(words) <= HOOK_WORDS_MAX,
    }
    score = (35 if parts["question"] else 0) + (25 if parts["number"] else 0) + \
            (25 if parts["entity"] else 0) + (15 if parts["short"] else 0)
    return score, parts


CHOICE_MAX_CHARS = 26       # COMMENT A OR B must fit beside the pill
COLD_OPEN_SECONDS = 0.8      # the hero card before the cover; the whole reel is pushed back by this much


def cold_open_text(reel: "ReelScript") -> str:
    """What the cold-open card says: the header's own text (`cold_open: ₹30,188 crore`), else the first big
    number in the reel, else the cover's pill. Empty when the reel has none or the cold open is off."""
    mode = str(reel.meta.get("cold_open") or "off")
    if mode == "off":
        return ""
    if mode != "auto":
        return mode
    strip = lambda t: re.sub(r"\*\*|==", "", str(t or "")).strip()
    for sc in reel.scenes:
        if sc.slide.get("type") == "stat" and strip(sc.slide.get("number")):
            return strip(sc.slide.get("number"))[:24]
    for sc in reel.scenes:
        if sc.slide.get("type") == "cover":
            pill = strip(sc.slide.get("pill"))
            if pill and pill.lower() not in ("none", "no", "off", "-"):
                return pill[:24]
    return ""


def check_reel(reel: ReelScript) -> List[SpecIssue]:
    """Checks that only matter for video: is there something to say, is it too long, can the cues be found."""
    issues: List[SpecIssue] = []
    if not reel.scenes:
        return issues
    if not any(s.say for s in reel.scenes):
        issues.append(SpecIssue("ERROR", "NO_NARRATION", "No slide has a `say:` line, so there is nothing to speak.",
                                hint="Add `say: <what the voice says over this slide>` to each slide."))
    for s in reel.scenes:
        slide_type = s.slide.get("type", "slide")
        if not s.say and not s.duration:
            issues.append(SpecIssue("WARN", "SCENE_SILENT", f"Slide {s.n} ({slide_type}) has no `say:` line; it is held for 3 seconds.",
                                    slide=s.n, line=s.line, hint="Add `say:` or set `duration: <seconds>`."))
        if len(s.words) > LONG_SCENE_WORDS:
            issues.append(SpecIssue("WARN", "SCENE_LONG", f"Slide {s.n} has {len(s.words)} spoken words, over twenty seconds on one screen.",
                                    slide=s.n, line=s.line, hint="Split it into two slides."))
        if s.say and re.search(r"https?://|www\.|@\w{3,}", s.say):
            issues.append(SpecIssue("WARN", "SAY_HAS_LINK", f"Slide {s.n}'s narration has a link or handle; a voice reads it letter by letter.",
                                    slide=s.n, line=s.line, hint="Say it in words and show it on the slide."))
        if s.say and re.search(r"[#*_`<>{}\[\]|]", s.say):
            issues.append(SpecIssue("WARN", "SAY_SYMBOLS", f"Slide {s.n}'s narration has symbols that a voice may read aloud or skip.",
                                    slide=s.n, line=s.line, hint="Write it the way it is spoken."))
        texts, n_words = _slide_text(s.slide)
        bullets = [k for k in ("bullets", "items", "numbered", "points") if isinstance(s.slide.get(k), list)]
        n_bullets = max([len(s.slide[k]) for k in bullets] or [0])
        if n_words > SLIDE_WORDS_FULL or n_bullets > BULLETS_FULL:
            issues.append(SpecIssue("ERROR", "SLIDE_TOO_FULL",
                                    f"Slide {s.n} has {n_words} words of text{f' in {n_bullets} bullets' if n_bullets else ''}; "
                                    f"a reel screen holds about {SLIDE_WORDS_ROOMY}.",
                                    slide=s.n, line=s.line,
                                    hint="Split it into two slides, or cut it to three short bullets. The voice carries the detail; the slide carries the point."))
        elif n_words > SLIDE_WORDS_ROOMY:
            issues.append(SpecIssue("WARN", "SLIDE_FULL",
                                    f"Slide {s.n} has {n_words} words of text; over about {SLIDE_WORDS_ROOMY} the type is set smaller to fit.",
                                    slide=s.n, line=s.line, hint="Shorten a bullet or move a detail into `say:`."))
        head = str(s.slide.get("headline") or "")
        if len(head.split()) > HEADLINE_WORDS:
            issues.append(SpecIssue("WARN", "HEADLINE_LONG",
                                    f"Slide {s.n}'s headline is {len(head.split())} words; under {HEADLINE_WORDS} reads at a glance.",
                                    slide=s.n, line=s.line, hint="Say the rest in `say:`."))
        kicker = str(s.slide.get("kicker") or "")
        if len(kicker) > KICKER_CHARS:
            issues.append(SpecIssue("WARN", "KICKER_LONG",
                                    f"Slide {s.n}'s kicker is {len(kicker)} characters; it is a label, not a sentence.",
                                    slide=s.n, line=s.line, hint=f"Keep it under {KICKER_CHARS} characters, or drop it."))
        style = str(reel.meta.get("style") or "grid_pill")
        if slide_type == "cover" and style != "beige_grain":
            pill = str(s.slide.get("pill") or "").strip()
            if pill and pill.lower() not in ("none", "no", "off", "-") and not pill_fits(str(s.slide.get("headline") or ""), pill):
                issues.append(SpecIssue("WARN", "PILL_NOT_IN_HEADLINE",
                                        f"Slide {s.n}'s pill '{pill}' is not how its headline ends, so it is not used: "
                                        "the headline's last word goes in the pill instead.",
                                        slide=s.n, line=s.line,
                                        hint="Make `pill:` the last 1 to 3 words of the headline, or write `pill: none`."))
        pieces = expected_pieces(s.slide, style)
        if s.show and pieces:
            if len(s.show) > pieces:
                issues.append(SpecIssue("WARN", "CUES_TOO_MANY",
                                        f"Slide {s.n} has {len(s.show)} cues in `show:` but only {pieces} pieces; the extra cues are not used.",
                                        slide=s.n, line=s.line,
                                        hint=f"Write {pieces - 1} cue{'s' if pieces != 2 else ''}: one for each piece after the first."))
            elif len(s.show) < pieces - 1:
                issues.append(SpecIssue("WARN", "CUES_SHIFTED",
                                        f"Slide {s.n} has {pieces} pieces but {len(s.show)} cue{'s' if len(s.show) != 1 else ''} in `show:`, "
                                        "so the first cue is spent on the first piece (which always opens the slide) and the rest land one piece early.",
                                        slide=s.n, line=s.line,
                                        hint=f"Write exactly {pieces - 1} cue{'s' if pieces != 2 else ''}: one for each piece after the first."))
        if s.show and s.say:
            hay = _norm(s.say)
            for cue in s.show:
                if _norm(cue) and _norm(cue) not in hay:
                    issues.append(SpecIssue("WARN", "CUE_NOT_FOUND", f"The cue '{cue}' on slide {s.n} isn't in its narration; it will be spread evenly instead.",
                                            slide=s.n, line=s.line, hint="Cue words must be copied from the `say:` line."))
                    break
        if s.diagram is not None:
            hay = _norm(s.say)
            for cue in s.diagram.cues():
                if not _norm(cue) or _norm(cue) not in hay:
                    issues.append(SpecIssue("WARN", "DIAGRAM_CUE_NOT_FOUND",
                                            f"The diagram cue '{cue}' on slide {s.n} isn't in its narration; that change will be spread evenly instead.",
                                            slide=s.n, line=s.line, hint="Cue words must be copied from the `say:` line."))
            if n_words > DIAGRAM_SLIDE_WORDS:
                issues.append(SpecIssue("WARN", "DIAGRAM_CROWDED",
                                        f"Slide {s.n} has {n_words} words of text next to a diagram; the diagram needs the room.",
                                        slide=s.n, line=s.line, hint="Keep a diagram slide to a short headline."))

    if reel.choice and len(f"COMMENT {reel.choice[0]} OR {reel.choice[1]}") > CHOICE_MAX_CHARS:
        cta = next((s for s in reversed(reel.scenes) if s.slide.get("type") == "cta"), None)
        issues.append(SpecIssue("ERROR", "CHOICE_TOO_LONG",
                                f"`choice: {reel.choice[0]} | {reel.choice[1]}` is too long to sit beside the pill (COMMENT A OR B is {CHOICE_MAX_CHARS} characters at most).",
                                slide=cta.n if cta else None, line=cta.line if cta else None,
                                hint="Use two short words, such as `choice: Debt | Growth`."))
    if reel.meta.get("cold_open", "off") != "off" and not cold_open_text(reel):
        issues.append(SpecIssue("WARN", "COLD_OPEN_NONE", "`cold_open:` is on but the reel has no big number or cover pill to open on, so it is skipped.",
                                hint="Add a `stat` slide, or write the text: `cold_open: ₹30,188 crore`."))
    covers = [s for s in reel.scenes if s.slide.get("type") == "cover" and s.say]
    if covers:
        c = covers[0]
        score, parts = hook_score(c.say)
        if len(c.words) > HOOK_WORDS_MAX:
            issues.append(SpecIssue("WARN", "HOOK_LONG", f"The hook is {len(c.words)} words; over {HOOK_WORDS_MAX} loses the scroll.",
                                    slide=c.n, line=c.line, hint=f"Say the hook in {HOOK_WORDS_MAX} words or fewer, then explain on the next slide."))
        if score < HOOK_WEAK_BELOW:
            missing = [label for key, label in (("question", "a question"), ("number", "a number or rupee figure"),
                                                ("entity", "a named company or person")) if not parts[key]]
            issues.append(SpecIssue("WARN", "HOOK_WEAK", f"Hook score {score}/100. It is missing {', '.join(missing)}.",
                                    slide=c.n, line=c.line,
                                    hint="Hooks with a named company, a concrete number and a question reach 2 to 3 times further."))
    ctas = [s for s in reel.scenes if s.slide.get("type") == "cta"]
    if ctas:
        c = ctas[-1]
        spoken = c.say or ""
        shown = " ".join(str(c.slide.get(k) or "") for k in ("headline", "body", "subtext", "share_line"))
        if "?" not in spoken:
            issues.append(SpecIssue("WARN", "CTA_NO_QUESTION", "The closing narration asks no question, so nobody has a reason to comment.",
                                    slide=c.n, line=c.line, hint="End on a one-word question, such as 'Debt or growth?'."))
        if not _SAVE_ASK.search(spoken + " " + shown):
            issues.append(SpecIssue("WARN", "CTA_NO_SAVE", "The closing asks for no save or share.",
                                    slide=c.n, line=c.line, hint="Add a reason to save, such as 'Save this for your next pitch'."))
    seconds = reel.estimate_seconds()
    if seconds > MAX_SECONDS:
        issues.append(SpecIssue("WARN", "REEL_LONG", f"About {seconds:.0f} seconds; reels over {MAX_SECONDS:.0f} seconds lose most viewers.",
                                hint="Cut a slide or tighten the narration."))
    elif seconds < 8:
        issues.append(SpecIssue("WARN", "REEL_SHORT", f"About {seconds:.0f} seconds; very short for a reel.", hint="Add a slide or a sentence."))
    return issues


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9₹%$ ]+", "", text.lower().replace("-", " ")).strip()


def words_of(text: str) -> List[str]:
    return re.findall(r"\S+", text)
