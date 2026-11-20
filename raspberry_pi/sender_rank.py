"""
sender_rank.py - who messages you often, learned from counts alone.

Each notification from a named sender adds one point to their score; scores
fade with a two-week half-life, so someone who has gone quiet drifts back to a
stranger. Only the sender's name, a score and times are kept, never any text.
Pure functions; speaker.py keeps the dict in the metadata table.
"""

from typing import Dict, List

HALF_LIFE_S = 14 * 24 * 3600
REGULAR_SCORE = 2.0            # about weekly messaging stays above this
KEEP = 200


def decayed(entry: Dict, now: float) -> float:
    age = max(0.0, now - float(entry.get("last", now)))
    return float(entry.get("score", 0.0)) * 0.5 ** (age / HALF_LIFE_S)


def bump(stats: Dict, sender: str, now: float) -> Dict:
    key = (sender or "").strip().lower()
    if not key:
        return stats
    entry = stats.get(key, {"score": 0.0, "count": 0, "name": sender.strip()})
    stats[key] = {
        "name": sender.strip(),
        "score": decayed(entry, now) + 1.0,
        "last": now,
        "count": int(entry.get("count", 0)) + 1,
    }
    return stats


def is_regular(stats: Dict, sender: str, now: float) -> bool:
    entry = stats.get((sender or "").strip().lower())
    return bool(entry) and decayed(entry, now) >= REGULAR_SCORE


def top(stats: Dict, now: float, limit: int = 10) -> List[str]:
    ranked = sorted(stats.values(), key=lambda e: (-decayed(e, now), e.get("name", "").lower()))
    return [e["name"] for e in ranked[:limit]]


def rank_names(stats: Dict, names: List[str], now: float) -> List[str]:
    """`names` ordered by score, strongest first (unknown names keep their order, last)."""
    def score(n: str) -> float:
        e = stats.get(n.strip().lower())
        return decayed(e, now) if e else 0.0
    return sorted(names, key=lambda n: -score(n))


def prune(stats: Dict, now: float, keep: int = KEEP) -> Dict:
    if len(stats) <= keep:
        return stats
    ranked = sorted(stats.items(), key=lambda kv: -decayed(kv[1], now))
    return dict(ranked[:keep])
