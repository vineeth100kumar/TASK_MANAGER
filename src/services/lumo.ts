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

export type AlarmTone = 'pulse' | 'classic' | 'rising' | 'chirp';

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
  wifi: { ip?: string; rssi?: number; uptime?: number; heap?: number; ssid?: string } | null;
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
  haptics: { buttons: boolean; notifications: boolean };
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
};

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
