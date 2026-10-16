// lifeMode.ts - Work mode and Chill mode.
//
// Work shows everything. Chill shows only personal items: work items stay
// saved and one tap away ("N work tasks hidden in Chill"), and the Pi holds
// their reminders until Work mode is back (raspberry_pi/life_mode.py).
//
// With the Pi, Auto follows the phone: home is Chill, away is Work. A pick by
// hand lasts until you next arrive or leave. The Pi keeps the mode, so every
// device shows the same one and changes arrive on /ws as LIFE_MODE. Without a
// Pi the mode is a plain switch kept in this browser.

import { useSyncExternalStore } from 'react';
import { piBackendUrl, piHeaders } from './piBackend';

export type LifeMode = 'work' | 'chill';

export interface LifeModeState {
  mode: LifeMode;
  // presence: Auto from home/away · override: picked by hand until home/away changes
  // manual: Auto is off · no-phone: Auto, but the phone isn't linked, so Work · local: no Pi
  source: 'presence' | 'override' | 'manual' | 'no-phone' | 'local';
  auto: boolean;
  known: boolean;   // the Pi knows whether you're home
  home: boolean;
  urgentThrough: boolean;
  held: number;     // work reminders waiting for Work mode
  phoneLink: boolean;
}

const LOCAL_KEY = 'sage-life-mode';

const readLocal = (): LifeMode => {
  try { return localStorage.getItem(LOCAL_KEY) === 'chill' ? 'chill' : 'work'; } catch { return 'work'; }
};

const localState = (): LifeModeState => ({
  mode: readLocal(), source: 'local', auto: false, known: false, home: false, urgentThrough: false, held: 0, phoneLink: false,
});

let state: LifeModeState = localState();
const listeners = new Set<() => void>();

const set = (next: Partial<LifeModeState>) => {
  state = { ...state, ...next };
  try { localStorage.setItem(LOCAL_KEY, state.mode); } catch { /* storage unavailable */ }
  listeners.forEach(l => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const getLifeMode = (): LifeModeState => state;

const fromPi = (data: any): Partial<LifeModeState> => ({
  mode: data.mode === 'chill' ? 'chill' : 'work',
  source: data.source,
  auto: !!data.auto,
  known: !!data.known,
  home: !!data.home,
  urgentThrough: !!data.urgentThrough,
  ...(typeof data.held === 'number' ? { held: data.held } : {}),
  ...(typeof data.phoneLink === 'boolean' ? { phoneLink: data.phoneLink } : {}),
});

// The Pi's LIFE_MODE event (see liveStream.ts).
export const applyLifeModeEvent = (event: any) => set(fromPi(event));

export async function loadLifeMode(): Promise<void> {
  const base = piBackendUrl();
  if (!base) return;
  try {
    const res = await fetch(`${base}/api/life-mode`, { headers: piHeaders() });
    if (res.ok) set(fromPi(await res.json()));
  } catch {
    // The Pi is unreachable; keep the last known mode.
  }
}

async function put(update: Record<string, unknown>): Promise<void> {
  const base = piBackendUrl();
  if (!base) return;
  const res = await fetch(`${base}/api/life-mode`, {
    method: 'PUT',
    headers: piHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error('Could not change the mode');
  set(fromPi(await res.json()));
}

export async function setLifeMode(mode: LifeMode): Promise<void> {
  const before = state.mode;
  set({ mode }); // show it at once; the Pi confirms
  try {
    await put({ mode });
  } catch (e) {
    set({ mode: before });
    throw e;
  }
}

export const setLifeModeSettings = (update: { auto?: boolean; urgentThrough?: boolean }) => put(update);

export const useLifeMode = (): LifeModeState => useSyncExternalStore(subscribe, getLifeMode, getLifeMode);

// One line for the switch's tooltip and Settings.
export function describeLifeMode(s: LifeModeState): string {
  if (s.source === 'local') return s.mode === 'chill' ? 'Chill: personal only' : 'Work: everything';
  if (s.source === 'manual') return `${s.mode === 'chill' ? 'Chill' : 'Work'}, picked by hand (Auto is off)`;
  if (s.source === 'override') return `${s.mode === 'chill' ? 'Chill' : 'Work'} until you ${s.home ? 'leave' : 'get home'}`;
  if (s.source === 'no-phone') return 'Work, because the phone isn\'t linked to the Pi';
  return s.home ? 'Chill, because you\'re home' : 'Work, because you\'re out';
}
