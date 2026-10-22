import type { EntityType, LifeContext, Project, TaskPriority, TaskStatus, WorkItem } from './types';
import { statusesFor, stageOf, type StatusStage } from './projectTypes';
import { toInputDateValue, toInputDateTimeValue } from '../utils/dateUtils';

// One shape for every work item, whichever device, app version, Pi tool or
// import wrote it. Every screen reads items through normalizeItem and picks
// them with selectItems, so the same project shows the same items (and the
// same counts) on Board, List, Table, Branches, Calendar and the status strip.
// Nothing here writes to the database: old records are read into this shape.

const KINDS: EntityType[] = ['task', 'event', 'reminder', 'milestone'];
const BASES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done'];
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

// Words older versions, imports and tools have stored as a status.
const STATUS_WORDS: Record<string, TaskStatus> = {
  todo: 'todo', to_do: 'todo', open: 'todo', new: 'todo', backlog: 'todo', idea: 'todo', planned: 'todo', not_started: 'todo',
  in_progress: 'in_progress', inprogress: 'in_progress', doing: 'in_progress', in_review: 'in_progress', review: 'in_progress',
  active: 'in_progress', started: 'in_progress', wip: 'in_progress',
  blocked: 'blocked', waiting: 'blocked', on_hold: 'blocked', hold: 'blocked', paused: 'blocked',
  done: 'done', complete: 'done', completed: 'done', achieved: 'done', closed: 'done', finished: 'done', shipped: 'done', published: 'done',
};

const word = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const truthy = (v: unknown) => v === true || v === 1 || word(v) === 'true' || word(v) === 'yes' || word(v) === '1';

/** Task, event, reminder or milestone; old records only had `type` ("meeting", "bug"). */
export function kindOf(raw: { entityType?: unknown; type?: unknown }): EntityType {
  const e = word(raw.entityType);
  if ((KINDS as string[]).includes(e)) return e as EntityType;
  const t = word(raw.type);
  if (t === 'meeting' || t === 'event') return 'event';
  if (t === 'reminder' || t === 'milestone') return t;
  return 'task';
}

/** A LUMO alarm: a reminder labelled "alarm" that the desk clock rings (the Pi
 * uses the same test). Alarms live on the LUMO page, never in task lists or counts. */
export function isAlarm(i: { labels?: unknown }): boolean {
  return labelsOf(i.labels).some(l => l.toLowerCase() === 'alarm');
}

/** Older or imported records can say "Personal" or "life"; anything else is work. */
export function contextOf(i: { lifeContext?: unknown }): LifeContext {
  const c = word(i.lifeContext);
  return c === 'personal' || c === 'life' ? 'personal' : 'work';
}

/** The base status and the project type's status. A stored status can be either
 * (an old "in_review", a tool that wrote "shipped"); the stage wins when it matches. */
export function statusOf(raw: { status?: unknown; stage?: unknown; completedAt?: unknown }, statuses: StatusStage[]): { status: TaskStatus; stage: string | null } {
  const s = word(raw.status);
  const storedStage = raw.stage ? String(raw.stage) : null;
  if ((BASES as string[]).includes(s)) return { status: s as TaskStatus, stage: storedStage };
  const asStage = statuses.find(x => x.id === s);
  if (asStage) return { status: asStage.base, stage: asStage.id };
  const mapped = STATUS_WORDS[s];
  if (mapped) return { status: mapped, stage: storedStage };
  return { status: raw.completedAt ? 'done' : 'todo', stage: storedStage };
}

/** Always done; the stored stage is kept only when it is one of the done statuses. */
function milestoneStatus(raw: { stage?: unknown }, statuses: StatusStage[]): { status: TaskStatus; stage: string | null } {
  const stored = raw.stage ? statuses.find(x => x.id === String(raw.stage) && x.base === 'done') : undefined;
  return { status: 'done', stage: stored ? stored.id : null };
}

function labelsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(x => x != null && String(x).trim()).map(x => String(x).trim());
  if (typeof v === 'string' && v.trim()) return v.split(',').map(x => x.trim()).filter(Boolean);
  return [];
}

/** Any stored work item, in the one shape every screen expects. */
export function normalizeItem(raw: any, projects: Project[] = []): WorkItem {
  const statuses = statusesFor(raw.projectId, projects);
  const kind = kindOf(raw);
  // A milestone is logged once the work is done, so it is always done: older
  // ones stored as open read as reached, on the project's own done status.
  const { status, stage } = kind === 'milestone' ? milestoneStatus(raw, statuses) : statusOf(raw, statuses);
  const priority = word(raw.priority);
  return {
    ...raw,
    id: String(raw.id),
    key: raw.key ? String(raw.key) : '',
    title: raw.title != null && String(raw.title).trim() ? String(raw.title) : 'Untitled',
    description: raw.description ? String(raw.description) : '',
    entityType: kind,
    type: raw.type ? String(raw.type) : kind,
    status,
    stage,
    ...(kind === 'milestone' && !raw.completedAt ? { completedAt: toInputDateValue(raw.dueDate) || toInputDateValue(raw.startDate) || raw.createdAt || null } : {}),
    priority: (PRIORITIES as string[]).includes(priority) ? priority as TaskPriority : priority === 'critical' ? 'urgent' : 'medium',
    lifeContext: contextOf(raw),
    projectId: raw.projectId || null,
    branchId: raw.branchId || null,
    areaId: raw.areaId || null,
    labels: labelsOf(raw.labels),
    isInbox: truthy(raw.isInbox),
    isFocus: truthy(raw.isFocus),
    startDate: toInputDateValue(raw.startDate) || null,
    dueDate: toInputDateValue(raw.dueDate) || null,
    dueTime: raw.dueTime || null,
    startAt: toInputDateTimeValue(raw.startAt) || null,
    endAt: toInputDateTimeValue(raw.endAt) || null,
    remindAt: toInputDateTimeValue(raw.remindAt) || null,
    version: Number(raw.version) || 1,
    deletedAt: raw.deletedAt || null,
    createdAt: raw.createdAt || raw.updatedAt || '',
    updatedAt: raw.updatedAt || raw.createdAt || '',
  };
}

/** The next free key for a prefix: one past the highest number in use, so
 * deleted or keyless items can't make two items share a key. */
export function nextKey(items: Array<{ key?: string | null } | null | undefined>, prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let max = 0;
  for (const i of items) {
    const m = i && i.key ? re.exec(String(i.key)) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

// --- Picking what a screen shows ---

export const isLive = (i: WorkItem | null | undefined): i is WorkItem => !!i && !i.deletedAt;

/** Why an item in scope isn't on screen. Every hidden item has exactly one. */
export type HiddenReason = 'otherContext' | 'filter' | 'noDate';

export const HIDDEN_LABEL: Record<HiddenReason, (n: number, ctx?: LifeContext) => string> = {
  otherContext: (n, ctx) => `${n} in ${ctx === 'work' ? 'Personal' : 'Work'}`,
  filter: n => `${n} hidden by filters`,
  noDate: n => `${n} without a date`,
};

export interface ItemFilters {
  search?: string;
  entityType?: string;
  priority?: string;
  status?: string;
  tag?: string;
  stage?: string;
}

export interface Shown {
  /** Items in this project (or everywhere), whatever the switch and filters. */
  total: number;
  shown: number;
  hidden: Partial<Record<HiddenReason, number>>;
}

export interface Selection {
  items: WorkItem[];
  count: Shown;
}

const matchesFilters = (i: WorkItem, f: ItemFilters, projects: Project[]): boolean => {
  if (f.stage && stageOf(i, statusesFor(i.projectId, projects)).id !== f.stage) return false;
  if (f.tag && !(i.labels || []).includes(f.tag)) return false;
  if (f.entityType && f.entityType !== 'all' && i.entityType !== f.entityType) return false;
  if (f.priority && f.priority !== 'all' && i.priority !== f.priority) return false;
  if (f.status && f.status !== 'all') {
    if (f.status === 'open' ? i.status === 'done' : i.status !== f.status) return false;
  }
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!(i.title || '').toLowerCase().includes(q) && !(i.key || '').toLowerCase().includes(q)
      && !(i.description || '').toLowerCase().includes(q)) return false;
  }
  return true;
};

/** The items one page shows: a project (or area, or 'all'), narrowed by the
 * Work/Personal switch and the filter bar, with a count of what was left out and why. */
export function selectItems(items: WorkItem[], scope: { projectId?: string; lifeContext?: LifeContext; filters?: ItemFilters }, projects: Project[]): Selection {
  const inScope = items.filter(i => isLive(i)
    && (!scope.projectId || scope.projectId === 'all' || i.projectId === scope.projectId || i.areaId === scope.projectId));
  const hidden: Partial<Record<HiddenReason, number>> = {};
  const out: WorkItem[] = [];
  for (const i of inScope) {
    if (scope.lifeContext && contextOf(i) !== scope.lifeContext) hidden.otherContext = (hidden.otherContext || 0) + 1;
    else if (scope.filters && !matchesFilters(i, scope.filters, projects)) hidden.filter = (hidden.filter || 0) + 1;
    else out.push(i);
  }
  return { items: out, count: { total: inScope.length, shown: out.length, hidden } };
}

/** The day an item sits on in Calendar and Timeline, for every kind. */
export function dayOf(i: WorkItem): string | null {
  const d = (s?: string | null) => (s ? s.slice(0, 10) : null);
  if (i.entityType === 'event') return d(i.startAt) || d(i.startDate) || d(i.dueDate);
  if (i.entityType === 'reminder') return d(i.remindAt) || d(i.dueDate) || d(i.startAt) || d(i.startDate);
  return d(i.dueDate) || d(i.startDate) || d(i.startAt) || d(i.remindAt);
}

/** A selection narrowed again by a view that can only place dated items. */
export function onlyDated(sel: Selection): Selection {
  const items = sel.items.filter(i => !!dayOf(i));
  const noDate = sel.items.length - items.length;
  return {
    items,
    count: { ...sel.count, shown: items.length, hidden: noDate ? { ...sel.count.hidden, noDate } : sel.count.hidden },
  };
}

/** "Showing 3 of 85 · 82 hidden by filters"; just "85 items" when nothing is hidden. */
export function describeShown(count: Shown, ctx?: LifeContext): string {
  const noun = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;
  const parts = (Object.keys(count.hidden) as HiddenReason[])
    .filter(r => (count.hidden[r] || 0) > 0)
    .map(r => HIDDEN_LABEL[r](count.hidden[r] as number, ctx));
  if (!parts.length) return `All ${noun(count.total)}`;
  return [`Showing ${count.shown} of ${noun(count.total)}`, ...parts].join(' · ');
}
