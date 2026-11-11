// WelcomeHome - shown the first time Sage is opened after you get home (the
// Pi saw your phone come back, raspberry_pi/life_mode.py). Once per arrival.
// The Pi has already set Chill; the buttons let you stay there or go to Work.

import { AnimatePresence, motion } from 'framer-motion';
import { Briefcase, Coffee, Home } from 'lucide-react';
import { LifeMode, lifeModeError, markWelcomed, setLifeMode, useLifeMode } from '../../services/lifeMode';
import { markAsked } from './ModePrompt';
import { useToast } from '../../context/ToastContext';

export function WelcomeHome() {
  const state = useLifeMode();
  const { showToast } = useToast();
  const open = !!state.welcome;

  const close = async (mode?: LifeMode) => {
    markAsked(); // this already answered "Work or Chill?"
    await markWelcomed();
    if (mode && mode !== state.mode) {
      try { await setLifeMode(mode); } catch (e) { showToast(lifeModeError(e), 'error'); }
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="welcome-home" className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="welcome-home-title"
            initial={{ y: 24, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="w-full max-w-sm surface-float rounded-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center">
              <Home size={24} className="text-orange-600 dark:text-orange-400" />
            </div>
            <h2 id="welcome-home-title" className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white">Welcome home</h2>
            <p className="mt-1 text-[13.5px] text-gray-500 dark:text-gray-400">
              Your phone is back, so Sage is in Chill: personal only. Work stays saved, one tap away.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button autoFocus onClick={() => close('chill')}
                className="flex items-center justify-center gap-2 p-3 rounded-2xl border border-orange-200 dark:border-orange-900/60 bg-orange-50/80 dark:bg-orange-950/30 text-[15px] font-semibold text-gray-900 dark:text-white active:scale-[0.98] transition-all">
                <Coffee size={17} className="text-orange-600 dark:text-orange-400" /> Stay Chill
              </button>
              <button onClick={() => close('work')}
                className="flex items-center justify-center gap-2 p-3 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/30 text-[15px] font-semibold text-gray-900 dark:text-white active:scale-[0.98] transition-all">
                <Briefcase size={17} className="text-blue-600 dark:text-blue-400" /> Work
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
