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

export type HabitDay = 'done' | 'missed' | 'open' | 'future' | 'before';

/**
 * The first day a habit counts from: the day it was added, or an earlier day
 * that was ticked afterwards. Days before it are not "missed".
 */
export function habitStart(habit: { createdAt?: string; history?: string[] }): string {
  const created = habit.createdAt ? toDateKey(new Date(habit.createdAt)) : '9999-12-31';
  const first = [...dateEntries(habit.history)].sort()[0];
  return first && first < created ? first : created;
}

/**
 * Every day is its own entry: ticked days are done, past days that weren't are
 * missed, and today stays open until it's over (it never carries over).
 */
export function habitDay(habit: { createdAt?: string; history?: string[] }, date: string, today: string): HabitDay {
  if (dateEntries(habit.history).includes(date)) return 'done';
  if (date > today) return 'future';
  if (date < habitStart(habit)) return 'before';
  return date === today ? 'open' : 'missed';
}

/** The longest run of ticked days ever. */
export function bestStreakOf(history: string[] | undefined): number {
  const days = [...new Set(dateEntries(history))].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of days) {
    run = prev && shiftByDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Ticked days in the week containing `today`. */
export const doneThisWeek = (history: string[] | undefined, today: string): number =>
  weekDates(today).filter(d => dateEntries(history).includes(d.date)).length;

/**
 * Whole weeks (Monday first) ending with the current one, oldest first, for a
 * history grid.
 */
export function recentWeeks(today: string, weeks: number): string[][] {
  const thisWeek = weekDates(today).map(d => d.date);
  return Array.from({ length: weeks }, (_, w) =>
    thisWeek.map(d => shiftByDays(d, -7 * (weeks - 1 - w)) as string));
}
