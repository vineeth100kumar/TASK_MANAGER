// BluetoothSettings - Manage the Pi's Bluetooth from Settings: see devices,
// scan, pair, connect, disconnect and forget, like a phone's Bluetooth page.
//
// The Pi does the work (raspberry_pi/bluetooth_control.py); this page shows its
// device list live and sends the commands. Pairing is never silent: the code
// the phone shows has to be confirmed here.

import { useEffect, useState } from 'react';
import {
  Bluetooth, BluetoothConnected, BluetoothSearching, Smartphone, Laptop, Headphones, Keyboard, Watch, CircleHelp,
  Loader2, Unplug, Link2, Trash2, Pencil, Check, X, Radar,
} from 'lucide-react';
import { useBluetooth, type BluetoothDevice, type DeviceKind } from '../../services/bluetooth';
import { useToast } from '../../context/ToastContext';

const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-4';
const smallButton = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const primaryButton = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';

const KIND_ICON: Record<DeviceKind, typeof Bluetooth> = {
  phone: Smartphone, computer: Laptop, audio: Headphones, input: Keyboard, watch: Watch, other: CircleHelp,
};

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-white/20'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

const signal = (rssi: number | null): string | null => {
  if (rssi === null || rssi === undefined) return null;
  return rssi > -60 ? 'Strong signal' : rssi > -80 ? 'Medium signal' : 'Weak signal';
};

const WORKING: Record<string, string> = { pairing: 'Pairing…', connecting: 'Connecting…', disconnecting: 'Disconnecting…' };

function statusLine(d: BluetoothDevice): string {
  if (d.working) return WORKING[d.working];
  const parts = [d.connected ? 'Connected' : d.paired ? 'Paired, not connected' : 'Not paired'];
  const s = !d.connected && signal(d.rssi);
  if (s) parts.push(s);
  return parts.join(' · ');
}

function DeviceRow({
  device, onAction, forgetting, setForgetting,
}: {
  device: BluetoothDevice;
  onAction: (address: string, action: 'pair' | 'connect' | 'disconnect' | 'forget' | 'trust' | 'untrust') => void;
  forgetting: boolean;
  setForgetting: (on: boolean) => void;
}) {
  const Icon = device.connected ? BluetoothConnected : KIND_ICON[device.kind];
  const busy = !!device.working;
  return (
    <div className="py-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${device.connected ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400' : 'bg-gray-900/[0.05] dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>
          <Icon size={17} />
        </div>
        <div className="min-w-[9rem] flex-1">
          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{device.name}</div>
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            {busy && <Loader2 size={11} className="animate-spin" />}
            <span className="truncate">{statusLine(device)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {!device.paired && <button className={primaryButton} disabled={busy} onClick={() => onAction(device.address, 'pair')}>Pair</button>}
          {device.paired && !device.connected && <button className={primaryButton} disabled={busy} onClick={() => onAction(device.address, 'connect')}><Link2 size={13} />Connect</button>}
          {device.connected && <button className={smallButton} disabled={busy} onClick={() => onAction(device.address, 'disconnect')}><Unplug size={13} />Disconnect</button>}
        </div>
      </div>

      {device.paired && (
        <div className="pl-12 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Toggle on={device.trusted} label={`Reconnect ${device.name} automatically`} onChange={on => onAction(device.address, on ? 'trust' : 'untrust')} />
            Reconnect automatically
          </label>
          {!forgetting ? (
            <button onClick={() => setForgetting(true)} className="ml-auto text-xs font-medium text-gray-400 hover:text-red-600 flex items-center gap-1"><Trash2 size={12} />Forget</button>
          ) : (
            <span className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400">Forget {device.name}?</span>
              <button className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold" onClick={() => { setForgetting(false); onAction(device.address, 'forget'); }}>Forget</button>
              <button className="px-2.5 py-1 rounded-lg text-gray-500 hover:bg-gray-900/5 dark:hover:bg-white/10" onClick={() => setForgetting(false)}>Keep</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function BluetoothSettings() {
  const bt = useBluetooth();
  const { showToast } = useToast();
  const [now, setNow] = useState(Date.now());
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { state } = bt;

  const counting = !!(state?.pairing?.active || state?.pending);
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  // Runs a command and says so if the Pi refuses.
  const attempt = async (job: () => Promise<string | null>) => {
    setSending(true);
    const problem = await job();
    setSending(false);
    if (problem) showToast(problem, 'error');
  };

  const left = (seconds: number) => Math.max(0, seconds - Math.floor((now - bt.receivedAt) / 1000));
  const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  if (!bt.hasServer) {
    return <div className={card}><p className="text-xs text-gray-500">Bluetooth is managed by the Sage server on your Pi. This copy of the app runs without it.</p></div>;
  }
  if (!state) {
    return <div className={`${card} flex items-center gap-2 text-xs text-gray-400`}>{bt.problem ? bt.problem : <><Loader2 size={14} className="animate-spin" />Asking the Pi…</>}</div>;
  }
  if (!state.available) {
    return (
      <div className={card}>
        <div className="flex items-center gap-2"><Bluetooth size={16} className="text-gray-400" /><h4 className="font-semibold text-sm text-gray-900 dark:text-white">Bluetooth isn't available</h4></div>
        <p className="text-xs text-gray-500">{state.reason || "The Pi's Bluetooth isn't reachable from the Sage server."}</p>
        <p className="text-xs text-gray-400">It needs BlueZ 5.66 or newer on the Pi, and the packages in raspberry_pi/requirements.txt. See "Phone notifications over Bluetooth" in raspberry_pi/README.md.</p>
      </div>
    );
  }

  const adapter = state.adapter!;
  const devices = state.devices || [];
  const mine = devices.filter(d => d.paired);
  const nearby = devices.filter(d => !d.paired);
  const pending = state.pending;
  const pairingLeft = state.pairing?.active ? left(state.pairing.secondsLeft) : 0;

  return (
    <div className="space-y-6">
      {bt.problem && <div className="px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">{bt.problem}</div>}
      {state.error && (
        <div className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-xs text-red-700 dark:text-red-300">{state.error.message}</div>
      )}

      {pending && (
        <div className="p-5 rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 space-y-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{pending.name} wants to pair</div>
          {pending.passkey ? (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">Does your device show this same code?</p>
              <div className="text-3xl font-semibold tracking-[0.3em] text-gray-900 dark:text-white tabular-nums">{pending.passkey}</div>
            </>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">Allow it to pair with your Pi?</p>
          )}
          <div className="flex items-center gap-2">
            <button className={primaryButton} onClick={() => attempt(() => bt.confirm(true))} disabled={sending}><Check size={14} />Yes, pair</button>
            <button className={smallButton} onClick={() => attempt(() => bt.confirm(false))} disabled={sending}><X size={14} />No</button>
            <span className="ml-auto text-xs text-gray-400 tabular-nums">{left(pending.secondsLeft)}s</span>
          </div>
        </div>
      )}

      <div className={card}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0"><Bluetooth size={17} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Bluetooth</div>
            {renaming === null ? (
              <div className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="truncate">{adapter.powered ? `Visible to paired devices as "${adapter.name}"` : 'Off'}</span>
                <button aria-label="Rename" onClick={() => setRenaming(adapter.name)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><Pencil size={11} /></button>
              </div>
            ) : (
              <form className="mt-1 flex items-center gap-2" onSubmit={e => { e.preventDefault(); attempt(() => bt.rename(renaming)).then(() => setRenaming(null)); }}>
                <input autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} maxLength={40}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="submit" className={smallButton}>Save</button>
                <button type="button" className="text-xs text-gray-400" onClick={() => setRenaming(null)}>Cancel</button>
              </form>
            )}
          </div>
          <Toggle on={adapter.powered} label="Bluetooth on or off" disabled={sending} onChange={on => attempt(() => bt.setPower(on))} />
        </div>

        {adapter.powered && (
          <div className="pt-1 space-y-3 border-t border-black/5 dark:border-white/5">
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <div className="flex-1 min-w-[12rem]">
                <div className="text-sm font-medium text-gray-900 dark:text-white">Pair a new device</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {pairingLeft > 0
                    ? `Open Bluetooth on your phone and tap "${adapter.name}". Open for ${minutes(pairingLeft)}.`
                    : 'Makes the Pi visible for 3 minutes so a phone can find it. Nobody can pair outside that window.'}
                </div>
              </div>
              {pairingLeft > 0
                ? <button className={smallButton} disabled={sending} onClick={() => attempt(() => bt.setPairing(false))}><X size={14} />Stop</button>
                : <button className={primaryButton} disabled={sending} onClick={() => attempt(() => bt.setPairing(true))}><BluetoothSearching size={14} />Start pairing</button>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[12rem]">
                <div className="text-sm font-medium text-gray-900 dark:text-white">Look for nearby devices</div>
                <div className="text-xs text-gray-400 mt-0.5">For speakers, keyboards and other things you pair from the Pi's side. Scans for 30 seconds.</div>
              </div>
              {state.scanning
                ? <button className={smallButton} disabled={sending} onClick={() => attempt(() => bt.setScan(false))}><Loader2 size={13} className="animate-spin" />Stop scan</button>
                : <button className={smallButton} disabled={sending} onClick={() => attempt(() => bt.setScan(true))}><Radar size={14} />Scan</button>}
            </div>
          </div>
        )}
      </div>

      {adapter.powered && (
        <div className={card}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">My devices</h4>
          {mine.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing paired yet. Start pairing above, then pick "{adapter.name}" in your phone's Bluetooth settings.</p>
          ) : (
            <div className="divide-y divide-black/5 dark:divide-white/5 -my-3">
              {mine.map(d => (
                <DeviceRow key={d.address} device={d} forgetting={forgetting === d.address}
                  setForgetting={on => setForgetting(on ? d.address : null)}
                  onAction={(address, action) => attempt(() => bt.deviceAction(address, action))} />
              ))}
            </div>
          )}
        </div>
      )}

      {adapter.powered && (state.scanning || nearby.length > 0) && (
        <div className={card}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            Nearby {state.scanning && <Loader2 size={12} className="animate-spin" />}
          </h4>
          {nearby.length === 0 ? (
            <p className="text-xs text-gray-400">Looking…</p>
          ) : (
            <div className="divide-y divide-black/5 dark:divide-white/5 -my-3">
              {nearby.map(d => (
                <DeviceRow key={d.address} device={d} forgetting={false} setForgetting={() => {}}
                  onAction={(address, action) => attempt(() => bt.deviceAction(address, action))} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
