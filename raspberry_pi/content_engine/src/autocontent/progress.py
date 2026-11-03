"""Live progress reporting shared by the pipeline, LLM clients, CLI and GUI.

Every stage calls `report("...")`. By default each line goes to stderr as
`[ 12.3s | +4.1s] message`: total seconds since the run started, then seconds
since the previous line (how long the previous step took). A caller can swap
in its own listener with `listening(fn)`; the GUI reads the stderr lines of the
`autocontent run` subprocess.
"""

from contextlib import contextmanager
import re
import sys
import time
from typing import Callable, Iterator, Optional

ProgressFn = Callable[[str], None]

# Matches the prefix written by format_line, so readers (GUI) can spot progress lines
LINE_RE = re.compile(r"^\[\s*\d+\.\d+s \| \+\d+\.\d+s\] ")

_listener: Optional[ProgressFn] = None
_start: Optional[float] = None
_last: Optional[float] = None


def reset() -> None:
    """Restart the elapsed-time clock (called at the start of each run)."""
    global _start, _last
    _start = _last = time.time()


def format_line(msg: str) -> str:
    """Prefix a message with total and per-step elapsed seconds."""
    global _start, _last
    now = time.time()
    if _start is None:
        _start = _last = now
    line = f"[{now - _start:5.1f}s | +{now - _last:.1f}s] {msg}"
    _last = now
    return line


def _print_stderr(msg: str) -> None:
    try:
        print(format_line(msg), file=sys.stderr, flush=True)
    except UnicodeEncodeError:
        print(format_line(msg).encode("ascii", errors="replace").decode("ascii"), file=sys.stderr, flush=True)


def report(msg: str) -> None:
    """Emit one human-readable progress line."""
    (_listener or _print_stderr)(msg)


@contextmanager
def listening(fn: Optional[ProgressFn]) -> Iterator[None]:
    """Route progress lines to `fn` (None keeps the current listener) for the block."""
    global _listener
    previous = _listener
    if fn is not None:
        _listener = fn
    try:
        yield
    finally:
        _listener = previous
