"""Replay tests for the Bluetooth rebuild: each past failure is a scripted scene
run against a fake BlueZ and a fake clock.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import phone_link  # noqa: E402
import presence  # noqa: E402

PHONE = "60:0F:6B:47:27:98"


class V:
    def __init__(self, value):
        self.value = value


def device(address=PHONE, connected=True, uuids=(), icon="phone"):
    return {"org.bluez.Device1": {
        "Paired": V(True), "Connected": V(connected), "Address": V(address), "Alias": V("iPhone"),
        "UUIDs": V(list(uuids)), "Icon": V(icon), "ServicesResolved": V(False)}}


class Rig(unittest.TestCase):
    """A PhoneLink with a scripted BlueZ object list, kernel link list and clock."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.object(phone_link, "PINNED_FILE", Path(self.tmp.name) / "pin.json")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.link = phone_link.PhoneLink()
        self.sent = []
        self.now = 10_000.0
        self.objects = {}
        self.kernel = set()
        self.profile_calls = 0
        self.disconnects = 0

        async def broadcast(event):
            self.sent.append(event)
        self.link.broadcast = broadcast

        async def objects():
            return self.objects

        async def kernel_links():
            return set(self.kernel)

        async def noop(*a, **k):
            return None

        async def profile(*a, **k):
            self.profile_calls += 1

        async def disconnect(*a, **k):
            self.disconnects += 1
        self.link._objects = objects
        self.link._kernel_links = kernel_links
        self.link._watch_bluez = noop
        self.link._advertise = noop
        self.link._connect_profile = profile
        self.link._advertising = True
        self.link._force_fresh_link = disconnect
        for target in (mock.patch.object(phone_link, "away_after", lambda: 0),
                       mock.patch.object(phone_link.time, "time", lambda: self.now)):
            target.start()
            self.addCleanup(target.stop)

    def tick(self, seconds=5):
        self.now += seconds
        asyncio.run(self.link._tick())


class Presence(Rig):
    def test_classic_only_link_with_no_services_listed_is_home(self):
        """Tonight: iPhone connected, Sage said Away."""
        self.link.pinned = PHONE
        self.objects = {"/dev": device(uuids=())}
        self.kernel = {PHONE}
        self.tick()
        self.assertTrue(self.link.home)
        self.assertEqual(self.link.presence_reason, "Bluetooth link")
        self.assertEqual(self.disconnects, 0)

    def test_first_run_finds_the_phone_by_icon_and_remembers_it(self):
        self.objects = {"/dev": device(uuids=())}
        self.kernel = {PHONE}
        self.tick()
        self.assertEqual(self.link.pinned, PHONE)
        self.assertEqual(phone_link.PhoneLink._load_pin(), PHONE)
        self.assertTrue(self.link.home)

    def test_zombie_link_with_no_kernel_link_and_no_data_is_away(self):
        """#304: BlueZ says Connected long after the phone left."""
        self.link.pinned = PHONE
        self.objects = {"/dev": device()}
        self.tick()          # BlueZ only: nothing proves it yet
        self.assertFalse(self.link.home)
        self.assertIn("silent", self.link.presence_reason)

    def test_data_keeps_a_phone_home_when_the_match_misses(self):
        """#319: songs arriving while the device match fails."""
        self.link._alive_at = self.now
        self.objects = {}
        self.tick(10)
        self.assertTrue(self.link.home)
        self.tick(60)        # 70 s since the last data, no link
        self.assertFalse(self.link.home)

    def test_leaving_range_goes_away_and_clears_the_stale_song(self):
        self.link.pinned = PHONE
        self.objects = {"/dev": device()}
        self.kernel = {PHONE}
        self.tick()
        self.link.media.update({"title": "Need 2", "playing": True})
        self.kernel = set()
        self.objects = {}
        self.tick(60)
        self.assertFalse(self.link.home)
        self.assertEqual(self.link.media["title"], "")
        self.assertFalse(self.link.media["playing"])

    def test_decide_rules(self):
        self.assertTrue(presence.decide(True, None, False).present)
        self.assertTrue(presence.decide(None, 10, False).present)
        self.assertFalse(presence.decide(None, 50, False).present)
        self.assertTrue(presence.decide(None, 100, True).present)        # flag + recent data
        self.assertFalse(presence.decide(None, 400, True).present)       # flag, silent too long
        self.assertFalse(presence.decide(None, None, True).present)

    def test_parse_hcitool(self):
        out = "Connections:\n\t< ACL 60:0F:6B:47:27:98 handle 11 state 1 lm CENTRAL\n\t> LE 11:22:33:44:55:66 handle 12 state 1 lm PERIPHERAL\n"
        self.assertEqual(presence.parse_hcitool_con(out), {PHONE, "11:22:33:44:55:66"})
        self.assertEqual(presence.parse_hcitool_con(""), set())


class Ladder(Rig):
    def test_classic_only_phone_is_nudged_with_backoff_not_dropped(self):
        """#280, #308: classic link, BLE never comes."""
        self.link.pinned = PHONE
        self.objects = {"/dev": device()}
        self.kernel = {PHONE}
        for _ in range(40):          # 200 s
            self.tick(5)
        self.assertTrue(self.link.home)
        self.assertEqual(self.disconnects, 0)
        self.assertLessEqual(self.profile_calls, 3)       # 0, 60, 180 s ... not every 60 s
        self.assertGreaterEqual(self.profile_calls, 2)

    def test_drop_only_after_the_quiet_and_only_so_often(self):
        self.link.pinned = PHONE
        self.objects = {"/dev": device()}
        self.kernel = {PHONE}
        self.link._ble_stuck_since = self.now
        self.now += phone_link.STUCK_DROP_AFTER + 1
        asyncio.run(self.link._tick())
        self.assertEqual(self.disconnects, 1)

    def test_force_is_paced_capped_and_then_asks_for_a_repair(self):
        link = self.link
        self.assertTrue(link._may_force(self.now))
        link._forces.append(self.now)
        self.assertFalse(link._may_force(self.now + 60))             # not twice in an hour
        for gap in (3601, 7300):
            self.assertTrue(link._may_force(self.now + gap))
            link._forces.append(self.now + gap)
        self.assertFalse(link._may_force(self.now + 7400 + 3700))    # third drop was the cap
        self.assertTrue(link.needs_repair)
        self.assertTrue(any(j["event"] == "repair" for j in link.journal))
        self.assertTrue(link._may_force(self.now + 90000))           # a day later it is fresh


class Restart(unittest.TestCase):
    def test_bluetoothd_restart_registers_advert_and_agent_again(self):
        link = phone_link.PhoneLink()
        owners = iter([":1.10", ":1.77"])
        registered = []

        class Bus:
            async def introspect(self, *a):
                return None

            def get_proxy_object(self, *a):
                return self

            def get_interface(self, name):
                return self

            async def call_get_name_owner(self, name):
                return next(owners)
        link._bus = Bus()

        class Control:
            async def register_agent(self):
                registered.append(1)
        link.control = Control()
        link._advertising = True
        asyncio.run(link._watch_bluez())          # first sight of bluetoothd
        self.assertTrue(link._advertising)
        asyncio.run(link._watch_bluez())          # new owner: it restarted
        self.assertFalse(link._advertising)
        self.assertEqual(registered, [1])
        self.assertTrue(any(j["event"] == "bluez" for j in link.journal))


if __name__ == "__main__":
    unittest.main()


class StuckWatcher(Rig):
    def test_hung_bluez_call_flips_to_away(self):
        """2026-11-25: a D-Bus call hung, the last pass said home, and Sage said home for 15 hours."""
        self.link.pinned = PHONE
        self.objects = {"/dev": device()}
        self.kernel = {PHONE}
        self.tick()
        self.assertTrue(self.link.home)

        async def hang():
            await asyncio.sleep(3600)
        self.link._objects = hang

        async def one_pass():
            try:
                await asyncio.wait_for(self.link._tick(), 0.05)
            except asyncio.TimeoutError:
                await self.link.set_presence(False, "", force_away=True)
        asyncio.run(one_pass())
        self.assertFalse(self.link.home)
        self.assertFalse(self.link.connected)

