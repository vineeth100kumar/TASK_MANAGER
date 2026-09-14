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
