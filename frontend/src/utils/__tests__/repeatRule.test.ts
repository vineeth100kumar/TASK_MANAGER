import { describe, it, expect } from 'vitest';
import {
  buildRepeatRule,
  describeRepeat,
  describeRepeatRule,
  parseRepeatRule,
  EMPTY_SPEC,
} from '../repeatRule';

/*
 * The same grammar is parsed by `backend/app/services/recurrence.py`. These
 * examples are the ones its own tests use, so a change to one side that the
 * other does not follow shows up here rather than on the Pi.
 */

describe('parseRepeatRule', () => {
  it('reads an empty rule as one-time', () => {
    expect(parseRepeatRule(null).kind).toBe('none');
    expect(parseRepeatRule('').kind).toBe('none');
    expect(parseRepeatRule('   ').kind).toBe('none');
  });

  it('reads the rules written before intervals existed', () => {
    expect(parseRepeatRule('daily')).toMatchObject({ kind: 'daily', interval: 1 });
    expect(parseRepeatRule('weekdays')).toMatchObject({ kind: 'weekdays' });
    expect(parseRepeatRule('weekly:mon')).toMatchObject({ kind: 'weekly', interval: 1, weekdays: [0] });
    expect(parseRepeatRule('monthly:1')).toMatchObject({
      kind: 'monthly',
      interval: 1,
      monthlyMode: 'day-of-month',
      dayOfMonth: 1,
    });
  });

  it('reads an interval', () => {
    expect(parseRepeatRule('daily:3')).toMatchObject({ kind: 'daily', interval: 3 });
    expect(parseRepeatRule('weekly:2:tue')).toMatchObject({
      kind: 'weekly',
      interval: 2,
      weekdays: [1],
    });
    expect(parseRepeatRule('monthly:3:15')).toMatchObject({
      kind: 'monthly',
      interval: 3,
      dayOfMonth: 15,
    });
  });

  it('reads several weekdays, in order and without repeats', () => {
    expect(parseRepeatRule('weekly:fri,mon,mon').weekdays).toEqual([0, 4]);
  });

  it('reads a weekday of the month', () => {
    expect(parseRepeatRule('monthly:3rd-tue')).toMatchObject({
      kind: 'monthly',
      monthlyMode: 'weekday-of-month',
      nth: 3,
      nthWeekday: 1,
    });
    expect(parseRepeatRule('monthly:last-fri')).toMatchObject({
      monthlyMode: 'weekday-of-month',
      nth: -1,
      nthWeekday: 4,
    });
  });

  /*
   * `custom:14d` is a rule the engine honours but this editor has no fields
   * for. It must come back as `none` rather than as something close, or
   * opening the sheet on such a task would quietly rewrite its rule.
   */
  it('does not pretend to understand a rule it has no fields for', () => {
    expect(parseRepeatRule('custom:14d').kind).toBe('none');
    expect(parseRepeatRule('something-else').kind).toBe('none');
    expect(parseRepeatRule('monthly:nonsense').kind).toBe('none');
  });
});

describe('buildRepeatRule', () => {
  it('writes nothing for one-time', () => {
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'none' })).toBe('');
  });

  it('leaves the interval off when it is one', () => {
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'daily', interval: 1 })).toBe('daily');
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'weekly', interval: 1, weekdays: [2] }))
      .toBe('weekly:wed');
  });

  it('writes the interval when there is one', () => {
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'daily', interval: 3 })).toBe('daily:3');
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'weekly', interval: 2, weekdays: [1] }))
      .toBe('weekly:2:tue');
  });

  it('writes a weekday of the month', () => {
    expect(
      buildRepeatRule({
        ...EMPTY_SPEC,
        kind: 'monthly',
        monthlyMode: 'weekday-of-month',
        nth: -1,
        nthWeekday: 4,
      })
    ).toBe('monthly:last-fri');
  });

  it('never writes a weekly rule with no day on it', () => {
    // Such a rule would never come round at all.
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'weekly', weekdays: [] })).toBe('weekly:mon');
  });

  it('clamps a day of the month into range', () => {
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'monthly', dayOfMonth: 99 })).toBe('monthly:31');
    expect(buildRepeatRule({ ...EMPTY_SPEC, kind: 'monthly', dayOfMonth: 0 })).toBe('monthly:1');
  });
});

describe('round-tripping', () => {
  const rules = [
    'daily',
    'daily:4',
    'weekdays',
    'weekly:mon,wed,fri',
    'weekly:2:tue',
    'monthly:15',
    'monthly:3:15',
    'monthly:3rd-tue',
    'monthly:last-fri',
    'yearly',
    'yearly:2',
  ];

  it.each(rules)('parses and rebuilds %s unchanged', (rule) => {
    expect(buildRepeatRule(parseRepeatRule(rule))).toBe(rule);
  });
});

describe('describeRepeatRule', () => {
  /* These strings mirror `describe_rule` in the backend exactly. */
  it.each([
    [null, 'One-time'],
    ['daily', 'Every day'],
    ['daily:2', 'Every other day'],
    ['daily:5', 'Every 5 days'],
    ['weekdays', 'Every weekday'],
    ['weekly:mon,fri', 'Every Mon, Fri'],
    ['weekly:2:tue', 'Every other week on Tue'],
    ['monthly:15', 'Day 15 of the month'],
    ['monthly:3rd-tue', 'The 3rd Tue of the month'],
    ['monthly:last-fri', 'The last Fri of the month'],
    ['yearly', 'Every year'],
    ['custom:10d', 'Every 10 days'],
  ])('says %s as %s', (rule, expected) => {
    expect(describeRepeatRule(rule as string | null)).toBe(expected);
  });
});

describe('describeRepeat', () => {
  it('says nothing about an end when there is none', () => {
    expect(describeRepeat('daily', null, null)).toBe('Every day');
  });

  it('says how many times', () => {
    expect(describeRepeat('daily', null, 10)).toBe('Every day, 10 times');
  });

  it('says until when', () => {
    expect(describeRepeat('daily', '2026-12-25', null)).toContain('until');
    expect(describeRepeat('daily', '2026-12-25', null)).toContain('2026');
  });

  it('ignores an end on something that does not repeat', () => {
    expect(describeRepeat('', '2026-12-25', 5)).toBe('One-time');
  });

  it('survives a date it cannot read', () => {
    expect(describeRepeat('daily', 'not-a-date', null)).toBe('Every day');
  });
});
