import { fromDateKey, toDateKey, shiftByDays } from './recurrence';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Habit history holds real dates ("2026-10-02"). Older entries were weekday names and are ignored. */
export const dateEntries = (history: string[] | undefined): string[] =>
  (history || []).filter(d => DATE_KEY.test(d));

/** The seven dates of the week containing `today`, Monday first. */
export function weekDates(today: string): { date: string; label: string }[] {
  const d = fromDateKey(today);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return labels.map((label, i) => ({ label, date: shiftByDays(today, i - offset) as string }));
}

/**
 * Days in a row up to today. A day not ticked yet doesn't break the streak
 * until it is over, so it still counts yesterday's run until tonight.
 */
export function streakOf(history: string[] | undefined, today: string): number {
  const days = new Set(dateEntries(history));
  let cursor = days.has(today) ? today : (shiftByDays(today, -1) as string);
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = shiftByDays(cursor, -1) as string;
  }
  return count;
}

export const lastNDays = (today: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => toDateKey(fromDateKey(shiftByDays(today, -i) as string)));
