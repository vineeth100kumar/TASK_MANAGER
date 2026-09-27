// piBackend.ts - Where the Raspberry Pi server is, and the key it expects.
//
// VITE_PI_BACKEND_URL is the Pi server's address. Set it to "/" when the app
// is served by the Pi server itself (the default install), so requests go to
// the same origin. The key comes from Settings (stored in this browser only)
// or, failing that, VITE_PI_API_KEY at build time.

const KEY_STORAGE = 'sage.piApiKey';

export const piBackendUrl = (): string => {
  const raw = (import.meta.env.VITE_PI_BACKEND_URL || '').trim();
  if (raw === '/') return typeof window !== 'undefined' ? window.location.origin : '';
  return raw.replace(/\/+$/, '');
};

export const getPiApiKey = (): string => {
  try {
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored) return stored;
  } catch {
    // Storage can be unavailable (private mode); fall through to the build-time key.
  }
  return import.meta.env.VITE_PI_API_KEY || '';
};

export const setPiApiKey = (key: string): void => {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Nothing to do if storage is blocked.
  }
};

// Headers for a request to the Pi server. Requests to Google Apps Script must
// not carry these: a custom header forces a CORS preflight Apps Script rejects.
export const piHeaders = (headers: Record<string, string> = {}): Record<string, string> => {
  const key = getPiApiKey();
  return key ? { ...headers, Authorization: `Bearer ${key}` } : headers;
};
