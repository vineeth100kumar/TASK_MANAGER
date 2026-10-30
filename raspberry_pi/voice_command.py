"""
voice_command.py - one Siri shortcut for everything.

The shortcut sends whatever was said or typed to /api/voice. This module works
out what it means and does it, in two phases:

  1. Understand. Layered, cheapest first:
       a. rules: a lexicon for slang, typos and other languages (kal, mañana,
          tmrw, "5 baje"), word numbers ("five thirty"), times and dates in
          any position ("tomorrow 5pm call mom" = "call mom tomorrow 5pm"),
          priority, repeats, tags, then the intent (add, remind, note, habit,
          done, snooze, move, ask).
       b. an AI (Groq, else the Pi's local model) when the rules are unsure,
          the sentence mixes languages, or a target couldn't be found. It
          answers in strict JSON that is checked field by field; a made-up
          date, key, project or title is dropped, and the rules' own date and
          time win whenever they found one.
       c. no AI at all: the rules' answer stands, and anything unclear is
          saved to the Inbox as typed so nothing said is ever lost.
  2. Execute through the same data layer Claude's connector uses
     (claude_api.create_record / update_record), so every item gets a key,
     a place, and reaches every open copy of the app.

Times use the one configured time zone: the caller passes `now` in it.
"""

import asyncio
import datetime
import difflib
import json
import os
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

import httpx

import canvas_thinker
import chat_capture
import claude_api
import item_shape
import quick_add

SOURCE = "voice"
LOW_CONFIDENCE = 0.5       # below this, a guess is saved to the Inbox as typed
ASK_AI_BELOW = 0.85        # below this the AI is asked, if there is one
LLM_TIMEOUT_S = float(os.getenv("SAGE_VOICE_LLM_TIMEOUT", "10"))
PRIORITIES = ("low", "medium", "high", "urgent")
INTENTS = ("add", "remind", "event", "habit", "note", "complete", "snooze", "move", "query")

# ---------------------------------------------------------------------------
# Lexicon: words from slang, texting and other languages -> plain English.
# Only whole words are replaced, so a title in Hindi or Spanish keeps its own
# words; the ones that carry a date, time, repeat or intent are translated.
# ---------------------------------------------------------------------------

_LEX_GROUPS = {
    "today": "aaj aj hoy heute oggi aujourdhui आज indru inniku ivala",
    "tomorrow": ("tmrw tmr tmrrw tmro tmw tmrow 2moro 2morrow 2mrw 2mro tomorow tommorow tomorrow tommorrow tomorrw tomoro "
                 "tommorrow tomm kal कल manana demain morgen domani naalai nalai repu udya nale naale"),
    "day after tomorrow": "parso parson परसों pasadomanana übermorgen ubermorgen overmorrow",
    "tonight": "tonite 2nite tonyt tonighht",
    "morning": "subah subha savere सुबह morgens mornin mornng am_morning",
    "afternoon": "dopahar dupahar dophar दोपहर aftrnoon afternon tarde",
    "evening": "shaam शाम evng evenin",
    "night": "raat रात noche nite nuit",
    "every": "har cada chaque jeden each",
    "daily": "rozana roz_ diario quotidien taeglich täglich",
    "week": "hafte hafta hafte_ semana semaine woche",
    "month": "mahine mahina mahine_ mois monat",
    "day": "din dia jour",
    "next": "agle agla proxima próxima prochain nachste nächste",
    "this": "is_ esta este",
    "o'clock": "baje bje बजे",
    "monday": "somvar somvaar somwar lunes lundi montag mon_ monday mondy munday mondey",
    "tuesday": "mangalvar mangalwar martes mardi dienstag tusday tuesdy tueday tuseday",
    "wednesday": "budhvar budhwar miercoles mercredi mittwoch wensday wednsday wedensday wendsday wednesdy",
    "thursday": "guruvar guruwar veervar brihaspativar jueves jeudi donnerstag thrusday thursdy thurday thirsday",
    "friday": "shukravar shukrawar viernes vendredi freitag firday fridy frday",
    "saturday": "shanivar shaniwar sabado samedi samstag saterday satruday saturdy",
    "sunday": "ravivar raviwar itwar itwaar domingo dimanche sonntag sundy sundey",
    "remind me to": ("yaad_dilana yaad_dilao yaad_dila_do recuerdame recordarme rappelle_moi erinnere_mich ricordami "
                     "remindme remind_me_to"),
}
_FOREIGN = set(
    "aaj aj hoy heute oggi aujourdhui आज indru inniku ivala kal कल manana demain morgen domani naalai nalai repu udya nale naale "
    "parso parson परसों übermorgen ubermorgen subah subha savere सुबह morgens dopahar dupahar dophar दोपहर tarde shaam sham शाम "
    "raat रात noche nuit har cada chaque jeden rozana diario quotidien täglich taeglich hafte hafta semana semaine woche mahine "
    "mahina mes mois monat din dia jour tag agle agla proxima próxima prochain nachste nächste baje bje बजे somvar somvaar somwar "
    "lunes lundi montag mangalvar mangalwar martes mardi dienstag budhvar budhwar miercoles mercredi mittwoch guruvar guruwar "
    "veervar brihaspativar jueves jeudi donnerstag shukravar shukrawar viernes vendredi freitag shanivar shaniwar sabado samedi "
    "samstag ravivar raviwar itwar itwaar domingo dimanche sonntag".split()
)
LEXICON: Dict[str, str] = {}
for _target, _words in _LEX_GROUPS.items():
    for _w in _words.split():
        if "_" in _w:  # placeholder spelling kept only so the groups stay readable
            continue
        LEXICON[_w] = _target
LEXICON.update({"yaad": "", "dilana": "", "dilao": "", "dila": ""})  # handled by phrase rules below

# Long canonical words a mis-spelt word is snapped to (len >= 5 only).
_FUZZY_TARGETS = ["tomorrow", "tonight", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                  "morning", "afternoon", "evening", "urgent", "weekend", "daily", "weekly", "monthly"]
_FUZZY_PROTECT = {"friend", "friends", "friendly", "mornings", "evenings", "noon", "today", "someday", "birthday",
                  "holiday", "holidays", "monster", "tuning", "windy"}

_WORD_RE = re.compile(r"[\ẁ-ͯऀ-෿'’]+", re.UNICODE)


def _fold(word: str) -> str:
    """Lower-case with Latin accents removed (mañana -> manana); other scripts untouched."""
    out = []
    for ch in unicodedata.normalize("NFD", word.lower()):
        if unicodedata.category(ch) == "Mn" and out and ord(out[-1]) < 0x250:
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out)).replace("’", "'")


class Normalised:
    def __init__(self, text: str, foreign: bool):
        self.text = text
        self.foreign = foreign


def normalise_words(text: str) -> Normalised:
    foreign = False

    def swap(m: re.Match) -> str:
        nonlocal foreign
        word = m.group(0)
        key = _fold(word).replace("'", "")
        if key in LEXICON and LEXICON[key]:
            if key in _FOREIGN:
                foreign = True
            return LEXICON[key]
        if len(key) >= 5 and key.isascii() and key.isalpha() and key not in _FUZZY_PROTECT and key not in _FUZZY_TARGETS:
            close = difflib.get_close_matches(key, _FUZZY_TARGETS, n=1, cutoff=0.84)
            if close:
                return close[0]
        return word

    out = _WORD_RE.sub(swap, text)
    if re.search(r"[ऀ-෿]", text):
        foreign = True
    return Normalised(out, foreign)


# ---------------------------------------------------------------------------
# Word numbers ("five thirty" -> 5:30) in the places they mean a time or span.
# ---------------------------------------------------------------------------

_UNITS = {"zero": 0, "oh": 0, "o": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
          "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
          "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50}
_NUM = r"(?:(?:twenty|thirty|forty|fourty|fifty)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)"


def _num_value(s: str) -> int:
    parts = re.split(r"[\s-]+", s.strip().lower())
    total = 0
    for p in parts:
        total += _TENS.get(p, _UNITS.get(p, 0))
    return total


def numbers_to_digits(t: str) -> str:
    """Spoken numbers in time-and-span contexts become digits; titles keep their words."""
    t = re.sub(r"\b(?:twelve|12)\s+noon\b", "noon", t, flags=re.I)
    t = re.sub(r"\b(?:twelve|12)\s+midnight\b", "midnight", t, flags=re.I)
    hindi = {"ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "chhah": 6, "saat": 7,
             "aath": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12}
    t = re.sub(r"\b(" + "|".join(hindi) + r")\s+(?=o'clock)", lambda m: f"{hindi[m.group(1).lower()]} ", t, flags=re.I)
    meridiem = r"(?:a\.?\s?m\.?|p\.?\s?m\.?|o'?\s?clock|oclock)"

    def clock(m: re.Match) -> str:
        hour = _num_value(m.group(1))
        mins = _num_value(m.group(2)) if m.group(2) else None
        tail = (m.group(3) or "").strip()
        if mins is not None and (m.group(2) or "").strip().lower() in ("oh", "o"):
            mins = None
        return f"{m.group(0)[:0]}{hour}" + (f":{mins:02d}" if mins is not None else "") + (" " + tail if tail else "")

    # "five thirty pm", "five pm", "five o'clock", "seven oh five am"
    t = re.sub(rf"\b({_NUM})(?:[\s-]+((?:oh|o)[\s-]+{_NUM}|{_NUM}))?\s*({meridiem})", lambda m: _clock_words(m), t, flags=re.I)
    # "at five thirty", "at five" (only after a time word; "at one of" is left alone below)
    t = re.sub(rf"\b(at|by|around|@)\s+({_NUM})(?:[\s-]+((?:oh|o)[\s-]+{_NUM}|{_NUM}))?(?=\s*$|\s+(?:am|pm|in|on|tomorrow|today|tonight|every|and|for|with|tmrw|morning|afternoon|evening|night)\b|\s*[,.;!?])",
               lambda m: f"{m.group(1)} " + _clock_digits(m.group(2), m.group(3)), t, flags=re.I)
    # spans: "in twenty minutes", "for two hours", "after three days"
    t = re.sub(rf"\b(in|after|for|within)\s+({_NUM})\s+((?:min|minute|hour|hr|day|week|month)s?)\b",
               lambda m: f"{m.group(1)} {_num_value(m.group(2))} {m.group(3)}", t, flags=re.I)
    # "every two days"
    t = re.sub(rf"\bevery\s+({_NUM})\s+((?:day|week|month)s?)\b", lambda m: f"every {_num_value(m.group(1))} {m.group(2)}", t, flags=re.I)
    # "twice a week" style counts are left to the habit rules
    return t


def _clock_digits(hour_words: str, min_words: Optional[str]) -> str:
    h = _num_value(hour_words)
    if not min_words:
        return str(h)
    m = _num_value(re.sub(r"^(oh|o)[\s-]+", "", min_words.strip(), flags=re.I))
    return f"{h}:{m:02d}"


def _clock_words(m: re.Match) -> str:
    base = _clock_digits(m.group(1), m.group(2))
    tail = m.group(3).lower().replace(" ", "").replace(".", "")
    if tail.startswith("o"):
        return f"{base} o'clock"
    return f"{base}{tail[0]}m"


# ---------------------------------------------------------------------------
# Extraction: everything about *when* (and priority/repeat), wherever it sits.
# ---------------------------------------------------------------------------

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
_MONTH_ES = {"enero": "january", "febrero": "february", "marzo": "march", "abril": "april", "mayo": "may", "junio": "june",
             "julio": "july", "agosto": "august", "septiembre": "september", "setiembre": "september", "octubre": "october",
             "noviembre": "november", "diciembre": "december"}
DAYPART_TIME = {"morning": "09:00", "afternoon": "14:00", "evening": "19:00", "night": "21:00"}

_MONTH_RE = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"


class When:
    """What the words say about timing, plus what else was pulled out of them."""

    def __init__(self):
        self.date: Optional[str] = None
        self.time: Optional[str] = None
        self.in_minutes: Optional[int] = None       # "in 2 hours": relative to now
        self.for_minutes: Optional[int] = None      # "for 30 minutes": a span, or a snooze length
        self.daypart: Optional[str] = None
        self.priority: Optional[str] = None
        self.past: bool = False                     # "yesterday": ignored for dates
        self.habit_per_week: Optional[int] = None
        self.bare_hour: Optional[int] = None        # an hour with no am/pm and no part of day

    def public(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v not in (None, False)}


def _cut(text: str, m: re.Match) -> str:
    return (text[:m.start()] + " " + text[m.end():])


def _hhmm(h: int, m: int = 0) -> str:
    return f"{h % 24:02d}:{m:02d}"


def _with_daypart(h: int, dp: Optional[str]) -> int:
    """An hour spoken without am/pm, read the way people mean it."""
    if h >= 13:
        return h
    if dp == "morning":
        return 0 if h == 12 else h
    if dp in ("afternoon", "evening"):
        return h + 12 if h < 12 else 12
    if dp == "night":
        if h == 12:
            return 0
        return h + 12 if h >= 6 else h
    return h + 12 if 1 <= h <= 6 else h


def _ampm(h: int, ap: str) -> int:
    ap = ap.lower()[0]
    if ap == "p" and h < 12:
        return h + 12
    if ap == "a" and h == 12:
        return 0
    return h


def _next_day_of_month(today: datetime.date, day: int) -> Optional[datetime.date]:
    for add in range(0, 14):
        year, month = today.year, today.month + add
        year += (month - 1) // 12
        month = (month - 1) % 12 + 1
        try:
            d = datetime.date(year, month, day)
        except ValueError:
            continue
        if d >= today:
            return d
    return None


def _add_months(d: datetime.date, n: int) -> datetime.date:
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    last = (datetime.date(year + (month == 12), month % 12 + 1, 1) - datetime.timedelta(days=1)).day
    return datetime.date(year, month, min(d.day, last))


def extract_when(text: str, now: datetime.datetime) -> Tuple[str, When]:
    """Pull dates, times, spans and priority out of `text` (already normalised).
    Returns the text without them. Whatever quick_add can read itself (tags,
    #tags, ~30m, @place, every monday, tomorrow, next friday, oct 15) is left
    for it."""
    w = When()
    today = now.date()
    t = " " + text + " "

    t = re.sub(r"\b(tomorrow|today|tonight)\s+eve\b", r"\1 evening", t, flags=re.I)
    # Texting shorthand that changes a date or time.
    t = re.sub(r"\bb4\b", "before", t, flags=re.I)
    t = re.sub(r"\bremind me 2\b", "remind me to", t, flags=re.I)
    t = re.sub(r"\b(?:like|around|about|roughly|approx\.?|approximately)\s+(?=\d)", "at ", t, flags=re.I)
    t = re.sub(r"\b(\d{1,2})\s*-?\s*ish\b", r"at \1", t, flags=re.I)
    t = re.sub(r"\bwithin\s+(\d+)\s+(day|week|month)s?\b", r"in \1 \2s", t, flags=re.I)
    t = re.sub(r"\b(\d+)\s+(day|week|month)s?\s+(?:from\s+(?:now|today)|later)\b", r"in \1 \2s", t, flags=re.I)
    m = re.search(r"\bnext\s+week\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+next\s+week\b", t, re.I)
    if m:
        name = (m.group(1) or m.group(2)).lower()
        monday = today + datetime.timedelta(days=7 - today.weekday())
        w.date = (monday + datetime.timedelta(days=WEEKDAYS.index(name))).isoformat()
        t = _cut(t, m)
    # Other languages' "at": a las 5, um 5 uhr, a 5 baje is handled by the lexicon.
    t = re.sub(r"\b(?:a\s+las?|a\s+la|um|à|alle|alle ore)\s+(?=\d)", " at ", t, flags=re.I)
    t = re.sub(r"(?<=\d)\s*uhr\b", " ", t, flags=re.I)
    # Written-out forms of am/pm and small tidy-ups.
    t = re.sub(r"(?<=\d)\s*([ap])\.\s?m\.?", r"\1m", t, flags=re.I)
    t = re.sub(r"(?<=\d)\s+([ap])\s?m\b", r"\1m", t, flags=re.I)
    t = re.sub(r"\b(\d{1,2})\s*(?:hrs|hours)\b(?=\s*(?:today|tomorrow|$|\W))(?!\s*(?:later|from))", lambda m: m.group(0), t, flags=re.I)
    t = re.sub(r"\beveryday\b", " every day ", t, flags=re.I)
    t = re.sub(r"\bevery\s*(?:single\s+)?(?:day)\b", " every day ", t, flags=re.I)
    t = re.sub(r"\bevery\s+(?:other|second)\s+day\b", " every 2 days ", t, flags=re.I)
    t = re.sub(r"\bfort?nightly\b|\bevery\s+(?:other|second)\s+week\b|\bbi-?weekly\b", " every 2 weeks ", t, flags=re.I)
    t = re.sub(r"\b(?:every|each)\s+(morning|evening|night|afternoon)\b", lambda m: f" every day {m.group(1)} ", t, flags=re.I)
    t = re.sub(r"\b(?:each|every)\s+(week|month|year|weekday)\b", lambda m: f" every {m.group(1)} ", t, flags=re.I)
    t = re.sub(r"\bevery\s+((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)\s*(?:and|&)\s*((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)",
               r" every \1, \2 ", t, flags=re.I)
    t = re.sub(r"\bon\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*s\b", lambda m: f" every {m.group(1)} ", t, flags=re.I)  # "on mondays"
    t = re.sub(r"\b((?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)day)s\b", r"every \1", t, flags=re.I) if re.search(
        r"\b(?:weekly|repeat|recurring)\b", t, re.I) else t

    # --- priority (low first, so "not urgent" isn't urgent) ---
    for pat, value in [
        (r"\b(?:low priority|not urgent|no rush|no hurry|whenever|when i get (?:the )?time|someday|some day|p3|priority 3)\b", "low"),
        (r"\b(?:medium priority|normal priority|medium|p2|priority 2)\s*(?:priority)?\b(?=\s|$)", "medium"),
        (r"\b(?:p1|priority 1|top priority|highest priority|most urgent|very urgent|urgent(?:ly)?|asap|a\.s\.a\.p\.?|"
         r"right away|right now|immediately|critical|jaldi|emergency)\b", "urgent"),
        (r"\b(?:high priority|(?:(?:it'?s|that'?s|this is|its)\s+)?(?:very |super |really |extremely )?important|imp|zaroori|zaruri|must do|must-do|big deal)\b", "high"),
    ]:
        m = re.search(pat, t, re.I)
        if m and not w.priority:
            w.priority = value
            t = _cut(t, m)
    # "priority high" / "set priority to urgent"
    m = re.search(r"\b(?:set\s+)?priority\s*(?:to|as|:)?\s*(low|medium|high|urgent)\b", t, re.I)
    if m:
        w.priority = m.group(1).lower()
        t = _cut(t, m)

    # --- yesterday etc. (kept only so they don't pollute the title) ---
    m = re.search(r"\b(?:yesterday|last night|earlier today|just now|already)\b", t, re.I)
    if m:
        w.past = True
        t = _cut(t, m)

    # --- "day after tomorrow", tonight, today night ---
    m = re.search(r"\b(?:the\s+)?day\s+after\s+(?:tomorrow|tmrw)\b|\bafter\s+tomorrow\b", t, re.I)
    if m:
        w.date = (today + datetime.timedelta(days=2)).isoformat()
        t = _cut(t, m)
    m = re.search(r"\b(?:today|this)\s+(?:night|evening)\b|\btonight\b", t, re.I)
    if m:
        w.date = w.date or today.isoformat()
        w.daypart = "night" if "night" in m.group(0).lower() else "evening"
        t = _cut(t, m)

    # --- relative spans: "in 2 hours", "half an hour from now", "20 mins later" ---
    spans = [
        (r"\b(?:in|after|within)\s+(?:an?\s+)?half\s+(?:an?\s+)?hour\b|\bhalf\s+(?:an?\s+)?hour\s+(?:from now|later)\b", lambda m: 30, "in"),
        (r"\b(?:in|after|within)\s+(?:an?|one)\s+(?:hour|hr)\b|\b(?:an?|one)\s+(?:hour|hr)\s+(?:from now|later)\b", lambda m: 60, "in"),
        (r"\b(?:in|after|within)\s+(?:a\s+)?(?:couple|few)\s+(?:of\s+)?hours?\b", lambda m: 120, "in"),
        (r"\b(?:in|after|within)\s+(?:a\s+)?(?:couple|few)\s+(?:of\s+)?(?:min|minutes?)\b", lambda m: 5, "in"),
        (r"\b(?:in|after|within)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?)\b|\b(\d+(?:\.\d+)?)\s*(hours?|hrs?)\s+(?:from now|later)\b",
         lambda m: int(float(m.group(1) or m.group(3)) * 60), "in"),
        (r"\b(?:in|after|within)\s+(\d+)\s*(min(?:ute)?s?)\b|\b(\d+)\s*(min(?:ute)?s?)\s+(?:from now|later)\b",
         lambda m: int(m.group(1) or m.group(3)), "in"),
        (r"\bfor\s+(?:an?\s+)?half\s+(?:an?\s+)?hour\b", lambda m: 30, "for"),
        (r"\b(?:for|by)\s+(?:an?|one)\s+(?:hour|hr)\b", lambda m: 60, "for"),
        (r"\b(?:for|by)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b", lambda m: int(float(m.group(1)) * 60), "for"),
        (r"\b(?:for|by)\s+(\d+)\s*(?:min(?:ute)?s?)\b", lambda m: int(m.group(1)), "for"),
    ]
    for pat, fn, kind in spans:
        m = re.search(pat, t, re.I)
        if m:
            minutes = fn(m)
            if kind == "in":
                w.in_minutes = minutes
            else:
                w.for_minutes = minutes
            t = _cut(t, m)
            if kind == "in":
                break

    # --- daypart (morning/afternoon/evening/night) ---
    m = re.search(r"\b(?:in the |at |this |during the )?(morning|afternoon|evening|night)\b", t, re.I)
    if m:
        w.daypart = w.daypart or m.group(1).lower()
        if re.search(r"\bthis\s+" + m.group(1), m.group(0), re.I):
            w.date = w.date or today.isoformat()
        t = _cut(t, m)
    dp = w.daypart

    # --- clock times ---
    time_set = False

    def bare(h: int, _dp: Optional[str]) -> int:
        """An hour said without am/pm; remembered so the title can say which half of the day."""
        if _dp is None and 1 <= h <= 12 and w.bare_hour is None:
            w.bare_hour = h
        return _with_daypart(h, _dp)

    def set_time(h: int, mi: int = 0):
        nonlocal time_set
        if not time_set:
            w.time = _hhmm(h, mi)
            time_set = True

    m = re.search(r"\bhalf\s+past\s+(\d{1,2})\b", t, re.I)
    if m:
        set_time(bare(int(m.group(1)), dp), 30); t = _cut(t, m)
    m = re.search(r"\b(?:a\s+)?quarter\s+past\s+(\d{1,2})\b", t, re.I)
    if m and not time_set:
        set_time(bare(int(m.group(1)), dp), 15); t = _cut(t, m)
    m = re.search(r"\b(?:a\s+)?quarter\s+to\s+(\d{1,2})\b", t, re.I)
    if m and not time_set:
        set_time(bare(int(m.group(1)) - 1, dp), 45); t = _cut(t, m)
    # Hindi: saade paanch baje (5:30), sawa paanch (5:15), paune paanch (4:45)
    m = re.search(r"\bsaade?\s+(\d{1,2})\s*o'clock\b", t, re.I)
    if m and not time_set:
        set_time(bare(int(m.group(1)), dp), 30); t = _cut(t, m)
    m = re.search(r"\bsawa\s+(\d{1,2})\s*o'clock\b", t, re.I)
    if m and not time_set:
        set_time(bare(int(m.group(1)), dp), 15); t = _cut(t, m)
    m = re.search(r"\bpaune\s+(\d{1,2})\s*o'clock\b", t, re.I)
    if m and not time_set:
        set_time(bare(int(m.group(1)) - 1, dp), 45); t = _cut(t, m)
    # 5.30pm, 5:30 pm, 17:30, "at 5:30", 5.30 (after "at")
    m = re.search(r"(?:\b(?:at|by|around|@|from|till|until|before)\s+)?\b(\d{1,2})[:.](\d{2})\s*([ap]m)\b", t, re.I)
    if m and not time_set:
        set_time(_ampm(int(m.group(1)), m.group(3)), int(m.group(2))); t = _cut(t, m)
    m = re.search(r"(?:\b(?:at|by|around|@|from|till|until|before)\s+)?\b(\d{1,2}):(\d{2})\b(?!\s*[ap]m)", t, re.I)
    if m and not time_set and int(m.group(2)) < 60:
        h = int(m.group(1))
        set_time(h if h >= 13 or h == 0 else bare(h, dp), int(m.group(2))); t = _cut(t, m)
    m = re.search(r"\b(?:at|by|around|@)\s+(\d{1,2})\.(\d{2})\b(?!\s*\d)", t, re.I)
    if m and not time_set and int(m.group(2)) < 60:
        set_time(bare(int(m.group(1)), dp), int(m.group(2))); t = _cut(t, m)
    # 1730 hrs, at 1730
    m = re.search(r"\b(?:at\s+)?([01]\d|2[0-3])([0-5]\d)\s*(?:hrs|hours|h)\b|\bat\s+([01]\d|2[0-3])([0-5]\d)\b", t, re.I)
    if m and not time_set:
        hh, mm = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        set_time(int(hh), int(mm)); t = _cut(t, m)
    # 5pm, 5 pm
    m = re.search(r"(?:\b(?:at|by|around|@|from|till|until|before)\s+)?\b(\d{1,2})\s*([ap]m)\b", t, re.I)
    if m and not time_set and 1 <= int(m.group(1)) <= 12:
        set_time(_ampm(int(m.group(1)), m.group(2))); t = _cut(t, m)
    # 5 o'clock / "5 baje"
    m = re.search(r"\b(\d{1,2})\s*o'?clock\b", t, re.I)
    if m and not time_set and 1 <= int(m.group(1)) <= 24:
        set_time(bare(int(m.group(1)), dp)); t = _cut(t, m)
    # "at 5", "around 6" (not "at 5 people")
    m = re.search(r"\b(?:at|by|around|@)\s+(\d{1,2})\b(?!\s*(?:/|-|%|people|items|things|times|kg|km|min|hour|day|week|month|st\b|nd\b|rd\b|th\b))", t, re.I)
    if m and not time_set and 1 <= int(m.group(1)) <= 24:
        set_time(bare(int(m.group(1)), dp)); t = _cut(t, m)
    # noon, midnight, end of day
    for pat, hhmm in [(r"\b(?:noon|midday|mid-day|lunch ?time)\b", "12:00"), (r"\bmidnight\b", "00:00"),
                      (r"\b(?:eod|end of (?:the )?day|close of business|cob)\b", "17:00")]:
        m = re.search(pat, t, re.I)
        if m and not time_set:
            w.time = hhmm; time_set = True; t = _cut(t, m)
    if not time_set and dp:
        w.time = DAYPART_TIME[dp]  # "tomorrow morning"; callers may ignore it when they want only a date

    # --- dates beyond what quick_add reads ---
    m = re.search(r"\bend of (?:the )?month\b|\beom\b", t, re.I)
    if m:
        first_next = _add_months(today.replace(day=1), 1)
        w.date = (first_next - datetime.timedelta(days=1)).isoformat(); t = _cut(t, m)
    m = re.search(r"\bend of (?:the )?week\b|\beow\b", t, re.I)
    if m:
        w.date = (today + datetime.timedelta(days=(4 - today.weekday()) % 7)).isoformat(); t = _cut(t, m)
    m = re.search(r"\bnext\s+month\b", t, re.I)
    if m:
        w.date = _add_months(today.replace(day=1), 1).isoformat(); t = _cut(t, m)
    m = re.search(r"\bnext\s+weekend\b", t, re.I)
    if m:
        w.date = (today + datetime.timedelta(days=(5 - today.weekday()) % 7 + 7)).isoformat(); t = _cut(t, m)
    m = re.search(r"\b(?:in|after)\s+(?:a|one)\s+(day|week|month)\b", t, re.I)
    if m:
        t = t[:m.start()] + f" in 1 {m.group(1)} " + t[m.end():]
    m = re.search(r"\b(?:in|after)\s+(?:a\s+)?(?:couple|few)\s+(?:of\s+)?(day|week)s?\b", t, re.I)
    if m:
        n = 2 if "couple" in m.group(0).lower() else 3
        t = t[:m.start()] + f" in {n} {m.group(1)}s " + t[m.end():]
    # Spanish/other "15 de octubre" and ordinals "15th of october", "october 15th", "the 15th"
    for es, en in _MONTH_ES.items():
        t = re.sub(rf"\b{es}\b", en, t, flags=re.I)
    t = re.sub(rf"\b(\d{{1,2}})\s+de\s+({_MONTH_RE})\b", r"\1 \2", t, flags=re.I)
    t = re.sub(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+of\s+({_MONTH_RE})\b", r"\1 \2", t, flags=re.I)
    t = re.sub(rf"\b(\d{{1,2}})(?:st|nd|rd|th)\s+({_MONTH_RE})\b", r"\1 \2", t, flags=re.I)
    t = re.sub(rf"\b({_MONTH_RE})\s+(\d{{1,2}})(?:st|nd|rd|th)\b", r"\1 \2", t, flags=re.I)
    m = re.search(r"\b(?:on |by |before |till |until )?the\s+(\d{1,2})(?:st|nd|rd|th)\b|\b(?:on|by|before|till|until)\s+(\d{1,2})(?:st|nd|rd|th)\b", t, re.I)
    if m and not w.date:
        day = int(m.group(1) or m.group(2))
        d = _next_day_of_month(today, day) if 1 <= day <= 31 else None
        if d:
            w.date = d.isoformat(); t = _cut(t, m)

    # --- habit frequency: "3 times a week", "twice a week", "5x a week" ---
    m = re.search(r"\b(?:(\d)|(once|twice|thrice))\s*(?:x|times?)?\s*(?:a|per|each|every)\s+week\b", t, re.I)
    if m:
        w.habit_per_week = int(m.group(1)) if m.group(1) else {"once": 1, "twice": 2, "thrice": 3}[m.group(2).lower()]
        t = _cut(t, m)

    return re.sub(r"\s+", " ", t).strip(), w


_DANGLING = re.compile(
    r"^(?:(?:at|on|by|before|due|around|till|until|in|for|from|to|this|next|the|and|then|pls|please|na|ko|ka|ki|ke|"
    r"se|me|mein|hai|hain|a)\b[\s,.:;-]*)+|[\s,.:;-]*(?:\b(?:at|on|by|before|due|around|till|until|in|for|from|to|this|next|and|then|"
    r"pls|please|na|hai|hain|aur|a|the)\b[\s,.:;-]*)+$", re.I)


def tidy_title(title: str) -> str:
    t = re.sub(r"\s+", " ", title or "").strip()
    for _ in range(3):
        nxt = _DANGLING.sub("", t).strip(" ,.:;-—")
        if nxt == t:
            break
        t = nxt
    if t and t[0].islower():
        t = t[0].upper() + t[1:]
    return t


# ---------------------------------------------------------------------------
# Intent
# ---------------------------------------------------------------------------

_GREETING = re.compile(
    r"^\s*(?:(?:hey|hi|hello|yo|ok|okay|alright|so|um+|uh+|hmm+|well)\b[\s,.!:]*)*"
    r"(?:(?:sage|siri|jarvis)\b[\s,.!:]*)?"
    r"(?:(?:please|pls|plz|kindly|just|quickly)\b[\s,]*)*"
    r"(?:(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?|(?:i\s+(?:want|need|would\s+like|d\s+like)\s+you\s+to|go\s+ahead\s+and|i'?d\s+like\s+you\s+to)\s+)?"
    r"(?:(?:please|pls|plz|kindly|just|quickly)\b[\s,]*)*"
    r"(?:mujhe\s+|mujhko\s+|mera\s+|meri\s+)?", re.I)

_QUERY = [
    (r"\bwhat(?:'s| is)?\s+(?:next|up)\b|\bwhat should i do\b|\bwhat now\b", "next"),
    (r"\bhow many\b.*\b(?:tasks?|things|items|todos?|to-?dos?)\b|\bcount\b.*\btasks?\b", "count"),
    (r"\b(?:what|kya)\b.*\b(?:overdue|late|pending|missed)\b|\b(?:anything|any|show|list)\b.*\b(?:overdue|late|missed)\b|\boverdue\b", "overdue"),
    (r"\b(?:what(?:'s|s| is| are)?|what do i have|what have i got|anything|do i have|any|show|tell|read|list|give)\b.*\b(?:on|for|due|today|tomorrow|overdue|inbox|pending|plans?|schedule|agenda|tasks?|to ?do|left|next)\b", "list"),
    (r"\b(?:kya hai|kya karna hai|kya baaki hai)\b", "list"),
]
_QUERY_START = re.compile(r"^(?:what|whats|what's|show|list|read|tell|how many|do i|anything|any|which|when|where|kya|check|am i)\b", re.I)

_COMPLETE = [
    re.compile(r"^(?:mark|set|tick|check)\s+(?:off\s+)?(?:the\s+)?(?P<t>.+?)\s+(?:as\s+)?(?:done|complete|completed|finished|over)$", re.I),
    re.compile(r"^(?:tick|check|cross|strike|scratch)\s+(?:off|out)\s+(?P<t>.+)$", re.I),
    re.compile(r"^(?:i(?:'ve|\s+have|\s+just|\s+already|'d)?\s+)?(?:just\s+|already\s+)?(?:finished|completed|done with|did(?!\s+i\b)|done|wrapped up|knocked out|sorted|handled|nailed)\s+(?P<t>.+)$", re.I),
    re.compile(r"^(?:i\s+(?:have\s+|'ve\s+)?(?:already\s+)?(?:finished|completed|done|did)\s+)(?P<t>.+)$", re.I),
    re.compile(r"^(?P<t>.+?)\s+(?:is|are|was|has been|got)?\s*(?:done|finished|completed|complete|over|sorted|taken care of)$", re.I),
    re.compile(r"^(?P<t>.+?)\s+(?:ho gaya|ho gya|hogaya|ho gayi|ho gaye|kar diya|kardiya|kar liya|khatam|ho chuka|complete ho gaya|done ho gaya|hecho|terminado|termine|termin[eé])$", re.I),
    re.compile(r"^(?:ya hice|ya termin[eé]|listo)\s+(?P<t>.+)$", re.I),
]
_SNOOZE = re.compile(r"^(?:snooze|postpone|delay|defer|put off|push(?: back| off| out)?|remind me (?:about|of) .+ later)\s+(?P<t>.+?)(?:\s+(?:for|by|until|till|to))?$", re.I)
_MOVE = re.compile(r"^(?:move|reschedule|rebook|shift|bring forward)\s+(?:the\s+|my\s+)?(?P<t>.+?)(?:\s+(?:to|for|till|until|by|on|at))?$", re.I)
_NOTE = re.compile(
    r"^(?:make\s+(?:a\s+)?note(?:\s+that|\s+of|\s*[:,-])?|take\s+(?:a\s+)?note(?:\s+that|\s*[:,-])?|note\s+down|note\s+to\s+self|note\s*[:,-]|note\s+that|jot\s+down|jot|write\s+down|"
    r"remember\s+that|keep\s+in\s+mind|fyi|add\s+(?:a\s+)?note(?:\s*[:,-]|\s+that)?|new\s+note\s*[:,-]?|save\s+(?:this\s+)?note\s*[:,-]?)\s*(?:that\s+)?(?P<t>.+)$", re.I)
_TRACK = re.compile(r"^(?:start\s+|begin\s+)?track(?:ing)?\s+(?:my\s+)?(?P<t>.+)$", re.I)
_HABIT = re.compile(
    r"^(?:(?:start|begin|create|add|make|new|track|build|log)\s+(?:a\s+|an\s+|the\s+|new\s+)*habit(?:\s+of|\s+to|\s+called|\s*[:,-])?|"
    r"i\s+want\s+to\s+(?:start|build)\s+(?:a\s+)?habit(?:\s+of|\s+to)?|habit\s*[:,-]?)\s*(?P<t>.+)$", re.I)
_REMIND = re.compile(r"\bremind(?:er)?s?\b|\bset\s+(?:a\s+)?(?:reminder|alarm)\b|\bdon'?t\s+(?:let\s+me\s+)?forget\b|\byaad\s+dila\w*|\brecu[eé]rdame\b|\brecordarme\b|\brappelle[\s-]moi\b|\berinnere\s+mich\b|\bnudge me\b|\bping me\b|\bbuzz me\b", re.I)
_REMIND_STRIP = re.compile(
    r"(?:\bset\s+(?:a\s+)?reminder\s*(?:(?:to|for|about|that)\b)?\s*|\bremind(?:er)?\s*(?:me)?\s*(?:(?:to|about|of|that)\b)?\s*|\bdon'?t\s+(?:let\s+me\s+)?forget\s*(?:to|about)?\s*|"
    r"\byaad\s+dila\w*\s*|\brecu[eé]rdame\s*|\brecordarme\s*|\brappelle[\s-]moi\s*|\berinnere\s+mich\s*|\bnudge me\s*(?:to|about)?\s*|"
    r"\bping me\s*(?:to|about)?\s*|\bbuzz me\s*(?:to|about)?\s*)", re.I)
_ADD_LEAD = re.compile(
    r"^(?:(?:add|create|make|put|new|log|save|set\s+up|schedule|book|jot|record|insert|throw|stick)\s+(?:in\s+|into\s+)?(?:(?:a|an|the|one|another|new|my)\s+)*"
    r"(?:task|todo|to-do|to do|item|event|meeting|appointment|entry|thing)\s*(?::|-|to\b|for\b|about\b|that\s+says\b|called\b|named\b|titled\b)?\s*|"
    r"(?:add|put|throw|stick)\s+(?:this\s+|it\s+)?(?:to|on|in|into)\s+(?:my\s+)?(?:list|inbox|tasks|to-?do|todo list|sage)\s*[:,-]?\s*|"
    r"(?:task|todo|to-do)\s*[:\-,]\s*|(?:task|todo|to-do)\s+(?=\w)|"
    r"(?:i\s+(?:need|have|want|gotta|got|ought|must|should)\s+to|i\s+should|i\s+must|i\s+gotta|need\s+to|have\s+to|has\s+to|gotta|got\s+to|don'?t\s+forget\s+to|remember\s+to|"
    r"i\s+will|i'll|i\s+am\s+going\s+to|i'm\s+going\s+to|lemme|let\s+me)\s+|"
    r"(?:add|put)\s+)", re.I)
_EVENT_WORDS = re.compile(r"\b(?:meeting|meet|appointment|appt|interview|lunch|dinner|breakfast|coffee|call with|catch ?up|standup|stand-up|sync|class|session|flight|doctor|dentist)\b", re.I)


def strip_greeting(text: str) -> str:
    return _GREETING.sub("", text, count=1).strip()


def _words(s: str) -> List[str]:
    return [x for x in re.findall(r"[a-z0-9]+", _fold(s)) if x]


_STOP = set("the a an my to of for on in at and or with me i it is be do get this that please task item todo thing".split())


def _stem(word: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(word) > len(suf) + 2 and word.endswith(suf):
            return word[: -len(suf)]
    return word


def match_items(target: str, items: List[dict]) -> List[Tuple[float, dict]]:
    """Open items ranked by how well their title matches the spoken target."""
    key = re.search(r"\b([A-Za-z]{1,6})[\s-]?(\d{1,4})\b", target)
    scored: List[Tuple[float, dict]] = []
    want = [_stem(w) for w in _words(target) if w not in _STOP]
    if not want and not key:
        return []
    for it in items:
        score = 0.0
        if key and str(it.get("key") or "").lower() == f"{key.group(1)}-{key.group(2)}".lower():
            score = 1.0
        title_words = [_stem(w) for w in _words(it.get("title") or "") if w not in _STOP]
        if want and title_words:
            hits = 0.0
            for w in want:
                if w in title_words:
                    hits += 1
                else:
                    best = max((difflib.SequenceMatcher(None, w, tw).ratio() for tw in title_words), default=0)
                    if best >= 0.8:
                        hits += best * 0.9
                    elif len(w) >= 4 and any(tw.startswith(w) or w.startswith(tw) for tw in title_words if len(tw) >= 4):
                        hits += 0.7
            coverage = hits / len(want)
            extra = len(set(title_words) - set(want))
            score = max(score, coverage - min(0.15, 0.03 * extra))
            whole = difflib.SequenceMatcher(None, " ".join(want), " ".join(title_words)).ratio()
            score = max(score, whole * 0.9 if whole >= 0.8 else 0)
        if score > 0:
            scored.append((round(score, 3), it))
    scored.sort(key=lambda x: -x[0])
    return scored


def pick_item(target: str, items: List[dict]) -> Tuple[Optional[dict], List[dict], float]:
    """(the item, ambiguous candidates, confidence). Both empty when nothing fits."""
    ranked = match_items(target, items)
    if not ranked or ranked[0][0] < 0.6:
        return None, [], 0.0
    best = ranked[0]
    close = [it for sc, it in ranked if sc >= best[0] - 0.08 and sc >= 0.6]
    if len(close) > 1 and best[0] < 0.99:
        return None, close[:4], 0.5
    return best[1], [], min(0.95, 0.55 + best[0] * 0.4)


# ---------------------------------------------------------------------------
# The understood command
# ---------------------------------------------------------------------------

class Command:
    def __init__(self, raw: str):
        self.raw = raw
        self.intent = "add"
        self.title = ""
        self.body = ""               # note text
        self.date: Optional[str] = None
        self.time: Optional[str] = None
        self.in_minutes: Optional[int] = None
        self.for_minutes: Optional[int] = None
        self.priority: Optional[str] = None
        self.tags: List[str] = []
        self.location: Optional[str] = None
        self.repeat: Optional[str] = None
        self.duration: Optional[int] = None
        self.project_id: Optional[str] = None
        self.project_name: Optional[str] = None
        self.target: str = ""        # words naming an existing item
        self.target_id: Optional[str] = None
        self.query: Optional[str] = None
        self.habit_per_week: Optional[int] = None
        self.confidence = 0.0
        self.foreign = False
        self.engine = "rules"
        self.notes: List[str] = []
        self.explicit_when = False

    def public(self) -> dict:
        d = {"intent": self.intent, "title": self.title, "date": self.date, "time": self.time, "priority": self.priority,
             "repeat": self.repeat, "tags": self.tags, "project": self.project_name, "target": self.target or None,
             "query": self.query, "confidence": round(self.confidence, 2), "engine": self.engine}
        if self.in_minutes:
            d["inMinutes"] = self.in_minutes
        return {k: v for k, v in d.items() if v not in (None, [], "")}


class Context:
    """What Sage holds that the words may refer to."""

    def __init__(self, items=None, projects=None, habits=None):
        self.items: List[dict] = items or []        # open work items, normalised
        self.projects: List[dict] = projects or []
        self.habits: List[dict] = habits or []


def _find_project(text: str, projects: List[dict]) -> Tuple[Optional[dict], str]:
    """A project named after a preposition ("for the Sage project", "in Ci4 Work")."""
    for p in sorted(projects, key=lambda p: -len(p.get("name") or "")):
        name = (p.get("name") or "").strip()
        if len(name) < 3 or p.get("id") == "inbox":
            continue
        pat = rf"\b(?:in|to|under|for|into|on)\s+(?:the\s+|my\s+)?{re.escape(name)}(?:\s+project)?\b|\b{re.escape(name)}\s+project\b"
        m = re.search(pat, text, re.I)
        if m:
            return p, (text[:m.start()] + " " + text[m.end():]).strip()
    return None, text


def _quick(text: str, now: datetime.datetime):
    q = quick_add.parse_quick_add(text, now=now.replace(tzinfo=None))
    return q


def understand_rules(raw: str, now: datetime.datetime, ctx: Context) -> Command:
    cmd = Command(raw)
    text = re.sub(r"\s+", " ", (raw or "").replace("‎", "").replace("‏", "")).strip()
    norm = normalise_words(text)
    cmd.foreign = norm.foreign
    work = numbers_to_digits(norm.text)
    work = strip_greeting(work)
    work = re.sub(r"^[\s,.:;!?-]+", "", work)

    # Notes keep their words as spoken: no dates are pulled out of a note.
    m = _NOTE.match(work)
    if m:
        cmd.intent = "note"
        cmd.body = m.group(1 if m.re.groups == 1 else "t").strip() if False else m.group("t").strip()
        cmd.title = tidy_title(" ".join(cmd.body.split()[:8]))
        cmd.confidence = 0.92
        return cmd

    # Questions: scope by the date words in them.
    qtext, qw = extract_when(work, now)
    is_question = bool(_QUERY_START.match(work) or work.rstrip().endswith("?"))
    if is_question or (re.match(r"^(?:anything|any)\b", work, re.I)):
        for pat, kind in _QUERY:
            if re.search(pat, work, re.I):
                cmd.intent, cmd.query = "query", kind
                break
        if cmd.intent != "query" and re.search(r"\b(?:today|tomorrow|tonight|overdue|inbox|due|pending|next|schedule|agenda|plans?)\b", work, re.I):
            cmd.intent, cmd.query = "query", "list"
        if cmd.intent == "query":
            if re.search(r"\binbox\b", work, re.I):
                cmd.query = "inbox"
            elif re.search(r"\boverdue|late|missed\b", work, re.I):
                cmd.query = "overdue"
            cmd.date = qw.date or _quick(qtext, now).date or (now.date().isoformat() if cmd.query == "list" else None)
            cmd.confidence = 0.88
            return cmd

    # Habits are told apart before dates are cut, so "gym every day" survives.
    hm = _HABIT.match(work)
    if not hm:
        hm = _TRACK.match(work)
    if hm and re.match(r"^(?:start|begin)?\s*track", work, re.I) and not re.search(
            r"\b(?:habit|daily|every\s+\w+|each\s+\w+|times?\s+a\s+week|a\s+week|per\s+week|weekly)\b", work, re.I):
        hm = None  # "track the parcel" is not a habit
    if hm:
        body, w = extract_when(hm.group("t"), now)
        cmd.intent = "habit"
        q = _quick(body, now)
        cmd.title = tidy_title(q.title if q.title != "Untitled" else body)
        cmd.repeat = q.repeat_rule
        cmd.habit_per_week = w.habit_per_week or _per_week(q.repeat_rule)
        cmd.priority = w.priority
        cmd.confidence = 0.9 if cmd.title else 0.3
        return cmd

    work2, w = extract_when(work, now)
    cmd.in_minutes, cmd.for_minutes = w.in_minutes, w.for_minutes
    cmd.priority = w.priority
    reminder_cue = bool(_REMIND.search(work2))
    # Drop cue words before quick_add so it sees the plain task.
    rest = _REMIND_STRIP.sub(" ", work2) if reminder_cue else work2
    q = _quick(rest, now)
    cmd.tags, cmd.location, cmd.repeat, cmd.duration = q.tags, q.location, q.repeat_rule, q.duration_minutes
    cmd.priority = cmd.priority or (q.priority if q.priority in PRIORITIES else None)
    cmd.date = w.date or q.date
    cmd.time = w.time or q.time
    if w.bare_hour is not None and cmd.time == w.time:
        cmd.time = _time_by_context(cmd.time, w.bare_hour, work)
    cmd.explicit_when = bool(cmd.date or cmd.time or cmd.in_minutes or cmd.repeat)
    if w.for_minutes and not cmd.duration:
        cmd.duration = w.for_minutes
    cmd.habit_per_week = w.habit_per_week
    title = q.title if q.title != "Untitled" else ""
    # A time of day with no date means the next time it happens (reminders and events roll forward).
    title = tidy_title(title)
    low = title.lower()

    # --- intents about things already in Sage ---
    for pat in _COMPLETE:
        m = pat.match(low if False else title)
        if m:
            t = m.group("t").strip()
            if t and not re.match(r"^(?:it|that|this)$", t, re.I):
                cmd.intent, cmd.target = "complete", t
                cmd.confidence = 0.88
                break
    if cmd.intent == "add":
        m = _SNOOZE.match(title)
        if m:
            cmd.intent, cmd.target = "snooze", m.group("t").strip()
            cmd.confidence = 0.88
    if cmd.intent == "add":
        m = _MOVE.match(title)
        if m and (cmd.date or cmd.time or cmd.in_minutes) and _looks_existing(m.group("t"), ctx):
            cmd.intent, cmd.target = "move", m.group("t").strip()
            cmd.confidence = 0.85
    if cmd.intent in ("complete", "snooze", "move"):
        if cmd.intent == "snooze" and cmd.explicit_when and not cmd.in_minutes and (cmd.date or cmd.time):
            cmd.intent = "move"
        return _finish_target(cmd, ctx)

    # --- adds: project, kind, title ---
    project, title = _find_project(title, ctx.projects)
    if project:
        cmd.project_id, cmd.project_name = project["id"], project["name"]
        title = tidy_title(title)
    title = tidy_title(quick_add.strip_lead_in(title) if title else title)
    title = tidy_title(_ADD_LEAD.sub("", title, count=1)) or title
    if re.search(r"\bhai\b$", title, re.I):
        title = tidy_title(re.sub(r"\bhai\b$", "", title, flags=re.I))
    title = tidy_title(re.sub(r"\s+(?:to|on|in|into)\s+(?:my\s+|the\s+)?(?:list|inbox|tasks?|to-?do(?:\s+list)?|sage)$", "", title, flags=re.I)) or title
    cmd.title = title

    if reminder_cue:
        cmd.intent = "remind"
    elif _EVENT_WORDS.search(title) and (cmd.time or cmd.date) and re.search(r"\b(?:meeting|appointment|interview|lunch|dinner|breakfast|coffee|call with|catch ?up|standup)\b", title, re.I):
        cmd.intent = "event"
    cmd.confidence = _add_confidence(cmd)
    if text.endswith("?") and cmd.intent == "add":
        cmd.confidence = min(cmd.confidence, 0.45)  # a question we couldn't read, not a task
    return cmd


_EVENING_WORDS = re.compile(r"\b(?:dinner|supper|movie|party|date night|drinks|pub|concert|show|evening|night)\b", re.I)
_MORNING_WORDS = re.compile(r"\b(?:wake|get up|alarm|breakfast|gym|workout|run|jog|yoga|walk|standup|stand-up|meditat\w*|brush|school|bus)\b", re.I)


def _time_by_context(hhmm: str, spoken_hour: int, text: str) -> str:
    """"dinner at 8" is 20:00 and "wake up at 6" is 06:00: the words decide when am/pm wasn't said."""
    m = int(hhmm[3:])
    if _EVENING_WORDS.search(text) and 4 <= spoken_hour <= 11:
        return _hhmm(spoken_hour + 12, m)
    if _MORNING_WORDS.search(text) and 1 <= spoken_hour <= 11:
        return _hhmm(spoken_hour, m)
    return hhmm


def _per_week(rule: Optional[str]) -> Optional[int]:
    if not rule:
        return None
    if rule == "daily":
        return 7
    if rule == "weekdays":
        return 5
    if rule.startswith("weekly:"):
        return len(rule.split(":")[1].split(","))
    if rule == "weekly":
        return 1
    return None


def _looks_existing(target: str, ctx: Context) -> bool:
    return bool(pick_item(target, ctx.items)[0] or pick_item(target, ctx.items)[1])


_LEFTOVER_TIME = re.compile(
    r"\b(?:next|last|coming|following|after|before|until|till|later|week|weeks|month|months|weekend|tonight|noon|morning|evening|"
    r"afternoon|night|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|"
    r"april|june|july|august|september|october|november|december|am|pm|o'clock|hours?|minutes?|mins?|christmas|diwali|eid|"
    r"new year|holi|onam|pongal)\b", re.I)
_COMMAND_ONLY = {"snooze", "done", "mark", "postpone", "complete", "delete", "cancel", "remind", "reminder", "note", "habit", "task",
                 "add", "new", "move", "reschedule", "finish", "finished", "tick", "yes", "no", "ok", "okay", "hello", "hi", "hey"}


def _add_confidence(cmd: Command) -> float:
    letters = re.findall(r"[^\W\d_]{2,}", cmd.title)
    if not cmd.title or not letters or cmd.title.strip().lower().rstrip(".!") in _COMMAND_ONLY:
        return 0.2
    conf = 0.85 if len(letters) >= 2 else 0.7
    if cmd.foreign:
        conf = min(conf, 0.75)
    if cmd.intent == "remind" and not (cmd.date or cmd.time or cmd.in_minutes):
        conf = min(conf, 0.6)
    if not (cmd.date or cmd.time or cmd.in_minutes) and _LEFTOVER_TIME.search(cmd.title):
        conf = min(conf, 0.75)  # a day or time word the rules left in the title: worth a second reading
    return conf


def _finish_target(cmd: Command, ctx: Context) -> Command:
    item, close, conf = pick_item(cmd.target, ctx.items)
    if item:
        cmd.target_id = item["id"]
        cmd.title = item.get("title") or cmd.target
        cmd.confidence = conf
    elif close:
        cmd.notes = [f"{c.get('key') or ''} {c.get('title')}".strip() for c in close]
        cmd.confidence = 0.5
    else:
        cmd.confidence = 0.35 if cmd.intent == "complete" else 0.3
    return cmd


# ---------------------------------------------------------------------------
# The AI layer
# ---------------------------------------------------------------------------

LLM_PROMPT = """You turn one spoken or typed message from Vineeth into one command for his task manager, Sage.
The message may be slang, have typos or speech-to-text mistakes, mix languages (English with Hindi, Spanish, Tamil...), and the day or time may be at the start, middle or end.
Answer with JSON only, in exactly this shape:
{"intent": "add|remind|event|habit|note|complete|snooze|move|query|unknown",
 "title": "short clean title in his own words, without the day, time, repeat or priority words",
 "date": "YYYY-MM-DD or null", "time": "HH:MM (24 hour) or null",
 "repeat": "daily|weekdays|weekly|weekly:1,3,5|monthly|yearly|every:N:days|every:N:weeks|null",
 "priority": "low|medium|high|urgent|null",
 "project": "a name copied exactly from the projects list, or null",
 "target": "the key of an open item from the list when the message is about one that already exists, else null",
 "query": "list|overdue|inbox|count|next|null",
 "confidence": 0.0}

- add: a task to do. remind: he wants to be reminded at a time. event: a meeting or appointment at a time. habit: something to do regularly to build a routine. note: something to write down or remember (title is the first words, nothing else). complete: he says an existing item is done. snooze: push an existing item back a little. move: change an existing item's day or time. query: he asks what is on / due / overdue.
- Weekdays in repeat use 0=Sunday .. 6=Saturday.
- Work out dates from today's date given below. "kal" is tomorrow, "parso" the day after, "mañana" tomorrow, "aaj" today, "subah" morning, "shaam" evening, "raat" night, "5 baje" 5 o'clock.
- confidence: how sure you are of the whole command, 0 to 1. Use a low number when the message is unclear; never guess an item, project, date or time that the message does not give.
Never invent an item key, project or date."""


def _llm_context(now: datetime.datetime, ctx: Context, rules: Command) -> str:
    lines = [f"Today is {now.strftime('%A %Y-%m-%d')}, it is {now.strftime('%H:%M')} ({getattr(now.tzinfo, 'key', 'local time')})."]
    if ctx.projects:
        lines.append("Projects: " + ", ".join((p.get("name") or "") for p in ctx.projects[:40] if p.get("id") != "inbox"))
    if ctx.items:
        lines.append("Open items:")
        for it in ctx.items[:60]:
            lines.append(f"- {it.get('key') or it.get('id')}: {it.get('title')}")
    if ctx.habits:
        lines.append("Habits: " + ", ".join(h.get("name") or "" for h in ctx.habits[:30]))
    hint = rules.public()
    lines.append("What simple rules already found (may be wrong): " + json.dumps(hint, ensure_ascii=False))
    return "\n".join(lines)


def _ask_groq(system: str, user: str) -> str:
    primary = os.getenv("SAGE_VOICE_GROQ_MODEL", "").strip() or canvas_thinker._setting("GROQ_LLM_MODEL") or canvas_thinker.GROQ_DEFAULT_MODEL
    last = ""
    for model in dict.fromkeys([primary, canvas_thinker.GROQ_FALLBACK_MODEL]):
        try:
            res = httpx.post(
                canvas_thinker.GROQ_URL,
                headers={"Authorization": f"Bearer {canvas_thinker.groq_key()}"},
                json={"model": model, "temperature": 0, "max_tokens": 600,
                      "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
                timeout=LLM_TIMEOUT_S,
            )
        except httpx.HTTPError as e:
            last = f"couldn't reach Groq ({e})"
            continue
        if res.status_code == 401:
            raise RuntimeError("Groq rejected the API key")
        if res.status_code != 200:
            last = f"Groq said {res.status_code}"
            continue
        return res.json()["choices"][0]["message"].get("content") or ""
    raise RuntimeError(last or "Groq gave no answer")


def _ask_local(system: str, user: str) -> str:
    import ollama

    client = ollama.Client(timeout=LLM_TIMEOUT_S)
    res = client.generate(model=canvas_thinker.LOCAL_MODEL, prompt=f"{system}\n\n{user}", format="json", options={"temperature": 0})
    return res["response"]


def ask_llm(system: str, user: str) -> Tuple[str, str]:
    """(text, engine). Groq first when there is a key, then the local model. Raises when neither answers."""
    if canvas_thinker.groq_key():
        try:
            return _ask_groq(system, user), "groq"
        except Exception as e:
            print(f"Voice: Groq failed: {e}")
    if os.getenv("SAGE_VOICE_LOCAL", "1") != "0":
        return _ask_local(system, user), "local"
    raise RuntimeError("no AI available")


def ai_available() -> bool:
    return bool(canvas_thinker.groq_key()) or os.getenv("SAGE_VOICE_LOCAL", "1") != "0"


_REPEAT_OK = re.compile(r"^(?:daily|weekdays|weekly|monthly|yearly|weekly:[0-6](?:,[0-6])*|monthly:last|every:\d{1,3}:(?:days|weeks|months))$")


def _valid_date(s: Any, now: datetime.datetime) -> Optional[str]:
    if not isinstance(s, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return None
    try:
        d = datetime.date.fromisoformat(s)
    except ValueError:
        return None
    # Close to now: a date years away is the model guessing.
    if d < now.date() - datetime.timedelta(days=1) or d > now.date() + datetime.timedelta(days=366 * 2):
        return None
    return s


def _valid_time(s: Any) -> Optional[str]:
    if not isinstance(s, str):
        return None
    m = re.match(r"^([01]?\d|2[0-3]):([0-5]\d)$", s.strip())
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def _grounded(title: str, raw: str, foreign: bool) -> bool:
    """The AI's title uses the person's words, unless he spoke another language."""
    tw = [w for w in _words(title) if len(w) > 2 and w not in _STOP]
    if not tw:
        return False
    rw = set(_words(raw))
    hit = sum(1 for w in tw if w in rw or any(difflib.SequenceMatcher(None, w, r).ratio() >= 0.8 for r in rw))
    return hit / len(tw) >= 0.5 or foreign or bool(re.search(r"[^\x00-\x7f]", raw))


def clean_llm(raw_answer: str, command: Command, now: datetime.datetime, ctx: Context) -> Optional[dict]:
    answer = chat_capture._json_object(raw_answer, "intent")
    if not answer:
        return None
    out: dict = {}
    intent = str(answer.get("intent") or "").strip().lower()
    intent = {"add_task": "add", "task": "add", "reminder": "remind", "add_reminder": "remind", "add_event": "event",
              "add_habit": "habit", "add_note": "note", "done": "complete", "finish": "complete", "reschedule": "move"}.get(intent, intent)
    if intent not in INTENTS:
        return None
    out["intent"] = intent
    try:
        conf = float(answer.get("confidence"))
    except (TypeError, ValueError):
        conf = 0.5
    out["confidence"] = max(0.0, min(1.0, conf))
    title = re.sub(r"\s+", " ", str(answer.get("title") or "")).strip()[:140]
    if title and _grounded(title, command.raw, command.foreign):
        out["title"] = title
    out["date"] = _valid_date(answer.get("date"), now)
    out["time"] = _valid_time(answer.get("time"))
    repeat = str(answer.get("repeat") or "").strip().lower()
    out["repeat"] = repeat if _REPEAT_OK.match(repeat) else None
    priority = str(answer.get("priority") or "").strip().lower()
    out["priority"] = priority if priority in PRIORITIES else None
    names = {_norm(p.get("name")): p for p in ctx.projects if p.get("id") != "inbox"}
    project = names.get(_norm(answer.get("project")))
    out["project"] = project
    keys = {str(i.get("key") or i.get("id")).lower(): i for i in ctx.items}
    out["target"] = keys.get(str(answer.get("target") or "").strip().lower())
    query = str(answer.get("query") or "").strip().lower()
    out["query"] = query if query in ("list", "overdue", "inbox", "count", "next") else None
    return out


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def merge_llm(cmd: Command, llm: dict, engine: str) -> Command:
    """The AI fills what the rules couldn't. The rules' date, time, repeat and
    priority win when they found one: they came from words actually typed."""
    cmd.engine = engine
    if llm["intent"] == "unknown" and cmd.confidence < LOW_CONFIDENCE:
        return cmd
    # Take the AI's reading of intent when the rules were unsure or it is more confident than they were.
    if llm["intent"] != "unknown" and (cmd.confidence < ASK_AI_BELOW or llm["intent"] != cmd.intent) and llm["confidence"] >= cmd.confidence - 0.05:
        cmd.intent = llm["intent"]
    if llm.get("title") and (cmd.confidence < ASK_AI_BELOW or cmd.foreign or not cmd.title):
        if cmd.intent in ("add", "remind", "event", "habit", "note"):
            cmd.title = tidy_title(llm["title"])
    cmd.date = cmd.date or llm.get("date")
    cmd.time = cmd.time or llm.get("time")
    cmd.repeat = cmd.repeat or llm.get("repeat")
    cmd.priority = cmd.priority or llm.get("priority")
    if llm.get("project") and not cmd.project_id:
        cmd.project_id, cmd.project_name = llm["project"]["id"], llm["project"]["name"]
    if llm.get("target") and not cmd.target_id and cmd.intent in ("complete", "snooze", "move"):
        cmd.target_id = llm["target"]["id"]
        cmd.title = llm["target"].get("title") or cmd.title
    if llm.get("query") and cmd.intent == "query" and not cmd.query:
        cmd.query = llm["query"]
    if cmd.intent == "query" and not cmd.query:
        cmd.query = "list"
    if cmd.intent == "note" and not cmd.body:
        cmd.body = cmd.raw
    cmd.confidence = max(cmd.confidence, min(llm["confidence"], 0.95)) if llm["confidence"] >= 0.5 else cmd.confidence
    if cmd.intent in ("complete", "snooze", "move") and not cmd.target_id:
        cmd.confidence = min(cmd.confidence, 0.4)
    return cmd


def needs_ai(cmd: Command) -> bool:
    if cmd.intent in ("complete", "snooze", "move") and not cmd.target_id and not cmd.notes:
        return True
    return cmd.confidence < ASK_AI_BELOW or cmd.foreign


def understand(raw: str, now: datetime.datetime, ctx: Context, use_ai: bool = True,
               ask=None) -> Command:
    """Rules first, then the AI when needed. Never raises: the rules' answer stands."""
    cmd = understand_rules(raw, now, ctx)
    if not use_ai or not needs_ai(cmd) or not (raw or "").strip():
        return cmd
    ask = ask or ask_llm
    try:
        text, engine = ask(LLM_PROMPT, _llm_context(now, ctx, cmd) + f"\n\nMessage: {raw}")
        llm = clean_llm(text, cmd, now, ctx)
    except Exception as e:  # AI down, timed out, or gave nonsense: keep the rules' answer
        print(f"Voice: AI step skipped: {e}")
        cmd.notes.append("ai_unavailable")
        return cmd
    if not llm:
        cmd.notes.append("ai_unreadable")
        return cmd
    return merge_llm(cmd, llm, engine)


# ---------------------------------------------------------------------------
# Speaking back
# ---------------------------------------------------------------------------

def _say_time(hhmm: Optional[str]) -> str:
    if not hhmm:
        return ""
    h, m = int(hhmm[:2]), int(hhmm[3:])
    if (h, m) == (12, 0):
        return "noon"
    if (h, m) == (0, 0):
        return "midnight"
    suffix = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    return f"{h12} {suffix}" if m == 0 else f"{h12}:{m:02d} {suffix}"


def _say_date(iso: Optional[str], today: datetime.date) -> str:
    if not iso:
        return ""
    d = datetime.date.fromisoformat(iso)
    delta = (d - today).days
    if delta == 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if 1 < delta < 7:
        return d.strftime("%A")
    return d.strftime("%B ") + str(d.day)


def _say_when(date: Optional[str], time: Optional[str], today: datetime.date) -> str:
    bits = [b for b in (_say_date(date, today), ("at " + _say_time(time)) if time else "") if b]
    return " ".join(bits)


def _say_repeat(rule: Optional[str]) -> str:
    if not rule:
        return ""
    names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]
    if rule.startswith("weekly:"):
        return "every " + ", ".join(names[int(i)][:-1] for i in rule.split(":")[1].split(","))
    if rule.startswith("every:"):
        _, n, unit = rule.split(":")
        return f"every {n} {unit}"
    return {"daily": "every day", "weekdays": "every weekday", "weekly": "every week", "monthly": "every month", "yearly": "every year"}.get(rule, rule)


def _list_say(titles: List[str]) -> str:
    shown = titles[:5]
    if len(titles) > 5:
        return ", ".join(shown) + f" and {len(titles) - 5} more"
    if len(shown) > 1:
        return ", ".join(shown[:-1]) + " and " + shown[-1]
    return shown[0] if shown else ""


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def load_context() -> Context:
    projects = claude_api._rows("projects")
    types = item_shape.project_types(projects)
    items = [item_shape.normalize_item(i, types.get(i.get("projectId"))) for i in claude_api._rows("workItems")]
    open_items = [i for i in items if item_shape.is_open(i) and not item_shape.is_alarm(i) and not item_shape.is_hidden(i) and i.get("entityType") != "milestone"]
    return Context(open_items, projects, claude_api._rows("habits"))


def _local_iso(now: datetime.datetime) -> str:
    return now.strftime("%Y-%m-%dT%H:%M")


def _resolve_when(cmd: Command, now: datetime.datetime, roll: bool) -> None:
    """Fill the date from the time ("remind me at 5": today, or tomorrow if 5 has passed)."""
    if cmd.in_minutes:
        at = now + datetime.timedelta(minutes=cmd.in_minutes)
        cmd.date, cmd.time = at.date().isoformat(), at.strftime("%H:%M")
        return
    if cmd.repeat and cmd.repeat.startswith("weekly:") and not cmd.date:
        days = {(int(d) - 1) % 7 for d in cmd.repeat.split(":")[1].split(",")}  # app: Sun=0; Python: Mon=0
        for add in range(0, 8):
            d = now.date() + datetime.timedelta(days=add)
            if d.weekday() in days and not (add == 0 and cmd.time and cmd.time <= now.strftime("%H:%M")):
                cmd.date = d.isoformat()
                break
        return
    roll = roll or bool(cmd.repeat)
    if cmd.time and not cmd.date:
        today = now.date()
        passed = cmd.time <= now.strftime("%H:%M")
        cmd.date = (today + datetime.timedelta(days=1 if (roll and passed) else 0)).isoformat()


def _fields_for_item(cmd: Command, now: datetime.datetime, kind: str) -> dict:
    fields: Dict[str, Any] = {"title": cmd.title, "entityType": kind, "status": "todo", "source": SOURCE}
    if cmd.date:
        fields["dueDate"] = cmd.date
    if cmd.time:
        fields["dueTime"] = cmd.time
    if cmd.priority:
        fields["priority"] = cmd.priority
    if cmd.tags:
        fields["labels"] = cmd.tags
    if cmd.location:
        fields["location"] = cmd.location
    if cmd.repeat:
        fields["repeatRule"] = cmd.repeat
    if cmd.duration:
        fields["estimatedMinutes"] = cmd.duration
    if cmd.project_id:
        fields["projectId"] = cmd.project_id
    if kind == "reminder":
        fields["reminderLeadMinutes"] = 0
        if cmd.date:
            fields["remindAt"] = f"{cmd.date}T{cmd.time or '09:00'}"
            fields.setdefault("dueTime", cmd.time or "09:00")
    return fields


def _remind_at(item: dict, date: Optional[str], time: Optional[str]) -> Optional[str]:
    lead = item.get("reminderLeadMinutes")
    if lead is None or not date:
        return None
    at = datetime.datetime.fromisoformat(f"{date}T{time or '09:00'}") - datetime.timedelta(minutes=int(lead))
    return at.strftime("%Y-%m-%dT%H:%M")


def _habit_fields(cmd: Command) -> dict:
    per_week = cmd.habit_per_week or _per_week(cmd.repeat) or 7
    return {"name": cmd.title, "targetCount": max(1, min(7, per_week)), "frequency": "daily" if per_week >= 7 else f"{per_week}/week"}


async def execute(cmd: Command, now: datetime.datetime, ctx: Context) -> dict:
    """Do it. Returns {say, item?, clarify?, saved}. Unclear adds land in the Inbox as typed."""
    today = now.date()
    low = cmd.confidence < LOW_CONFIDENCE
    out: Dict[str, Any] = {"saved": False}

    if cmd.intent == "query":
        out["say"] = _answer_query(cmd, now, ctx)
        return out

    if cmd.intent in ("complete", "snooze", "move"):
        return await _execute_existing(cmd, now, ctx)

    if cmd.intent == "note":
        body = cmd.body or cmd.raw
        note = await claude_api.create_record("notes", {"title": cmd.title or "Note", "content": body, "source": SOURCE})
        out.update(saved=True, record=note, say="Noted. I saved it in your notes.")
        return out

    if cmd.intent == "habit":
        if not cmd.title:
            return {**out, "clarify": True, "say": "What habit should I track?"}
        existing = next((h for h in ctx.habits if _norm(h.get("name")) == _norm(cmd.title)), None)
        if existing:
            out.update(say=f"You already track {existing['name']}.", record=existing)
            return out
        habit = await claude_api.create_record("habits", _habit_fields(cmd))
        freq = "every day" if habit.get("targetCount", 7) >= 7 else f"{habit['targetCount']} days a week"
        out.update(saved=True, record=habit, say=f"Started the habit {habit['name']}, {freq}.")
        return out

    # add / remind / event
    if cmd.intent == "remind" and not cmd.title:
        return {**out, "clarify": True, "say": "What should I remind you about?"}
    if not cmd.title or low:
        title = tidy_title(cmd.raw)[:140] or "Untitled"
        fields = {"title": title, "entityType": "task", "status": "todo", "source": SOURCE,
                  "description": f"Heard: {cmd.raw}", "labels": ["check"]}
        item = await claude_api.create_record("workItems", fields)
        out.update(saved=True, item=item, lowConfidence=True,
                   say=f"I wasn't sure what you meant, so I saved \"{title}\" to your inbox as it was.")
        return out

    kind = {"remind": "reminder", "event": "event"}.get(cmd.intent, "task")
    _resolve_when(cmd, now, roll=kind in ("reminder", "event"))
    if kind == "reminder" and not cmd.date:
        # A reminder with no time can't ring; keep it as an Inbox task so it isn't lost.
        fields = _fields_for_item(cmd, now, "task")
        fields["description"] = "Reminder with no time given."
        item = await claude_api.create_record("workItems", fields)
        out.update(saved=True, item=item,
                   say=f"I didn't hear a time, so I added {item['title']} to your inbox instead of setting a reminder.")
        return out
    item = await claude_api.create_record("workItems", _fields_for_item(cmd, now, kind))
    when = _say_when(item.get("dueDate"), item.get("dueTime"), today)
    repeat = _say_repeat(item.get("repeatRule"))
    verb = {"reminder": "I'll remind you to", "event": "Booked"}.get(kind, "Added")
    where = f" in {cmd.project_name}" if cmd.project_name else ""
    prio = f", marked {item['priority']}" if cmd.priority in ("high", "urgent") else ""
    line = f"{verb} {item['title']}" if kind != "reminder" else f"{verb} {item['title']}"
    tail = " ".join(x for x in (when, repeat) if x)
    out.update(saved=True, item=item, say=f"{line}{where}{(' ' + tail) if tail else ''}{prio}." if kind != "task" or tail or where or prio else f"Added {item['title']} to your inbox." if item.get("isInbox") else f"Added {item['title']}.")
    return out


async def _execute_existing(cmd: Command, now: datetime.datetime, ctx: Context) -> dict:
    out: Dict[str, Any] = {"saved": False}
    if not cmd.target_id:
        if cmd.notes and "ai_unavailable" not in cmd.notes[0:1] and not set(cmd.notes) <= {"ai_unavailable", "ai_unreadable"}:
            names = [n for n in cmd.notes if n not in ("ai_unavailable", "ai_unreadable")]
            return {**out, "clarify": True, "choices": names,
                    "say": "I found a few that match: " + _list_say(names) + ". Say a bit more of the name."}
        # Maybe it's a habit being ticked: "did gym today".
        if cmd.intent == "complete":
            habit = next((h for h in ctx.habits if pick_item(cmd.target, [{"id": h["id"], "title": h.get("name")}])[0]), None)
            if habit:
                day = now.date().isoformat()
                history = list(habit.get("history") or [])
                if day not in history:
                    history.append(day)
                    await claude_api.update_record("habits", habit["id"], {"history": history})
                return {**out, "saved": True, "say": f"Ticked {habit['name']} for today."}
        return {**out, "clarify": True, "say": f"I couldn't find \"{cmd.target}\" in your open items. Nothing was changed."}
    item = next((i for i in ctx.items if i["id"] == cmd.target_id), None)
    if not item:
        return {**out, "clarify": True, "say": "I couldn't find that item any more."}
    title = item.get("title") or "that"
    if cmd.intent == "complete":
        if cmd.confidence < LOW_CONFIDENCE:
            return {**out, "clarify": True, "say": f"Did you mean {title}? Say its full name to mark it done."}
        rec = await claude_api.update_record("workItems", item["id"], {"status": "done"})
        return {**out, "saved": True, "item": rec, "say": f"Marked {title} as done."}
    if cmd.intent == "snooze" and not (cmd.date or cmd.time):
        minutes = cmd.in_minutes or cmd.for_minutes or 60
        until = (now.astimezone(datetime.timezone.utc) + datetime.timedelta(minutes=minutes))
        rec = await claude_api.update_record("workItems", item["id"], {
            "snoozedUntil": until.isoformat(), "snoozeCount": (item.get("snoozeCount") or 0) + 1})
        span = f"{minutes // 60} hour{'s' if minutes // 60 != 1 else ''}" if minutes % 60 == 0 else f"{minutes} minutes"
        return {**out, "saved": True, "item": rec, "say": f"Snoozed {title} for {span}."}
    # move / snooze with a day or time
    _resolve_when(cmd, now, roll=False)
    if not (cmd.date or cmd.time):
        return {**out, "clarify": True, "say": f"To when should I move {title}?"}
    fields: Dict[str, Any] = {"snoozedUntil": None}
    date = cmd.date or item.get("dueDate")
    time = cmd.time or item.get("dueTime")
    if date:
        fields["dueDate"] = date
    if cmd.time:
        fields["dueTime"] = cmd.time
    remind = _remind_at(item, date, time)
    if remind:
        fields["remindAt"] = remind
    rec = await claude_api.update_record("workItems", item["id"], fields)
    return {**out, "saved": True, "item": rec,
            "say": f"Moved {title} to {_say_when(date, cmd.time or (item.get('dueTime') if not cmd.date else None), now.date())}."}


def _answer_query(cmd: Command, now: datetime.datetime, ctx: Context) -> str:
    today = now.date().isoformat()
    items = ctx.items
    kind = cmd.query or "list"

    def titles(sel):
        return [i.get("title") or "Untitled" for i in sel]

    def sort_key(i):
        return (str(i.get("dueDate") or "9999"), str(i.get("dueTime") or "99:99"), ["urgent", "high", "medium", "low"].index(i.get("priority") if i.get("priority") in PRIORITIES else "medium"))

    if kind == "count":
        return f"You have {len(items)} open item{'s' if len(items) != 1 else ''}."
    if kind == "inbox":
        sel = [i for i in items if i.get("isInbox")]
        return f"Your inbox has {len(sel)}: {_list_say(titles(sel))}." if sel else "Your inbox is empty."
    if kind == "overdue":
        sel = sorted([i for i in items if i.get("dueDate") and str(i["dueDate"]) < today], key=sort_key)
        return f"{len(sel)} overdue: {_list_say(titles(sel))}." if sel else "Nothing is overdue."
    if kind == "next":
        sel = sorted([i for i in items if i.get("dueDate") and str(i["dueDate"]) <= today] or [i for i in items if i.get("isFocus")] or items, key=sort_key)
        return f"Next up: {sel[0].get('title')}." if sel else "You're all clear."
    date = cmd.date or today
    day = _say_date(date, now.date())
    sel = sorted([i for i in items if i.get("dueDate") and (str(i["dueDate"]) == date or (date == today and str(i["dueDate"]) < today))], key=sort_key)
    if not sel:
        return f"Nothing is due {day}." if day != "today" else "Nothing is due today."
    return f"{day.capitalize()} you have {len(sel)}: {_list_say(titles(sel))}." if len(sel) > 1 else f"{day.capitalize()} you have {_list_say(titles(sel))}."


async def handle(text: str, now: datetime.datetime, dry_run: bool = False, ask=None, ctx: Optional[Context] = None,
                 use_ai: bool = True) -> dict:
    text = (text or "").strip()
    if not text:
        return {"success": False, "say": "I didn't catch anything.", "clarify": True}
    ctx = ctx or load_context()
    cmd = await asyncio.to_thread(understand, text, now, ctx, use_ai, ask)
    result: Dict[str, Any] = {"success": True, "understood": cmd.public(), "engine": cmd.engine}
    if dry_run:
        result["say"] = f"Understood as {cmd.intent}: {cmd.title or cmd.target or cmd.query or ''}".strip()
        result["dryRun"] = True
        return result
    done = await execute(cmd, now, ctx)
    result.update({k: v for k, v in done.items() if k not in ("record",)})
    result["success"] = True
    return result
