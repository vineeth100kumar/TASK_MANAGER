import { storage } from './utils/storage';

export const DEFAULT_LAT = 28.6139;
export const DEFAULT_LON = 77.2090;
export const DEFAULT_USER_NAME = 'Chief';

const SECRET_KEY = 'sage_api_secret';

/*
 * The key this browser talks to the Pi with.
 *
 * There used to be a fallback constant here, the same string the backend
 * accepted as a legacy shortcuts secret. It was in a public repository and in
 * every built bundle, so it authenticated nobody and admitted everybody. There
 * is no default any more: a build can bake one in with VITE_API_SECRET, and
 * otherwise the app asks for it once and keeps it in this browser.
 */
export function getApiSecret(): string {
  const envSecret = (import.meta as any).env?.VITE_API_SECRET;
  if (envSecret && typeof envSecret === 'string' && envSecret.trim()) {
    return envSecret.trim();
  }
  return storage.get(SECRET_KEY, '').trim();
}

export function setApiSecret(secret: string): void {
  storage.set(SECRET_KEY, secret.trim());
}

export function clearApiSecret(): void {
  storage.remove(SECRET_KEY);
}

export function hasApiSecret(): boolean {
  return getApiSecret().length > 0;
}

/**
 * True when the key came from the build rather than from this browser, in
 * which case there is nothing for the user to change at runtime.
 */
export function isApiSecretFromEnv(): boolean {
  const envSecret = (import.meta as any).env?.VITE_API_SECRET;
  return !!(envSecret && typeof envSecret === 'string' && envSecret.trim());
}
