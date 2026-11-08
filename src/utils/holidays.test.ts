import { describe, it, expect } from 'vitest';
import raw from '../data/holidays_in.json';
import { HOLIDAYS, cleanHolidays, filterHolidays, holidayMap, nextHoliday } from './holidays';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

describe('India holidays data', () => {
  it('has both years, 17 gazetted each, no repeats', () => {
    for (const y of ['2026', '2027']) {
      expect(HOLIDAYS.filter(h => h.date.startsWith(y) && h.type === 'gazetted')).toHaveLength(17);
    }
    expect(HOLIDAYS).toHaveLength((raw as any).holidays.length);
  });

  it('matches known DoPT dates', () => {
    const on = (d: string) => HOLIDAYS.filter(h => h.date === d).map(h => h.name);
    expect(on('2026-11-08')).toContain('Diwali (Deepavali)');
    expect(on('2026-11-24')).toContain("Guru Nanak's Birthday");
    expect(on('2027-10-29')).toContain('Diwali (Deepavali)');
    expect(on('2027-01-26')).toContain('Republic Day');
    expect(new Date('2027-01-26T00:00').getDay()).toBe(2); // Tuesday, as in the OM
    expect(WD[new Date('2026-12-25T00:00').getDay()]).toBe('Fri');
  });

  it('flags national and moon-sighting days', () => {
    expect(HOLIDAYS.filter(h => h.national).length).toBe(6);
    expect(HOLIDAYS.find(h => h.name === 'Id-ul-Fitr')?.moonSighting).toBe(true);
  });
});

describe('holiday helpers', () => {
  it('drops bad rows and duplicates', () => {
    const rows = cleanHolidays([
      { date: '2026-01-26', name: 'Republic Day', type: 'gazetted' },
      { date: '2026-01-26', name: 'Republic Day ', type: 'gazetted' },
      { date: '26-01-2026', name: 'Bad', type: 'gazetted' },
      { date: '2026-02-01', name: '' },
      null,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('filters by preference', () => {
    expect(filterHolidays(HOLIDAYS, 'off')).toHaveLength(0);
    expect(filterHolidays(HOLIDAYS, 'gazetted').every(h => h.type === 'gazetted')).toBe(true);
    expect(holidayMap('all').get('2026-11-08')?.map(h => h.type)).toEqual(['gazetted', 'restricted']);
  });

  it('finds the next one within a window', () => {
    expect(nextHoliday('2026-11-08', 'all', 14)?.name).toBe('Govardhan Puja');
    expect(nextHoliday('2026-11-08', 'gazetted', 14)).toBeNull();
    expect(nextHoliday('2026-11-08', 'gazetted', 30)?.name).toBe("Guru Nanak's Birthday");
  });
});
