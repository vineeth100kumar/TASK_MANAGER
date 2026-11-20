"""
presence.py - Is the phone home? One pure answer, with the reason.

phone_link.py feeds this evidence; everything that cares about home (Herald,
Work/Chill, the clock, the soundbar, the Sage panel) reads the result. No
D-Bus, no clock of its own, so it is tested with plain numbers.

Evidence, strongest first:
- radio:  the kernel holds a live link to the iPhone's address (True/False),
          or None when the Pi can't read the kernel's link list. The kernel
          drops a link about 20 s after the phone leaves range; BlueZ's own
          "Connected" flag can stay true on a dead zombie link.
- data:   seconds since the phone last sent real bytes (notification, song,
          battery read, finished subscription).
- flag:   BlueZ says the pinned phone is Connected. Only trusted when the
          kernel check is unavailable, and then only with recent phone data.
"""

from typing import NamedTuple, Optional

# Data from the phone counts as "here" for this long.
DATA_LIVE = 45
# BlueZ-flag-only fallback: how long after the last phone data a "Connected"
# flag is still believed (above the 5 minute battery heartbeat).
FLAG_LIVE = 360


class Verdict(NamedTuple):
    present: bool
    reason: str


def decide(radio: Optional[bool], data_age: Optional[float], flag: bool,
           data_live: float = DATA_LIVE, flag_live: float = FLAG_LIVE) -> Verdict:
    """Is the phone here right now? data_age is None when no data was ever heard."""
    if radio:
        return Verdict(True, "Bluetooth link")
    if data_age is not None and data_age < data_live:
        return Verdict(True, "phone sending data")
    if radio is None and flag and data_age is not None and data_age < flag_live:
        return Verdict(True, "BlueZ link (kernel check unavailable)")
    if radio is None and flag:
        return Verdict(False, "BlueZ says connected but the phone is silent")
    return Verdict(False, "no Bluetooth link")


def parse_hcitool_con(output: str) -> set:
    """Addresses (upper case) in `hcitool con` output, classic and LE."""
    found = set()
    for line in output.splitlines():
        parts = line.split()
        for i, word in enumerate(parts):
            if word == "ACL" or word == "LE":
                if i + 1 < len(parts) and len(parts[i + 1]) == 17 and parts[i + 1].count(":") == 5:
                    found.add(parts[i + 1].upper())
    return found
