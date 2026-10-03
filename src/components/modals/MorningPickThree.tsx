import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Star, Check, ChevronRight } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem } from '../../services/types';
import { FOCUS_LIMIT } from '../../services/constants';
import { useToast } from '../../context/ToastContext';

interface Props {
  onClose: () => void;
  onNavigateView?: (view: string) => void;
}

export function MorningPickThree({ onClose, onNavigateView }: Props) {
  const [candidates, setCandidates] = useState<WorkItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    (async () => {
      const summary = await api.attention.getTodayAttention();
      const items: WorkItem[] = [
        ...(summary.todayFocus || []),
        ...(summary.dueToday || []),
        ...(summary.needsAttention || []),
        ...(summary.quickWins || []),
      ];
      const seen = new Set<string>();
      const unique = items.filter(i => {
        if (seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      });
      setCandidates(unique);
      const alreadyFocused = new Set(unique.filter(i => i.isFocus).map(i => i.id));
      setPicked(alreadyFocused);
    })();
  }, []);

  const toggle = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else if (next.size < FOCUS_LIMIT) { next.add(id); }
      return next;
    });
  };

  const confirm = useCallback(async () => {
    setSaving(true);
    try {
      for (const id of picked) {
        const item = candidates.find(i => i.id === id);
        if (item && !item.isFocus) {
          await api.focus.toggle(id);
          if (item.isInbox) await api.inbox.clarify(id, {});
        }
      }
      showToast(picked.size === 1 ? '1 task in Focus' : `${picked.size} tasks in Focus`);
      onClose();
      onNavigateView?.('focus');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }, [picked, candidates, onClose, onNavigateView, showToast]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="w-full max-w-md mx-4 mb-4 sm:mb-0 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-6 pt-6 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/40">
              <Sun className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Pick your 3</h2>
              <p className="text-sm text-zinc-500">What matters most today?</p>
            </div>
          </div>

          <div className="px-6 pb-2 max-h-[50vh] overflow-y-auto">
            {candidates.length === 0 && (
              <p className="text-sm text-zinc-400 py-8 text-center">Nothing due today — enjoy the space.</p>
            )}
            {candidates.map(item => {
              const selected = picked.has(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl mb-1 text-left transition-colors ${
                    selected
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-300 dark:ring-indigo-700'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-zinc-300 dark:border-zinc-600'
                  }`}>
                    {selected && <Check className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{item.title}</p>
                    {item.dueDate && (
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {item.dueTime ? `${item.dueDate} ${item.dueTime}` : item.dueDate}
                      </p>
                    )}
                  </div>
                  {item.isFocus && <Star className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
              Skip
            </button>
            <button
              onClick={confirm}
              disabled={saving || picked.size === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : `Focus on ${picked.size}`}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
