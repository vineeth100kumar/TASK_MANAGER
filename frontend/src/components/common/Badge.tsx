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

/*
 * Badges are sentence case and mostly quiet. Colour is reserved for the two
 * states that need attention — urgent and blocked — so a screen full of badges
 * does not read as a screen full of alarms.
 */
export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  priority,
  status,
  color,
  size = 'xs',
  className = '',
  children,
}) => {
  const base = 'inline-flex items-center rounded-md font-medium whitespace-nowrap';
  const sizeClass = size === 'xs' ? 'text-caption px-1.5 py-0.5' : 'text-meta px-2 py-0.5';
  const quiet = 'bg-sunken text-ink-2';

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

  if (variant === 'priority' && priority) {
    const styles: Record<TaskPriority, string> = {
      urgent: 'bg-late-500/12 text-late-600 dark:text-late-300',
      high: quiet,
      medium: quiet,
      low: quiet,
    };
    return (
      <span className={`${base} ${sizeClass} ${styles[priority]} ${className}`}>
        {children || cap(priority)}
      </span>
    );
  }

  if (variant === 'status' && status) {
    const styles: Record<string, string> = {
      done: 'bg-done-500/12 text-done-600 dark:text-done-400',
      achieved: 'bg-done-500/12 text-done-600 dark:text-done-400',
      blocked: 'bg-late-500/12 text-late-600 dark:text-late-300',
      in_progress: 'bg-accent-500/12 text-accent-600 dark:text-accent-400',
      todo: quiet,
      pending: quiet,
      inbox: quiet,
      archived: 'bg-sunken text-ink-3',
    };
    return (
      <span className={`${base} ${sizeClass} ${styles[status] || quiet} ${className}`}>
        {children || cap(status)}
      </span>
    );
  }

  // Project colours are the user's own choice, so they stay as set — shown as a
  // dot beside quiet text rather than tinting the whole badge.
  if (variant === 'custom' && color) {
    return (
      <span className={`${base} ${sizeClass} ${quiet} gap-1.5 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        {children}
      </span>
    );
  }

  return <span className={`${base} ${sizeClass} ${quiet} ${className}`}>{children}</span>;
};
