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
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="relative max-w-sm w-full bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 border border-emerald-500/40 rounded-3xl p-6 text-center shadow-2xl space-y-4 overflow-hidden"
        >
          {/* Glowing ripple background */}
          <div className="absolute -top-16 -left-16 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -right-16 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Bouncing checkmark */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20"
          >
            <CheckCircle2 className="w-9 h-9" />
          </motion.div>

          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white flex items-center justify-center gap-1.5">
              <span>All Clear for Today!</span>
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            </h3>
            <p className="text-xs text-zinc-400">
              You crushed all your scheduled tasks. Take a breath and enjoy your evening.
            </p>
          </div>

          <div className="flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-zinc-800/80 border border-zinc-700/60 max-w-[200px] mx-auto text-xs font-semibold text-amber-300">
            <Flame className="w-4 h-4 text-amber-500 animate-bounce" />
            <span>{streakDays} Day Streak Active!</span>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
          >
            Awesome, Continue
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
