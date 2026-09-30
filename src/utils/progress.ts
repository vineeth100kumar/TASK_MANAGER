import { api } from '../services/api';
import { LifeContext } from '../services/types';

const sameLocalDay = (iso: string, day: Date) => {
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
};

// How many items were finished today (local time), optionally in one life context.
export function countDoneToday(lifeContext?: LifeContext): number {
  const today = new Date();
  return api.sync.getState().workItems.filter(i =>
    i && !i.deletedAt && i.status === 'done' && i.completedAt && sameLocalDay(i.completedAt, today) &&
    (!lifeContext || (i.lifeContext || 'work') === lifeContext)
  ).length;
}

// The toast after finishing something: short, and counts the day's progress.
export function doneMessage(count: number): string {
  if (count <= 1) return 'Done. First one today';
  return `Done. That's ${count} today`;
}

// A short tap on phones that support it, so a completed swipe or tick is felt.
export function haptic(pattern: number | number[] = 10): void {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// "just now", "5m ago", "3h ago", "yesterday", "Sep 12"
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso);
  const diff = Date.now() - then.getTime();
  if (isNaN(diff)) return '';
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24 && sameLocalDay(iso, new Date())) return `${hours}h ago`;
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(iso, yesterday)) return 'yesterday';
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
