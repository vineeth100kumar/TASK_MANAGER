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
          className="relative max-w-sm w-full bg-surface border border-hairline dark:border-paper-light/25 rounded-control p-6 text-center shadow-lg space-y-4 overflow-hidden"
        >
          {/* Stamp checkmark */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            className="w-16 h-16 rounded-full border border-emerald-600 dark:border-emerald-400 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-md"
          >
            <CheckCircle2 className="w-9 h-9 stroke-[2.5]" />
          </motion.div>

          <div className="space-y-1.5">
            <span className="text-caption font-semibold text-amber-700 dark:text-amber-400">
              SPECIAL BULLETIN • EXTRA! EXTRA!
            </span>
            <h3 className="text-title font-semibold text-ink flex items-center justify-center gap-1.5">
              <span>All Clear for Today!</span>
              <Sparkles className="w-5 h-5 text-accent-500 animate-pulse" />
            </h3>
            <p className="text-meta italic text-ink-2 leading-relaxed">
              You completed all scheduled docket items. Take a breath and enjoy your evening.
            </p>
          </div>

          <div className="flex items-center justify-center space-x-2 px-4 py-2 rounded border border-amber-600/30 bg-sunken max-w-[220px] mx-auto text-meta font-semibold text-amber-800 dark:text-amber-300">
            <Flame className="w-4 h-4 text-accent-500 animate-bounce" />
            <span>{streakDays} DAY STREAK ACTIVE</span>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded bg-ink-base hover:bg-sunken text-paper-white dark:bg-surface dark:hover:bg-sunken dark:text-ink-base text-meta font-semibold shadow transition-all active:scale-95"
          >
            Acknowledge & Continue
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
