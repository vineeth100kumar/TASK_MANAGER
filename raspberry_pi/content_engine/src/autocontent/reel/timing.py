"""When does each slide start and end, and when does each of its pieces appear?

Kept free of anything heavy so it can be tested with made-up word times.
"""

from typing import List, Optional, Sequence, Tuple

from .align import Timed, norm

LEAD = 0.18        # a piece arrives this long before the word that introduces it
MIN_STEP = 0.28    # and no two pieces start closer than this
SCENE_MIN = 1.6
OPEN = 0.12        # the first piece arrives just after the slide starts


def find_cue(cue: str, words: Sequence[Timed], after: int) -> Optional[int]:
    """Index of the first word of `cue` in the slide's words, searching from `after`."""
    target = [norm(w) for w in cue.split() if norm(w)]
    if not target:
        return None
    heard = [norm(w.text) for w in words]
    for i in range(max(after, 0), len(words) - len(target) + 1):
        if heard[i:i + len(target)] == target:
            return i
    return None


def plan_reveals(groups: int, cues: Sequence[str], words: Sequence[Timed], t0: float, t1: float, exit_s: float) -> List[float]:
    """The time each of `groups` pieces starts arriving, in order."""
    if groups <= 0:
        return []
    latest = max(t0 + OPEN, t1 - exit_s - 0.5)
    times: List[Optional[float]] = [None] * groups
    # cues name the pieces from the first, or from the second when the first just opens the slide
    offset = 1 if (len(cues) == groups - 1 and groups > 1) else 0
    last_idx = 0
    for k, cue in enumerate(cues):
        g = k + offset
        if g >= groups:
            break
        idx = find_cue(cue, words, last_idx)
        if idx is not None:
            times[g] = words[idx].start - LEAD
            last_idx = idx + 1
    times[0] = t0 + OPEN if times[0] is None or offset else times[0]
    n = len(words)
    for g in range(1, groups):
        if times[g] is None:
            if n:
                idx = min(n - 1, round(g * n / groups))
                times[g] = words[idx].start - LEAD
            else:
                times[g] = t0 + (t1 - t0) * g / groups
    out: List[float] = []
    prev = -1e9
    for g, t in enumerate(times):
        t = max(t, t0 + OPEN) if g == 0 else max(t, prev + MIN_STEP)
        out.append(min(t, latest))
        prev = out[-1]
    # clamping to `latest` can squeeze the last pieces together; keep them ordered
    for g in range(1, groups):
        out[g] = max(out[g], out[g - 1] + 0.12)
    return out


def scene_windows(word_spans: Sequence[Optional[Tuple[float, float]]], durations: Sequence[Optional[float]],
                  end_hold: float, exit_s: float) -> List[Tuple[float, float]]:
    """(start, end) of every slide on the reel's clock, from where its first and last word are spoken
    (None for a silent slide, which lasts its `duration`). A slide starts a moment before its first
    word and ends just after its last one; the next one takes over right then."""
    n = len(word_spans)
    starts: List[float] = [0.0] * n
    ends: List[float] = [0.0] * n
    t = 0.0
    for i, span in enumerate(word_spans):
        if i == 0:
            starts[i] = 0.0
        if span is None:
            hold = durations[i] or 3.0
            ends[i] = starts[i] + hold
        else:
            ends[i] = max(span[1] + 0.12, starts[i] + SCENE_MIN)
        if i + 1 < n:
            nxt = word_spans[i + 1]
            if nxt is None:
                starts[i + 1] = ends[i]
            else:
                starts[i + 1] = max(ends[i], nxt[0] - 0.14)
                ends[i] = starts[i + 1]
    ends[-1] = (word_spans[-1][1] if word_spans[-1] else ends[-1]) + end_hold
    ends[-1] = max(ends[-1], starts[-1] + SCENE_MIN)
    return list(zip(starts, ends))
