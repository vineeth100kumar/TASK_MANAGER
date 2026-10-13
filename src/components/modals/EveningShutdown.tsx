import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon, Check, ArrowRight, Clock } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useCompletion } from '../../hooks/useCompletion';
import { useEscapeKey } from '../../hooks/useEscapeKey';

type Action = 'done' | 'tomorrow' | 'snooze' | null;

interface Props {
  onClose: () => void;
}

export function EveningShutdown({ onClose }: Props) {
  useEscapeKey(onClose);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const reload = useCallback(async () => {
    const summary = await api.attention.getTodayAttention();
    const open = (summary.dueToday || []).filter((i: WorkItem) => i.status !== 'done' && i.entityType !== 'event');
    setItems(open);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const { complete } = useCompletion(reload);

  const setAction = (id: string, action: Action) => {
    setActions(prev => ({ ...prev, [id]: action }));
  };

  const apply = useCallback(async () => {
    setSaving(true);
    try {
      for (const item of items) {
        const a = actions[item.id];
        if (a === 'done') {
          await complete(item);
        } else if (a === 'tomorrow') {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const ds = tomorrow.toISOString().slice(0, 10);
          await api.workItems.updateDetails(item.id, { dueDate: ds, snoozedUntil: null });
        } else if (a === 'snooze') {
          const until = new Date(Date.now() + 3600_000).toISOString();
          await api.snooze.snoozeItem(item.id, until);
        }
      }
      const acted = Object.values(actions).filter(Boolean).length;
      showToast(acted ? `${acted} item${acted > 1 ? 's' : ''} wrapped up` : 'All set for tomorrow');
      onClose();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }, [items, actions, complete, onClose, showToast]);

  const buttons: { action: Action; icon: React.ReactNode; label: string }[] = [
    { action: 'done', icon: <Check className="w-3.5 h-3.5" />, label: 'Done' },
    { action: 'tomorrow', icon: <ArrowRight className="w-3.5 h-3.5" />, label: 'Tomorrow' },
    { action: 'snooze', icon: <Clock className="w-3.5 h-3.5" />, label: 'Later' },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center scrim"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="w-full max-w-md mx-4 mb-4 sm:mb-0 bg-white dark:bg-[#1c1c1e] rounded-3xl shadow-[0_24px_64px_-16px_rgb(16_24_40/0.35)] dark:shadow-[0_24px_64px_-12px_rgb(0_0_0/0.8)] ring-1 ring-black/5 dark:ring-white/10 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-6 pt-6 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/40">
              <Moon className="w-6 h-6 text-indigo-500" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-white">Shutdown</h2>
              <p className="text-sm text-gray-500">Clear today's slate before tomorrow.</p>
            </div>
          </div>

          <div className="px-6 pb-2 max-h-[50vh] overflow-y-auto">
            {items.length === 0 && (
              <p className="text-sm text-gray-400 py-8 text-center">Everything's done — great day.</p>
            )}
            {items.map(item => {
              const chosen = actions[item.id];
              return (
                <div key={item.id} className="py-3 border-b border-gray-100 dark:border-white/5 last:border-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-2 truncate">{item.title}</p>
                  <div className="flex gap-2">
                    {buttons.map(b => (
                      <button
                        key={b.action}
                        onClick={() => setAction(item.id, chosen === b.action ? null : b.action)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          chosen === b.action
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/25'
                            : 'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                        }`}
                      >
                        {b.icon} {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 dark:border-white/5 flex items-center justify-between">
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Skip
            </button>
            <button
              onClick={apply}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/25 disabled:opacity-40 font-semibold transition-colors"
            >
              {saving ? 'Saving…' : items.length === 0 ? 'Done' : 'Wrap up'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
