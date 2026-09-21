import { describe, it, expect, beforeEach } from 'vitest';
import { saveSnapshot, readSnapshot, clearSnapshot, describeAsOf, SnapshotData } from '../snapshot';

const emptyData = (): SnapshotData => ({
  items: [],
  milestones: [],
  projects: [],
  dailyPerformance: null,
  financeSummary: null,
  transactions: [],
});

describe('the offline snapshot', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is absent until the Pi has answered once', () => {
    expect(readSnapshot()).toBeNull();
  });

  it('keeps what was on screen, with the time it was taken', () => {
    const data = emptyData();
    data.items = [{ id: 'a', title: 'Renew the car insurance' } as any];

    saveSnapshot(data);
    const snapshot = readSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.data.items[0].title).toBe('Renew the car insurance');
    expect(Number.isNaN(new Date(snapshot!.savedAt).getTime())).toBe(false);
  });

  it('caps the transaction history rather than risking a phone quota', () => {
    const data = emptyData();
    data.transactions = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}` } as any));

    saveSnapshot(data);

    expect(readSnapshot()!.data.transactions).toHaveLength(200);
  });

  it('ignores a snapshot written by an older version of the app', () => {
    localStorage.setItem('sage_snapshot', JSON.stringify({ version: 0, savedAt: '', data: {} }));
    expect(readSnapshot()).toBeNull();
  });

  it('ignores anything that is not a snapshot at all', () => {
    localStorage.setItem('sage_snapshot', 'not json');
    expect(readSnapshot()).toBeNull();
  });

  it('can be cleared', () => {
    saveSnapshot(emptyData());
    clearSnapshot();
    expect(readSnapshot()).toBeNull();
  });
});

describe('describeAsOf', () => {
  const now = new Date('2026-09-21T18:00:00');

  it('gives just the time while it is still today', () => {
    const line = describeAsOf(new Date('2026-09-21T09:30:00').toISOString(), now);
    expect(line).toMatch(/9:30/);
    expect(line).not.toMatch(/Sep/);
  });

  it('names the day within the past week', () => {
    const line = describeAsOf(new Date('2026-09-19T09:30:00').toISOString(), now);
    expect(line).toMatch(/^Sat,/);
  });

  it('gives a date once it is older than a week', () => {
    const line = describeAsOf(new Date('2026-09-01T09:30:00').toISOString(), now);
    expect(line).toMatch(/1 Sep|Sep 1/);
  });

  it('says something honest when the time makes no sense', () => {
    expect(describeAsOf('nonsense', now)).toBe('an earlier sync');
  });
});
