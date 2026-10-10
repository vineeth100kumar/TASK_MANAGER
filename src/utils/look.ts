import { useSyncExternalStore } from 'react';

/**
 * How Sage is drawn. Classic is the default; Drafting is the technical
 * illustration look: a drafting-grid paper, mono labels, line-art figures and
 * a blueprint branches view. Stored per device and set as data-look on <html>.
 */
export type Look = 'classic' | 'drafting';

const KEY = 'sage-look';
const EVENT = 'sage-look-change';

export function getLook(): Look {
  try {
    return localStorage.getItem(KEY) === 'drafting' ? 'drafting' : 'classic';
  } catch {
    return 'classic';
  }
}

/** Sets data-look on <html>. Called before the first render so there's no flash. */
export function applyLook(look: Look = getLook()) {
  document.documentElement.dataset.look = look;
}

export function setLook(look: Look) {
  try { localStorage.setItem(KEY, look); } catch { /* private mode: still applies for this visit */ }
  const swap = () => { applyLook(look); window.dispatchEvent(new Event(EVENT)); };
  // Cross-fade between looks where the browser can; otherwise switch at once.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) { swap(); return; }
  const root = document.documentElement;
  root.classList.add('look-switching');
  const t = doc.startViewTransition(swap) as { finished?: Promise<void> };
  (t.finished || Promise.resolve()).finally(() => root.classList.remove('look-switching'));
}

const subscribe = (cb: () => void) => {
  // Another tab changed it: apply it here too.
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { applyLook(); cb(); } };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage); };
};

export function useLook(): Look {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.look === 'drafting' ? 'drafting' : 'classic');
}
