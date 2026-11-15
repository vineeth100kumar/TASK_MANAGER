"""voice_assistant.py - What the person said, as something Sage can do.

The web app first tries its own quick rules for alarms and timers. Everything
else comes here as the spoken words. Three layers, cheapest first, so a changed
phrasing still lands:

  1. Rules over a cleaned-up sentence: filler dropped ("could you please"),
     number words turned into digits, misheard words pulled back to the word
     meant (difflib), then patterns for the stopwatch, LUMO's screens and
     lights, the music, the volume, Work/Chill, the briefing.
  2. The task brain (voice_command.py) for anything about tasks: adding,
     reminding, notes, habits, marking done, snoozing, "what's on today".
  3. Groq, when neither is sure: it picks one command from a fixed catalogue
     and fills in its details, and every field is checked here before anything
     happens. Alarm and timer paraphrases go back to the app to run.

Nothing here invents a command: unknown speech is answered with a question,
never saved as a task by accident.
"""

from __future__ import annotations

import asyncio
import datetime
import difflib
import json
import logging
import re
from typing import Any, Dict, List, Optional

log = logging.getLogger("voice_assistant")

SCREENS = {"CLOCK": "the clock", "TASKS": "your tasks", "SPOTIFY": "Spotify", "SYSTEM": "the system screen",
           "TIMER": "the timer", "STOPWATCH": "the stopwatch", "WORLD": "the world clocks"}
LIGHT_MODES = ("AUTO", "WARM", "BREATHE", "AURORA", "PHOTO")

# ---- cleaning ---------------------------------------------------------------

_FILLER = [
    r"\b(?:hey|ok|okay|hi|hello|yo)\b", r"\bsage\b", r"\bplease\b", r"\bkindly\b", r"\bjust\b",
    r"\b(?:can|could|would|will) you\b", r"\bi (?:want|need|would like|d like|wanna) (?:you )?to\b",
    r"\bgo ahead and\b", r"\bfor me\b", r"\bif you can\b", r"\bnow\b", r"\bthanks?\b", r"\bthank you\b",
    r"\bi'?d like (?:you )?to\b", r"\blet'?s\b", r"\bgive me\b(?= (?:the )?(?:briefing|brief|rundown))",
]

_ONES = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
         "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
         "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}


def number_words(text: str) -> str:
    """"forty five" -> "45", "a hundred" -> "100", "fifty" -> "50"."""
    words = text.split()
    out: List[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        if w in _TENS:
            n = _TENS[w]
            if i + 1 < len(words) and words[i + 1] in _ONES and 1 <= _ONES[words[i + 1]] <= 9:
                n += _ONES[words[i + 1]]
                i += 1
            out.append(str(n))
        elif w in _ONES:
            out.append(str(_ONES[w]))
        elif w == "hundred" and out and out[-1].isdigit() and int(out[-1]) <= 9:
            out[-1] = str(int(out[-1]) * 100)
        elif w in ("a", "one") and i + 1 < len(words) and words[i + 1] == "hundred":
            out.append("100")
            i += 1
        else:
            out.append(w)
        i += 1
    return " ".join(out)


# Words this module listens for. A word that is almost one of these (a mishearing,
# a typo, a plural) is replaced by it before the patterns run.
VOCAB = [
    "stopwatch", "lights", "light", "brightness", "brighter", "dimmer", "volume", "louder", "quieter", "softer",
    "pause", "resume", "next", "previous", "skip", "playing", "spotify", "music", "song", "track", "tasks",
    "clock", "system", "world", "briefing", "breathe", "aurora", "warm", "chill", "work", "shuffle", "unmute",
    "mute", "screen", "display", "continue", "reset", "lap", "switch", "percent", "maximum",
]
_VOCAB_SET = set(VOCAB)


_ALIASES = {"lites": "lights", "lite": "light", "lyts": "lights", "stopwatches": "stopwatch", "stop-watch": "stopwatch"}


def fix_words(text: str) -> str:
    out = []
    for w in text.split():
        w = _ALIASES.get(w, w)
        if w in _VOCAB_SET or len(w) < 4 or w.isdigit() or ":" in w:
            out.append(w)
            continue
        near = difflib.get_close_matches(w, VOCAB, n=1, cutoff=0.85)
        out.append(near[0] if near else w)
    return " ".join(out)


def normalise(raw: str) -> str:
    t = " " + (raw or "").lower().replace("’", "'") + " "
    t = t.replace("stop watch", "stopwatch").replace("% ", " percent ").replace("%", " percent ")
    t = re.sub(r"[^a-z0-9:' ]", " ", t)
    for pat in _FILLER:
        t = re.sub(pat, " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = number_words(t)
    t = fix_words(t)
    return t


# ---- the intents ------------------------------------------------------------

def intent(_kind: str, /, **args: Any) -> dict:
    return {"intent": _kind, **args}


_LIGHT_NOUN = re.compile(r"\b(?:lights?|lamps?|leds?|lighting|ring|glow|ambient)\b")
_VOLUME_WORDS = re.compile(r"\b(?:volume|louder|quieter|softer|mute|unmute)\b|\bturn (?:it |the music |the sound )?(?:up|down)\b|\btoo (?:loud|quiet|soft)\b")
_MUSIC_NOUN = re.compile(r"\b(?:music|song|songs|track|spotify|playback|playing|tune|playlist)\b")


def _number(t: str) -> Optional[int]:
    m = re.search(r"\b(\d{1,3})(?:\s*percent)?\b", t)
    return int(m.group(1)) if m else None


def parse_device(raw: str) -> Optional[dict]:
    """The device commands, by rules. None when none of them fits."""
    t = normalise(raw)
    if not t:
        return None
    has = lambda p: re.search(p, t) is not None   # noqa: E731
    light = bool(_LIGHT_NOUN.search(t))

    # Stopwatch
    if has(r"\bstopwatch\b"):
        if has(r"\b(?:reset|clear|zero|restart)\b"):
            return intent("stopwatch", action="reset")
        if has(r"\blap\b|\bsplit\b"):
            return intent("stopwatch", action="lap")
        if has(r"\b(?:stop|pause|halt|freeze|end)\b"):
            return intent("stopwatch", action="pause")
        if has(r"\b(?:start|begin|run|go|resume|continue|on)\b"):
            return intent("stopwatch", action="start")
        return intent("screen", name="STOPWATCH")
    if re.match(r"^(?:lap|split)(?: time)?$", t):
        return intent("stopwatch", action="lap")

    # What is playing
    if has(r"\bwhat(?:'s| is)? (?:this|that|the) (?:song|track|music|tune)\b|\bwhat(?:'s| is) (?:this|playing)\b|\bwhat song\b|\bnow playing\b|\bwho (?:sings|is singing|plays|is playing)\b|\bwhich song\b|\bname of (?:this|the) song\b"):
        return intent("now_playing")

    # Lights
    if light:
        if has(r"\b(?:off|out|kill|shut)\b") and not has(r"\bturn (?:it )?on\b|\bon\b"):
            return intent("lights", state="off")
        for word, mode in (("warm", "WARM"), ("breathe", "BREATHE"), ("breathing", "BREATHE"), ("aurora", "AURORA"), ("photo", "PHOTO"), ("auto", "AUTO"), ("automatic", "AUTO"), ("default", "AUTO"), ("normal", "AUTO")):
            if has(rf"\b{word}\b"):
                return intent("lights", mode=mode, state="on")
        n = _number(t)
        if n is not None and has(r"\bpercent\b|\bto\b|\bat\b|\bbrightness\b|\blevel\b") and n <= 100:
            return intent("lights", state="on", brightness=n)
        if has(r"\b(?:full|max|maximum|brightest|all the way up)\b"):
            return intent("lights", state="on", brightness=100)
        if has(r"\b(?:minimum|lowest|dimmest)\b"):
            return intent("lights", state="on", brightness=10)
        if has(r"\b(?:dim|dimmer|lower|lessen|reduce|down|softer|darker|less bright)\b"):
            return intent("lights", state="on", delta=-25) if not has(r"\bdim the\b|\bdim\b") or has(r"\b(?:more|bit|little|further|down)\b") else intent("lights", state="on", brightness=35)
        if has(r"\b(?:bright|brighter|brighten|increase|raise|up|more)\b"):
            return intent("lights", state="on", delta=25)
        if has(r"\bon\b|\bback\b"):
            return intent("lights", state="on")
        return None
    if has(r"\b(?:aurora|breathe|breathing)\b") and has(r"\b(?:turn|put|switch|set|make)\b|^(?:aurora|breathe|breathing)$"):
        return intent("lights", mode="BREATHE" if has(r"\bbreath") else "AURORA", state="on")
    if has(r"\b(?:brighter|dimmer)\b") and not has(r"\b(?:screen|display|volume)\b"):
        return intent("lights", state="on", delta=25 if has(r"\bbrighter\b") else -25)
    if has(r"\b(?:brightness)\b"):
        n = _number(t)
        if n is not None and n <= 100:
            return intent("lights", state="on", brightness=n)

    # Volume (the music's)
    if _VOLUME_WORDS.search(t) and not light:
        if has(r"\bunmute\b"):
            return intent("volume", mute=False)
        if has(r"\bmute\b"):
            return intent("volume", mute=True)
        n = _number(t)
        if n is not None and n <= 100 and has(r"\b(?:volume|to|at)\b"):
            return intent("volume", level=n)
        if has(r"\b(?:max|maximum|full|loudest)\b"):
            return intent("volume", level=100)
        if has(r"\b(?:louder|up|higher|raise|increase|more|too quiet|too soft)\b"):
            return intent("volume", delta=15)
        if has(r"\b(?:quieter|softer|down|lower|reduce|decrease|less|too loud|bit)\b"):
            return intent("volume", delta=-15)
        return None

    # Music
    if has(r"\bshuffle\b"):
        return intent("music", action="shuffle_off" if has(r"\boff\b|\bstop\b|\bdisable\b") else "shuffle_on")
    music_noun = bool(_MUSIC_NOUN.search(t))
    if music_noun and has(r"\boff\b") and not has(r"\bturn on\b"):
        return intent("music", action="pause")
    if has(r"\b(?:next|skip|forward)\b") and (music_noun or re.match(r"^(?:next|skip)(?: (?:it|this|that|one|song|track))?$", t) or has(r"\bskip\b")):
        return intent("music", action="next")
    if has(r"\b(?:previous|prev|last|back|before)\b") and (music_noun or re.match(r"^(?:go )?back(?: one)?$|^previous$|^play (?:the )?(?:previous|last)", t)):
        return intent("music", action="previous")
    if has(r"\b(?:pause|stop|halt|silence|hold)\b") and (music_noun or re.match(r"^(?:pause|stop)(?: (?:it|that|this))?$", t)):
        return intent("music", action="pause")
    if has(r"\b(?:resume|continue|unpause|keep playing|carry on)\b") and (music_noun or has(r"^(?:resume|continue|unpause)$")):
        return intent("music", action="play")
    if has(r"^play$") or has(r"^play (?:the )?(?:music|song|spotify|it|something|again|some music|my music)$") or has(r"^(?:start|put on) (?:the )?(?:music|spotify|some music)$"):
        return intent("music", action="play")
    if re.match(r"^play \w", t):
        return intent("music", action="unsupported")

    # Screens
    screen_words = {          # the more specific names first: "the world clock" is not "the clock"
        "SPOTIFY": r"\b(?:spotify|music|player|song)\b", "SYSTEM": r"\b(?:system|stats|vitals|status)\b",
        "TIMER": r"\btimer\b", "WORLD": r"\bworld\b|\btime ?zones?\b",
        "TASKS": r"\b(?:tasks?|to ?do|todo|task list|agenda)\b", "CLOCK": r"\b(?:clock|home|face|main)\b",
    }
    if has(r"\b(?:show|open|display|switch|go|put|bring|change|take|screen|view)\b"):
        mentions_device = has(r"\b(?:clock|lumo|screen|display|desk)\b")
        for name, pat in screen_words.items():
            if has(pat):
                if name == "TASKS" and not mentions_device:
                    continue    # "show my tasks" is a question for the task brain
                if name == "CLOCK" and not (mentions_device or has(r"\b(?:go|back|switch|take)\b.*\b(?:home|clock|face|main)\b|\bshow (?:the )?(?:time|clock)\b")):
                    continue
                return intent("screen", name=name)
        if has(r"\bnext screen\b"):
            return intent("screen", name="NEXT")
        if has(r"\b(?:previous|prev|last) screen\b"):
            return intent("screen", name="PREV")

    # Work / Chill
    m = re.search(r"\b(work|chill)\b", t)
    if m and has(r"\bmode\b|\bswitch to\b|\bgo to\b|^(?:work|chill)$"):
        return intent("mode", name=m.group(1))
    if has(r"\bauto(?:matic)? mode\b|\bmode auto\b"):
        return intent("mode", name="auto")

    # Briefing
    if has(r"\b(?:briefing|brief me|catch me up|rundown|run down|what(?:'s| is) my day|how(?:'s| is) my day|my day look|day ahead|what(?:'s| is) (?:on )?(?:the )?(?:plan|agenda) for (?:the )?day)\b") or re.match(r"^good (?:morning|afternoon|evening)$", t):
        return intent("briefing")
    return None


# ---- tasks (the task brain) --------------------------------------------------

_TASK_CUE = re.compile(r"^(?:add|create|make|new|put|schedule|book|remember|remind|note|jot|log|track|start tracking|set a reminder|set reminder)\b", re.I)
_TASK_VERB = re.compile(r"\b(?:remind me|add (?:a |an |the )?(?:task|todo|to-?do|reminder|note|habit)|new task|new reminder|note that|note down|jot down|mark .+ (?:as )?(?:done|complete)|snooze|reschedule|postpone|push .+ to|move .+ to)\b", re.I)


def looks_like_task(raw: str, now: datetime.datetime) -> bool:
    """Does the task brain read this as a clear task command? Rules only, no AI."""
    try:
        import voice_command
        text = (raw or "").strip()
        if _TASK_CUE.match(text.lower()) or _TASK_VERB.search(text):
            return True
        cmd = voice_command.understand_rules(text, now, voice_command.load_context())
        return cmd.intent in ("query", "complete", "snooze", "move", "note", "habit") and cmd.confidence >= 0.6
    except Exception as e:      # the brain being unavailable just means "not a task"
        log.info("Task check failed: %s", e)
        return False


# ---- Groq: the fallback for phrasings the rules don't know -------------------

CATALOGUE = """You turn a spoken command for the Sage home assistant into ONE JSON object. Reply with JSON only.

Pick the closest command. The person may say it any way; the words need not match.

Commands (intent: arguments):
- stopwatch: action = start | pause | reset | lap
- screen: name = CLOCK | TASKS | SPOTIFY | SYSTEM | TIMER | STOPWATCH | WORLD | NEXT | PREV   (what the LUMO desk clock shows)
- lights: any of state = on | off; mode = AUTO | WARM | BREATHE | AURORA | PHOTO; brightness = 0-100; delta = -100..100 (brighter / dimmer)   (LUMO's light ring)
- music: action = play | pause | next | previous | shuffle_on | shuffle_off
- volume: any of level = 0-100; delta = -50..50 (louder / quieter); mute = true | false
- now_playing: (what song is on)
- mode: name = work | chill | auto
- briefing: (give the day's briefing)
- task: anything about tasks, reminders, notes, habits, marking something done, snoozing, or asking what is on today or next
- alarm_set: time = "HH:MM" 24-hour, days = list of 0-6 (Monday 0) or [], label = short text
- alarm_cancel | alarm_off | alarm_on: time = "HH:MM" or null, all = true | false
- timer_start: seconds = number
- timer_add: seconds = number
- timer: action = pause | resume | cancel
- ring: action = stop | snooze   (the clock's alarm is ringing)
- none: it is not a command for any of these

Output exactly: {"intent": "<name>", ...arguments}. Never invent an intent.

Spoken text:
"""

_ENUMS = {
    ("stopwatch", "action"): {"start", "pause", "reset", "lap"},
    ("screen", "name"): set(SCREENS) | {"NEXT", "PREV"},
    ("lights", "state"): {"on", "off"},
    ("lights", "mode"): set(LIGHT_MODES),
    ("music", "action"): {"play", "pause", "next", "previous", "shuffle_on", "shuffle_off"},
    ("mode", "name"): {"work", "chill", "auto"},
    ("timer", "action"): {"pause", "resume", "cancel"},
    ("ring", "action"): {"stop", "snooze"},
}


def _int_in(v: Any, lo: int, hi: int) -> Optional[int]:
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def check_intent(raw: Any) -> Optional[dict]:
    """Groq's answer, field by field. Anything not on the list is dropped."""
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("intent") or "").lower()
    out: Dict[str, Any] = {"intent": name}
    if name in ("briefing", "now_playing", "task", "none"):
        return out
    for (n, field), allowed in _ENUMS.items():
        if n != name:
            continue
        value = raw.get(field)
        if value is None:
            if name in ("stopwatch", "music", "mode", "screen", "timer", "ring"):
                return None
            continue
        value = str(value).upper() if (n, field) in (("screen", "name"), ("lights", "mode")) else str(value).lower()
        if value not in allowed:
            return None
        out[field] = value
    if name == "lights":
        for f, lo, hi in (("brightness", 0, 100), ("delta", -100, 100)):
            if raw.get(f) is not None:
                n = _int_in(raw[f], lo, hi)
                if n is None:
                    return None
                out[f] = n
        return out if len(out) > 1 else None
    if name == "volume":
        if raw.get("level") is not None:
            n = _int_in(raw["level"], 0, 100)
            if n is None:
                return None
            out["level"] = n
        if raw.get("delta") is not None:
            n = _int_in(raw["delta"], -50, 50)
            if n is None:
                return None
            out["delta"] = n
        if isinstance(raw.get("mute"), bool):
            out["mute"] = raw["mute"]
        return out if len(out) > 1 else None
    if name in ("stopwatch", "screen", "music", "mode", "timer", "ring"):
        return out if len(out) > 1 else None
    if name in ("timer_start", "timer_add"):
        n = _int_in(raw.get("seconds"), 1, 86400)
        return {**out, "seconds": n} if n else None
    if name in ("alarm_set", "alarm_cancel", "alarm_off", "alarm_on"):
        t = raw.get("time")
        if t is not None and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(t)):
            return None
        out["time"] = t
        if name == "alarm_set":
            if not t:
                return None
            days = raw.get("days") or []
            if not isinstance(days, list) or any(_int_in(d, 0, 6) is None for d in days):
                return None
            out["days"] = sorted({int(d) for d in days})
            out["label"] = str(raw.get("label") or "")[:40]
        else:
            out["all"] = bool(raw.get("all"))
        return out
    return None


async def ask_groq(raw: str) -> Optional[dict]:
    try:
        import canvas_thinker
        import httpx
        key = canvas_thinker.groq_key()
        if not key:
            return None
        model = canvas_thinker._setting("GROQ_LLM_MODEL") or canvas_thinker.GROQ_DEFAULT_MODEL
        async with httpx.AsyncClient(timeout=8) as client:
            for m in dict.fromkeys([model, canvas_thinker.GROQ_FALLBACK_MODEL]):
                res = await client.post(canvas_thinker.GROQ_URL, headers={"Authorization": f"Bearer {key}"}, json={
                    "model": m, "temperature": 0, "max_tokens": 200,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": CATALOGUE + json.dumps(raw)}],
                })
                if res.status_code == 200:
                    text = res.json()["choices"][0]["message"].get("content") or ""
                    found = re.search(r"\{.*\}", text, re.S)
                    return check_intent(json.loads(found.group(0))) if found else None
    except Exception as e:
        log.info("Voice AI step skipped: %s", e)
    return None


# ---- doing it -----------------------------------------------------------------

_muted_volume: Dict[str, int] = {}


def _pct(p: int) -> int:
    return round(max(0, min(100, p)) * 255 / 100)


def _from_pct(v: int) -> int:
    return round(v * 100 / 255)


async def execute(cmd: dict) -> dict:
    """Do a checked intent. Returns {say, ...}; raises nothing the caller can't show."""
    name = cmd["intent"]

    if name == "stopwatch":
        from desk import run as desk_run
        if not desk_run.running():
            return {"say": "The clock isn't running, sir.", "ok": False}
        await desk_run.stopwatch(cmd["action"])
        return {"say": {"start": "Stopwatch started", "pause": "Stopwatch stopped", "reset": "Stopwatch reset", "lap": "Lap marked"}[cmd["action"]]}

    if name == "screen":
        from desk import run as desk_run
        if not desk_run.running():
            return {"say": "The clock isn't running, sir.", "ok": False}
        target = cmd["name"]
        if target in ("NEXT", "PREV"):
            await desk_run.press("DOWN" if target == "NEXT" else "UP")
            return {"say": "Next screen" if target == "NEXT" else "Previous screen"}
        await desk_run.show_screen(target)
        return {"say": f"Showing {SCREENS[target]} on the clock"}

    if name == "lights":
        from desk import run as desk_run
        if not desk_run.running():
            return {"say": "The clock isn't running, sir.", "ok": False}
        return await desk_run.set_lights(cmd)

    if name == "music":
        import spotify
        action = cmd["action"]
        if action == "unsupported":
            return {"say": "I can resume, pause and skip the music, sir. Picking a track is for the Spotify app.", "ok": False, "answer": True}
        try:
            if action in ("shuffle_on", "shuffle_off"):
                await spotify.connect.shuffle(action == "shuffle_on")
                return {"say": "Shuffle is on" if action == "shuffle_on" else "Shuffle is off"}
            await spotify.connect.control({"play": "resume", "pause": "pause", "next": "next", "previous": "prev"}[action])
        except RuntimeError as e:
            return {"say": f"The music isn't ready, sir: {e}", "ok": False, "answer": True}
        return {"say": {"play": "Music resumed", "pause": "Music paused", "next": "Skipping to the next song", "previous": "Back to the previous song"}[action]}

    if name == "volume":
        return await _volume(cmd)

    if name == "now_playing":
        import spotify
        p = spotify.now_playing(spotify.connect.state)
        track = (p or {}).get("track")
        if not p or not track or not track.get("name") or not (p["playing"] or p["paused"]):
            return {"say": "Nothing is playing at the moment, sir.", "answer": True}
        by = f" by {track['artists']}" if track.get("artists") else ""
        return {"say": f"That is {track['name']}{by}, sir.", "answer": True}

    if name == "mode":
        import life_mode
        if cmd["name"] == "auto":
            life_mode.update_settings({"auto": True})
            return {"say": "Mode set to automatic", "event": "life-mode"}
        life_mode.update_settings({"mode": cmd["name"]})
        return {"say": f"{cmd['name'].capitalize()} mode on", "event": "life-mode"}

    if name == "briefing":
        import speaker
        if not speaker.has_output(speaker.get_settings()):
            return {"say": "There is no speaker set up for the briefing, sir.", "ok": False, "answer": True}
        await speaker.speaker.greet("command")
        return {"say": "Your briefing, sir", "spoken": True}

    return {"say": "I didn't follow that, sir.", "ok": False}


def _spotify_in_use() -> bool:
    """Is there Spotify music to turn up or down (playing, or paused mid-song)?"""
    try:
        import spotify
        p = spotify.now_playing(spotify.connect.state)
        return bool(spotify.connect._ws is not None and p and (p["playing"] or p["paused"] or p["buffering"]))
    except Exception:
        return False


async def _volume(cmd: dict) -> dict:
    """Volume goes to what is making the sound: the Spotify music when it is on,
    else the Pi's own master volume (voice, chimes, everything it plays)."""
    if _spotify_in_use():
        import spotify
        now = int((spotify.now_playing(spotify.connect.state) or {}).get("volume") or 0)
        try:
            if cmd.get("mute") is True:
                _muted_volume["v"] = now or _muted_volume.get("v", 40)
                await spotify.connect.set_volume(0)
                return {"say": "Music muted"}
            if cmd.get("mute") is False:
                await spotify.connect.set_volume(_muted_volume.pop("v", 40))
                return {"say": "Music unmuted"}
            level = cmd["level"] if cmd.get("level") is not None else max(0, min(100, now + cmd.get("delta", 0)))
            await spotify.connect.set_volume(level)
            return {"say": f"Music volume at {level} percent"}
        except RuntimeError as e:
            return {"say": f"The music isn't ready, sir: {e}", "ok": False, "answer": True}
    import speaker
    settings = speaker.get_settings()
    now = int(settings.get("masterVolume", 100))
    if cmd.get("mute") is True:
        _muted_volume["m"] = now if now > 5 else 60
        level = 5
    elif cmd.get("mute") is False:
        level = _muted_volume.pop("m", 60)
    elif cmd.get("level") is not None:
        level = cmd["level"]
    else:
        level = now + cmd.get("delta", 0)
    level = max(5, min(100, int(level)))
    await asyncio.to_thread(speaker.save_settings, {"masterVolume": level})
    await speaker.speaker.set_master()
    result = speaker.speaker.master
    if not result.get("ok"):
        return {"say": f"I couldn't change the volume, sir. {result.get('why') or ''}".strip(), "ok": False, "answer": True}
    return {"say": f"Volume at {level} percent"}


# ---- the front door -----------------------------------------------------------

# Intents the web app runs itself (its alarm and timer code), sent back as commands.
_CLIENT = {"alarm_set", "alarm_cancel", "alarm_off", "alarm_on", "timer_start", "timer_add", "timer", "ring"}


def client_command(cmd: dict) -> dict:
    name = cmd["intent"]
    if name == "timer_start":
        return {"kind": "timer_start", "seconds": cmd["seconds"]}
    if name == "timer_add":
        return {"kind": "timer_add", "seconds": cmd["seconds"]}
    if name == "timer":
        return {"kind": "timer", "action": cmd["action"]}
    if name == "ring":
        return {"kind": "ring", "action": cmd["action"]}
    if name == "alarm_set":
        return {"kind": "alarm_set", "time": cmd["time"], "days": cmd["days"], "label": cmd["label"]}
    return {"kind": name, "time": cmd.get("time"), "all": cmd.get("all", False)}


async def handle(raw: str, now: datetime.datetime, use_ai: bool = True) -> dict:
    """The spoken words in, what happened out: {handled, say, ...}."""
    raw = (raw or "").strip()
    if not raw:
        return {"success": True, "handled": False, "say": "I didn't catch anything, sir."}
    cmd = parse_device(raw)
    engine = "rules"
    if cmd is None and looks_like_task(raw, now):
        return await _task(raw, now)
    if cmd is None and use_ai:
        cmd = await ask_groq(raw)
        engine = "ai"
        if cmd and cmd["intent"] == "task":
            return await _task(raw, now)
    if cmd is None or cmd["intent"] == "none":
        return {"success": True, "handled": False, "say": "I'm afraid I didn't follow that, sir. Could you say it another way?", "engine": engine}
    if cmd["intent"] in _CLIENT:
        return {"success": True, "handled": True, "command": client_command(cmd), "engine": engine}
    try:
        done = await execute(cmd)
    except Exception as e:
        log.info("Voice command %s failed: %s", cmd, e)
        return {"success": True, "handled": True, "ok": False, "say": f"That didn't work, sir: {e}", "understood": cmd, "engine": engine}
    return {"success": True, "handled": True, "ok": done.get("ok", True), "understood": cmd, "engine": engine,
            **{k: v for k, v in done.items() if k != "ok"}}


async def _task(raw: str, now: datetime.datetime) -> dict:
    import voice_command
    res = await voice_command.handle(raw, now)
    say = str(res.get("say") or "Done").strip()
    if "sir" not in say.lower():
        say = say.rstrip(".") + ", sir."
    return {"success": True, "handled": True, "ok": not res.get("clarify"), "say": say, "answer": True, "engine": "tasks"}
