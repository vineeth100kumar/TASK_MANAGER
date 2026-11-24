// social.ts - a content project's Instagram numbers (raspberry_pi/social.py).
//
// One content project is one Instagram page. The Pi pulls that page's numbers
// every morning and keeps the history, so this only ever reads from the Pi.
// The access token lives on the Pi and is never sent here.

import { piBackendUrl, piHeaders } from './piBackend';

export interface SocialStatus {
  projectId: string;
  appReady: boolean;          // the Instagram app id + secret are saved on the Pi
  connected: boolean;
  username?: string | null;
  accountType?: string | null;
  picture?: string | null;
  lastPull?: string | null;
  tokenExpires?: string | null;
  tokenDaysLeft?: number | null;
  problem?: string | null;
  dropped?: string[];         // metrics Instagram refused, so a tile can say why it's blank
}

export interface SocialDay {
  day: string;
  followers: number;
  mediaCount: number;
  [metric: string]: number | string;
}

export interface SocialOverview extends SocialStatus {
  days: number;
  daily: SocialDay[];
  totals: Record<string, number>;
  followers: number;
  followersChange: number;
  engagementRate: number | null;
  note?: string;
}

export interface SocialPost {
  id: string;
  kind: string;               // REELS | FEED | STORY
  caption: string;
  permalink: string | null;
  thumbnail: string | null;
  postedAt: string | null;
  sageKind: 'post' | 'reel' | null;
  sageId: string | null;
  metrics: Record<string, number>;
  vsAverage: number | null;   // percent against this page's average reach
}

export interface SocialPosts {
  projectId: string;
  posts: SocialPost[];
  averageReach: number | null;
}

export interface SocialApp {
  appReady: boolean;
  appId: string | null;
  redirectUri: string;
  authorizeUrl: string | null;
  pages: SocialStatus[];
}

export const socialAvailable = (): boolean => Boolean(piBackendUrl());

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const isJson = typeof init?.body === 'string';
  const res = await fetch(`${piBackendUrl()}${path}`, {
    ...init,
    headers: piHeaders(isJson ? { 'Content-Type': 'application/json' } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.detail || data.error || `The Pi answered ${res.status}`);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const socialApi = {
  app: () => call<SocialApp & { success: boolean }>('/api/social'),
  saveApp: (appId: string, appSecret: string) =>
    call<SocialApp>('/api/social/app', { method: 'POST', body: JSON.stringify({ appId, appSecret }) }),
  status: (projectId: string) => call<SocialStatus>(`/api/social/${enc(projectId)}`),
  connect: (projectId: string, code: string) =>
    call<SocialStatus>('/api/social/connect', { method: 'POST', body: JSON.stringify({ project: projectId, code }) }),
  forget: (projectId: string) => call<SocialStatus>(`/api/social/${enc(projectId)}`, { method: 'DELETE' }),
  overview: (projectId: string, days = 30) =>
    call<SocialOverview>(`/api/social/${enc(projectId)}/overview?days=${days}`),
  posts: (projectId: string, limit = 30) =>
    call<SocialPosts>(`/api/social/${enc(projectId)}/posts?limit=${limit}`),
  refresh: (projectId: string) =>
    call<SocialOverview>(`/api/social/${enc(projectId)}/refresh`, { method: 'POST' }),
};

/** Instagram's own labels for the metric names the Pi stores. */
export const METRIC_LABELS: Record<string, string> = {
  reach: 'Reach',
  views: 'Views',
  total_interactions: 'Interactions',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  saves: 'Saves',
  saved: 'Saves',
  replies: 'Replies',
  accounts_engaged: 'Accounts engaged',
  follows_and_unfollows: 'Follows & unfollows',
  profile_visits: 'Profile visits',
  follows: 'Follows',
  ig_reels_avg_watch_time: 'Avg watch time',
  ig_reels_video_view_total_time: 'Total watch time',
  navigation: 'Story taps',
};

export const metricLabel = (key: string): string => METRIC_LABELS[key] || key.replace(/_/g, ' ');

/** Watch times come back in milliseconds; everything else is a plain count. */
export function metricValue(key: string, value: number): string {
  if (key === 'ig_reels_avg_watch_time') return `${(value / 1000).toFixed(1)}s`;
  if (key === 'ig_reels_video_view_total_time') {
    const hours = value / 3_600_000;
    return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(value / 60_000)}m`;
  }
  return compact(value);
}

export function compact(value: number): string {
  if (!isFinite(value)) return '-';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

export const POST_KIND_LABELS: Record<string, string> = { REELS: 'Reel', FEED: 'Post', STORY: 'Story' };
