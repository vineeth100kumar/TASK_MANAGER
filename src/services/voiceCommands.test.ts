import { describe, it, expect } from 'vitest';
import { afterWakeWord, parseVoice, parseClock, parseDuration } from './voiceCommands';

const now = new Date('2026-11-15T10:00:00');

describe('wake word', () => {
  it('finds Sage first', () => {
    expect(afterWakeWord('Sage set a timer for 5 minutes')).toBe('set a timer for 5 minutes');
    expect(afterWakeWord('hey sage, wake me at 6')).toBe('wake me at 6');
    expect(afterWakeWord('Sage')).toBe('');
    expect(afterWakeWord('the sage said hello')).toBeNull();
    expect(afterWakeWord('sagely advice')).toBeNull();
  });
});

describe('times', () => {
  it('reads spoken times', () => {
    expect(parseClock(' alarm for 7:30 am ', now)).toBe('07:30');
    expect(parseClock(' alarm for 7 30 pm ', now)).toBe('19:30');
    expect(parseClock(' alarm at 6 ', now)).toBe('18:00');       // 10:00 now: next 6 is this evening
    expect(parseClock(' alarm at 9 ', now)).toBe('21:00');
    expect(parseClock(' alarm at 11 ', now)).toBe('11:00');
    expect(parseClock(' alarm at 6 in the morning ', now)).toBe('06:00');
    expect(parseClock(' alarm at half past 6 pm ', now)).toBe('18:30');
    expect(parseClock(' alarm at quarter to 8 pm ', now)).toBe('19:45');
    expect(parseClock(' alarm at noon ', now)).toBe('12:00');
    expect(parseClock(' alarm at 18:15 ', now)).toBe('18:15');
    expect(parseClock(' alarm in 20 minutes ', now)).toBe('10:20');
  });
  it('reads durations', () => {
    expect(parseDuration(' timer for 10 minutes ')).toBe(600);
    expect(parseDuration(' 1 hour 30 minutes ')).toBe(5400);
    expect(parseDuration(' an hour and a half ')).toBe(5400);
    expect(parseDuration(' half an hour ')).toBe(1800);
    expect(parseDuration(' 90 seconds ')).toBe(90);
    expect(parseDuration(' timer for 10 ')).toBe(600);
  });
});

describe('commands', () => {
  const p = (s: string) => parseVoice(s, now);
  it('sets alarms', () => {
    expect(p('set an alarm for 7:30 a.m.')).toEqual({ kind: 'alarm_set', time: '07:30', days: [], label: '' });
    expect(p('wake me up at seven thirty am')).toMatchObject({ kind: 'alarm_set', time: '07:30' });
    expect(p('set an alarm for 6 am every weekday')).toMatchObject({ time: '06:00', days: [0, 1, 2, 3, 4] });
    expect(p('alarm at 8 am on saturday and sunday')).toMatchObject({ time: '08:00', days: [5, 6] });
    expect(p('set an alarm for 5 pm called gym')).toMatchObject({ time: '17:00', label: 'gym' });
  });
  it('cancels, turns off and on', () => {
    expect(p('cancel the 7 am alarm')).toMatchObject({ kind: 'alarm_cancel', time: '07:00' });
    expect(p('delete my alarm')).toMatchObject({ kind: 'alarm_cancel', time: null });
    expect(p('turn off all alarms')).toMatchObject({ kind: 'alarm_off', all: true });
    expect(p('turn on the 6:30 alarm')).toMatchObject({ kind: 'alarm_on', time: '18:30' });   // no am/pm said: runVoice matches either side of the day
  });
  it('runs timers', () => {
    expect(p('set a timer for 10 minutes')).toEqual({ kind: 'timer_start', seconds: 600 });
    expect(p('5 minute timer')).toEqual({ kind: 'timer_start', seconds: 300 });
    expect(p('start a timer for one hour thirty minutes')).toEqual({ kind: 'timer_start', seconds: 5400 });
    expect(p('pause the timer')).toEqual({ kind: 'timer', action: 'pause' });
    expect(p('resume timer')).toEqual({ kind: 'timer', action: 'resume' });
    expect(p('cancel the timer')).toEqual({ kind: 'timer', action: 'cancel' });
    expect(p('stop the timer')).toEqual({ kind: 'timer', action: 'cancel' });
    expect(p('add 2 minutes to the timer')).toEqual({ kind: 'timer_add', seconds: 120 });
  });
  it('stops and snoozes a ringing alarm', () => {
    expect(p('snooze')).toEqual({ kind: 'ring', action: 'snooze' });
    expect(p('stop the alarm')).toEqual({ kind: 'ring', action: 'stop' });
  });
  it('ignores what it does not know', () => {
    expect(p('what is the weather')).toBeNull();
    expect(p('set an alarm')).toBeNull();
  });
});
