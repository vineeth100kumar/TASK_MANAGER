// recordings.ts - Sage Recordings: record audio from the Pi's USB microphone,
// play it back and transcribe with Groq Whisper.

import { piBackendUrl, piHeaders } from './piBackend';

export interface Recording {
  id: string;
  title: string;
  duration_s: number;
  device: string;
  transcript: string;
  transcribing: number;
  created_at: string;
  file_size: number;
}

export interface CaptureDevice {
  card: string;
  device: string;
  cardId: string;
  cardName: string;
  deviceName: string;
  hw: string;
  plughw: string;
}

export interface RecordingStatus {
  recording: boolean;
  id?: string;
  elapsed?: number;
}

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const r = await fetch(`${piBackendUrl()}${path}`, { ...opts, headers: piHeaders(opts.headers as any || {}) });
  const data = await r.json();
  if (!r.ok && !data.success) throw new Error(data.error || `Request failed: ${r.status}`);
  return data;
}

export const recordingsApi = {
  list: (limit = 50) => req(`/api/recordings?limit=${limit}`) as Promise<{
    success: boolean; status: RecordingStatus; recordings: Recording[];
    devices: CaptureDevice[]; groqKey: boolean;
  }>,

  devices: () => req('/api/recordings/devices') as Promise<{ success: boolean; devices: CaptureDevice[] }>,

  start: (device = '', title = '', maxSeconds = 0) =>
    req('/api/recordings/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, title, maxSeconds }),
    }),

  stop: () => req('/api/recordings/stop', { method: 'POST' }),

  status: () => req('/api/recordings/status') as Promise<{ success: boolean } & RecordingStatus>,

  get: (id: string) => req(`/api/recordings/${id}`) as Promise<{ success: boolean; recording: Recording }>,

  transcribe: (id: string) => req(`/api/recordings/${id}/transcribe`, { method: 'POST' }),

  rename: (id: string, title: string) =>
    req(`/api/recordings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),

  delete: (id: string) => req(`/api/recordings/${id}`, { method: 'DELETE' }),

  audioUrl: (id: string) => `${piBackendUrl()}/media/recordings/${id}/audio.wav`,
};

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
