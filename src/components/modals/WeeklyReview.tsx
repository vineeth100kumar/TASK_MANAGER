import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CalendarCheck, Star, Check, ArrowRight } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useCompletion } from '../../hooks/useCompletion';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { getTodayString } from '../../utils/dateUtils';
import { isOverdue, isSnoozedNow } from '../../utils/taskLists';

interface Props {
  onClose: () => void;
  onNavigateView?: (view: string) => void;
}

// Sunday review in five short steps. A step with nothing in it is skipped.
type Step = 'wins' | 'inbox' | 'late' | 'stuck' | 'stars';

const STEP_TITLE: Record<Step, string> = {
  wins: 'This week you finished',
  inbox: 'Sort what came in',
  late: 'Past its date',
  stuck: 'Stuck',
  stars: 'Star a few for next week',
};

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };

export function WeeklyReview({ onClose, onNavigateView }: Props) {
  useEscapeKey(onClose);
  const { showToast } = useToast();
  const [data, setData] = useState<{ wins: WorkItem[]; inbox: WorkItem[]; late: WorkItem[]; stuck: WorkItem[]; open: WorkItem[] } | null>(null);
  const [at, setAt] = useState(0);

  const load = useCallback(async () => {
    const [all, inbox] = await Promise.all([api.inbox.all(), api.inbox.list()]);
    const today = getTodayString();
    const weekAgo = daysAgo(7);
    const open = all.items;
    setData({
      wins: all.done.filter(i => (i.completedAt || '') >= weekAgo && i.entityType !== 'milestone'),
      inbox,
      late: open.filter(i => isOverdue(i, today)),
      stuck: open.filter(i => !isOverdue(i, today) && (i.status === 'blocked' || (i.snoozeCount || 0) >= 2 || (isSnoozedNow(i) && !!i.waitingFor?.who))),
      open: open.filter(i => !isOverdue(i, today)),
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  const { complete } = useCompletion(load);

  if (!data) return null;
  const steps = (['wins', 'inbox', 'late', 'stuck', 'stars'] as Step[]).filter(s => s === 'stars' ? data.open.length > 0 : data[s].length > 0);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;

  const nextWeek = async (item: WorkItem) => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    await api.workItems.updateDetails(item.id, { dueDate: d.toISOString().slice(0, 10), snoozedUntil: null });
    load();
  };
  const star = async (item: WorkItem) => {
    try { await api.focus.toggle(item.id); load(); } catch (e: any) { showToast(e.message || 'Could not star', 'error'); }
  };

  const row = (item: WorkItem, actions: React.ReactNode) => (
    <div key={item.id} className="py-2.5 flex items-center gap-3 border-b border-gray-100 dark:border-white/5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.title || 'Untitled'}</p>
        {(item.project?.name || item.area?.name) && <p className="text-[11.5px] text-gray-400 truncate">{item.project?.name || item.area?.name}</p>}
      </div>
      {actions}
    </div>
  );
  const btn = 'shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center scrim" onClick={onClose}>
      <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="w-full max-w-md mx-4 mb-4 sm:mb-0 bg-white dark:bg-[#1c1c1e] rounded-3xl shadow-[0_24px_64px_-16px_rgb(16_24_40/0.35)] ring-1 ring-black/5 dark:ring-white/10 overflow-hidden"
        onClick={e => e.stopPropagation()} role="dialog" aria-label="Weekly review">
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-400">
            <CalendarCheck size={14} /> Weekly review
            {steps.length > 1 && <span className="ml-auto tabular-nums">{Math.min(at, steps.length - 1) + 1} of {steps.length}</span>}
          </div>
          <h2 className="text-[19px] font-semibold tracking-tight text-gray-900 dark:text-white mt-1">
            {step ? STEP_TITLE[step] : 'All clear'}
            {step === 'wins' && <span className="text-gray-400 font-normal"> · {data.wins.length}</span>}
          </h2>
        </div>

        <div className="px-6 pb-2 max-h-[50vh] overflow-y-auto">
          {!step && <p className="text-sm text-gray-400 py-8 text-center">Nothing to review. Enjoy your Sunday.</p>}
          {step === 'wins' && data.wins.slice(0, 30).map(i => row(i, <Check size={15} className="text-emerald-500 shrink-0" />))}
          {step === 'inbox' && (
            <div className="py-4 text-sm text-gray-600 dark:text-gray-300">
              {data.inbox.length} new {data.inbox.length === 1 ? 'item needs' : 'items need'} a home.
              {onNavigateView && <button className="ml-2 text-blue-600 dark:text-blue-400 font-semibold" onClick={() => { onNavigateView('inbox'); onClose(); }}>Open Inbox</button>}
            </div>
          )}
          {(step === 'late' || step === 'stuck') && data[step].map(i => row(i, <>
            <button className={btn} onClick={() => complete(i)}><Check size={13} /> Done</button>
            <button className={btn} onClick={() => nextWeek(i)}><ArrowRight size={13} /> Next week</button>
          </>))}
          {step === 'stars' && data.open.slice(0, 25).map(i => row(i,
            <button className={`${btn} ${i.isFocus ? '!text-amber-500' : ''}`} onClick={() => star(i)} aria-pressed={!!i.isFocus}>
              <Star size={13} className={i.isFocus ? 'fill-current' : ''} /> {i.isFocus ? 'Starred' : 'Star'}
            </button>))}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/5 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Close</button>
          <button onClick={() => (last || !step) ? onClose() : setAt(a => a + 1)}
            className="px-4 py-2 rounded-xl text-sm bg-blue-600 text-white hover:bg-blue-700 font-semibold">
            {(last || !step) ? 'Finish' : 'Next'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
