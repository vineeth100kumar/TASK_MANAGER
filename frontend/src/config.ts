import { storage } from './utils/storage';

export const DEFAULT_LAT = 28.6139;
export const DEFAULT_LON = 77.2090;
export const DEFAULT_USER_NAME = 'Chief';

export function getApiSecret(): string {
  // Check Vite environment variable first, then fallback to safe localStorage
  const envSecret = (import.meta as any).env?.VITE_API_SECRET;
  if (envSecret && typeof envSecret === 'string' && envSecret.trim()) {
    return envSecret.trim();
  }
  return storage.get('sage_api_secret', '');
}

export function setApiSecret(secret: string): void {
  storage.set('sage_api_secret', secret.trim());
}
