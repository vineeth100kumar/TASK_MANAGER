// spotify.ts - the Pi as a Spotify Connect speaker on the soundbar via Spotify
// Soloist (raspberry_pi/spotify.py): API key, now playing and controls.

import { useCallback, useEffect, useState } from 'react';
import { piBackendUrl, piHeaders } from './piBackend';
import { SPOTIFY_EVENT } from './liveStream';

export interface SpotifySettings { enabled: boolean; name: string; hasKey: boolean }

export interface SpotifyTrack { name: string; artists: string; album: string; cover: string; duration: number; position: number; uri: string }

export interface SpotifyState {
  settings: SpotifySettings;
  installed: boolean;
  running: boolean;
  ready: boolean;
  loggedIn: boolean;
  expired: boolean;
  player: { playing: boolean; paused: boolean; stopped: boolean; buffering: boolean; volume: number; shuffle: boolean; context: string; active: boolean; track: SpotifyTrack | null } | null;
  soundbar: { address: string; name: string; connected: boolean };
  error: { message: string } | null;
}

export type SpotifyControl = 'playpause' | 'next' | 'prev' | 'signout' | 'restart';

const call = async (path: string, body?: unknown) => {
  const res = await fetch(`${piBackendUrl()}/api/spotify${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: piHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'The Pi could not do that.');
  return data;
};

export function useSpotify() {
  const [state, setState] = useState<SpotifyState | null>(null);
  const load = useCallback(async () => {
    if (!piBackendUrl()) return;
    try { setState(await call('')); } catch { /* the Bluetooth page shows the reach problem */ }
  }, []);

  useEffect(() => {
    load();
    const onEvent = (e: Event) => setState((e as CustomEvent).detail);
    window.addEventListener(SPOTIFY_EVENT, onEvent);
    const timer = setInterval(load, 15000);
    return () => { window.removeEventListener(SPOTIFY_EVENT, onEvent); clearInterval(timer); };
  }, [load]);

  const run = async (path: string, body: unknown = {}): Promise<string | null> => {
    try {
      const data = await call(path, body);
      if (data.settings) setState(data);
      return null;
    } catch (e: any) {
      return e?.message || 'The Pi could not do that.';
    }
  };

  return {
    state,
    save: (update: Partial<SpotifySettings> & { apiKey?: string }) => run('/settings', update),
    control: (action: SpotifyControl) => run(`/${action}`),
    volume: (volume: number) => run('/volume', { volume }),
    shuffle: (on: boolean) => run('/shuffle', { on }),
  };
}
