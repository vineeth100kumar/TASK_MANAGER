/*
 * The repeat rule, read and written.
 *
 * The rule is one short string on the item — `weekly:2:tue`, `monthly:last-fri`
 * — rather than an RFC 5545 RRULE, because everything Sage needs to say fits
 * on one line and the Pi does not need to carry a calendar library. The same
 * grammar is parsed on the backend in `services/recurrence.py`; this file is
 * the editor's side of it, and the two are kept in step by the tests either
 * side reading the same examples.
 */

export type RepeatKind = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export type MonthlyMode = 'day-of-month' | 'weekday-of-month';

export interface RepeatSpec {
  kind: RepeatKind;
  /** Every N days / weeks / months / years. 1 unless said otherwise. */
  interval: number;
  /** For `weekly`: 0 is Monday, 6 is Sunday. */
  weekdays: number[];
  monthlyMode: MonthlyMode;
  /** For `day-of-month`. */
  dayOfMonth: number;
  /** For `weekday-of-month`: 1–4, or -1 for the last. */
  nth: number;
  /** For `weekday-of-month`: 0 is Monday. */
  nthWeekday: number;
}

export const WEEKDAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
export const WEEKDAY_FULL = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const;

const ORDINAL_NAMES: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'last' };
const NAME_ORDINALS: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, last: -1 };

export const EMPTY_SPEC: RepeatSpec = {
  kind: 'none',
  interval: 1,
  weekdays: [],
  monthlyMode: 'day-of-month',
  dayOfMonth: 1,
  nth: 1,
  nthWeekday: 0,
};

/** Pull a leading `N:` interval off a rule body, defaulting to 1. */
function splitInterval(body: string): [number, string] {
  const match = body.match(/^(\d+):(.*)$/);
  if (match) return [Math.max(1, parseInt(match[1], 10)), match[2]];
  return [1, body];
}

/**
 * A stored rule as the editor's fields.
 *
 * Anything unrecognised comes back as `none`, so a rule this editor cannot
 * express never silently rewrites itself into something else on save.
 */
export function parseRepeatRule(rule?: string | null): RepeatSpec {
  if (!rule || !rule.trim()) return { ...EMPTY_SPEC };
  const value = rule.trim().toLowerCase();

  if (value === 'weekdays') return { ...EMPTY_SPEC, kind: 'weekdays' };

  if (value === 'daily') return { ...EMPTY_SPEC, kind: 'daily' };
  if (value.startsWith('daily:')) {
    const n = parseInt(value.slice(6), 10);
    return { ...EMPTY_SPEC, kind: 'daily', interval: Number.isFinite(n) ? Math.max(1, n) : 1 };
  }

  if (value === 'yearly') return { ...EMPTY_SPEC, kind: 'yearly' };
  if (value.startsWith('yearly:')) {
    const n = parseInt(value.slice(7), 10);
    return { ...EMPTY_SPEC, kind: 'yearly', interval: Number.isFinite(n) ? Math.max(1, n) : 1 };
  }

  if (value.startsWith('weekly:')) {
    const [interval, body] = splitInterval(value.slice(7));
    const weekdays = body
      .split(',')
      .map((d) => WEEKDAY_NAMES.indexOf(d.trim() as typeof WEEKDAY_NAMES[number]))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    return { ...EMPTY_SPEC, kind: 'weekly', interval, weekdays: Array.from(new Set(weekdays)) };
  }

  if (value.startsWith('monthly:')) {
    const [interval, body] = splitInterval(value.slice(8));
    const trimmed = body.trim();

    if (trimmed.includes('-')) {
      const [ordinal, dayName] = trimmed.split('-');
      const nth = NAME_ORDINALS[ordinal];
      const weekday = WEEKDAY_NAMES.indexOf(dayName as typeof WEEKDAY_NAMES[number]);
      if (nth !== undefined && weekday >= 0) {
        return {
          ...EMPTY_SPEC,
          kind: 'monthly',
          interval,
          monthlyMode: 'weekday-of-month',
          nth,
          nthWeekday: weekday,
        };
      }
      return { ...EMPTY_SPEC };
    }

    const day = parseInt(trimmed, 10);
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      return { ...EMPTY_SPEC, kind: 'monthly', interval, monthlyMode: 'day-of-month', dayOfMonth: day };
    }
    return { ...EMPTY_SPEC };
  }

  // `custom:14d` and anything else this editor has no fields for.
  return { ...EMPTY_SPEC };
}

/** The editor's fields as a rule to store. Empty string means one-time. */
export function buildRepeatRule(spec: RepeatSpec): string {
  const interval = Math.max(1, Math.round(spec.interval || 1));
  const prefix = interval > 1 ? `${interval}:` : '';

  switch (spec.kind) {
    case 'none':
      return '';
    case 'weekdays':
      return 'weekdays';
    case 'daily':
      return interval > 1 ? `daily:${interval}` : 'daily';
    case 'yearly':
      return interval > 1 ? `yearly:${interval}` : 'yearly';
    case 'weekly': {
      // A weekly rule with no day chosen has nothing to fire on, so it falls
      // back to the day the item is already on rather than saving a rule that
      // never comes round.
      const days = spec.weekdays.length > 0 ? spec.weekdays : [0];
      const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]).join(',');
      return `weekly:${prefix}${names}`;
    }
    case 'monthly': {
      if (spec.monthlyMode === 'weekday-of-month') {
        const ordinal = ORDINAL_NAMES[spec.nth] || '1st';
        return `monthly:${prefix}${ordinal}-${WEEKDAY_NAMES[spec.nthWeekday]}`;
      }
      const day = Math.min(31, Math.max(1, Math.round(spec.dayOfMonth || 1)));
      return `monthly:${prefix}${day}`;
    }
    default:
      return '';
  }
}

function everyLabel(n: number, unit: string): string {
  if (n === 1) return `Every ${unit}`;
  if (n === 2) return `Every other ${unit}`;
  return `Every ${n} ${unit}s`;
}

/**
 * A rule as a person would say it.
 *
 * Mirrors `describe_rule` on the backend, so the same rule reads the same
 * whether the sentence was written here or came back from the Pi.
 */
export function describeRepeatRule(rule?: string | null): string {
  if (!rule || !rule.trim()) return 'One-time';
  const value = rule.trim().toLowerCase();

  if (value === 'weekdays') return 'Every weekday';
  if (value === 'yearly') return 'Every year';
  if (value === 'daily') return 'Every day';

  if (value.startsWith('daily:')) {
    const n = parseInt(value.slice(6), 10);
    return Number.isFinite(n) ? everyLabel(n, 'day') : 'Every day';
  }

  if (value.startsWith('custom:')) {
    const body = value.slice(7);
    const n = parseInt(body, 10);
    if (Number.isFinite(n)) {
      if (body.endsWith('d')) return everyLabel(n, 'day');
      if (body.endsWith('w')) return everyLabel(n, 'week');
      if (body.endsWith('m')) return everyLabel(n, 'month');
    }
    return 'Repeats';
  }

  const spec = parseRepeatRule(rule);

  if (spec.kind === 'weekly') {
    const names = spec.weekdays.length
      ? spec.weekdays.map((d) => WEEKDAY_FULL[d].slice(0, 3)).join(', ')
      : 'week';
    return spec.interval === 1
      ? `Every ${names}`
      : `${everyLabel(spec.interval, 'week')} on ${names}`;
  }

  if (spec.kind === 'monthly') {
    const base =
      spec.monthlyMode === 'weekday-of-month'
        ? `The ${ORDINAL_NAMES[spec.nth] || '1st'} ${WEEKDAY_FULL[spec.nthWeekday].slice(0, 3)} of the month`
        : `Day ${spec.dayOfMonth} of the month`;
    return spec.interval === 1 ? base : `${base}, every ${spec.interval} months`;
  }

  if (spec.kind === 'yearly') return everyLabel(spec.interval, 'year');

  return 'Repeats';
}

/** The one line under the control: what repeats, and when it stops. */
export function describeRepeat(
  rule?: string | null,
  until?: string | null,
  count?: number | null,
): string {
  const base = describeRepeatRule(rule);
  if (base === 'One-time') return base;
  if (count && count > 0) return `${base}, ${count} times`;
  if (until) {
    const day = new Date(`${until}T00:00:00`);
    if (!Number.isNaN(day.getTime())) {
      const formatted = day.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `${base}, until ${formatted}`;
    }
  }
  return base;
}
