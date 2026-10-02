import { WorkItem } from '../services/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "YYYY-MM-DDTHH:mm"; toISOString() would shift it to UTC. */
export const toLocalDateTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Time a task's day reminder uses when it has no time of its own. */
export const DEFAULT_REMINDER_TIME = '09:00';

/** The moment an item happens: an event's start, otherwise its due date at its time (or 9:00). */
export function anchorOf(item: Pick<WorkItem, 'entityType' | 'startAt' | 'dueDate' | 'startDate' | 'dueTime'>): string | null {
  if (item.entityType === 'event') return item.startAt ? item.startAt.slice(0, 16) : null;
  const date = item.dueDate || item.startDate;
  return date ? `${date.slice(0, 10)}T${item.dueTime || DEFAULT_REMINDER_TIME}` : null;
}

/**
 * When to remind for an item that has a lead time ("30 min before"), worked out
 * from its current date and time, so rescheduling moves the reminder with it.
 * Returns undefined when the item has no lead (its remindAt is set directly).
 */
export function remindAtFor(item: Pick<WorkItem, 'entityType' | 'startAt' | 'dueDate' | 'startDate' | 'dueTime' | 'reminderLeadMinutes'>): string | null | undefined {
  if (item.reminderLeadMinutes == null) return undefined;
  const anchor = anchorOf(item);
  if (!anchor) return null;
  return toLocalDateTime(new Date(new Date(anchor).getTime() - item.reminderLeadMinutes * 60000));
}

/** "6:00 pm" from "18:00". */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${pad(m || 0)} ${suffix}`;
}

/** Adds an item's time to a date label: "Due today · 6:00 pm". */
export function withTime(label: string | null | undefined, dueTime: string | null | undefined): string | null {
  if (!label) return dueTime ? formatTime(dueTime) : null;
  return dueTime ? `${label} · ${formatTime(dueTime)}` : label;
}

/** Sort key for a day's items: an event's start or a task's time; untimed items go last. */
export function timeOfDay(item: Pick<WorkItem, 'startAt' | 'dueTime'>): string {
  if (item.startAt) return new Date(item.startAt).toTimeString().slice(0, 5);
  return item.dueTime || '99:99';
}
