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
