import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Fingerprint, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  passkeyStatus, browserSupportsPasskeys, platformAuthenticatorAvailable, trustThisDevice,
} from '../../services/passkeys';

// After login, offer once to trust this device so next time it opens with Face
// ID / Touch ID / Windows Hello instead of the password. It only shows where it
// can actually work (a password is set, the browser has a built-in
// authenticator, and the page is a secure context), and never nags: dismiss or
// trust and it stays away on this browser.
const SEEN_KEY = 'sage.trustPrompt.v1';

export function TrustDevicePrompt({ booted, onOpenSettings }: { booted: boolean; onOpenSettings: () => void }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!booted) return;
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(SEEN_KEY)) return;
      } catch { /* storage blocked: just don't persist the dismissal */ }
      if (!browserSupportsPasskeys()) return;
      if (!(await platformAuthenticatorAvailable())) return;
      const status = await passkeyStatus();
      // Only when a password is actually set — a passkey rides on top of it.
      if (cancelled || !status || !status.available || !status.gate || !status.secure) return;
      setShow(true);
    })();
    return () => { cancelled = true; };
  }, [booted]);

  const remember = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ } };

  const dismiss = () => { remember(); setShow(false); };

  const trust = async () => {
    setBusy(true);
    try {
      const device = await trustThisDevice();
      remember();
      setShow(false);
      showToast(`${device.name} trusted — next time, unlock with your device`, 'success');
    } catch (e: any) {
      if (e?.message === 'Cancelled.') { /* let them try again or dismiss */ }
      else showToast(e?.message || "Couldn't trust this device.", 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16, transition: { duration: 0.18 } }}
          transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          className="fixed z-[120] bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6 inset-x-4 md:inset-x-auto md:right-6 md:w-[22rem]"
          role="dialog"
          aria-label="Trust this device"
        >
          <div className="relative rounded-3xl bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/10 shadow-xl shadow-black/15 p-4">
            <button onClick={dismiss} aria-label="Dismiss"
              className="absolute top-3 right-3 h-7 w-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5">
              <X size={15} />
            </button>
            <div className="flex items-start gap-3">
              <div className="shrink-0 h-10 w-10 rounded-2xl bg-gray-100 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-center">
                <Fingerprint size={19} className="text-gray-700 dark:text-gray-200" />
              </div>
              <div className="min-w-0 pr-5">
                <h3 className="text-[14.5px] font-semibold tracking-tight text-gray-900 dark:text-white">Trust this device?</h3>
                <p className="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
                  Open Sage with Face ID, your fingerprint or this device's PIN instead of typing the password.
                </p>
              </div>
            </div>
            <div className="mt-3.5 flex items-center gap-2">
              <button onClick={trust} disabled={busy}
                className="flex-1 h-10 rounded-2xl text-[14px] font-semibold transition-all active:scale-[0.97] disabled:opacity-60 bg-gradient-to-b from-gray-800 to-gray-950 hover:from-gray-700 hover:to-gray-900 dark:from-white dark:to-gray-200 text-white dark:text-black shadow-sm shadow-black/20 ring-1 ring-inset ring-white/10 dark:ring-black/5">
                {busy ? 'Follow your device…' : 'Trust this device'}
              </button>
              <button onClick={() => { remember(); setShow(false); onOpenSettings(); }}
                className="h-10 px-3 rounded-2xl text-[13px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
                Manage
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
