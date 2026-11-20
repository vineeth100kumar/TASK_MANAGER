// location.ts - Where you are (Home, Work, or out), told to the Pi by iPhone
// Shortcuts "When I arrive / leave" automations (raspberry_pi/location.py).
// The Pi keeps the answer; changes arrive on /ws as WHERE.

import { useSyncExternalStore } from 'react';
import { piBackendUrl, piHeaders } from './piBackend';

export type PlaceKind = 'home' | 'work' | 'other';
export interface Place { name: string; kind: PlaceKind }
export interface WhereState {
  places: Place[];
  here: { place: string; since: number } | null;
  label: string;            // the place name, or "Out"
  kind: PlaceKind | null;
}

let state: WhereState | null = null;
const listeners = new Set<() => void>();
const set = (next: WhereState) => { state = next; listeners.forEach(l => l()); };

const fromPi = (data: any): WhereState => ({
  places: Array.isArray(data?.places) ? data.places : [],
  here: data?.here?.place ? { place: data.here.place, since: data.here.since } : null,
  label: typeof data?.label === 'string' ? data.label : 'Out',
  kind: data?.kind ?? null,
});

// The Pi's WHERE event (see liveStream.ts).
export const applyWhereEvent = (event: any) => set(fromPi(event));

export async function loadWhere(): Promise<void> {
  const base = piBackendUrl();
  if (!base) return;
  try {
    const res = await fetch(`${base}/api/presence/location`, { headers: piHeaders() });
    if (res.ok) set(fromPi(await res.json()));
  } catch {
    // The Pi is unreachable; keep the last known place.
  }
}

export async function removePlace(name: string): Promise<boolean> {
  const base = piBackendUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/presence/places/${encodeURIComponent(name)}`, { method: 'DELETE', headers: piHeaders() });
    if (res.ok) set(fromPi(await res.json()));
    return res.ok;
  } catch {
    return false;
  }
}

export async function setPlaceKind(name: string, kind: PlaceKind): Promise<boolean> {
  const base = piBackendUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/presence/places/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: piHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ kind }),
    });
    if (res.ok) set(fromPi(await res.json()));
    return res.ok;
  } catch {
    return false;
  }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useWhere = (): WhereState | null => useSyncExternalStore(subscribe, () => state);
