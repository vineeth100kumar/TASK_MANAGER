// ModeSwitch - Work or Chill, in the header on every screen size.
//
// Work shows everything; Chill shows only personal items (see
// services/lifeMode.ts). A small house marks a mode that came from the phone
// being home or away; a pick here lasts until you next arrive or leave.

import { motion } from 'framer-motion';
import { Briefcase, Coffee, Home } from 'lucide-react';
import { LifeMode, describeLifeMode, setLifeMode, useLifeMode } from '../../services/lifeMode';
import { useToast } from '../../context/ToastContext';

export function ModeSwitch() {
  const state = useLifeMode();
  const { showToast } = useToast();
  const fromPresence = state.source === 'presence';

  const pick = async (mode: LifeMode) => {
    if (mode === state.mode) return;
    try {
      await setLifeMode(mode);
      showToast(mode === 'chill' ? 'Chill mode: personal only. Work is hidden, not gone.' : 'Work mode: everything shows', 'info');
    } catch {
      showToast("Couldn't reach the Pi to change the mode", 'error');
    }
  };

  return (
    <div role="radiogroup" aria-label="Mode" title={describeLifeMode(state)}
      className="relative flex items-center shrink-0 bg-gray-100 dark:bg-white/5 p-0.5 rounded-xl">
      {(['work', 'chill'] as const).map(mode => {
        const active = state.mode === mode;
        const Icon = mode === 'work' ? Briefcase : Coffee;
        return (
          <button key={mode} role="radio" aria-checked={active} onClick={() => pick(mode)}
            className={`relative flex items-center gap-1.5 h-8 px-2.5 rounded-[10px] text-[12.5px] font-semibold transition-colors ${active ? (mode === 'chill' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white') : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
            {active && <motion.span layoutId="mode-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-[10px] bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 dark:ring-white/5" />}
            <Icon size={14} className="relative" />
            <span className="relative">{mode === 'work' ? 'Work' : 'Chill'}</span>
            {active && fromPresence && <Home size={10} className="relative -ml-0.5 opacity-60" aria-label="set by home or away" />}
          </button>
        );
      })}
    </div>
  );
}
