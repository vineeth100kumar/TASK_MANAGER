// bluetooth.ts - The Pi's Bluetooth, managed from Settings.
//
// The Pi server (raspberry_pi/bluetooth_control.py) does the work over BlueZ.
// This file asks it for the device list, sends the commands (scan, pair,
// connect, disconnect, forget) and keeps the list live from /ws.

import { useCallback, useEffect, useRef, useState } from 'react';
import { piBackendUrl, piHeaders } from './piBackend';
import { BLUETOOTH_EVENT } from './liveStream';

export type DeviceKind = 'phone' | 'computer' | 'audio' | 'input' | 'watch' | 'other';

export interface BluetoothDevice {
  address: string;
  name: string;
  kind: DeviceKind;
  paired: boolean;
  connected: boolean;
  trusted: boolean;
  rssi: number | null;
  working: '' | 'pairing' | 'connecting' | 'disconnecting';
}

export interface BluetoothState {
  available: boolean;
  reason?: string;
  adapter?: { name: string; address: string; powered: boolean };
  scanning?: boolean;
  pairing?: { active: boolean; secondsLeft: number };
  pending?: { address: string; name: string; passkey: string; secondsLeft: number } | null;
  error?: { address: string; message: string } | null;
  devices?: BluetoothDevice[];
}

export type DeviceAction = 'pair' | 'connect' | 'disconnect' | 'forget' | 'trust' | 'untrust';

const post = async (path: string, body?: unknown): Promise<BluetoothState> => {
  const res = await fetch(`${piBackendUrl()}/api/bluetooth${path}`, {
    method: 'POST',
    headers: piHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || 'The Pi could not do that.');
  return data;
};

export function useBluetooth() {
  const hasServer = !!piBackendUrl();
  const [state, setState] = useState<BluetoothState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const alive = useRef(true);

  const accept = useCallback((next: BluetoothState) => {
    if (!alive.current) return;
    setState(next);
    setReceivedAt(Date.now());
  }, []);

  const load = useCallback(async () => {
    if (!hasServer) return;
    try {
      const res = await fetch(`${piBackendUrl()}/api/bluetooth`, { headers: piHeaders() });
      if (!res.ok) throw new Error();
      accept(await res.json());
      setProblem(null);
    } catch {
      if (alive.current) setProblem("Can't reach the Pi right now.");
    }
  }, [hasServer, accept]);

  useEffect(() => {
    alive.current = true;
    load();
    const onEvent = (e: Event) => accept((e as CustomEvent).detail);
    window.addEventListener(BLUETOOTH_EVENT, onEvent);
    // The live stream does the work; this is the safety net if it is down.
    const timer = setInterval(load, 8000);
    return () => {
      alive.current = false;
      window.removeEventListener(BLUETOOTH_EVENT, onEvent);
      clearInterval(timer);
    };
  }, [load, accept]);

  // Runs a command; resolves with an error message, or null when it worked.
  const run = useCallback(async (path: string, body?: unknown): Promise<string | null> => {
    try {
      accept(await post(path, body));
      return null;
    } catch (e: any) {
      return e?.message || 'The Pi could not do that.';
    }
  }, [accept]);

  return {
    hasServer, state, problem, receivedAt, reload: load,
    setPower: (on: boolean) => run('/power', { on }),
    setPairing: (on: boolean) => run('/pairing', { on, seconds: 180 }),
    setScan: (on: boolean) => run('/scan', { on }),
    rename: (name: string) => run('/name', { name }),
    confirm: (accept: boolean) => run('/confirm', { accept }),
    deviceAction: (address: string, action: DeviceAction) => run(`/devices/${encodeURIComponent(address)}/${action}`),
  };
}
