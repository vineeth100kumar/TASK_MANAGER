// radar.ts - Radar's headlines and prices, read from the Pi server.
//
// The Pi fetches news feeds and market prices on its own (raspberry_pi/radar.py)
// and keeps them out of sync, so they are read straight from it here. Without
// the Pi server there is nothing to show.

import { piBackendUrl, piHeaders } from './piBackend';

export interface RadarQuote {
  symbol: string;
  name: string;
  unit: 'index' | 'pct' | 'usd' | 'inr';
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
  const symbol = q.unit === 'usd' ? '$' : q.unit === 'inr' ? '₹' : '';
  return `${symbol}${text}${big ? 'k' : ''}`;
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

// "My edge": what the user knows and has, so sparks and research fit them.
export interface RadarEdge {
  skills: string;
  assets: string;
  place: string;
  budget: string;
  hours: string;
}

export interface RadarSettings {
  brief: boolean;
  dailyCap: number;
  engine: 'groq' | 'claude';
  lumoLine: boolean;
  india: boolean;
  edge: RadarEdge;
  sparksPerDay: 3 | 5 | 10;
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

// --- Lab: sparks (raspberry_pi/sparks.py) ---

export interface SparkClue {
  kind?: 'news' | 'market';
  label: string;
  title: string;
  link: string;
  tags?: string[];
}

export interface Spark {
  id: string;
  day: string;
  createdAt: string;
  state: 'new' | 'kept' | 'researched' | 'dismissed';
  clue: SparkClue;
  change: string;
  idea: string;
  pitch: string;
  buyer: string;
  angle: string;
  fit: number;
  fitWhy: string;
  reason: string;
  ideaId: string | null;
  jobId: string | null;
}

export interface SparkList {
  sparks: Spark[];
  kept: Spark[];
  today: string;
  madeToday: boolean;
  lastRun: { at: string; ok: boolean; error: string } | null;
  running: boolean;
  manualLeft: number;
  perDay: number;
  edge: RadarEdge;
  edgeUsed: string[];
  reasons: string[];
}

const post = <T,>(path: string, body?: unknown) => call<T>(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

export const sparksApi = {
  list: () => call<SparkList>('/api/radar/sparks'),
  make: () => post<SparkList>('/api/radar/sparks/make'),
  keep: async (id: string): Promise<Spark> => (await post<{ spark: Spark }>(`/api/radar/sparks/${id}/keep`)).spark,
  research: async (id: string): Promise<ResearchJob> => (await post<{ job: ResearchJob }>(`/api/radar/sparks/${id}/research`)).job,
  dismiss: async (id: string, reason: string): Promise<Spark> => (await post<{ spark: Spark }>(`/api/radar/sparks/${id}/dismiss`, { reason })).spark,
};

export const radarBrief = () => call<RadarBrief>('/api/radar/brief');

export function money(n: number | null): string {
  if (n === null || n === undefined) return '?';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

// --- Markets (raspberry_pi/markets.py) ---

export type MarketRegion = 'US' | 'India' | 'Global';
export type MarketRange = '1D' | '1W' | '1M' | 'YTD';

export interface MarketEvidence {
  kind: 'number' | 'headline';
  label: string;
  link?: string;
  published?: string;
}

export interface MarketReason {
  title: string;
  text: string;
  confidence: 'High' | 'Medium' | 'Low';
  evidence: MarketEvidence[];
}

export interface MarketPart {
  key: 'market' | 'oil' | 'rates' | 'dollar' | 'left';
  name: string;
  value: number;
  beta?: number;
  factorMove?: number;
}

export interface MarketWhy {
  parts: MarketPart[];
  reasons: MarketReason[];
  news: { title: string; source: string; link: string; published: string }[];
  top: { symbol: string; change: number } | null;
}

export interface MarketIndustry {
  name: string;
  symbol: string;
  change: number | null;
  closes: number[];
}

export interface MarketSector extends MarketIndustry {
  weight: number;
  tag: string;
  industries: MarketIndustry[];
  why: MarketWhy;
}

export interface MarketGauge {
  symbol: string;
  name: string;
  unit: 'index' | 'pct' | 'usd' | 'inr';
  price: number | null;
  change: number | null;
  closes: number[];
  via?: string | null;
}

export interface MarketBoard {
  region: MarketRegion;
  range: MarketRange;
  regions: MarketRegion[];
  ranges: MarketRange[];
  updatedAt: string | null;
  open: boolean;
  headline: string;
  gauges: MarketGauge[];
  sources?: string[];
  sectors: MarketSector[];
  breadth: { up: number; down: number; of: number; unit: string };
  leaders: { name: string; symbol: string; change: number }[];
  laggards: { name: string; symbol: string; change: number }[];
  why: MarketWhy & { points: { name: string; value: number }[]; change: number | null };
  writer: string;
  writtenAt: string | null;
  writing?: boolean;
}

export const marketsApi = {
  board: (region: MarketRegion, range: MarketRange) =>
    call<MarketBoard>(`/api/radar/markets?${new URLSearchParams({ region, range })}`),
};

export function signedPct(n: number | null, digits = 2): string {
  if (n === null || n === undefined) return '–';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`;
}
