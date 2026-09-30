import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Target, Check, ArrowUp, ArrowDown, Sparkles, X, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem, LifeContext } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { SnoozeMenu } from '../common/SnoozeMenu';
import { formatDateRange } from '../../utils/dateUtils';

interface FocusViewProps {
  lifeContext: LifeContext;
  onSelectTask: (id: string) => void;
}

export function FocusView({ lifeContext, onSelectTask }: FocusViewProps) {
  const [focusItems, setFocusItems] = useState<WorkItem[]>([]);
  const { showToast } = useToast();

  const loadFocus = async () => {
    try {
      const items = await api.focus.list(lifeContext);
      setFocusItems(items);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadFocus();
  }, [lifeContext]);
  useDataChanges(loadFocus);

  const handleComplete = async (item: WorkItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.workItems.transitionStatus(item.id, 'done', item.version);
      showToast('Completed');
      loadFocus();
    } catch (err) {
      console.error(err);
    }
  };

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
            {focusItems.length} of 5 focus slots active
          </h2>
          <p className="text-[13.5px] text-gray-500 dark:text-gray-400 mt-1.5">
            Your small, intentional working set. Avoid multitasking by finishing what is here first.
          </p>
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
      {focusItems.length === 0 ? (
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
        <div className="space-y-3 stagger">
          {focusItems.map((item, index) => (
            <motion.div
              key={item.id}
              layout
              className="p-4 md:p-5 rounded-2xl surface-item is-interactive hover:!border-amber-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 group"
            >
              <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                <span className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-semibold text-xs flex items-center justify-center shrink-0">
                  {index + 1}
                </span>

                <button 
                  onClick={(e) => handleComplete(item, e)} 
                  className="check-ring !w-[22px] !h-[22px]"
                  aria-label="Complete"
                >
                  <Check size={13} strokeWidth={3} />
                </button>

                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectTask(item.id)}>
                  <h4 className="font-semibold text-[15px] tracking-[-0.01em] text-gray-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-snug">
                    {item.title}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[12px] text-gray-400 whitespace-nowrap">
                    <span className="uppercase font-semibold text-[11px] tracking-wide text-gray-400">{item.key}</span>
                    {item.dueDate && <span className={`font-semibold ${formatDateRange(null, item.dueDate)?.startsWith('Overdue') ? 'text-red-500' : 'text-blue-500'}`}>· {formatDateRange(null, item.dueDate)}</span>}
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
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
