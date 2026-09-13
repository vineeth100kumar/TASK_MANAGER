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
  const sizeClass = size === 'xs' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  if (variant === 'priority' && priority) {
    const priorityStyles: Record<TaskPriority, string> = {
      urgent: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
      high: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
      medium: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
      low: 'bg-zinc-800 text-zinc-400 border border-zinc-700'
    };
    return (
      <span className={`inline-flex items-center uppercase font-bold rounded-md font-mono ${sizeClass} ${priorityStyles[priority]} ${className}`}>
        {children || priority}
      </span>
    );
  }

  if (variant === 'status' && status) {
    const statusStyles: Record<string, string> = {
      done: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
      achieved: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
      todo: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
      in_progress: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
      blocked: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
      pending: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
      inbox: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
      archived: 'bg-zinc-800 text-zinc-500 border border-zinc-700'
    };
    return (
      <span className={`inline-flex items-center uppercase font-bold rounded-md font-mono ${sizeClass} ${statusStyles[status] || 'bg-zinc-800 text-zinc-400'} ${className}`}>
        {children || status}
      </span>
    );
  }

  if (variant === 'custom' && color) {
    return (
      <span
        className={`inline-flex items-center gap-1 font-medium rounded-md border ${sizeClass} ${className}`}
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
    <span className={`inline-flex items-center rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700 font-medium ${sizeClass} ${className}`}>
      {children}
    </span>
  );
};
