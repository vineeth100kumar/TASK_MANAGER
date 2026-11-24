import { describe, expect, it } from 'vitest';
import { NO_PROJECT, columnOf, countPieces, inScope, isApproved, moveToDay, scopeProjectId, weekStart, type Piece } from './contentPieces';

const piece = (over: Partial<Piece>): Piece => ({
  kind: 'post', id: 'a', title: 't', status: 'done', scheduledFor: null, posted: false, wontPost: false, archived: false, review: 'approved', projectId: null, createdAt: '', ...over,
});

describe('isApproved', () => {
  it('is true only for approved, not-dropped pieces', () => {
    expect(isApproved(piece({ review: 'approved' }))).toBe(true);
    expect(isApproved(piece({ review: 'pending' }))).toBe(false);
    expect(isApproved(piece({ review: 'rejected' }))).toBe(false);
    expect(isApproved(piece({ review: 'approved', wontPost: true }))).toBe(false);
  });
});

describe('columnOf', () => {
  it('sorts a piece into its pipeline column', () => {
    expect(columnOf(piece({ status: 'running' }))).toBe('drafting');
    expect(columnOf(piece({ status: 'failed' }))).toBe('drafting');
    expect(columnOf(piece({}))).toBe('ready');
    expect(columnOf(piece({ scheduledFor: '2026-11-24T03:30:00Z' }))).toBe('scheduled');
    expect(columnOf(piece({ scheduledFor: '2026-11-24T03:30:00Z', posted: true }))).toBe('posted');
    expect(columnOf(piece({ wontPost: true }))).toBe('dropped');
    expect(columnOf(piece({ status: 'planned', wontPost: true }))).toBe('dropped');
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

describe('countPieces', () => {
  it('counts each column and what is scheduled this week', () => {
    const now = new Date(2026, 10, 18, 12, 0); // Wed 18 Nov 2026
    const inWeek = new Date(2026, 10, 20, 9, 0).toISOString();
    const nextWeek = new Date(2026, 10, 25, 9, 0).toISOString();
    const counts = countPieces([
      piece({ status: 'running' }),
      piece({}),
      piece({ scheduledFor: inWeek }),
      piece({ scheduledFor: nextWeek }),
      piece({ scheduledFor: inWeek, posted: true }),
      piece({ scheduledFor: inWeek, archived: true }),
    ], now);
    expect(counts).toEqual({ drafting: 1, ready: 1, scheduled: 2, posted: 1, weekScheduled: 1 });
  });
});

describe('content scope', () => {
  it('asks the Pi for everything when the scope is No project, then narrows', () => {
    expect(scopeProjectId('')).toBe('');
    expect(scopeProjectId('p1')).toBe('p1');
    expect(scopeProjectId(NO_PROJECT)).toBe('');
    expect(inScope(null, NO_PROJECT)).toBe(true);
    expect(inScope('p1', NO_PROJECT)).toBe(false);
    expect(inScope('p1', '')).toBe(true);
    expect(inScope(null, 'p1')).toBe(true); // the Pi already filtered a real project
  });
});
