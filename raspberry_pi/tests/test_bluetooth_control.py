"""Tests for bluetooth_control.py: the device list the web app shows, and the
rule that pairing is only accepted inside a pairing window and confirmed in the UI.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bluetooth_control as bc  # noqa: E402

ANCS = "7905f431-b5ce-4e99-a40f-4b1e122d00d0"


class V:
    def __init__(self, value):
        self.value = value


def device(address, name=None, **props):
    base = {"Address": V(address), "Paired": V(False), "Connected": V(False), "Trusted": V(False), "UUIDs": V([])}
    if name:
        base["Alias"] = V(name)
    base.update({k: V(v) for k, v in props.items()})
    return {bc.DEVICE_IFACE: base}


def world(**adapter):
    props = {"Alias": V("Sage Companion"), "Address": V("DC:A6:32:00:00:01"), "Powered": V(True),
             "Discoverable": V(False), "Discovering": V(False)}
    props.update({k: V(v) for k, v in adapter.items()})
    return {
        "/org/bluez/hci0": {bc.ADAPTER_IFACE: props},
        "/org/bluez/hci0/dev_1": device("AA:AA:AA:AA:AA:01", "Vineeth's iPhone", Paired=True, Connected=True, UUIDs=[ANCS.upper()]),
        "/org/bluez/hci0/dev_2": device("AA:AA:AA:AA:AA:02", "Old laptop", Paired=True, Icon="computer"),
        "/org/bluez/hci0/dev_3": device("AA:AA:AA:AA:AA:03", "Kitchen speaker", RSSI=-60, Icon="audio-card"),
        "/org/bluez/hci0/dev_4": device("AA:AA:AA:AA:AA:04", "AA-AA-AA-AA-AA-04", RSSI=-40),
    }


class Snapshot(unittest.TestCase):
    def test_devices_and_ordering(self):
        snap = bc.build_snapshot(world(), time.time(), bc.ControlState(), {ANCS})
        self.assertTrue(snap["available"])
        names = [d["name"] for d in snap["devices"]]
        # Connected first, then paired, then discovered; the nameless stranger is dropped.
        self.assertEqual(names, ["Vineeth's iPhone", "Old laptop", "Kitchen speaker"])
        self.assertEqual([d["kind"] for d in snap["devices"]], ["phone", "computer", "audio"])
        self.assertEqual(snap["adapter"], {"name": "Sage Companion", "address": "DC:A6:32:00:00:01", "powered": True})

    def test_no_adapter(self):
        snap = bc.build_snapshot({}, time.time(), bc.ControlState(), set())
        self.assertFalse(snap["available"])

    def test_pairing_countdown_needs_discoverable(self):
        state = bc.ControlState()
        state.pairing_until = time.time() + 120
        off = bc.build_snapshot(world(), time.time(), state, set())
        on = bc.build_snapshot(world(Discoverable=True), time.time(), state, set())
        self.assertEqual(off["pairing"], {"active": False, "secondsLeft": 0})
        self.assertTrue(on["pairing"]["active"])
        self.assertAlmostEqual(on["pairing"]["secondsLeft"], 120, delta=2)

    def test_working_error_and_pending(self):
        state = bc.ControlState()
        state.working["AA:AA:AA:AA:AA:02"] = "connecting"
        state.error = {"address": "AA:AA:AA:AA:AA:03", "message": "nope", "at": time.time() - 31}
        state.pending = {"address": "AA:AA:AA:AA:AA:03", "name": "Kitchen speaker", "passkey": "012345", "expires": time.time() + 30}
        snap = bc.build_snapshot(world(), time.time(), state, set())
        laptop = next(d for d in snap["devices"] if d["name"] == "Old laptop")
        self.assertEqual(laptop["working"], "connecting")
        self.assertIsNone(snap["error"])  # too old to show
        self.assertEqual(snap["pending"]["passkey"], "012345")

    def test_friendly_errors(self):
        self.assertIn("didn't answer", bc.friendly(Exception("Page Timeout")))
        self.assertIn("declined", bc.friendly(Exception("org.bluez.Error.Rejected")))


class Control(unittest.TestCase):
    def make(self):
        events = []

        async def emit(event):
            events.append(event)
        control = bc.BluetoothControl(None, emit, {ANCS})
        objects = world()

        async def fake_objects():
            return objects
        control.objects = fake_objects
        return control, events

    def test_request_outside_window_is_rejected(self):
        control, _ = self.make()
        self.assertFalse(asyncio.run(control._ask("/org/bluez/hci0/dev_3", 123456)))
        self.assertIsNone(control.state.pending)

    def test_window_asks_the_ui_and_waits_for_the_answer(self):
        async def go(answer):
            control, events = self.make()
            control.state.pairing_until = time.time() + 60
            task = asyncio.ensure_future(control._ask("/org/bluez/hci0/dev_3", 42))
            await asyncio.sleep(0.05)
            shown = [e for e in events if e.get("pending")]
            self.assertTrue(shown)
            self.assertEqual(shown[-1]["pending"]["passkey"], "000042")
            self.assertTrue(await control.confirm(answer))
            return await task, control
        accepted, control = asyncio.run(go(True))
        self.assertTrue(accepted)
        self.assertIsNone(control.state.pending)
        declined, _ = asyncio.run(go(False))
        self.assertFalse(declined)

    def test_confirm_with_nothing_waiting(self):
        control, _ = self.make()
        self.assertFalse(asyncio.run(control.confirm(True)))

    def test_bad_address_is_refused(self):
        control, _ = self.make()
        with self.assertRaises(ValueError):
            asyncio.run(control.device_action("not-an-address", "connect"))
        with self.assertRaises(ValueError):
            asyncio.run(control.device_action("AA:AA:AA:AA:AA:01", "explode"))
        with self.assertRaises(LookupError):
            asyncio.run(control.device_action("AA:AA:AA:AA:AA:99", "connect"))

    def test_events_only_when_something_changes(self):
        async def go():
            control, events = self.make()
            await control.refresh()
            await control.refresh()
            return events
        events = asyncio.run(go())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "BT_STATE")


if __name__ == "__main__":
    unittest.main()
