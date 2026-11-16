import { useState } from 'react';
import { withTime, formatClock } from '../../utils/reminders';
import { CheckCircle, Calendar as CalendarIcon, Flag, Bell, CalendarDays } from 'lucide-react';
import { PRIORITIES } from '../../services/constants';
import { DEFAULT_STATUSES, stageOf, type StatusStage } from '../../services/projectTypes';
import { formatDateRange, getTodayString } from '../../utils/dateUtils';
import { WorkItem } from '../../services/types';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { SwipeRow, tomorrowMorning } from '../common/SwipeRow';
import { CompleteButton } from '../common/CompleteButton';

// "Wed, Sep 30 · 3:00 PM"
function formatWhen(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatClock(d)}`;
}

interface ListViewProps {
  tasks: WorkItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  onTransition: (task: WorkItem, toStatus: string) => void;
  /** Groups: a project's own statuses, or the usual four. */
  statuses?: StatusStage[];
}

export function ListView({ tasks, onSelect, selectedId, onTransition, statuses = DEFAULT_STATUSES }: ListViewProps) {
  const { showToast } = useToast();
  // Ticks spin briefly, then fill; the status change follows once the pop has played.
  const [pressed, setPressed] = useState<Set<string>>(() => new Set());
  const [spinning, setSpinning] = useState<Set<string>>(() => new Set());
  const drop = (set: Set<string>, id: string) => { const next = new Set(set); next.delete(id); return next; };
  const completeSoon = (task: WorkItem) => {
    setPressed(prev => new Set(prev).add(task.id));
    setSpinning(prev => new Set(prev).add(task.id));
    setTimeout(() => setSpinning(prev => drop(prev, task.id)), 320);
    setTimeout(() => {
      Promise.resolve(onTransition(task, 'done')).catch(() => {}).finally(() => setPressed(prev => drop(prev, task.id)));
    }, 700);
  };

  const snoozeToTomorrow = async (task: WorkItem) => {
    try {
      await api.snooze.snoozeItem(task.id, tomorrowMorning().toISOString());
      showToast('Snoozed until tomorrow');
    } catch (e: any) {
      showToast('Snooze failed: ' + e.message, 'error');
    }
  };

  const renderGroup = (title: string, groupTasks: any[], colorDot?: string, stage?: StatusStage) => {
    if (groupTasks.length === 0) return null;
    return (
      <div key={title} className="mb-10">
        <div className="flex items-center gap-2 mb-3 px-2">
          {stage ? <stage.icon size={15} strokeWidth={2.2} className={stage.tint} aria-hidden /> : colorDot && <div className={`w-2.5 h-2.5 rounded-full ${colorDot}`} />}
          <h4 className="font-semibold text-[13.5px] tracking-[-0.01em] text-gray-900 dark:text-white capitalize">{title}</h4>
          <span className="text-[11px] font-semibold tabular-nums text-gray-500 bg-black/[0.05] dark:bg-white/[0.07] px-2 py-0.5 rounded-full">{groupTasks.length}</span>
        </div>
        
        <div className="flex flex-col gap-1.5 stagger">
          {groupTasks.map(task => {
            const dateStr = withTime(formatDateRange(task.startDate, task.dueDate, task.status === 'done'), task.dueTime);
            const swipeable = task.entityType === 'task' && task.status !== 'done';
            return (
              <SwipeRow key={task.id}
                onSwipeRight={swipeable ? () => onTransition(task, 'done') : undefined}
                onSwipeLeft={swipeable ? () => snoozeToTomorrow(task) : undefined}>
              <div
                onClick={() => onSelect(task.id)}
                className={`group flex items-center gap-3 p-3.5 sm:px-5 sm:py-3.5 rounded-2xl cursor-pointer border ${pressed.has(task.id) ? 'is-completing' : ''} ${selectedId === task.id ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'surface-item is-interactive'}`}>
                
                  {/* The tick, then title and details; details drop under the title when the row is narrow. */}
                  <span className="shrink-0 flex">
                  {task.entityType === 'task' ? (
                    <>
                      {task.status !== 'done' && (
                        <CompleteButton checked={pressed.has(task.id)} saving={spinning.has(task.id)} onComplete={() => completeSoon(task)} />
                      )}
                      {task.status === 'done' && <CheckCircle size={20} strokeWidth={2.5} className="text-emerald-500" />}
                    </>
                  ) : task.entityType === 'event' ? (
                    <CalendarDays size={20} className="text-purple-500" />
                  ) : task.entityType === 'milestone' ? (
                    <Flag size={20} className="text-emerald-500" aria-label="Milestone reached" />
                  ) : (
                    <Bell size={20} className="text-emerald-500" />
                  )}
                  </span>

                <div className="flex-1 min-w-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="flex items-baseline gap-2 min-w-0 flex-1 basis-64">
                      <span className="hidden sm:inline text-[11px] font-semibold tracking-wide text-gray-400 w-14 shrink-0">{task.key}</span>
                      <span className={`row-title min-w-0 text-[14.5px] font-semibold tracking-[-0.01em] ${task.entityType !== 'milestone' && (task.status === 'done' || task.completed) ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>{task.title}</span>
                      {task.subtaskCount > 0 && (
                        <div className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-md ml-2">
                          {task.completedSubtaskCount}/{task.subtaskCount}
                        </div>
                      )}
                    </div>

                {task.entityType === 'task' && (
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 min-w-0">
                    <span className="sm:hidden text-[11px] font-semibold tracking-wide text-gray-400">{task.key}</span>
                    {task.project?.name && (
                      <span className="hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-white/5 text-gray-500">
                        {task.project.name}
                      </span>
                    )}
                    {task.area?.name && (
                      <span className="hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-white/5 text-gray-500">
                        {task.area.name}
                      </span>
                    )}
                    {task.estimated && (
                      <span className="hidden lg:inline-flex text-[12px] font-semibold text-gray-400">
                        {task.estimated}
                      </span>
                    )}
                    {(task.labels || []).slice(0, 2).map((tag: string) => (
                      <span key={tag} className="hidden sm:inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500">#{tag}</span>
                    ))}
                    {/* Date and priority flag travel together, so the flag never wraps alone. */}
                    <span className="flex items-center gap-3 whitespace-nowrap">
                    {dateStr && (
                      <span className={`text-[12px] font-semibold flex items-center gap-1.5 ${task.status !== 'done' && task.dueDate && task.dueDate < getTodayString() ? 'text-red-500' : 'text-gray-500'}`}>
                        <CalendarIcon size={14}/> {dateStr}
                      </span>
                    )}
                    <Flag size={16} className={(PRIORITIES as any)[task.priority]?.color || 'text-gray-400'} aria-label={`Priority: ${task.priority}`}/>
                    </span>
                  </div>
                )}
                
                {task.entityType === 'event' && (
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-[12px] sm:text-[13px] font-semibold text-gray-500 flex items-center gap-1.5"><CalendarIcon size={14}/> {task.startAt ? formatWhen(task.startAt) : 'No time set'}</span>
                  </div>
                )}

                {task.entityType === 'milestone' && dateStr && (
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-[12px] sm:text-[13px] font-semibold flex items-center gap-1.5 text-gray-500"><Flag size={14}/> {dateStr}</span>
                  </div>
                )}

                {task.entityType === 'reminder' && (
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-[12px] sm:text-[13px] font-semibold text-gray-500 flex items-center gap-1.5"><CalendarIcon size={14}/> {task.remindAt ? formatWhen(task.remindAt) : 'No time set'}</span>
                  </div>
                )}
                </div>
              </div>
              </SwipeRow>
            );
          })}
        </div>
      </div>
    );
  };

  // Every kind (task, event, reminder, milestone) under its status, the same
  // groups and counts as the Board and the status strip. Each row shows its kind.
  const byDate = (a: WorkItem, b: WorkItem) => (a.dueDate || a.startDate || '9999').localeCompare(b.dueDate || b.startDate || '9999');

  return (
    <div className="max-w-5xl mx-auto pb-32">
      {statuses.map(status => {
        const statusTasks = tasks.filter(t => stageOf(t, statuses).id === status.id).sort(byDate);
        return renderGroup(status.label, statusTasks, status.dot, status);
      })}
    </div>
  );
}
