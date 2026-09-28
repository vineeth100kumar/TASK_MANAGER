import { CheckCircle, Circle, Calendar as CalendarIcon, Flag, Bell, CalendarDays } from 'lucide-react';
import { STATUSES, PRIORITIES } from '../../services/constants';
import { formatDateRange } from '../../utils/dateUtils';
import { WorkItem } from '../../services/types';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { SwipeRow, tomorrowMorning } from '../common/SwipeRow';

interface ListViewProps {
  tasks: WorkItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  onTransition: (task: WorkItem, toStatus: string) => void;
}

export function ListView({ tasks, onSelect, selectedId, onTransition }: ListViewProps) {
  const { showToast } = useToast();

  const snoozeToTomorrow = async (task: WorkItem) => {
    try {
      await api.snooze.snoozeItem(task.id, tomorrowMorning().toISOString());
      showToast('Snoozed until tomorrow');
    } catch (e: any) {
      showToast('Snooze failed: ' + e.message, 'error');
    }
  };

  const renderGroup = (title: string, groupTasks: any[], colorDot?: string) => {
    if (groupTasks.length === 0) return null;
    return (
      <div key={title} className="mb-10">
        <div className="flex items-center gap-2 mb-3 px-2">
          {colorDot && <div className={`w-2.5 h-2.5 rounded-full ${colorDot}`} />}
          <h4 className="font-bold text-[14px] text-gray-900 dark:text-white capitalize">{title}</h4>
          <span className="text-[12px] font-semibold text-gray-400 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">{groupTasks.length}</span>
        </div>
        
        <div className="flex flex-col gap-1.5">
          {groupTasks.map(task => {
            const dateStr = formatDateRange(task.startDate, task.dueDate);
            const swipeable = task.entityType === 'task' && task.status !== 'done';
            return (
              <SwipeRow key={task.id}
                onSwipeRight={swipeable ? () => onTransition(task, 'done') : undefined}
                onSwipeLeft={swipeable ? () => snoozeToTomorrow(task) : undefined}>
              <div
                onClick={() => onSelect(task.id)}
                className={`group flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:px-5 sm:py-3.5 rounded-2xl cursor-pointer transition-all border ${selectedId === task.id ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-white dark:bg-[#1c1c1e] border-gray-100 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/20 shadow-sm hover:shadow-md'}`}>
                
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  {task.entityType === 'task' ? (
                    <>
                      {task.status !== 'done' && (
                        <div className="relative group cursor-pointer" onClick={(e) => { e.stopPropagation(); onTransition(task, 'done'); }}>
                          <Circle size={20} strokeWidth={2.5} className="text-gray-300 dark:text-gray-600 group-hover:opacity-0 transition-opacity" />
                          <CheckCircle size={20} strokeWidth={2.5} className="text-gray-400 dark:text-gray-500 absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      )}
                      {task.status === 'done' && <CheckCircle size={20} strokeWidth={2.5} className="text-emerald-500" />}
                    </>
                  ) : task.entityType === 'event' ? (
                    <CalendarDays size={20} className="text-purple-500" />
                  ) : (
                    <Bell size={20} className="text-emerald-500" />
                  )}
                  
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-400 w-14">{task.key}</span>
                      <span className={`text-[15px] sm:text-[16px] font-bold tracking-tight ${task.status === 'done' || task.completed ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>{task.title}</span>
                      {task.subtaskCount > 0 && (
                        <div className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-md ml-2">
                          {task.completedSubtaskCount}/{task.subtaskCount}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {task.entityType === 'task' && (
                  <div className="flex items-center gap-4 shrink-0 pl-8 sm:pl-0 mt-2 sm:mt-0">
                    {task.project?.name && (
                      <span className="hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-white/5 text-gray-500">
                        {task.project.name}
                      </span>
                    )}
                    {task.area?.name && (
                      <span className="hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400">
                        {task.area.name}
                      </span>
                    )}
                    {task.estimated && (
                      <span className="hidden lg:inline-flex text-[12px] font-semibold text-gray-400">
                        {task.estimated}
                      </span>
                    )}
                    {dateStr && (
                      <span className={`text-[12px] sm:text-[13px] font-semibold flex items-center gap-1.5 ${task.dueDate && task.dueDate < new Date().toISOString().split('T')[0] ? 'text-red-500' : 'text-gray-500'}`}>
                        <CalendarIcon size={14}/> {dateStr}
                      </span>
                    )}
                    <Flag size={16} className={(PRIORITIES as any)[task.priority]?.color || 'text-gray-400'} aria-label={`Priority: ${task.priority}`}/>
                  </div>
                )}
                
                {task.entityType === 'event' && (
                  <div className="flex items-center gap-4 shrink-0 pl-8 sm:pl-0 mt-2 sm:mt-0">
                    <span className="text-[12px] sm:text-[13px] font-semibold text-gray-500 flex items-center gap-1.5"><CalendarIcon size={14}/> {task.startAt ? new Date(task.startAt).toLocaleString() : 'TBD'}</span>
                  </div>
                )}

                {task.entityType === 'reminder' && (
                  <div className="flex items-center gap-4 shrink-0 pl-8 sm:pl-0 mt-2 sm:mt-0">
                    <span className="text-[12px] sm:text-[13px] font-semibold text-gray-500 flex items-center gap-1.5"><CalendarIcon size={14}/> {task.remindAt ? new Date(task.remindAt).toLocaleString() : 'TBD'}</span>
                  </div>
                )}
              </div>
              </SwipeRow>
            );
          })}
        </div>
      </div>
    );
  };

  const eventTasks = tasks.filter(t => t.entityType === 'event');
  const reminderTasks = tasks.filter(t => t.entityType === 'reminder');
  const issueTasks = tasks.filter(t => t.entityType === 'task');

  return (
    <div className="max-w-5xl mx-auto pb-32">
      {renderGroup('Events', eventTasks, 'bg-purple-500')}
      {renderGroup('Reminders', reminderTasks, 'bg-emerald-500')}
      
      {Object.values(STATUSES).map(status => {
        const statusTasks = issueTasks.filter(t => t.status === status.id);
        return renderGroup(status.label, statusTasks, status.dot);
      })}
    </div>
  );
}
