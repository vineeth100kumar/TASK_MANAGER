// ModePrompt - "Work or Chill?" when Sage opens (right after the password) and
// again every few hours while it stays open. One tap picks; the pick lasts
// until you next arrive or leave, like any pick by hand (services/lifeMode.ts).

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Briefcase, Coffee, Home, MapPin } from 'lucide-react';
import { LifeMode, describeLifeMode, getLifeMode, lifeModeError, setLifeMode, useLifeMode } from '../../services/lifeMode';
import { useToast } from '../../context/ToastContext';

export const ASK_EVERY_MS = 3 * 60 * 60 * 1000;
const ASKED_KEY = 'sage-mode-asked-at';

const askedAt = (): number => {
  try { return Number(localStorage.getItem(ASKED_KEY)) || 0; } catch { return 0; }
};
export const markAsked = () => {
  try { localStorage.setItem(ASKED_KEY, String(Date.now())); } catch { /* storage unavailable */ }
};

export function ModePrompt() {
  const state = useLifeMode();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);

  // Due when it hasn't asked in the last few hours, on this device.
  const check = useCallback(() => {
    // Welcome home asks first (and covers it), so don't stack the two.
    if (getLifeMode().welcome) return;
    if (document.visibilityState === 'visible' && Date.now() - askedAt() >= ASK_EVERY_MS) setOpen(true);
  }, []);

  useEffect(() => {
    // A short pause so the Pi's answer (home or away) is in before asking.
    const first = setTimeout(check, 1200);
    const every = setInterval(check, 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { clearTimeout(first); clearInterval(every); document.removeEventListener('visibilitychange', check); };
  }, [check]);

  const pick = async (mode: LifeMode) => {
    markAsked();
    setOpen(false);
    if (mode === state.mode) return;
    try { await setLifeMode(mode); } catch (e) { showToast(lifeModeError(e), 'error'); }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const choice = e.key === 'Escape' ? state.mode : (e.key === 'w' || e.key === 'W') ? 'work' : (e.key === 'c' || e.key === 'C') ? 'chill' : null;
      if (!choice) return;
      e.preventDefault();
      e.stopPropagation(); // C is also New item
      pick(choice);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const options: { id: LifeMode; label: string; detail: string; icon: typeof Briefcase }[] = [
    { id: 'work', label: 'Work', detail: 'Everything', icon: Briefcase },
    { id: 'chill', label: 'Chill', detail: 'Personal only', icon: Coffee },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="mode-prompt" className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="mode-prompt-title"
            initial={{ y: 24, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="w-full max-w-sm surface-float rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
            <h2 id="mode-prompt-title" className="text-[19px] font-semibold tracking-tight text-gray-900 dark:text-white">Work or Chill?</h2>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-gray-500 dark:text-gray-400">
              {state.home ? <Home size={13} /> : <MapPin size={13} />} {describeLifeMode(state)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {options.map(o => {
                const current = state.mode === o.id;
                return (
                  <button key={o.id} onClick={() => pick(o.id)} autoFocus={current}
                    className={`flex flex-col items-start gap-1 p-4 rounded-2xl border text-left transition-all active:scale-[0.98] ${o.id === 'chill'
                      ? 'border-orange-200 dark:border-orange-900/60 bg-orange-50/80 dark:bg-orange-950/30 hover:bg-orange-100 dark:hover:bg-orange-950/50'
                      : 'border-blue-200 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50'} ${current ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#1c1c1e] ' + (o.id === 'chill' ? 'ring-orange-400' : 'ring-blue-400') : ''}`}>
                    <o.icon size={20} className={o.id === 'chill' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'} />
                    <span className="text-[16px] font-semibold text-gray-900 dark:text-white">{o.label}</span>
                    <span className="text-[12px] text-gray-500 dark:text-gray-400">{o.detail}{current ? ' · now' : ''}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11.5px] text-gray-400 text-center">Asks again in a few hours. Switch any time from the top bar, the sidebar or the M key.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
