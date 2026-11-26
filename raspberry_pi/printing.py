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
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import List, Literal, Optional

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


def _playwright_pdf(html: str, out: Path) -> None:
    """The way the slide maker drives Chromium, which is known to work on the Pi."""
    from playwright.sync_api import sync_playwright
    options: dict = {"args": ["--no-sandbox", "--disable-dev-shm-usage"]}
    explicit = _chromium()
    if explicit:
        options["executable_path"] = explicit
    with sync_playwright() as p:
        browser = p.chromium.launch(timeout=30_000, **options)
        try:
            page = browser.new_context(java_script_enabled=False).new_page()
            # Nothing is fetched from the network: a print job must never wait on a slow image.
            page.route("**/*", lambda route: route.abort() if route.request.url.startswith(("http:", "https:")) else route.continue_())
            page.set_content(html, wait_until="load", timeout=20_000)
            page.pdf(path=str(out), prefer_css_page_size=True, print_background=True)
        finally:
            browser.close()


def _cli_pdf(html: str, out: Path) -> None:
    """Fallback: the Chromium command line, killed if it hangs."""
    binary = _chromium()
    if not binary:
        raise RuntimeError("No Chromium found to make the PDF. Run: sudo apt install chromium")
    with tempfile.TemporaryDirectory(prefix="sage-print-") as tmp:
        src = Path(tmp) / "page.html"
        src.write_text(html, encoding="utf-8")
        args = [binary, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
                "--no-first-run", f"--user-data-dir={tmp}/profile", "--no-pdf-header-footer",
                f"--print-to-pdf={out}", src.as_uri()]
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, 9)   # chromium leaves helper processes behind
            proc.communicate()
            if not (out.exists() and out.stat().st_size > 0):
                raise RuntimeError("Chromium took too long to make the PDF.")


def html_to_pdf(html: str, out: Path) -> None:
    """Headless Chromium prints the page to PDF. Scripts are off and nothing loads from the network."""
    errors = []
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        errors.append("playwright isn't installed")
    else:
        try:
            _playwright_pdf(html, out)
        except Exception as e:
            errors.append(str(e).splitlines()[0] if str(e) else "playwright failed")
    if not (out.exists() and out.stat().st_size > 0):
        try:
            _cli_pdf(html, out)
        except Exception as e:
            errors.append(str(e))
    if not (out.exists() and out.stat().st_size > 0):
        raise RuntimeError("Couldn't make the PDF: " + "; ".join(errors))


TEST_PAGE = """<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:20mm}
body{font:14pt -apple-system,Helvetica,Arial,sans-serif;color:#111}h1{font-size:26pt;margin:0 0 4mm}
.box{border:2px solid #111;padding:6mm;margin-top:8mm;border-radius:4mm}</style>
<h1>Sage test page</h1><p>If you can read this, your printer is set up.</p>
<div class="box">Printer: <b>%s</b></div>"""


QUALITY = {"draft": "3", "normal": "4", "high": "5"}   # IPP print-quality values


def quality_options(quality: str = "normal", mono: bool = False) -> List[str]:
    """lp -o flags: Draft saves ink, High uses the most; black and white skips colour ink."""
    flags: List[str] = []
    if quality in ("draft", "high"):
        flags += ["-o", f"print-quality={QUALITY[quality]}"]
    if mono:
        flags += ["-o", "print-color-mode=monochrome"]
    return flags


def _lp(printer: str, pdf: Path, title: str, copies: int, quality: str = "normal", mono: bool = False) -> str:
    out = _run(["lp", "-d", printer, "-n", str(max(1, min(copies, 20))), "-t", title[:80] or "Sage",
                *quality_options(quality, mono), str(pdf)])
    return out.strip()


def _clean_title(title: str) -> str:
    return re.sub(r"[^\w .,()-]+", "", title or "").strip()[:80] or "Sage"


class AddPrinter(BaseModel):
    uri: str
    name: str


Quality = Literal["draft", "normal", "high"]


class PrintJob(BaseModel):
    printer: str
    quality: Quality = "normal"
    mono: bool = False
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


class TestOptions(BaseModel):
    quality: Quality = "normal"
    mono: bool = False


@router.post("/api/printers/{name}/test")
async def test_page(name: str, req: Optional[TestOptions] = None):
    req = req or TestOptions()

    def go():
        _known(name)
        with tempfile.TemporaryDirectory(prefix="sage-print-") as tmp:
            pdf = Path(tmp) / "test.pdf"
            html_to_pdf(TEST_PAGE % name, pdf)
            return _lp(name, pdf, "Sage test page", 1, req.quality, req.mono)
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
            return _lp(req.printer, pdf, _clean_title(req.title), req.copies, req.quality, req.mono)
    return {"success": True, "job": await _guard(go)}


# --- Back to back, one sheet at a time ---
#
# For printers with no duplex unit. The job prints one side, then waits while you
# flip the sheet and put it back, and prints the other side only when you say OK.
# After the back it waits again for a fresh sheet. Only the sheet being printed is
# ever cut out of the PDF, so a long document never sits in memory.

MAX_JOBS = 3
JOB_KEEP_SECONDS = 4 * 3600
JOBS: dict = {}
_jobs_lock = threading.Lock()


def pdf_pages(path: Path) -> int:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise RuntimeError("pypdf isn't installed. Run: sudo deploy/install_pi.sh --only server")
    with open(path, "rb") as f:
        return len(PdfReader(f).pages)


def sheet_steps(pages: int) -> List[tuple]:
    """(page number, side) for every printing step: sheet 1 front, sheet 1 back, sheet 2 front..."""
    steps = []
    for p in range(1, pages + 1):
        steps.append((p, "front" if p % 2 else "back"))
    return steps


def _send_page(printer: str, pdf: Path, page: int, rotate: bool, title: str, quality: str = "normal", mono: bool = False) -> str:
    from pypdf import PdfReader, PdfWriter
    with tempfile.TemporaryDirectory(prefix="sage-sheet-") as tmp:
        one = Path(tmp) / "sheet.pdf"
        with open(pdf, "rb") as f:
            writer = PdfWriter()
            pg = PdfReader(f).pages[page - 1]
            if rotate:
                pg.rotate(180)
            writer.add_page(pg)
            with open(one, "wb") as out:
                writer.write(out)
        return _lp(printer, one, title, 1, quality, mono)


def job_view(job: dict) -> dict:
    steps = job["steps"]
    done = job["done"]
    total_sheets = (job["pages"] + 1) // 2
    out = {"id": job["id"], "title": job["title"], "printer": job["printer"], "pages": job["pages"],
           "sheets": total_sheets, "flip": job["flip"], "error": job.get("error", ""), "note": job.get("note", ""),
           "quality": job["quality"], "mono": job["mono"], "finished": done >= len(steps)}
    if done >= len(steps):
        out.update(sheet=total_sheets, stage="done", message=f"All {total_sheets} sheet{'s' if total_sheets != 1 else ''} sent.")
        return out
    if done == 0:
        out.update(sheet=1, stage="start", message="Ready. Press Print to send the front of sheet 1.")
        return out
    page, side = steps[done - 1]
    sheet = (page + 1) // 2
    nxt_page, nxt_side = steps[done]
    if nxt_side == "back":
        out.update(sheet=sheet, stage="flip", next="Print back side",
                   message=f"Sheet {sheet} front is printing. When it is out, flip it over and put it back in the printer, then press the button.")
    else:
        out.update(sheet=sheet + 1, stage="reload", next=f"Print sheet {sheet + 1}",
                   message=f"Sheet {sheet} is done. Put a fresh sheet in the printer, then press the button.")
    return out


def _forget_old(now: float) -> None:
    for jid in [j for j, v in JOBS.items() if now - v["touched"] > JOB_KEEP_SECONDS or (v["done"] >= len(v["steps"]) and now - v["touched"] > 1800)]:
        _drop_job(jid)


def _drop_job(jid: str) -> None:
    job = JOBS.pop(jid, None)
    if job and job.get("own") and job["pdf"].exists():
        shutil.rmtree(job["pdf"].parent, ignore_errors=True)


def start_duplex(printer: str, title: str, pdf: Path, own: bool, flip_short_edge: bool, quality: str = "normal", mono: bool = False) -> dict:
    _known(printer)
    pages = pdf_pages(pdf)
    if pages < 1:
        raise RuntimeError("That PDF has no pages.")
    with _jobs_lock:
        _forget_old(time.time())
        if len(JOBS) >= MAX_JOBS:
            raise HTTPException(status_code=409, detail="Finish or stop a back to back job first.")
        jid = secrets.token_hex(6)
        JOBS[jid] = {"id": jid, "printer": printer, "title": _clean_title(title), "pdf": pdf, "own": own, "pages": pages,
                     "steps": sheet_steps(pages), "done": 0, "flip": bool(flip_short_edge), "quality": quality, "mono": bool(mono), "touched": time.time()}
        return job_view(JOBS[jid])


def advance_duplex(jid: str, again: bool = False) -> dict:
    with _jobs_lock:
        job = JOBS.get(jid)
        if not job:
            raise HTTPException(status_code=404, detail="That job is gone. Start it again.")
        if again:
            job["done"] = max(0, job["done"] - 1)
        if job["done"] >= len(job["steps"]):
            return job_view(job)
        page, side = job["steps"][job["done"]]
        try:
            _known(job["printer"])
            _send_page(job["printer"], job["pdf"], page, job["flip"] and side == "back", f"{job['title']} p{page}", job["quality"], job["mono"])
        except Exception as e:
            job["error"] = friendly(e)
            raise HTTPException(status_code=502, detail=friendly(e))
        job["error"] = ""
        job["done"] += 1
        job["touched"] = time.time()
        job.pop("note", None)
        return job_view(job)


def goto_sheet(jid: str, sheet: int) -> dict:
    """Jam or smudge: go back (or forward) to the front of a sheet. Nothing prints until you press the button."""
    with _jobs_lock:
        job = JOBS.get(jid)
        if not job:
            raise HTTPException(status_code=404, detail="That job is gone. Start it again.")
        sheets = (job["pages"] + 1) // 2
        if not 1 <= sheet <= sheets:
            raise HTTPException(status_code=400, detail=f"This has {sheets} sheet{'s' if sheets != 1 else ''}.")
        job["done"] = 2 * (sheet - 1)
        job["touched"] = time.time()
        job["note"] = f"Starting again from sheet {sheet}."
        view = job_view(job)
        if sheet == 1:
            view["next"] = "Print sheet 1"
        return view


def reprint_page(jid: str, page: int) -> dict:
    """Prints one page again right now. The job stays where it was."""
    with _jobs_lock:
        job = JOBS.get(jid)
        if not job:
            raise HTTPException(status_code=404, detail="That job is gone. Start it again.")
        if not 1 <= page <= job["pages"]:
            raise HTTPException(status_code=400, detail=f"This has {job['pages']} page{'s' if job['pages'] != 1 else ''}.")
        side = "front" if page % 2 else "back"
        try:
            _known(job["printer"])
            _send_page(job["printer"], job["pdf"], page, job["flip"] and side == "back", f"{job['title']} p{page}", job["quality"], job["mono"])
        except Exception as e:
            job["error"] = friendly(e)
            raise HTTPException(status_code=502, detail=friendly(e))
        job["error"] = ""
        job["touched"] = time.time()
        job["note"] = f"Page {page} sent again ({'front' if side == 'front' else 'back'} of sheet {(page + 1) // 2})."
        return job_view(job)


def set_job_options(jid: str, quality: str, mono: bool) -> dict:
    with _jobs_lock:
        job = JOBS.get(jid)
        if not job:
            raise HTTPException(status_code=404, detail="That job is gone. Start it again.")
        job["quality"], job["mono"] = quality, bool(mono)
        return job_view(job)


class DuplexJob(BaseModel):
    printer: str
    quality: Quality = "normal"
    mono: bool = False
    title: str = "Sage"
    html: str
    flip: bool = False


@router.post("/api/print/duplex")
async def duplex_from_html(req: DuplexJob):
    if len(req.html) > MAX_HTML:
        raise HTTPException(status_code=413, detail="That's too big to print in one go.")
    if not req.html.strip():
        raise HTTPException(status_code=400, detail="Nothing to print.")

    def go():
        _known(req.printer)
        folder = Path(tempfile.mkdtemp(prefix="sage-duplex-"))
        pdf = folder / "job.pdf"
        try:
            html_to_pdf(req.html, pdf)
            job = start_duplex(req.printer, req.title, pdf, True, req.flip, req.quality, req.mono)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        return job
    return {"success": True, "job": await _guard(go)}


@router.get("/api/print/jobs")
async def list_jobs():
    with _jobs_lock:
        _forget_old(time.time())
        return {"success": True, "jobs": [job_view(j) for j in JOBS.values()]}


@router.post("/api/print/jobs/{jid}/continue")
async def continue_job(jid: str):
    return {"success": True, "job": await _guard(advance_duplex, jid)}


@router.post("/api/print/jobs/{jid}/again")
async def again_job(jid: str):
    return {"success": True, "job": await _guard(advance_duplex, jid, True)}


class SheetPick(BaseModel):
    sheet: int


class PagePick(BaseModel):
    page: int


class JobOptions(BaseModel):
    quality: Quality = "normal"
    mono: bool = False


@router.post("/api/print/jobs/{jid}/restart")
async def restart_job(jid: str, req: SheetPick):
    return {"success": True, "job": await _guard(goto_sheet, jid, req.sheet)}


@router.post("/api/print/jobs/{jid}/reprint")
async def reprint_job(jid: str, req: PagePick):
    return {"success": True, "job": await _guard(reprint_page, jid, req.page)}


@router.post("/api/print/jobs/{jid}/options")
async def job_options(jid: str, req: JobOptions):
    return {"success": True, "job": await _guard(set_job_options, jid, req.quality, req.mono)}


@router.delete("/api/print/jobs/{jid}")
async def stop_job(jid: str):
    with _jobs_lock:
        _drop_job(jid)
    return {"success": True}
