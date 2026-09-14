import React from 'react';
import { WorkItem } from '../../types';
import { clsx } from 'clsx';

export interface TaskClippingProps {
  item: WorkItem;
  onToggle: (item: WorkItem) => void;
}

export const TaskClipping: React.FC<TaskClippingProps> = ({ item, onToggle }) => {
  const priorityBorder = {
    urgent: 'border-l-[3px] border-l-[#8B1A1A]',
    high:   'border-l-[3px] border-l-[#8B5E00]',
    medium: 'border-l-[2px] border-l-ink-faint',
    low:    '',
  }[item.priority];

  return (
    <div
      className={clsx(
        'flex items-start gap-2 py-[5px] border-b border-ink-rule/40 last:border-b-0 cursor-pointer group select-none',
        priorityBorder,
        item.priority === 'urgent' || item.priority === 'high' ? 'pl-2' : ''
      )}
      onClick={() => onToggle(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(item);
        }
      }}
    >
      {/* Bullet / Check indicator */}
      <div
        className={clsx(
          'w-[7px] h-[7px] rounded-full border-[1.5px] border-ink-primary flex-shrink-0 mt-[4px]',
          item.is_completed ? 'bg-ink-primary' : 'bg-transparent'
        )}
      />
      {/* Title */}
      <span
        className={clsx(
          'font-editorial text-[11px] text-ink-primary leading-snug flex-1',
          item.is_completed && 'line-through text-ink-faint'
        )}
      >
        {item.title}
      </span>
      {/* Priority or Done badge */}
      {item.priority === 'urgent' && !item.is_completed && (
        <span className="font-sans text-[8px] font-bold tracking-wide uppercase border border-ink-danger text-ink-danger px-1 flex-shrink-0">
          Urgent
        </span>
      )}
      {item.is_completed && (
        <span className="font-sans text-[8px] font-bold tracking-wide uppercase border border-ink-faint text-ink-faint px-1 flex-shrink-0">
          Done
        </span>
      )}
    </div>
  );
};
