import React, { useState } from 'react';
import { motion, PanInfo } from 'framer-motion';
import { Check, Trash2, Lock, Sparkles, RotateCw, Calendar, Tag, Folder } from 'lucide-react';
import { WorkItem, Project } from '../../types';
import { haptics } from '../../utils/haptics';
import { formatRelativeDate, isOverdue, isDueToday } from '../../utils/dateHelpers';
import { ReschedulePopover } from '../tasks/ReschedulePopover';

export interface ListRowProps {
  item: WorkItem;
  projects?: Project[];
  isSelected?: boolean;
  isSelectMode?: boolean;
  isHighlighted?: boolean;
  isBlocked?: boolean;
  blockerTitles?: string[];
  isRefining?: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleComplete: (item: WorkItem) => void;
  onDelete: (id: string) => void;
  onClick: (item: WorkItem) => void;
  onRefine?: (item: WorkItem) => void;
  onReschedule?: (item: WorkItem, newDate: string | null) => void;
}

export const ListRow: React.FC<ListRowProps> = ({
  item,
  projects = [],
  isSelected = false,
  isSelectMode = false,
  isHighlighted = false,
  isBlocked = false,
  blockerTitles = [],
  isRefining = false,
  onToggleSelect,
  onToggleComplete,
  onDelete,
  onClick,
  onRefine,
  onReschedule
}) => {
  const [dragOffset, setDragOffset] = useState(0);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);

  const matchedProject = item.project_id ? projects.find(p => p.id === item.project_id) : undefined;
  const overdue = isOverdue(item.due_date, item.is_completed);
  const dueToday = isDueToday(item.due_date);

  const handleDrag = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setDragOffset(info.offset.x);
  };

  const handleDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const threshold = 65;
    if (info.offset.x >= threshold) {
      // Swipe Right -> Toggle Complete
      haptics.medium();
      onToggleComplete(item);
    } else if (info.offset.x <= -threshold) {
      // Swipe Left -> Delete
      haptics.warning();
      onDelete(item.id);
    }
    setDragOffset(0);
  };

  return (
    <div className="relative overflow-hidden rounded-none group select-none border border-stone-800/80 mb-2">
      {/* Background action reveals */}
      <div className="absolute inset-0 flex items-center justify-between px-4 text-white font-medium text-xs pointer-events-none rounded-none">
        {/* Left reveal: Swipe Right Complete */}
        <div
          className={`flex items-center space-x-2 transition-opacity duration-150 ${
            dragOffset > 20 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="w-7 h-7 rounded-none bg-emerald-600 flex items-center justify-center border border-emerald-400">
            <Check className="w-4 h-4 text-white stroke-[3]" />
          </div>
          <span className="font-ledger font-bold text-emerald-400 text-xs uppercase tracking-wider">
            {item.is_completed ? 'Mark Active' : 'Complete'}
          </span>
        </div>

        {/* Right reveal: Swipe Left Delete */}
        <div
          className={`flex items-center space-x-2 transition-opacity duration-150 ${
            dragOffset < -20 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="font-ledger font-bold text-rose-400 text-xs uppercase tracking-wider">Delete</span>
          <div className="w-7 h-7 rounded-none bg-rose-600 flex items-center justify-center border border-rose-400">
            <Trash2 className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>

      {/* Foreground Interactive Card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.4}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        className={`relative z-10 flex items-center justify-between p-3 rounded-none border-b transition-colors touch-pan-y ${
          isHighlighted
            ? 'bg-[#18181f] border-amber-500/80'
            : isSelected
            ? 'bg-amber-950/30 border-amber-500/40'
            : item.is_completed
            ? 'bg-[#0f0f12] border-stone-800/50 text-stone-500'
            : isBlocked
            ? 'bg-[#141418] border-amber-600/30 text-stone-300'
            : 'bg-[#131317] border-stone-800 hover:border-stone-700 text-stone-200'
        }`}
      >
        <div className="flex items-center space-x-3.5 flex-1 min-w-0">
          {/* Multi-select checkbox or Task complete checkbox */}
          {isSelectMode ? (
            <div
              onClick={(e) => {
                e.stopPropagation();
                haptics.light();
                onToggleSelect?.(item.id);
              }}
              className="p-1 -m-1 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {}}
                className="w-4 h-4 rounded-none accent-amber-500 cursor-pointer shrink-0"
              />
            </div>
          ) : (
            <div
              onClick={(e) => {
                e.stopPropagation();
                haptics.light();
                onToggleComplete(item);
              }}
              className="p-1 -m-1 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={item.is_completed}
                onChange={() => {}}
                className="w-4 h-4 rounded-none accent-amber-500 cursor-pointer shrink-0"
              />
            </div>
          )}

          {/* Task Info Content */}
          <div
            onClick={() => onClick(item)}
            className="cursor-pointer min-w-0 flex-1 py-0.5"
          >
            <div className="flex items-center gap-1.5">
              {isBlocked && (
                <span title={`Blocked by: ${blockerTitles.join(', ')}`} className="text-amber-500 shrink-0 font-ledger text-[10px]">
                  [BLOCKED]
                </span>
              )}
              <p className={`font-editorial text-sm font-semibold tracking-tight text-stone-100 truncate ${item.is_completed ? 'line-through text-stone-500 italic' : ''}`}>
                {item.title}
              </p>
            </div>

            {/* Badges / Meta Info */}
            <div className="flex items-center space-x-2 mt-1 text-[10px] font-ledger text-stone-400 flex-wrap gap-y-1">
              {/* Due Date with Quick Reschedule */}
              {item.due_date && (
                <div className="relative inline-block">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsRescheduleOpen(prev => !prev);
                    }}
                    className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-none text-[9px] font-ledger uppercase tracking-wider border transition-colors ${
                      overdue
                        ? 'bg-rose-950/40 text-rose-300 border-rose-800 font-bold'
                        : dueToday
                        ? 'bg-amber-950/40 text-amber-300 border-amber-800'
                        : 'bg-stone-900 text-stone-300 border-stone-700 hover:border-stone-600'
                    }`}
                  >
                    <Calendar className="w-2.5 h-2.5" />
                    <span>{formatRelativeDate(item.due_date)}</span>
                  </button>

                  <ReschedulePopover
                    isOpen={isRescheduleOpen}
                    onClose={() => setIsRescheduleOpen(false)}
                    currentDueDate={item.due_date}
                    onSelectDate={(newDate) => onReschedule?.(item, newDate)}
                  />
                </div>
              )}

              {/* Project Badge */}
              {matchedProject && (
                <span
                  className="flex items-center space-x-1 text-[9px] font-ledger uppercase tracking-wider px-1.5 py-0.5 rounded-none border border-stone-700 bg-stone-900 text-stone-300"
                >
                  <Folder className="w-2.5 h-2.5 text-amber-500" />
                  <span>{matchedProject.name}</span>
                </span>
              )}

              {/* Context Tag */}
              {item.context_tags && (
                <span className="flex items-center space-x-1 text-[9px] font-ledger uppercase tracking-wider text-stone-400 bg-stone-900 px-1.5 py-0.5 rounded-none border border-stone-800">
                  <Tag className="w-2.5 h-2.5 text-stone-400" />
                  <span>{item.context_tags}</span>
                </span>
              )}

              {/* Recurring rule */}
              {item.repeat_rule && (
                <span className="text-amber-400 text-[9px] flex items-center space-x-0.5 font-ledger uppercase">
                  <RotateCw className="w-2.5 h-2.5" />
                  <span>{item.repeat_rule}</span>
                </span>
              )}

              {/* Subtasks Count */}
              {item.subtasks && item.subtasks.length > 0 && (
                <span className="text-[9px] text-stone-400 font-ledger">
                  [{item.subtasks.filter(s => s.is_completed).length}/{item.subtasks.length}]
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center space-x-2 shrink-0 ml-2">
          {onRefine && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                haptics.light();
                onRefine(item);
              }}
              disabled={isRefining}
              title="Polish with AI"
              aria-label="Polish with AI"
              className="min-w-[30px] min-h-[30px] flex items-center justify-center text-stone-500 hover:text-amber-400 p-1 border border-stone-800 rounded-none hover:bg-stone-800 transition-colors"
            >
              {isRefining ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Priority Badge */}
          <span
            className={`text-[9px] uppercase font-ledger font-bold px-1.5 py-0.5 rounded-none border ${
              item.priority === 'urgent'
                ? 'bg-rose-950 text-rose-300 border-rose-700'
                : item.priority === 'high'
                ? 'bg-amber-950 text-amber-300 border-amber-700'
                : item.priority === 'low'
                ? 'bg-stone-900 text-stone-400 border-stone-800'
                : 'bg-stone-900 text-stone-300 border-stone-700'
            }`}
          >
            {item.priority}
          </span>

          {/* Desktop delete icon */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            aria-label={`Delete task: ${item.title}`}
            className="min-w-[30px] min-h-[30px] flex items-center justify-center text-stone-500 hover:text-rose-400 p-1 border border-stone-800 rounded-none hover:bg-stone-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};
