"""
printing.py - Printers for Sage, through CUPS on the Pi.

Settings > Printers finds printers on the network or USB (`lpinfo -v`), adds
one (`lpadmin`, driverless IPP Everywhere), makes it the default, prints a test
page and removes it. A note, report or thought map sent from the app arrives as
clean HTML, is turned into a PDF with headless Chromium (the same one the slide
maker uses) and is handed to `lp`.

Everything here shells out to the CUPS command line tools. When they are not
installed `GET /api/printers` answers available: false with a reason, and the
app falls back to the browser's own Print dialog.
"""

import asyncio
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log = logging.getLogger("printing")
router = APIRouter()

NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$")
URI = re.compile(r"^(ipps?|https?|socket|lpd|usb|dnssd|hp|hpfax|smb)://[^\s'\"`$;|&<>\\]{1,300}$")
MAX_HTML = 6_000_000
CMD_TIMEOUT = 20
DISCOVER_TIMEOUT = 40
PDF_TIMEOUT = 60


class NoCups(Exception):
    pass


def available() -> bool:
    return bool(shutil.which("lpstat") and shutil.which("lp") and shutil.which("lpadmin"))


def _run(args: List[str], timeout: int = CMD_TIMEOUT) -> str:
    if not shutil.which(args[0]):
        raise NoCups(f"{args[0]} is not installed")
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{args[0]} took too long")
    if out.returncode != 0:
        msg = (out.stderr or out.stdout or "").strip().splitlines()
        raise RuntimeError(msg[-1] if msg else f"{args[0]} failed")
    return out.stdout


def reason() -> str:
    return "Printing isn't set up on this machine. Run: sudo deploy/install_pi.sh --only packages"


def parse_printers(devices: str, status: str, default: str) -> List[dict]:
    """`lpstat -v` and `lpstat -p` text into one row per printer."""
    uris = {}
    for line in devices.splitlines():
        m = re.match(r"device for (\S+?):\s*(\S+)", line)
        if m:
            uris[m.group(1)] = m.group(2)
    rows = {}
    for line in status.splitlines():
        m = re.match(r"printer (\S+) (.*)", line)
        if not m:
            continue
        text = m.group(2)
        state = "disabled" if "disabled" in text else "printing" if "now printing" in text else "idle"
        rows[m.group(1)] = state
    names = sorted(set(uris) | set(rows))
    return [{"name": n, "uri": uris.get(n, ""), "state": rows.get(n, "idle"), "default": n == default} for n in names]


def parse_devices(text: str) -> List[dict]:
    """`lpinfo -v` into network and USB printers (the generic scheme-only rows are dropped)."""
    out, seen = [], set()
    for line in text.splitlines():
        kind, _, uri = line.partition(" ")
        uri = uri.strip()
        if kind not in ("network", "direct") or "://" not in uri or uri.endswith("://"):
            continue
        if uri.split("://")[0] in ("hpfax", "cups-brf", "serial", "parallel") or uri in seen:
            continue
        seen.add(uri)
        name = re.sub(r"[?&].*", "", uri.split("://", 1)[1]).replace("%20", " ").strip("/")
        parts = [x for x in name.split("/") if x]
        label = parts[-1] if parts else name
        if label.lower() in ("print", "ipp", "printer") and len(parts) > 1:
            label = parts[0]   # an IPP address ends in /ipp/print; the host says more
        out.append({"uri": uri, "label": label or name, "kind": "usb" if uri.startswith("usb:") else "network"})
    return out


def state() -> dict:
    if not available():
        return {"available": False, "reason": reason(), "printers": []}
    try:
        devices = _run(["lpstat", "-v"])
    except RuntimeError as e:
        if "destinations" not in str(e):   # "No destinations added" is an empty list, not an error
            raise
        devices = ""
    try:
        status = _run(["lpstat", "-p"])
    except RuntimeError:
        status = ""
    try:
        d = _run(["lpstat", "-d"])
        default = (re.search(r"destination:\s*(\S+)", d) or [None, ""])[1]
    except RuntimeError:
        default = ""
    return {"available": True, "printers": parse_printers(devices, status, default), "pdf": pdf_possible()}


def friendly(e: Exception) -> str:
    text = str(e)
    if "Forbidden" in text or "not authorized" in text.lower():
        return "The Sage user may not manage printers. Run: sudo usermod -aG lpadmin <user> and restart Sage."
    if "Bad device-uri" in text or "Bad URI" in text:
        return "That printer address isn't one CUPS understands."
    return text or "The printer service didn't answer."


# --- HTML to PDF ---

def _chromium() -> Optional[str]:
    explicit = os.environ.get("AUTOCONTENT_CHROMIUM", "").strip()
    if explicit and Path(explicit).exists():
        return explicit
    return shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")


def pdf_possible() -> bool:
    if _chromium():
        return True
    root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / ".cache" / "ms-playwright")
    return root.is_dir() and any(root.glob("chromium*"))


def html_to_pdf(html: str, out: Path) -> None:
    """Headless Chromium prints the page to PDF. Scripts are off and nothing loads from the network."""
    with tempfile.TemporaryDirectory(prefix="sage-print-") as tmp:
        src = Path(tmp) / "page.html"
        src.write_text(html, encoding="utf-8")
        binary = _chromium()
        if binary:
            args = [binary, "--headless", "--no-sandbox", "--disable-gpu", "--disable-javascript",
                    "--no-pdf-header-footer", f"--print-to-pdf={out}", src.as_uri()]
            proc = subprocess.run(args, capture_output=True, text=True, timeout=PDF_TIMEOUT)
            if proc.returncode == 0 and out.exists() and out.stat().st_size > 0:
                return
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError("No Chromium found to make the PDF. Run: playwright install chromium")
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=binary) if binary else p.chromium.launch()
            try:
                page = browser.new_context(java_script_enabled=False).new_page()
                page.goto(src.as_uri())
                page.pdf(path=str(out), prefer_css_page_size=True, print_background=True)
            finally:
                browser.close()
    if not out.exists() or out.stat().st_size == 0:
        raise RuntimeError("Couldn't make the PDF.")


TEST_PAGE = """<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:20mm}
body{font:14pt -apple-system,Helvetica,Arial,sans-serif;color:#111}h1{font-size:26pt;margin:0 0 4mm}
.box{border:2px solid #111;padding:6mm;margin-top:8mm;border-radius:4mm}</style>
<h1>Sage test page</h1><p>If you can read this, your printer is set up.</p>
<div class="box">Printer: <b>%s</b></div>"""


def _lp(printer: str, pdf: Path, title: str, copies: int) -> str:
    out = _run(["lp", "-d", printer, "-n", str(max(1, min(copies, 20))), "-t", title[:80] or "Sage", str(pdf)])
    return out.strip()


def _clean_title(title: str) -> str:
    return re.sub(r"[^\w .,()-]+", "", title or "").strip()[:80] or "Sage"


class AddPrinter(BaseModel):
    uri: str
    name: str


class PrintJob(BaseModel):
    printer: str
    title: str = "Sage"
    html: str
    copies: int = 1


async def _guard(fn, *a):
    try:
        return await asyncio.to_thread(fn, *a)
    except HTTPException:
        raise
    except NoCups:
        raise HTTPException(status_code=409, detail=reason())
    except Exception as e:
        raise HTTPException(status_code=502, detail=friendly(e))


def _known(name: str) -> None:
    if not NAME.match(name or ""):
        raise HTTPException(status_code=400, detail="That isn't a printer name.")
    if name not in {p["name"] for p in state().get("printers", [])}:
        raise HTTPException(status_code=404, detail="No printer by that name.")


@router.get("/api/printers")
async def list_printers():
    return {"success": True, **await _guard(state)}


@router.post("/api/printers/discover")
async def discover():
    """Printers CUPS can see right now, minus those already added."""
    def go():
        found = parse_devices(_run(["lpinfo", "-v"], timeout=DISCOVER_TIMEOUT))
        have = {p["uri"] for p in state().get("printers", [])}
        return [d for d in found if d["uri"] not in have]
    return {"success": True, "found": await _guard(go)}


@router.post("/api/printers")
async def add_printer(req: AddPrinter):
    if not NAME.match(req.name or ""):
        raise HTTPException(status_code=400, detail="Use letters, numbers, - or _ for the printer's name.")
    if not URI.match(req.uri or ""):
        raise HTTPException(status_code=400, detail="That printer address isn't valid.")

    def go():
        _run(["lpadmin", "-p", req.name, "-E", "-v", req.uri, "-m", "everywhere"], timeout=60)
        if not state().get("printers") or not any(p["default"] for p in state()["printers"]):
            _run(["lpadmin", "-d", req.name])
        return state()
    return {"success": True, **await _guard(go)}


@router.post("/api/printers/{name}/default")
async def set_default(name: str):
    def go():
        _known(name)
        _run(["lpadmin", "-d", name])
        return state()
    return {"success": True, **await _guard(go)}


@router.delete("/api/printers/{name}")
async def remove_printer(name: str):
    def go():
        _known(name)
        _run(["lpadmin", "-x", name])
        return state()
    return {"success": True, **await _guard(go)}


@router.post("/api/printers/{name}/test")
async def test_page(name: str):
    def go():
        _known(name)
        with tempfile.TemporaryDirectory(prefix="sage-print-") as tmp:
            pdf = Path(tmp) / "test.pdf"
            html_to_pdf(TEST_PAGE % name, pdf)
            return _lp(name, pdf, "Sage test page", 1)
    return {"success": True, "job": await _guard(go)}


@router.post("/api/print")
async def print_job(req: PrintJob):
    if len(req.html) > MAX_HTML:
        raise HTTPException(status_code=413, detail="That's too big to print in one go.")
    if not req.html.strip():
        raise HTTPException(status_code=400, detail="Nothing to print.")

    def go():
        _known(req.printer)
        with tempfile.TemporaryDirectory(prefix="sage-print-") as tmp:
            pdf = Path(tmp) / "job.pdf"
            html_to_pdf(req.html, pdf)
            return _lp(req.printer, pdf, _clean_title(req.title), req.copies)
    return {"success": True, "job": await _guard(go)}
