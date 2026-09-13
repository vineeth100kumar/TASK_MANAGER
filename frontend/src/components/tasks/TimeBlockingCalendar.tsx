import React, { useState, useMemo } from 'react';
import { 
  Clock, ChevronLeft, ChevronRight, Plus, CheckCircle2, 
  Circle, AlertCircle, Calendar as CalendarIcon, Tag
} from 'lucide-react';
import { WorkItem, WorkItemUpdatePayload } from '../../types';

interface TimeBlockingCalendarProps {
  items: WorkItem[];
  onSelectItem: (item: WorkItem) => void;
  onUpdateItem: (id: string, updates: WorkItemUpdatePayload) => void;
  onCreateItem: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => void;
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM (23:00)

export const TimeBlockingCalendar: React.FC<TimeBlockingCalendarProps> = ({
  items,
  onSelectItem,
  onUpdateItem,
  onCreateItem
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [quickTitle, setQuickTitle] = useState<string>('');
  const [quickHour, setQuickHour] = useState<number | null>(null);

  // Navigate dates
  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  // Filter items for selected day
  const { scheduledItems, unscheduledItems } = useMemo(() => {
    const scheduled: { item: WorkItem; startHour: number; startMin: number; durationMin: number }[] = [];
    const unscheduled: WorkItem[] = [];

    items.forEach(item => {
      // Check if scheduled by start_at
      if (item.start_at && item.start_at.startsWith(selectedDate)) {
        try {
          const d = new Date(item.start_at);
          const startHour = d.getHours();
          const startMin = d.getMinutes();
          const durationMin = item.estimated_minutes || 60;
          scheduled.push({ item, startHour, startMin, durationMin });
          return;
        } catch (e) {
          // ignore parsing error
        }
      }

      // Check if due on this date without specific start_at
      if (item.due_date === selectedDate && !item.is_completed) {
        unscheduled.push(item);
      }
    });

    return { scheduledItems: scheduled, unscheduledItems: unscheduled };
  }, [items, selectedDate]);

  // Handle scheduling an unscheduled item into an hour slot
  const handleDropToHour = (item: WorkItem, hour: number) => {
    const startIso = `${selectedDate}T${String(hour).padStart(2, '0')}:00:00`;
    const endMinutes = item.estimated_minutes || 60;
    const endD = new Date(startIso);
    endD.setMinutes(endD.getMinutes() + endMinutes);
    onUpdateItem(item.id, {
      start_at: startIso,
      end_at: endD.toISOString(),
      due_date: selectedDate
    });
  };

  // Quick add task at slot
  const handleQuickAdd = (hour: number) => {
    if (!quickTitle.trim()) return;
    const startIso = `${selectedDate}T${String(hour).padStart(2, '0')}:00:00`;
    const endIso = `${selectedDate}T${String(hour + 1).padStart(2, '0')}:00:00`;
    onCreateItem({
      title: quickTitle.trim(),
      start_at: startIso,
      end_at: endIso,
      due_date: selectedDate,
      estimated_minutes: 60,
      entity_type: 'task',
      priority: 'medium',
      status: 'todo'
    });
    setQuickTitle('');
    setQuickHour(null);
  };

  const currentHour = new Date().getHours();
  const currentMinute = new Date().getMinutes();

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full min-h-[700px] animate-in fade-in">
      {/* Timeline Column (Main) */}
      <div className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden">
        {/* Date Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Daily Time-Blocking</h2>
              <p className="text-xs text-zinc-400">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { 
                  weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' 
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToday}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                isToday 
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' 
                  : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
              }`}
            >
              Today
            </button>
            <div className="flex items-center rounded-lg bg-zinc-800 border border-zinc-700 p-0.5">
              <button
                onClick={handlePrevDay}
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextDay}
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-700 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Timeline Grid */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar relative">
          {HOURS.map(hour => {
            const hourLabel = `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`;
            const isNowHour = isToday && currentHour === hour;
            const itemsInThisSlot = scheduledItems.filter(s => s.startHour === hour);

            return (
              <div 
                key={hour} 
                className="flex group relative min-h-[64px] border-b border-zinc-800/60 transition-colors hover:bg-zinc-800/20 rounded-lg"
              >
                {/* Time Label */}
                <div className="w-20 py-2 pr-3 text-right flex-shrink-0">
                  <span className={`text-xs font-mono font-medium ${isNowHour ? 'text-rose-400 font-bold' : 'text-zinc-500'}`}>
                    {hourLabel}
                  </span>
                </div>

                {/* Slot Lane */}
                <div className="flex-1 pl-3 py-1.5 relative border-l border-zinc-800 flex flex-wrap gap-2 items-start">
                  {/* Current Time Line */}
                  {isNowHour && (
                    <div 
                      className="absolute left-0 right-0 h-0.5 bg-rose-500 z-10 pointer-events-none flex items-center"
                      style={{ top: `${(currentMinute / 60) * 100}%` }}
                    >
                      <div className="w-2 h-2 rounded-full bg-rose-500 -ml-1" />
                    </div>
                  )}

                  {/* Scheduled Task Blocks */}
                  {itemsInThisSlot.map(({ item, durationMin }) => {
                    const isUrgent = item.priority === 'urgent';
                    const isHigh = item.priority === 'high';
                    return (
                      <div
                        key={item.id}
                        onClick={() => onSelectItem(item)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all flex-1 min-w-[200px] border shadow-sm ${
                          item.is_completed
                            ? 'bg-zinc-800/40 border-zinc-700/40 text-zinc-500 line-through'
                            : isUrgent
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200 hover:bg-rose-500/20'
                            : isHigh
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200 hover:bg-amber-500/20'
                            : 'bg-blue-500/10 border-blue-500/30 text-blue-200 hover:bg-blue-500/20'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          {item.is_completed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                          )}
                          <span className="font-semibold truncate">{item.title}</span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400 flex-shrink-0">
                          {durationMin}m
                        </span>
                      </div>
                    );
                  })}

                  {/* Quick Add Inline Form */}
                  {quickHour === hour ? (
                    <div className="flex items-center gap-2 flex-1 animate-in fade-in">
                      <input
                        type="text"
                        autoFocus
                        value={quickTitle}
                        onChange={e => setQuickTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleQuickAdd(hour);
                          if (e.key === 'Escape') setQuickHour(null);
                        }}
                        placeholder={`Schedule task at ${hourLabel}...`}
                        className="flex-1 bg-zinc-800 border border-blue-500/50 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
                      />
                      <button
                        onClick={() => handleQuickAdd(hour)}
                        className="px-2.5 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-black text-xs font-bold transition-colors"
                      >
                        Schedule
                      </button>
                      <button
                        onClick={() => setQuickHour(null)}
                        className="px-2 py-1.5 text-xs text-zinc-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    itemsInThisSlot.length === 0 && (
                      <button
                        onClick={() => {
                          setQuickHour(hour);
                          setQuickTitle('');
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-blue-400 py-1"
                      >
                        <Plus className="w-3 h-3" /> Quick Schedule
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unscheduled / Floating Column (Sidebar) */}
      <div className="w-full lg:w-80 bg-zinc-900/60 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/40">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-amber-400" />
            Floating Tasks Due Today ({unscheduledItems.length})
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Click "Schedule" to assign to an open time slot.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {unscheduledItems.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-xs">
              All tasks for today are time-blocked! 🎉
            </div>
          ) : (
            unscheduledItems.map(item => (
              <div
                key={item.id}
                className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/50 hover:bg-zinc-800/70 transition-all flex flex-col gap-2"
              >
                <div 
                  onClick={() => onSelectItem(item)}
                  className="cursor-pointer"
                >
                  <span className="text-xs font-semibold text-zinc-200 line-clamp-2">
                    {item.title}
                  </span>
                  {item.context_tags && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-zinc-400">
                      <Tag className="w-2.5 h-2.5" />
                      <span>{item.context_tags}</span>
                    </div>
                  )}
                </div>

                {/* Quick Schedule Dropdown / Action */}
                <div className="flex items-center justify-between pt-1 border-t border-zinc-700/30">
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {item.estimated_minutes || 30}m
                  </span>
                  <select
                    onChange={e => {
                      const h = parseInt(e.target.value);
                      if (!isNaN(h)) handleDropToHour(item, h);
                    }}
                    defaultValue=""
                    className="bg-zinc-700/80 border border-zinc-600 rounded text-[11px] text-zinc-200 px-2 py-0.5 focus:outline-none"
                  >
                    <option value="" disabled>Block at...</option>
                    {HOURS.map(h => (
                      <option key={h} value={h}>
                        {h > 12 ? h - 12 : h}:00 {h >= 12 ? 'PM' : 'AM'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
