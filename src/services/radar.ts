// radar.ts - Radar's headlines and prices, read from the Pi server.
//
// The Pi fetches news feeds and market prices on its own (raspberry_pi/radar.py)
// and keeps them out of sync, so they are read straight from it here. Without
// the Pi server there is nothing to show.

import { piBackendUrl, piHeaders } from './piBackend';

export interface RadarQuote {
  symbol: string;
  name: string;
  unit: 'index' | 'pct' | 'usd';
  price: number;
  changePct: number | null;
  closes: number[];
  updatedAt: string;
}

export interface RadarSource {
  name: string;
  kind: 'news' | 'markets';
  ok: boolean;
  items: number;
  error: string;
  checkedAt: string | null;
  lastOkAt: string | null;
}

export interface RadarVelocity {
  learning: boolean;
  readyOn: string | null;
  tags: { tag: string; recent: number; velocity: number | null }[];
}

export interface RadarSummary {
  enabled: boolean;
  updatedAt: string | null;
  headline: string;
  ticker: RadarQuote[];
  velocity: RadarVelocity;
  sources: RadarSource[];
  new24h: number;
  regions: string[];
  tags: string[];
  refreshed?: boolean;
}

export interface RadarSignal {
  id: string;
  source: string;
  title: string;
  link: string;
  published: string;
  region: string;
  tags: string[];
  rising: boolean;
}

// The Pi announces new headlines and prices on /ws; liveStream turns that into this.
export const RADAR_EVENT = 'sage:radar';

export const RISING = 2;

export const radarAvailable = (): boolean => Boolean(piBackendUrl());

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${piBackendUrl()}${path}`, { ...init, headers: piHeaders(init?.headers as Record<string, string>) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `The Pi answered ${res.status}`);
  return data as T;
}

export const radarApi = {
  summary: () => call<RadarSummary>('/api/radar/summary'),
  signals: async (region = '', tag = ''): Promise<RadarSignal[]> => {
    const params = new URLSearchParams();
    if (region && region !== 'Global') params.set('region', region);
    if (tag) params.set('tag', tag);
    const data = await call<{ signals: RadarSignal[] }>(`/api/radar/signals?${params}`);
    return data.signals;
  },
  refresh: () => call<RadarSummary>('/api/radar/refresh', { method: 'POST' }),
};

export function formatQuote(q: RadarQuote): string {
  if (q.unit === 'pct') return `${q.price.toFixed(2)}%`;
  const big = q.price >= 100000;
  const value = big ? q.price / 1000 : q.price;
  const digits = value >= 1000 ? 0 : 2;
  const text = value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${q.unit === 'usd' ? '$' : ''}${text}${big ? 'k' : ''}`;
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

// --- Research (Studio) ---

export interface ResearchStep {
  name: string;
  status: 'todo' | 'run' | 'done' | 'failed';
  detail: string;
  seconds: number | null;
}

export interface ResearchJob {
  id: string;            // also the id of the dossier it writes
  theme: string;
  depth: 'brief' | 'memo';
  status: 'queued' | 'running' | 'done' | 'needs_review' | 'failed';
  step: number;
  steps: ResearchStep[];
  engine: string | null;
  error: string;
  ideaIds: string[];
  noteId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ResearchList {
  jobs: ResearchJob[];
  runsToday: number;
  dailyCap: number;
  engines: string[];
}

export interface RadarSettings {
  brief: boolean;
  dailyCap: number;
  engine: 'groq' | 'claude';
  lumoLine: boolean;
}

export interface RadarBrief {
  enabled: boolean;
  headline: string;
  signals: RadarSignal[];
  move: RadarQuote | null;
  trend: { tag: string; recent: number; velocity: number | null } | null;
}

export const researchApi = {
  start: async (theme: string, depth: 'brief' | 'memo'): Promise<ResearchJob> =>
    (await call<{ job: ResearchJob }>('/api/radar/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, depth }),
    })).job,
  list: () => call<ResearchList>('/api/radar/research'),
};

export const radarSettingsApi = {
  get: async (): Promise<RadarSettings> => (await call<{ settings: RadarSettings }>('/api/radar/settings')).settings,
  update: async (changes: Partial<RadarSettings>): Promise<RadarSettings> =>
    (await call<{ settings: RadarSettings }>('/api/radar/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })).settings,
};

export const radarBrief = () => call<RadarBrief>('/api/radar/brief');

export function money(n: number | null): string {
  if (n === null || n === undefined) return '?';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}
