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
    <div className="relative overflow-hidden rounded-xl group select-none">
      {/* Background action reveals */}
      <div className="absolute inset-0 flex items-center justify-between px-4 rounded-xl text-white font-medium text-xs pointer-events-none">
        {/* Left reveal: Swipe Right Complete */}
        <div
          className={`flex items-center space-x-2 transition-opacity duration-150 ${
            dragOffset > 20 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
            <Check className="w-4 h-4 text-white stroke-[3]" />
          </div>
          <span className="font-semibold text-emerald-400">
            {item.is_completed ? 'Mark Active' : 'Complete'}
          </span>
        </div>

        {/* Right reveal: Swipe Left Delete */}
        <div
          className={`flex items-center space-x-2 transition-opacity duration-150 ${
            dragOffset < -20 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="font-semibold text-rose-400">Delete</span>
          <div className="w-8 h-8 rounded-full bg-rose-500 flex items-center justify-center shadow-lg">
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
        className={`relative z-10 flex items-center justify-between p-3.5 rounded-xl border transition-colors touch-pan-y ${
          isHighlighted
            ? 'ring-2 ring-blue-500/80 bg-zinc-800/90 border-blue-500/40 shadow-lg'
            : isSelected
            ? 'bg-blue-950/40 border-blue-500/40'
            : item.is_completed
            ? 'bg-zinc-900/40 border-zinc-800/40 text-zinc-400'
            : isBlocked
            ? 'bg-zinc-900/70 border-amber-500/30 text-zinc-300'
            : 'bg-zinc-900/95 border-zinc-800/90 hover:border-zinc-700 text-zinc-200 shadow-sm'
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
                className="w-4 h-4 rounded text-blue-600 bg-zinc-800 border-zinc-700 cursor-pointer shrink-0"
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
                className="w-4 h-4 rounded text-blue-600 bg-zinc-800 border-zinc-700 cursor-pointer shrink-0"
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
                <span title={`Blocked by: ${blockerTitles.join(', ')}`} className="text-amber-400 shrink-0">
                  <Lock className="w-3.5 h-3.5" />
                </span>
              )}
              <p className={`text-xs font-medium truncate ${item.is_completed ? 'line-through text-zinc-500' : ''}`}>
                {item.title}
              </p>
            </div>

            {/* Badges / Meta Info */}
            <div className="flex items-center space-x-2 mt-1 text-[11px] text-zinc-400 flex-wrap gap-y-1">
              {/* Due Date with Quick Reschedule */}
              {item.due_date && (
                <div className="relative inline-block">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsRescheduleOpen(prev => !prev);
                    }}
                    className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                      overdue
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 font-semibold'
                        : dueToday
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        : 'bg-zinc-800/80 text-zinc-300 border-zinc-700/60 hover:border-zinc-600'
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
                  className="flex items-center space-x-1 text-[10px] px-1.5 py-0.5 rounded border"
                  style={{
                    backgroundColor: `${matchedProject.color || '#3b82f6'}15`,
                    borderColor: `${matchedProject.color || '#3b82f6'}40`,
                    color: matchedProject.color || '#60a5fa'
                  }}
                >
                  <Folder className="w-2.5 h-2.5" />
                  <span>{matchedProject.name}</span>
                </span>
              )}

              {/* Context Tag */}
              {item.context_tags && (
                <span className="flex items-center space-x-1 text-[10px] text-zinc-400 bg-zinc-800/70 px-1.5 py-0.5 rounded border border-zinc-700/60">
                  <Tag className="w-2.5 h-2.5 text-zinc-400" />
                  <span>{item.context_tags}</span>
                </span>
              )}

              {/* Recurring rule */}
              {item.repeat_rule && (
                <span className="text-blue-400 text-[10px] flex items-center space-x-0.5 font-mono">
                  <RotateCw className="w-2.5 h-2.5" />
                  <span>{item.repeat_rule}</span>
                </span>
              )}

              {/* Subtasks Count */}
              {item.subtasks && item.subtasks.length > 0 && (
                <span className="text-[10px] text-zinc-400 font-mono">
                  ☑ {item.subtasks.filter(s => s.is_completed).length}/{item.subtasks.length}
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
              className="min-w-[32px] min-h-[32px] flex items-center justify-center text-zinc-500 hover:text-blue-400 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              {isRefining ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Priority Badge */}
          <span
            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
              item.priority === 'urgent'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : item.priority === 'high'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : item.priority === 'low'
                ? 'bg-zinc-800/80 text-zinc-400'
                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
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
            className="min-w-[32px] min-h-[32px] flex items-center justify-center text-zinc-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};
