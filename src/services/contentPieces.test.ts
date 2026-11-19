import { describe, expect, it } from 'vitest';
import { columnOf, moveToDay, weekStart, type Piece } from './contentPieces';

const piece = (over: Partial<Piece>): Piece => ({
  kind: 'post', id: 'a', title: 't', status: 'done', scheduledFor: null, posted: false, archived: false, projectId: null, createdAt: '', ...over,
});

describe('columnOf', () => {
  it('sorts a piece into its pipeline column', () => {
    expect(columnOf(piece({ status: 'running' }))).toBe('drafting');
    expect(columnOf(piece({ status: 'failed' }))).toBe('drafting');
    expect(columnOf(piece({}))).toBe('ready');
    expect(columnOf(piece({ scheduledFor: '2026-11-24T03:30:00Z' }))).toBe('scheduled');
    expect(columnOf(piece({ scheduledFor: '2026-11-24T03:30:00Z', posted: true }))).toBe('posted');
  });
});

describe('weekStart', () => {
  it('is the Monday at local midnight', () => {
    const wed = new Date(2026, 10, 18, 15, 30); // Wed 18 Nov 2026
    const mon = weekStart(wed);
    expect([mon.getFullYear(), mon.getMonth(), mon.getDate(), mon.getHours()]).toEqual([2026, 10, 16, 0]);
    expect(weekStart(new Date(2026, 10, 22)).getDate()).toBe(16); // Sunday belongs to the week before
  });
});

describe('moveToDay', () => {
  it('keeps the time of day, or uses 9:00', () => {
    const day = new Date(2026, 10, 20);
    const kept = new Date(moveToDay(day, new Date(2026, 10, 18, 17, 45).toISOString()));
    expect([kept.getDate(), kept.getHours(), kept.getMinutes()]).toEqual([20, 17, 45]);
    const fresh = new Date(moveToDay(day, null));
    expect([fresh.getDate(), fresh.getHours(), fresh.getMinutes()]).toEqual([20, 9, 0]);
  });
});
