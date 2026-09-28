import { STATUSES, PRIORITIES } from '../../services/constants';
import { Flag, Check } from 'lucide-react';
import { formatDisplayDate } from '../../utils/dateUtils';

interface TableViewProps {
  tasks: any[];
  onSelect: (id: string) => void;
  onTransition?: (task: any, status: string) => void;
}

export function TableView({ tasks, onSelect, onTransition }: TableViewProps) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-3xl border border-black/5 dark:border-white/5 overflow-hidden max-w-7xl mx-auto">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left whitespace-nowrap min-w-[700px]">
          <thead>
            <tr className="bg-[#f5f5f7] dark:bg-black/20 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-6 py-4">Key</th>
              <th className="px-6 py-4 w-1/3">Title</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Priority</th>
              <th className="px-6 py-4">Project / Space</th>
              <th className="px-6 py-4">Due Date</th>
              <th className="px-6 py-4">Estimate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5 text-[14px] font-medium">
            {tasks.map(task => {
              const isDone = task.status === 'done';
              return (
                <tr key={task.id} onClick={() => onSelect(task.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(task.id)} className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer outline-none focus:bg-blue-50 dark:focus:bg-white/10 group">
                  <td className="px-6 py-4 text-gray-400 font-bold">
                    <div className="flex items-center gap-2.5">
                      {onTransition && (
                        <button onClick={(e) => { e.stopPropagation(); onTransition(task, isDone ? 'todo' : 'done'); }}
                          className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${isDone ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'}`}
                          title={isDone ? 'Mark as To Do' : 'Mark as Done'}>
                          {isDone && <Check size={10} strokeWidth={3} />}
                        </button>
                      )}
                      <span>{task.key}</span>
                    </div>
                  </td>
                  <td className={`px-6 py-4 truncate max-w-[300px] font-semibold ${isDone ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}>{task.title}</td>
                  <td className="px-6 py-4">
                    <span className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${(STATUSES as any)[task.status]?.dot || 'bg-gray-400'}`} />
                      {(STATUSES as any)[task.status]?.label || task.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <Flag size={14} className={(PRIORITIES as any)[task.priority]?.color} />
                      <span className="capitalize font-semibold text-xs">{(PRIORITIES as any)[task.priority]?.label || task.priority}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-xs font-semibold">
                    {task.project?.name || task.area?.name || 'General'}
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-xs font-semibold">{task.dueDate ? formatDisplayDate(task.dueDate) : '-'}</td>
                  <td className="px-6 py-4 text-gray-500 text-xs font-semibold">{task.estimated || '-'}</td>
                </tr>
              );
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-400 font-medium">No tasks found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
