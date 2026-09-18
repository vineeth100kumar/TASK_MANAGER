import React, { useState, useMemo } from 'react';
import { 
  Clock, ChevronLeft, ChevronRight, Plus, CheckCircle2, 
  Circle, AlertCircle, Calendar as CalendarIcon, Tag
} from 'lucide-react';
import { WorkItem, WorkItemUpdatePayload, Project } from '../../types';

interface TimeBlockingCalendarProps {
  items: WorkItem[];
  projects?: Project[];
  onSelectItem: (item: WorkItem) => void;
  onUpdateItem: (id: string, updates: WorkItemUpdatePayload) => void;
  onCreateItem: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => void;
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM (23:00)

export const TimeBlockingCalendar: React.FC<TimeBlockingCalendarProps> = ({
  items,
  projects = [],
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
    <div className="flex flex-col lg:flex-row gap-6 w-full">
      {/* Main Calendar Timeline */}
      <div className="flex-1 flex flex-col bg-surface border border-stone-300 dark:border-stone-800 rounded-control overflow-hidden min-h-[600px] relative">        {/* Calendar Header */}
        <div className="p-4 bg-paper-aged dark:bg-sunken border-b border-stone-300 dark:border-stone-800 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-control bg-paper-base dark:bg-stone-900 text-amber-700 dark:text-amber-400 border border-stone-300 dark:border-stone-700">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-caption text-amber-700 dark:text-amber-500 font-bold">
                SECTION II &bull; TIMELINE REGISTER
              </div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 tracking-tight">Daily Time-Blocking</h2>
              <p className="text-meta text-ink-3 dark:text-stone-400">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { 
                  weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' 
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToday}
              className={`px-3 py-1.5 rounded-control text-meta font-bold transition-colors border ${
                isToday 
                  ? 'bg-surface text-ink dark:bg-stone-100 dark:text-stone-950 border-hairline dark:border-stone-100' 
                  : 'bg-paper-base dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-300 dark:border-stone-700 hover:bg-stone-200 dark:hover:bg-stone-700'
              }`}
            >
              Today
            </button>
            <div className="flex items-center rounded-control bg-paper-base dark:bg-stone-800 border border-stone-300 dark:border-stone-700 p-0.5">
              <button
                onClick={handlePrevDay}
                aria-label="Previous Day"
                className="p-1 text-ink-3 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white rounded-control hover:bg-black/5 dark:hover:bg-stone-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextDay}
                aria-label="Next Day"
                className="p-1 text-ink-3 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white rounded-control hover:bg-black/5 dark:hover:bg-stone-700 transition-colors"
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
                className="flex group relative min-h-[64px] border-b border-stone-200 dark:border-stone-800/60 transition-colors hover:bg-black/5 dark:hover:bg-stone-800/20 rounded-control"
              >
                {/* Time Label */}
                <div className="w-20 py-2 pr-3 text-right flex-shrink-0">
                  <span className={`text-meta font-medium ${isNowHour ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-ink-3'}`}>
                    {hourLabel}
                  </span>
                </div>

                {/* Slot Lane */}
                <div className="flex-1 pl-3 py-1.5 relative border-l border-stone-300 dark:border-zinc-800 flex flex-wrap gap-2 items-start">
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
                        className={`flex items-center justify-between px-3 py-2 rounded-control text-meta cursor-pointer transition-all flex-1 min-w-[200px] border shadow-sm bg-surface ${
                          item.is_completed
                            ? ' border-stone-300 dark:border-zinc-700/40 text-ink-2 line-through'
                            : isUrgent
                            ? ' border-rose-300 dark:border-rose-500/40 text-rose-800 dark:text-rose-200'
                            : isHigh
                            ? ' border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-200'
                            : ' border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          {item.is_completed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-ink-2 flex-shrink-0" />
                          )}
                          <span className="font-semibold truncate">{item.title}</span>
                          {item.project_id && (() => {
                            const p = projects.find(proj => proj.id === item.project_id);
                            if (!p) return null;
                            return (
                              <span 
                                className="text-caption px-1.5 py-0.5 rounded-control font-medium flex items-center gap-1 shrink-0 border border-stone-300 dark:border-stone-700"
                                style={{
                                  backgroundColor: `${p.color || '#d97706'}20`,
                                  color: p.color || '#d97706'
                                }}
                              >
                                ● {p.name}
                              </span>
                            );
                          })()}
                        </div>
                        <span className="text-caption text-ink-3 flex-shrink-0">
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
                        placeholder="Draft title & hit Enter..."
                        className="bg-paper-base dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-control text-meta px-2.5 py-1 text-stone-900 dark:text-white placeholder-stone-400 focus:outline-none flex-1"
                      />
                      <button
                        onClick={() => handleQuickAdd(hour)}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded-control text-meta"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setQuickHour(null)}
                        className="px-2 py-1 text-meta text-ink-3 hover:text-stone-800 dark:hover:text-stone-300"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    itemsInThisSlot.length === 0 && (
                      <button
                        onClick={() => {
                          setQuickHour(hour);
                          setQuickTitle('');
                        }}
                        aria-label={`Quick schedule task at ${hourLabel}`}
                        className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 hover:opacity-100 transition-opacity flex items-center gap-1.5 text-meta text-ink-3 hover:text-amber-600 py-1 min-h-[32px]"
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
      <div className="w-full lg:w-80 bg-sunken border border-stone-300 dark:border-stone-800 rounded-control flex flex-col overflow-hidden relative">        <div className="p-4 border-b border-stone-300 dark:border-stone-800 bg-paper-base dark:bg-stone-900/40">
          <div className="text-caption text-amber-700 dark:text-amber-500 font-bold mb-0.5">
            Unscheduled
          </div>
          <h3 className="text-sm font-bold text-stone-900 dark:text-white flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Floating Tasks Due Today ({unscheduledItems.length})
          </h3>
          <p className="text-meta text-ink-3 dark:text-stone-400 mt-0.5">
            Click "Block at..." to assign to an open time slot.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {unscheduledItems.length === 0 ? (
            <div className="text-center py-12 text-ink-3 text-meta">
              All tasks for today are time-blocked!
            </div>
          ) : (
            unscheduledItems.map(item => (
              <div
                key={item.id}
                className="p-3 rounded-control bg-surface border border-stone-300 dark:border-stone-700/50 hover:border-stone-400 transition-all flex flex-col gap-2 shadow-sm"
              >
                <div 
                  onClick={() => onSelectItem(item)}
                  className="cursor-pointer"
                >
                  <span className="text-meta font-semibold text-stone-900 dark:text-stone-100 line-clamp-2">
                    {item.title}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {item.project_id && (() => {
                      const p = projects.find(proj => proj.id === item.project_id);
                      if (!p) return null;
                      return (
                        <span 
                          className="text-caption px-1.5 py-0.5 rounded-control font-medium flex items-center gap-1 shrink-0 border border-stone-300 dark:border-stone-700"
                          style={{
                            backgroundColor: `${p.color || '#d97706'}20`,
                            color: p.color || '#d97706'
                          }}
                        >
                          ● {p.name}
                        </span>
                      );
                    })()}
                    {item.context_tags && (
                      <div className="flex items-center gap-1 text-caption text-ink-3">
                        <Tag className="w-2.5 h-2.5" />
                        <span>{item.context_tags}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Schedule Dropdown / Action */}
                <div className="flex items-center justify-between pt-1 border-t border-stone-200 dark:border-zinc-700/30">
                  <span className="text-caption text-ink-3">
                    {item.estimated_minutes || 30}m
                  </span>
                  <select
                    onChange={e => {
                      const h = parseInt(e.target.value);
                      if (!isNaN(h)) handleDropToHour(item, h);
                    }}
                    defaultValue=""
                    className="bg-paper-base dark:bg-stone-700/80 border border-stone-300 dark:border-stone-600 rounded-control text-meta text-stone-800 dark:text-stone-200 px-2 py-0.5 focus:outline-none"
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
