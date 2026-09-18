import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Trash2, Calendar, Flag, X } from 'lucide-react';
import { TaskPriority } from '../../types';
import { haptics } from '../../utils/haptics';

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkComplete: () => void;
  onBulkDelete: () => void;
  onBulkPriority: (priority: TaskPriority) => void;
  onBulkReschedule: (dateStr: string) => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  onClearSelection,
  onBulkComplete,
  onBulkDelete,
  onBulkPriority,
  onBulkReschedule
}) => {
  const [showPriorityPicker, setShowPriorityPicker] = React.useState(false);
  const [showDatePicker, setShowDatePicker] = React.useState(false);

  if (selectedCount === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30 }}
        transition={{ duration: 0.15 }}
        className="fixed bottom-16 md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-xl bg-surface border border-stone-300 dark:border-stone-700 rounded-control p-2.5 shadow-lg flex items-center justify-between gap-2 text-meta relative"
        style={{ bottom: 'calc(var(--keyboard-offset, 0px) + 4.5rem)' }}
      >
        <div className="flex items-center space-x-2.5 pl-2">
          <span className="w-6 h-6 rounded-control bg-amber-600 text-stone-950 font-bold flex items-center justify-center text-meta">
            {selectedCount}
          </span>
          <span className="text-stone-700 dark:text-stone-300 hidden xs:inline font-bold">Selected</span>
        </div>

        <div className="flex items-center space-x-1.5 relative">
          {/* Complete */}
          <button
            onClick={() => {
              haptics.medium();
              onBulkComplete();
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-control bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 text-meta transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Done</span>
          </button>

          {/* Priority Menu */}
          <div className="relative">
            <button
              onClick={() => setShowPriorityPicker(!showPriorityPicker)}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-control bg-paper-aged dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700 text-meta transition-colors"
            >
              <Flag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Priority</span>
            </button>

            {showPriorityPicker && (
              <div className="absolute bottom-full mb-2 left-0 w-28 rounded-control bg-surface border border-stone-300 dark:border-stone-700 shadow-xl p-1 space-y-0.5 z-50">
                {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      onBulkPriority(p);
                      setShowPriorityPicker(false);
                    }}
                    className="w-full text-left px-2 py-1 rounded-control text-caption font-bold hover:bg-black/5 dark:hover:bg-stone-800 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reschedule Menu */}
          <div className="relative">
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-control bg-paper-aged dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700 text-meta transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Schedule</span>
            </button>

            {showDatePicker && (
              <div className="absolute bottom-full mb-2 left-0 w-32 rounded-control bg-surface border border-stone-300 dark:border-stone-700 shadow-xl p-1 space-y-0.5 z-50">
                <button
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    onBulkReschedule(today);
                    setShowDatePicker(false);
                  }}
                  className="w-full text-left px-2 py-1 rounded-control text-meta hover:bg-black/5 dark:hover:bg-stone-800 transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    onBulkReschedule(d.toISOString().slice(0, 10));
                    setShowDatePicker(false);
                  }}
                  className="w-full text-left px-2 py-1 rounded-control text-meta hover:bg-black/5 dark:hover:bg-stone-800 transition-colors"
                >
                  Tomorrow
                </button>
              </div>
            )}
          </div>

          {/* Delete */}
          <button
            onClick={() => {
              haptics.warning();
              onBulkDelete();
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-control bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 text-meta transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </button>

          {/* Cancel */}
          <button
            onClick={onClearSelection}
            className="p-1.5 rounded-control text-ink-3 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
