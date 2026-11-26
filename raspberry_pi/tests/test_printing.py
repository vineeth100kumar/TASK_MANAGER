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
import printdrop  # noqa: E402
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

    def test_quality_and_black_and_white_flags(self):
        self.assertEqual(printing.quality_options("normal", False), [])
        self.assertEqual(printing.quality_options("draft", False), ["-o", "print-quality=3"])
        self.assertEqual(printing.quality_options("high", True), ["-o", "print-quality=5", "-o", "print-color-mode=monochrome"])

    def test_print_passes_quality_to_lp(self):
        def pdf(html, out):
            out.write_bytes(b"%PDF-1.4")
        with mock.patch.object(printing, "html_to_pdf", pdf):
            r = client.post("/api/print", json={"printer": "Office_Laser", "html": "<p>x</p>", "quality": "draft", "mono": True})
            self.assertEqual(r.status_code, 200)
            bad = client.post("/api/print", json={"printer": "Office_Laser", "html": "<p>x</p>", "quality": "ultra"})
            self.assertEqual(bad.status_code, 422)
        lp = [c for c in self.calls if c[0] == "lp"][-1]
        self.assertIn("print-quality=3", lp)
        self.assertIn("print-color-mode=monochrome", lp)

    def test_print_empty(self):
        self.assertEqual(client.post("/api/print", json={"printer": "Office_Laser", "html": "  "}).status_code, 400)


def make_pdf(pages: int) -> bytes:
    import io
    from pypdf import PdfWriter
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


class BackToBack(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.sent_pages = []
        printdrop.connect(str(Path(TMP) / "print.db"))
        for f in printdrop.list_files():
            printdrop._pdf_path(f["id"]).unlink()
            printdrop._meta_path(f["id"]).unlink()
        printing.JOBS.clear()
        self.real_send = printing._send_page

        def send(printer, pdf, page, rotate, title, quality="normal", mono=False):
            self.sent_pages.append((page, rotate))
            return "ok"
        for p in (mock.patch.object(printing, "available", return_value=True),
                  mock.patch.object(printing, "_run", fake_run(self.calls)),
                  mock.patch.object(printing, "_send_page", send)):
            p.start()
            self.addCleanup(p.stop)

    def upload(self, pages=3, name="Plan.pdf"):
        body = make_pdf(pages)
        r = client.post(f"/api/printdrop?name={name}", content=body, headers={"content-type": "application/pdf"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["file"]

    def test_upload_list_delete(self):
        f = self.upload(3)
        self.assertEqual((f["pages"], f["name"]), (3, "Plan.pdf"))
        self.assertEqual(len(client.get("/api/printdrop").json()["files"]), 1)
        self.assertEqual(client.delete(f"/api/printdrop/{f['id']}").status_code, 200)
        self.assertEqual(client.get("/api/printdrop").json()["files"], [])

    def test_refuses_non_pdf_and_too_many(self):
        r = client.post("/api/printdrop?name=x.pdf", content=b"hello world", headers={"content-type": "application/pdf"})
        self.assertEqual(r.status_code, 400)
        with mock.patch.object(printdrop, "MAX_FILES", 1):
            self.upload(1)
            r = client.post("/api/printdrop?name=b.pdf", content=make_pdf(1), headers={"content-type": "application/pdf"})
            self.assertEqual(r.status_code, 409)

    def test_single_side_prints_whole_file(self):
        f = self.upload(3)
        r = client.post(f"/api/printdrop/{f['id']}/print", json={"printer": "Office_Laser", "mode": "single", "copies": 2})
        self.assertEqual(r.status_code, 200)
        lp = [c for c in self.calls if c[0] == "lp"][0]
        self.assertEqual(lp[:6], ["lp", "-d", "Office_Laser", "-n", "2", "-t"])

    def test_back_to_back_waits_between_sides(self):
        f = self.upload(3)
        job = client.post(f"/api/printdrop/{f['id']}/print", json={"printer": "Office_Laser", "mode": "duplex", "flip": True}).json()["job"]
        self.assertEqual((job["stage"], job["sheets"]), ("start", 2))
        self.assertEqual(self.sent_pages, [])
        steps = []
        for _ in range(3):
            job = client.post(f"/api/print/jobs/{job['id']}/continue").json()["job"]
            steps.append(job["stage"])
        self.assertEqual(steps, ["flip", "reload", "done"])
        # page 1 front, page 2 back (turned 180 with flip), page 3 front of sheet 2
        self.assertEqual(self.sent_pages, [(1, False), (2, True), (3, False)])
        self.assertTrue(job["finished"])

    def test_again_resends_the_last_side(self):
        f = self.upload(2)
        job = client.post(f"/api/printdrop/{f['id']}/print", json={"printer": "Office_Laser", "mode": "duplex"}).json()["job"]
        client.post(f"/api/print/jobs/{job['id']}/continue")
        client.post(f"/api/print/jobs/{job['id']}/again")
        self.assertEqual([p for p, _ in self.sent_pages], [1, 1])

    def start_job(self, pages=5, flip=False):
        f = self.upload(pages)
        return client.post(f"/api/printdrop/{f['id']}/print", json={"printer": "Office_Laser", "mode": "duplex", "flip": flip}).json()["job"]

    def test_restart_from_an_earlier_sheet_after_a_jam(self):
        job = self.start_job(5)
        for _ in range(4):
            job = client.post(f"/api/print/jobs/{job['id']}/continue").json()["job"]
        self.assertEqual((job["stage"], job["sheet"]), ("reload", 3))
        job = client.post(f"/api/print/jobs/{job['id']}/restart", json={"sheet": 2}).json()["job"]
        self.assertEqual((job["stage"], job["sheet"], job["next"]), ("reload", 2, "Print sheet 2"))
        self.assertIn("sheet 2", job["note"])
        client.post(f"/api/print/jobs/{job['id']}/continue")
        self.assertEqual(self.sent_pages[-1], (3, False))     # sheet 2 front is page 3
        self.assertEqual(client.post(f"/api/print/jobs/{job['id']}/restart", json={"sheet": 9}).status_code, 400)

    def test_a_finished_job_can_be_redone(self):
        job = self.start_job(2)
        for _ in range(2):
            job = client.post(f"/api/print/jobs/{job['id']}/continue").json()["job"]
        self.assertTrue(job["finished"])
        job = client.post(f"/api/print/jobs/{job['id']}/restart", json={"sheet": 1}).json()["job"]
        self.assertFalse(job["finished"])

    def test_reprint_one_page_keeps_the_place(self):
        job = self.start_job(4, flip=True)
        job = client.post(f"/api/print/jobs/{job['id']}/continue").json()["job"]
        self.assertEqual(job["stage"], "flip")
        job = client.post(f"/api/print/jobs/{job['id']}/reprint", json={"page": 2}).json()["job"]
        self.assertEqual(self.sent_pages[-1], (2, True))      # a back page keeps the turn-around
        self.assertEqual(job["stage"], "flip")
        self.assertIn("Page 2", job["note"])
        self.assertEqual(client.post(f"/api/print/jobs/{job['id']}/reprint", json={"page": 0}).status_code, 400)

    def test_change_quality_mid_job(self):
        job = self.start_job(2)
        client.post(f"/api/print/jobs/{job['id']}/options", json={"quality": "draft", "mono": True})
        seen = {}

        def grab(printer, pdf, title, copies, quality="normal", mono=False):
            seen.update(quality=quality, mono=mono)
            return "ok"
        with mock.patch.object(printing, "_lp", grab), mock.patch.object(printing, "_send_page", self.real_send):
            client.post(f"/api/print/jobs/{job['id']}/continue")
        self.assertEqual(seen, {"quality": "draft", "mono": True})

    def test_test_page_takes_quality(self):
        def pdf(html, out):
            out.write_bytes(b"%PDF-1.4")
        with mock.patch.object(printing, "html_to_pdf", pdf):
            r = client.post("/api/printers/Office_Laser/test", json={"quality": "draft", "mono": True})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(client.post("/api/printers/Office_Laser/test").status_code, 200)
        lps = [c for c in self.calls if c[0] == "lp"]
        self.assertIn("print-quality=3", lps[-2])
        self.assertNotIn("print-quality=3", lps[-1])

    def test_stop_and_limit(self):
        f = self.upload(2)
        ids = [client.post(f"/api/printdrop/{f['id']}/print", json={"printer": "Office_Laser", "mode": "duplex"}).json()["job"]["id"] for _ in range(3)]
        self.assertEqual(client.post(f"/api/printdrop/{f['id']}/print", json={"printer": "Office_Laser", "mode": "duplex"}).status_code, 409)
        client.delete(f"/api/print/jobs/{ids[0]}")
        self.assertEqual(len(client.get("/api/print/jobs").json()["jobs"]), 2)
        self.assertTrue(printdrop._pdf_path(f["id"]).is_file())   # a stored PDF outlives its job

    def test_a_sheet_is_cut_out_as_one_page(self):
        from pypdf import PdfReader
        f = self.upload(3)
        seen = []

        def grab(printer, pdf, title, copies, quality="normal", mono=False):
            r = PdfReader(str(pdf))
            seen.append((len(r.pages), r.pages[0].get("/Rotate", 0)))
            return "ok"
        job = client.post(f"/api/printdrop/{f['id']}/print", json={"printer": "Office_Laser", "mode": "duplex", "flip": True}).json()["job"]
        with mock.patch.object(printing, "_lp", grab), mock.patch.object(printing, "_send_page", self.real_send):
            client.post(f"/api/print/jobs/{job['id']}/continue")
            client.post(f"/api/print/jobs/{job['id']}/continue")
        self.assertEqual(seen, [(1, 0), (1, 180)])


if __name__ == "__main__":
    unittest.main()
