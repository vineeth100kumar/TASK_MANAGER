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
        className="fixed bottom-16 md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-xl bg-zinc-900/95 border border-zinc-700/80 rounded-2xl p-2.5 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-2 text-xs"
        style={{ bottom: 'calc(var(--keyboard-offset, 0px) + 4.5rem)' }}
      >
        <div className="flex items-center space-x-2.5 pl-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[11px]">
            {selectedCount}
          </span>
          <span className="font-semibold text-zinc-200 hidden xs:inline">Selected</span>
        </div>

        <div className="flex items-center space-x-1.5 relative">
          {/* Complete */}
          <button
            onClick={() => {
              haptics.medium();
              onBulkComplete();
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-medium transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Done</span>
          </button>

          {/* Priority Menu */}
          <div className="relative">
            <button
              onClick={() => setShowPriorityPicker(!showPriorityPicker)}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
            >
              <Flag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Priority</span>
            </button>

            {showPriorityPicker && (
              <div className="absolute bottom-full mb-2 left-0 w-28 rounded-xl bg-zinc-900 border border-zinc-700 shadow-xl p-1 space-y-0.5">
                {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      onBulkPriority(p);
                      setShowPriorityPicker(false);
                    }}
                    className="w-full text-left px-2 py-1 rounded-lg uppercase text-[10px] font-bold hover:bg-zinc-800 transition-colors"
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
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Schedule</span>
            </button>

            {showDatePicker && (
              <div className="absolute bottom-full mb-2 left-0 w-32 rounded-xl bg-zinc-900 border border-zinc-700 shadow-xl p-1 space-y-0.5">
                <button
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    onBulkReschedule(today);
                    setShowDatePicker(false);
                  }}
                  className="w-full text-left px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
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
                  className="w-full text-left px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
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
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </button>

          {/* Cancel */}
          <button
            onClick={onClearSelection}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
