// HiddenWorkLine - In Chill mode, how many work tasks are out of sight, with
// one tap back to Work mode. Hidden is never deleted: the count keeps them in
// view so nothing waits unseen.

import { useCallback, useEffect, useState } from 'react';
import { Briefcase, ArrowRight } from 'lucide-react';
import { api } from '../../services/api';
import { setLifeMode, useLifeMode } from '../../services/lifeMode';
import { useDataChanges } from '../../hooks/useDataChanges';

export function HiddenWorkLine({ scope }: { scope: 'today' | 'open' }) {
  const { mode, held } = useLifeMode();
  const [counts, setCounts] = useState<{ today: number; open: number } | null>(null);
  const load = useCallback(() => { api.today.hiddenWork().then(setCounts).catch(() => {}); }, []);
  useEffect(() => { if (mode === 'chill') load(); }, [mode, load]);
  useDataChanges(() => { if (mode === 'chill') load(); });

  if (mode !== 'chill' || !counts) return null;
  const n = scope === 'today' ? counts.today : counts.open;
  if (n === 0 && !held) return null;

  return (
    <button onClick={() => setLifeMode('work').catch(() => {})}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-left text-[13px] bg-orange-50/70 dark:bg-orange-950/20 text-orange-800/90 dark:text-orange-200/90 ring-1 ring-orange-200/60 dark:ring-orange-900/40 hover:bg-orange-100/70 dark:hover:bg-orange-950/30 transition-colors">
      <Briefcase size={15} className="shrink-0 opacity-70" />
      <span className="flex-1 min-w-0">
        <span className="font-semibold">
          {n} work {n === 1 ? 'task' : 'tasks'}{scope === 'today' && <span className="hidden sm:inline"> for today</span>} hidden in Chill
        </span>
        {held > 0 && <span className="opacity-75"> · {held} {held === 1 ? 'reminder waits' : 'reminders wait'}</span>}
      </span>
      <span className="shrink-0 flex items-center gap-1 font-semibold">Show work <ArrowRight size={13} /></span>
    </button>
  );
}
