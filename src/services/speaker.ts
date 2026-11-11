// speaker.ts - Sage's voice on a Bluetooth soundbar (raspberry_pi/speaker.py):
// the welcome-home greeting and spoken reminders. Spotify plays on it too (spotify.ts).

import { useCallback, useEffect, useState } from 'react';
import { piBackendUrl, piHeaders } from './piBackend';
import { SPEAKER_EVENT } from './liveStream';

export type SurroundMode = 'off' | 'music' | 'movie' | 'wide';

export interface SpeakerSettings {
  address: string; name: string; greet: boolean; reminders: boolean; witty: boolean;
  callMe: string; voice: string; speed: number; volume: number; quietStart: string; quietEnd: string; leaveAfterMinutes: number;
  surround?: SurroundMode;
}

export interface SpeakerState {
  settings: SpeakerSettings;
  tools: { aplay: boolean; bluealsa: boolean; surround?: boolean; voice: boolean };
  voiceProblem: string;
  voices: string[];
  soundbar: { known: boolean; paired: boolean; connected: boolean; audio: boolean; name: string };
  surroundOn?: boolean;
  speaking: string;
  last: { text: string; kind: string; at: number } | null;
  error: { message: string } | null;
  wifi: { available: boolean; on: boolean | null; ethernet: boolean };
  quietNow: boolean;
}

const call = async (path: string, body?: unknown) => {
  const res = await fetch(`${piBackendUrl()}/api/speaker${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: piHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'The Pi could not do that.');
  return data;
};

export function useSpeaker() {
  const [state, setState] = useState<SpeakerState | null>(null);
  const load = useCallback(async () => {
    if (!piBackendUrl()) return;
    try { setState(await call('')); } catch { /* the Bluetooth page shows the reach problem */ }
  }, []);

  useEffect(() => {
    load();
    const onEvent = (e: Event) => setState((e as CustomEvent).detail);
    window.addEventListener(SPEAKER_EVENT, onEvent);
    const timer = setInterval(load, 15000);
    return () => { window.removeEventListener(SPEAKER_EVENT, onEvent); clearInterval(timer); };
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
    save: (update: Partial<SpeakerSettings>) => run('/settings', update),
    sayHello: () => run('/say', {}),
    say: (text: string) => run('/say', { text }),
    connect: () => run('/connect'),
    disconnect: () => run('/disconnect'),
    setWifi: (on: boolean) => run('/wifi', { on }),
  };
}
