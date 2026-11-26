"""Tests for printers and printing (printing.py). CUPS itself is faked.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["SAGE_DB_PATH"] = str(Path(TMP) / "print.db")
os.environ["SAGE_BACKUP_DIR"] = str(Path(TMP) / "backups")
os.environ["SAGE_GAS_URL"] = "http://127.0.0.1:9/none"
os.environ.pop("API_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import db_server  # noqa: E402
import printing  # noqa: E402

client = TestClient(db_server.app, follow_redirects=False)

DEVICES = "device for Office_Laser: ipp://192.168.1.20/ipp/print\ndevice for Desk: usb://HP/LaserJet?serial=1\n"
STATUS = "printer Office_Laser is idle.  enabled since Thu 26 Nov\nprinter Desk disabled since Thu 26 Nov - paused\n"


def fake_run(calls):
    def run(args, timeout=20):
        calls.append(args)
        if args[:2] == ["lpstat", "-v"]:
            return DEVICES
        if args[:2] == ["lpstat", "-p"]:
            return STATUS
        if args[:2] == ["lpstat", "-d"]:
            return "system default destination: Office_Laser\n"
        if args[0] == "lpinfo":
            return "network ipp\nnetwork ipp://192.168.1.20/ipp/print\ndirect usb://HP/LaserJet?serial=1\nnetwork ipp://192.168.1.30/ipp/print\nnetwork socket\n"
        if args[0] == "lp":
            return "request id is Office_Laser-12 (1 file(s))\n"
        return ""
    return run


class Parsing(unittest.TestCase):
    def test_printers(self):
        rows = printing.parse_printers(DEVICES, STATUS, "Office_Laser")
        self.assertEqual([r["name"] for r in rows], ["Desk", "Office_Laser"])
        self.assertEqual(rows[0]["state"], "disabled")
        self.assertTrue(rows[1]["default"])
        self.assertEqual(rows[1]["uri"], "ipp://192.168.1.20/ipp/print")

    def test_devices_drop_bare_schemes(self):
        found = printing.parse_devices("network ipp\nnetwork socket\nnetwork ipp://10.0.0.5/ipp/print\ndirect usb://Canon/MG3600\n")
        self.assertEqual([d["kind"] for d in found], ["network", "usb"])
        self.assertEqual(found[0]["label"], "10.0.0.5")


class Routes(unittest.TestCase):
    def setUp(self):
        self.calls = []
        for p in (mock.patch.object(printing, "available", return_value=True),
                  mock.patch.object(printing, "_run", fake_run(self.calls)),
                  mock.patch.object(printing, "pdf_possible", return_value=True)):
            p.start()
            self.addCleanup(p.stop)

    def test_list(self):
        data = client.get("/api/printers").json()
        self.assertTrue(data["available"])
        self.assertEqual(len(data["printers"]), 2)

    def test_not_installed(self):
        with mock.patch.object(printing, "available", return_value=False):
            data = client.get("/api/printers").json()
        self.assertFalse(data["available"])
        self.assertIn("reason", data)

    def test_discover_skips_added(self):
        found = client.post("/api/printers/discover").json()["found"]
        self.assertEqual([f["uri"] for f in found], ["ipp://192.168.1.30/ipp/print"])

    def test_add_rejects_bad_input(self):
        self.assertEqual(client.post("/api/printers", json={"uri": "ipp://x/;rm -rf", "name": "a"}).status_code, 400)
        self.assertEqual(client.post("/api/printers", json={"uri": "file:///etc/passwd", "name": "a"}).status_code, 400)
        self.assertEqual(client.post("/api/printers", json={"uri": "ipp://10.0.0.5/ipp/print", "name": "-bad name"}).status_code, 400)

    def test_add(self):
        r = client.post("/api/printers", json={"uri": "ipp://10.0.0.5/ipp/print", "name": "Hall"})
        self.assertEqual(r.status_code, 200)
        self.assertIn(["lpadmin", "-p", "Hall", "-E", "-v", "ipp://10.0.0.5/ipp/print", "-m", "everywhere"], self.calls)

    def test_unknown_printer(self):
        self.assertEqual(client.post("/api/printers/Nope/default").status_code, 404)
        self.assertEqual(client.delete("/api/printers/Nope").status_code, 404)

    def test_print_makes_pdf_then_lp(self):
        def pdf(html, out):
            out.write_bytes(b"%PDF-1.4")
        with mock.patch.object(printing, "html_to_pdf", pdf):
            r = client.post("/api/print", json={"printer": "Office_Laser", "title": "Plan <b>", "html": "<p>hi</p>", "copies": 2})
        self.assertEqual(r.status_code, 200)
        lp = [c for c in self.calls if c[0] == "lp"][0]
        self.assertEqual(lp[:6], ["lp", "-d", "Office_Laser", "-n", "2", "-t"])
        self.assertEqual(lp[6], "Plan b")

    def test_print_empty(self):
        self.assertEqual(client.post("/api/print", json={"printer": "Office_Laser", "html": "  "}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
