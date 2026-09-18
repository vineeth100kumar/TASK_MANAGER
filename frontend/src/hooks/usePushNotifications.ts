import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

export type PushState =
  | 'unsupported'   // no service worker or no Push API (iOS Safari in a tab)
  | 'unconfigured'  // the Pi has no real VAPID keys yet
  | 'denied'        // the browser is blocking it; only the user can undo this
  | 'off'
  | 'asking'
  | 'on'
  | 'error';

/*
 * The VAPID public key arrives as base64url text and the browser wants raw
 * bytes. Every Web Push tutorial carries a version of this; there is no
 * platform function for it.
 */
const urlBase64ToBytes = (base64: string): ArrayBuffer => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return buffer;
};

/** Base64url, which is what the subscription's binary keys have to be sent as. */
const encodeKey = (buffer: ArrayBuffer | null): string => {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** "iPhone", "Mac", "Windows PC" — enough to tell one subscription from another. */
const deviceName = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  return 'This device';
};

/*
 * Turning reminders on.
 *
 * The Pi already sends pushes when a reminder falls due and the service worker
 * already knows how to show one; what was missing was anything that ever asked
 * the browser for permission and handed the subscription back. This is that.
 */
export const usePushNotifications = () => {
  const [state, setState] = useState<PushState>('off');
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setState('unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        if (!cancelled) setState('denied');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!cancelled) setState(existing ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('off');
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setState('asking');
    setDetail(null);

    try {
      const { public_key: publicKey } = await api.getVapidPublicKey();

      /*
       * A Pi that has never had keys generated returns the placeholder from
       * push_service.py. Subscribing with it fails deep inside the browser with
       * an opaque error, so say the useful thing instead.
       */
      if (!publicKey || publicKey.startsWith('BN_DEMO')) {
        setState('unconfigured');
        return;
      }

      // Must follow a user gesture, which is why this lives behind a button.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(publicKey),
        }));

      await api.subscribePush({
        endpoint: subscription.endpoint,
        p256dh: encodeKey(subscription.getKey('p256dh')),
        auth: encodeKey(subscription.getKey('auth')),
        device_name: deviceName(),
      });

      setState('on');
    } catch (err) {
      setState('error');
      setDetail(err instanceof Error ? err.message : 'Could not turn reminders on.');
    }
  }, []);

  const disable = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Tell the Pi first: if it only hears about this after the browser has
        // thrown the endpoint away, it goes on pushing into the void.
        await api.unsubscribePush(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe();
      }
      setState('off');
    } catch (err) {
      setState('error');
      setDetail(err instanceof Error ? err.message : 'Could not turn reminders off.');
    }
  }, []);

  return { state, detail, enable, disable };
};
