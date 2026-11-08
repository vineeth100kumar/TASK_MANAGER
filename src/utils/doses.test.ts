import { describe, expect, it } from 'vitest';
import { doseProgress, habitDosesOn, normalizeDoses, presetOf, toggleDose, trimLog } from './doses';

describe('doses', () => {
  it('needs two valid times to count as doses', () => {
    expect(normalizeDoses(['20:00', '08:00', '08:00', 'x'])).toEqual(['08:00', '20:00']);
    expect(normalizeDoses(['08:00'])).toEqual([]);
    expect(normalizeDoses(undefined)).toEqual([]);
  });
  it('is complete only when every time is ticked', () => {
    const t = ['08:00', '20:00'];
    expect(doseProgress(t, [])).toMatchObject({ done: 0, total: 2, complete: false, next: '08:00' });
    expect(doseProgress(t, ['08:00'])).toMatchObject({ done: 1, complete: false, next: '20:00' });
    expect(doseProgress(t, ['20:00', '08:00'])).toMatchObject({ done: 2, complete: true, next: null });
    // A time that was removed from the item no longer counts.
    expect(doseProgress(t, ['08:00', '12:00']).done).toBe(1);
  });
  it('toggles one time and keeps the list sorted', () => {
    expect(toggleDose(['20:00'], '08:00')).toEqual(['08:00', '20:00']);
    expect(toggleDose(['08:00', '20:00'], '08:00')).toEqual(['20:00']);
  });
  it('names presets', () => {
    expect(presetOf([])).toBe('once');
    expect(presetOf(['08:00', '20:00'])).toBe('twice');
    expect(presetOf(['09:00', '21:00'])).toBe('custom');
  });
  it('reads a habit day and trims old logs', () => {
    const h = { doseTimes: ['08:00', '20:00'], doseLog: { '2026-11-08': ['08:00'] } };
    expect(habitDosesOn(h, '2026-11-08')).toEqual(['08:00']);
    expect(habitDosesOn(h, '2026-11-07')).toEqual([]);
    const big = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`d${String(i).padStart(3, '0')}`, ['08:00']]));
    expect(Object.keys(trimLog(big))).toHaveLength(120);
  });
});
