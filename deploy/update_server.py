#!/usr/bin/env python3
"""Tiny HTTP server that shows the Sage update screen while the real server is down.

Usage:
    python3 deploy/update_server.py [--port 8000] [--repo /path/to/sage-os]

Serves deploy/update-screen.html on every route and the Sage icon at /icon-512.png.
Writes its PID to deploy/.update-server.pid so the caller can stop it.
"""
import argparse, os, signal, sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

class _Handler(SimpleHTTPRequestHandler):
    repo = Path(".")

    def do_GET(self):
        if self.path == "/icon-512.png":
            icon = self.repo / "public" / "icon-512.png"
            if icon.exists():
                data = icon.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
        html = self.repo / "deploy" / "update-screen.html"
        data = html.read_bytes() if html.exists() else b"<h1>Updating...</h1>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass  # silent

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--repo", default=".")
    args = p.parse_args()
    _Handler.repo = Path(args.repo)

    pid_file = _Handler.repo / "deploy" / ".update-server.pid"
    pid_file.write_text(str(os.getpid()))

    def _cleanup(*_):
        pid_file.unlink(missing_ok=True)
        sys.exit(0)
    signal.signal(signal.SIGTERM, _cleanup)
    signal.signal(signal.SIGINT, _cleanup)

    bind = os.environ.get("SAGE_BIND", "127.0.0.1")
    srv = HTTPServer((bind, args.port), _Handler)
    srv.serve_forever()

if __name__ == "__main__":
    main()
