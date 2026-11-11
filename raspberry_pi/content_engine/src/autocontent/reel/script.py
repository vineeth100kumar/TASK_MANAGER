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

_MARKER = re.compile(r"^(\s*autocontent\s*:\s*['\"]?)(?:reel|reels|video)\b", re.I)
_FENCE = re.compile(r"^\s*(```|~~~)")

HEADER_KEYS = {
    "aspect": "aspect", "ratio": "aspect", "fps": "fps", "voice": "voice", "voiceover": "voice",
    "speed": "speed", "captions": "captions", "caption_style": "captions", "subtitles": "captions",
    "music": "music", "transition": "transition", "end_hold": "end_hold",
    "format": "format", "size": "format",
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
}
# How a slide is delivered: a speed multiplier on top of the reel's own speed.
TONES = {"hook": 1.08, "fast": 1.1, "excited": 1.1, "energetic": 1.08, "normal": 1.0, "neutral": 1.0,
         "calm": 0.95, "warm": 0.96, "emphasis": 0.92, "slow": 0.9, "serious": 0.93, "dramatic": 0.88}
# `pace: auto` (default) gives these slide types a tone when the script doesn't name one.
AUTO_TONE_BY_TYPE = {"stat": "emphasis", "quote": "calm", "cta": "emphasis"}
PAUSE_STYLES = {"tight": 0.7, "short": 0.7, "natural": 1.0, "normal": 1.0, "relaxed": 1.35, "long": 1.35, "slow": 1.35}
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
        return round(total + float(self.meta.get("end_hold") or 1.2), 1)


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


def _split(text: str) -> Tuple[Dict[str, Tuple[str, int]], Dict[int, Dict[str, Tuple[str, int]]], str]:
    """Lift the reel-only lines out. Returns (header values, per-section values keyed by the line
    of the section's `##` heading, the remaining text as a post spec)."""
    lines = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = list(lines)
    header: Dict[str, Tuple[str, int]] = {}
    sections: Dict[int, Dict[str, Tuple[str, int]]] = {}
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    in_front = i < len(lines) and lines[i].strip() == "---"
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
        if m and m.group(1).lower() in SCENE_KEYS and section_line:
            key = SCENE_KEYS[m.group(1).lower()]
            sections[section_line][key] = (m.group(2).strip(), ln)
            out[idx] = ""
            current = (sections[section_line], key)
            continue
        if current and raw[:2].strip() == "" and raw.strip() and not raw.lstrip().startswith(("-", "|", "*")) \
                and not re.match(r"^\s*\d+[.)]", raw):
            store, key = current
            store[key] = (store[key][0] + " " + raw.strip(), store[key][1])
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


def parse_reel(text: str, base_dir: Optional[Path] = None) -> ReelScript:
    """Parse a reel script. Never raises for bad content: problems come back as issues with line numbers."""
    reel = ReelScript()
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
        else:
            meta[key] = value
    meta.setdefault("fps", 30)
    meta.setdefault("captions", "on")
    meta.setdefault("voice", DEFAULT_VOICE)
    meta.setdefault("speed", 1.0)
    meta.setdefault("end_hold", 1.2)
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
        reel.scenes.append(scene)
    reel.post_text = post_text
    reel.issues += check_reel(reel)
    return reel


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
        if s.show and s.say:
            hay = _norm(s.say)
            for cue in s.show:
                if _norm(cue) and _norm(cue) not in hay:
                    issues.append(SpecIssue("WARN", "CUE_NOT_FOUND", f"The cue '{cue}' on slide {s.n} isn't in its narration; it will be spread evenly instead.",
                                            slide=s.n, line=s.line, hint="Cue words must be copied from the `say:` line."))
                    break
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
