// reels.ts - Reels: paste a script (and your own voice-over, if you like), the Pi
// makes the Instagram reel and emails when it is done (raspberry_pi/reels.py, the
// Auto Content engine's reel maker).
//
// The finished video and its poster are plain files on the Pi (/media/reels/...,
// see reels.py "Media files"): <video> and the download links point straight at
// them, so the phone streams, seeks and caches them itself. Only the Share button
// fetches the file, because the share sheet needs it as a File.

import { piBackendUrl, piHeaders } from './piBackend';

export const REEL_EVENT = 'sage:reel';

export type ReelStatus = 'waiting' | 'queued' | 'running' | 'done' | 'failed';

export interface ReelLogLine { at: string; text: string }
export interface ReelStep { n: number; type: string; start: number; end: number; reveals: number[] }

export interface Reel {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  title: string;
  script?: string;               // left out of the list rows
  style: string;
  voice: string;                 // a Kokoro voice, or "mine"
  needsRecording: boolean;
  voiceFile: string;
  voiceSeconds?: number;
  projectId: string | null;
  taskId: string | null;
  status: ReelStatus;
  error: string;
  log?: ReelLogLine[];
  progress: { percent: number; stage: string };
  seconds: number | null;        // how long the video runs
  madeIn: number | null;         // how long the Pi took
  size: number;
  scenes: number;
  estimate: number;
  timeline?: ReelStep[];
  warnings?: string[];
  wordTiming: string;
  caption?: string;
  captionStart?: string;
  hashtags: string[];
  posted: boolean;
  postedAt: string | null;
  emailed: boolean;
  emailError: string;
  media?: ReelMedia | null;
}

export interface ReelMedia { base: string; v: string; t: string; video: string; poster: string }

export interface ReelMakerStatus {
  ready: boolean;
  problems: string[];
  styles: string[];
  voiceReady: boolean;
  voiceProblem: string;
  voices: string[];
  timing: string;
  emailReady: boolean;
  emailOn: boolean;
  emailTo: string;
  link: string;
  secureLink: boolean;
  queued: number;
  maxScript: number;
  maxVoiceMb: number;
}

export interface ReelIssue { severity: 'ERROR' | 'WARN'; code: string; message: string; line: number | null; slide: number | null; hint: string }
export interface ReelScene { n: number; type: string; motion: string; words: number; title: string; say: string }
export interface ReelCheck {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ReelIssue[];
  scenes: ReelScene[];
  seconds: number;
  caption: string;
  hashtags: string[];
  title: string;
  style: string;
  voice: string;
  needsRecording: boolean;
  captions: boolean;
}

export const reelsAvailable = (): boolean => Boolean(piBackendUrl());

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const isJson = typeof init?.body === 'string';
  const res = await fetch(`${piBackendUrl()}${path}`, { ...init, headers: piHeaders(isJson ? { 'Content-Type': 'application/json' } : {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || data.detail || `The Pi answered ${res.status}`);
  return data as T;
}

const enc = encodeURIComponent;

export const reelsApi = {
  list: (projectId = '') => call<{ status: ReelMakerStatus; reels: Reel[] }>(`/api/reels${projectId ? `?projectId=${enc(projectId)}` : ''}`),
  check: (script: string) => call<{ check: ReelCheck }>('/api/reels/check', { method: 'POST', body: JSON.stringify({ script }) }).then(d => d.check),
  create: (body: { script: string; title?: string; style?: string; projectId?: string }) =>
    call<{ reel: Reel }>('/api/reels', { method: 'POST', body: JSON.stringify(body) }).then(d => d.reel),
  get: (id: string) => call<{ reel: Reel; status: ReelMakerStatus }>(`/api/reels/${enc(id)}`),
  remake: (id: string, body: { script?: string; style?: string }) =>
    call<{ reel: Reel }>(`/api/reels/${enc(id)}/remake`, { method: 'POST', body: JSON.stringify(body) }).then(d => d.reel),
  setPosted: (id: string, posted: boolean) =>
    call<{ reel: Reel }>(`/api/reels/${enc(id)}/posted${posted ? '' : '?undo=true'}`, { method: 'POST' }).then(d => d.reel),
  send: (id: string) => call<{ reel: Reel }>(`/api/reels/${enc(id)}/send`, { method: 'POST' }).then(d => d.reel),
  remove: (id: string) => call<{ success: boolean }>(`/api/reels/${enc(id)}`, { method: 'DELETE' }),
};

/** Send the author's own recording (the raw file, so a phone's 20 MB voice memo streams straight to the Pi). */
export function uploadVoice(id: string, file: Blob, name: string, onProgress: (fraction: number) => void): Promise<Reel> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${piBackendUrl()}/api/reels/${enc(id)}/voice?name=${enc(name)}`);
    const headers = piHeaders();
    Object.keys(headers).forEach(k => xhr.setRequestHeader(k, headers[k]));
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error("Couldn't reach the Pi. Check the connection and try again."));
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) resolve(data.reel as Reel);
      else reject(new Error(data.error || data.detail || `The Pi answered ${xhr.status}`));
    };
    xhr.send(file);
  });
}

/** Where the finished video / poster lives; '' until the reel is done. download saves it under that name. */
export function videoUrl(reel: Reel, download = ''): string {
  const m = reel.media;
  if (!m) return '';
  return `${piBackendUrl()}${m.base}/${m.video}?v=${enc(m.v)}&t=${enc(m.t)}${download ? `&download=${enc(download)}` : ''}`;
}
export function posterUrl(reel: Reel): string {
  const m = reel.media;
  return m ? `${piBackendUrl()}${m.base}/${m.poster}?v=${enc(m.v)}&t=${enc(m.t)}` : '';
}
export const qrPath = (id: string) => `/api/reels/${enc(id)}/qr.svg`;

/** The link that opens a reel in Sage (used for "open on your phone"). */
export function reelLink(reel: Reel, status: ReelMakerStatus | null): string {
  const base = (status?.link || window.location.origin).replace(/\/+$/, '');
  return `${base}/?reel=${reel.id}`;
}

export const fileName = (reel: Reel) => `${reel.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reel'}.mp4`;

export function canShareVideo(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch { return false; }
}

export const formatSeconds = (s: number | null | undefined): string => {
  if (!s && s !== 0) return '';
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)}s`;
};

export const STYLE_LABELS: Record<string, string> = { grid_pill: 'Grid pill', beige_grain: 'Beige grain' };

export const EXAMPLE_REEL = `---
autocontent: reel
title: Three habits that save an hour
voice: af_heart
---

## cover
headline: Three habits that save an **hour** a day
pill: an hour a day
say: Three small habits give you back an hour a day.

## list
headline: Do these **tonight**
1. Plan tomorrow in ten minutes
2. Pick one task to do first
3. Phone away before bed
say: Plan tomorrow in ten minutes. Pick the one task you do first. And put the phone away before bed.
show: plan tomorrow | pick the one task | put the phone away

## cta
headline: Which will you **try?**
pill: SAVE THIS
subtext: COMMENT 1, 2 OR 3
theme: dark
say: Save this, and tell me which one you will try first.

## caption
Three small habits that give you an hour back. Which one will you try?

## hashtags
#productivity #habits
`;

/** Opens the Reels page, optionally on one reel, a new reel, or a project's reels. */
export function openReels(detail: { reelId?: string; projectId?: string; newReel?: boolean } = {}): void {
  window.dispatchEvent(new CustomEvent('sage:open-reels', { detail }));
}
