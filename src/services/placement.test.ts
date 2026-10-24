import { describe, it, expect } from 'vitest';
import { suggestPlace, needsPlace } from './placement';

const proj = (id: string, name: string) => ({ id, name, key: name[0], color: '', sequence: 1, type: 'other', description: '', createdAt: '', updatedAt: '' } as any);
const item = (id: string, title: string, projectId: string | null) => ({ id, title, projectId, labels: [] } as any);

describe('placement', () => {
  it('needs a place unless it has one or is an alarm', () => {
    expect(needsPlace(item('a', 'Call bank', null))).toBe(true);
    expect(needsPlace(item('a', 'Call bank', 'p1'))).toBe(false);
    expect(needsPlace({ ...item('a', 'Alarm', null), labels: ['alarm'] })).toBe(false);
  });
  it('uses a project the title names', () => {
    expect(suggestPlace('Fix Misumi quote', [proj('p1', 'Misumi')], [], [])).toEqual({ projectId: 'p1', branchId: undefined });
  });
  it('uses the project whose tasks look alike', () => {
    const items = [item('1', 'Reel on baby essentials', 'p2')];
    expect(suggestPlace('Reel about baby essentials', [proj('p2', 'Kolourz')], [], items)).toEqual({ projectId: 'p2' });
  });
  it('gives up when nothing fits', () => {
    expect(suggestPlace('Weather jacket', [proj('p2', 'Kolourz')], [], [])).toBeNull();
  });
});
