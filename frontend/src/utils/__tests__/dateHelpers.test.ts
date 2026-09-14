import { describe, it, expect } from 'vitest';
import {
  getTodayDateString,
  getTomorrowDateString,
  getYesterdayDateString,
  getThisWeekend,
  getNextMonday,
  isOverdue,
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
