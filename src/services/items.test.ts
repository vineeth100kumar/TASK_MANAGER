import { describe, it, expect } from 'vitest';
import sage from './__fixtures__/sage-project-2026-10-16.json';
import { normalizeItem, selectItems, onlyDated, describeShown, nextKey, kindOf, statusOf, contextOf, dayOf } from './items';
import { statusesFor, stageOf, DEFAULT_STATUSES } from './projectTypes';
import type { Project, WorkItem } from './types';

const SAGE_ID = '8527ae11-64de-4895-b23c-ccc95b1b3686';
const projects: Project[] = [
  { id: SAGE_ID, name: 'Sage', key: 'S', type: 'technical', color: 'bg-amber-500', sequence: 2, createdAt: '2026-10-04' },
  { id: 'p-content', name: 'Baby Kolourz', key: 'B', type: 'content', color: 'bg-emerald-500', sequence: 3, createdAt: '2026-10-04' },
  { id: 'p-old', name: 'Old', key: 'O', type: 'standard', color: 'bg-gray-500', sequence: 4, createdAt: '2026-01-01' },
];
const norm = (raw: any) => normalizeItem(raw, projects);
const live = (rows: any[]) => rows.map(norm);

// The same counting every page does: each item lands in exactly one status.
function columns(items: WorkItem[], projectId: string) {
  const statuses = statusesFor(projectId, projects);
  const out: Record<string, number> = {};
  for (const s of statuses) out[s.id] = items.filter(i => stageOf(i, statuses).id === s.id).length;
  return out;
}

describe('the Sage project as stored on the Pi (16 Oct 2026)', () => {
  const items = live(sage);
  const page = selectItems(items, { projectId: SAGE_ID }, projects);

  it('shows every one of its 85 items, milestones included', () => {
    expect(page.items).toHaveLength(85);
    expect(page.count).toEqual({ total: 85, shown: 85, hidden: {} });
    expect(page.items.filter(i => i.entityType === 'milestone')).toHaveLength(81);
  });

  it('Board columns add up to what Branches counts', () => {
    const cols = columns(page.items, SAGE_ID);
    expect(Object.values(cols).reduce((a, b) => a + b, 0)).toBe(85);
    expect(cols.shipped).toBe(83);
    expect(cols.building).toBe(2);
    const branchTotal = page.items.filter(i => !i.branchId).length
      + page.items.filter(i => !!i.branchId).length;
    expect(branchTotal).toBe(85);
  });

  it('old milestones without a key or labels still read cleanly', () => {
    const keyless = page.items.filter(i => !i.key);
    expect(keyless.length).toBeGreaterThan(0);
    for (const i of page.items) {
      expect(Array.isArray(i.labels)).toBe(true);
      expect(['work', 'personal']).toContain(i.lifeContext);
      expect(typeof i.isInbox).toBe('boolean');
    }
  });

  it('the type filter narrows and says what it hid', () => {
    const tasksOnly = selectItems(items, { projectId: SAGE_ID, filters: { entityType: 'task' } }, projects);
    expect(tasksOnly.items).toHaveLength(3);
    expect(tasksOnly.count.hidden).toEqual({ filter: 82 });
    expect(describeShown(tasksOnly.count)).toBe('Showing 3 of 85 items · 82 hidden by filters');
  });

  it('the Personal switch hides work items and says so', () => {
    const personal = selectItems(items, { projectId: SAGE_ID, lifeContext: 'personal' }, projects);
    expect(personal.items).toHaveLength(0);
    expect(personal.count.hidden).toEqual({ otherContext: 85 });
    expect(describeShown(personal.count, 'personal')).toBe('Showing 0 of 85 items · 85 in Work');
  });

  it('Calendar and Timeline count the items they cannot place', () => {
    const dated = onlyDated(page);
    expect(dated.count.shown + (dated.count.hidden.noDate || 0)).toBe(85);
  });
});

describe('older and odd records', () => {
  it('reads the kind from type when entityType is missing', () => {
    expect(kindOf({ type: 'meeting' })).toBe('event');
    expect(kindOf({ type: 'milestone' })).toBe('milestone');
    expect(kindOf({ type: 'bug' })).toBe('task');
    expect(kindOf({})).toBe('task');
    expect(kindOf({ entityType: 'Milestone' })).toBe('milestone');
  });

  it('maps every status word ever stored onto the four bases', () => {
    const s = (status: any, extra: any = {}) => statusOf({ status, ...extra }, DEFAULT_STATUSES).status;
    expect(s('in_review')).toBe('in_progress');
    expect(s('In Progress')).toBe('in_progress');
    expect(s('achieved')).toBe('done');
    expect(s('Completed')).toBe('done');
    expect(s('waiting')).toBe('blocked');
    expect(s(undefined)).toBe('todo');
    expect(s('???', { completedAt: '2026-10-01' })).toBe('done');
  });

  it('a project status stored as the status becomes status + stage', () => {
    const shipped = norm({ id: 'a', projectId: SAGE_ID, status: 'shipped' });
    expect(shipped.status).toBe('done');
    expect(shipped.stage).toBe('shipped');
    const editing = norm({ id: 'b', projectId: 'p-content', status: 'editing' });
    expect(editing.status).toBe('in_progress');
    expect(stageOf(editing, statusesFor('p-content', projects)).id).toBe('editing');
  });

  it('an item ticked done from Today leaves its old stage behind', () => {
    const it = norm({ id: 'c', projectId: SAGE_ID, status: 'done', stage: 'testing' });
    expect(stageOf(it, statusesFor(SAGE_ID, projects)).id).toBe('shipped');
  });

  it('a project with the old "standard" type uses the usual four', () => {
    const it = norm({ id: 'd', projectId: 'p-old', status: 'in_review' });
    expect(stageOf(it, statusesFor('p-old', projects)).id).toBe('in_progress');
  });

  it('normalises context, flags, labels and priority', () => {
    const it = norm({ id: 'e', lifeContext: 'Life', isFocus: 'TRUE', isInbox: 'false', labels: 'home, quick', priority: 'Critical' });
    expect(it.lifeContext).toBe('personal');
    expect(contextOf({ lifeContext: undefined })).toBe('work');
    expect(it.isFocus).toBe(true);
    expect(it.isInbox).toBe(false);
    expect(it.labels).toEqual(['home', 'quick']);
    expect(it.priority).toBe('urgent');
    expect(it.title).toBe('Untitled');
  });

  it('deleted items are never shown and never counted', () => {
    const sel = selectItems(live([{ id: 'x', deletedAt: '2026-10-01' }, { id: 'y' }]), {}, projects);
    expect(sel.items.map(i => i.id)).toEqual(['y']);
    expect(sel.count.total).toBe(1);
  });

  it('every kind has a day for the calendar', () => {
    expect(dayOf(norm({ id: '1', entityType: 'event', startAt: '2026-10-20T10:00' }))).toBe('2026-10-20');
    expect(dayOf(norm({ id: '2', entityType: 'reminder', dueDate: '2026-10-21' }))).toBe('2026-10-21');
    expect(dayOf(norm({ id: '3', entityType: 'milestone', dueDate: '2026-10-22T00:00:00Z' }))).toBe('2026-10-22');
    expect(dayOf(norm({ id: '4' }))).toBeNull();
  });
});

describe('keys', () => {
  it('numbers past the highest key, so gaps and keyless items never repeat one', () => {
    expect(nextKey([{ key: 'S-1' }, { key: 'S-50' }, { key: '' }, null, { key: 'SAGE-99' }], 'S')).toBe('S-51');
    expect(nextKey([], 'TASK')).toBe('TASK-1');
  });
});
