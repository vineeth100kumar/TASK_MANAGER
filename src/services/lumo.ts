// lumo.ts - The LUMO desk clock, as Sage's Pi server runs it.
//
// The clock is a screen and buttons for the Pi (raspberry_pi/desk/), so
// everything here talks to the Pi: its alarms (Sage reminders labelled
// "alarm"), the timer and stopwatch it keeps, the clock's settings and its
// status. The Pi announces changes on /ws as DESK_STATE, which liveStream
// passes on as LUMO_EVENT.

import { piBackendUrl, piHeaders } from './piBackend';

export const LUMO_EVENT = 'sage:lumo';

export const lumoAvailable = (): boolean => Boolean(piBackendUrl());

// The sounds LUMO's buzzer plays (lumo/esp32_client/tones.h); the last four need firmware 2.11.
export type AlarmTone = 'pulse' | 'classic' | 'rising' | 'chirp' | 'chime' | 'dawn' | 'melody' | 'urgent';

export interface LumoAlarm {
  id: string;
  label: string;
  time: string;              // "07:30"
  days: number[];            // 0 is Monday; [] rings once
  enabled: boolean;
  nextRing: string | null;   // ISO time
  snoozed: boolean;
  tone: AlarmTone | null;    // null follows the clock's setting
  volume: number | null;
  snoozeMinutes: number | null;
}

export type AlarmDraft = Pick<LumoAlarm, 'label' | 'time' | 'days' | 'enabled' | 'tone' | 'volume' | 'snoozeMinutes'>;

export interface LumoTimer {
  state: 'idle' | 'running' | 'paused' | 'done';
  remaining: number;
  total: number;
  label: string;
  endsAt: number | null;     // ms since epoch, while running
}

export interface LumoStopwatch {
  running: boolean;
  elapsed: number;
  startedAt: number | null;  // ms since epoch, while running
  laps: number[];            // each lap's own length, seconds
}

export interface LumoState {
  screen: string;
  night: boolean;
  lightsOff: boolean;
  toolsSupported: boolean;
  ringing: { id: string; label: string; since: number } | null;
  timer: LumoTimer;
  stopwatch: LumoStopwatch;
  updates?: LumoUpdates;
}

// Firmware updates over Wi-Fi (desk/ota.py on the Pi): GitHub builds every
// merged firmware change and the Pi sends it to LUMO (firmware 2.13+).
export interface LumoUpdates {
  branch: string;
  canUpdate: boolean;        // connected, on firmware that takes updates over Wi-Fi
  latest: string | null;     // the newest build for the Pi's branch
  latestSha: string | null;
  latestAt: string | null;
  ready: boolean;            // downloaded and checked
  newer: boolean;            // newer than what LUMO runs
  state: 'idle' | 'updating' | 'done' | 'failed';
  target: string | null;
  error: string | null;
  waiting: string | null;    // why an available update hasn't gone yet
  checkedAt: number | null;
  checkError: string | null;
  history: { at: number; version: string; result: 'done' | 'failed'; detail: string }[];
}

export interface LumoLinkEvent {
  at: number;                // ms since epoch
  event: 'connected' | 'dropped' | 'sage started';
  detail: string;
}

// How steady the clock's link to the Pi is (desk/link.py's health).
export interface LumoLink {
  state: 'steady' | 'flaky' | 'down';
  since: number;             // connected since, or down since (ms)
  drops24h: number;
  lastDrop: LumoLinkEvent | null;
  quietSeconds: number | null;
  rtt: number | null;        // the clock's last ping round trip, ms (firmware 2.10)
  clockReconnects: number | null;
  clockLastDrop: string | null;
  clockTries?: number | null;          // failed tries before it got back (firmware 2.14)
  clockLastTryFailure?: string | null;
  clockWifiRejoins?: number | null;
  lastBoot: string | null;
  history: LumoLinkEvent[];  // newest first
}

export interface LumoStatus {
  enabled: boolean;
  connected: boolean;
  firmware: string | null;
  latestFirmware: string | null;
  updateAvailable: boolean;
  address: string | null;
  connectedAt: number | null;
  lastSeen: number | null;
  wifi: { ip?: string; rssi?: number; uptime?: number; heap?: number; ssid?: string; rtt?: number; wifiDrops?: number } | null;
  link?: LumoLink;
  token: string | null;
  port: number;
  state: LumoState | null;
}

export interface LumoSettings {
  screens: string[];
  homeScreen: string;
  clock: { style: string; hour24: boolean; seconds: boolean; secondZone: string };
  alarm: { snoozeMinutes: number; ringMinutes: number; tone: AlarmTone; volume: number };
  lights: { mode: string; brightness: number };
  world: { zones: string[] };
  night: { enabled: boolean; start: string; end: string; face: string; lightsMode: string; brightness: number };
  haptics: { strength: number; buttons: boolean; notifications: boolean };
  welcome: { enabled: boolean; message: string; awayMinutes: number };
  updates: { auto: boolean };
  buttons: { locked: boolean; map: Record<string, Record<string, string>> };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type LumoSettingsUpdate = DeepPartial<LumoSettings>;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${piBackendUrl()}${path}`, {
    ...init,
    headers: piHeaders({ ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers as Record<string, string>) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.detail || data.error || `The Pi answered ${res.status}`);
  return data as T;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const lumoApi = {
  status: () => call<LumoStatus>('/api/desk'),
  settings: () => call<{ settings: LumoSettings }>('/api/desk/settings').then(d => d.settings),
  saveSettings: (update: LumoSettingsUpdate) =>
    call<{ settings: LumoSettings }>('/api/desk/settings', { method: 'PUT', body: JSON.stringify(update) }).then(d => d.settings),
  alarms: () => call<{ alarms: LumoAlarm[] }>('/api/desk/alarms').then(d => d.alarms),
  createAlarm: (draft: Partial<AlarmDraft>) => post<{ alarm: LumoAlarm }>('/api/desk/alarms', draft).then(d => d.alarm),
  updateAlarm: (id: string, change: Partial<AlarmDraft>) =>
    call<{ alarm: LumoAlarm }>(`/api/desk/alarms/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(change) }).then(d => d.alarm),
  deleteAlarm: (id: string) => call(`/api/desk/alarms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  ringing: (action: 'snooze' | 'stop') => post<LumoStatus>('/api/desk/ringing', { action }),
  timer: (action: string, seconds = 0, label = '') => post<LumoStatus>('/api/desk/timer', { action, seconds, label }),
  stopwatch: (action: string) => post<LumoStatus>('/api/desk/stopwatch', { action }),
  device: (action: 'identify' | 'restart' | 'tone', tone = '', volume = 0) => post<LumoStatus>('/api/desk/device', { action, tone, volume }),
  press: (button: string) => post<LumoStatus>('/api/desk/press', { button }),
  firmware: (action: 'check' | 'install') => post<LumoStatus>('/api/desk/firmware', { action }),
};

// The depth face (desk/depth.py on the Pi): a photo with the time tucked
// behind the person. LUMO shows it on firmware 2.9; Sage shows the same preview.
export type DepthPlacement = 'auto' | 'top' | 'middle' | 'bottom';
export type DepthPhotoPosition = 'auto' | 'top' | 'center' | 'bottom';

export interface DepthFace {
  hasPhoto: boolean;
  cutout: boolean;              // the person was found and cut out
  cutoutAvailable: boolean;     // the Pi has the cutout tool installed
  cutoutProblem: string | null; // why the cutout tool won't load, if it won't
  cutoutError: string | null;   // why the last cutout failed, if it did
  ringHue: number | null;       // the photo's main colour for the ring (lights mode PHOTO)
  ringColor: string | null;     // that colour as #rrggbb; null when the photo has none
  placement: DepthPlacement;
  photoPosition: DepthPhotoPosition;
  updatedAt: string | null;
  coverageWarn: number;
  preview: {
    depth: string;              // data URLs, 320x216, the clock's own colours
    flat: string;
    mask: string | null;
    placement: Exclude<DepthPlacement, 'auto'>;
    coverage: number;           // 0-1: how much of the time the person hides
    time: string;
  } | null;
}

export const depthApi = {
  get: () => call<{ depth: DepthFace }>('/api/desk/depth').then(d => d.depth),
  upload: (image: string) => post<{ depth: DepthFace }>('/api/desk/depth/photo', { image }).then(d => d.depth),
  update: (change: Partial<Pick<DepthFace, 'placement' | 'photoPosition'>>) =>
    call<{ depth: DepthFace }>('/api/desk/depth', { method: 'PUT', body: JSON.stringify(change) }).then(d => d.depth),
  retryCutout: () => post<{ depth: DepthFace }>('/api/desk/depth/cutout', {}).then(d => d.depth),
  remove: () => call<{ depth: DepthFace }>('/api/desk/depth', { method: 'DELETE' }).then(d => d.depth),
};

// A picked file as a JPEG data URL no bigger than `side` pixels, so a phone
// photo uploads quickly. The Pi only needs 320 pixels across, and a little more
// for a clean cutout.
export async function shrinkPhoto(file: File, side = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.9);
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function daysText(days: number[]): string {
  const set = [...days].sort().join(',');
  if (!days.length) return 'Once';
  if (set === '0,1,2,3,4,5,6') return 'Every day';
  if (set === '0,1,2,3,4') return 'Weekdays';
  if (set === '5,6') return 'Weekends';
  return days.map(d => DAY_NAMES[d]).join(' ');
}

// "07:30" as the person likes to read it.
export function clockText(hhmm: string, hour24: boolean): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (hour24) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
}

export const ampm = (hhmm: string): string => (Number(hhmm.split(':')[0]) >= 12 ? 'PM' : 'AM');

// "in 8 h 20 min", "in 45 min", "tomorrow"...
export function untilText(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.round((new Date(iso).getTime() - now) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `in ${h} h ${m} min` : `in ${h} h`;
  const days = Math.round(h / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

// 754.2 seconds as "12:34", or "1:02:03" past an hour; tenths for the stopwatch.
export function duration(seconds: number, tenths = false): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const base = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((s * 10) % 10)}` : base;
}

export function compareVersions(a: string | null, b: string | null): number {
  const pa = (a || '').split('.').map(Number), pb = (b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
