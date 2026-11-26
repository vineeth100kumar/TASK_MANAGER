"""
printdrop.py - Printer drop: PDFs kept on the Pi, ready to print on any printer.

Drop's page has a Printer drop section. Upload a PDF there (it is streamed to
disk, never held in memory), then print it on one side, or back to back one
sheet at a time (printing.py). Files stay until you delete them, within small
limits so the Pi's card never fills: MAX_MB per PDF and MAX_FILES in all.

Files live in <data folder>/printdrop/<id>.pdf with a small <id>.json beside
each. Nothing here is public: every route needs Sage's password or key.
"""

import asyncio
import json
import os
import re
import secrets
import shutil
import time
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import printing

router = APIRouter()

MAX_MB = int(os.getenv("SAGE_PRINTDROP_MB", "30") or 30)
MAX_FILES = int(os.getenv("SAGE_PRINTDROP_FILES", "20") or 20)
KEEP_FREE_BYTES = 256 * 1024 * 1024
ID = re.compile(r"^[0-9a-f]{12}$")
DIR = Path("printdrop")


def connect(db_path: str) -> None:
    global DIR
    DIR = Path(os.getenv("SAGE_PRINTDROP_DIR", "") or Path(db_path).resolve().parent / "printdrop")
    DIR.mkdir(parents=True, exist_ok=True)


def _meta_path(fid: str) -> Path:
    return DIR / f"{fid}.json"


def _pdf_path(fid: str) -> Path:
    return DIR / f"{fid}.pdf"


def list_files() -> List[dict]:
    out = []
    for meta in sorted(DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(meta.read_text())
        except (OSError, ValueError):
            continue
        if _pdf_path(data.get("id", "")).is_file():
            out.append(data)
    return out


def clean_name(raw: str) -> str:
    name = re.sub(r"[^\w .,()&'+-]+", "", Path(raw or "").name).strip()[:80]
    if not name.lower().endswith(".pdf"):
        name = (name or "document") + ".pdf"
    return name


def _get(fid: str) -> dict:
    if not ID.match(fid or ""):
        raise HTTPException(status_code=400, detail="That isn't a file id.")
    try:
        data = json.loads(_meta_path(fid).read_text())
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="That file is gone.")
    if not _pdf_path(fid).is_file():
        raise HTTPException(status_code=404, detail="That file is gone.")
    return data


async def save_pdf(name: str, length: int, chunks) -> dict:
    """Streams one PDF to disk, refusing it as soon as it goes past the limits."""
    limit = MAX_MB * 1048576
    if length > limit:
        raise HTTPException(status_code=413, detail=f"A PDF can be up to {MAX_MB} MB.")
    if len(await asyncio.to_thread(list_files)) >= MAX_FILES:
        raise HTTPException(status_code=409, detail=f"Printer drop holds up to {MAX_FILES} PDFs. Delete one first.")
    free = await asyncio.to_thread(lambda: shutil.disk_usage(DIR).free)
    if free - length < KEEP_FREE_BYTES:
        raise HTTPException(status_code=413, detail="The Pi is nearly out of space. Delete some files first.")
    fid = secrets.token_hex(6)
    part = DIR / f".part-{fid}"
    written = 0
    first = b""
    try:
        with open(part, "wb") as f:
            async for chunk in chunks:
                if not first:
                    first = chunk[:5]
                    if first != b"%PDF-":
                        raise HTTPException(status_code=400, detail="That isn't a PDF.")
                written += len(chunk)
                if written > limit or written > length:
                    raise HTTPException(status_code=413, detail=f"A PDF can be up to {MAX_MB} MB.")
                await asyncio.to_thread(f.write, chunk)
        if not written:
            raise HTTPException(status_code=400, detail="That file is empty.")
        try:
            pages = await asyncio.to_thread(printing.pdf_pages, part)
        except RuntimeError as e:
            if "pypdf" in str(e):
                raise HTTPException(status_code=409, detail=str(e))
            raise HTTPException(status_code=400, detail="That PDF can't be read.")
        except Exception:
            raise HTTPException(status_code=400, detail="That PDF can't be read.")
        os.replace(part, _pdf_path(fid))
    finally:
        if part.exists():
            part.unlink()
    meta = {"id": fid, "name": clean_name(name), "pages": pages, "bytes": written, "createdAt": int(time.time())}
    _meta_path(fid).write_text(json.dumps(meta))
    return meta


class PrintFile(BaseModel):
    printer: str
    quality: printing.Quality = "normal"
    mono: bool = False
    mode: str = "single"      # single | duplex
    copies: int = 1
    flip: bool = False        # turn the back side 180 degrees (short-edge flip)


@router.get("/api/printdrop")
async def printdrop_list():
    files = await asyncio.to_thread(list_files)
    return {"success": True, "files": files, "maxMb": MAX_MB, "maxFiles": MAX_FILES}


@router.post("/api/printdrop")
async def printdrop_upload(request: Request, name: str = ""):
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        return JSONResponse({"success": False, "detail": "Upload size unknown."}, status_code=411)
    meta = await save_pdf(name, int(length), request.stream())
    return {"success": True, "file": meta}


@router.delete("/api/printdrop/{fid}")
async def printdrop_delete(fid: str):
    _get(fid)
    for p in (_pdf_path(fid), _meta_path(fid)):
        p.unlink(missing_ok=True)
    return {"success": True}


@router.post("/api/printdrop/{fid}/print")
async def printdrop_print(fid: str, req: PrintFile):
    meta = _get(fid)
    pdf = _pdf_path(fid)
    if req.mode == "duplex":
        job = await printing._guard(printing.start_duplex, req.printer, meta["name"], pdf, False, req.flip, req.quality, req.mono)
        return {"success": True, "job": job}

    def go():
        printing._known(req.printer)
        return printing._lp(req.printer, pdf, printing._clean_title(meta["name"]), req.copies, req.quality, req.mono)
    return {"success": True, "message": await printing._guard(go)}
