import { Flag, Calendar as CalendarIcon, CheckCircle2, Circle, Clock, MapPin, Bell, ChevronRight, Target } from 'lucide-react';
import { PRIORITIES } from '../../services/constants';
import { parseDateString, getTodayString } from '../../utils/dateUtils';

interface TimelineViewProps {
  tasks: any[];
  onSelect: (id: string) => void;
}

export function TimelineView({ tasks, onSelect }: TimelineViewProps) {
  const milestones = tasks.filter(t => t.entityType === 'milestone');
  
  // Group all items with dates chronologically
  const todayStr = getTodayString();

  // Helper to extract sort date
  const getItemDate = (t: any): string | null => {
    if (t.entityType === 'milestone') return t.dueDate || t.startDate || null;
    if (t.entityType === 'event') return t.startAt ? t.startAt.slice(0, 10) : null;
    if (t.entityType === 'reminder') return t.remindAt ? t.remindAt.slice(0, 10) : null;
    return t.dueDate || t.startDate || null;
  };

  // Group items by date
  const dateMap = new Map<string, any[]>();
  const undatedItems: any[] = [];

  tasks.forEach(t => {
    const d = getItemDate(t);
    if (d) {
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d)!.push(t);
    } else {
      undatedItems.push(t);
    }
  });

  const sortedDates = Array.from(dateMap.keys()).sort();

  const formatDateHeader = (dStr: string) => {
    const d = parseDateString(dStr) || new Date();
    const isToday = dStr === todayStr;
    const isPast = dStr < todayStr;
    const dayName = isToday ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
    const fullDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
    
    return { dayName, fullDate, isToday, isPast };
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-32">
      
      {/* Key Milestones Ribbon */}
      {milestones.length > 0 && (
        <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 dark:from-blue-500/5 dark:via-indigo-500/5 dark:to-purple-500/5 p-6 rounded-[28px] border border-blue-200/40 dark:border-blue-500/20">
          <div className="flex items-center gap-2 mb-4">
            <Target size={18} className="text-blue-600 dark:text-blue-400" />
            <h3 className="font-bold text-[15px] text-gray-900 dark:text-white">Milestones & Key Checkpoints</h3>
            <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold px-2.5 py-0.5 rounded-full ml-auto">
              {milestones.filter(m => m.status === 'done' || m.status === 'achieved').length}/{milestones.length} Reached
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
            {milestones.map(m => {
              const isReached = m.status === 'done' || m.status === 'achieved';
              const targetDate = m.dueDate || m.startDate;
              return (
                <div key={m.id} onClick={() => onSelect(m.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${isReached ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40' : 'bg-white dark:bg-[#2c2c2e] border-black/5 dark:border-white/5 hover:border-blue-300 dark:hover:border-blue-500/40 shadow-sm'}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-bold text-gray-400 uppercase">{m.key}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${isReached ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}>
                      {isReached ? 'Achieved ✓' : targetDate ? new Date(targetDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Upcoming'}
                    </span>
                  </div>
                  <h4 className={`font-semibold text-[14px] leading-snug ${isReached ? 'text-emerald-900 dark:text-emerald-200 line-through' : 'text-gray-900 dark:text-white'}`}>
                    {m.title}
                  </h4>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chronological Stream */}
      <div className="space-y-6">
        <h3 className="text-xl font-bold flex items-center gap-2 px-2 text-gray-900 dark:text-white">
          <Clock size={20} className="text-blue-500" />
          Chronological Schedule
        </h3>

        <div className="relative pl-6 sm:pl-8 border-l-2 border-gray-200 dark:border-gray-800 space-y-8 ml-3 sm:ml-4">
          {sortedDates.map(dateStr => {
            const { dayName, fullDate, isToday, isPast } = formatDateHeader(dateStr);
            const items = dateMap.get(dateStr) || [];

            return (
              <div key={dateStr} className="relative group">
                {/* Date Node */}
                <div className={`absolute -left-[31px] sm:-left-[39px] top-0 w-6 h-6 rounded-full border-4 border-white dark:border-[#000000] flex items-center justify-center ${isToday ? 'bg-blue-600 ring-4 ring-blue-500/20' : isPast ? 'bg-gray-300 dark:bg-gray-700' : 'bg-gray-400 dark:bg-gray-600'}`} />

                <div className="flex items-baseline gap-3 mb-3">
                  <span className={`text-[15px] font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
                    {dayName}
                  </span>
                  <span className="text-[13px] font-semibold text-gray-400">
                    {fullDate}
                  </span>
                  {isToday && (
                    <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Today
                    </span>
                  )}
                </div>

                <div className="space-y-2.5">
                  {items.map(item => {
                    const isDone = item.status === 'done' || item.status === 'achieved';
                    return (
                      <div key={item.id} onClick={() => onSelect(item.id)}
                        className={`p-4 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 hover:border-blue-200 dark:hover:border-white/20 shadow-sm cursor-pointer transition-all flex items-center justify-between gap-4 group/card`}>
                        
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="shrink-0 text-gray-400">
                            {item.entityType === 'event' ? (
                              <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                                <CalendarIcon size={16} />
                              </div>
                            ) : item.entityType === 'reminder' ? (
                              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                <Bell size={16} />
                              </div>
                            ) : item.entityType === 'milestone' ? (
                              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                <Flag size={16} />
                              </div>
                            ) : (
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isDone ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400'}`}>
                                {isDone ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[11px] font-bold text-gray-400 uppercase">{item.key}</span>
                              {item.project?.name && <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-0.2 rounded">{item.project.name}</span>}
                              {item.area?.name && <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 px-2 py-0.2 rounded">{item.area.name}</span>}
                            </div>
                            <h4 className={`text-[15px] font-semibold truncate ${isDone ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}>
                              {item.title}
                            </h4>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {item.location && (
                            <span className="hidden md:flex items-center gap-1 text-xs text-gray-400 font-medium">
                              <MapPin size={12} /> {item.location}
                            </span>
                          )}
                          {item.startAt && (
                            <span className="text-xs font-bold text-purple-600 dark:text-purple-400">
                              {new Date(item.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {item.remindAt && (
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                              {new Date(item.remindAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {item.priority && item.entityType === 'task' && (
                            <Flag size={14} className={(PRIORITIES as any)[item.priority]?.color} />
                          )}
                          <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 group-hover/card:translate-x-0.5 transition-transform" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {sortedDates.length === 0 && (
            <div className="py-12 text-center text-gray-400 font-medium">
              No scheduled dates or milestones found. Set due dates on tasks to visualize your roadmap!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
