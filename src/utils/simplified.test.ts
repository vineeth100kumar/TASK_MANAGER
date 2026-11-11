import { describe, it, expect } from 'vitest';
import { pickUpNext, groupByProject, totalMinutes, formatMinutes, durationToMinutes } from './taskLists';
import { stripLeadIn } from './titles';

const item = (o: any) => ({ id: o.id, title: o.id, status: 'todo', priority: 'medium', ...o });

describe('Sage, simplified helpers', () => {
  it('Up next skips blocked, waiting and snoozed items', () => {
    const later = new Date(Date.now() + 3600_000).toISOString();
    const items = [item({ id: 'a', status: 'blocked' }), item({ id: 'b', waitingFor: { who: 'Ravi', sinceDate: '' } }),
      item({ id: 'c', snoozedUntil: later }), item({ id: 'd' })];
    expect(pickUpNext(items as any)?.id).toBe('d');
    expect(pickUpNext([items[0]] as any)).toBeNull();
  });

  it('groups by project in list order and keeps same-named tasks apart', () => {
    const g = groupByProject([
      item({ id: 'x1', title: 'Write docs', projectId: 'p1', project: { name: 'Sage' } }),
      item({ id: 'y1', title: 'Write docs', projectId: 'p2', project: { name: 'LUMO' } }),
      item({ id: 'x2', projectId: 'p1', project: { name: 'Sage' } }),
      item({ id: 'z' }),
    ] as any);
    expect(g.map(x => [x.name, x.items.map(i => i.id)])).toEqual([['Sage', ['x1', 'x2']], ['LUMO', ['y1']], ['No project', ['z']]]);
  });

  it('adds up minutes and counts items without an estimate', () => {
    expect(totalMinutes([item({ id: 'a', estimatedMinutes: 30 }), item({ id: 'b', estimatedMinutes: 100 }), item({ id: 'c' })] as any)).toEqual({ minutes: 130, unknown: 1 });
    expect(formatMinutes(130)).toBe('2h 10m');
    expect(formatMinutes(45)).toBe('45m');
    expect(durationToMinutes('1h 30m')).toBe(90);
    expect(durationToMinutes('30')).toBe(30);
    expect(durationToMinutes('soon')).toBeUndefined();
  });

  it('strips lead-in words from titles', () => {
    expect(stripLeadIn('Add task to finalise lumo firmware')).toBe('Finalise lumo firmware');
    expect(stripLeadIn('remind me to call mum')).toBe('Call mum');
    expect(stripLeadIn('Buy milk')).toBe('Buy milk');
    expect(stripLeadIn('add task')).toBe('add task');
  });
});
