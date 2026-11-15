// LeaveRoomButton - "I'm leaving the room", in the header beside the mode
// switch on every screen size.
//
// One tap tells the Pi you've gone, so Herald says its goodbye right away
// instead of waiting for Bluetooth to drop (which can be slow or miss). It
// also flips to Work. A short "See you" state confirms the tap, then it
// settles back. Only shown when a Pi is linked (where Herald lives).

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DoorOpen, Check } from 'lucide-react';
import { leaveRoom, lifeModeError, useLifeMode } from '../../services/lifeMode';
import { useToast } from '../../context/ToastContext';

export function LeaveRoomButton() {
  const state = useLifeMode();
  const { showToast } = useToast();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // No Pi, no Herald: nothing to say goodbye with.
  if (state.source === 'local') return null;

  const leave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await leaveRoom();
      setDone(true);
      window.setTimeout(() => setDone(false), 2200);
    } catch (e) {
      showToast(lifeModeError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={leave}
      disabled={busy}
      aria-label="Leaving the room"
      title="Leaving the room — Herald says goodbye now"
      className={`relative flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-[12.5px] font-semibold shrink-0 transition-colors active:scale-[0.97] disabled:opacity-70 ${
        done
          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
          : 'text-gray-500 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-white/5 hover:bg-gray-200/70 dark:hover:bg-white/10'
      }`}>
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span key="done" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }} className="flex items-center gap-1.5">
            <Check size={14} className="relative" />
            <span className="relative hidden sm:inline">See you</span>
          </motion.span>
        ) : (
          <motion.span key="leave" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }} className="flex items-center gap-1.5">
            <DoorOpen size={14} className="relative" />
            <span className="relative hidden sm:inline">Leave</span>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
