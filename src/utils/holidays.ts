// India public holidays: a read-only layer over Calendar, Timeline and Today.
//
// The list lives in src/data/holidays_in.json (the DoPT list for Central
// Government offices). Holidays are never stored as work items, so they don't
// sync, don't get backed up twice, can't duplicate, never show as overdue and
// stay out of Inbox, Focus, reminders, habits and streaks. To refresh for a new
// year, append that year's rows to the JSON and redeploy.
//
// What shows is a per-device display choice kept in localStorage.

import { useEffect, useState } from 'react';
import raw from '../data/holidays_in.json';

export type HolidayType = 'gazetted' | 'restricted';

export interface Holiday {
  date: string;        // YYYY-MM-DD
  name: string;
  type: HolidayType;   // gazetted = closed holiday; restricted = optional
  national?: boolean;  // Republic Day, Independence Day, Gandhi Jayanti
  moonSighting?: boolean; // date may move a day after moon sighting
}

export type HolidayPref = 'all' | 'gazetted' | 'off';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Drops malformed rows and exact repeats, so a bad edit to the JSON can't break a view. */
export function cleanHolidays(rows: unknown): Holiday[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: Holiday[] = [];
  for (const r of rows as any[]) {
    if (!r || typeof r.date !== 'string' || !DATE.test(r.date) || typeof r.name !== 'string' || !r.name.trim()) continue;
    const type: HolidayType = r.type === 'restricted' ? 'restricted' : 'gazetted';
    const key = `${r.date}|${r.name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: r.date, name: r.name.trim(), type, ...(r.national ? { national: true } : {}), ...(r.moonSighting ? { moonSighting: true } : {}) });
  }
  // Gazetted before restricted on the same day.
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'gazetted' ? -1 : 1));
}

export const HOLIDAYS: Holiday[] = cleanHolidays((raw as any).holidays);
export const HOLIDAY_SCOPE: string = (raw as any).scope || '';
export const HOLIDAY_YEARS: number[] = Array.from(new Set(HOLIDAYS.map(h => Number(h.date.slice(0, 4))))).sort();

export function filterHolidays(list: Holiday[], pref: HolidayPref): Holiday[] {
  if (pref === 'off') return [];
  return pref === 'gazetted' ? list.filter(h => h.type === 'gazetted') : list;
}

/** day -> holidays on that day, for the chosen pref. */
export function holidayMap(pref: HolidayPref, list: Holiday[] = HOLIDAYS): Map<string, Holiday[]> {
  const map = new Map<string, Holiday[]>();
  for (const h of filterHolidays(list, pref)) {
    if (!map.has(h.date)) map.set(h.date, []);
    map.get(h.date)!.push(h);
  }
  return map;
}

/** The next holiday strictly after `day`, within `withinDays`. */
export function nextHoliday(day: string, pref: HolidayPref, withinDays = 14, list: Holiday[] = HOLIDAYS): Holiday | null {
  const start = new Date(`${day}T00:00`);
  if (isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + withinDays);
  const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return filterHolidays(list, pref).find(h => h.date > day && h.date <= endStr) || null;
}

export function holidayLabel(h: Holiday): string {
  return h.type === 'gazetted' ? (h.national ? 'National holiday' : 'Gazetted holiday') : 'Restricted holiday';
}

// --- the per-device choice ---------------------------------------------------

const KEY = 'sage:india-holidays';
const EVENT = 'sage:holiday-pref';

export function getHolidayPref(): HolidayPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'gazetted' || v === 'off' ? v : 'all';
  } catch {
    return 'all';
  }
}

export function setHolidayPref(pref: HolidayPref) {
  try { localStorage.setItem(KEY, pref); } catch { /* private window: this visit only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pref }));
}

export function useHolidayPref(): HolidayPref {
  const [pref, setPref] = useState<HolidayPref>(getHolidayPref);
  useEffect(() => {
    const on = () => setPref(getHolidayPref());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  return pref;
}
