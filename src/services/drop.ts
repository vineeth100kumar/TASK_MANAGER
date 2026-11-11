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
  kind: 'site' | 'clip';
  permanent: boolean;
  disabled: boolean;
  preview?: string;    // first bit of the text, for clips
  images?: number;     // how many images a clip has
  imageBytes?: number;
}

export interface DropList {
  drops: Drop[];
  base: string | null;   // the public address, if the Pi has one
  maxMb: number;
  clipMaxHours: number;
  clipMaxKb: number;
  clipImagesMb: number;  // images per clip, in total
  clipMaxImages: number;
}

export interface Storage {
  disk: { total: number; used: number; free: number };
  db: { bytes: number; path: string };
  backups: { bytes: number; count: number; folder: string };
  drop: { bytes: number; sites: number; clips: number; permanent: number; folder: string };
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

// XHR, because fetch can't report how much of an upload has gone.
function upload<T>(path: string, body: FormData | Blob, onProgress?: (sent: number, total: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${piBackendUrl()}${path}`);
    for (const [k, v] of Object.entries(piHeaders())) xhr.setRequestHeader(k, v);
    if (body instanceof Blob) xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream');
    if (onProgress) xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.upload.onload = () => onProgress?.(1, 1);
    xhr.onerror = () => reject(new Error("Can't reach the Pi"));
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) resolve(data);
      else reject(new Error(data.error || data.detail || (xhr.status === 413 ? 'That is too big to share.' : `The Pi answered ${xhr.status}`)));
    };
    xhr.send(body);
  });
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
        return upload<{ drop: Drop; base: string | null; warnings?: string[] }>('/api/drops', form, onProgress);
  },
  extend: (id: string, hours: number) =>
    call<{ drop: Drop }>(`/api/drops/${encodeURIComponent(id)}/extend`, { method: 'POST', body: JSON.stringify({ hours }) }).then(d => d.drop),
  remove: (id: string) => call<{ success: boolean }>(`/api/drops/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clip: (text: string, hours: number, name = '', images = 0) =>
    call<{ drop: Drop; base: string | null }>('/api/drops/clip', { method: 'POST', body: JSON.stringify({ text, hours, name, images }) }),
  /** One image for a clip, sent on its own and written to disk as it arrives. */
  addImage: (id: string, file: Blob, name: string, onProgress?: (sent: number, total: number) => void) =>
    upload<{ drop: Drop; name: string }>(`/api/drops/${encodeURIComponent(id)}/images?name=${encodeURIComponent(name)}`, file, onProgress),
  /** The small preview the clip's page shows for an image it already has. */
  addThumb: (id: string, thumb: Blob, imageName: string) =>
    upload<{ drop: Drop }>(`/api/drops/${encodeURIComponent(id)}/images?thumb=${encodeURIComponent(imageName)}`, thumb),
  setPermanent: (id: string, on: boolean) =>
    call<{ drop: Drop }>(`/api/drops/${encodeURIComponent(id)}/permanent`, { method: 'POST', body: JSON.stringify({ on }) }).then(d => d.drop),
  setEnabled: (id: string, on: boolean) =>
    call<{ drop: Drop }>(`/api/drops/${encodeURIComponent(id)}/enabled`, { method: 'POST', body: JSON.stringify({ on }) }).then(d => d.drop),
  storage: () => call<Storage>('/api/storage'),
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

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|svg|tiff?)$/i;

export const isImage = (file: File): boolean => file.type.startsWith('image/') || IMAGE_EXT.test(file.name);

/** The name an image goes up under: pasted screenshots come as "image.png" or with no name at all. */
export function imageFileName(file: File): string {
  const name = (file.name || '').trim();
  if (IMAGE_EXT.test(name)) return name;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg').split(/[^a-z0-9]/)[0];
  return `${name.replace(/\.[^.]*$/, '') || 'image'}.${ext}`;
}

/** A small JPEG preview of an image, made here so the Pi never resizes
 *  anything. Null when the browser can't decode it (a HEIC on Chrome, say). */
export async function makeThumb(file: Blob, size = 480): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';  // transparent PNGs get a white backing, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise(ok => canvas.toBlob(b => ok(b), 'image/jpeg', 0.78));
  } catch {
    return null;
  }
}

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
