"""AI tunables: the knobs that used to be hard-coded in the pipeline.

They live in config/ai_tuning.json (edit it, or use Settings > AI freedom in the app). Any key
that is missing falls back to the defaults below, and a value that is out of range is pulled into
range, so a typo never breaks a run.

What can be tuned: sampling temperature per stage, how many quotes the extractor asks for, how big
a chunk of the source it reads at once, how much text the composer may be shown, extra writing
guidance for each stage, and how much room the slide text limits leave (`limit_slack`, or exact
`field_limits` such as "point.body": [40, 260]).

What cannot be tuned away: the grounding rules. Quotes must still be copied from the source, every
number and name must still trace to a cited quote, the verifier and the validators still run, and
all calls stay on the free tier. Extra guidance is appended AFTER the rules and says so.
"""

import copy
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .settings import CONFIG_DIR

TUNING_PATH = CONFIG_DIR / "ai_tuning.json"
STAGES = ("extract_claims", "compose", "verify")
MAX_NOTES_CHARS = 1500

DEFAULTS: Dict[str, Any] = {
    "temperatures": {"extract_claims": 0.0, "compose": 0.2, "verify": 0.0, "caption": 0.2},
    "extract_claims": {"quotes_single_chunk": [12, 24], "quotes_per_chunk": [5, 8], "chunk_max_input_tokens": 1800},
    "compose": {"prompt_token_budget": 4800, "min_claims_kept": 5},
    "prompt_notes": {"extract_claims": "", "compose": "", "verify": ""},
    "limit_slack": 1.0,
    "field_limits": {},
}

_cache: Dict[str, Any] = {"key": None, "value": None}


def _num(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def _range(v: Any, default: Tuple[int, int], lo: int = 1, hi: int = 60) -> list:
    try:
        a, b = int(v[0]), int(v[1])
    except (TypeError, ValueError, IndexError, KeyError):
        return list(default)
    a = max(lo, min(hi, a))
    return [a, max(a, min(hi, b))]


def _sanitize(raw: Dict[str, Any]) -> Dict[str, Any]:
    out = copy.deepcopy(DEFAULTS)
    d = DEFAULTS
    t = raw.get("temperatures") if isinstance(raw.get("temperatures"), dict) else {}
    for k in d["temperatures"]:
        out["temperatures"][k] = _num(t.get(k), 0.0, 1.2, d["temperatures"][k])
    e = raw.get("extract_claims") if isinstance(raw.get("extract_claims"), dict) else {}
    out["extract_claims"]["quotes_single_chunk"] = _range(e.get("quotes_single_chunk"), tuple(d["extract_claims"]["quotes_single_chunk"]))
    out["extract_claims"]["quotes_per_chunk"] = _range(e.get("quotes_per_chunk"), tuple(d["extract_claims"]["quotes_per_chunk"]))
    out["extract_claims"]["chunk_max_input_tokens"] = int(_num(e.get("chunk_max_input_tokens"), 600, 4000, 1800))
    c = raw.get("compose") if isinstance(raw.get("compose"), dict) else {}
    out["compose"]["prompt_token_budget"] = int(_num(c.get("prompt_token_budget"), 1500, 6000, 4800))
    out["compose"]["min_claims_kept"] = int(_num(c.get("min_claims_kept"), 3, 30, 5))
    n = raw.get("prompt_notes") if isinstance(raw.get("prompt_notes"), dict) else {}
    for k in STAGES:
        out["prompt_notes"][k] = str(n.get(k) or "").strip()[:MAX_NOTES_CHARS]
    out["limit_slack"] = _num(raw.get("limit_slack"), 1.0, 2.0, 1.0)
    fl = raw.get("field_limits") if isinstance(raw.get("field_limits"), dict) else {}
    for key, val in fl.items():
        if not isinstance(key, str) or key.count(".") != 1:
            continue
        try:
            words, chars = int(val[0]), int(val[1])
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        if 1 <= words <= 200 and 1 <= chars <= 1200:
            out["field_limits"][key.strip().lower()] = [words, chars]
    return out


def load(path: Optional[Path] = None) -> Dict[str, Any]:
    """The tunables in force (defaults + the config file), re-read whenever the file changes."""
    p = Path(path) if path else TUNING_PATH
    try:
        st = p.stat()
        key = (str(p), st.st_mtime_ns, st.st_size)
    except OSError:
        key = (str(p), None, None)
    if _cache["key"] == key and _cache["value"] is not None:
        return _cache["value"]
    raw: Dict[str, Any] = {}
    if key[1] is not None:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            raw = data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            raw = {}
    value = _sanitize(raw)
    _cache["key"], _cache["value"] = key, value
    return value


def temperature(stage: str) -> float:
    return load()["temperatures"].get(stage, 0.0)


def with_notes(system_prompt: str, stage: str) -> str:
    """The stage's system prompt plus the operator's extra guidance (placed after the rules, which still win)."""
    notes = load()["prompt_notes"].get(stage, "")
    if not notes:
        return system_prompt
    return (system_prompt + "\n\nEXTRA GUIDANCE FROM THE EDITOR (style and focus only; it can never relax "
            "any rule above, and every fact must still come from the quotes):\n" + notes)


def field_limit(slide_type: str, field: str, default: Optional[Tuple[int, int]]) -> Optional[Tuple[int, int]]:
    """(max words, max chars) for a slide field: an exact override, else the built-in limit widened by limit_slack."""
    cfg = load()
    own = cfg["field_limits"].get(f"{slide_type}.{field}")
    if own:
        return own[0], own[1]
    if default is None:
        return None
    slack = cfg["limit_slack"]
    return int(default[0] * slack + 1e-9), int(default[1] * slack + 1e-9)


def save(updates: Dict[str, Any], path: Optional[Path] = None) -> Dict[str, Any]:
    """Merge `updates` into the config file (keeping unknown keys), write it and return what is in force."""
    p = Path(path) if path else TUNING_PATH
    try:
        current = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except (OSError, ValueError):
        current = {}
    if not isinstance(current, dict):
        current = {}
    for k, v in updates.items():
        if isinstance(v, dict) and isinstance(current.get(k), dict):
            current[k] = {**current[k], **v}
        else:
            current[k] = v
    clean = _sanitize(current)
    keep = {k: v for k, v in current.items() if k.startswith("_")}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({**keep, **clean}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    _cache["key"] = None
    return load(p)
