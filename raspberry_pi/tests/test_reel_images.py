"""Reel picture downloads: a descriptive User-Agent, redirects, Commons File: names, web pages with og:image,
and a clear error when nothing works.   cd raspberry_pi && python -m unittest tests.test_reel_images"""
import io
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "content_engine" / "src"))

from PIL import Image  # noqa: E402
from autocontent.spec import build  # noqa: E402

JPG = io.BytesIO()
Image.new("RGB", (40, 30), "red").save(JPG, "JPEG")
JPG = JPG.getvalue()
SEEN = []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        ua = self.headers.get("User-Agent", "")
        SEEN.append((self.path, ua))
        if self.path == "/pic.jpg":
            if ua.startswith("Mozilla"):
                self.send_response(403); self.end_headers(); return
            self._send(JPG, "image/jpeg")
        elif self.path == "/redir":
            self.send_response(302); self.send_header("Location", "/pic.jpg"); self.end_headers()
        elif self.path == "/page":
            self._send(b'<html><meta property="og:image" content="/pic.jpg"></html>', "text/html")
        else:
            self.send_response(404); self.end_headers()

    def _send(self, body, ctype):
        self.send_response(200); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def get(self, ref):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(build, "_cache_dir", lambda: Path(d)):
            return build._download(ref).suffix

    def test_descriptive_agent_redirect_page(self):
        self.assertEqual(self.get(self.base + "/pic.jpg"), ".jpg")
        self.assertEqual(self.get(self.base + "/redir"), ".jpg")
        self.assertEqual(self.get(self.base + "/page"), ".jpg")

    def test_failure_message(self):
        with self.assertRaises(ValueError) as c:
            self.get(self.base + "/missing")
        self.assertIn("HTTP 404", str(c.exception))
        self.assertIn("upload the picture", str(c.exception))

    def test_commons_names(self):
        n = "Arduino_Uno_with_breadboard.jpg"
        self.assertEqual(build._commons_file_name("https://upload.wikimedia.org/wikipedia/commons/3/33/" + n), n)
        self.assertEqual(build._commons_file_name("https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/%s/800px-%s" % (n, n)), n)
        self.assertEqual(build._commons_file_name("https://commons.wikimedia.org/wiki/File:Arduino Uno.jpg"), "Arduino_Uno.jpg")
        self.assertEqual(build._commons_file_name("File:Arduino Uno.jpg"), "Arduino_Uno.jpg")
        self.assertTrue(build.is_remote_ref("File:X.jpg"))
        c = build._candidate_urls("https://upload.wikimedia.org/wikipedia/commons/3/33/" + n)
        self.assertEqual(len(c), 2)
        self.assertIn("Special:FilePath/" + n, c[1])


if __name__ == "__main__":
    unittest.main()
