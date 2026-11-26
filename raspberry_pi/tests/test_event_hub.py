"""The live event stream: one browser that vanished must not hold up a
broadcast (it froze every worker that broadcasts, the phone watcher included).

    cd raspberry_pi && python -m unittest discover -s tests
"""

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

db_server = None


class Sock:
    def __init__(self, hang=False):
        self.hang, self.got, self.closed = hang, [], False

    async def send_text(self, message):
        if self.hang:
            await asyncio.sleep(3600)
        self.got.append(message)

    async def close(self):
        self.closed = True


class EventHubTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global db_server
        if "db_server" not in sys.modules:
            os.environ["SAGE_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "hub.db")
            os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
        import db_server as _db_server
        db_server = _db_server

    def test_a_dead_socket_is_dropped_and_the_rest_still_get_it(self):
        hub = db_server.EventHub()
        alive, dead = Sock(), Sock(hang=True)
        hub.sockets.update({alive, dead})

        async def scene():
            with mock.patch.object(db_server, "SOCKET_SEND_TIMEOUT", 0.05):
                await asyncio.wait_for(hub.broadcast({"type": "PING"}), 2)
                await asyncio.sleep(0.01)  # let the close run
        asyncio.run(scene())
        self.assertEqual(len(alive.got), 1)
        self.assertNotIn(dead, hub.sockets)
        self.assertIn(alive, hub.sockets)
        self.assertTrue(dead.closed, "closed so the page reconnects")


if __name__ == "__main__":
    unittest.main()
