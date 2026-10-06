// liveStream.ts - The Pi server's /ws event stream.
//
// The Pi announces every applied sync batch on /ws (LUMO listens to the same
// stream). Listening here lets a change made on another device show up within
// a second instead of on the next 30-second poll. Only used when the app talks
// to the Pi; Apps Script has no equivalent.

import { getPiApiKey } from './piBackend';

export type LiveEvent =
  | { type: 'SYNC_APPLIED'; serverRevision: number }
  | { type: 'SYNC_CLEARED'; serverRevision: number };

const MAX_RETRY_MS = 60000;

export const PHONE_EVENT = 'sage:phone';
export const BLUETOOTH_EVENT = 'sage:bluetooth';

export class LiveStream {
  private socket: WebSocket | null = null;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(
    private readonly baseUrl: string,
    private readonly onEvent: (event: LiveEvent) => void,
    private readonly onConnectedChange: (connected: boolean) => void
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    if (typeof WebSocket === 'undefined' || this.socket) return;
    const url = this.baseUrl.replace(/^http/, 'ws') + '/ws';
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      // The key is read on every connect, so one entered in Settings is picked up
      // at the next reconnect.
      socket.send(JSON.stringify({ type: 'auth', token: getPiApiKey() }));
    };
    socket.onmessage = (message) => {
      let event: any;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event?.type === 'AUTH_OK') {
        this.retryMs = 1000;
        this.setConnected(true);
      } else if (event?.type === 'SYNC_APPLIED' || event?.type === 'SYNC_CLEARED') {
        this.onEvent(event);
      } else if (typeof event?.type === 'string' && event.type.startsWith('PHONE_')) {
        // The phone's Bluetooth events (see PhoneCorner) go to whoever listens.
        window.dispatchEvent(new CustomEvent(PHONE_EVENT, { detail: event }));
      } else if (event?.type === 'BT_STATE') {
        // The Bluetooth settings page (see BluetoothSettings) shows the device list live.
        window.dispatchEvent(new CustomEvent(BLUETOOTH_EVENT, { detail: event }));
      }
    };
    socket.onclose = () => {
      this.socket = null;
      this.setConnected(false);
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose follows and handles the reconnect.
    };
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.onConnectedChange(connected);
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    const delay = this.retryMs + Math.random() * 500;
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start();
    }, delay);
  }
}
