import { WorkItem, LifeContext } from '../services/types';
import { timeOfDay } from './reminders';

// Today and Inbox are built from these rules, so every open item has a place
// and the two screens agree on what "today" and "open" mean.

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const dayOf = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

import { contextOf, isAlarm } from '../services/items';
export { contextOf, isAlarm };

export const inContext = (i: WorkItem, ctx?: LifeContext) => !ctx || contextOf(i) === ctx;

export const isOpen = (i: WorkItem) => !!i && !i.deletedAt && i.status !== 'done';

export const isSnoozedNow = (i: WorkItem, now = Date.now()) =>
  !!i.snoozedUntil && new Date(i.snoozedUntil).getTime() > now;

// When an item is planned for: due date, else start, else event start.
export const planDay = (i: WorkItem) => dayOf(i.dueDate) || dayOf(i.startAt) || dayOf(i.startDate);

export const isOverdue = (i: WorkItem, today: string) => {
  if (i.status === 'done') return false; // a reached milestone or finished task is history
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
// Alarms are counted on their own: they are never among the items listed.
export function checkVisibility(all: WorkItem[], listedIds: Set<string>, ctx?: LifeContext, alarmCount = 0): VisibilityCheck {
  const open = all.filter(isOpen);
  const here = open.filter(i => inContext(i, ctx) && !isAlarm(i));
  const missing = here.filter(i => !listedIds.has(i.id));
  return {
    open: here.length + alarmCount,
    listed: here.length - missing.length,
    alarms: alarmCount,
    otherContext: open.filter(i => !isAlarm(i)).length - here.length,
    missing
  };
}

// ---- Sage, simplified: Up next, minutes and project groups ----

const isParked = (i: WorkItem) =>
  i.status === 'blocked' || !!i.waitingFor?.who || isSnoozedNow(i);

/** The one thing to do now: the first item in list order that isn't blocked, waiting or snoozed. */
export const pickUpNext = (items: WorkItem[]): WorkItem | null =>
  items.find(i => isOpen(i) && !isParked(i)) || null;

export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};

/** Total estimated minutes, and how many items have no estimate (so the total is honest). */
export function totalMinutes(items: WorkItem[]) {
  let minutes = 0, unknown = 0;
  for (const i of items) {
    if (i.estimatedMinutes && i.estimatedMinutes > 0) minutes += i.estimatedMinutes; else unknown++;
  }
  return { minutes, unknown };
}

export interface ProjectGroup { key: string; name: string; color?: string; items: WorkItem[] }

/**
 * Items grouped by project (else area, else "No project"), groups in order of
 * their first item so list order is kept. Two projects with the same task
 * names stay apart. Returns one group per home; callers show headers only
 * when there are several.
 */
export function groupByProject(items: WorkItem[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const i of items) {
    const key = i.projectId ? `p:${i.projectId}` : i.areaId ? `a:${i.areaId}` : 'none';
    let g = groups.get(key);
    if (!g) {
      g = { key, name: i.project?.name || i.area?.name || 'No project', color: (i.project as any)?.color, items: [] };
      groups.set(key, g);
    }
    g.items.push(i);
  }
  return [...groups.values()];
}

/** "1h 30m" / "45m" / "2h" / "30" → minutes; undefined when there is no duration. */
export function durationToMinutes(text: string | null | undefined): number | undefined {
  const t = (text || '').trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10) || undefined;
  const h = t.match(/(\d+)\s*h/i);
  const m = t.match(/(\d+)\s*m/i);
  const total = (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
  return total > 0 ? total : undefined;
}
