import React from 'react';
import { TaskPriority, TaskStatus } from '../../types';

export interface BadgeProps {
  variant?: 'priority' | 'status' | 'neutral' | 'custom';
  priority?: TaskPriority;
  status?: TaskStatus | 'achieved' | 'pending';
  color?: string;
  size?: 'xs' | 'sm';
  className?: string;
  children?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  priority,
  status,
  color,
  size = 'xs',
  className = '',
  children
}) => {
  const sizeClass = size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[11px] px-2.5 py-0.5';

  if (variant === 'priority' && priority) {
    const priorityStyles: Record<TaskPriority, string> = {
      urgent: 'bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-500/30',
      high: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30',
      medium: 'bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-500/30',
      low: 'bg-paper-aged dark:bg-stone-800 text-ink-muted dark:text-stone-400 border border-ink-base/20 dark:border-stone-700'
    };
    return (
      <span className={`inline-flex items-center uppercase font-bold rounded font-ledger tracking-wider ${sizeClass} ${priorityStyles[priority]} ${className}`}>
        {children || priority}
      </span>
    );
  }

  if (variant === 'status' && status) {
    const statusStyles: Record<string, string> = {
      done: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30',
      achieved: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30',
      todo: 'bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-500/30',
      in_progress: 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-300 border border-indigo-500/30',
      blocked: 'bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-500/30',
      pending: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30',
      inbox: 'bg-paper-aged dark:bg-stone-800 text-ink-muted dark:text-stone-400 border border-ink-base/20 dark:border-stone-700',
      archived: 'bg-paper-aged dark:bg-stone-800 text-ink-muted/70 dark:text-stone-500 border border-ink-base/15 dark:border-stone-700'
    };
    return (
      <span className={`inline-flex items-center uppercase font-bold rounded font-ledger tracking-wider ${sizeClass} ${statusStyles[status] || 'bg-paper-aged dark:bg-stone-800 text-ink-muted dark:text-stone-400'} ${className}`}>
        {children || status}
      </span>
    );
  }

  if (variant === 'custom' && color) {
    return (
      <span
        className={`inline-flex items-center gap-1 font-medium font-ledger rounded border ${sizeClass} ${className}`}
        style={{
          backgroundColor: `${color}15`,
          borderColor: `${color}40`,
          color: color
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        {children}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center rounded bg-paper-aged dark:bg-stone-800 text-ink-base dark:text-stone-300 border border-ink-base/20 dark:border-stone-700 font-ledger uppercase tracking-wider ${sizeClass} ${className}`}>
      {children}
    </span>
  );
};
