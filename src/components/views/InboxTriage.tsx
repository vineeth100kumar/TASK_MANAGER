import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Target, CalendarDays, Hourglass, Trash2, Check, SkipForward, PartyPopper } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { formatDateRange, getTodayString } from '../../utils/dateUtils';

interface InboxTriageProps {
  items: WorkItem[];
  onClose: () => void;
  onChanged: () => void;
}

type Step = 'choose' | 'schedule' | 'delegate';

const isoDate = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const nextMonday = () => {
  const d = new Date();
  const add = ((8 - d.getDay()) % 7) || 7;
  return isoDate(add);
};

const ACTIONS = [
  { id: 'focus', key: 'F', label: 'Focus', icon: Target, tone: 'text-amber-600 dark:text-amber-400' },
  { id: 'schedule', key: 'S', label: 'Schedule', icon: CalendarDays, tone: 'text-blue-600 dark:text-blue-400' },
  { id: 'delegate', key: 'W', label: 'Delegate', icon: Hourglass, tone: 'text-purple-600 dark:text-purple-400' },
  { id: 'done', key: 'Enter', label: 'Done', icon: Check, tone: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'delete', key: 'X', label: 'Delete', icon: Trash2, tone: 'text-red-600 dark:text-red-400' },
  { id: 'skip', key: 'Space', label: 'Keep', icon: SkipForward, tone: 'text-gray-500 dark:text-gray-400' },
] as const;

// Walks through inbox items one at a time. Each choice clears the item out of the
// inbox (except Keep) and moves on to the next.
export function InboxTriage({ items, onClose, onChanged }: InboxTriageProps) {
  const [queue] = useState(items);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(0);
  const [customDate, setCustomDate] = useState('');
  const [who, setWho] = useState('');
  const [followUp, setFollowUp] = useState(isoDate(3));
  const { showToast } = useToast();

  const item = queue[index];
  const finished = index >= queue.length;

  const advance = (didClear: boolean) => {
    if (didClear) setCleared(c => c + 1);
    setStep('choose');
    setCustomDate('');
    setWho('');
    setFollowUp(isoDate(3));
    setIndex(i => i + 1);
    onChanged();
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (busy || !item) return;
    setBusy(true);
    try {
      await fn();
      advance(true);
    } catch (e: any) {
      showToast(`${label} failed: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doFocus = () => run('Focus', async () => {
    if (!item.isFocus) await api.focus.toggle(item.id);
    await api.inbox.clarify(item.id, {});
  });
  const doSchedule = (date: string) => run('Schedule', () => api.inbox.clarify(item.id, { dueDate: date }));
  const doDelegate = () => {
    if (!who.trim()) return;
    run('Delegate', async () => {
      await api.waitingFor.set(item.id, { who: who.trim(), followUpDate: followUp });
      await api.inbox.clarify(item.id, {});
    });
  };
  const doDone = () => run('Complete', () => api.workItems.transitionStatus(item.id, 'done', item.version));
  const doDelete = () => run('Delete', () => api.workItems.softDelete(item.id));
  const doSkip = () => { if (!busy) advance(false); };

  const choose = (id: string) => {
    if (id === 'focus') doFocus();
    else if (id === 'schedule') setStep('schedule');
    else if (id === 'delegate') setStep('delegate');
    else if (id === 'done') doDone();
    else if (id === 'delete') doDelete();
    else if (id === 'skip') doSkip();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (step !== 'choose' && !finished) setStep('choose');
        else onClose();
        return;
      }
      if (typing) return;
      // Keep the app's global shortcuts (N, C, /) from firing underneath.
      e.stopImmediatePropagation();
      if (finished) {
        if (e.key === 'Enter') { e.preventDefault(); onClose(); }
        return;
      }
      if (step === 'schedule') {
        const map: Record<string, string> = { '1': getTodayString(), '2': isoDate(1), '3': nextMonday() };
        if (map[e.key]) { e.preventDefault(); doSchedule(map[e.key]); }
        return;
      }
      if (step !== 'choose') return;
      const k = e.key.toLowerCase();
      if (k === 'f') choose('focus');
      else if (k === 's') choose('schedule');
      else if (k === 'w') choose('delegate');
      else if (e.key === 'Enter') choose('done');
      else if (k === 'x' || e.key === 'Backspace' || e.key === 'Delete') choose('delete');
      else if (e.key === ' ' || e.key === 'ArrowRight') choose('skip');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const progress = queue.length ? Math.min(index, queue.length) / queue.length : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 scrim" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
        className="relative z-10 w-full sm:max-w-xl bg-white dark:bg-[#1c1c1e] rounded-t-3xl sm:rounded-3xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden pb-[env(safe-area-inset-bottom)]"
        role="dialog" aria-label="Process inbox"
      >
        <div className="h-1 bg-gray-100 dark:bg-white/5">
          <motion.div className="h-full bg-blue-600" animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.25 }} />
        </div>

        <div className="flex items-center justify-between px-6 pt-4">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 tabular-nums">
            {finished ? 'Inbox processed' : `Item ${index + 1} of ${queue.length}`}
          </span>
          <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-white/10 transition-colors" aria-label="Close"><X size={18} /></button>
        </div>

        <AnimatePresence mode="wait">
          {finished ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="px-6 pt-6 pb-8 text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <PartyPopper size={26} />
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                {cleared === queue.length ? 'Inbox zero' : `${cleared} of ${queue.length} cleared`}
              </h3>
              <p className="text-[14px] text-gray-500">
                {cleared === queue.length ? 'Everything has a place now.' : 'The items you kept are still in your inbox.'}
              </p>
              <button onClick={onClose} className="mt-2 px-5 py-2 rounded-xl text-[14px] font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors">Back to Inbox</button>
            </motion.div>
          ) : (
            <motion.div key={item.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.18 }} className="px-6 pt-3 pb-6">
              <h3 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white leading-snug break-words">{item.title}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-gray-400">
                <span>Captured {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                {item.dueDate && <span>· {formatDateRange(null, item.dueDate)}</span>}
                {item.isFocus && <span className="text-amber-500">· In Focus</span>}
              </div>
              {item.description && <p className="mt-3 text-[14px] text-gray-600 dark:text-gray-300 line-clamp-3">{item.description}</p>}

              {step === 'choose' && (
                <div className="mt-6 grid grid-cols-3 gap-2">
                  {ACTIONS.map(a => (
                    <button key={a.id} onClick={() => choose(a.id)} disabled={busy}
                      className="group flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-gray-50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/5 hover:bg-white dark:hover:bg-white/10 hover:shadow-sm transition-all active:scale-[0.97] disabled:opacity-50">
                      <a.icon size={20} className={a.tone} />
                      <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">{a.label}</span>
                      <kbd className="kbd hidden sm:inline-flex">{a.key}</kbd>
                    </button>
                  ))}
                </div>
              )}

              {step === 'schedule' && (
                <div className="mt-6 space-y-3">
                  <p className="field-label">When is it due?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { k: '1', label: 'Today', date: getTodayString() },
                      { k: '2', label: 'Tomorrow', date: isoDate(1) },
                      { k: '3', label: 'Next week', date: nextMonday() },
                    ].map(o => (
                      <button key={o.k} onClick={() => doSchedule(o.date)} disabled={busy}
                        className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-gray-50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/5 hover:bg-white dark:hover:bg-white/10 transition-all text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                        {o.label}
                        <kbd className="kbd hidden sm:inline-flex">{o.k}</kbd>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="date" className="field" value={customDate} onChange={e => setCustomDate(e.target.value)} aria-label="Pick a date" />
                    <button onClick={() => customDate && doSchedule(customDate)} disabled={!customDate || busy}
                      className="px-4 rounded-xl text-[14px] font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors">Set</button>
                  </div>
                  <button onClick={() => setStep('choose')} className="text-[13px] font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">← Back</button>
                </div>
              )}

              {step === 'delegate' && (
                <form className="mt-6 space-y-3" onSubmit={e => { e.preventDefault(); doDelegate(); }}>
                  <div className="space-y-1.5">
                    <label className="field-label" htmlFor="triage-who">Waiting on</label>
                    <input id="triage-who" autoFocus className="field" placeholder="Who is handling it?" value={who} onChange={e => setWho(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="field-label" htmlFor="triage-follow">Follow up on</label>
                    <input id="triage-follow" type="date" className="field" value={followUp} onChange={e => setFollowUp(e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button type="button" onClick={() => setStep('choose')} className="text-[13px] font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">← Back</button>
                    <button type="submit" disabled={!who.trim() || busy} className="px-5 py-2 rounded-xl text-[14px] font-semibold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition-colors">Delegate</button>
                  </div>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
