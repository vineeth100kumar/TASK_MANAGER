import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { parseDateString, getTodayString } from '../../utils/dateUtils';
import { formatTime } from '../../utils/reminders';

interface CalendarViewProps {
  tasks: any[];
  onSelect: (id: string) => void;
}

export function CalendarView({ tasks, onSelect }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const getDates = () => {
    const dates = new Map<string, any[]>();
    
    const pushTask = (dStr: string, t: any) => {
      if (!dates.has(dStr)) dates.set(dStr, []);
      if (!dates.get(dStr)!.find(existing => existing.id === t.id)) {
        dates.get(dStr)!.push(t);
      }
    };

    tasks.forEach(task => {
      if (task.entityType === 'task' || task.entityType === 'milestone') {
        const start = task.startDate;
        const due = task.dueDate;
        
        if (start && due && start <= due) {
          const curr = parseDateString(start);
          const end = parseDateString(due);
          if (curr && end) {
            while (curr <= end) {
              const y = curr.getFullYear();
              const m = String(curr.getMonth() + 1).padStart(2, '0');
              const d = String(curr.getDate()).padStart(2, '0');
              pushTask(`${y}-${m}-${d}`, task);
              curr.setDate(curr.getDate() + 1);
            }
          }
        } else if (start) {
          pushTask(start, task);
        } else if (due) {
          pushTask(due, task);
        }
      } else if (task.entityType === 'event' && task.startAt) {
        pushTask(task.startAt.slice(0, 10), task);
      } else if (task.entityType === 'reminder' && task.remindAt) {
        pushTask(task.remindAt.slice(0, 10), task);
      }
    });
    return dates;
  };

  const dates = getDates();
  const today = getTodayString();
  const [selectedDay, setSelectedDay] = useState(today);

  // Monday-first grid, like the rest of Sage, with only the weeks the month needs.
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), i - lead + 1);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { day: d.getDate(), isCurrentMonth: d.getMonth() === first.getMonth(), dateStr, weekend: d.getDay() === 0 || d.getDay() === 6 };
  });
  const shiftMonth = (n: number) => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + n, 1));
  const MAX_CHIPS = 3;
  const agenda = (dates.get(selectedDay) || []).slice().sort((a, b) => (timeOf(a) || '99').localeCompare(timeOf(b) || '99'));

  return (
    <div className="h-full flex flex-col md:min-h-[600px]">
      <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
          {currentMonth.toLocaleString('en-US', { month: 'long' })} <span className="text-gray-400 dark:text-gray-500 font-medium">{currentMonth.getFullYear()}</span>
        </h2>
        <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-gray-100/80 dark:bg-white/5 ring-1 ring-inset ring-black/[0.04] dark:ring-white/5">
          <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-[9px] text-gray-500 hover:text-gray-900 hover:bg-white dark:hover:bg-white/10 dark:hover:text-white transition-colors" aria-label="Previous month"><ChevronLeft size={18} /></button>
          <button onClick={() => { setCurrentMonth(new Date()); setSelectedDay(today); }} className="px-3 py-1 text-[13px] font-semibold text-gray-700 dark:text-gray-200 rounded-[9px] hover:bg-white dark:hover:bg-white/10 transition-colors">Today</button>
          <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-[9px] text-gray-500 hover:text-gray-900 hover:bg-white dark:hover:bg-white/10 dark:hover:text-white transition-colors" aria-label="Next month"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="md:flex-1 flex flex-col min-h-0 surface-item rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-100 dark:border-white/5 shrink-0">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="py-2.5 text-center text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">
              <span className="md:hidden">{d[0]}</span><span className="hidden md:inline">{d}</span>
            </div>
          ))}
        </div>

        <div className="md:flex-1 md:overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-7 md:auto-rows-fr md:h-full md:min-h-[500px]">
            {cells.map((cell, i) => {
              const items = dates.get(cell.dateStr) || [];
              const isToday = cell.dateStr === today;
              const isSel = cell.dateStr === selectedDay;
              return (
                <div key={cell.dateStr} onClick={() => setSelectedDay(cell.dateStr)}
                  className={`relative min-h-[3.25rem] md:min-h-[104px] p-1 md:p-2 border-b border-r border-gray-100 dark:border-white/5 ${(i + 1) % 7 === 0 ? 'border-r-0' : ''} ${i >= cells.length - 7 ? 'border-b-0' : ''}
                    ${cell.weekend ? 'bg-gray-50/60 dark:bg-white/[0.015]' : ''} ${isSel ? 'max-md:bg-blue-50/70 dark:max-md:bg-blue-500/10' : ''}`}>
                  <div className={`text-[12px] font-semibold mb-1 w-6 h-6 mx-auto md:mx-0 flex items-center justify-center rounded-full tabular-nums
                    ${isToday ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30' : cell.isCurrentMonth ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'}`}>
                    {cell.day}
                  </div>
                  {/* Phones get dots and an agenda below; wider screens list the items. */}
                  {items.length > 0 && (
                    <div className="md:hidden flex justify-center gap-0.5" aria-hidden>
                      {items.slice(0, 3).map(t => <span key={t.id} className={`w-1.5 h-1.5 rounded-full ${dotColor(t)}`} />)}
                    </div>
                  )}
                  <div className={`hidden md:block space-y-1 ${cell.isCurrentMonth ? '' : 'opacity-60'}`}>
                    {items.slice(0, MAX_CHIPS).map(task => (
                      <button key={task.id} type="button" onClick={e => { e.stopPropagation(); onSelect(task.id); }} title={task.title}
                        className={`w-full flex items-center gap-1 text-left text-[11.5px] font-semibold px-1.5 py-[3px] rounded-md truncate transition-[filter,transform] hover:brightness-95 dark:hover:brightness-125 active:scale-[0.98] ${chipColor(task)}`}>
                        {timeOf(task) && <span className="shrink-0 font-medium opacity-70 tabular-nums">{formatTime(timeOf(task)).replace(':00', '').replace(' ', '')}</span>}
                        <span className="truncate">{task.title}</span>
                      </button>
                    ))}
                    {items.length > MAX_CHIPS && (
                      <button type="button" onClick={e => { e.stopPropagation(); setSelectedDay(cell.dateStr); onSelect(items[MAX_CHIPS].id); }}
                        className="px-1.5 text-[11px] font-semibold text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">+{items.length - MAX_CHIPS} more</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="md:hidden mt-4 space-y-2">
        <p className="eyebrow text-gray-400 px-1">{parseDateString(selectedDay)?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        {agenda.length === 0 ? (
          <p className="px-1 py-6 text-center text-[13px] text-gray-400">Nothing on this day.</p>
        ) : agenda.map(task => (
          <button key={task.id} type="button" onClick={() => onSelect(task.id)}
            className="w-full surface-item is-interactive rounded-2xl px-4 py-3 flex items-center gap-3 text-left">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor(task)}`} />
            <span className={`flex-1 min-w-0 truncate text-[14px] font-semibold ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{task.title}</span>
            {timeOf(task) && <span className="text-[12px] font-medium text-gray-400 tabular-nums">{formatTime(timeOf(task))}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function timeOf(task: any): string {
  if (task.entityType === 'event') return task.startAt?.slice(11, 16) || '';
  if (task.entityType === 'reminder') return task.remindAt?.slice(11, 16) || '';
  return task.dueTime || '';
}

function chipColor(task: any): string {
  if (task.status === 'done') return 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500 line-through';
  if (task.entityType === 'event') return 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300';
  if (task.entityType === 'reminder') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (task.entityType === 'milestone') return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300';
  return 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
}

function dotColor(task: any): string {
  if (task.status === 'done') return 'bg-gray-300 dark:bg-gray-600';
  if (task.entityType === 'event') return 'bg-purple-500';
  if (task.entityType === 'reminder') return 'bg-emerald-500';
  if (task.entityType === 'milestone') return 'bg-amber-500';
  return 'bg-blue-500';
}
