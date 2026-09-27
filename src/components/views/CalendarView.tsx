import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { parseDateString, getTodayString } from '../../utils/dateUtils';

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
  
  // Calendar grid math (start on Sunday)
  const startDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = i - startDay + 1;
    const isCurrentMonth = day > 0 && day <= daysInMonth;
    const dateStr = isCurrentMonth ? `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
    return { day, isCurrentMonth, dateStr };
  });

  return (
    <div className="h-full flex flex-col min-h-[600px] overflow-hidden">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="text-xl font-bold">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
        <div className="flex gap-2">
          <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg"><ChevronLeft size={20}/></button>
          <button onClick={() => setCurrentMonth(new Date())} className="px-3 py-1 text-[13px] font-bold hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg">Today</button>
          <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg"><ChevronRight size={20}/></button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-7 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20 shrink-0">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="p-3 text-center text-[12px] font-bold text-gray-400 uppercase tracking-wider">{d}</div>
          ))}
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar">
           <div className="grid grid-cols-7 auto-rows-fr h-full min-h-[500px]">
             {cells.map((cell, i) => (
               <div key={i} className={`min-h-[100px] p-2 border-b border-r border-gray-100 dark:border-white/5 ${!cell.isCurrentMonth ? 'bg-gray-50/50 dark:bg-white/[0.02]' : ''} ${(i+1)%7===0 ? 'border-r-0' : ''}`}>
                 {cell.isCurrentMonth && (
                   <>
                     <div className={`text-[12px] font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${cell.dateStr === getTodayString() ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
                       {cell.day}
                     </div>
                     <div className="space-y-1">
                       {cell.dateStr && dates.get(cell.dateStr)?.map(task => (
                         <div key={task.id} onClick={() => onSelect(task.id)} className={`text-[11px] font-bold px-1.5 py-1 rounded truncate cursor-pointer hover:opacity-80 
                           ${task.entityType === 'event' ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30' : 
                             task.entityType === 'reminder' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                             task.status === 'done' ? 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400 line-through' : 'bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400'}`}>
                           {task.title}
                         </div>
                       ))}
                     </div>
                   </>
                 )}
               </div>
             ))}
           </div>
        </div>
      </div>
    </div>
  );
}
