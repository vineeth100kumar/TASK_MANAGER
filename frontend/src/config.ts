import { storage } from './utils/storage';

export const DEFAULT_LAT = 28.6139;
export const DEFAULT_LON = 77.2090;
export const DEFAULT_USER_NAME = 'Chief';
export const DEFAULT_API_SECRET = 'sage_rpi5_secret_ios_key_2026';

export function getApiSecret(): string {
  // Check Vite environment variable first, then storage, then default fallback
  const envSecret = (import.meta as any).env?.VITE_API_SECRET;
  if (envSecret && typeof envSecret === 'string' && envSecret.trim()) {
    return envSecret.trim();
  }
  const stored = storage.get('sage_api_secret', '');
  if (stored && stored.trim()) {
    return stored.trim();
  }
  return DEFAULT_API_SECRET;
}

export function setApiSecret(secret: string): void {
  storage.set('sage_api_secret', secret.trim());
}
