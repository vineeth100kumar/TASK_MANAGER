// posts.ts - Posts: paste a script, the Pi draws the Instagram carousel and
// emails when it is done (raspberry_pi/posts.py, the Auto Content engine).
//
// Slide images are fetched with the app's key and kept as Blobs, so they work
// the same with the password gate or the API key, and so Share can hand real
// files to the phone's share sheet inside the tap that asked for it.

import { piBackendUrl, piHeaders } from './piBackend';

export const POST_EVENT = 'sage:post';

export type PostStatus = 'queued' | 'running' | 'done' | 'failed';

export interface PostLogLine { at: string; text: string }

export interface Post {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  title: string;
  script?: string;              // left out of the list rows
  style: string;
  format: string;
  projectId: string | null;
  taskId: string | null;
  status: PostStatus;
  error: string;
  log?: PostLogLine[];
  progress: { done: number; total: number };
  slideCount: number;
  slides: string[];
  caption?: string;
  captionStart?: string;
  hashtags: string[];
  audit: 'pass' | 'fail' | null;
  auditNote: string;
  seconds: number | null;
  posted: boolean;
  postedAt: string | null;
  emailed: boolean;
  emailError: string;
}

export interface MakerStatus {
  ready: boolean;
  problems: string[];
  styles: string[];
  formats: string[];
  emailReady: boolean;
  emailOn: boolean;
  emailTo: string;
  link: string;
  secureLink: boolean;
  qr: boolean;
  queued: number;
  maxScript: number;
}

export interface ScriptIssue { severity: 'ERROR' | 'WARN'; code: string; message: string; line: number | null; slide: number | null; hint: string }
export interface ScriptCheck {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ScriptIssue[];
  slides: { n: number; type: string; title: string }[];
  caption: string;
  hashtags: string[];
  title: string;
  style: string;
  format: string;
}

export const STYLE_LABELS: Record<string, string> = { grid_pill: 'Grid pill', beige_grain: 'Beige grain' };
export const FORMAT_LABELS: Record<string, string> = { portrait: 'Portrait 4:5', square: 'Square 1:1' };

export const postsAvailable = (): boolean => Boolean(piBackendUrl());

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const isJson = typeof init?.body === 'string';
  const res = await fetch(`${piBackendUrl()}${path}`, { ...init, headers: piHeaders(isJson ? { 'Content-Type': 'application/json' } : {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || data.detail || `The Pi answered ${res.status}`);
  return data as T;
}

const enc = encodeURIComponent;

export const postsApi = {
  list: (projectId = '') => call<{ status: MakerStatus; posts: Post[] }>(`/api/posts${projectId ? `?projectId=${enc(projectId)}` : ''}`),
  status: () => call<{ status: MakerStatus }>('/api/posts/status').then(d => d.status),
  check: (script: string) => call<{ check: ScriptCheck }>('/api/posts/check', { method: 'POST', body: JSON.stringify({ script }) }).then(d => d.check),
  create: (body: { script: string; title?: string; style?: string; format?: string; projectId?: string }) =>
    call<{ post: Post }>('/api/posts', { method: 'POST', body: JSON.stringify(body) }).then(d => d.post),
  get: (id: string) => call<{ post: Post; status: MakerStatus }>(`/api/posts/${enc(id)}`),
  rerender: (id: string, body: { script?: string; style?: string; format?: string }) =>
    call<{ post: Post }>(`/api/posts/${enc(id)}/rerender`, { method: 'POST', body: JSON.stringify(body) }).then(d => d.post),
  setPosted: (id: string, posted: boolean) =>
    call<{ post: Post }>(`/api/posts/${enc(id)}/posted${posted ? '' : '?undo=true'}`, { method: 'POST' }).then(d => d.post),
  send: (id: string) => call<{ post: Post }>(`/api/posts/${enc(id)}/send`, { method: 'POST' }).then(d => d.post),
  remove: (id: string) => call<{ success: boolean }>(`/api/posts/${enc(id)}`, { method: 'DELETE' }),
};

/** A file from the Pi as a Blob (slides, the ZIP, the QR code). */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`${piBackendUrl()}${path}`, { headers: piHeaders() });
  if (!res.ok) throw new Error(`The Pi answered ${res.status}`);
  return res.blob();
}

export const slidePath = (id: string, n: number) => `/api/posts/${enc(id)}/slides/${n}.png`;
/** JPEG copy of a slide, for the share sheet (Instagram lists itself for JPEGs). */
export const sharePath = (id: string, n: number) => `/api/posts/${enc(id)}/slides/${n}.jpg`;
/** Small JPEG of a slide (540 px wide) for the post page; the full PNGs are far too heavy to show. */
export const previewPath = (id: string, n: number, version = '') =>
  `/api/posts/${enc(id)}/preview/${n}.jpg${version ? `?v=${encodeURIComponent(version)}` : ''}`;
export const zipPath = (id: string) => `/api/posts/${enc(id)}/zip`;
export const qrPath = (id: string) => `/api/posts/${enc(id)}/qr.svg`;

/** The link that opens a post in Sage (used for "open on your phone"). */
export function postLink(post: Post, status: MakerStatus | null): string {
  const base = (status?.link || window.location.origin).replace(/\/+$/, '');
  return `${base}/?post=${post.id}`;
}

export const fileName = (post: Post, n: number, ext = 'png') =>
  `${post.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'post'}-${String(n).padStart(2, '0')}.${ext}`;

/** Can this browser hand image files to the share sheet? */
export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch { return false; }
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const EXAMPLE_SCRIPT = `---
autocontent: post
title: My first post
---

## cover
headline: Three habits that save an hour a day
Swipe to see them.

## point
headline: 1. Plan the night before
body: Ten minutes tonight removes the morning scramble.

## point
headline: 2. One task first
body: Do the hardest thing before you open messages.

## cta
headline: Save this
body: Follow for more.

## caption
Three small habits that give you an hour back. Which one will you try?

## hashtags
#productivity #habits
`;

/** Opens the Posts page, optionally on one post, a new post, or a project's posts. */
export function openPosts(detail: { postId?: string; projectId?: string; newPost?: boolean } = {}): void {
  window.dispatchEvent(new CustomEvent('sage:open-posts', { detail }));
}
