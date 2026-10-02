import React, { useState, useEffect } from 'react';
import { withTime } from '../../utils/reminders';
import { AnimatePresence } from 'framer-motion';
import { Target, ArrowUp, ArrowDown, Sparkles, X, Plus, Trophy } from 'lucide-react';
import { api } from '../../services/api';
import { FOCUS_LIMIT } from '../../services/constants';
import { WorkItem, LifeContext } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { SnoozeMenu } from '../common/SnoozeMenu';
import { formatDateRange } from '../../utils/dateUtils';
import { countDoneToday } from '../../utils/progress';
import { useCompletion } from '../../hooks/useCompletion';
import { CompleteButton } from '../common/CompleteButton';
import { Celebrate } from '../common/Celebrate';
import { Fold } from '../common/Fold';
import { ContextTag } from '../common/ContextTag';

const FOCUS_SLOTS = FOCUS_LIMIT;

interface FocusViewProps {
  lifeContext?: LifeContext;
  onSelectTask: (id: string) => void;
}

export function FocusView({ lifeContext, onSelectTask }: FocusViewProps) {
  const [focusItems, setFocusItems] = useState<WorkItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [doneToday, setDoneToday] = useState(0);
  const { showToast } = useToast();

  const loadFocus = async () => {
    try {
      const items = await api.focus.list(lifeContext);
      setFocusItems(items);
      setDoneToday(countDoneToday(lifeContext));
      setLoaded(true);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadFocus();
  }, [lifeContext]);
  useDataChanges(loadFocus);

  const { complete, isCompleting, isSaving } = useCompletion(loadFocus);

  const handleRemoveFocus = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.focus.toggle(itemId);
      showToast('Removed from Focus');
      loadFocus();
    } catch (err) {
      console.error(err);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newItems = [...focusItems];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    const temp = newItems[index];
    newItems[index] = newItems[targetIndex];
    newItems[targetIndex] = temp;

    setFocusItems(newItems);
    await api.focus.reorder(newItems.map(i => i.id));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 font-sans">
      {/* Focus Header */}
      <div className="hero hero-focus p-5 md:p-8 rounded-3xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="eyebrow text-amber-600 dark:text-amber-400 mb-2">
            <Target size={18} />
            <span>Active Focus Queue</span>
          </div>
          <h2 className="text-display text-[26px] md:text-[32px] font-semibold leading-tight">
            {focusItems.length === 0 ? (doneToday > 0 ? 'Focus cleared' : 'Nothing in focus') : focusItems.length === 1 ? 'One thing to finish' : `${focusItems.length} things to finish`}
          </h2>
          <p className="text-[13.5px] text-gray-500 dark:text-gray-400 mt-1.5">
            {focusItems.length === 0 && doneToday > 0 ? `${doneToday} done today. Nice work.` : `${doneToday > 0 ? `${doneToday} done today. ` : ''}A small working set. Finish what's here before adding more.`}
          </p>
          {/* The slot limit, shown rather than told. */}
          <div className="flex items-center gap-1.5 mt-3" aria-label={`${focusItems.length} of ${FOCUS_SLOTS} focus slots used`}>
            {Array.from({ length: FOCUS_SLOTS }, (_, i) => (
              <span key={i} className={`h-1.5 w-6 rounded-full transition-colors duration-300 ${i < focusItems.length ? 'bg-amber-500' : 'bg-black/[0.08] dark:bg-white/[0.1]'}`} />
            ))}
          </div>
        </div>

        <button 
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: 'n' });
            window.dispatchEvent(event);
          }}
          className="px-4 py-2.5 bg-gradient-to-b from-amber-400 to-amber-500 hover:to-amber-600 text-white font-semibold text-[12.5px] rounded-xl shadow-sm shadow-amber-600/25 ring-1 ring-inset ring-white/20 hidden md:flex items-center gap-2 active:scale-[0.97] transition-all"
        >
          <Plus size={14} /> Add Item (N)
        </button>
      </div>

      {/* Focus Items */}
      {!loaded ? null : focusItems.length === 0 && doneToday > 0 ? (
        <div className="text-center py-16 surface rounded-3xl border border-black/5 dark:border-white/5 flex flex-col items-center gap-3">
          <Celebrate distance={40}>
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 flex items-center justify-center ring-8 ring-emerald-500/[0.06]">
              <Trophy size={26} />
            </div>
          </Celebrate>
          <h3 className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-white mt-2">Everything in Focus is done</h3>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            You finished {doneToday} {doneToday === 1 ? 'thing' : 'things'} today. Take the win, or pick the next one from your Inbox or Today.
          </p>
        </div>
      ) : focusItems.length === 0 ? (
        <div className="text-center py-20 surface rounded-3xl border border-black/5 dark:border-white/5 space-y-3 stagger">
          <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-500 mx-auto flex items-center justify-center">
            <Sparkles size={24} />
          </div>
          <h3 className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-white">No items in Focus</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Choose 3 to 5 things from your Inbox, Today view, or Projects to focus on right now.
          </p>
        </div>
      ) : (
        <div className="stagger -mb-3">
          <AnimatePresence initial={false}>
          {focusItems.map((item, index) => (
            <Fold key={item.id} gap={12}>
            <div
              className={`p-4 md:p-5 rounded-2xl surface-item is-interactive hover:!border-amber-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 group ${index === 0 ? 'ring-1 ring-amber-400/30 dark:ring-amber-400/20' : ''} ${isCompleting(item.id) ? 'is-completing' : ''}`}
            >
              <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                <span className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-semibold text-xs flex items-center justify-center shrink-0">
                  {index + 1}
                </span>

                <CompleteButton size="lg" checked={isCompleting(item.id)} saving={isSaving(item.id)} onComplete={() => complete(item)} />

                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectTask(item.id)}>
                  {index === 0 && <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-0.5">Up next</span>}
                  <h4 className="row-title inline font-semibold text-[15px] tracking-[-0.01em] text-gray-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-snug">
                    {item.title}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[12px] text-gray-400 whitespace-nowrap">
                    <ContextTag item={item} combined={!lifeContext} />
                    <span className="uppercase font-semibold text-[11px] tracking-wide text-gray-400">{item.key}</span>
                    {item.dueDate && <span className={`font-semibold ${formatDateRange(null, item.dueDate)?.startsWith('Overdue') ? 'text-red-500' : 'text-blue-500'}`}>· {withTime(formatDateRange(null, item.dueDate), item.dueTime)}</span>}
                    {item.project && <span>· {item.project.name}</span>}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1 shrink-0 self-end sm:self-center -mr-1.5 sm:mr-0">
                <button 
                  disabled={index === 0}
                  onClick={() => handleMove(index, 'up')} 
                  className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                  title="Move Up"
                >
                  <ArrowUp size={14} />
                </button>
                <button 
                  disabled={index === focusItems.length - 1}
                  onClick={() => handleMove(index, 'down')} 
                  className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                  title="Move Down"
                >
                  <ArrowDown size={14} />
                </button>

                <SnoozeMenu itemId={item.id} onSnoozed={() => loadFocus()} />

                <button 
                  onClick={(e) => handleRemoveFocus(item.id, e)}
                  className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  title="Remove from Focus"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            </Fold>
          ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
