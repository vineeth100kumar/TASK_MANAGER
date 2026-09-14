import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Sparkles, Flame } from 'lucide-react';
import { haptics } from '../../utils/haptics';

interface CelebrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  streakDays?: number;
}

export const CelebrationModal: React.FC<CelebrationModalProps> = ({
  isOpen,
  onClose,
  streakDays = 1
}) => {
  useEffect(() => {
    if (isOpen) {
      haptics.celebrate();
      const timer = setTimeout(() => {
        onClose();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="relative max-w-sm w-full clipping clipping-cream border-2 border-ink-base/30 dark:border-paper-light/25 rounded-none p-6 text-center shadow-2xl space-y-4 overflow-hidden"
        >
          {/* Scotch Tape Strip */}
          <div className="tape-strip top-[-8px] left-1/2 -translate-x-1/2 w-32 h-4 z-20 pointer-events-none" />

          {/* Stamp checkmark */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            className="w-16 h-16 rounded-full border-2 border-emerald-600 dark:border-emerald-400 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-md"
          >
            <CheckCircle2 className="w-9 h-9 stroke-[2.5]" />
          </motion.div>

          <div className="space-y-1.5">
            <span className="text-[9px] font-ledger font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
              SPECIAL BULLETIN • EXTRA! EXTRA!
            </span>
            <h3 className="text-2xl font-editorial font-bold text-ink-base dark:text-paper-light flex items-center justify-center gap-1.5">
              <span>All Clear for Today!</span>
              <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-pulse" />
            </h3>
            <p className="text-xs font-editorial italic text-ink-muted dark:text-stone-400 leading-relaxed">
              You completed all scheduled docket items. Take a breath and enjoy your evening.
            </p>
          </div>

          <div className="flex items-center justify-center space-x-2 px-4 py-2 rounded border border-amber-600/30 bg-paper-aged dark:bg-stone-800 max-w-[220px] mx-auto text-xs font-ledger font-bold text-amber-800 dark:text-amber-300">
            <Flame className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-bounce" />
            <span>{streakDays} DAY STREAK ACTIVE</span>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded bg-ink-base hover:bg-stone-800 text-paper-white dark:bg-paper-light dark:hover:bg-paper-aged dark:text-ink-base text-xs font-ledger font-bold uppercase tracking-wider shadow transition-all active:scale-95"
          >
            Acknowledge & Continue
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
