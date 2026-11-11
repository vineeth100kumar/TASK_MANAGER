// Doses: one task or habit done several times in a day (cream morning and
// evening, medicine 3x). The item keeps a list of times ("08:00", "20:00");
// each time is ticked on its own, and the day counts as done only once every
// time is ticked. Items without doseTimes behave exactly as before.

const TIME = /^\d{2}:\d{2}$/;
const MAX_DOSES = 6;

export interface DosePreset { id: string; label: string; times: string[] }

export const DOSE_PRESETS: DosePreset[] = [
  { id: 'once', label: 'Once', times: [] },
  { id: 'twice', label: 'Morning + evening', times: ['08:00', '20:00'] },
  { id: 'thrice', label: '3 times', times: ['08:00', '14:00', '20:00'] },
];

/** Valid, unique, sorted times; fewer than two means "once a day" (an empty list). */
export function normalizeDoses(times: unknown): string[] {
  if (!Array.isArray(times)) return [];
  const clean = [...new Set(times.filter((t): t is string => typeof t === 'string' && TIME.test(t)))].sort();
  return clean.length >= 2 ? clean.slice(0, MAX_DOSES) : [];
}

export const hasDoses = (item: { doseTimes?: string[] | null }): boolean => normalizeDoses(item.doseTimes).length > 0;

/** Which preset these times match, or 'custom'. */
export function presetOf(times: string[] | null | undefined): string {
  const t = normalizeDoses(times);
  return DOSE_PRESETS.find(p => p.times.length === t.length && p.times.every((x, i) => x === t[i]))?.id || 'custom';
}

/** The doses ticked, limited to times the item still has. */
export function doneDoses(doseTimes: string[] | null | undefined, ticked: string[] | null | undefined): string[] {
  const times = normalizeDoses(doseTimes);
  const set = new Set(ticked || []);
  return times.filter(t => set.has(t));
}

export function doseProgress(doseTimes: string[] | null | undefined, ticked: string[] | null | undefined): { done: number; total: number; complete: boolean; next: string | null } {
  const times = normalizeDoses(doseTimes);
  const done = doneDoses(times, ticked);
  const next = times.find(t => !done.includes(t)) || null;
  return { done: done.length, total: times.length, complete: times.length > 0 && done.length === times.length, next };
}

/** Ticks or unticks one time; returns the new list of ticked times, sorted. */
export function toggleDose(ticked: string[] | null | undefined, time: string): string[] {
  const set = new Set(ticked || []);
  if (set.has(time)) set.delete(time); else set.add(time);
  return [...set].sort();
}

/** A habit's ticked doses on a date (its log keeps one list per day). */
export function habitDosesOn(habit: { doseTimes?: string[] | null; doseLog?: Record<string, string[]> | null }, date: string): string[] {
  return doneDoses(habit.doseTimes, habit.doseLog?.[date]);
}

/** Keeps the log to recent days so a habit record stays small. */
export function trimLog(log: Record<string, string[]>, keepDays = 120): Record<string, string[]> {
  const dates = Object.keys(log).sort().slice(-keepDays);
  return Object.fromEntries(dates.map(d => [d, log[d]]));
}
