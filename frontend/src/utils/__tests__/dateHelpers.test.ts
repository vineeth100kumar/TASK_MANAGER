import { describe, it, expect } from 'vitest';
import {
  getTodayDateString,
  getTomorrowDateString,
  getYesterdayDateString,
  getThisWeekend,
  getNextMonday,
  isOverdue,
  itemMoment,
  formatWhen,
  compareBySchedule,
  isPastDue,
  timeInputValue,
  withTimeOfDay,
  isDueToday,
  isUpcoming,
  formatRelativeDate,
  groupTasksBySmartDate
} from '../dateHelpers';
import { WorkItem } from '../../types';

describe('dateHelpers', () => {
  it('returns valid YYYY-MM-DD date strings', () => {
    const today = getTodayDateString();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const tomorrow = getTomorrowDateString();
    expect(tomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const yesterday = getYesterdayDateString();
    expect(yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const weekend = getThisWeekend();
    expect(weekend).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const monday = getNextMonday();
    expect(monday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accurately identifies overdue tasks', () => {
    const pastDate = '2020-01-01';
    expect(isOverdue(pastDate, false)).toBe(true);
    // If completed, should not be considered overdue
    expect(isOverdue(pastDate, true)).toBe(false);
    expect(isOverdue(null, false)).toBe(false);
    expect(isOverdue(getTomorrowDateString(), false)).toBe(false);
  });

  it('accurately identifies today and upcoming dates', () => {
    const today = getTodayDateString();
    expect(isDueToday(today)).toBe(true);
    expect(isDueToday(getYesterdayDateString())).toBe(false);

    const tomorrow = getTomorrowDateString();
    expect(isUpcoming(tomorrow)).toBe(true);
    expect(isUpcoming(getYesterdayDateString())).toBe(false);
  });

  it('formats relative dates properly', () => {
    expect(formatRelativeDate(null)).toBe('No Date');
    expect(formatRelativeDate(getTodayDateString())).toBe('Today');
    expect(formatRelativeDate(getTomorrowDateString())).toBe('Tomorrow');
    expect(formatRelativeDate(getYesterdayDateString())).toBe('Yesterday');
  });

  it('groups tasks by smart date sections', () => {
    const dummyItems: WorkItem[] = [
      {
        id: '1',
        title: 'Overdue task',
        entity_type: 'task',
        status: 'todo',
        priority: 'high',
        energy: 'medium',
        due_date: '2021-05-10',
        is_completed: false,
        estimated_minutes: 30,
        actual_minutes: 0,
        depends_on: [],
        created_at: '',
        updated_at: '',
        subtasks: []
      },
      {
        id: '2',
        title: 'Today task',
        entity_type: 'task',
        status: 'todo',
        priority: 'urgent',
        energy: 'high',
        due_date: getTodayDateString(),
        is_completed: false,
        estimated_minutes: 30,
        actual_minutes: 0,
        depends_on: [],
        created_at: '',
        updated_at: '',
        subtasks: []
      },
      {
        id: '3',
        title: 'Tomorrow task',
        entity_type: 'task',
        status: 'todo',
        priority: 'medium',
        energy: 'low',
        due_date: getTomorrowDateString(),
        is_completed: false,
        estimated_minutes: 30,
        actual_minutes: 0,
        depends_on: [],
        created_at: '',
        updated_at: '',
        subtasks: []
      },
      {
        id: '4',
        title: 'No date task',
        entity_type: 'task',
        status: 'todo',
        priority: 'low',
        energy: 'low',
        due_date: null,
        is_completed: false,
        estimated_minutes: 30,
        actual_minutes: 0,
        depends_on: [],
        created_at: '',
        updated_at: '',
        subtasks: []
      }
    ];

    const grouped = groupTasksBySmartDate(dummyItems);
    expect(grouped.overdue).toHaveLength(1);
    expect(grouped.overdue[0].id).toBe('1');
    expect(grouped.today).toHaveLength(1);
    expect(grouped.today[0].id).toBe('2');
    expect(grouped.upcoming).toHaveLength(1);
    expect(grouped.upcoming[0].id).toBe('3');
    expect(grouped.backlog).toHaveLength(1);
    expect(grouped.backlog[0].id).toBe('4');
  });
});

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

describe('time of day', () => {
  const base = {
    entity_type: 'reminder' as const,
    due_date: '2026-09-18',
    start_at: '2026-09-18T18:30:00',
    remind_at: '2026-09-18T18:30:00',
  };

  it('finds the moment a reminder is due', () => {
    expect(itemMoment(base)).toBe('2026-09-18T18:30:00');
  });

  it('prefers the start of an event over its nudge', () => {
    expect(
      itemMoment({
        entity_type: 'event',
        start_at: '2026-09-18T19:30:00',
        remind_at: '2026-09-18T19:15:00',
      })
    ).toBe('2026-09-18T19:30:00');
  });

  it('has no moment when only a date was given', () => {
    expect(itemMoment({ entity_type: 'task', start_at: null, remind_at: null })).toBeNull();
  });

  it('keeps the time in what the user reads', () => {
    // "finish work by 18:30" showing only the date is the bug this fixes.
    expect(formatWhen(base)).toMatch(/6:30 pm$/);
  });

  it('says only the day when there is no time', () => {
    expect(formatWhen({ entity_type: 'task', due_date: '2026-09-18', start_at: null, remind_at: null }))
      .not.toMatch(/:/);
  });

  it('fills a time input from the stored moment', () => {
    expect(timeInputValue('2026-09-18T18:30:00')).toBe('18:30');
    expect(timeInputValue(null)).toBe('');
  });

  it('stores a chosen time so the reminder can fire', () => {
    const next = withTimeOfDay('reminder', '2026-09-18', '18:30');
    expect(next).toEqual({
      due_date: '2026-09-18',
      start_at: '2026-09-18T18:30:00',
      remind_at: '2026-09-18T18:30:00',
    });
  });

  it('nudges an event a quarter of an hour early, as the capture does', () => {
    const next = withTimeOfDay('event', '2026-09-18', '19:30');
    expect(next.start_at).toBe('2026-09-18T19:30:00');
    expect(next.remind_at).toBe('2026-09-18T19:15:00');
  });

  it('clearing the time leaves the day and removes the moment', () => {
    expect(withTimeOfDay('reminder', '2026-09-18', null)).toEqual({
      due_date: '2026-09-18',
      start_at: null,
      remind_at: null,
    });
  });
});

describe('the order a day happens in', () => {
  const at = (entity_type: any, time: string | null, priority: any = 'medium') => ({
    entity_type,
    priority,
    due_date: '2026-09-18',
    start_at: time,
    remind_at: time,
    is_completed: false,
  });

  it('puts the earlier thing first', () => {
    // The screenshot: a 19:30 outing was shown as "Next" above an 18:30
    // deadline that comes an hour before it.
    const outing = at('event', '2026-09-18T19:30:00');
    const deadline = at('reminder', '2026-09-18T18:30:00');

    expect([outing, deadline].sort(compareBySchedule)[0]).toBe(deadline);
  });

  it('puts things with a time before things without one', () => {
    const timed = at('reminder', '2026-09-18T18:30:00');
    const untimed = at('task', null);

    expect([untimed, timed].sort(compareBySchedule)[0]).toBe(timed);
  });

  it('falls back to priority when neither has a time', () => {
    const low = at('task', null, 'low');
    const urgent = at('task', null, 'urgent');

    expect([low, urgent].sort(compareBySchedule)[0]).toBe(urgent);
  });

  it('counts an item late once its time has gone by, not the next day', () => {
    const item = at('reminder', '2026-09-18T18:30:00');

    expect(isPastDue(item, new Date('2026-09-18T19:00:00'))).toBe(true);
    expect(isPastDue(item, new Date('2026-09-18T18:00:00'))).toBe(false);
  });

  it('never calls a finished item late', () => {
    const done = { ...at('reminder', '2026-09-18T18:30:00'), is_completed: true };

    expect(isPastDue(done, new Date('2026-09-18T23:00:00'))).toBe(false);
  });
});
