"""
Serves the built web app (dist/) quickly, so Sage opens fast after the password.

Two things the plain StaticFiles mount didn't do:
- Files under /assets/ have a content hash in their name (index-CiWZ4QOL.js),
  so a given name never changes. Browsers may keep them for a year without
  asking again; a new build gets new names. Before this, every opening of the
  app re-checked every script and stylesheet with the Pi.
- The build writes a .br and .gz copy next to each script and stylesheet
  (vite.config.ts, precompress). The browser gets the smallest one it accepts,
  so about 1 MB of startup code travels as about 0.2 MB, with no compressing
  work on the Pi per request.

Everything else (index.html, icons, the manifest) is served as before; the
password gate's no-store on the page itself is set in db_server.require_login.
"""

import gzip
import mimetypes
import os

from starlette.datastructures import Headers
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.staticfiles import NotModifiedResponse, StaticFiles

IMMUTABLE = "public, max-age=31536000, immutable"
# Best first. Only these two are written by the build.
ENCODINGS = (("br", ".br"), ("gzip", ".gz"))


def accepted(header: str) -> set:
    """Codings the browser will take, from Accept-Encoding (q=0 means no)."""
    out = set()
    for part in header.lower().split(","):
        name, _, params = part.strip().partition(";")
        q = params.replace(" ", "").partition("q=")[2]
        try:
            if q and float(q) == 0:
                continue
        except ValueError:
            pass
        if name.strip():
            out.add(name.strip())
    return out


class WebFiles(StaticFiles):
    def file_response(self, full_path, stat_result, scope, status_code: int = 200) -> Response:
        rel = os.path.relpath(str(full_path), str(self.directory)).replace(os.sep, "/")
        if not rel.startswith("assets/") or status_code != 200:
            return super().file_response(full_path, stat_result, scope, status_code)

        request_headers = Headers(scope=scope)
        media_type = mimetypes.guess_type(str(full_path))[0] or "application/octet-stream"
        encoding, path = self._smallest(str(full_path), accepted(request_headers.get("accept-encoding", "")))

        headers = {"Cache-Control": IMMUTABLE}
        if self._has_variants(str(full_path)):
            headers["Vary"] = "Accept-Encoding"
        if encoding:
            headers["Content-Encoding"] = encoding
            response = FileResponse(path, status_code=200, media_type=media_type, headers=headers)
        else:
            response = FileResponse(full_path, status_code=200, stat_result=stat_result, media_type=media_type, headers=headers)
        if self.is_not_modified(response.headers, request_headers):
            return NotModifiedResponse(response.headers)
        return response

    @staticmethod
    def _smallest(full_path: str, ok: set):
        for name, suffix in ENCODINGS:
            if name in ok and os.path.isfile(full_path + suffix):
                return name, full_path + suffix
        return None, full_path

    @staticmethod
    def _has_variants(full_path: str) -> bool:
        return any(os.path.isfile(full_path + suffix) for _, suffix in ENCODINGS)


def json_maybe_gzip(request, content) -> Response:
    """A JSON answer, gzipped when it is big and the browser takes gzip."""
    response = JSONResponse(content)
    if len(response.body) < 1024 or "gzip" not in accepted(request.headers.get("accept-encoding", "")):
        return response
    return Response(
        gzip.compress(response.body, compresslevel=5),
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
    )
