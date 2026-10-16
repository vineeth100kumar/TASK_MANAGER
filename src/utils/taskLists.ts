import { WorkItem, LifeContext } from '../services/types';
import { timeOfDay } from './reminders';

// Today and Inbox are built from these rules, so every open item has a place
// and the two screens agree on what "today" and "open" mean.

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const dayOf = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

// Older or imported records can say "Personal" or "life"; anything else is work.
export function contextOf(i: Pick<WorkItem, 'lifeContext'>): LifeContext {
  const c = String(i.lifeContext || '').toLowerCase();
  return c === 'personal' || c === 'life' ? 'personal' : 'work';
}

export const inContext = (i: WorkItem, ctx?: LifeContext) => !ctx || contextOf(i) === ctx;

// LUMO alarms are stored as reminders but live on the LUMO page.
export const isAlarm = (i: WorkItem) =>
  (i.labels || []).includes('alarm') && ((i as any).source === 'lumo' || !!i.customFields?.alarm || i.customFields?.source === 'lumo');

export const isOpen = (i: WorkItem) => !!i && !i.deletedAt && i.status !== 'done';

export const isSnoozedNow = (i: WorkItem, now = Date.now()) =>
  !!i.snoozedUntil && new Date(i.snoozedUntil).getTime() > now;

// When an item is planned for: due date, else start, else event start.
export const planDay = (i: WorkItem) => dayOf(i.dueDate) || dayOf(i.startAt) || dayOf(i.startDate);

export const isOverdue = (i: WorkItem, today: string) => {
  const d = planDay(i);
  return !!d && d < today;
};

// On Today: overdue, due or starting today, spanning today, or starred.
export function isOnToday(i: WorkItem, today: string): boolean {
  const due = dayOf(i.dueDate);
  const start = dayOf(i.startDate);
  if (isOverdue(i, today)) return true;
  if (due === today || dayOf(i.startAt) === today) return true;
  if (start && start <= today && due && due >= today) return true;
  return !!i.isFocus;
}

// Overdue first, then priority, then time of day, then oldest first.
export function compareToday(today: string) {
  return (a: WorkItem, b: WorkItem) =>
    Number(isOverdue(b, today)) - Number(isOverdue(a, today))
    || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
    || Number(!!b.isFocus) - Number(!!a.isFocus)
    || (timeOfDay(a) || '99').localeCompare(timeOfDay(b) || '99')
    || (a.createdAt || '').localeCompare(b.createdAt || '');
}

// Inbox order: overdue, today, later by date, then undated; priority inside each day.
export function compareInbox(today: string) {
  return (a: WorkItem, b: WorkItem) => {
    const da = planDay(a) || '9999-99-99';
    const db = planDay(b) || '9999-99-99';
    const ga = da < today ? '0000' : da;
    const gb = db < today ? '0000' : db;
    return ga.localeCompare(gb)
      || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
      || da.localeCompare(db)
      || (timeOfDay(a) || '99').localeCompare(timeOfDay(b) || '99')
      || (a.createdAt || '').localeCompare(b.createdAt || '');
  };
}

export interface VisibilityCheck {
  open: number;        // open, not deleted, in this context
  listed: number;      // of those, shown in the Inbox list
  alarms: number;      // LUMO alarms, shown on the LUMO page instead
  otherContext: number; // open items hidden by the Work/Personal switch
  missing: WorkItem[]; // open items with no place at all (should stay empty)
}

// Every open item must be in the Inbox list, on the LUMO page (alarms), or
// behind the Work/Personal switch. Anything else is reported as missing.
export function checkVisibility(all: WorkItem[], listedIds: Set<string>, ctx?: LifeContext): VisibilityCheck {
  const open = all.filter(isOpen);
  const here = open.filter(i => inContext(i, ctx));
  const alarms = here.filter(isAlarm);
  const missing = here.filter(i => !isAlarm(i) && !listedIds.has(i.id));
  return {
    open: here.length,
    listed: here.length - alarms.length - missing.length,
    alarms: alarms.length,
    otherContext: open.length - here.length,
    missing
  };
}
