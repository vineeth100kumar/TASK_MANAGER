"""
"Sage is back up" emails. Whenever the server comes back after being down (an
update, a restart, a crash, a reboot or a power cut), one email says when it
went down, for how long, and why when that can be told.

How it knows:
  - while running, a heartbeat is written to sage_uptime.json every minute
  - a normal stop (systemctl restart/stop, a reboot) marks the stop as clean
  - on the next start, the gap is from the clean stop, or else from the last
    heartbeat; a new git commit means an update, a Pi boot after the last
    heartbeat means the Pi itself went down

The email waits until Sage has stayed up for SETTLE_SECONDS, so an install
that restarts the server twice sends one email covering the whole gap, and a
server stuck restarting sends nothing until it stays up. It is kept in the
file until sent, so a failed send (Wi-Fi not back yet) is retried.
"""

import asyncio
import datetime
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import logstore
import notifier
import system_health

STATE_FILE = notifier.DATA_DIR / "sage_uptime.json"
BEAT_EVERY_SECONDS = 60
SETTLE_SECONDS = 90
RETRY_SECONDS = [60, 120, 300, 600, 1800]
# A pending email older than this is dropped instead of arriving days late.
GIVE_UP_AFTER = datetime.timedelta(days=2)

UTC = datetime.timezone.utc


def _now() -> datetime.datetime:
    return datetime.datetime.now(UTC)


def _iso(when: datetime.datetime) -> str:
    return when.astimezone(UTC).isoformat()


def _parse(value: Any) -> Optional[datetime.datetime]:
    try:
        when = datetime.datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def read_state() -> Dict[str, Any]:
    try:
        state = json.loads(STATE_FILE.read_text())
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(state: Dict[str, Any]) -> None:
    # Write then rename, so a power cut mid-write never leaves half a file.
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    os.replace(tmp, STATE_FILE)


def boot_time() -> Optional[datetime.datetime]:
    """When the Pi itself last booted (Linux only)."""
    try:
        seconds = float(Path("/proc/uptime").read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return None
    return _now() - datetime.timedelta(seconds=seconds)


def _reason(prev: Dict[str, Any], commit: Optional[str], booted: Optional[datetime.datetime], down_at: datetime.datetime) -> Dict[str, str]:
    old = prev.get("commit")
    pi_rebooted = booted is not None and booted > down_at
    if commit and old and commit != old:
        return {"kind": "update", "from": old, "to": commit}
    if prev.get("clean"):
        return {"kind": "reboot" if pi_rebooted else "restart"}
    return {"kind": "power" if pi_rebooted else "crash"}


def on_start(now: Optional[datetime.datetime] = None, commit: Optional[str] = None,
             booted: Optional[datetime.datetime] = None) -> Optional[Dict[str, Any]]:
    """Called once when the server starts. Works out the outage that just
    ended (merged with one still waiting to be emailed) and saves it."""
    now = now or _now()
    prev = read_state()
    pending = prev.get("pending")
    outage = None
    down_at = _parse(prev.get("stoppedAt")) if prev.get("clean") else _parse(prev.get("lastBeat"))
    if down_at:
        reason = _reason(prev, commit, booted, down_at)
        outage = {"downAt": _iso(down_at), "upAt": _iso(now), "reasons": [reason], "restarts": 1}
        started = _parse(prev.get("startedAt"))
        if pending and started and (down_at - started).total_seconds() < SETTLE_SECONDS:
            # It never stayed up long enough to say so: one email for the lot.
            outage["downAt"] = min(pending["downAt"], outage["downAt"])
            outage["reasons"] = pending.get("reasons", []) + [reason]
            outage["restarts"] = int(pending.get("restarts", 1)) + 1
            if pending.get("fromCommit"):
                outage["fromCommit"] = pending["fromCommit"]
        elif pending:
            logstore.warn("uptime", f"Dropping an unsent back-up email for {pending.get('downAt')}")
        if reason["kind"] == "update" and "fromCommit" not in outage:
            outage["fromCommit"] = reason["from"]
    elif pending:
        outage = pending
    write_state({
        "commit": commit, "startedAt": _iso(now), "lastBeat": _iso(now),
        "clean": False, "stoppedAt": None, "pending": outage,
    })
    return outage


def beat(now: Optional[datetime.datetime] = None) -> None:
    state = read_state()
    # Never undoes a clean stop: a last beat can land after shutdown began.
    if not state.get("clean"):
        state["lastBeat"] = _iso(now or _now())
    write_state(state)


def on_stop(now: Optional[datetime.datetime] = None) -> None:
    state = read_state()
    state["clean"] = True
    state["stoppedAt"] = _iso(now or _now())
    write_state(state)


def _clear_pending() -> None:
    state = read_state()
    state["pending"] = None
    write_state(state)


# --- The email ---

def _duration(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    hours, minutes = divmod(minutes, 60)
    if hours < 48:
        return f"{hours} h {minutes} min" if minutes else f"{hours} hour{'s' if hours != 1 else ''}"
    return f"{hours // 24} days {hours % 24} h"


REASON_TEXT = {
    "update": "Updated to new code",
    "restart": "Restarted on purpose",
    "reboot": "The Pi was rebooted",
    "power": "The Pi lost power or froze",
    "crash": "Sage stopped unexpectedly",
}


def _main_reason(reasons: List[Dict[str, str]]) -> str:
    kinds = [r.get("kind") for r in reasons]
    # The most telling cause wins: a power cut over an update over a restart.
    for kind in ("power", "crash", "update", "reboot", "restart"):
        if kind in kinds:
            return kind
    return "restart"


def changes(old: str, new: str, limit: int = 10) -> List[str]:
    """One line per commit the update brought in, newest first."""
    out = system_health._git("log", "--no-merges", f"--max-count={limit}", "--format=%s", f"{old}..{new}")
    return [line for line in (out or "").splitlines() if line.strip()]


def message(outage: Dict[str, Any], prefs: dict, commit: Optional[str] = None) -> Dict[str, Any]:
    tz = notifier._tz(prefs)
    down = _parse(outage["downAt"]).astimezone(tz)
    up = _parse(outage["upAt"]).astimezone(tz)
    took = _duration((up - down).total_seconds())
    kind = _main_reason(outage.get("reasons") or [])
    playful = prefs.get("playful", True)
    same_day = down.date() == up.date()
    window = (f"{down.strftime('%-d %b, %H:%M')} – {up.strftime('%H:%M') if same_day else up.strftime('%-d %b, %H:%M')}")

    if playful:
        subject = {
            "update": f"✨ Sage is back, freshly updated (down {took})",
            "power": f"🔌 Sage is back up after a power blip (down {took})",
            "crash": f"🩹 Sage is back up after a hiccup (down {took})",
        }.get(kind, f"👋 Sage is back up (down {took})")
        heading = {"update": "Back up, with new bits ✨", "power": "Back up and running 🔌", "crash": "Back on its feet 🩹"}.get(kind, "Back up and running 👋")
    else:
        subject = f"Sage is back up (down {took})"
        heading = "Sage is back up"
    intro = f"{REASON_TEXT[kind]}. Sage was down for {took}, {window}."
    if kind in ("power", "crash"):
        intro += " Reminders due in that time went out late or were skipped."

    details = [
        ("Down at", down.strftime("%a %-d %b, %H:%M:%S")),
        ("Back up at", up.strftime("%a %-d %b, %H:%M:%S")),
        ("Down for", took),
        ("Why", REASON_TEXT[kind]),
    ]
    restarts = int(outage.get("restarts", 1))
    if restarts > 1:
        details.append(("Restarts", f"{restarts} in a row"))
    if commit:
        details.append(("Version", commit))
    sections: List[Any] = [("What happened", [(f"{label}: {value}", "", "") for label, value in details])]
    if kind == "update" and outage.get("fromCommit") and commit:
        new = changes(outage["fromCommit"], commit)
        if new:
            sections.append(("What changed", new))
    if kind in ("crash", "power"):
        sections.append(("Worth a look", ["Ask Claude to check sage_health and sage_logs for what went wrong."]))
    link = notifier._app_link()
    return {
        "subject": subject,
        "text": notifier.email_text(heading, intro, sections, link),
        "html": notifier.email_html(heading, intro, sections, link, preheader=intro),
    }


def wants_email(prefs: dict) -> bool:
    return bool(prefs["email"].get("backUp", True) and notifier.email_ready(prefs))


def send_pending(now: Optional[datetime.datetime] = None) -> str:
    """Emails the outage waiting in the file. Returns sent, none, off, stale."""
    outage = read_state().get("pending")
    if not outage:
        return "none"
    now = now or _now()
    if now - _parse(outage["upAt"]) > GIVE_UP_AFTER:
        _clear_pending()
        return "stale"
    prefs = notifier.get_prefs()
    if not wants_email(prefs):
        _clear_pending()
        return "off"
    mail = message(outage, prefs, read_state().get("commit"))
    notifier.send_email(prefs, mail["subject"], mail["text"], mail["html"])
    _clear_pending()
    logstore.info("uptime", f"Sent back-up email: {mail['subject']}")
    return "sent"


async def run() -> None:
    """Heartbeat, plus the back-up email once the server has settled."""
    try:
        outage = await asyncio.to_thread(on_start, None, system_health.COMMIT, boot_time())
    except Exception as e:
        logstore.error("uptime", f"Couldn't read the uptime file: {e}")
        outage = None
    if outage:
        logstore.info("uptime", f"Sage was down from {outage['downAt']} to {outage['upAt']} ({', '.join(r['kind'] for r in outage['reasons'])})")
    started = time.monotonic()
    tries = 0
    next_try = started + SETTLE_SECONDS
    while True:
        await asyncio.sleep(min(BEAT_EVERY_SECONDS, max(1, next_try - time.monotonic())) if outage else BEAT_EVERY_SECONDS)
        try:
            await asyncio.to_thread(beat)
        except Exception as e:
            logstore.error("uptime", f"Heartbeat failed: {e}")
        if outage and time.monotonic() >= next_try:
            try:
                await asyncio.to_thread(send_pending)
                outage = None
            except Exception as e:
                logstore.warn("uptime", f"Back-up email failed, will retry: {e}")
                next_try = time.monotonic() + RETRY_SECONDS[min(tries, len(RETRY_SECONDS) - 1)]
                tries += 1
