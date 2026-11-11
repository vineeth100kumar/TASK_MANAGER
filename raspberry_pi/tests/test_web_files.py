"""Tests for web_files.py: the app's hashed files are cached for a year and sent
pre-compressed, the page itself is not, and the big startup pull is gzipped.

    cd raspberry_pi && python -m unittest discover -s tests
"""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import web_files  # noqa: E402

JS = b"console.log('sage');" * 200


class WebFilesTests(unittest.TestCase):
    def setUp(self):
        root = Path(tempfile.mkdtemp())
        (root / "assets").mkdir()
        (root / "index.html").write_text("<!doctype html><title>Sage</title>")
        (root / "logo.png").write_bytes(b"png")
        (root / "assets" / "index-abc.js").write_bytes(JS)
        (root / "assets" / "index-abc.js.br").write_bytes(b"brotli-bytes")
        (root / "assets" / "index-abc.js.gz").write_bytes(gzip.compress(JS))
        (root / "assets" / "font-abc.woff2").write_bytes(b"woff2")
        app = FastAPI()

        @app.get("/api/big")
        def big(request: Request):
            return web_files.json_maybe_gzip(request, {"rows": ["x" * 50] * 100})

        app.mount("/", web_files.WebFiles(directory=str(root), html=True), name="web")
        self.client = TestClient(app)

    def test_hashed_assets_are_cached_for_a_year(self):
        r = self.client.get("/assets/font-abc.woff2")
        self.assertEqual(r.status_code, 200)
        self.assertIn("immutable", r.headers["cache-control"])
        self.assertNotIn("content-encoding", r.headers)

    def test_brotli_when_the_browser_takes_it(self):
        r = self.client.get("/assets/index-abc.js", headers={"Accept-Encoding": "gzip, deflate, br"})
        self.assertEqual(r.headers["content-encoding"], "br")
        self.assertEqual(r.headers["content-length"], str(len(b"brotli-bytes")))
        self.assertIn("javascript", r.headers["content-type"])
        self.assertIn("Accept-Encoding", r.headers["vary"])

    def test_gzip_when_no_brotli(self):
        r = self.client.get("/assets/index-abc.js", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(r.headers["content-encoding"], "gzip")
        self.assertEqual(r.content, JS)  # the client unzips it

    def test_plain_file_when_nothing_is_accepted(self):
        r = self.client.get("/assets/index-abc.js", headers={"Accept-Encoding": "identity, br;q=0"})
        self.assertNotIn("content-encoding", r.headers)
        self.assertEqual(r.content, JS)

    def test_page_and_icons_are_not_long_cached(self):
        for path in ("/", "/logo.png"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200)
            self.assertNotIn("immutable", r.headers.get("cache-control", ""))

    def test_missing_asset_is_404(self):
        self.assertEqual(self.client.get("/assets/index-old.js").status_code, 404)

    def test_big_json_is_gzipped_only_when_accepted(self):
        r = self.client.get("/api/big", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(r.headers["content-encoding"], "gzip")
        self.assertEqual(len(r.json()["rows"]), 100)
        raw = self.client.get("/api/big", headers={"Accept-Encoding": "identity"})
        self.assertNotIn("content-encoding", raw.headers)
        self.assertEqual(json.loads(raw.content)["rows"][0], "x" * 50)

    def test_accepted_reads_q_values(self):
        self.assertEqual(web_files.accepted("gzip, br;q=0"), {"gzip"})
        self.assertEqual(web_files.accepted("br;q=0.5, gzip"), {"br", "gzip"})
        self.assertEqual(web_files.accepted(""), set())


if __name__ == "__main__":
    unittest.main()
