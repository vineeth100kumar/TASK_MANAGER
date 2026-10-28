import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { Fingerprint, ShieldCheck, Trash2, Plus, Lock, AlertTriangle, RefreshCw } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { piBackendUrl } from '../../services/piBackend';
import {
  passkeyStatus, PasskeyStatus, TrustedDevice, listTrustedDevices, trustThisDevice,
  revokeTrustedDevice, revokeAllTrustedDevices, browserSupportsPasskeys, platformAuthenticatorAvailable,
} from '../../services/passkeys';

// "Sign-in": trust a device so it opens Sage with its own Face ID / Touch ID /
// Windows Hello / PIN instead of the password. The password is always the
// fallback and the recovery path, so this never locks anyone out.
function timeAgo(ts: number | null): string {
  if (!ts) return 'never used';
  const secs = Math.max(0, Date.now() / 1000 - ts);
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SecuritySettings() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<PasskeyStatus | null | undefined>(undefined);
  const [platformOk, setPlatformOk] = useState<boolean>(false);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([passkeyStatus(), platformAuthenticatorAvailable()]);
      setStatus(s);
      setPlatformOk(p);
      if (s?.available) setDevices(await listTrustedDevices().catch(() => []));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const noPi = !piBackendUrl();
  const supported = browserSupportsPasskeys();

  const trust = async () => {
    setBusy(true);
    try {
      const device = await trustThisDevice();
      showToast(`${device.name} trusted`, 'success');
      await load();
    } catch (e: any) {
      if (e?.message !== 'Cancelled.') showToast(e?.message || "Couldn't trust this device.", 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (d: TrustedDevice) => {
    try {
      await revokeTrustedDevice(d.id);
      setDevices(list => list.filter(x => x.id !== d.id));
      showToast(`${d.name} removed`, 'info');
    } catch (e: any) {
      showToast(e?.message || "Couldn't remove it.", 'error');
    }
  };

  const revokeAll = async () => {
    try {
      await revokeAllTrustedDevices();
      setDevices([]);
      showToast('All trusted devices removed', 'info');
    } catch (e: any) {
      showToast(e?.message || "Couldn't remove them.", 'error');
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <div className="shrink-0 h-10 w-10 rounded-2xl bg-gray-100 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-center">
          <ShieldCheck size={19} className="text-gray-700 dark:text-gray-200" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">Trusted devices</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
            Trust a device to open Sage with Face ID, a fingerprint or its PIN instead of the password.
            Your password still works everywhere, and stays the way back in.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="skeleton h-28 !rounded-3xl" aria-busy="true" />
      ) : noPi ? (
        <Notice icon={<Lock size={16} />}>
          Trusted devices need the Pi. This copy of Sage isn't connected to one.
        </Notice>
      ) : status && !status.available ? (
        <Notice icon={<AlertTriangle size={16} />}>
          The Pi needs a quick update before this works. Re-run <code className="font-mono text-[12px]">install_pi.sh</code> (it adds the passkey library).
        </Notice>
      ) : status && !status.gate ? (
        <Notice icon={<Lock size={16} />}>
          Set a Sage password first (Settings → Server &amp; Reset). A trusted device unlocks that password; it doesn't replace it.
        </Notice>
      ) : !supported || !status?.secure ? (
        <Notice icon={<AlertTriangle size={16} />}>
          This browser can't use a passkey on the address you're on. Face ID and the like need a secure connection:
          open Sage over its <strong>HTTPS link</strong> (Settings → Server &amp; Reset shows it), or on the Pi itself.
          On a plain <code className="font-mono text-[12px]">http://</code> home-network address it isn't offered — the password keeps working.
        </Notice>
      ) : !platformOk ? (
        <Notice icon={<AlertTriangle size={16} />}>
          This device doesn't have a built-in unlock (Face ID, Touch ID, Windows Hello or a device PIN) set up, so there's nothing for Sage to use yet.
        </Notice>
      ) : (
        <button onClick={trust} disabled={busy}
          className="w-full h-12 rounded-2xl flex items-center justify-center gap-2 text-[14.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-60 bg-gradient-to-b from-gray-800 to-gray-950 hover:from-gray-700 hover:to-gray-900 dark:from-white dark:to-gray-200 text-white dark:text-black shadow-sm shadow-black/20 ring-1 ring-inset ring-white/10 dark:ring-black/5">
          {busy ? <><RefreshCw size={16} className="animate-spin" /> Follow your device…</> : <><Plus size={16} /> Trust this device</>}
        </button>
      )}

      {devices.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-400">Trusted ({devices.length})</h3>
            <button onClick={revokeAll} className="text-[12px] font-medium text-red-600 dark:text-red-400 hover:underline">Remove all</button>
          </div>
          <ul className="rounded-3xl bg-white dark:bg-white/[0.03] ring-1 ring-black/5 dark:ring-white/10 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
            {devices.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="shrink-0 h-9 w-9 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                  <Fingerprint size={17} className="text-gray-600 dark:text-gray-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-gray-900 dark:text-white truncate">{d.name}</div>
                  <div className="text-[12px] text-gray-400">{timeAgo(d.lastUsedAt)}</div>
                </div>
                <button onClick={() => revoke(d)} aria-label={`Remove ${d.name}`}
                  className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-400/10">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
          <p className="px-1 text-[12px] text-gray-400">
            Removing a device, or changing your password, makes it ask for the password again. These never leave the Pi.
          </p>
        </div>
      )}
    </div>
  );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-gray-50 dark:bg-white/[0.03] ring-1 ring-black/5 dark:ring-white/10 px-4 py-3 text-[13px] leading-snug text-gray-600 dark:text-gray-300">
      <span className="shrink-0 mt-0.5 text-gray-400">{icon}</span>
      <p>{children}</p>
    </div>
  );
}
