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
    { label: 'Today', date: today, icon: <Calendar className="w-3.5 h-3.5 text-amber-400" />, sub: 'Due today' },
    { label: 'Tomorrow', date: tomorrow, icon: <Sun className="w-3.5 h-3.5 text-blue-400" />, sub: 'Next day' },
    { label: 'This Weekend', date: weekend, icon: <Coffee className="w-3.5 h-3.5 text-purple-400" />, sub: 'Saturday' },
    { label: 'Next Week', date: nextMonday, icon: <Briefcase className="w-3.5 h-3.5 text-emerald-400" />, sub: 'Monday' }
  ];

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 w-56 rounded-xl bg-zinc-900 border border-zinc-700 shadow-xl p-1.5 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-100"
      onClick={e => e.stopPropagation()}
    >
      <div className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
        <span>Reschedule Task</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
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
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors text-left ${
              currentDueDate === opt.date ? 'bg-blue-600/10 text-blue-400 font-medium' : 'text-zinc-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {opt.icon}
              <span>{opt.label}</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">{opt.sub}</span>
          </button>
        ))}
      </div>

      <div className="pt-1 border-t border-zinc-800 space-y-1">
        {/* Custom date input */}
        <label className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer text-zinc-300">
          <CalendarCheck className="w-3.5 h-3.5 text-zinc-400" />
          <span className="flex-1">Pick Date...</span>
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
            className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors text-left"
          >
            <X className="w-3.5 h-3.5" />
            <span>Clear Due Date</span>
          </button>
        )}
      </div>
    </div>
  );
};
