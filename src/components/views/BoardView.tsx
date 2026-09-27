import React, { useState } from 'react';
import { Flag, CheckSquare, MessageSquare, Calendar as CalendarIcon, Check } from 'lucide-react';
import { STATUSES, PRIORITIES } from '../../services/mockDb';
import { useToast } from '../../context/ToastContext';
import { formatDateRange } from '../../utils/dateUtils';

export function BoardView({ tasks, onSelect, onTransition }: BoardViewProps) {
  const [draggedTask, setDraggedTask] = useState<any>(null);
  const { showToast } = useToast();

  const handleDragStart = (e: React.DragEvent, task: any) => {
    setDraggedTask(task);
    e.dataTransfer.setData('taskId', task.id);
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = async (e: React.DragEvent, toStatus: string) => {
    e.preventDefault();
    if (!draggedTask || draggedTask.status === toStatus) return;
    
    onTransition(draggedTask, toStatus);
    setDraggedTask(null);
  };

  return (
    <div className="flex gap-6 overflow-x-auto pb-12 min-h-[75vh] items-start px-2 snap-x">
      {Object.values(STATUSES).map(status => {
        const columnTasks = tasks.filter(t => t.status === status.id);
        const isValidDrop = !!draggedTask;

        return (
          <div key={status.id} className="flex flex-col w-[320px] shrink-0 snap-start" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, status.id)}>
            <div className="flex items-center gap-2 mb-4 px-2 sticky top-0 bg-white/80 dark:bg-[#000000]/80 backdrop-blur-md py-2 z-10">
              <div className={`p-1.5 rounded-lg ${status.color.split(' ')[0]} bg-opacity-20`}><div className={`w-2 h-2 rounded-full ${status.dot}`} /></div>
              <h3 className="font-bold text-[15px]">{status.label}</h3>
              <span className="text-xs font-bold bg-gray-100 dark:bg-[#1c1c1e] px-2 py-0.5 rounded-full text-gray-500">{columnTasks.length}</span>
            </div>
            <div className={`flex flex-col gap-3 bg-[#f5f5f7] dark:bg-[#1c1c1e] p-3 rounded-[24px] min-h-[150px] border transition-colors ${draggedTask && !isValidDrop ? 'opacity-50 border-transparent' : draggedTask && isValidDrop ? 'border-blue-300 dark:border-blue-500/50 bg-blue-50/50 dark:bg-blue-900/10' : 'border-black/5 dark:border-white/5'}`}>
              {columnTasks.map(task => {
                const dateText = formatDateRange(task.startDate, task.dueDate);
                return (
                  <div key={task.id} draggable onDragStart={(e) => handleDragStart(e, task)} onClick={() => onSelect(task.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(task.id)}
                    className="bg-white dark:bg-[#2c2c2e] p-4 rounded-2xl shadow-sm border border-transparent hover:border-gray-200 dark:hover:border-white/20 cursor-grab active:cursor-grabbing group outline-none focus:ring-2 focus:ring-blue-500/50">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); onTransition(task, task.status === 'done' ? 'todo' : 'done'); }}
                          className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${task.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'}`}
                          title={task.status === 'done' ? 'Mark as To Do' : 'Mark as Done'}>
                          {task.status === 'done' && <Check size={10} strokeWidth={3} />}
                        </button>
                        <span className="text-[12px] font-bold text-gray-400 uppercase">{task.key}</span>
                      </div>
                      <Flag size={14} className={(PRIORITIES as any)[task.priority]?.color} />
                    </div>
                    <h4 className="text-[15px] font-semibold mb-3 leading-snug group-hover:text-blue-500 line-clamp-2">{task.title}</h4>
                    
                    {dateText && (
                      <div className={`flex items-center gap-1.5 mb-3 text-[11px] font-bold ${task.dueDate && task.dueDate < new Date().toISOString().split('T')[0] ? 'text-red-500' : 'text-gray-400'}`}>
                        <CalendarIcon size={12}/>
                        <span>{dateText}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-white/5">
                      <div className="flex gap-3 text-[12px] font-semibold text-gray-400">
                        {task.subtaskCount > 0 && <span className="flex items-center gap-1" title={`${task.completedSubtaskCount} of ${task.subtaskCount} subtasks`}><CheckSquare size={13}/> {task.completedSubtaskCount}/{task.subtaskCount}</span>}
                        {task.commentCount > 0 && <span className="flex items-center gap-1" title={`${task.commentCount} notes`}><MessageSquare size={13}/> {task.commentCount}</span>}
                      </div>
                      <span className="text-[11px] font-bold text-gray-400">
                        {task.project?.name || task.area?.name || ''}
                      </span>
                    </div>
                  </div>
                );
              })}
              {columnTasks.length === 0 && <div className="h-20 border-2 border-dashed border-gray-300 dark:border-white/10 rounded-2xl flex items-center justify-center text-[13px] font-medium text-gray-400 pointer-events-none">Drop here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
