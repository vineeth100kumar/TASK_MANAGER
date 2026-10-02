/**
 * Repeat rules and the "next occurrence" step for repeating items.
 *
 * A rule is a short string stored in `repeatRule`:
 *   daily | weekdays | weekly | weekly:<0-6>[,<0-6>...] | monthly | monthly:last | yearly
 *   every:<n>:<days|weeks|months>   on a schedule, every n units
 *   after:<n>:<days|weeks|months>   n units after the day it was finished
 * Anything else (old free-text rules) is read as best it can be, and an
 * unknown rule never repeats on the same day.
 */

export type RepeatUnit = 'days' | 'weeks' | 'months';

export interface ParsedRule {
  kind: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'monthly-last' | 'yearly' | 'every' | 'after';
  n: number;
  unit: RepeatUnit;
  weekdays?: number[];
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The choices the add form and the task panel offer. Custom rules show up as their own label. */
export const REPEAT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'every:2:weeks', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'monthly:last', label: 'Last day of the month' },
  { value: 'yearly', label: 'Yearly' },
];

/** Less common choices, grouped under the main ones. */
export const MORE_REPEAT_OPTIONS: { group: string; options: { value: string; label: string }[] }[] = [
  {
    group: 'On a schedule',
    options: [
      { value: 'every:2:days', label: 'Every 2 days' },
      { value: 'every:3:days', label: 'Every 3 days' },
      { value: 'every:2:months', label: 'Every 2 months' },
      { value: 'every:3:months', label: 'Every 3 months' },
      { value: 'every:6:months', label: 'Every 6 months' },
    ],
  },
  {
    group: 'After I finish it',
    options: [
      { value: 'after:1:days', label: '1 day after done' },
      { value: 'after:3:days', label: '3 days after done' },
      { value: 'after:1:weeks', label: '1 week after done' },
      { value: 'after:2:weeks', label: '2 weeks after done' },
      { value: 'after:1:months', label: '1 month after done' },
    ],
  },
];

export function parseRule(rule: string | null | undefined): ParsedRule | null {
  const r = (rule || '').toLowerCase().trim();
  if (!r) return null;
  if (r === 'daily' || r === 'every day') return { kind: 'daily', n: 1, unit: 'days' };
  if (r === 'weekdays' || r === 'every weekday') return { kind: 'weekdays', n: 1, unit: 'days' };
  if (r === 'weekly' || r === 'every week') return { kind: 'weekly', n: 1, unit: 'weeks' };
  if (r === 'biweekly') return { kind: 'every', n: 2, unit: 'weeks' };
  if (r === 'monthly' || r === 'every month') return { kind: 'monthly', n: 1, unit: 'months' };
  if (r === 'monthly:last') return { kind: 'monthly-last', n: 1, unit: 'months' };
  if (r === 'yearly' || r === 'annually' || r === 'every year') return { kind: 'yearly', n: 12, unit: 'months' };
  let m = r.match(/^weekly:([0-6](?:,[0-6])*)$/);
  if (m) return { kind: 'weekly', n: 1, unit: 'weeks', weekdays: m[1].split(',').map(Number) };
  m = r.match(/^(every|after):(\d+):(days|weeks|months)$/);
  if (m) {
    const n = Math.max(1, parseInt(m[2], 10));
    return { kind: m[1] as 'every' | 'after', n, unit: m[3] as RepeatUnit };
  }
  // Older free text like "every 3 days".
  m = r.match(/^every\s+(\d+)\s+(day|week|month)s?$/);
  if (m) return { kind: 'every', n: Math.max(1, parseInt(m[1], 10)), unit: `${m[2]}s` as RepeatUnit };
  return null;
}

export function repeatLabel(rule: string | null | undefined): string {
  const option = [...REPEAT_OPTIONS, ...MORE_REPEAT_OPTIONS.flatMap(g => g.options)].find(o => o.value === (rule || ''));
  if (option) return option.label;
  const p = parseRule(rule);
  if (!p) return rule || 'Never';
  if (p.kind === 'weekly' && p.weekdays) {
    return p.weekdays.length === 1
      ? `Every ${WEEKDAY_NAMES[p.weekdays[0]]}`
      : `Every ${p.weekdays.map(d => WEEKDAY_NAMES[d].slice(0, 3)).join(', ')}`;
  }
  const unit = p.n === 1 ? p.unit.slice(0, -1) : p.unit;
  if (p.kind === 'every') return p.n === 1 ? `Every ${unit}` : `Every ${p.n} ${unit}`;
  if (p.kind === 'after') return `${p.n} ${unit} after done`;
  return rule || 'Never';
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDateKey = (key: string) => {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Adds months, keeping the day but never overflowing: Jan 31 + 1 month is Feb 28/29. */
function addMonths(d: Date, n: number, day = d.getDate()): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day, last));
}

function lastOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function step(p: ParsedRule, d: Date, anchorDay: number): Date {
  switch (p.kind) {
    case 'daily': return addDays(d, 1);
    case 'weekdays': {
      let next = addDays(d, 1);
      while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1);
      return next;
    }
    case 'weekly':
      if (p.weekdays) {
        let next = addDays(d, 1);
        while (!p.weekdays.includes(next.getDay())) next = addDays(next, 1);
        return next;
      }
      return addDays(d, 7);
    case 'monthly': return addMonths(d, 1, anchorDay);
    case 'monthly-last': return lastOfMonth(addMonths(d, 1, 1));
    case 'yearly': return addMonths(d, 12, anchorDay);
    case 'every':
    case 'after':
      if (p.unit === 'days') return addDays(d, p.n);
      if (p.unit === 'weeks') return addDays(d, p.n * 7);
      return addMonths(d, p.n, anchorDay);
  }
}

/**
 * The date the next copy of a repeating item is due, as YYYY-MM-DD, or null
 * when the rule isn't understood (so nothing is created on the same day).
 *
 * Schedule rules step from the old due date and skip any dates already past,
 * so a daily task finished a week late comes back tomorrow, not seven times.
 * "after" rules count from the day it was finished.
 */
export function nextOccurrence(rule: string | null | undefined, dueDate: string | null | undefined, today: string): string | null {
  const p = parseRule(rule);
  if (!p) return null;
  if (p.kind === 'after') return toDateKey(step(p, fromDateKey(today), fromDateKey(today).getDate()));
  const base = fromDateKey(dueDate || today);
  const anchorDay = base.getDate();
  let next = step(p, base, anchorDay);
  for (let guard = 0; toDateKey(next) <= today && guard < 2000; guard++) {
    next = step(p, next, anchorDay);
  }
  return toDateKey(next);
}

/** Moves a local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" by whole days, keeping the time. */
export function shiftByDays(value: string | null | undefined, days: number): string | null {
  if (!value) return null;
  const moved = toDateKey(addDays(fromDateKey(value), days));
  return value.length > 10 ? `${moved}${value.slice(10)}` : moved;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86400000);
}
