"""Keep slide drawing from slowing the rest of Sage down.

Drawing a post starts Chromium, which reads and writes a lot of files and can
use gigabytes of memory. On a Pi with a slow disk, that is what makes the
web app stall while a post is being made. Three small tools, all best effort
and all quiet where the system doesn't support them:

* ``lower()``: run in the child just before it starts. Lowers its CPU
  priority (nice) and its disk priority (ioprio), so the app is served first.
* ``group_rss_mb()``: how much memory a whole process group (the engine and
  its Chromium) is using, read from /proc.
* ``kill_group()``: stop the engine and every process it started. Killing only
  the engine would leave its Chromium behind.

Disk priority only has an effect with an I/O scheduler that honours it
(BFQ, or mq-deadline for the idle class); on "none" it is accepted and ignored.
SAGE_POSTS_IONICE chooses it: "7" (default: lowest normal priority, still
always makes progress), "idle" (only when the disk is otherwise unused; can
starve), or "off".
"""

import ctypes
import os
import platform
import signal
from typing import Optional

# ioprio_set(2) has no libc wrapper; its number depends on the CPU.
_SYSCALL = {"x86_64": 251, "aarch64": 30, "armv7l": 314, "armv6l": 314, "i686": 289, "i386": 289}
_IOPRIO_WHO_PROCESS = 1
_CLASS_BEST_EFFORT, _CLASS_IDLE = 2, 3
_SHIFT = 13

try:  # loaded now, not in the child after fork
    _libc = ctypes.CDLL(None, use_errno=True) if os.name == "posix" else None
except OSError:
    _libc = None


def io_priority_value(setting: Optional[str] = None) -> Optional[int]:
    """The ioprio value for SAGE_POSTS_IONICE, or None when it is off."""
    setting = (os.environ.get("SAGE_POSTS_IONICE", "7") if setting is None else setting).strip().lower()
    if setting in ("off", "0", "no", "false", ""):
        return None
    if setting == "idle":
        return _CLASS_IDLE << _SHIFT
    try:
        level = max(0, min(7, int(setting)))
    except ValueError:
        level = 7
    return (_CLASS_BEST_EFFORT << _SHIFT) | level


def set_io_priority(value: Optional[int]) -> bool:
    """Apply an ioprio value to this process. True if the system took it."""
    number = _SYSCALL.get(platform.machine())
    if value is None or _libc is None or number is None:
        return False
    try:
        return _libc.syscall(number, _IOPRIO_WHO_PROCESS, 0, value) == 0
    except Exception:
        return False


def lower(nice: int) -> None:
    """For subprocess preexec_fn: run quietly (CPU and disk) in the child."""
    try:
        os.nice(nice)
    except OSError:
        pass
    set_io_priority(io_priority_value())


def parse_scheduler(text: str) -> Optional[str]:
    """The active I/O scheduler from a sysfs line like "none [mq-deadline] kyber"."""
    for word in text.split():
        if word.startswith("[") and word.endswith("]"):
            return word[1:-1]
    return text.strip() or None


def io_scheduler(path: str) -> Optional[str]:
    """The I/O scheduler of the disk holding `path`, so it is clear whether disk
    priority can do anything there ("none" ignores it; BFQ and mq-deadline use it)."""
    try:
        st = os.stat(path)
        node = os.path.realpath(f"/sys/dev/block/{os.major(st.st_dev)}:{os.minor(st.st_dev)}")
        for folder in (node, os.path.dirname(node)):  # a partition keeps its queue on the parent disk
            queue = os.path.join(folder, "queue", "scheduler")
            if os.path.isfile(queue):
                with open(queue) as fh:
                    return parse_scheduler(fh.read())
    except (OSError, ValueError):
        pass
    return None


def group_rss_mb(pgid: int) -> Optional[float]:
    """Memory (resident, in MB) of every process in this process group, or None
    where /proc isn't available. Shared pages are counted once per process, so
    this reads a little high, which errs on the safe side for a limit."""
    if not os.path.isdir("/proc/self"):
        return None
    page = os.sysconf("SC_PAGE_SIZE")
    total = 0
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat", "rb") as fh:
                stat = fh.read().decode("utf-8", "replace")
            # the command name sits in brackets and may hold spaces or brackets
            fields = stat[stat.rindex(")") + 2:].split()
            if int(fields[2]) != pgid:  # fields[2] is the process group
                continue
            with open(f"/proc/{name}/statm", "rb") as fh:
                total += int(fh.read().split()[1]) * page
        except (OSError, ValueError, IndexError):
            continue  # it ended while we looked
    return total / 1_048_576


def kill_group(pgid: int) -> None:
    """SIGKILL the whole group (the engine and its Chromium)."""
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass
