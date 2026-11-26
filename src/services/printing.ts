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

/** Sends a finished page to a printer the Pi knows. */
export const printOnPi = (printer: string, title: string, html: string, copies = 1) =>
  call('/api/print', 'POST', { printer, title, html, copies });

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
