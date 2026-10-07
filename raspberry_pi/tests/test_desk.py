"""Tests for desk/: the desk clock's pairing, and what it is told to draw.

A fake clock connects over a real websocket, says hello, presses buttons and
records every command the Pi sends it.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import datetime
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from websockets.asyncio.client import connect  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402

from desk import link as desk_link  # noqa: E402
from desk.controller import DeskController  # noqa: E402
from desk.link import ClockLink, load_token  # noqa: E402

NOW = datetime.datetime(2026, 10, 6, 18, 47, 21, 500000)


class FakeLink:
    """Stands in for ClockLink in controller tests: records what was sent."""

    def __init__(self):
        self.sent = []
        self.on_ready = self.on_button = None

    async def send(self, command):
        self.sent.append(command)
        return True

    def cmds(self):
        return [c["cmd"] for c in self.sent]


class Ticker:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class Token(unittest.TestCase):
    def test_made_once_and_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "desk_token.txt"
            first = load_token(path)
            self.assertRegex(first, r"^\d{6}$")
            self.assertEqual(load_token(path), first)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_status_before_the_link_starts(self):
        from desk import run as desk_run
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(desk_link, "TOKEN_FILE", Path(tmp) / "t.txt"), \
                mock.patch.object(desk_run, "link", None):
            off = desk_run.status(False)
            self.assertEqual((off["enabled"], off["connected"], off["token"]), (False, False, None))
            on = desk_run.status(True)
            self.assertRegex(on["token"], r"^\d{6}$")
            self.assertEqual(on["port"], 8765)


class Controller(unittest.IsolatedAsyncioTestCase):
    def make(self, **kw):
        self.link = FakeLink()
        self.ticks = Ticker()
        return DeskController(self.link, lambda: NOW, clock=self.ticks, **kw)

    async def test_redraw_sends_time_screen_and_lights(self):
        desk = self.make()
        await desk.redraw()
        self.assertEqual(self.link.cmds(), ["CLOCK", "SCREEN", "LIGHTS"])
        clock = self.link.sent[0]
        self.assertEqual((clock["h"], clock["m"], clock["s"], clock["ms"]), (18, 47, 21, 500))
        self.assertEqual((clock["weekday"], clock["date"]), ("Tue", "06 Oct"))
        self.assertNotIn("alarm_h", clock)
        self.assertEqual(self.link.sent[1], {"cmd": "SCREEN", "mode": "FACE"})
        self.assertEqual(self.link.sent[2]["mode"], "AUTO")

    async def test_clock_carries_next_alarm(self):
        desk = self.make(next_alarm=lambda: (6, 30))
        await desk.send_clock()
        self.assertEqual((self.link.sent[0]["alarm_h"], self.link.sent[0]["alarm_m"]), (6, 30))

    async def test_up_and_down_step_through_screens(self):
        desk = self.make(screens=["FACE", "CLOCK", "TASKS"])
        await desk.on_button("DOWN")
        await desk.on_button("down")
        await desk.on_button("DOWN")
        await desk.on_button("UP")
        self.assertEqual([c["mode"] for c in self.link.sent], ["CLOCK", "TASKS", "FACE", "TASKS"])

    async def test_card_buttons_run_its_actions(self):
        desk = self.make()
        done = []

        async def mark_done():
            done.append("done")

        await desk.show_card("Sage", "Call the plumber about the leak", "Due now", {
            "OK": ("Done", mark_done),
            "UP": ("ignored", mark_done),  # only LEFT, OK and RIGHT can carry actions
        })
        notif, actions = self.link.sent
        self.assertEqual(notif["title"], "Call the plumber about the")
        self.assertEqual(actions, {"cmd": "ACTIONS", "ok": "Done"})

        await desk.on_button("LEFT")  # not on this card: nothing happens
        self.assertEqual(done, [])
        self.assertEqual(len(self.link.sent), 2)

        await desk.on_button("OK")
        self.assertEqual(done, ["done"])
        self.assertEqual(self.link.sent[-1], {"cmd": "ACTIONS"})
        self.assertIsNone(desk.card)

        await desk.on_button("OK")  # the card is gone, so this does nothing
        self.assertEqual(done, ["done"])

    async def test_card_times_out(self):
        desk = self.make()

        async def nope():
            self.fail("an expired card's action ran")

        await desk.show_card("Sage", "Stretch", actions={"OK": ("Done", nope)}, seconds=30)
        self.ticks.t += 31
        await desk.on_button("OK")
        self.assertIsNone(desk.card)
        await desk.on_button("DOWN")
        self.assertEqual(self.link.sent[-1], {"cmd": "SCREEN", "mode": "CLOCK"})

    def test_fit_keeps_to_what_the_clock_can_draw(self):
        from desk.controller import fit
        self.assertEqual(fit("Dinner at 8? 🍜🍜", 40), "Dinner at 8?")
        self.assertEqual(fit("Café “au lait” — now", 40), 'Cafe "au lait" - now')
        self.assertEqual(fit("two\nlines  here", 40), "two lines here")
        self.assertEqual(fit("Call the plumber", 9), "Call the")
        self.assertEqual(fit(None, 10), "")

    async def test_unknown_screen_refused(self):
        with self.assertRaises(ValueError):
            await self.make().show_screen("SPACESHIP")


class Pairing(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.link = ClockLink("123456")
        self.desk = DeskController(self.link, lambda: NOW)
        self.server = await serve(self.link.handle, "127.0.0.1", 0)
        self.url = f"ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()

    async def receive(self, socket, count):
        return [json.loads(await asyncio.wait_for(socket.recv(), 2)) for _ in range(count)]

    async def test_wrong_token_is_refused(self):
        with self.assertLogs("desk.link", "WARNING"):
            await self._wrong_token()

    async def _wrong_token(self):
        async with connect(self.url) as clock:
            await clock.send(json.dumps({"evt": "HELLO", "token": "000000", "fw": "1.6.0"}))
            self.assertEqual(await self.receive(clock, 1), [{"cmd": "PAIRED", "ok": False}])
            await clock.wait_closed()
            self.assertEqual(clock.close_code, 4401)
        self.assertFalse(self.link.connected)

    async def test_old_firmware_without_hello_is_refused(self):
        with self.assertLogs("desk.link", "WARNING"):
            async with connect(self.url) as clock:
                await clock.send(json.dumps({"evt": "READY", "fw": "1.5.0"}))
                self.assertFalse((await self.receive(clock, 1))[0]["ok"])
                await clock.wait_closed()
                self.assertEqual(clock.close_code, 4401)

    async def test_silent_clock_is_dropped(self):
        with mock.patch.object(desk_link, "HELLO_TIMEOUT", 0.2), self.assertLogs("desk.link", "WARNING"):
            async with connect(self.url) as clock:
                self.assertFalse((await self.receive(clock, 1))[0]["ok"])
                await clock.wait_closed()

    async def test_paired_clock_is_drawn_and_buttons_work(self):
        async with connect(self.url) as clock:
            await clock.send(json.dumps({"evt": "HELLO", "token": "123456", "fw": "1.6.0"}))
            got = await self.receive(clock, 4)
            self.assertEqual([c["cmd"] for c in got], ["PAIRED", "CLOCK", "SCREEN", "LIGHTS"])
            self.assertTrue(got[0]["ok"])
            status = self.link.status()
            self.assertTrue(status["connected"])
            self.assertEqual((status["firmware"], status["address"]), ("1.6.0", "127.0.0.1"))

            await clock.send(json.dumps({"evt": "BTN", "btn": "DOWN"}))
            self.assertEqual(await self.receive(clock, 1), [{"cmd": "SCREEN", "mode": "CLOCK"}])

            await clock.send("not json")  # ignored, the connection stays up
            await clock.send(json.dumps({"evt": "READY", "fw": "1.6.1"}))
            again = await self.receive(clock, 3)
            self.assertEqual(again[1], {"cmd": "SCREEN", "mode": "CLOCK"})
            self.assertEqual(self.link.fw, "1.6.1")

        for _ in range(50):
            if not self.link.connected:
                break
            await asyncio.sleep(0.02)
        self.assertFalse(self.link.connected)
        self.assertFalse(await self.link.send({"cmd": "CLOCK"}))

    async def test_a_new_clock_replaces_the_old_one(self):
        hello = json.dumps({"evt": "HELLO", "token": "123456", "fw": "1.6.0"})
        async with connect(self.url) as old:
            await old.send(hello)
            await self.receive(old, 4)
            async with connect(self.url) as new:
                await new.send(hello)
                await self.receive(new, 4)
                await old.wait_closed()
                self.assertTrue(self.link.connected)
                await self.link.send({"cmd": "HAPTIC"})
                self.assertEqual(await self.receive(new, 1), [{"cmd": "HAPTIC"}])

    async def test_a_failing_handler_keeps_the_connection(self):
        async def broken(_button):
            raise RuntimeError("boom")

        self.link.on_button = broken
        async with connect(self.url) as clock:
            await clock.send(json.dumps({"evt": "HELLO", "token": "123456"}))
            await self.receive(clock, 4)
            with self.assertLogs("desk.link", "ERROR"):
                await clock.send(json.dumps({"evt": "BTN", "btn": "OK"}))
                await asyncio.sleep(0.1)
            self.assertTrue(self.link.connected)


class Listening(unittest.IsolatedAsyncioTestCase):
    async def test_survives_garbage_collection(self):
        """Nobody keeps the serving task (as at Sage's startup): a collection
        must not destroy it and close the clock's port."""
        import gc
        import socket

        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        link = ClockLink("123456")
        asyncio.get_running_loop().create_task(link.serve("127.0.0.1", port))
        await asyncio.sleep(0.2)
        gc.collect()
        await asyncio.sleep(0.1)
        async with connect(f"ws://127.0.0.1:{port}") as clock:
            await clock.send(json.dumps({"evt": "HELLO", "token": "123456"}))
            self.assertEqual(json.loads(await asyncio.wait_for(clock.recv(), 2))["cmd"], "PAIRED")
        link._serving.cancel()


if __name__ == "__main__":
    unittest.main()
