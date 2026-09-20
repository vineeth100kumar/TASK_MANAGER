import React, { useRef, useEffect } from 'react';
import { Calendar, Sun, Coffee, Briefcase, X, CalendarCheck } from 'lucide-react';
import { getTodayDateString, getTomorrowDateString, getThisWeekend, getNextMonday } from '../../utils/dateHelpers';

interface ReschedulePopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDate: (dateStr: string | null) => void;
  currentDueDate?: string | null;
}

export const ReschedulePopover: React.FC<ReschedulePopoverProps> = ({
  isOpen,
  onClose,
  onSelectDate,
  currentDueDate
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const today = getTodayDateString();
  const tomorrow = getTomorrowDateString();
  const weekend = getThisWeekend();
  const nextMonday = getNextMonday();

  const options = [
    { label: 'Today', date: today, icon: <Calendar className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />, sub: 'Today' },
    { label: 'Tomorrow', date: tomorrow, icon: <Sun className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />, sub: 'Next Day' },
    { label: 'This Weekend', date: weekend, icon: <Coffee className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />, sub: 'Saturday' },
    { label: 'Next Week', date: nextMonday, icon: <Briefcase className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />, sub: 'Monday' }
  ];

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 w-56 rounded-control bg-paper-white dark:bg-sunken border border-ink-base/25 dark:border-paper-light/20 shadow-lg p-2 space-y-1 text-meta animate-in fade-in zoom-in-95 duration-100"
      onClick={e => e.stopPropagation()}
    >
      <div className="px-2 py-1 text-caption font-bold text-ink-muted dark:text-stone-400 flex items-center justify-between border-b border-ink-base/10 dark:border-stone-800 pb-1.5 mb-1">
        <span>Reschedule</span>
        <button onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink-base dark:text-stone-400 dark:hover:text-stone-200">
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-0.5">
        {options.map((opt) => (
          <button
            key={opt.label}
            onClick={() => {
              onSelectDate(opt.date);
              onClose();
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition-colors text-left ${
              currentDueDate === opt.date 
                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold border border-amber-600/30' 
                : 'text-ink-base dark:text-stone-200 hover:bg-paper-aged/70 dark:hover:bg-stone-800/70'
            }`}
          >
            <div className="flex items-center space-x-2">
              {opt.icon}
              <span>{opt.label}</span>
            </div>
            <span className="text-caption text-ink-muted dark:text-stone-400">{opt.sub}</span>
          </button>
        ))}
      </div>

      <div className="pt-1.5 border-t border-ink-base/10 dark:border-stone-800 space-y-1">
        {/* Custom date input */}
        <label className="flex items-center space-x-2 px-2.5 py-1.5 rounded hover:bg-paper-aged/70 dark:hover:bg-stone-800/70 transition-colors cursor-pointer text-ink-base dark:text-stone-300">
          <CalendarCheck className="w-3.5 h-3.5 text-ink-muted dark:text-stone-400" />
          <span className="flex-1 text-meta">Calendar Stamp...</span>
          <input
            type="date"
            className="w-4 h-4 opacity-0 absolute cursor-pointer"
            onChange={(e) => {
              if (e.target.value) {
                onSelectDate(e.target.value);
                onClose();
              }
            }}
          />
        </label>

        {currentDueDate && (
          <button
            onClick={() => {
              onSelectDate(null);
              onClose();
            }}
            className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 transition-colors text-left text-meta font-bold"
          >
            <X className="w-3.5 h-3.5" />
            <span>Clear Due Date</span>
          </button>
        )}
      </div>
    </div>
  );
};
