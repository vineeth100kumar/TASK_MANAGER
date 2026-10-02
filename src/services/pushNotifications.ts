// pushNotifications.ts - Notifications that arrive while Sage is closed.
//
// The Pi decides when to notify (see raspberry_pi/notifier.py) and sends Web
// Push to every device that opted in here. On iPhone and iPad this only works
// once Sage is added to the Home Screen and opened from there (iOS 16.4+), and
// the permission prompt may only follow a tap, so enable() must be called
// from a click handler.

import { piBackendUrl, piHeaders } from './piBackend';

export type PushState =
  | 'no-server'      // this build doesn't talk to the Pi, so nothing can send pushes
  | 'unsupported'    // this browser can't receive web push
  | 'needs-install'  // iPhone/iPad in a Safari tab: add to Home Screen first
  | 'denied'         // the person (or the OS) blocked notifications for Sage
  | 'off'            // can be turned on
  | 'on';            // this device is subscribed

export interface NotifyPrefs {
  timezone: string;
  timezoneChosen: boolean;
  reminders: boolean;
  morningPlan: boolean;
  morningTime: string;
  eveningCheckIn: boolean;
  eveningTime: string;
  email: {
    enabled: boolean;
    to: string;
    morningPlan: boolean;
    reminders: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
  };
}

export interface NotifyConfig {
  pushAvailable: boolean;
  vapidPublicKey: string | null;
  prefs: NotifyPrefs;
  devices: { label: string; endpoint: string; lastSuccessAt: string | null }[];
  emailPasswordSet: boolean;
  emailReady: boolean;
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export const isAppleMobile = (): boolean =>
  /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);

export const isInstalled = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

const supportsPush = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const deviceLabel = (): string => {
  const s = ua();
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s) || (/Macintosh/.test(s) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(s)) return 'Android phone';
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
};

const timezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** False only when the subscription is known to use a different key. Some
 *  browsers don't report the key, and then the subscription is kept. */
function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function call<T = NotifyConfig>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${piBackendUrl()}/api/notifications${path}`, {
    method,
    headers: piHeaders(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail || json.error || `The Pi said ${res.status}`);
  return json as T;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registers /sw.js once. Safe to call on every start. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!registration) {
    registration = (typeof navigator !== 'undefined' && 'serviceWorker' in navigator)
      ? navigator.serviceWorker.register('/sw.js').catch(err => {
          console.warn('[Push] Service worker registration failed:', err);
          return null;
        })
      : Promise.resolve(null);
  }
  return registration;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function getPushState(): Promise<PushState> {
  if (!piBackendUrl()) return 'no-server';
  if (isAppleMobile() && !isInstalled()) return 'needs-install';
  if (!supportsPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

export const getConfig = () => call('');
export const savePrefs = (update: Partial<NotifyPrefs> | { email: Partial<NotifyPrefs['email']> }) => call('/prefs', 'PUT', update);
export const saveEmailPassword = (password: string) => call('/email-password', 'POST', { password });
export const sendTest = (channel: 'push' | 'email', endpoint?: string) =>
  call<{ success: boolean; results?: { label: string; ok: boolean; error?: string }[] }>('/test', 'POST', { channel, endpoint });

/** Asks for permission and subscribes this device. Call from a tap. */
export async function enablePush(): Promise<PushState> {
  // Ask first, while the tap still counts as a user gesture (iOS requires it).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const config = await getConfig();
  if (!config.pushAvailable || !config.vapidPublicKey) {
    throw new Error('The Pi needs an update before it can send notifications (pip install -r requirements.txt, then restart Sage).');
  }
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('This browser blocked the notification service.');
  await navigator.serviceWorker.ready;
  const key = keyBytes(config.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  await call('/subscribe', 'POST', { subscription: sub.toJSON(), label: deviceLabel(), timezone: timezone() });
  return 'on';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await call('/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function thisDeviceEndpoint(): Promise<string | null> {
  return (await currentSubscription())?.endpoint || null;
}

/**
 * On start: make sure the Pi still knows this device and the current
 * timezone (a reset database or a trip abroad would otherwise go unnoticed).
 */
export async function refreshSubscription(): Promise<void> {
  try {
    if ((await getPushState()) !== 'on') return;
    const sub = await currentSubscription();
    if (!sub) return;
    const config = await getConfig();
    if (config.vapidPublicKey && !sameKey(sub.options.applicationServerKey, keyBytes(config.vapidPublicKey))) {
      // The Pi made new keys (fresh install); the old subscription can't be used.
      await sub.unsubscribe();
      await enablePush();
      return;
    }
    await call('/subscribe', 'POST', { subscription: sub.toJSON(), label: deviceLabel(), timezone: timezone() });
  } catch (err) {
    console.warn('[Push] Could not refresh this device with the Pi:', err);
  }
}
