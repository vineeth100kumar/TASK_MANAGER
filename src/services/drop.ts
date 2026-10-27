// drop.ts - Drop: temporary public links for HTML reports and small sites.
//
// The Pi keeps each drop and serves it at /d/<slug>/ until it expires
// (raspberry_pi/drop.py). Links use the Pi's public address (its tunnel) when
// it has one, else the address this app was opened at, which only works on
// the home network.

import { piBackendUrl, piHeaders } from './piBackend';

export interface Drop {
  id: string;
  name: string;
  path: string;        // "/d/<slug>/"
  createdAt: number;   // seconds since epoch
  expiresAt: number;
  entry: string;
  files: number;
  bytes: number;
  views: number;
  lastView: number | null;
  source: string;
}

export interface DropList {
  drops: Drop[];
  base: string | null;   // the public address, if the Pi has one
  maxMb: number;
}

// The file and the folder-relative path it goes under in the drop.
export type DropFile = { file: Blob; path: string };

export const EXPIRY_CHOICES = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '1 day' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
];
export const DEFAULT_HOURS = 24;

export const dropAvailable = (): boolean => Boolean(piBackendUrl());

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const isJson = typeof init?.body === 'string';
  const res = await fetch(`${piBackendUrl()}${path}`, {
    ...init,
    headers: piHeaders(isJson ? { 'Content-Type': 'application/json' } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.detail || (res.status === 413 ? 'That is too big to share.' : `The Pi answered ${res.status}`));
  }
  return data as T;
}

export const dropLink = (drop: Drop, base: string | null): string =>
  `${(base || piBackendUrl() || window.location.origin).replace(/\/+$/, '')}${drop.path}`;

export const dropApi = {
  list: () => call<DropList>('/api/drops'),
  create: (files: DropFile[], hours: number, name = '', source = 'upload', onProgress?: (sent: number, total: number) => void) => {
    const form = new FormData();
    for (const f of files) {
      form.append('files', f.file, f.path.split('/').pop() || 'file');
      form.append('paths', f.path);
    }
    form.append('hours', String(hours));
    form.append('source', source);
    if (name) form.append('name', name);
    // XHR, because fetch can't report how much of an upload has gone.
    return new Promise<{ drop: Drop; base: string | null; warnings?: string[] }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${piBackendUrl()}/api/drops`);
      for (const [k, v] of Object.entries(piHeaders())) xhr.setRequestHeader(k, v);
      if (onProgress) xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded, e.total);
      xhr.upload.onload = () => onProgress?.(1, 1);
      xhr.onerror = () => reject(new Error("Can't reach the Pi"));
      xhr.onload = () => {
        let data: any = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) resolve(data);
        else reject(new Error(data.error || data.detail || (xhr.status === 413 ? 'That is too big to share.' : `The Pi answered ${xhr.status}`)));
      };
      xhr.send(form);
    });
  },
  extend: (id: string, hours: number) =>
    call<{ drop: Drop }>(`/api/drops/${encodeURIComponent(id)}/extend`, { method: 'POST', body: JSON.stringify({ hours }) }).then(d => d.drop),
  remove: (id: string) => call<{ success: boolean }>(`/api/drops/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** Shares one HTML page (a Notes report) and returns its link. */
export async function shareHtml(html: string, title: string, hours = DEFAULT_HOURS): Promise<string> {
  const file = new Blob([html], { type: 'text/html' });
  const { drop, base } = await dropApi.create([{ file, path: 'index.html' }], hours, title, 'note');
  return dropLink(drop, base);
}

/** Every file in what was dropped: files, whole folders (walked), or both. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<DropFile[]> {
  const entries = Array.from(dt.items || [])
    .filter(i => i.kind === 'file')
    .map(i => (i as any).webkitGetAsEntry?.() as any)
    .filter(Boolean);
  if (!entries.length) return Array.from(dt.files).map(file => ({ file, path: file.name }));
  const out: DropFile[] = [];
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((ok, fail) => entry.file(ok, fail));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries hands back folders in batches until an empty one.
      for (;;) {
        const batch: any[] = await new Promise((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}

/** Files from an <input type=file>, keeping folder paths when a folder was picked. */
export const filesFromInput = (list: FileList | null): DropFile[] =>
  Array.from(list || []).map(file => ({ file, path: (file as any).webkitRelativePath || file.name }));

export function timeLeft(expiresAt: number, now = Date.now() / 1000): string {
  const s = Math.max(0, expiresAt - now);
  if (s < 60) return 'under a minute';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m && h < 6 ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return h ? `${d} d ${h} h` : `${d} d`;
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
