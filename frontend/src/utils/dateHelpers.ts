import { WorkItem } from '../types';

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getThisWeekend(): string {
  const d = new Date();
  const currentDay = d.getDay(); // 0 = Sunday, 6 = Saturday
  const daysUntilSaturday = currentDay === 6 ? 7 : (6 - currentDay);
  d.setDate(d.getDate() + daysUntilSaturday);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextMonday(): string {
  const d = new Date();
  const currentDay = d.getDay(); // 0 = Sunday, 1 = Monday
  const daysUntilMonday = currentDay === 1 ? 7 : (currentDay === 0 ? 1 : 8 - currentDay);
  d.setDate(d.getDate() + daysUntilMonday);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  return dateStr.slice(0, 10);
}

export function isOverdue(dueDate?: string | null, isCompleted: boolean = false): boolean {
  if (isCompleted || !dueDate) return false;
  const dateOnly = normalizeDate(dueDate);
  if (!dateOnly) return false;
  return dateOnly < getTodayDateString();
}

export function isDueToday(dueDate?: string | null): boolean {
  if (!dueDate) return false;
  const dateOnly = normalizeDate(dueDate);
  return dateOnly === getTodayDateString();
}

export function isUpcoming(dueDate?: string | null): boolean {
  if (!dueDate) return false;
  const dateOnly = normalizeDate(dueDate);
  if (!dateOnly) return false;
  const today = getTodayDateString();
  if (dateOnly <= today) return false;

  const d = new Date();
  d.setDate(d.getDate() + 7);
  const weekOut = d.toISOString().slice(0, 10);
  return dateOnly <= weekOut;
}

export function formatRelativeDate(dueDate?: string | null): string {
  if (!dueDate) return 'No Date';
  const dateOnly = normalizeDate(dueDate);
  if (!dateOnly) return 'No Date';

  const today = getTodayDateString();
  const tomorrow = getTomorrowDateString();
  const yesterday = getYesterdayDateString();

  if (dateOnly === today) return 'Today';
  if (dateOnly === tomorrow) return 'Tomorrow';
  if (dateOnly === yesterday) return 'Yesterday';

  const dateObj = new Date(`${dateOnly}T00:00:00`);
  if (isNaN(dateObj.getTime())) return dateOnly;

  const diffDays = Math.round((dateObj.getTime() - new Date(`${today}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays > 0 && diffDays <= 6) {
    return dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface SmartGroupedTasks {
  overdue: WorkItem[];
  today: WorkItem[];
  upcoming: WorkItem[];
  backlog: WorkItem[];
}

export function groupTasksBySmartDate(items: WorkItem[]): SmartGroupedTasks {
  const result: SmartGroupedTasks = {
    overdue: [],
    today: [],
    upcoming: [],
    backlog: []
  };

  const todayStr = getTodayDateString();

  for (const item of items) {
    if (!item.due_date) {
      result.backlog.push(item);
      continue;
    }

    const dateOnly = normalizeDate(item.due_date);
    if (!dateOnly) {
      result.backlog.push(item);
      continue;
    }

    if (!item.is_completed && dateOnly < todayStr) {
      result.overdue.push(item);
    } else if (dateOnly === todayStr) {
      result.today.push(item);
    } else if (isUpcoming(item.due_date)) {
      result.upcoming.push(item);
    } else {
      result.backlog.push(item);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

/**
 * The exact moment an item happens, when it has one.
 *
 * A capture like "finish work by 18:30" stores 18:30 in remind_at, and an
 * event stores it in start_at with remind_at a quarter of an hour earlier. A
 * due_date on its own carries no time and is not a moment.
 */
export function itemMoment(item: Pick<WorkItem, 'entity_type' | 'start_at' | 'remind_at'>): string | null {
  if (item.entity_type === 'event') return item.start_at || item.remind_at || null;
  return item.remind_at || item.start_at || null;
}

/** "6:30 pm" from an ISO timestamp, or null if there is no usable time in it. */
export function formatTimeOfDay(iso?: string | null): string | null {
  if (!iso) return null;
  const moment = new Date(iso);
  if (isNaN(moment.getTime())) return null;
  return moment
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();
}

/** The clock part of an ISO timestamp as "18:30", for a time input. */
export function timeInputValue(iso?: string | null): string {
  if (!iso) return '';
  const moment = new Date(iso);
  if (isNaN(moment.getTime())) return '';
  return `${String(moment.getHours()).padStart(2, '0')}:${String(moment.getMinutes()).padStart(2, '0')}`;
}

/**
 * When an item is due, in the words a person would use: "Today, 6:30 pm".
 *
 * The time is the whole point of a reminder, so it is never dropped when the
 * item has one.
 */
export function formatWhen(item: Pick<WorkItem, 'entity_type' | 'due_date' | 'start_at' | 'remind_at'>): string {
  const moment = itemMoment(item);
  const day = normalizeDate(moment || item.due_date);
  if (!day) return 'No date';

  const time = formatTimeOfDay(moment);
  const when = formatRelativeDate(day);
  return time ? `${when}, ${time}` : when;
}

/**
 * Put a date and a time of day together into the fields an item stores.
 *
 * An event starts at the moment and is nudged a quarter of an hour before it,
 * which is what the capture parser does; anything else is simply due then.
 * Clearing the time leaves the date and removes the moment.
 */
export function withTimeOfDay(
  entityType: WorkItem['entity_type'],
  date: string | null,
  time: string | null
): { due_date: string | null; start_at: string | null; remind_at: string | null } {
  if (!date) return { due_date: null, start_at: null, remind_at: null };
  if (!time) return { due_date: date, start_at: null, remind_at: null };

  const moment = new Date(`${date}T${time}:00`);
  if (isNaN(moment.getTime())) return { due_date: date, start_at: null, remind_at: null };

  const iso = `${date}T${time}:00`;
  if (entityType === 'event') {
    const lead = new Date(moment.getTime() - 15 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const leadIso =
      `${lead.getFullYear()}-${pad(lead.getMonth() + 1)}-${pad(lead.getDate())}` +
      `T${pad(lead.getHours())}:${pad(lead.getMinutes())}:00`;
    return { due_date: date, start_at: iso, remind_at: leadIso };
  }
  return { due_date: date, start_at: iso, remind_at: iso };
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * Whether an item's moment has already gone by.
 *
 * isOverdue() only knows about days, so something due at 18:30 does not read
 * as late until tomorrow. On a screen about today that is exactly backwards:
 * by 19:00 it is the most late thing there is.
 */
export function isPastDue(
  item: Pick<WorkItem, 'entity_type' | 'due_date' | 'start_at' | 'remind_at' | 'is_completed'>,
  now: Date = new Date()
): boolean {
  if (item.is_completed) return false;
  const moment = itemMoment(item);
  if (moment) {
    const at = new Date(moment);
    if (!isNaN(at.getTime())) return at.getTime() < now.getTime();
  }
  return isOverdue(item.due_date, item.is_completed);
}

/**
 * Chronological order, which is the order a day actually happens in.
 *
 * Anything with a time comes first, soonest first, because that is what "next"
 * means. Items with no time follow, most urgent first, since nothing about
 * the clock can separate them.
 */
export function compareBySchedule(
  a: Pick<WorkItem, 'entity_type' | 'due_date' | 'start_at' | 'remind_at' | 'priority'>,
  b: Pick<WorkItem, 'entity_type' | 'due_date' | 'start_at' | 'remind_at' | 'priority'>
): number {
  const aAt = itemMoment(a);
  const bAt = itemMoment(b);

  if (aAt && bAt) {
    const difference = new Date(aAt).getTime() - new Date(bAt).getTime();
    if (difference !== 0) return difference;
  } else if (aAt) {
    return -1;
  } else if (bAt) {
    return 1;
  }

  const aDay = normalizeDate(a.due_date);
  const bDay = normalizeDate(b.due_date);
  if (aDay && bDay && aDay !== bDay) return aDay < bDay ? -1 : 1;
  if (aDay && !bDay) return -1;
  if (bDay && !aDay) return 1;

  return (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
}
