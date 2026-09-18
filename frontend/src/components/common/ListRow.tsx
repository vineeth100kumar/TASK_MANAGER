import React, { useState } from 'react';
import { motion, PanInfo } from 'framer-motion';
import { Check, Trash2, Sparkles, RotateCw, Folder } from 'lucide-react';
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

/*
 * A task, as a row in a list rather than a bordered card.
 *
 * The task's own title is the largest thing in it. Its metadata is one quiet
 * line underneath, and only the two states that need attention — overdue and
 * blocked — carry any colour. Row actions stay hidden until hover on desktop;
 * on touch, the swipe gestures are the primary route and remain unchanged.
 */
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
  onReschedule,
}) => {
  const [dragOffset, setDragOffset] = useState(0);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);

  const matchedProject = item.project_id ? projects.find((p) => p.id === item.project_id) : undefined;
  const overdue = isOverdue(item.due_date, item.is_completed);
  const dueToday = isDueToday(item.due_date);

  const handleDrag = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setDragOffset(info.offset.x);
  };

  const handleDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const threshold = 65;
    if (info.offset.x >= threshold) {
      haptics.medium();
      onToggleComplete(item);
    } else if (info.offset.x <= -threshold) {
      haptics.warning();
      onDelete(item.id);
    }
    setDragOffset(0);
  };

  return (
    <div className="relative overflow-hidden group select-none border-b border-hairline last:border-b-0">
      {/* What the swipe will do, revealed as you drag */}
      <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
        <span
          className={`flex items-center gap-1.5 text-meta font-medium text-done-500 dark:text-done-400 transition-opacity duration-150 ${
            dragOffset > 20 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Check className="w-4 h-4" strokeWidth={2.5} />
          {item.is_completed ? 'Reopen' : 'Done'}
        </span>

        <span
          className={`flex items-center gap-1.5 text-meta font-medium text-danger-600 dark:text-danger-400 transition-opacity duration-150 ${
            dragOffset < -20 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          Delete
          <Trash2 className="w-4 h-4" />
        </span>
      </div>

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.4}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        className={`relative z-10 flex items-start gap-3 px-1 py-3 touch-pan-y transition-colors duration-150 ${
          isHighlighted || isSelected ? 'bg-accent-500/8' : 'bg-ground'
        }`}
        style={{ minHeight: 44 }}
      >
        {/* Complete, or select when in multi-select mode */}
        {isSelectMode ? (
          <button
            role="checkbox"
            aria-checked={isSelected}
            aria-label={isSelected ? `Deselect ${item.title}` : `Select ${item.title}`}
            data-checked={isSelected}
            onClick={(e) => {
              e.stopPropagation();
              haptics.light();
              onToggleSelect?.(item.id);
            }}
            className="check mt-0.5"
          />
        ) : (
          <button
            role="checkbox"
            aria-checked={item.is_completed}
            aria-label={item.is_completed ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
            data-checked={item.is_completed}
            onClick={(e) => {
              e.stopPropagation();
              haptics.light();
              onToggleComplete(item);
            }}
            className="check mt-0.5"
          />
        )}

        <div onClick={() => onClick(item)} className="cursor-pointer min-w-0 flex-1">
          <p className={`text-body ${item.is_completed ? 'text-ink-3 line-through' : 'text-ink'}`}>
            {item.title}
          </p>

          {/* One quiet line of metadata, not a row of boxes */}
          <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap mt-0.5 text-meta text-ink-3">
            {isBlocked && (
              <span
                title={`Blocked by ${blockerTitles.join(', ')}`}
                className="text-late-500 dark:text-late-400"
              >
                Blocked
              </span>
            )}

            {item.due_date && (
              <span className="relative inline-block">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsRescheduleOpen((prev) => !prev);
                  }}
                  className={`hover:text-ink transition-colors ${
                    overdue
                      ? 'text-late-500 dark:text-late-400 font-medium'
                      : dueToday
                      ? 'text-ink-2'
                      : ''
                  }`}
                >
                  {formatRelativeDate(item.due_date)}
                </button>

                <ReschedulePopover
                  isOpen={isRescheduleOpen}
                  onClose={() => setIsRescheduleOpen(false)}
                  currentDueDate={item.due_date}
                  onSelectDate={(newDate) => onReschedule?.(item, newDate)}
                />
              </span>
            )}

            {matchedProject && (
              <span className="flex items-center gap-1 min-w-0">
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{matchedProject.name}</span>
              </span>
            )}

            {item.context_tags && <span className="truncate">{item.context_tags}</span>}

            {item.repeat_rule && (
              <span className="flex items-center gap-1">
                <RotateCw className="w-3.5 h-3.5" />
                {item.repeat_rule}
              </span>
            )}

            {item.subtasks && item.subtasks.length > 0 && (
              <span className="tabular">
                {item.subtasks.filter((s) => s.is_completed).length}/{item.subtasks.length}
              </span>
            )}

            {item.priority === 'urgent' && !item.is_completed && (
              <span className="text-late-500 dark:text-late-400 font-medium">Urgent</span>
            )}
          </div>
        </div>

        {/* Quiet until you reach for them */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
          {onRefine && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                haptics.light();
                onRefine(item);
              }}
              disabled={isRefining}
              title="Polish with AI"
              aria-label={`Polish ${item.title} with AI`}
              className="w-9 h-9 flex items-center justify-center rounded-control text-ink-3 hover:text-ink hover:bg-sunken transition-colors"
            >
              {isRefining ? (
                <RotateCw className="w-4 h-4 animate-spin text-accent-500" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            aria-label={`Delete ${item.title}`}
            className="w-9 h-9 flex items-center justify-center rounded-control text-ink-3 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-sunken transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};
