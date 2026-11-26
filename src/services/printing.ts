// printing.ts - Printers on the Pi (CUPS) and the browser's own Print dialog.
//
// The Pi server (raspberry_pi/printing.py) lists, adds and removes printers and
// turns a page of HTML into a PDF for `lp`. Without a Pi, or when it has no
// CUPS, printNote falls back to the browser's Print dialog, which also saves PDFs.

import { useCallback, useEffect, useState } from 'react';
import { piBackendUrl, piHeaders } from './piBackend';

export interface Printer {
  name: string;
  uri: string;
  state: 'idle' | 'printing' | 'disabled';
  default: boolean;
}

export interface FoundPrinter { uri: string; label: string; kind: 'network' | 'usb' }

export interface PrinterState { available: boolean; reason?: string; printers: Printer[]; pdf?: boolean }

const call = async <T = any>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const res = await fetch(`${piBackendUrl()}${path}`, {
    method,
    headers: piHeaders(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || 'The Pi could not do that.');
  return data;
};

export function usePrinters() {
  const hasServer = !!piBackendUrl();
  const [state, setState] = useState<PrinterState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasServer) return;
    try {
      setState(await call<PrinterState>('/api/printers'));
      setProblem(null);
    } catch (e: any) {
      setProblem(e?.message || "Can't reach the Pi right now.");
    }
  }, [hasServer]);

  useEffect(() => { load(); }, [load]);

  // Runs a command; resolves with an error message, or null when it worked.
  const run = useCallback(async (fn: () => Promise<any>): Promise<string | null> => {
    try {
      const data = await fn();
      if (data && Array.isArray(data.printers)) setState(data);
      return null;
    } catch (e: any) {
      return e?.message || 'The Pi could not do that.';
    }
  }, []);

  return {
    hasServer, state, problem, reload: load,
    discover: async (): Promise<{ found: FoundPrinter[]; error: string | null }> => {
      try { return { found: (await call('/api/printers/discover', 'POST')).found, error: null }; }
      catch (e: any) { return { found: [], error: e?.message || 'The Pi could not look.' }; }
    },
    add: (uri: string, name: string) => run(() => call('/api/printers', 'POST', { uri, name })),
    makeDefault: (name: string) => run(() => call(`/api/printers/${encodeURIComponent(name)}/default`, 'POST')),
    remove: (name: string) => run(() => call(`/api/printers/${encodeURIComponent(name)}`, 'DELETE')),
    testPage: (name: string) => run(() => call(`/api/printers/${encodeURIComponent(name)}/test`, 'POST')),
  };
}

/** How much ink a job may use: Draft saves the most, High the least. Black and white skips colour ink. */
export type Quality = 'draft' | 'normal' | 'high';
export interface PrintOptions { quality: Quality; mono: boolean }

const OPTIONS_KEY = 'sage-print-options';
export const loadPrintOptions = (): PrintOptions => {
  try {
    const o = JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}');
    return { quality: ['draft', 'normal', 'high'].includes(o.quality) ? o.quality : 'normal', mono: !!o.mono };
  } catch { return { quality: 'normal', mono: false }; }
};
export const savePrintOptions = (o: PrintOptions): void => {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(o)); } catch { /* private window */ }
};

/** Sends a finished page to a printer the Pi knows. */
export const printOnPi = (printer: string, title: string, html: string, copies = 1, opts: PrintOptions = loadPrintOptions()) =>
  call('/api/print', 'POST', { printer, title, html, copies, ...opts });

/** Opens the browser's Print dialog for a page of HTML (choose "Save as PDF" there to keep a file). */
export function printInBrowser(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  // No scripts in the page being printed; the dialog still opens from out here.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

// --- Back to back, one sheet at a time ---

export interface DuplexJob {
  id: string;
  title: string;
  printer: string;
  pages: number;
  sheets: number;
  sheet: number;
  stage: 'start' | 'flip' | 'reload' | 'done';
  message: string;
  next?: string;
  finished: boolean;
  flip: boolean;
  error: string;
}

export const duplexApi = {
  /** Starts a job from a page of HTML (a note). Nothing prints until `next` is called. */
  fromHtml: (printer: string, title: string, html: string, flip: boolean, opts: PrintOptions = loadPrintOptions()) =>
    call<{ job: DuplexJob }>('/api/print/duplex', 'POST', { printer, title, html, flip, ...opts }).then(r => r.job),
  list: () => call<{ jobs: DuplexJob[] }>('/api/print/jobs').then(r => r.jobs),
  next: (id: string) => call<{ job: DuplexJob }>(`/api/print/jobs/${encodeURIComponent(id)}/continue`, 'POST').then(r => r.job),
  again: (id: string) => call<{ job: DuplexJob }>(`/api/print/jobs/${encodeURIComponent(id)}/again`, 'POST').then(r => r.job),
  stop: (id: string) => call(`/api/print/jobs/${encodeURIComponent(id)}`, 'DELETE'),
};

// --- Printer drop: PDFs kept on the Pi ---

export interface PrintFile { id: string; name: string; pages: number; bytes: number; createdAt: number }
export interface PrintDropList { files: PrintFile[]; maxMb: number; maxFiles: number }

export const printDropApi = {
  list: () => call<PrintDropList>('/api/printdrop'),
  remove: (id: string) => call(`/api/printdrop/${encodeURIComponent(id)}`, 'DELETE'),
  print: (id: string, printer: string, mode: 'single' | 'duplex', copies: number, flip: boolean, opts: PrintOptions = loadPrintOptions()) =>
    call<{ job?: DuplexJob; message?: string }>(`/api/printdrop/${encodeURIComponent(id)}/print`, 'POST', { printer, mode, copies, flip, ...opts }),
  /** One raw PDF per request, streamed to the Pi's disk. */
  upload: (file: File, onProgress?: (sent: number, total: number) => void) => new Promise<PrintFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${piBackendUrl()}/api/printdrop?name=${encodeURIComponent(file.name)}`);
    for (const [k, v] of Object.entries(piHeaders())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    if (onProgress) xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.onerror = () => reject(new Error("Can't reach the Pi"));
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) resolve(data.file);
      else reject(new Error(data.detail || data.error || `The Pi answered ${xhr.status}`));
    };
    xhr.send(file);
  }),
};
