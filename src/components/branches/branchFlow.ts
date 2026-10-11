import { ProjectBranch, WorkItem } from '../../services/types';
import { toDateKey } from '../../utils/recurrence';

/** Which day an item sits on in the flow: when it was done, else when it's planned, else when it was added. */
export function itemDay(item: WorkItem): string {
  if (item.status === 'done' && item.completedAt) return toDateKey(new Date(item.completedAt));
  return item.startDate || item.dueDate || item.startAt?.slice(0, 10) || toDateKey(new Date(item.createdAt));
}

export type FlowRow =
  | { kind: 'item'; date: string; lane: number; item: WorkItem; branch: ProjectBranch | null }
  | { kind: 'fork'; date: string; lane: number; parentLane: number; branch: ProjectBranch }
  | { kind: 'merge'; date: string; lane: number; parentLane: number; branch: ProjectBranch }
  | { kind: 'today'; date: string; lane: 0 };

export interface Flow {
  rows: FlowRow[];
  laneCount: number;
  /** For each lane, the rows it runs over; a lane can carry several branches one after another. */
  spans: { lane: number; from: number; to: number; color: string; open: boolean }[];
  branchLane: Map<string, number>;
}

// On a day, a branch splits off before its items and merges after them.
const ORDER: Record<FlowRow['kind'], number> = { fork: 0, item: 1, merge: 2, today: 3 };

/**
 * Lays a project out as a git-style graph, oldest at the top: the main line on
 * lane 0, each branch on its own lane from the day it splits off until the day
 * it merges (or the end, if it's still open). A lane is reused once its branch
 * has merged.
 */
export function buildFlow(items: WorkItem[], branches: ProjectBranch[], today: string, mainColor: string): Flow {
  const known = new Map(branches.map(b => [b.id, b]));
  // A branch can't start before the line it comes from.
  const startOf = (b: ProjectBranch, seen = new Set<string>()): string => {
    const parent = b.parentId ? known.get(b.parentId) : undefined;
    if (!parent || seen.has(b.id)) return b.startDate;
    seen.add(b.id);
    const ps = startOf(parent, seen);
    return b.startDate < ps ? ps : b.startDate;
  };
  const sortedBranches = [...branches].sort((a, b) => startOf(a).localeCompare(startOf(b)) || a.createdAt.localeCompare(b.createdAt));

  // Lanes: first free lane after the parent's that isn't taken on the fork day.
  const branchLane = new Map<string, number>();
  const laneBusyUntil: string[] = ['9999-12-31'];
  for (const b of sortedBranches) {
    const start = startOf(b);
    const parentLane = b.parentId && branchLane.has(b.parentId) ? branchLane.get(b.parentId)! : 0;
    let lane = parentLane + 1;
    while (laneBusyUntil[lane] && laneBusyUntil[lane] >= start) lane++;
    branchLane.set(b.id, lane);
    laneBusyUntil[lane] = b.mergedAt || '9999-12-31';
  }

  const rows: FlowRow[] = [];
  for (const b of sortedBranches) {
    const lane = branchLane.get(b.id)!;
    const parentLane = b.parentId && branchLane.has(b.parentId) ? branchLane.get(b.parentId)! : 0;
    rows.push({ kind: 'fork', date: startOf(b), lane, parentLane, branch: b });
    if (b.mergedAt) rows.push({ kind: 'merge', date: b.mergedAt < startOf(b) ? startOf(b) : b.mergedAt, lane, parentLane, branch: b });
  }
  for (const item of items) {
    const branch = item.branchId ? known.get(item.branchId) || null : null;
    rows.push({ kind: 'item', date: itemDay(item), lane: branch ? branchLane.get(branch.id)! : 0, item, branch });
  }
  rows.push({ kind: 'today', date: today, lane: 0 });
  rows.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind]
    || (a.kind === 'item' && b.kind === 'item' ? (a.item.createdAt || '').localeCompare(b.item.createdAt || '') : 0));

  const last = rows.length - 1;
  const spans: Flow['spans'] = [{ lane: 0, from: 0, to: last, color: mainColor, open: true }];
  for (const b of sortedBranches) {
    const from = rows.findIndex(r => r.kind === 'fork' && r.branch.id === b.id);
    const mergeAt = rows.findIndex(r => r.kind === 'merge' && r.branch.id === b.id);
    spans.push({ lane: branchLane.get(b.id)!, from, to: mergeAt >= 0 ? mergeAt : last, color: b.color, open: mergeAt < 0 });
  }

  const laneCount = Math.max(1, ...[...branchLane.values()].map(l => l + 1));
  return { rows, laneCount, spans, branchLane };
}
