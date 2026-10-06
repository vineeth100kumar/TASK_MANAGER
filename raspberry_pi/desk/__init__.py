"""
desk - the LUMO desk clock as an interface of Sage.

All of the clock's thinking happens here, inside Sage's server on the Pi: what
to show, when an alarm rings, what each button means. The ESP32 only draws
what it is told and reports button presses, so it holds no tasks, no alarm
times and no logic of its own.

- link.py        the clock's websocket (port 8765) and its pairing token
- controller.py  what the clock shows and what each button does

Off unless SAGE_DESK=1, because until the switch-over LUMO's own server still
owns port 8765.
"""

import os

ENABLED = os.getenv("SAGE_DESK", "0").strip().lower() in {"1", "true", "yes", "on"}
